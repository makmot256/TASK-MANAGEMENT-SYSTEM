import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  databaseAvailable, resetTestDatabase, dropTestDatabase,
  makeUser, makeTask, makeAssignment, makeSubmission,
  makePeerReview, makeCycle, makeCollaboration, makeSupervisorAssessment, makeMissedReview,
} from './helpers/db.js';

// The Performance Index is the system's whole value proposition and it is pure,
// deterministic arithmetic over well-defined inputs — the single most testable
// thing here, and where a silent regression is hardest to notice by using the app.

const DEFAULTS = {
  pi_weight_tp: 0.25, pi_weight_pe: 0.35, pi_weight_sa: 0.4,
  peer_penalty: 0.1, peer_review_missed_penalty: 0.05, peer_review_bad_penalty: 0.03,
};

let pool;
let computePerformanceForMember;
let computePerformanceForMembers;
// Resolved at module load, because `skip:` below is evaluated when each test is
// REGISTERED — before any before() hook has had a chance to run.
const available = await databaseAvailable();

before(async () => {
  if (!available) return;
  pool = await resetTestDatabase();
  ({ computePerformanceForMember, computePerformanceForMembers } =
    await import('../src/services/performance.service.js'));
});

after(async () => {
  if (pool) await pool.end();
  await dropTestDatabase();
});

beforeEach(async () => {
  if (!available) return;
  // Order matters: children before parents.
  for (const t of [
    'peer_assessments', 'peer_review_assignments', 'supervisor_assessments',
    'submissions', 'task_status_history', 'task_assignments', 'tasks',
    'evaluation_cycles', 'users',
  ]) {
    await pool.query(`DELETE FROM \`${t}\``);
  }
});

const skip = () => (available ? false : 'no MySQL server reachable (set DB_HOST/DB_USER/DB_PASSWORD)');

test('zero activity scores zero, not NaN', { skip: skip() }, async () => {
  const m = await makeUser(pool, { name: 'Nobody', email: 'nobody@t.local' });
  const p = await computePerformanceForMember(m, DEFAULTS);
  assert.equal(p.tp, 0);
  assert.equal(p.pe, 0);
  assert.equal(p.sa, 0);
  assert.equal(p.pi, 0);
  assert.equal(p.timeliness, 0);
});

test('the documented worked example reproduces exactly', { skip: skip() }, async () => {
  // SCORING.md section 1.4 — Grace: 10 assigned, 8 completed, 6 on time,
  // 1 missed review, 4 peer reviews summing 16, 3 collaborations summing 12,
  // supervisor quality 4.0 / responsiveness 3.0.
  const sup = await makeUser(pool, { name: 'Sup', email: 'sup@t.local', role: 'supervisor' });
  const grace = await makeUser(pool, { name: 'Grace', email: 'grace@t.local' });
  const other = await makeUser(pool, { name: 'Other', email: 'other@t.local' });

  const task = await makeTask(pool, { createdBy: sup });
  let firstAssignment = null;
  for (let i = 0; i < 10; i += 1) {
    const t = await makeTask(pool, { createdBy: sup, title: `T${i}` });
    const status = i < 8 ? 'Completed' : 'In Progress';
    const onTime = i < 6 ? 1 : i < 8 ? 0 : null;
    const a = await makeAssignment(pool, { taskId: t, memberId: grace, status, onTime });
    if (i === 0) firstAssignment = { task: t, assignment: a };
  }

  const sub = await makeSubmission(pool, {
    taskId: firstAssignment.task, assignmentId: firstAssignment.assignment, memberId: grace,
  });

  // 4 peer reviews summing to 16 (5+4+4+3), each from a distinct assessor.
  for (const [i, score] of [5, 4, 4, 3].entries()) {
    const reviewer = await makeUser(pool, { name: `R${i}`, email: `r${i}@t.local` });
    const s = await makeSubmission(pool, {
      taskId: firstAssignment.task, assignmentId: firstAssignment.assignment, memberId: grace,
    });
    await makePeerReview(pool, { submissionId: s, assessorId: reviewer, assesseeId: grace, score });
  }

  // 3 collaboration ratings summing to 12 (4+4+4).
  const cycle = await makeCycle(pool);
  for (const [i, score] of [4, 4, 4].entries()) {
    const rater = await makeUser(pool, { name: `C${i}`, email: `c${i}@t.local` });
    await makeCollaboration(pool, { cycleId: cycle, assessorId: rater, assesseeId: grace, score });
  }

  // Grace has written at least one assessment, so no skip penalty.
  await makeCollaboration(pool, { cycleId: cycle, assessorId: grace, assesseeId: other, score: 4 });

  // Supervisor: average quality 4.0, average responsiveness 3.0.
  await makeSupervisorAssessment(pool, {
    submissionId: sub, memberId: grace, supervisorId: sup, quality: 4, responsiveness: 3,
  });

  // Exactly one missed peer review.
  await makeMissedReview(pool, { submissionId: sub, reviewerId: grace, revieweeId: other });

  const p = await computePerformanceForMember(grace, DEFAULTS);

  assert.equal(p.timeliness, 0.75, 'timeliness = 6/8');
  assert.equal(p.base_tp, 0.6, 'base TP = (8/10) x 0.75');
  assert.equal(p.reviewer_penalties.missed_reviews, 1);
  assert.equal(p.reviewer_penalties.tp_deduction, 0.05);
  assert.equal(p.tp, 0.55, 'TP = 0.60 - 0.05');
  assert.equal(p.pe, 0.8, 'PE = 0.40 + 0.40');
  assert.equal(p.sa, 0.7, 'SA = (4.0 + 3.0) / 10');
  assert.equal(p.pi, 0.6975, 'PI = 0.25(0.55) + 0.35(0.80) + 0.40(0.70)');
});

