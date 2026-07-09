import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { logActivity } from '../utils/notify.js';
import { canCollaborateReview } from '../utils/scope.js';
import {
  memberAssignments,
  markAssignmentCompleted,
  isAssignedForSubmission,
} from '../services/peer-assignment.service.js';
import { isVulgarPeerReviewComment } from '../services/peer-penalty.service.js';
import { recomputePerformanceForMember } from '../services/performance.service.js';

const router = Router();
router.use(authenticate);

// GET /api/peer/assigned  (submission-based reviews this member must complete)
router.get(
  '/assigned',
  requireRole('member'),
  asyncHandler(async (req, res) => {
    res.json(await memberAssignments(req.user.id));
  })
);

// POST /api/peer  (member submits a peer review on an assigned submission, or collaboration rating)
router.post(
  '/',
  requireRole('member'),
  asyncHandler(async (req, res) => {
    const { submission_id, assessee_id, kind, score, comment } = req.body;
    if (!['peer_review', 'collaboration'].includes(kind)) throw new HttpError(400, 'Invalid assessment kind.');
    if (!(Number(score) >= 1 && Number(score) <= 5)) throw new HttpError(400, 'Score must be between 1 and 5.');

    if (kind === 'peer_review') {
      if (!submission_id) throw new HttpError(400, 'submission_id is required for peer reviews.');
      const assignment = await isAssignedForSubmission(submission_id, req.user.id);
      if (!assignment) {
        throw new HttpError(403, 'You are not assigned to review this submission.');
      }
      if (Number(assignment.reviewee_id) === req.user.id) {
        throw new HttpError(400, 'You cannot review your own submission.');
      }

      const vulgarComment = isVulgarPeerReviewComment(comment);

      await pool.execute(
        `INSERT INTO peer_assessments (submission_id, assessor_id, assessee_id, kind, score, comment, vulgar_comment)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE score = VALUES(score), comment = VALUES(comment), vulgar_comment = VALUES(vulgar_comment)`,
        [submission_id, req.user.id, assignment.reviewee_id, kind, score, comment || null, vulgarComment ? 1 : 0]
      );
      await markAssignmentCompleted(submission_id, req.user.id);
      await recomputePerformanceForMember(req.user.id);
      await logActivity(req.user.id, 'peer_review', { submission_id, assessee_id, kind, vulgar_comment: vulgarComment }, null);
      return res.status(201).json({
        message: vulgarComment
          ? 'Assessment submitted. Inappropriate language was detected and a Task Performance penalty was applied.'
          : 'Assessment submitted.',
        vulgar_comment: vulgarComment,
      });
    }

    if (!assessee_id) throw new HttpError(400, 'assessee_id is required for collaboration ratings.');
    if (Number(assessee_id) === req.user.id) throw new HttpError(400, 'You cannot evaluate yourself.');
    if (!(await canCollaborateReview(req.user.id, assessee_id))) {
      throw new HttpError(403, 'You can only rate members on your team.');
    }

    const [cycles] = await pool.execute(
      `SELECT id FROM evaluation_cycles WHERE status = 'open' ORDER BY id DESC LIMIT 1`
    );
    const cycleId = cycles[0]?.id || null;

    await pool.execute(
      `INSERT INTO peer_assessments (cycle_id, assessor_id, assessee_id, kind, score, comment)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE score = VALUES(score), comment = VALUES(comment)`,
      [cycleId, req.user.id, assessee_id, kind, score, comment || null]
    );

    await logActivity(req.user.id, 'peer_review', { submission_id, assessee_id, kind }, null);
    res.status(201).json({ message: 'Assessment submitted.' });
  })
);

// GET /api/peer/mine  (aggregated scores + anonymised comments — no reviewer names)
router.get(
  '/mine',
  requireRole('member'),
  asyncHandler(async (req, res) => {
    const [agg] = await pool.execute(
      `SELECT kind, AVG(score) AS avg_score, COUNT(*) AS n FROM peer_assessments
       WHERE assessee_id = ? GROUP BY kind`,
      [req.user.id]
    );
    const [comments] = await pool.execute(
      `SELECT pa.kind, pa.score, pa.comment, pa.created_at, pa.submission_id,
              t.id AS task_id, t.title AS task_title
         FROM peer_assessments pa
         LEFT JOIN submissions s ON s.id = pa.submission_id
         LEFT JOIN tasks t ON t.id = s.task_id
        WHERE pa.assessee_id = ?
          AND pa.comment IS NOT NULL
          AND pa.comment <> ''
        ORDER BY
          CASE WHEN t.id IS NULL THEN 1 ELSE 0 END,
          t.title ASC,
          pa.created_at DESC`,
      [req.user.id]
    );

    const groupsMap = new Map();
    for (const c of comments) {
      const key = c.task_id
        ? `task-${c.task_id}`
        : c.kind === 'collaboration'
          ? 'collaboration'
          : 'general';
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          key,
          task_id: c.task_id || null,
          task_title: c.task_title
            || (c.kind === 'collaboration' ? 'Collaboration feedback' : 'General feedback'),
          comments: [],
        });
      }
      groupsMap.get(key).comments.push({
        kind: c.kind,
        score: c.score,
        comment: c.comment,
        created_at: c.created_at,
      });
    }

    res.json({ aggregates: agg, comments, groups: [...groupsMap.values()] });
  })
);

// GET /api/peer/given
router.get(
  '/given',
  requireRole('member'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT pa.assessee_id, pa.submission_id, pa.kind, pa.score, pa.comment, pa.vulgar_comment, pa.created_at,
              u.full_name AS assessee_name, u.avatar_color AS assessee_color,
              t.title AS task_title
         FROM peer_assessments pa
         JOIN users u ON u.id = pa.assessee_id
         LEFT JOIN submissions s ON s.id = pa.submission_id
         LEFT JOIN tasks t ON t.id = s.task_id
        WHERE pa.assessor_id = ?
        ORDER BY pa.created_at DESC`,
      [req.user.id]
    );
    res.json({ given: rows });
  })
);

export default router;
