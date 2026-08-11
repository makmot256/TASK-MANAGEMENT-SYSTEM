import { pool } from '../config/db.js';
import { getSettings } from './settings.service.js';
import { getReviewerPenaltyStats } from './peer-penalty.service.js';

const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const clamp01 = (n) => Math.max(0, Math.min(1, n));

/**
 * Computes the Performance Index for one member following SRS 4.2:
 *   PI = w1*TP + w2*PE + w3*SA
 *   TP = (Tasks Completed / Total Assigned) * Timeliness
 *   Timeliness = On-Time Completions / Total Completions
 *   PE = (sumPR/(5k))*0.5 + (sumCO/(5m))*0.5 - Penalty
 *   SA = (Quality + Responsiveness) / 10
 */
export async function computePerformanceForMember(memberId, settings) {
  const s = settings || (await getSettings());

  // ---- Task Performance (TP) ----
  const [[taskAgg]] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(status = 'Completed') AS completed,
            SUM(on_time = 1) AS on_time
     FROM task_assignments WHERE member_id = ?`,
    [memberId]
  );
  const total = Number(taskAgg.total) || 0;
  const completed = Number(taskAgg.completed) || 0;
  const onTime = Number(taskAgg.on_time) || 0;
  const timeliness = completed > 0 ? clamp01(onTime / completed) : 0;
  const baseTp = total > 0 ? clamp01((completed / total) * timeliness) : 0;
  const reviewerPenalties = await getReviewerPenaltyStats(memberId, s);
  const tp = clamp01(baseTp - reviewerPenalties.tp_deduction);

  // ---- Peer Evaluation (PE) ----
  const [[pr]] = await pool.query(
    `SELECT COALESCE(SUM(score),0) AS sum, COUNT(*) AS k FROM peer_assessments
     WHERE assessee_id = ? AND kind = 'peer_review'`,
    [memberId]
  );
  const [[co]] = await pool.query(
    `SELECT COALESCE(SUM(score),0) AS sum, COUNT(*) AS m FROM peer_assessments
     WHERE assessee_id = ? AND kind = 'collaboration'`,
    [memberId]
  );
  const prComponent = pr.k > 0 ? (pr.sum / (5 * pr.k)) * 0.5 : 0;
  const coComponent = co.m > 0 ? (co.sum / (5 * co.m)) * 0.5 : 0;

  // Penalty: member submitted no peer evaluations though a cohort exists.
  const [[given]] = await pool.query(
    `SELECT COUNT(*) AS c FROM peer_assessments WHERE assessor_id = ?`,
    [memberId]
  );
  const [[cohort]] = await pool.query(
    `SELECT COUNT(*) AS c FROM users WHERE role = 'member' AND id <> ?`,
    [memberId]
  );
  const skippedPeerDuty = cohort.c > 0 && given.c === 0;
  const pe = clamp01(prComponent + coComponent - (skippedPeerDuty ? Number(s.peer_penalty) : 0));

  const penaltyApplied =
    reviewerPenalties.missed_reviews > 0 ||
    reviewerPenalties.vulgar_comments > 0 ||
    skippedPeerDuty;

  // ---- Supervisor Assessment (SA) ----
  const [[sa]] = await pool.query(
    `SELECT AVG(quality_score) AS q, AVG(responsiveness_score) AS r FROM supervisor_assessments WHERE member_id = ?`,
    [memberId]
  );
  const avgQuality = sa.q !== null ? Number(sa.q) : 0;
  const avgResp = sa.r !== null ? Number(sa.r) : avgQuality; // no revisions => mirror quality
  const saScore = clamp01((avgQuality + avgResp) / 10);

  const pi = clamp01(
    Number(s.pi_weight_tp) * tp + Number(s.pi_weight_pe) * pe + Number(s.pi_weight_sa) * saScore
  );

  return {
    member_id: memberId,
    tp: round4(tp),
    pe: round4(pe),
    sa: round4(saScore),
    pi: round4(pi),
    timeliness: round4(timeliness),
    penalty_applied: penaltyApplied ? 1 : 0,
    base_tp: round4(baseTp),
    reviewer_penalties: {
      missed_reviews: reviewerPenalties.missed_reviews,
      vulgar_comments: reviewerPenalties.vulgar_comments,
      tp_deduction: round4(reviewerPenalties.tp_deduction),
    },
  };
}

export async function recomputePerformanceForMember(memberId) {
  const s = await getSettings();
  const score = await computePerformanceForMember(memberId, s);
  await savePerformance(score);
  return score;
}

// Persist a snapshot for a member.
export async function savePerformance(score) {
  await pool.execute(
    `INSERT INTO performance_scores (member_id, tp, pe, sa, pi, timeliness, penalty_applied)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [score.member_id, score.tp, score.pe, score.sa, score.pi, score.timeliness, score.penalty_applied]
  );
}

// Recompute + store performance for every member.
export async function recomputeAllPerformance() {
  const s = await getSettings();
  const [members] = await pool.query(`SELECT id FROM users WHERE role = 'member'`);
  for (const m of members) {
    const score = await computePerformanceForMember(m.id, s);
    await savePerformance(score);
  }
  return members.length;
}

