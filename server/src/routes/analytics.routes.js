import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { getSettings } from '../services/settings.service.js';
import { computePerformanceForMember, computePerformanceForMembers } from '../services/performance.service.js';
import {
  computeEngagementForMember,
  computeEngagementForMembers,
  recomputeAllEngagement,
} from '../services/engagement.service.js';
import { recomputeAllPerformance } from '../services/performance.service.js';
import { markOverduePeerReviews } from '../services/peer-penalty.service.js';
import { memberIdsForSupervisor, teamIdsForSupervisor } from '../utils/scope.js';
import {
  listAssignmentsForScope,
  eligibleReviewerPool,
  retryMissingPeerAssignments,
} from '../services/peer-assignment.service.js';

const router = Router();
router.use(authenticate);

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

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

/**
 * Weekly component scores for many members across many weeks, in four queries.
 *
 * P1: this replaces `computeWeeklyForMember`, which issued four queries per
 * member per week — 20 members x 8 weeks was ~640 sequential round-trips against
 * a 10-connection pool for a single dashboard load. Latency grew linearly with
 * team size and a few concurrent supervisors saturated the pool.
 *
 * Returns a Map keyed `${memberId}:${weekIndex}`.
 */
async function computeWeeklyBatch(memberIds, weekStarts, settings) {
  const out = new Map();
  if (!memberIds.length || !weekStarts.length) return out;

  const ph = memberIds.map(() => '?').join(',');
  const rangeStart = weekStarts[0].startStr;
  const rangeEnd = weekStarts[weekStarts.length - 1].endStr;

  // Maps a timestamp onto its bucket, so one grouped query covers every week.
  const bucketOf = (value) => {
    if (!value) return -1;
    const t = new Date(String(value).replace(' ', 'T') + 'Z').getTime();
    for (let i = 0; i < weekStarts.length; i += 1) {
      if (t >= weekStarts[i].startMs && t < weekStarts[i].endMs) return i;
    }
    return -1;
  };

  const key = (memberId, week) => `${memberId}:${week}`;
  const bucket = (memberId, week) => {
    const k = key(memberId, week);
    if (!out.has(k)) {
      out.set(k, {
        completed: 0, onTime: 0, onTimeKnown: 0,
        prSum: 0, prN: 0, coSum: 0, coN: 0,
        qSum: 0, qN: 0, rSum: 0, rN: 0,
      });
    }
    return out.get(k);
  };

  const [tasks] = await pool.query(
    `SELECT member_id, completed_at, on_time
       FROM task_assignments
      WHERE member_id IN (${ph}) AND status = 'Completed'
        AND completed_at >= ? AND completed_at < ?`,
    [...memberIds, rangeStart, rangeEnd]
  );
  for (const row of tasks) {
    const w = bucketOf(row.completed_at);
    if (w < 0) continue;
    const b = bucket(row.member_id, w);
    b.completed += 1;
    // C3: count how many completions have a KNOWN on_time value, so "nobody was
    // on time" can be told apart from "we have no timeliness data".
    if (row.on_time !== null) {
      b.onTimeKnown += 1;
      if (Number(row.on_time) === 1) b.onTime += 1;
    }
  }

  const [assessments] = await pool.query(
    `SELECT assessee_id, kind, score, created_at
       FROM peer_assessments
      WHERE assessee_id IN (${ph}) AND created_at >= ? AND created_at < ?`,
    [...memberIds, rangeStart, rangeEnd]
  );
  for (const row of assessments) {
    const w = bucketOf(row.created_at);
    if (w < 0) continue;
    const b = bucket(row.assessee_id, w);
    if (row.kind === 'peer_review') { b.prSum += Number(row.score); b.prN += 1; }
    else { b.coSum += Number(row.score); b.coN += 1; }
  }

  const [supervisor] = await pool.query(
    `SELECT member_id, quality_score, responsiveness_score, created_at
       FROM supervisor_assessments
      WHERE member_id IN (${ph}) AND created_at >= ? AND created_at < ?`,
    [...memberIds, rangeStart, rangeEnd]
  );
  for (const row of supervisor) {
    const w = bucketOf(row.created_at);
    if (w < 0) continue;
    const b = bucket(row.member_id, w);
    b.qSum += Number(row.quality_score); b.qN += 1;
    if (row.responsiveness_score !== null) { b.rSum += Number(row.responsiveness_score); b.rN += 1; }
  }

  // Fold the raw counters into scores.
  const result = new Map();
  for (const memberId of memberIds) {
    for (let w = 0; w < weekStarts.length; w += 1) {
      const b = out.get(key(memberId, w)) || {
        completed: 0, onTime: 0, onTimeKnown: 0, prSum: 0, prN: 0,
        coSum: 0, coN: 0, qSum: 0, qN: 0, rSum: 0, rN: 0,
      };

      // C3: `timeliness || 0.5` was JavaScript falsy coalescing, not a null
      // check, so a week where the member completed work and NONE of it was on
      // time scored 0.5 — identical to "no data". The chart could not show a
      // member missing every deadline. With C2 fixed, on_time is populated on
      // both completion paths, so unknown is now genuinely rare.
      let factor;
      if (b.completed === 0) factor = 0;
      else if (b.onTimeKnown === 0) factor = 0.5;         // no timeliness data
      else factor = b.onTime / b.onTimeKnown;             // includes a true 0
      const tp = clamp01((Math.min(b.completed, 5) / 5) * factor);

      const prPart = b.prN > 0 ? ((b.prSum / b.prN) / 5) * 0.5 : 0;
      const coPart = b.coN > 0 ? ((b.coSum / b.coN) / 5) * 0.5 : 0;
      const pe = clamp01(prPart + coPart);

      const avgQ = b.qN > 0 ? b.qSum / b.qN : 0;
      const avgR = b.rN > 0 ? b.rSum / b.rN : avgQ;
      const sa = b.qN > 0 ? clamp01((avgQ + avgR) / 10) : 0;

      const hasAny = b.completed > 0 || b.prN > 0 || b.coN > 0 || b.qN > 0;
      const pi = hasAny
        ? clamp01(
            Number(settings.pi_weight_tp) * tp +
              Number(settings.pi_weight_pe) * pe +
              Number(settings.pi_weight_sa) * sa
          )
        : null;

      result.set(key(memberId, w), {
        tp: round4(tp),
        pe: round4(pe),
        sa: round4(sa),
        pi: pi == null ? null : round4(pi),
        completed: b.completed,
        peer_reviews: b.prN,
        collab_reviews: b.coN,
        assessments: b.qN,
        has_data: hasAny,
      });
    }
  }
  return result;
}

