import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  databaseAvailable, resetTestDatabase, dropTestDatabase,
  makeUser, makeTask, makeAssignment, makeSubmission, logActivityAt,
} from './helpers/db.js';

const DEFAULTS = {
  engagement_risk_threshold: 40,
  eng_weight_login: 0.34, eng_weight_task: 0.33, eng_weight_submission: 0.33,
};

let pool;
let computeEngagementForMember;
let computeEngagementForMembers;
// Resolved at module load, because `skip:` below is evaluated when each test is
// REGISTERED — before any before() hook has had a chance to run.
const available = await databaseAvailable();

before(async () => {
  if (!available) return;
  pool = await resetTestDatabase();
  ({ computeEngagementForMember, computeEngagementForMembers } =
    await import('../src/services/engagement.service.js'));
});

after(async () => {
  if (pool) await pool.end();
  await dropTestDatabase();
});

beforeEach(async () => {
  if (!available) return;
  for (const t of ['activity_logs', 'submissions', 'task_assignments', 'tasks', 'users']) {
    await pool.query(`DELETE FROM \`${t}\``);
  }
});

const skip = () => (available ? false : 'no MySQL server reachable');

test('cold-start guard: under 14 days of history is insufficient_data, never at_risk', { skip: skip() }, async () => {
  const m = await makeUser(pool, { name: 'New', email: 'new@t.local', createdDaysAgo: 5 });
  const e = await computeEngagementForMember(m, DEFAULTS);
  assert.equal(e.score, null);
  assert.equal(e.status, 'insufficient_data');
  assert.equal(e.is_flagged, 0, 'a new account must not be flagged');
});

test('exactly 14 days of history crosses out of the cold start', { skip: skip() }, async () => {
  const m = await makeUser(pool, { name: 'Edge', email: 'edge@t.local', createdDaysAgo: 14 });
  const e = await computeEngagementForMember(m, DEFAULTS);
  assert.notEqual(e.status, 'insufficient_data');
  assert.equal(typeof e.score, 'number');
});

test('the documented worked example reproduces exactly', { skip: skip() }, async () => {
  // SCORING.md 2.4 — Kevin: 7 login days of a 10 target, 5 task updates of 7,
  // 3 of 4 submissions on time => 72.12, on_track.
  const sup = await makeUser(pool, { name: 'S', email: 's@t.local', role: 'supervisor' });
  const m = await makeUser(pool, { name: 'Kevin', email: 'kevin@t.local', createdDaysAgo: 60 });

  for (let d = 1; d <= 7; d += 1) await logActivityAt(pool, { userId: m, type: 'login', daysAgo: d });
  for (let i = 0; i < 5; i += 1) await logActivityAt(pool, { userId: m, type: 'task_update', daysAgo: 1 });

  const t = await makeTask(pool, { createdBy: sup });
  const a = await makeAssignment(pool, { taskId: t, memberId: m });
  for (const late of [0, 0, 0, 1]) {
    await makeSubmission(pool, { taskId: t, assignmentId: a, memberId: m, isLate: late, daysAgo: 2 });
  }

  const e = await computeEngagementForMember(m, DEFAULTS);
  assert.equal(e.login_frequency, 70);
  assert.equal(e.task_update_frequency, 71.43);
  assert.equal(e.submission_timeliness, 75);
  assert.equal(e.score, 72.12);
  assert.equal(e.status, 'on_track');
  assert.equal(e.is_flagged, 0);
});

test('the low-activity variant lands at_risk', { skip: skip() }, async () => {
  // Same example, logins dropped to 2 days and updates to 1 => 36.26, at_risk.
  const sup = await makeUser(pool, { name: 'S', email: 's@t.local', role: 'supervisor' });
  const m = await makeUser(pool, { name: 'Kevin', email: 'kevin@t.local', createdDaysAgo: 60 });

  for (let d = 1; d <= 2; d += 1) await logActivityAt(pool, { userId: m, type: 'login', daysAgo: d });
  await logActivityAt(pool, { userId: m, type: 'task_update', daysAgo: 1 });

  const t = await makeTask(pool, { createdBy: sup });
  const a = await makeAssignment(pool, { taskId: t, memberId: m });
  for (const late of [0, 0, 0, 1]) {
    await makeSubmission(pool, { taskId: t, assignmentId: a, memberId: m, isLate: late, daysAgo: 2 });
  }

  const e = await computeEngagementForMember(m, DEFAULTS);
  assert.equal(e.score, 36.26);
  assert.equal(e.status, 'at_risk');
  assert.equal(e.is_flagged, 1);
});

test('silence in the submission window reads as 0, not as neutral', { skip: skip() }, async () => {
  const m = await makeUser(pool, { name: 'Quiet', email: 'q@t.local', createdDaysAgo: 60 });
  const e = await computeEngagementForMember(m, DEFAULTS);
  assert.equal(e.submission_timeliness, 0);
});

test('status bands sit exactly on the threshold', { skip: skip() }, async () => {
  const m = await makeUser(pool, { name: 'Band', email: 'band@t.local', createdDaysAgo: 60 });

  // Only the login feature contributes, so the score is a clean 0.34 x N x 10.
  const scoreFor = async (loginDays) => {
    await pool.query(`DELETE FROM activity_logs`);
    for (let d = 1; d <= loginDays; d += 1) await logActivityAt(pool, { userId: m, type: 'login', daysAgo: d });
    return computeEngagementForMember(m, DEFAULTS);
  };

  assert.equal((await scoreFor(10)).status, 'at_risk', '34.0 is below the 40 threshold');
  // Nudging the threshold rather than the data keeps the arithmetic obvious.
  const lenient = { ...DEFAULTS, engagement_risk_threshold: 30 };
  const e = await computeEngagementForMember(m, lenient);
  assert.equal(e.score, 34);
  assert.equal(e.status, 'moderate', 'threshold..threshold+20 is the amber band');
  assert.equal((await computeEngagementForMember(m, { ...DEFAULTS, engagement_risk_threshold: 10 })).status, 'on_track');
});

test('batched and per-member computation agree exactly', { skip: skip() }, async () => {
  const ids = [];
  for (let i = 0; i < 4; i += 1) {
    const m = await makeUser(pool, { name: `M${i}`, email: `m${i}@t.local`, createdDaysAgo: i === 0 ? 3 : 60 });
    ids.push(m);
    for (let d = 1; d <= i * 2; d += 1) await logActivityAt(pool, { userId: m, type: 'login', daysAgo: d });
    for (let j = 0; j < i; j += 1) await logActivityAt(pool, { userId: m, type: 'task_update', daysAgo: 1 });
  }
  const batch = await computeEngagementForMembers(ids, DEFAULTS);
  for (const id of ids) {
    const single = await computeEngagementForMember(id, DEFAULTS);
    assert.deepEqual(batch.get(id), single, `member ${id} must match between paths`);
  }
});