/**
 * Performance for many members in a fixed number of queries.
 *
 * P1: `/analytics/overview` looped `computePerformanceForMember`, which issues
 * ~6 queries per member. Five set-based queries now cover any number of members,
 * so the supervisor dashboard no longer scales its round-trips with team size.
 *
 * Returns a Map of memberId -> the same shape computePerformanceForMember gives.
 */
export async function computePerformanceForMembers(memberIds, settings) {
  const out = new Map();
  if (!memberIds.length) return out;
  const s = settings || (await getSettings());
  const ph = memberIds.map(() => '?').join(',');

  const [tasks] = await pool.query(
    `SELECT member_id,
            COUNT(*) AS total,
            SUM(status = 'Completed') AS completed,
            SUM(on_time = 1) AS on_time
       FROM task_assignments WHERE member_id IN (${ph}) GROUP BY member_id`,
    memberIds
  );
  const [received] = await pool.query(
    `SELECT assessee_id, kind, COALESCE(SUM(score), 0) AS total, COUNT(*) AS n
       FROM peer_assessments WHERE assessee_id IN (${ph}) GROUP BY assessee_id, kind`,
    memberIds
  );
  const [given] = await pool.query(
    `SELECT assessor_id, COUNT(*) AS c
       FROM peer_assessments WHERE assessor_id IN (${ph}) GROUP BY assessor_id`,
    memberIds
  );
  const [supervisor] = await pool.query(
    `SELECT member_id, AVG(quality_score) AS q, AVG(responsiveness_score) AS r
       FROM supervisor_assessments WHERE member_id IN (${ph}) GROUP BY member_id`,
    memberIds
  );
  const [missed] = await pool.query(
    `SELECT reviewer_id, COUNT(*) AS c FROM peer_review_assignments
      WHERE reviewer_id IN (${ph}) AND status = 'missed' GROUP BY reviewer_id`,
    memberIds
  );
  const [vulgar] = await pool.query(
    `SELECT assessor_id, COUNT(*) AS c FROM peer_assessments
      WHERE assessor_id IN (${ph}) AND kind = 'peer_review' AND vulgar_comment = 1
      GROUP BY assessor_id`,
    memberIds
  );
  const [[cohort]] = await pool.query(
    `SELECT COUNT(*) AS c FROM users WHERE role = 'member'`
  );

  const byId = (rows, key) => Object.fromEntries(rows.map((r) => [Number(r[key]), r]));
  const taskMap = byId(tasks, 'member_id');
  const givenMap = byId(given, 'assessor_id');
  const supMap = byId(supervisor, 'member_id');
  const missedMap = byId(missed, 'reviewer_id');
  const vulgarMap = byId(vulgar, 'assessor_id');
  const recvMap = new Map();
  for (const r of received) recvMap.set(`${r.assessee_id}:${r.kind}`, r);

  const missedPenalty = Number(s.peer_review_missed_penalty) || 0.05;
  const vulgarPenalty = Number(s.peer_review_bad_penalty) || 0.03;

  for (const rawId of memberIds) {
    const id = Number(rawId);
    const t = taskMap[id] || {};
    const total = Number(t.total) || 0;
    const completed = Number(t.completed) || 0;
    const onTime = Number(t.on_time) || 0;
    const timeliness = completed > 0 ? clamp01(onTime / completed) : 0;
    const baseTp = total > 0 ? clamp01((completed / total) * timeliness) : 0;

    const missedReviews = Number(missedMap[id]?.c) || 0;
    const vulgarComments = Number(vulgarMap[id]?.c) || 0;
    const tpDeduction = missedReviews * missedPenalty + vulgarComments * vulgarPenalty;
    const tp = clamp01(baseTp - tpDeduction);

    const pr = recvMap.get(`${id}:peer_review`);
    const co = recvMap.get(`${id}:collaboration`);
    const prK = Number(pr?.n) || 0;
    const coM = Number(co?.n) || 0;
    const prComponent = prK > 0 ? (Number(pr.total) / (5 * prK)) * 0.5 : 0;
    const coComponent = coM > 0 ? (Number(co.total) / (5 * coM)) * 0.5 : 0;

    // The cohort excludes the member themselves, matching the single-member path.
    const cohortSize = Math.max(Number(cohort.c) - 1, 0);
    const skippedPeerDuty = cohortSize > 0 && (Number(givenMap[id]?.c) || 0) === 0;
    const pe = clamp01(prComponent + coComponent - (skippedPeerDuty ? Number(s.peer_penalty) : 0));

    const sup = supMap[id];
    const avgQuality = sup?.q != null ? Number(sup.q) : 0;
    const avgResp = sup?.r != null ? Number(sup.r) : avgQuality;
    const saScore = clamp01((avgQuality + avgResp) / 10);

    const pi = clamp01(
      Number(s.pi_weight_tp) * tp + Number(s.pi_weight_pe) * pe + Number(s.pi_weight_sa) * saScore
    );

    out.set(id, {
      member_id: id,
      tp: round4(tp),
      pe: round4(pe),
      sa: round4(saScore),
      pi: round4(pi),
      timeliness: round4(timeliness),
      penalty_applied: missedReviews > 0 || vulgarComments > 0 || skippedPeerDuty ? 1 : 0,
      base_tp: round4(baseTp),
      reviewer_penalties: {
        missed_reviews: missedReviews,
        vulgar_comments: vulgarComments,
        tp_deduction: round4(tpDeduction),
      },
    });
  }
  return out;
}
