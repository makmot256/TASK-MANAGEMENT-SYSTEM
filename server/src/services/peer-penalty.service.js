import { pool } from '../config/db.js';
import { getSettings } from './settings.service.js';
import { notify } from '../utils/notify.js';
import { containsVulgarLanguage } from '../utils/profanity.js';

/** Mark pending peer reviews past their due date as missed. */
export async function markOverduePeerReviews(settings) {
  const s = settings || (await getSettings());

  const [overdue] = await pool.query(
    `SELECT id, reviewer_id, submission_id
       FROM peer_review_assignments
      WHERE status = 'pending'
        AND due_at IS NOT NULL
        AND due_at < NOW()`
  );

  if (!overdue.length) return { marked: 0 };

  await pool.execute(
    `UPDATE peer_review_assignments
        SET status = 'missed'
      WHERE status = 'pending'
        AND due_at IS NOT NULL
        AND due_at < NOW()`
  );

  for (const row of overdue) {
    await notify(row.reviewer_id, {
      type: 'peer_penalty',
      title: 'Peer review missed',
      body: 'You missed a peer review deadline. Your Task Performance score has been penalized.',
      link: '/peer-reviews',
    });
  }

  return { marked: overdue.length };
}

/** Count reviewer obligations that incur TP deductions. */
export async function getReviewerPenaltyStats(memberId, settings) {
  const s = settings || (await getSettings());
  const missedPenalty = Number(s.peer_review_missed_penalty) || 0.05;
  const vulgarPenalty = Number(s.peer_review_bad_penalty) || 0.03;

  const [[missedRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM peer_review_assignments
      WHERE reviewer_id = ? AND status = 'missed'`,
    [memberId]
  );
  const [[vulgarRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM peer_assessments
      WHERE assessor_id = ? AND kind = 'peer_review' AND vulgar_comment = 1`,
    [memberId]
  );

  const missedReviews = Number(missedRow.c) || 0;
  const vulgarComments = Number(vulgarRow.c) || 0;
  const tpDeduction = missedReviews * missedPenalty + vulgarComments * vulgarPenalty;

  return {
    missed_reviews: missedReviews,
    vulgar_comments: vulgarComments,
    tp_deduction: tpDeduction,
    missed_penalty: missedPenalty,
    vulgar_penalty: vulgarPenalty,
  };
}

export function isVulgarPeerReviewComment(comment) {
  return containsVulgarLanguage(comment);
}
