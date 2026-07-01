import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { getSettings } from '../services/settings.service.js';
import { computePerformanceForMember } from '../services/performance.service.js';
import { computeEngagementForMember, recomputeAllEngagement } from '../services/engagement.service.js';
import { recomputeAllPerformance } from '../services/performance.service.js';
import { markOverduePeerReviews } from '../services/peer-penalty.service.js';
import { memberIdsForSupervisor } from '../utils/scope.js';
import {
  listAssignmentsForScope,
  eligibleReviewerPool,
} from '../services/peer-assignment.service.js';

const router = Router();
router.use(authenticate);

function riskColor(engagementStatus) {
  // green = on track, amber = moderate, red = high risk
  return { on_track: 'green', moderate: 'amber', at_risk: 'red', insufficient_data: 'grey' }[engagementStatus] || 'grey';
}

// GET /api/analytics/overview  (supervisor dashboard) -- SRS UC7
router.get(
  '/overview',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    let memberRows;
    if (req.user.role === 'admin') {
      [memberRows] = await pool.query(`SELECT id, full_name, avatar_color, title FROM users WHERE role = 'member'`);
    } else {
      const ids = await memberIdsForSupervisor(req.user.id);
      if (ids.length === 0) return res.json({ members: [], cohort: null, weights: settings, generated_at: new Date() });
      [memberRows] = await pool.query(
        `SELECT id, full_name, avatar_color, title FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
    }

    const members = [];
    for (const m of memberRows) {
      const perf = await computePerformanceForMember(m.id, settings);
      const eng = await computeEngagementForMember(m.id, settings);
      members.push({
        ...m,
        performance: perf,
        engagement: eng,
        risk: riskColor(eng.status),
      });
    }

    const withData = members.filter((m) => m.performance);
    const cohort = withData.length
      ? {
          avg_pi: avg(withData.map((m) => m.performance.pi)),
          avg_tp: avg(withData.map((m) => m.performance.tp)),
          avg_pe: avg(withData.map((m) => m.performance.pe)),
          avg_sa: avg(withData.map((m) => m.performance.sa)),
          at_risk: members.filter((m) => m.engagement.status === 'at_risk').length,
          on_track: members.filter((m) => m.engagement.status === 'on_track').length,
        }
      : null;

    res.json({ members, cohort, weights: settings, generated_at: new Date() });
  })
);

// GET /api/analytics/at-risk
router.get(
  '/at-risk',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    let ids;
    if (req.user.role === 'admin') {
      const [r] = await pool.query(`SELECT id FROM users WHERE role = 'member'`);
      ids = r.map((x) => x.id);
    } else {
      ids = await memberIdsForSupervisor(req.user.id);
    }
    const alerts = [];
    for (const id of ids) {
      const eng = await computeEngagementForMember(id, settings);
      if (eng.status === 'at_risk') {
        const [[u]] = await pool.query(`SELECT id, full_name, avatar_color, email FROM users WHERE id = ?`, [id]);
        alerts.push({ ...u, engagement: eng });
      }
    }
    res.json({ alerts });
  })
);

// GET /api/analytics/member/:id  (responsiveness trend + breakdown)
router.get(
  '/member/:id',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (req.user.role === 'supervisor') {
      const ids = await memberIdsForSupervisor(req.user.id);
      if (!ids.includes(Number(id))) throw new HttpError(403, 'Not in your scope.');
    }
    const settings = await getSettings();
    const performance = await computePerformanceForMember(id, settings);
    const engagement = await computeEngagementForMember(id, settings);

    // Responsiveness trend from supervisor assessments over time
    const [trend] = await pool.query(
      `SELECT DATE(created_at) AS day, AVG(responsiveness_score) AS responsiveness, AVG(quality_score) AS quality
       FROM supervisor_assessments WHERE member_id = ? GROUP BY DATE(created_at) ORDER BY day ASC LIMIT 30`,
      [id]
    );
    // Full peer attribution (supervisor sees who rated whom)
    const [peers] = await pool.query(
      `SELECT pa.kind, pa.score, pa.comment, pa.vulgar_comment, pa.created_at, u.full_name AS assessor_name
       FROM peer_assessments pa JOIN users u ON u.id = pa.assessor_id
       WHERE pa.assessee_id = ? ORDER BY pa.created_at DESC`,
      [id]
    );
    res.json({ performance, engagement, trend, peers });
  })
);

// GET /api/analytics/peer-reviews  (team-wide peer review ledger, full attribution)
// Supervisors/admins can see who reviewed whom across their team. Members never
// see this — their own view (/peer/mine) stays anonymous.
router.get(
  '/peer-reviews',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    let ids;
    if (req.user.role === 'admin') {
      const [r] = await pool.query(`SELECT id FROM users WHERE role = 'member'`);
      ids = r.map((x) => x.id);
    } else {
      ids = await memberIdsForSupervisor(req.user.id);
    }
    if (ids.length === 0) return res.json({ reviews: [], members: [] });

    const ph = ids.map(() => '?').join(',');
    const [reviews] = await pool.query(
      `SELECT pa.id, pa.kind, pa.score, pa.comment, pa.vulgar_comment, pa.created_at, pa.submission_id,
              ar.id AS assessor_id, ar.full_name AS assessor_name, ar.avatar_color AS assessor_color,
              ae.id AS assessee_id, ae.full_name AS assessee_name, ae.avatar_color AS assessee_color,
              t.title AS task_title
         FROM peer_assessments pa
         JOIN users ar ON ar.id = pa.assessor_id
         JOIN users ae ON ae.id = pa.assessee_id
         LEFT JOIN submissions s ON s.id = pa.submission_id
         LEFT JOIN tasks t ON t.id = s.task_id
        WHERE pa.assessor_id IN (${ph}) OR pa.assessee_id IN (${ph})
        ORDER BY pa.created_at DESC`,
      [...ids, ...ids]
    );
    const [members] = await pool.query(
      `SELECT id, full_name FROM users WHERE id IN (${ph}) ORDER BY full_name`,
      ids
    );
    res.json({ reviews, members });
  })
);

// GET /api/analytics/peer-assignments  (supervisor: distribution + assignment ledger)
router.get(
  '/peer-assignments',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    let ids;
    if (req.user.role === 'admin') {
      const [r] = await pool.query(`SELECT id FROM users WHERE role = 'member'`);
      ids = r.map((x) => x.id);
    } else {
      ids = await memberIdsForSupervisor(req.user.id);
    }
    const poolMembers = await eligibleReviewerPool();
    const data = await listAssignmentsForScope(ids);
    res.json({ ...data, reviewees: ids.length, poolSize: poolMembers.length, maxReviewersPerSubmission: 3 });
  })
);

// GET /api/analytics/me  (member's own summary card)
router.get(
  '/me',
  requireRole('member'),
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const performance = await computePerformanceForMember(req.user.id, settings);
    const engagement = await computeEngagementForMember(req.user.id, settings);
    const [[tasks]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(status='Completed') AS completed FROM task_assignments WHERE member_id = ?`,
      [req.user.id]
    );
    res.json({ performance, engagement, tasks });
  })
);

// POST /api/analytics/recompute  (manual refresh)
router.post(
  '/recompute',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const overdue = await markOverduePeerReviews(settings);
    const perf = await recomputeAllPerformance();
    const eng = await recomputeAllEngagement();
    res.json({ message: 'Analytics recomputed.', missed_reviews_marked: overdue.marked, performance_members: perf, engagement: eng });
  })
);

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round((arr.reduce((a, b) => a + Number(b), 0) / arr.length) * 10000) / 10000;
}

export default router;