/** Week descriptors (Monday-start, UTC) for the last `weeks` weeks. */
function buildWeeks(weeks) {
  const thisWeek = weekStartUtc(new Date());
  const out = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = addDays(thisWeek, -7 * i);
    const end = addDays(start, 7);
    out.push({
      start,
      end,
      startStr: `${fmtYmd(start)} 00:00:00`,
      endStr: `${fmtYmd(end)} 00:00:00`,
      startMs: Date.parse(`${fmtYmd(start)}T00:00:00Z`),
      endMs: Date.parse(`${fmtYmd(end)}T00:00:00Z`),
    });
  }
  return out;
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

    // P1: two batched calls instead of ~11 sequential queries per member.
    const [perfMap, engMap] = await Promise.all([
      computePerformanceForMembers(memberIds, settings),
      computeEngagementForMembers(memberIds, settings),
    ]);
    const members = memberRows.map((m) => {
      const eng = engMap.get(Number(m.id));
      return {
        ...m,
        teams: teamMap.get(m.id) || [],
        performance: perfMap.get(Number(m.id)),
        engagement: eng,
        risk: riskColor(eng.status),
      };
    });

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

    // P1: four queries total, regardless of member count or week count.
    const weekDefs = buildWeeks(weeks);
    const batch = await computeWeeklyBatch(ids, weekDefs, settings);
    const series = weekDefs.map((wk, index) => {
      const memberWeeks = ids.map((id) => ({
        member_id: id,
        ...batch.get(`${id}:${index}`),
      }));
      const withData = memberWeeks.filter((m) => m.has_data);
      return {
        week_start: fmtYmd(wk.start),
        week_end: fmtYmd(addDays(wk.end, -1)),
        label: `W/c ${fmtYmd(wk.start).slice(5)}`,
        avg_pi: withData.length ? avg(withData.map((m) => m.pi).filter((v) => v != null)) : 0,
        avg_tp: withData.length ? avg(withData.map((m) => m.tp)) : 0,
        avg_pe: withData.length ? avg(withData.map((m) => m.pe)) : 0,
        avg_sa: withData.length ? avg(withData.map((m) => m.sa)) : 0,
        completed_tasks: memberWeeks.reduce((sum, m) => sum + m.completed, 0),
        active_members: withData.length,
        members: memberWeeks,
      };
    });

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
    if (ids.length === 0) return res.json({ alerts: [] });

    // P1: one batched computation plus one user lookup, rather than ~5 queries
    // per member followed by another query for each one that is flagged.
    const engMap = await computeEngagementForMembers(ids, settings);
    const flagged = ids.filter((id) => engMap.get(Number(id))?.status === 'at_risk');
    if (flagged.length === 0) return res.json({ alerts: [] });

    const [users] = await pool.query(
      `SELECT id, full_name, avatar_color, email FROM users WHERE id IN (${flagged.map(() => '?').join(',')})`,
      flagged
    );
    const alerts = users.map((u) => ({ ...u, engagement: engMap.get(Number(u.id)) }));
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
    const weekDefs = buildWeeks(8);
    const batch = await computeWeeklyBatch([id], weekDefs, settings);
    const weekly = weekDefs.map((wk, index) => {
      const w = batch.get(`${id}:${index}`);
      return {
        week_start: fmtYmd(wk.start),
        label: `W/c ${fmtYmd(wk.start).slice(5)}`,
        ...w,
        PI: w.pi == null ? 0 : Math.round(w.pi * 100),
        TP: Math.round(w.tp * 100),
        PE: Math.round(w.pe * 100),
        SA: Math.round(w.sa * 100),
      };
    });

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

