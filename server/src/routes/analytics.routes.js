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
import { memberIdsForSupervisor, teamIdsForSupervisor } from '../utils/scope.js';
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

function weekStartUtc(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  x.setUTCDate(x.getUTCDate() + diff);
  return x;
}

function fmtYmd(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

async function scopedMemberIds(req) {
  if (req.user.role === 'admin') {
    const [r] = await pool.query(`SELECT id FROM users WHERE role = 'member' AND status = 'active'`);
    return r.map((x) => x.id);
  }
  return memberIdsForSupervisor(req.user.id);
}

async function scopedTeams(req) {
  if (req.user.role === 'admin') {
    const [rows] = await pool.query(`SELECT id, name FROM teams ORDER BY name`);
    return rows;
  }
  const ids = await teamIdsForSupervisor(req.user.id);
  if (!ids.length) return [];
  const [rows] = await pool.query(
    `SELECT id, name FROM teams WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name`,
    ids
  );
  return rows;
}

async function memberTeamMap(memberIds) {
  const map = new Map();
  if (!memberIds.length) return map;
  const [rows] = await pool.query(
    `SELECT tm.member_id, t.id AS team_id, t.name AS team_name
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE tm.member_id IN (${memberIds.map(() => '?').join(',')})
      ORDER BY t.name`,
    memberIds
  );
  for (const r of rows) {
    if (!map.has(r.member_id)) map.set(r.member_id, []);
    map.get(r.member_id).push({ id: r.team_id, name: r.team_name });
  }
  return map;
}

async function computeWeeklyForMember(memberId, weekStart, weekEnd, settings) {
  const [[taskAgg]] = await pool.query(
    `SELECT COUNT(*) AS completed,
            SUM(on_time = 1) AS on_time
       FROM task_assignments
      WHERE member_id = ?
        AND status = 'Completed'
        AND completed_at >= ? AND completed_at < ?`,
    [memberId, weekStart, weekEnd]
  );
  const completed = Number(taskAgg.completed) || 0;
  const onTime = Number(taskAgg.on_time) || 0;
  const timeliness = completed > 0 ? onTime / completed : 0;
  // Relative weekly TP: completion volume capped + timeliness
  const tp = Math.max(0, Math.min(1, (Math.min(completed, 5) / 5) * (completed ? timeliness || 0.5 : 0)));

  const [[pr]] = await pool.query(
    `SELECT COALESCE(AVG(score), 0) AS avg_score, COUNT(*) AS n
       FROM peer_assessments
      WHERE assessee_id = ? AND kind = 'peer_review'
        AND created_at >= ? AND created_at < ?`,
    [memberId, weekStart, weekEnd]
  );
  const [[co]] = await pool.query(
    `SELECT COALESCE(AVG(score), 0) AS avg_score, COUNT(*) AS n
       FROM peer_assessments
      WHERE assessee_id = ? AND kind = 'collaboration'
        AND created_at >= ? AND created_at < ?`,
    [memberId, weekStart, weekEnd]
  );
  const prPart = Number(pr.n) > 0 ? (Number(pr.avg_score) / 5) * 0.5 : 0;
  const coPart = Number(co.n) > 0 ? (Number(co.avg_score) / 5) * 0.5 : 0;
  const pe = Math.max(0, Math.min(1, prPart + coPart));

  const [[sa]] = await pool.query(
    `SELECT AVG(quality_score) AS q, AVG(responsiveness_score) AS r, COUNT(*) AS n
       FROM supervisor_assessments
      WHERE member_id = ?
        AND created_at >= ? AND created_at < ?`,
    [memberId, weekStart, weekEnd]
  );
  const saScore =
    Number(sa.n) > 0
      ? Math.max(0, Math.min(1, ((Number(sa.q) || 0) + (Number(sa.r) || Number(sa.q) || 0)) / 10))
      : 0;

  const hasAny = completed > 0 || Number(pr.n) > 0 || Number(co.n) > 0 || Number(sa.n) > 0;
  const pi = hasAny
    ? Math.max(
        0,
        Math.min(
          1,
          Number(settings.pi_weight_tp) * tp +
            Number(settings.pi_weight_pe) * pe +
            Number(settings.pi_weight_sa) * saScore
        )
      )
    : null;

  return {
    tp: Math.round(tp * 10000) / 10000,
    pe: Math.round(pe * 10000) / 10000,
    sa: Math.round(saScore * 10000) / 10000,
    pi: pi == null ? null : Math.round(pi * 10000) / 10000,
    completed,
    peer_reviews: Number(pr.n) || 0,
    collab_reviews: Number(co.n) || 0,
    assessments: Number(sa.n) || 0,
    has_data: hasAny,
  };
}

// GET /api/analytics/overview  (supervisor dashboard) -- SRS UC7
router.get(
  '/overview',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const memberIds = await scopedMemberIds(req);
    if (memberIds.length === 0) {
      return res.json({
        members: [],
        teams: [],
        cohort: null,
        weights: settings,
        generated_at: new Date(),
      });
    }

    const [memberRows] = await pool.query(
      `SELECT id, full_name, avatar_color, title FROM users WHERE id IN (${memberIds.map(() => '?').join(',')})`,
      memberIds
    );
    const teamsMeta = await scopedTeams(req);
    const teamMap = await memberTeamMap(memberIds);

    const members = [];
    for (const m of memberRows) {
      const perf = await computePerformanceForMember(m.id, settings);
      const eng = await computeEngagementForMember(m.id, settings);
      members.push({
        ...m,
        teams: teamMap.get(m.id) || [],
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

    const teams = teamsMeta.map((t) => {
      const teamMembers = members.filter((m) => m.teams.some((x) => x.id === t.id));
      const withPerf = teamMembers.filter((m) => m.performance);
      return {
        id: t.id,
        name: t.name,
        member_count: teamMembers.length,
        members: teamMembers.map((m) => ({
          id: m.id,
          full_name: m.full_name,
          avatar_color: m.avatar_color,
          risk: m.risk,
          performance: m.performance,
          engagement: m.engagement,
        })),
        averages: withPerf.length
          ? {
              avg_pi: avg(withPerf.map((m) => m.performance.pi)),
              avg_tp: avg(withPerf.map((m) => m.performance.tp)),
              avg_pe: avg(withPerf.map((m) => m.performance.pe)),
              avg_sa: avg(withPerf.map((m) => m.performance.sa)),
              at_risk: teamMembers.filter((m) => m.risk === 'red').length,
            }
          : null,
      };
    });

    res.json({ members, teams, cohort, weights: settings, generated_at: new Date() });
  })
);

// GET /api/analytics/weekly?weeks=8&teamId=&memberId=
router.get(
  '/weekly',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const weeks = Math.min(Math.max(Number(req.query.weeks) || 8, 4), 16);
    const teamId = req.query.teamId ? Number(req.query.teamId) : null;
    const memberId = req.query.memberId ? Number(req.query.memberId) : null;

    let ids = await scopedMemberIds(req);
    if (memberId) {
      if (!ids.includes(memberId)) throw new HttpError(403, 'Not in your scope.');
      ids = [memberId];
    } else if (teamId) {
      const teams = await scopedTeams(req);
      if (!teams.some((t) => t.id === teamId)) throw new HttpError(403, 'Team not in your scope.');
      const [rows] = await pool.query(
        `SELECT member_id AS id FROM team_members WHERE team_id = ?`,
        [teamId]
      );
      const teamMemberIds = new Set(rows.map((r) => r.id));
      ids = ids.filter((id) => teamMemberIds.has(id));
    }

    const now = new Date();
    const thisWeek = weekStartUtc(now);
    const series = [];

    for (let i = weeks - 1; i >= 0; i -= 1) {
      const start = addDays(thisWeek, -7 * i);
      const end = addDays(start, 7);
      const startStr = `${fmtYmd(start)} 00:00:00`;
      const endStr = `${fmtYmd(end)} 00:00:00`;

      const memberWeeks = [];
      for (const id of ids) {
        const w = await computeWeeklyForMember(id, startStr, endStr, settings);
        memberWeeks.push({ member_id: id, ...w });
      }
      const withData = memberWeeks.filter((m) => m.has_data);
      series.push({
        week_start: fmtYmd(start),
        week_end: fmtYmd(addDays(end, -1)),
        label: `W/c ${fmtYmd(start).slice(5)}`,
        avg_pi: withData.length ? avg(withData.map((m) => m.pi).filter((v) => v != null)) : 0,
        avg_tp: withData.length ? avg(withData.map((m) => m.tp)) : 0,
        avg_pe: withData.length ? avg(withData.map((m) => m.pe)) : 0,
        avg_sa: withData.length ? avg(withData.map((m) => m.sa)) : 0,
        completed_tasks: memberWeeks.reduce((s, m) => s + m.completed, 0),
        active_members: withData.length,
        members: memberWeeks,
      });
    }

    res.json({
      weeks,
      team_id: teamId,
      member_id: memberId,
      series,
      generated_at: new Date(),
    });
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
    const id = Number(req.params.id);
    if (req.user.role === 'supervisor') {
      const ids = await memberIdsForSupervisor(req.user.id);
      if (!ids.includes(id)) throw new HttpError(403, 'Not in your scope.');
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

    // Weekly progress (last 8 weeks)
    const weeks = 8;
    const thisWeek = weekStartUtc(new Date());
    const weekly = [];
    for (let i = weeks - 1; i >= 0; i -= 1) {
      const start = addDays(thisWeek, -7 * i);
      const end = addDays(start, 7);
      const w = await computeWeeklyForMember(
        id,
        `${fmtYmd(start)} 00:00:00`,
        `${fmtYmd(end)} 00:00:00`,
        settings
      );
      weekly.push({
        week_start: fmtYmd(start),
        label: `W/c ${fmtYmd(start).slice(5)}`,
        ...w,
        PI: w.pi == null ? 0 : Math.round(w.pi * 100),
        TP: Math.round(w.tp * 100),
        PE: Math.round(w.pe * 100),
        SA: Math.round(w.sa * 100),
      });
    }

    const teamMap = await memberTeamMap([id]);
    res.json({
      performance,
      engagement,
      trend,
      peers,
      weekly,
      teams: teamMap.get(id) || [],
    });
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
