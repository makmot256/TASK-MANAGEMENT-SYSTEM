import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { computeEngagementForMember } from './engagement.service.js';
import { getSettings } from './settings.service.js';
import { notify } from '../utils/notify.js';

/** Active members eligible to serve as reviewers in the system-wide pool. */
export async function eligibleReviewerPool() {
  const [rows] = await pool.query(
    `SELECT id, full_name, avatar_color, title, last_login_at
       FROM users
      WHERE role = 'member' AND status = 'active'
      ORDER BY full_name`
  );
  return rows;
}

async function latestEngagementMap(memberIds) {
  if (!memberIds.length) return {};
  const ph = memberIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT es.member_id AS id, es.score, es.status
       FROM engagement_scores es
       JOIN (SELECT member_id, MAX(computed_at) mx FROM engagement_scores
              WHERE member_id IN (${ph}) GROUP BY member_id) last
         ON last.member_id = es.member_id AND last.mx = es.computed_at`,
    memberIds
  );
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

function engagementScoreForWeight(row, liveEngagement) {
  if (liveEngagement?.score != null) return Number(liveEngagement.score);
  if (row?.score != null) return Number(row.score);
  return 50;
}

function reviewerWeight(engagementScore, pendingCount, workloadCap) {
  const engagementFactor = (100 - engagementScore) / 100 + 0.15;
  const cap = Math.max(workloadCap, 1);
  const workloadFactor = (cap - pendingCount + 1) / (cap + 1);
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.max(0.01, engagementFactor * workloadFactor * jitter);
}

function weightedPick(candidates) {
  const total = candidates.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return c.id;
  }
  return candidates[candidates.length - 1].id;
}

/**
 * When a member uploads a task report, pick up to 3 reviewers from the system pool,
 * balance workload, prioritize lower engagement, and notify each reviewer.
 */
export async function assignPeerReviewersForSubmission(submissionId, revieweeId, taskTitle) {
  const maxReviewers = Math.min(Math.max(env.peerReviewersPerSubmission, 1), 3);
  const poolMembers = await eligibleReviewerPool();
  const candidates = poolMembers.filter((m) => m.id !== Number(revieweeId));

  if (candidates.length === 0) {
    return { created: 0, skipped: 0, message: 'No eligible reviewers in the pool.' };
  }

  const [[existing]] = await pool.query(
    `SELECT COUNT(*) AS c FROM peer_review_assignments WHERE submission_id = ?`,
    [submissionId]
  );
  if (Number(existing.c) > 0) {
    return { created: 0, skipped: 0, message: 'Reviewers already assigned for this submission.' };
  }

  const settings = await getSettings();
  const poolIds = candidates.map((m) => m.id);
  const engagementMap = await latestEngagementMap(poolIds);

  const [countRows] = await pool.query(
    `SELECT reviewer_id, COUNT(*) AS c FROM peer_review_assignments
      WHERE status = 'pending' GROUP BY reviewer_id`
  );
  const pendingCounts = new Map(countRows.map((r) => [r.reviewer_id, Number(r.c)]));

  const workloadCap = Math.max(maxReviewers * 2, 6);
  const chosen = new Set();
  let created = 0;

  for (let slot = 0; slot < maxReviewers; slot++) {
    const weighted = [];

    for (const reviewer of candidates) {
      if (chosen.has(reviewer.id)) continue;

      let liveEngagement = null;
      if (!engagementMap[reviewer.id]) {
        liveEngagement = await computeEngagementForMember(reviewer.id, settings);
      }

      const engagementScore = engagementScoreForWeight(engagementMap[reviewer.id], liveEngagement);
      const weight = reviewerWeight(
        engagementScore,
        pendingCounts.get(reviewer.id) || 0,
        workloadCap
      );
      weighted.push({ id: reviewer.id, weight });
    }

    if (!weighted.length) break;

    const reviewerId = weightedPick(weighted);
    chosen.add(reviewerId);

    const deadlineDays = Math.max(Number(settings.peer_review_deadline_days) || 7, 1);
    await pool.execute(
      `INSERT INTO peer_review_assignments
        (submission_id, reviewer_id, reviewee_id, kind, status, due_at)
       VALUES (?, ?, ?, 'peer_review', 'pending', DATE_ADD(NOW(), INTERVAL ? DAY))`,
      [submissionId, reviewerId, revieweeId, deadlineDays]
    );

    pendingCounts.set(reviewerId, (pendingCounts.get(reviewerId) || 0) + 1);
    created++;

    await notify(reviewerId, {
      type: 'peer_assignment',
      title: 'Peer review requested',
      body: `Please peer-review the report uploaded for "${taskTitle}". Your identity stays anonymous to the author.`,
      link: '/peer-reviews',
    });
  }

  const reviewers = await getPeerReviewersForSubmission(submissionId);
  return { created, skipped: maxReviewers - created, maxReviewers, reviewers };
}

/** Peer reviewers assigned to a submission (for supervisor visibility). */
export async function getPeerReviewersForSubmission(submissionId) {
  const [rows] = await pool.query(
    `SELECT pa.id, pa.status, pa.assigned_at, pa.due_at, pa.completed_at,
            u.id AS reviewer_id, u.full_name AS reviewer_name, u.avatar_color AS reviewer_color,
            ass.score AS review_score
       FROM peer_review_assignments pa
       JOIN users u ON u.id = pa.reviewer_id
       LEFT JOIN peer_assessments ass
         ON ass.submission_id = pa.submission_id
        AND ass.assessor_id = pa.reviewer_id
        AND ass.kind = 'peer_review'
      WHERE pa.submission_id = ?
      ORDER BY pa.assigned_at ASC`,
    [submissionId]
  );
  return rows;
}

export async function listAssignmentsForScope(memberIds) {
  if (!memberIds.length) {
    return { assignments: [], distribution: [], stats: { total: 0, pending: 0, completed: 0, avgPerReviewer: 0 } };
  }

  const ph = memberIds.map(() => '?').join(',');
  const [assignments] = await pool.query(
    `SELECT pa.id, pa.submission_id, pa.kind, pa.status, pa.assigned_at, pa.due_at, pa.completed_at,
            rv.id AS reviewer_id, rv.full_name AS reviewer_name, rv.avatar_color AS reviewer_color,
            re.id AS reviewee_id, re.full_name AS reviewee_name, re.avatar_color AS reviewee_color,
            t.title AS task_title, s.submitted_at AS submission_date
       FROM peer_review_assignments pa
       JOIN users rv ON rv.id = pa.reviewer_id
       JOIN users re ON re.id = pa.reviewee_id
       JOIN submissions s ON s.id = pa.submission_id
       JOIN tasks t ON t.id = s.task_id
      WHERE pa.submission_id IS NOT NULL
        AND (pa.reviewer_id IN (${ph}) OR pa.reviewee_id IN (${ph}))
      ORDER BY pa.assigned_at DESC`,
    [...memberIds, ...memberIds]
  );

  const [distribution] = await pool.query(
    `SELECT u.id, u.full_name, u.avatar_color,
            COUNT(pa.id) AS assigned_count,
            SUM(pa.status = 'completed') AS completed_count,
            SUM(pa.status = 'pending') AS pending_count,
            SUM(pa.status = 'missed') AS missed_count,
            es.score AS engagement_score, es.status AS engagement_status
       FROM users u
       LEFT JOIN peer_review_assignments pa ON pa.reviewer_id = u.id AND pa.submission_id IS NOT NULL
       LEFT JOIN (
         SELECT es1.member_id, es1.score, es1.status
           FROM engagement_scores es1
           JOIN (SELECT member_id, MAX(computed_at) mx FROM engagement_scores GROUP BY member_id) last
             ON last.member_id = es1.member_id AND last.mx = es1.computed_at
       ) es ON es.member_id = u.id
      WHERE u.id IN (${ph})
      GROUP BY u.id, u.full_name, u.avatar_color, es.score, es.status
      ORDER BY assigned_count DESC, u.full_name`,
    memberIds
  );

  const stats = {
    total: assignments.length,
    pending: assignments.filter((a) => a.status === 'pending').length,
    missed: assignments.filter((a) => a.status === 'missed').length,
    completed: assignments.filter((a) => a.status === 'completed').length,
    reviewers: distribution.filter((d) => Number(d.assigned_count) > 0).length,
    avgPerReviewer:
      distribution.length > 0
        ? Math.round(
            (distribution.reduce((s, d) => s + Number(d.assigned_count), 0) /
              Math.max(distribution.filter((d) => Number(d.assigned_count) > 0).length, 1)) *
              10
          ) / 10
        : 0,
  };

  return { assignments, distribution, stats };
}

export async function memberAssignments(reviewerId) {
  const settings = await getSettings();
  const [rows] = await pool.query(
    `SELECT pa.id, pa.submission_id, pa.reviewee_id, pa.kind, pa.status, pa.assigned_at, pa.due_at, pa.completed_at,
            u.full_name AS reviewee_name, u.avatar_color AS reviewee_color, u.title AS reviewee_title,
            t.title AS task_title, s.submitted_at AS submission_date,
            (SELECT COUNT(*) FROM submission_files f WHERE f.submission_id = s.id) AS file_count,
            (s.content IS NOT NULL AND s.content <> '') AS has_content,
            ass.score AS review_score, ass.comment AS review_comment, ass.vulgar_comment AS review_vulgar,
            ass.created_at AS reviewed_at
       FROM peer_review_assignments pa
       JOIN users u ON u.id = pa.reviewee_id
       JOIN submissions s ON s.id = pa.submission_id
       JOIN tasks t ON t.id = s.task_id
       LEFT JOIN peer_assessments ass
         ON ass.submission_id = pa.submission_id
        AND ass.assessor_id = pa.reviewer_id
        AND ass.kind = 'peer_review'
      WHERE pa.reviewer_id = ? AND pa.submission_id IS NOT NULL
      ORDER BY
        CASE pa.status WHEN 'pending' THEN 0 WHEN 'missed' THEN 1 ELSE 2 END,
        COALESCE(pa.completed_at, pa.assigned_at) DESC`,
    [reviewerId]
  );
  const pending = rows.filter((r) => r.status === 'pending');
  return {
    assignments: rows,
    pendingCount: pending.length,
    assignmentsActive: pending.length > 0,
    penaltyPolicy: {
      deadline_days: Number(settings.peer_review_deadline_days) || 7,
      missed_penalty: Number(settings.peer_review_missed_penalty) || 0.05,
      vulgar_penalty: Number(settings.peer_review_bad_penalty) || 0.03,
    },
  };
}

export async function markAssignmentCompleted(submissionId, reviewerId) {
  await pool.execute(
    `UPDATE peer_review_assignments
        SET status = 'completed', completed_at = NOW()
      WHERE submission_id = ? AND reviewer_id = ? AND status = 'pending'`,
    [submissionId, reviewerId]
  );
}

export async function isAssignedForSubmission(submissionId, reviewerId) {
  const [rows] = await pool.query(
    `SELECT id, reviewee_id FROM peer_review_assignments
      WHERE submission_id = ? AND reviewer_id = ? AND kind = 'peer_review'`,
    [submissionId, reviewerId]
  );
  return rows.length ? rows[0] : null;
}

export async function canViewSubmissionForPeerReview(submissionId, userId) {
  const row = await isAssignedForSubmission(submissionId, userId);
  return !!row;
}