// GET /api/analytics/trend/:id  (PI history from the nightly snapshots)
//
// P2: performance_scores was written every night and read by nothing, which
// invites the assumption that it is authoritative. It now backs the only view
// live recomputation cannot produce — how a member's PI moved over time.
router.get(
  '/trend/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (req.user.role === 'member' && id !== req.user.id) {
      throw new HttpError(403, 'You can only view your own trend.');
    }
    if (req.user.role === 'supervisor') {
      const ids = await memberIdsForSupervisor(req.user.id);
      if (!ids.includes(id)) throw new HttpError(403, 'Not in your scope.');
    }
    const days = Math.min(Math.max(Number(req.query.days) || 90, 7), 365);

    // One snapshot per day (the latest), so a manual recompute does not create
    // several points on the same date.
    const [snapshots] = await pool.query(
      `SELECT DATE(ps.computed_at) AS day, ps.tp, ps.pe, ps.sa, ps.pi, ps.timeliness, ps.penalty_applied
         FROM performance_scores ps
         JOIN (SELECT DATE(computed_at) d, MAX(computed_at) mx
                 FROM performance_scores
                WHERE member_id = ? AND computed_at > (NOW() - INTERVAL ? DAY)
                GROUP BY DATE(computed_at)) last
           ON last.mx = ps.computed_at
        WHERE ps.member_id = ?
        ORDER BY day ASC`,
      [id, days, id]
    );
    res.json({ member_id: id, days, snapshots });
  })
);

// GET /api/analytics/history/:taskId  (status timeline for one task)
//
// P2: task_status_history received a row on every transition and was likewise
// never read. It is the only record of how a task actually progressed.
router.get(
  '/history/:taskId',
  asyncHandler(async (req, res) => {
    const taskId = Number(req.params.taskId);
    const [[task]] = await pool.query(`SELECT id, created_by FROM tasks WHERE id = ?`, [taskId]);
    if (!task) throw new HttpError(404, 'Task not found.');

    if (req.user.role === 'member') {
      const [[mine]] = await pool.query(
        `SELECT id FROM task_assignments WHERE task_id = ? AND member_id = ? LIMIT 1`,
        [taskId, req.user.id]
      );
      if (!mine) throw new HttpError(403, 'You are not assigned to this task.');
    } else if (req.user.role === 'supervisor' && task.created_by !== req.user.id) {
      const ids = await memberIdsForSupervisor(req.user.id);
      const [assignees] = await pool.query(
        `SELECT member_id FROM task_assignments WHERE task_id = ?`,
        [taskId]
      );
      if (!assignees.some((a) => ids.includes(a.member_id))) throw new HttpError(403, 'Not in your scope.');
    }

    // member_id is denormalised onto the history row, so entries survive their
    // assignment being deleted and remain attributable.
    const [history] = await pool.query(
      `SELECT h.id, h.old_status, h.new_status, h.changed_at,
              h.member_id, u.full_name AS member_name, u.avatar_color,
              actor.full_name AS changed_by_name
         FROM task_status_history h
         LEFT JOIN users u ON u.id = h.member_id
         LEFT JOIN users actor ON actor.id = h.changed_by
        WHERE h.task_id = ?
        ORDER BY h.changed_at ASC, h.id ASC`,
      [taskId]
    );
    res.json({ task_id: taskId, history });
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
    const retried = await retryMissingPeerAssignments();
    const perf = await recomputeAllPerformance();
    const eng = await recomputeAllEngagement();
    res.json({
      message: 'Analytics recomputed.',
      missed_reviews_marked: overdue.marked,
      peer_assignments_repaired: retried.repaired,
      performance_members: perf,
      engagement: eng,
    });
  })
);

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round((arr.reduce((a, b) => a + Number(b), 0) / arr.length) * 10000) / 10000;
}

export default router;
