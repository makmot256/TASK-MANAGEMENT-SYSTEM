import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { upload, uploadRoot } from '../middleware/upload.js';
import { notify, logActivity } from '../utils/notify.js';
import { memberIdsForSupervisor } from '../utils/scope.js';

const router = Router();
router.use(authenticate);

const WEEK_COUNT = 8;

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// Most recent Friday on or after today, then walk backwards.
function recentFridays(count = WEEK_COUNT) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  const day = d.getDay();
  const offset = day <= 5 ? 5 - day : 5 - day + 7;
  d.setDate(d.getDate() + offset);
  const fridays = [];
  for (let i = 0; i < count; i++) {
    const f = new Date(d);
    f.setDate(d.getDate() - i * 7);
    fridays.push(fmtDate(f));
  }
  return fridays;
}

function isFriday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.getDay() === 5;
}

function completionPercent(report) {
  if (!report) return 0;
  const fields = [
    report.tasks_completed,
    report.tasks_in_progress,
    report.next_week_tasks,
    report.problems_challenges,
  ];
  const filled = fields.filter((f) => f && String(f).trim()).length;
  if (filled === 0) return 0;
  if (filled === 4) return 100;
  return Math.round((filled / 4) * 90);
}

async function reportForMemberWeek(memberId, weekEnding) {
  const [rows] = await pool.execute(
    `SELECT wr.*, u.full_name AS supervisor_name
       FROM weekly_reports wr
       LEFT JOIN users u ON u.id = wr.supervisor_id
      WHERE wr.member_id = ? AND wr.week_ending = ?`,
    [memberId, weekEnding]
  );
  if (!rows.length) return null;
  const report = rows[0];
  const [files] = await pool.execute(
    `SELECT id, original_name, mime_type, size_bytes, uploaded_at
       FROM weekly_report_files WHERE report_id = ? ORDER BY uploaded_at`,
    [report.id]
  );
  return { report, files };
}

async function supervisorForMember(memberId) {
  const [rows] = await pool.execute(
    `SELECT ts.supervisor_id FROM team_members tm
       JOIN team_supervisors ts ON ts.team_id = tm.team_id
      WHERE tm.member_id = ? LIMIT 1`,
    [memberId]
  );
  return rows[0]?.supervisor_id || null;
}

// GET /api/weekly-reports/weeks  — sidebar progress list
router.get(
  '/weeks',
  requireRole('member'),
  asyncHandler(async (req, res) => {
    const fridays = recentFridays();
    const [existing] = await pool.query(
      `SELECT id, week_ending, tasks_completed, tasks_in_progress, next_week_tasks, problems_challenges
         FROM weekly_reports WHERE member_id = ? AND week_ending IN (${fridays.map(() => '?').join(',')})`,
      [req.user.id, ...fridays]
    );
    const byWeek = Object.fromEntries(existing.map((r) => [fmtDate(new Date(r.week_ending)), r]));

    const weeks = fridays.map((weekEnding, idx) => {
      const r = byWeek[weekEnding];
      const percent = completionPercent(r);
      return {
        week_number: fridays.length - idx,
        week_ending: weekEnding,
        report_id: r?.id || null,
        percent,
        action: r ? 'edit' : 'fill',
      };
    });

    res.json({ weeks });
  })
);

// GET /api/weekly-reports/week/:weekEnding
router.get(
  '/week/:weekEnding',
  asyncHandler(async (req, res) => {
    const weekEnding = req.params.weekEnding;
    if (!isFriday(weekEnding)) throw new HttpError(400, 'Week ending must be a Friday.');

    let memberId = req.user.id;
    if (req.user.role === 'supervisor' || req.user.role === 'admin') {
      memberId = Number(req.query.member_id) || req.user.id;
      if (req.user.role === 'supervisor') {
        const ids = await memberIdsForSupervisor(req.user.id);
        if (!ids.includes(memberId)) throw new HttpError(403, 'Not in your scope.');
      }
    } else if (req.user.role !== 'member') {
      throw new HttpError(403, 'Not allowed.');
    }

    const data = await reportForMemberWeek(memberId, weekEnding);
    res.json(data || { report: null, files: [] });
  })
);

