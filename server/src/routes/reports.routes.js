import { Router } from 'express';
import path from 'path';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { upload, uploadRoot } from '../middleware/upload.js';
import { notify, logActivity } from '../utils/notify.js';
import { memberIdsForSupervisor } from '../utils/scope.js';
import {
  assignPeerReviewersForSubmission,
  canViewSubmissionForPeerReview,
  getPeerReviewersForSubmission,
} from '../services/peer-assignment.service.js';

const router = Router();
router.use(authenticate);

// POST /api/submissions  (member submits proof of work) -- SRS UC4
router.post(
  '/',
  requireRole('member'),
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    const { task_id, content, kind, revision_of } = req.body;
    const files = req.files || [];
    if (!content && files.length === 0) throw new HttpError(400, 'A report needs text and/or a file attachment.');

    const [assign] = await pool.execute(
      `SELECT ta.id, t.deadline, t.title, t.created_by
       FROM task_assignments ta JOIN tasks t ON t.id = ta.task_id
       WHERE ta.task_id = ? AND ta.member_id = ? LIMIT 1`,
      [task_id, req.user.id]
    );
    if (!assign.length) throw new HttpError(403, 'You are not assigned to this task.');
    const a = assign[0];
    const isLate = a.deadline ? (new Date() > new Date(a.deadline) ? 1 : 0) : 0;

    const [result] = await pool.execute(
      `INSERT INTO submissions (task_id, assignment_id, member_id, content, kind, is_late, revision_of)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [task_id, a.id, req.user.id, content || null, kind === 'daily_log' ? 'daily_log' : 'weekly_report', isLate, revision_of || null]
    );
    const submissionId = result.insertId;

    for (const f of files) {
      await pool.execute(
        `INSERT INTO submission_files (submission_id, original_name, stored_name, mime_type, size_bytes)
         VALUES (?, ?, ?, ?, ?)`,
        [submissionId, f.originalname, f.filename, f.mimetype, f.size]
      );
    }

    // Move assignment to Under Review on submission
    await pool.execute(`UPDATE task_assignments SET status = 'Under Review' WHERE id = ?`, [a.id]);
    await logActivity(req.user.id, 'submission', { task_id, submissionId }, null);

    // Assign peer reviewers immediately so supervisors can see them right away.
    let peerAssign = { created: 0, reviewers: [] };
    try {
      peerAssign = await assignPeerReviewersForSubmission(submissionId, req.user.id, a.title);
    } catch (err) {
      console.error('[peer-assign] submission assignment failed:', err.message);
    }

    const reviewerNames = (peerAssign.reviewers || []).map((r) => r.reviewer_name).filter(Boolean);
    const peerLine =
      reviewerNames.length > 0
        ? ` Peer reviewers assigned: ${reviewerNames.join(', ')}.`
        : peerAssign.created === 0
          ? ' No peer reviewers were available to assign.'
          : '';

    await notify(a.created_by, {
      type: 'report_submitted',
      title: 'New report submitted',
      body: `${req.user.full_name} submitted a report for "${a.title}".${peerLine}`,
      link: `/review/${submissionId}`,
    });

    res.status(201).json({
      id: submissionId,
      message: 'Report submitted.',
      peer_reviewers: peerAssign.reviewers || [],
      peer_reviewers_assigned: Number(peerAssign.created) || 0,
    });
  })
);

// GET /api/submissions/mine  (member submission history)
router.get(
  '/mine',
  requireRole('member'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT s.id, s.content, s.kind, s.is_late, s.submitted_at, t.title AS task_title,
              (SELECT COUNT(*) FROM submission_files f WHERE f.submission_id = s.id) AS file_count,
              (SELECT COUNT(*) FROM report_comments c WHERE c.submission_id = s.id AND c.deleted_at IS NULL) AS comment_count
       FROM submissions s JOIN tasks t ON t.id = s.task_id
       WHERE s.member_id = ? ORDER BY s.submitted_at DESC`,
      [req.user.id]
    );
    res.json({ submissions: rows });
  })
);