test('C2 regression: NULL on_time no longer silently zeroes timeliness', { skip: skip() }, async () => {
  // Before C2, supervisor-approved completions left on_time NULL, so a member
  // who did everything on time scored timeliness 0 and therefore TP 0.
  const sup = await makeUser(pool, { name: 'Sup', email: 's@t.local', role: 'supervisor' });
  const m = await makeUser(pool, { name: 'M', email: 'm@t.local' });

  for (let i = 0; i < 4; i += 1) {
    const t = await makeTask(pool, { createdBy: sup, title: `T${i}` });
    await makeAssignment(pool, { taskId: t, memberId: m, status: 'Completed', onTime: 1 });
  }
  const good = await computePerformanceForMember(m, DEFAULTS);
  assert.equal(good.timeliness, 1);
  assert.equal(good.base_tp, 1);

  // The old broken state, for contrast: same work, on_time never recorded.
  await pool.query(`UPDATE task_assignments SET on_time = NULL WHERE member_id = ?`, [m]);
  const broken = await computePerformanceForMember(m, DEFAULTS);
  assert.equal(broken.timeliness, 0, 'NULL on_time still yields timeliness 0 — hence C2');
  assert.equal(broken.tp, 0, 'and TP collapses to 0, losing the whole 0.25 weight');
});

test('penalties: missed reviews and vulgar comments both deduct from TP', { skip: skip() }, async () => {
  const sup = await makeUser(pool, { name: 'Sup', email: 's@t.local', role: 'supervisor' });
  const m = await makeUser(pool, { name: 'M', email: 'm@t.local' });
  const other = await makeUser(pool, { name: 'O', email: 'o@t.local' });

  const t = await makeTask(pool, { createdBy: sup });
  const a = await makeAssignment(pool, { taskId: t, memberId: m, status: 'Completed', onTime: 1 });
  const sub = await makeSubmission(pool, { taskId: t, assignmentId: a, memberId: other });

  await makeMissedReview(pool, { submissionId: sub, reviewerId: m, revieweeId: other });
  await makePeerReview(pool, { submissionId: sub, assessorId: m, assesseeId: other, score: 2, vulgar: 1 });

  const p = await computePerformanceForMember(m, DEFAULTS);
  assert.equal(p.base_tp, 1);
  assert.equal(p.reviewer_penalties.missed_reviews, 1);
  assert.equal(p.reviewer_penalties.vulgar_comments, 1);
  assert.equal(p.reviewer_penalties.tp_deduction, 0.08, '1 x 0.05 + 1 x 0.03');
  assert.equal(p.tp, 0.92);
  assert.equal(p.penalty_applied, 1);
});

test('TP clamps at zero rather than going negative', { skip: skip() }, async () => {
  const sup = await makeUser(pool, { name: 'Sup', email: 's@t.local', role: 'supervisor' });
  const m = await makeUser(pool, { name: 'M', email: 'm@t.local' });
  const other = await makeUser(pool, { name: 'O', email: 'o@t.local' });
  const t = await makeTask(pool, { createdBy: sup });
  const a = await makeAssignment(pool, { taskId: t, memberId: other, status: 'Completed', onTime: 1 });
  const sub = await makeSubmission(pool, { taskId: t, assignmentId: a, memberId: other });

  // 30 missed reviews x 0.05 = 1.5 deduction against a base TP of 0.
  for (let i = 0; i < 30; i += 1) {
    const s = await makeSubmission(pool, { taskId: t, assignmentId: a, memberId: other });
    await makeMissedReview(pool, { submissionId: s, reviewerId: m, revieweeId: other });
  }
  const p = await computePerformanceForMember(m, DEFAULTS);
  assert.equal(p.tp, 0);
  assert.ok(p.pi >= 0);
});