// PUT /api/weekly-reports  — create or update weekly report (+ optional new files)
router.put(
  '/',
  requireRole('member'),
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    const {
      week_ending,
      tasks_completed,
      tasks_in_progress,
      next_week_tasks,
      problems_challenges,
    } = req.body;

    if (!week_ending) throw new HttpError(400, 'Week ending date is required.');
    if (!isFriday(week_ending)) throw new HttpError(400, 'Week ending must be a Friday.');

    const required = [
      ['Tasks completed', tasks_completed],
      ['Tasks in progress', tasks_in_progress],
      ["Next week's tasks", next_week_tasks],
      ['Problems / challenges', problems_challenges],
    ];
    for (const [label, val] of required) {
      if (!val || !String(val).trim()) throw new HttpError(400, `${label} is required.`);
    }

    const files = req.files || [];
    const [existing] = await pool.execute(
      `SELECT id FROM weekly_reports WHERE member_id = ? AND week_ending = ?`,
      [req.user.id, week_ending]
    );

    let reportId;
    if (existing.length) {
      reportId = existing[0].id;
      await pool.execute(
        `UPDATE weekly_reports SET tasks_completed = ?, tasks_in_progress = ?,
                next_week_tasks = ?, problems_challenges = ?, updated_at = NOW()
         WHERE id = ?`,
        [tasks_completed.trim(), tasks_in_progress.trim(), next_week_tasks.trim(), problems_challenges.trim(), reportId]
      );
    } else {
      const [r] = await pool.execute(
        `INSERT INTO weekly_reports (member_id, week_ending, tasks_completed, tasks_in_progress, next_week_tasks, problems_challenges)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.user.id, week_ending, tasks_completed.trim(), tasks_in_progress.trim(), next_week_tasks.trim(), problems_challenges.trim()]
      );
      reportId = r.insertId;
    }

    for (const f of files) {
      await pool.execute(
        `INSERT INTO weekly_report_files (report_id, original_name, stored_name, mime_type, size_bytes)
         VALUES (?, ?, ?, ?, ?)`,
        [reportId, f.originalname, f.filename, f.mimetype, f.size]
      );
    }

    const supId = await supervisorForMember(req.user.id);
    if (supId) {
      await notify(supId, {
        type: 'weekly_report',
        title: 'Weekly progress report submitted',
        body: `${req.user.full_name} submitted the report for week ending ${week_ending}`,
        link: '/review',
      });
    }
    await logActivity(req.user.id, 'submission', { type: 'weekly_report', reportId, week_ending }, null);

    const data = await reportForMemberWeek(req.user.id, week_ending);
    res.json({ message: existing.length ? 'Weekly report updated.' : 'Weekly report submitted.', ...data });
  })
);

// DELETE /api/weekly-reports/files/:fileId
router.delete(
  '/files/:fileId',
  requireRole('member'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT f.stored_name, wr.member_id FROM weekly_report_files f
         JOIN weekly_reports wr ON wr.id = f.report_id WHERE f.id = ?`,
      [req.params.fileId]
    );
    if (!rows.length) throw new HttpError(404, 'File not found.');
    if (rows[0].member_id !== req.user.id) throw new HttpError(403, 'Not allowed.');
    await pool.execute(`DELETE FROM weekly_report_files WHERE id = ?`, [req.params.fileId]);
    try { await fs.unlink(path.join(uploadRoot, rows[0].stored_name)); } catch { /* ignore */ }
    res.json({ message: 'File removed.' });
  })
);

// GET /api/weekly-reports/files/:fileId/download
router.get(
  '/files/:fileId/download',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT f.original_name, f.stored_name, wr.member_id
         FROM weekly_report_files f JOIN weekly_reports wr ON wr.id = f.report_id WHERE f.id = ?`,
      [req.params.fileId]
    );
    if (!rows.length) throw new HttpError(404, 'File not found.');
    const f = rows[0];
    if (req.user.role === 'member' && f.member_id !== req.user.id) throw new HttpError(403, 'Not allowed.');
    if (req.user.role === 'supervisor') {
      const ids = await memberIdsForSupervisor(req.user.id);
      if (!ids.includes(f.member_id)) throw new HttpError(403, 'Not in your scope.');
    }
    res.download(path.join(uploadRoot, f.stored_name), f.original_name);
  })
);

// PATCH /api/weekly-reports/:id/comment  — supervisor adds feedback on the report
router.patch(
  '/:id/comment',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    const { comment } = req.body;
    if (!comment || !comment.trim()) throw new HttpError(400, 'Comment cannot be empty.');

    const [rows] = await pool.execute(`SELECT member_id FROM weekly_reports WHERE id = ?`, [req.params.id]);
    if (!rows.length) throw new HttpError(404, 'Report not found.');
    if (req.user.role === 'supervisor') {
      const ids = await memberIdsForSupervisor(req.user.id);
      if (!ids.includes(rows[0].member_id)) throw new HttpError(403, 'Not in your scope.');
    }

    await pool.execute(
      `UPDATE weekly_reports SET supervisor_comment = ?, supervisor_id = ?, commented_at = NOW() WHERE id = ?`,
      [comment.trim(), req.user.id, req.params.id]
    );
    await notify(rows[0].member_id, {
      type: 'feedback',
      title: 'Supervisor commented on your weekly report',
      body: 'Open Weekly Progress Report to read the feedback.',
      link: '/weekly-report',
    });
    res.json({ message: 'Comment saved.' });
  })
);

export default router;
