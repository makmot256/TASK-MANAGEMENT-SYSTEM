import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '../../src/db/schema.sql');

// node --test runs each file in its own process, in parallel. A single shared
// test database would therefore have files dropping each other's schema
// mid-run, so each file gets its own, named after the file that imported this.
function perFileDatabaseName() {
  const base = process.env.TEST_DB_NAME || 'task_management_system_test';
  const entry = process.argv[1] || 'unknown';
  const suffix = path.basename(entry).replace(/\.test\.js$/, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  return `${base}_${suffix}`.slice(0, 63);
}

export const TEST_DB = perFileDatabaseName();

// Point config/db.js at the throwaway database BEFORE anything imports it.
// The pool is created at module load, so this has to happen first.
process.env.DB_NAME = TEST_DB;

function serverConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  };
}

/** True when a MySQL server is reachable, so tests can skip rather than fail. */
export async function databaseAvailable() {
  try {
    const conn = await mysql.createConnection(serverConfig());
    await conn.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * Drops and rebuilds the test database from schema.sql, then returns the
 * application's own pool bound to it. Every test file starts from a known
 * empty schema — no fixtures leak between runs.
 */
export async function resetTestDatabase() {
  const root = await mysql.createConnection(serverConfig());
  await root.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await root.query(
    `CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await root.query(`USE \`${TEST_DB}\``);
  await root.query(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  const { applyTriggers } = await import('../../src/db/triggers.js');
  await applyTriggers(root);
  await root.end();

  const { pool } = await import('../../src/config/db.js');
  return pool;
}

/** Drops this file's database. Called from each suite's `after` hook. */
export async function dropTestDatabase() {
  try {
    const root = await mysql.createConnection(serverConfig());
    await root.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await root.end();
  } catch {
    // best effort — a leftover test database is harmless
  }
}

// ---- fixture builders ------------------------------------------------------
// Deliberately thin: each returns an id so a test reads as a sequence of facts.

export async function makeUser(pool, { name, email, role = 'member', status = 'active', createdDaysAgo = 60 }) {
  const [r] = await pool.execute(
    `INSERT INTO users (full_name, email, password_hash, role, status, created_at)
     VALUES (?, ?, 'x', ?, ?, NOW() - INTERVAL ? DAY)`,
    [name, email, role, status, createdDaysAgo]
  );
  return r.insertId;
}

export async function makeTeam(pool, name) {
  const [r] = await pool.execute(`INSERT INTO teams (name) VALUES (?)`, [name]);
  return r.insertId;
}

export async function addTeamMember(pool, teamId, memberId) {
  await pool.execute(`INSERT INTO team_members (team_id, member_id) VALUES (?, ?)`, [teamId, memberId]);
}

export async function addTeamSupervisor(pool, teamId, supervisorId) {
  await pool.execute(`INSERT INTO team_supervisors (team_id, supervisor_id) VALUES (?, ?)`, [teamId, supervisorId]);
}

export async function makeTask(pool, { createdBy, title = 'Task', deadlineDaysAgo = 1 }) {
  const [r] = await pool.execute(
    `INSERT INTO tasks (title, deadline, created_by) VALUES (?, NOW() - INTERVAL ? DAY, ?)`,
    [title, deadlineDaysAgo, createdBy]
  );
  return r.insertId;
}

/** `onTime` may be 1, 0, or null — null is the state C2 used to leave behind. */
export async function makeAssignment(pool, { taskId, memberId, status = 'To-Do', onTime = null }) {
  const completed = status === 'Completed';
  const [r] = await pool.execute(
    `INSERT INTO task_assignments (task_id, member_id, status, completed_at, on_time)
     VALUES (?, ?, ?, ${completed ? 'NOW()' : 'NULL'}, ?)`,
    [taskId, memberId, status, onTime]
  );
  return r.insertId;
}

export async function makeSubmission(pool, { taskId, assignmentId, memberId, isLate = 0, daysAgo = 0 }) {
  const [r] = await pool.execute(
    `INSERT INTO submissions (task_id, assignment_id, member_id, content, is_late, submitted_at)
     VALUES (?, ?, ?, 'work', ?, NOW() - INTERVAL ? DAY)`,
    [taskId, assignmentId, memberId, isLate, daysAgo]
  );
  return r.insertId;
}

export async function makePeerReview(pool, { submissionId, assessorId, assesseeId, score, vulgar = 0 }) {
  await pool.execute(
    `INSERT INTO peer_assessments (submission_id, assessor_id, assessee_id, kind, score, vulgar_comment)
     VALUES (?, ?, ?, 'peer_review', ?, ?)`,
    [submissionId, assessorId, assesseeId, score, vulgar]
  );
}

export async function makeCycle(pool) {
  const [r] = await pool.execute(
    `INSERT INTO evaluation_cycles (name, start_date, end_date, status)
     VALUES ('Test cycle', CURDATE(), LAST_DAY(CURDATE()), 'open')`
  );
  return r.insertId;
}

export async function makeCollaboration(pool, { cycleId, assessorId, assesseeId, score }) {
  await pool.execute(
    `INSERT INTO peer_assessments (cycle_id, assessor_id, assessee_id, kind, score)
     VALUES (?, ?, ?, 'collaboration', ?)`,
    [cycleId, assessorId, assesseeId, score]
  );
}

export async function makeSupervisorAssessment(pool, { submissionId, memberId, supervisorId, quality, responsiveness = null }) {
  await pool.execute(
    `INSERT INTO supervisor_assessments (submission_id, member_id, supervisor_id, quality_score, responsiveness_score)
     VALUES (?, ?, ?, ?, ?)`,
    [submissionId, memberId, supervisorId, quality, responsiveness]
  );
}

export async function makeMissedReview(pool, { submissionId, reviewerId, revieweeId }) {
  await pool.execute(
    `INSERT INTO peer_review_assignments (submission_id, reviewer_id, reviewee_id, status, due_at)
     VALUES (?, ?, ?, 'missed', NOW() - INTERVAL 1 DAY)`,
    [submissionId, reviewerId, revieweeId]
  );
}

export async function logActivityAt(pool, { userId, type, daysAgo }) {
  await pool.execute(
    `INSERT INTO activity_logs (user_id, action_type, created_at) VALUES (?, ?, NOW() - INTERVAL ? DAY)`,
    [userId, type, daysAgo]
  );
}