test('PE: each half caps at 0.5, so one kind alone cannot exceed it', { skip: skip() }, async () => {
  const m = await makeUser(pool, { name: 'M', email: 'm@t.local' });
  const other = await makeUser(pool, { name: 'O', email: 'o@t.local' });
  const sup = await makeUser(pool, { name: 'S', email: 's@t.local', role: 'supervisor' });
  const t = await makeTask(pool, { createdBy: sup });
  const a = await makeAssignment(pool, { taskId: t, memberId: m });

  // Perfect peer reviews, no collaboration ratings at all.
  for (let i = 0; i < 3; i += 1) {
    const reviewer = await makeUser(pool, { name: `R${i}`, email: `r${i}@t.local` });
    const s = await makeSubmission(pool, { taskId: t, assignmentId: a, memberId: m });
    await makePeerReview(pool, { submissionId: s, assessorId: reviewer, assesseeId: m, score: 5 });
  }
  // Give one assessment so the skip penalty does not confound the assertion.
  const cycle = await makeCycle(pool);
  await makeCollaboration(pool, { cycleId: cycle, assessorId: m, assesseeId: other, score: 5 });

  const p = await computePerformanceForMember(m, DEFAULTS);
  assert.equal(p.pe, 0.5, 'excellent peer reviews with no collaboration caps PE at 0.5');
});

test('PE: the skip penalty fires on zero given, and one assessment clears it', { skip: skip() }, async () => {
  const m = await makeUser(pool, { name: 'M', email: 'm@t.local' });
  const other = await makeUser(pool, { name: 'O', email: 'o@t.local' });
  const sup = await makeUser(pool, { name: 'S', email: 's@t.local', role: 'supervisor' });
  const t = await makeTask(pool, { createdBy: sup });
  const a = await makeAssignment(pool, { taskId: t, memberId: m });
  const reviewer = await makeUser(pool, { name: 'R', email: 'r@t.local' });
  const s = await makeSubmission(pool, { taskId: t, assignmentId: a, memberId: m });
  await makePeerReview(pool, { submissionId: s, assessorId: reviewer, assesseeId: m, score: 4 });

  const before = await computePerformanceForMember(m, DEFAULTS);
  assert.equal(before.penalty_applied, 1, 'no assessments written -> penalised');

  const cycle = await makeCycle(pool);
  await makeCollaboration(pool, { cycleId: cycle, assessorId: m, assesseeId: other, score: 3 });

  const after = await computePerformanceForMember(m, DEFAULTS);
  assert.equal(after.penalty_applied, 0, 'writing one assessment of any kind clears it');
  assert.ok(after.pe > before.pe);
});

test('SA: responsiveness mirrors quality when no revision was ever requested', { skip: skip() }, async () => {
  const sup = await makeUser(pool, { name: 'S', email: 's@t.local', role: 'supervisor' });
  const m = await makeUser(pool, { name: 'M', email: 'm@t.local' });
  const t = await makeTask(pool, { createdBy: sup });
  const a = await makeAssignment(pool, { taskId: t, memberId: m });
  const sub = await makeSubmission(pool, { taskId: t, assignmentId: a, memberId: m });

  await makeSupervisorAssessment(pool, {
    submissionId: sub, memberId: m, supervisorId: sup, quality: 4, responsiveness: null,
  });
  const p = await computePerformanceForMember(m, DEFAULTS);
  assert.equal(p.sa, 0.8, 'no one is punished for never being asked to revise');
});

test('batched and per-member computation agree exactly', { skip: skip() }, async () => {
  // P1 replaced the per-member loop with set-based queries; the two must not drift.
  const sup = await makeUser(pool, { name: 'S', email: 's@t.local', role: 'supervisor' });
  const cycle = await makeCycle(pool);
  const ids = [];
  for (let i = 0; i < 5; i += 1) {
    const m = await makeUser(pool, { name: `M${i}`, email: `m${i}@t.local` });
    ids.push(m);
    for (let j = 0; j <= i; j += 1) {
      const t = await makeTask(pool, { createdBy: sup, title: `T${i}-${j}` });
      await makeAssignment(pool, {
        taskId: t, memberId: m,
        status: j % 2 === 0 ? 'Completed' : 'In Progress',
        onTime: j % 2 === 0 ? (j % 4 === 0 ? 1 : 0) : null,
      });
    }
  }
  const other = ids[0];
  for (const [i, m] of ids.entries()) {
    if (i === 0) continue;
    await makeCollaboration(pool, { cycleId: cycle, assessorId: m, assesseeId: other, score: (i % 5) + 1 });
  }

  const batch = await computePerformanceForMembers(ids, DEFAULTS);
  for (const id of ids) {
    const single = await computePerformanceForMember(id, DEFAULTS);
    assert.deepEqual(batch.get(id), single, `member ${id} must match between paths`);
  }
});