function classifyQueueStatus(row) {
  // New: fresh upload awaiting first supervisor decision.
  if (!row.assessed) return 'new';
  // Pending: reviewed but not fully approved (revision requested) and still open.
  if (row.revision_requested_at && row.assignment_status !== 'Completed') return 'pending';
  // Completed: approved / fully done — goes straight here after approve.
  return 'completed';
}

// GET /api/submissions/review  (supervisor review queue) -- SRS UC5
router.get(
  '/review',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    let ids = null;
    if (req.user.role === 'supervisor') {
      ids = await memberIdsForSupervisor(req.user.id);
      if (ids.length === 0) {
        return res.json({
          submissions: [],
          counts: { all: 0, new: 0, pending: 0, completed: 0 },
          pending: 0,
        });
      }
    }
    const where = ids ? `WHERE s.member_id IN (${ids.map(() => '?').join(',')})` : '';
    const [rows] = await pool.query(
      `SELECT s.id, s.kind, s.is_late, s.submitted_at, s.revision_requested_at, s.revision_of,
              t.title AS task_title, ta.status AS assignment_status,
              u.full_name AS member_name, u.avatar_color,
              (SELECT COUNT(*) FROM submission_files f WHERE f.submission_id = s.id) AS file_count,
              (SELECT COUNT(*) FROM report_comments c WHERE c.submission_id = s.id AND c.deleted_at IS NULL) AS comment_count,
              EXISTS(SELECT 1 FROM supervisor_assessments sa WHERE sa.submission_id = s.id) AS assessed,
              (SELECT COUNT(*) FROM peer_review_assignments pa WHERE pa.submission_id = s.id) AS peer_reviewer_count,
              (SELECT COUNT(*) FROM peer_review_assignments pa WHERE pa.submission_id = s.id AND pa.status = 'completed') AS peer_completed_count
       FROM submissions s
       JOIN tasks t ON t.id = s.task_id
       JOIN task_assignments ta ON ta.id = s.assignment_id
       JOIN users u ON u.id = s.member_id
       ${where}
       ORDER BY
         CASE
           WHEN NOT EXISTS(SELECT 1 FROM supervisor_assessments sa WHERE sa.submission_id = s.id) THEN 0
           WHEN s.revision_requested_at IS NOT NULL AND ta.status <> 'Completed' THEN 1
           ELSE 2
         END,
         COALESCE(s.revision_requested_at, s.submitted_at) DESC
       LIMIT 200`,
      ids || []
    );

    for (const row of rows) {
      row.queue_status = classifyQueueStatus(row);
      row.peer_reviewers = await getPeerReviewersForSubmission(row.id);
    }

    const counts = {
      all: rows.length,
      new: rows.filter((r) => r.queue_status === 'new').length,
      pending: rows.filter((r) => r.queue_status === 'pending').length,
      completed: rows.filter((r) => r.queue_status === 'completed').length,
    };
    // Nav / page badge: items that still need supervisor attention.
    const pending = counts.new + counts.pending;
    res.json({ submissions: rows, counts, pending });
  })
);

// GET /api/submissions/review-pending-count  (nav badge)
router.get(
  '/review-pending-count',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    let ids = null;
    if (req.user.role === 'supervisor') {
      ids = await memberIdsForSupervisor(req.user.id);
      if (ids.length === 0) return res.json({ pending: 0, new: 0, awaiting: 0 });
    }
    const scope = ids ? `AND s.member_id IN (${ids.map(() => '?').join(',')})` : '';
    const [[row]] = await pool.query(
      `SELECT
         SUM(CASE WHEN NOT EXISTS (
               SELECT 1 FROM supervisor_assessments sa WHERE sa.submission_id = s.id
             ) THEN 1 ELSE 0 END) AS new_count,
         SUM(CASE WHEN s.revision_requested_at IS NOT NULL
                   AND ta.status <> 'Completed'
                   AND EXISTS (
                     SELECT 1 FROM supervisor_assessments sa WHERE sa.submission_id = s.id
                   ) THEN 1 ELSE 0 END) AS pending_count
       FROM submissions s
       JOIN task_assignments ta ON ta.id = s.assignment_id
       WHERE 1=1 ${scope}`,
      ids || []
    );
    const newCount = Number(row?.new_count) || 0;
    const pendingCount = Number(row?.pending_count) || 0;
    res.json({
      new: newCount,
      awaiting: pendingCount,
      pending: newCount + pendingCount,
    });
  })
);

