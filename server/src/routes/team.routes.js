import { Router } from 'express';
import { pool } from '../config/db.js';
import { teamIdsForSupervisor } from '../utils/scope.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error.js';

const router = Router();
router.use(authenticate);

// Team ids the current user can access (member belongs to / supervisor owns / admin = all).
async function myTeamIds(user) {
  if (user.role === 'admin') {
    const [rows] = await pool.execute(`SELECT id FROM teams`);
    return rows.map((r) => r.id);
  }
  if (user.role === 'supervisor') {
    return teamIdsForSupervisor(user.id);
  }
  const [rows] = await pool.execute(`SELECT team_id AS id FROM team_members WHERE member_id = ?`, [user.id]);
  return rows.map((r) => r.id);
}

async function canAccessTeam(user, teamId) {
  const ids = await myTeamIds(user);
  return ids.includes(Number(teamId));
}

// GET /api/team/overview  - the current user's teams with each member's progress.
router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const teamIds = await myTeamIds(req.user);
    if (teamIds.length === 0) return res.json({ teams: [] });

    const ph = teamIds.map(() => '?').join(',');
    const [teams] = await pool.query(
      `SELECT t.id, t.name, t.description,
              (SELECT GROUP_CONCAT(u.full_name ORDER BY u.full_name SEPARATOR ', ')
                 FROM team_supervisors ts JOIN users u ON u.id = ts.supervisor_id
                WHERE ts.team_id = t.id) AS supervisor_names
         FROM teams t
        WHERE t.id IN (${ph}) ORDER BY t.name`,
      teamIds
    );

    const [memberRows] = await pool.query(
      `SELECT tm.team_id, u.id, u.full_name, u.avatar_color, u.title
         FROM team_members tm JOIN users u ON u.id = tm.member_id
        WHERE tm.team_id IN (${ph}) ORDER BY u.full_name`,
      teamIds
    );

    const memberIds = [...new Set(memberRows.map((m) => m.id))];
    let stats = {};
    let engagement = {};
    if (memberIds.length) {
      const mph = memberIds.map(() => '?').join(',');
      const [statRows] = await pool.query(
        `SELECT ta.member_id AS id,
                COUNT(*) AS total,
                SUM(ta.status = 'Completed') AS completed,
                SUM(ta.status = 'In Progress') AS in_progress,
                SUM(ta.status = 'Under Review') AS under_review,
                SUM(ta.status = 'To-Do') AS todo,
                SUM(ta.completed_at IS NOT NULL) AS finished,
                SUM(ta.on_time = 1) AS on_time
           FROM task_assignments ta
          WHERE ta.member_id IN (${mph})
          GROUP BY ta.member_id`,
        memberIds
      );
      stats = Object.fromEntries(statRows.map((r) => [r.id, r]));

      const [engRows] = await pool.query(
        `SELECT es.member_id AS id, es.score, es.status
           FROM engagement_scores es
           JOIN (SELECT member_id, MAX(computed_at) mx FROM engagement_scores
                  WHERE member_id IN (${mph}) GROUP BY member_id) last
             ON last.member_id = es.member_id AND last.mx = es.computed_at`,
        memberIds
      );
      engagement = Object.fromEntries(engRows.map((r) => [r.id, r]));
    }

    const result = teams.map((t) => ({
      ...t,
      members: memberRows
        .filter((m) => m.team_id === t.id)
        .map((m) => {
          const s = stats[m.id] || {};
          const total = Number(s.total || 0);
          const completed = Number(s.completed || 0);
          const finished = Number(s.finished || 0);
          const onTime = Number(s.on_time || 0);
          const eng = engagement[m.id];
          return {
            id: m.id,
            full_name: m.full_name,
            avatar_color: m.avatar_color,
            title: m.title,
            is_me: m.id === req.user.id,
            total_tasks: total,
            completed,
            in_progress: Number(s.in_progress || 0),
            under_review: Number(s.under_review || 0),
            todo: Number(s.todo || 0),
            completion_rate: total ? Math.round((completed / total) * 100) : 0,
            on_time_rate: finished ? Math.round((onTime / finished) * 100) : null,
            engagement_score: eng?.score != null ? Number(eng.score) : null,
            engagement_status: eng?.status || null,
          };
        }),
    }));

    res.json({ teams: result });
  })
);

// GET /api/team/:teamId/messages?after=<id>  - team chat history (or new since `after`).
router.get(
  '/:teamId/messages',
  asyncHandler(async (req, res) => {
    if (!(await canAccessTeam(req.user, req.params.teamId))) throw new HttpError(403, 'Not your team.');
    const after = Number(req.query.after || 0);
    const [rows] = await pool.query(
      `SELECT m.id, m.body, m.created_at, m.sender_id,
              u.full_name AS sender_name, u.avatar_color AS sender_color
         FROM team_messages m JOIN users u ON u.id = m.sender_id
        WHERE m.team_id = ? AND m.id > ?
        ORDER BY m.id ASC
        LIMIT 200`,
      [req.params.teamId, after]
    );
    res.json({ messages: rows });
  })
);

// POST /api/team/:teamId/messages  - send a chat message to the team.
router.post(
  '/:teamId/messages',
  asyncHandler(async (req, res) => {
    if (!(await canAccessTeam(req.user, req.params.teamId))) throw new HttpError(403, 'Not your team.');
    const body = (req.body.body || '').trim();
    if (!body) throw new HttpError(400, 'Message cannot be empty.');
    if (body.length > 2000) throw new HttpError(400, 'Message is too long.');

    const [r] = await pool.execute(
      `INSERT INTO team_messages (team_id, sender_id, body) VALUES (?, ?, ?)`,
      [req.params.teamId, req.user.id, body]
    );

    const [rows] = await pool.execute(
      `SELECT m.id, m.body, m.created_at, m.sender_id,
              u.full_name AS sender_name, u.avatar_color AS sender_color
         FROM team_messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`,
      [r.insertId]
    );
    res.status(201).json({ message: rows[0] });
  })
);

export default router;