// GET /api/submissions/:id  (full detail)
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT s.*, t.title AS task_title, t.deadline, u.full_name AS member_name, u.avatar_color
       FROM submissions s JOIN tasks t ON t.id = s.task_id JOIN users u ON u.id = s.member_id WHERE s.id = ?`,
      [req.params.id]
    );
    if (!rows.length) throw new HttpError(404, 'Submission not found.');
    const sub = rows[0];

    if (req.user.role === 'member' && sub.member_id !== req.user.id) {
      const allowed = await canViewSubmissionForPeerReview(req.params.id, req.user.id);
      if (!allowed) throw new HttpError(403, 'Not allowed.');
    }
    if (req.user.role === 'supervisor') {
      const ids = await memberIdsForSupervisor(req.user.id);
      if (!ids.includes(sub.member_id)) throw new HttpError(403, 'Not in your scope.');
    }

    const [files] = await pool.execute(
      `SELECT id, original_name, mime_type, size_bytes FROM submission_files WHERE submission_id = ?`,
      [req.params.id]
    );
    const [comments] = await pool.execute(
      `SELECT c.id, c.body, c.created_at, c.edited_at, c.author_id, u.full_name AS author_name, u.avatar_color
       FROM report_comments c JOIN users u ON u.id = c.author_id
       WHERE c.submission_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    const [assessment] = await pool.execute(
      `SELECT quality_score, responsiveness_score, created_at FROM supervisor_assessments WHERE submission_id = ? ORDER BY created_at DESC LIMIT 1`,
      [req.params.id]
    );

    // Supervisors/admins see who was assigned to peer-review this submission.
    let peer_reviewers = [];
    if (req.user.role === 'supervisor' || req.user.role === 'admin') {
      peer_reviewers = await getPeerReviewersForSubmission(req.params.id);
    }

    res.json({
      submission: sub,
      files,
      comments,
      assessment: assessment[0] || null,
      peer_reviewers,
    });
  })
);

// GET /api/submissions/:id/files/:fileId  (download)
router.get(
  '/:id/files/:fileId',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT f.original_name, f.stored_name, f.mime_type, s.member_id
       FROM submission_files f JOIN submissions s ON s.id = f.submission_id
       WHERE f.id = ? AND f.submission_id = ?`,
      [req.params.fileId, req.params.id]
    );
    if (!rows.length) throw new HttpError(404, 'File not found.');
    const f = rows[0];
    if (req.user.role === 'member' && f.member_id !== req.user.id) {
      const allowed = await canViewSubmissionForPeerReview(req.params.id, req.user.id);
      if (!allowed) throw new HttpError(403, 'Not allowed.');
    }
    if (req.user.role === 'supervisor') {
      const ids = await memberIdsForSupervisor(req.user.id);
      if (!ids.includes(f.member_id)) throw new HttpError(403, 'Not in your scope.');
    }
    res.download(path.join(uploadRoot, f.stored_name), f.original_name);
  })
);

// POST /api/submissions/:id/comments  (supervisor feedback) -- SRS UC6
router.post(
  '/:id/comments',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    const { body } = req.body;
    if (!body || !body.trim()) throw new HttpError(400, 'Comment cannot be empty.');

    const [rows] = await pool.execute(`SELECT member_id, task_id FROM submissions WHERE id = ?`, [req.params.id]);
    if (!rows.length) throw new HttpError(404, 'Submission not found.');

    await pool.execute(
      `INSERT INTO report_comments (submission_id, author_id, body) VALUES (?, ?, ?)`,
      [req.params.id, req.user.id, body.trim()]
    );
    await logActivity(req.user.id, 'comment', { submissionId: req.params.id }, null);
    await notify(rows[0].member_id, {
      type: 'feedback',
      title: 'New feedback on your report',
      body: `${req.user.full_name} commented on your submission`,
      link: `/reports`,
    });
    res.status(201).json({ message: 'Feedback posted.' });
  })
);

// PATCH /api/submissions/comments/:commentId  (edit own comment)
router.patch(
  '/comments/:commentId',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    const { body } = req.body;
    if (!body || !body.trim()) throw new HttpError(400, 'Comment cannot be empty.');
    const [r] = await pool.execute(
      `UPDATE report_comments SET body = ?, edited_at = NOW() WHERE id = ? AND author_id = ?`,
      [body.trim(), req.params.commentId, req.user.id]
    );
    if (r.affectedRows === 0) throw new HttpError(403, 'You can only edit your own comments.');
    res.json({ message: 'Comment updated.' });
  })
);

// DELETE /api/submissions/comments/:commentId  (soft delete own comment)
router.delete(
  '/comments/:commentId',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    const [r] = await pool.execute(
      `UPDATE report_comments SET deleted_at = NOW() WHERE id = ? AND author_id = ?`,
      [req.params.commentId, req.user.id]
    );
    if (r.affectedRows === 0) throw new HttpError(403, 'You can only delete your own comments.');
    res.json({ message: 'Comment deleted.' });
  })
);

// POST /api/submissions/:id/assess  (quality score + request revision -> responsiveness)
router.post(
  '/:id/assess',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    const { quality_score, request_revision, mark_completed } = req.body;
    const quality = Number(quality_score);
    if (!(quality >= 0 && quality <= 5)) throw new HttpError(400, 'Quality score must be between 0 and 5.');

    const [rows] = await pool.execute(
      `SELECT s.member_id, s.assignment_id, s.revision_of, s.submitted_at, t.title
       FROM submissions s JOIN tasks t ON t.id = s.task_id WHERE s.id = ?`,
      [req.params.id]
    );
    if (!rows.length) throw new HttpError(404, 'Submission not found.');
    const sub = rows[0];

    // Responsiveness: if this submission is a revision, score by turnaround hours
    let responsiveness = null;
    if (sub.revision_of) {
      const [orig] = await pool.execute(`SELECT revision_requested_at FROM submissions WHERE id = ?`, [sub.revision_of]);
      if (orig.length && orig[0].revision_requested_at) {
        const hours = (new Date(sub.submitted_at) - new Date(orig[0].revision_requested_at)) / 36e5;
        responsiveness = hours <= 24 ? 5 : hours <= 48 ? 3 : 1; // SRS 4.2 responsiveness rules
      }
    }

    await pool.execute(
      `INSERT INTO supervisor_assessments (submission_id, member_id, supervisor_id, quality_score, responsiveness_score)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, sub.member_id, req.user.id, quality, responsiveness]
    );

    if (request_revision) {
      await pool.execute(`UPDATE submissions SET revision_requested_at = NOW() WHERE id = ?`, [req.params.id]);
      await pool.execute(`UPDATE task_assignments SET status = 'In Progress' WHERE id = ?`, [sub.assignment_id]);
      await notify(sub.member_id, {
        type: 'revision_requested',
        title: 'Revision requested',
        body: `Please revise your report for "${sub.title}"`,
        link: `/reports`,
      });
    } else if (mark_completed) {
      await pool.execute(
        `UPDATE task_assignments SET status = 'Completed', completed_at = COALESCE(completed_at, NOW()) WHERE id = ?`,
        [sub.assignment_id]
      );
    }

    res.status(201).json({ message: 'Assessment saved.' });
  })
);

export default router;
