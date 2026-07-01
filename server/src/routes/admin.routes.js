import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { hashPassword, isStrongPassword } from '../utils/password.js';
import { sendMail } from '../utils/mailer.js';
import { notify } from '../utils/notify.js';

const router = Router();
router.use(authenticate, requireRole('admin'));

const PALETTE = ['#2563eb', '#7c3aed', '#0d9488', '#db2777', '#ea580c', '#16a34a', '#dc2626', '#0891b2'];

async function normalizeSupervisorIds(supervisorIds) {
  const ids = [...new Set((supervisorIds || []).map(Number).filter(Boolean))];
  if (ids.length < 1) throw new HttpError(400, 'Each team must have at least one supervisor.');
  const ph = ids.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT id FROM users WHERE id IN (${ph}) AND role = 'supervisor' AND status = 'active'`,
    ids
  );
  if (rows.length !== ids.length) throw new HttpError(400, 'All supervisors must be active supervisor accounts.');
  return ids;
}

async function setTeamSupervisors(teamId, supervisorIds) {
  const ids = await normalizeSupervisorIds(supervisorIds);
  await pool.execute(`DELETE FROM team_supervisors WHERE team_id = ?`, [teamId]);
  for (const sid of ids) {
    await pool.execute(`INSERT INTO team_supervisors (team_id, supervisor_id) VALUES (?, ?)`, [teamId, sid]);
  }
}

async function setSupervisorTeams(supervisorId, teamIds) {
  const ids = [...new Set((teamIds || []).map(Number).filter(Boolean))];
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const [rows] = await pool.execute(`SELECT id FROM teams WHERE id IN (${ph})`, ids);
    if (rows.length !== ids.length) throw new HttpError(400, 'One or more team IDs are invalid.');
  }
  await pool.execute(`DELETE FROM team_supervisors WHERE supervisor_id = ?`, [supervisorId]);
  for (const tid of ids) {
    await pool.execute(`INSERT INTO team_supervisors (team_id, supervisor_id) VALUES (?, ?)`, [tid, supervisorId]);
  }
}

async function setMemberTeams(memberId, teamIds) {
  const ids = [...new Set((teamIds || []).map(Number).filter(Boolean))];
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const [rows] = await pool.execute(`SELECT id FROM teams WHERE id IN (${ph})`, ids);
    if (rows.length !== ids.length) throw new HttpError(400, 'One or more team IDs are invalid.');
  }
  await pool.execute(`DELETE FROM team_members WHERE member_id = ?`, [memberId]);
  for (const tid of ids) {
    await pool.execute(`INSERT INTO team_members (team_id, member_id) VALUES (?, ?)`, [tid, memberId]);
  }
}

// ---- Users -----------------------------------------------------------------

// GET /api/admin/users
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { role, q } = req.query;
    const where = [];
    const params = [];
    if (role) { where.push('u.role = ?'); params.push(role); }
    if (q) { where.push('(u.full_name LIKE ? OR u.email LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.execute(
      `SELECT u.id, u.full_name, u.email, u.role, u.phone, u.title, u.status, u.avatar_color,
              u.last_login_at, u.created_at,
              (SELECT GROUP_CONCAT(DISTINCT t.name ORDER BY t.name SEPARATOR ', ') FROM team_members tm
                 JOIN teams t ON t.id = tm.team_id WHERE tm.member_id = u.id) AS teams,
              (SELECT GROUP_CONCAT(DISTINCT t.name ORDER BY t.name SEPARATOR ', ') FROM team_supervisors ts
                 JOIN teams t ON t.id = ts.team_id WHERE ts.supervisor_id = u.id) AS supervised_teams
       FROM users u ${clause} ORDER BY u.created_at DESC`,
      params
    );
    res.json({ users: rows });
  })
);

// POST /api/admin/users  (provision supervisor or member)
router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const { full_name, email, role, password, phone, title } = req.body;
    if (!full_name || !email || !role) throw new HttpError(400, 'Full name, email and role are required.');
    if (!['admin', 'supervisor', 'member'].includes(role)) throw new HttpError(400, 'Invalid role.');
    if (!isStrongPassword(password))
      throw new HttpError(400, 'Password must be at least 8 characters and include a letter and a number.');

    const [exists] = await pool.execute(`SELECT id FROM users WHERE email = ?`, [email]);
    if (exists.length) throw new HttpError(409, 'A user with that email already exists.');

    const hash = await hashPassword(password);
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const [result] = await pool.execute(
      `INSERT INTO users (full_name, email, password_hash, role, phone, title, avatar_color, status, created_by, must_reset)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, 1)`,
      [full_name, email, hash, role, phone || null, title || null, color, req.user.id]
    );

    await sendMail({
      to: email,
      subject: 'Your Task Management System account is ready',
      text: `Hi ${full_name},\n\nAn account has been created for you (role: ${role}).\nSign in with your email and the temporary password provided by your administrator, then change it.\n`,
    });

    res.status(201).json({ id: result.insertId, message: 'User created successfully.' });
  })
);

// PATCH /api/admin/users/:id
router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const { full_name, role, phone, title, status } = req.body;
    const fields = [];
    const params = [];
    if (full_name !== undefined) { fields.push('full_name = ?'); params.push(full_name); }
    if (role !== undefined) { fields.push('role = ?'); params.push(role); }
    if (phone !== undefined) { fields.push('phone = ?'); params.push(phone); }
    if (title !== undefined) { fields.push('title = ?'); params.push(title); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    if (!fields.length) throw new HttpError(400, 'Nothing to update.');
    params.push(req.params.id);
    await pool.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ message: 'User updated.' });
  })
);

// POST /api/admin/users/:id/reset-password  (admin sets a new temp password)
router.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { password } = req.body;
    if (!isStrongPassword(password)) throw new HttpError(400, 'Password must be at least 8 characters and include a letter and a number.');
    const hash = await hashPassword(password);
    await pool.execute(`UPDATE users SET password_hash = ?, must_reset = 1 WHERE id = ?`, [hash, req.params.id]);
    res.json({ message: 'Password reset. The user must change it on next login.' });
  })
);

// DELETE /api/admin/users/:id
router.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    if (Number(req.params.id) === req.user.id) throw new HttpError(400, 'You cannot delete your own account.');
    await pool.execute(`DELETE FROM users WHERE id = ?`, [req.params.id]);
    res.json({ message: 'User deleted.' });
  })
);

// ---- Teams -----------------------------------------------------------------

router.get(
  '/teams',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT t.id, t.name, t.description, t.created_at, t.updated_at
       FROM teams t ORDER BY t.created_at DESC`
    );
    const [supRows] = await pool.execute(
      `SELECT ts.team_id, u.id, u.full_name, u.avatar_color
         FROM team_supervisors ts
         JOIN users u ON u.id = ts.supervisor_id
        ORDER BY u.full_name`
    );
    const [memRows] = await pool.execute(
      `SELECT tm.team_id, u.id, u.full_name, u.avatar_color
         FROM team_members tm
         JOIN users u ON u.id = tm.member_id
        ORDER BY u.full_name`
    );
    const teams = rows.map((r) => {
      const supervisors = supRows.filter((s) => s.team_id === r.id);
      const members = memRows.filter((m) => m.team_id === r.id);
      return {
        ...r,
        member_count: members.length,
        supervisor_ids: supervisors.map((s) => s.id),
        supervisor_names: supervisors.map((s) => s.full_name).join(', ') || null,
        member_names: members.map((m) => m.full_name).join(', ') || null,
        supervisors,
        members,
      };
    });
    res.json({ teams });
  })
);

router.post(
  '/teams',
  asyncHandler(async (req, res) => {
    const { name, description, supervisor_ids } = req.body;
    if (!name) throw new HttpError(400, 'Team name is required.');
    const [result] = await pool.execute(
      `INSERT INTO teams (name, description) VALUES (?, ?)`,
      [name, description || null]
    );
    await setTeamSupervisors(result.insertId, supervisor_ids);
    res.status(201).json({ id: result.insertId, message: 'Team created.' });
  })
);

router.patch(
  '/teams/:id',
  asyncHandler(async (req, res) => {
    const { name, description, supervisor_ids } = req.body;
    await pool.execute(
      `UPDATE teams SET name = COALESCE(?, name), description = ? WHERE id = ?`,
      [name || null, description ?? null, req.params.id]
    );
    if (supervisor_ids !== undefined) await setTeamSupervisors(req.params.id, supervisor_ids);
    res.json({ message: 'Team updated.' });
  })
);

router.delete(
  '/teams/:id',
  asyncHandler(async (req, res) => {
    await pool.execute(`DELETE FROM teams WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Team deleted.' });
  })
);

router.get(
  '/teams/:id/members',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT u.id, u.full_name, u.email, u.avatar_color FROM team_members tm
       JOIN users u ON u.id = tm.member_id WHERE tm.team_id = ?`,
      [req.params.id]
    );
    res.json({ members: rows });
  })
);

router.post(
  '/teams/:id/members',
  asyncHandler(async (req, res) => {
    const { member_id } = req.body;
    await pool.execute(
      `INSERT IGNORE INTO team_members (team_id, member_id) VALUES (?, ?)`,
      [req.params.id, member_id]
    );
    res.json({ message: 'Member added to team.' });
  })
);

router.delete(
  '/teams/:id/members/:memberId',
  asyncHandler(async (req, res) => {
    await pool.execute(`DELETE FROM team_members WHERE team_id = ? AND member_id = ?`, [req.params.id, req.params.memberId]);
    res.json({ message: 'Member removed from team.' });
  })
);

router.get(
  '/users/:id/teams',
  asyncHandler(async (req, res) => {
    const [[user]] = await pool.query(`SELECT id, role FROM users WHERE id = ?`, [req.params.id]);
    if (!user) throw new HttpError(404, 'User not found.');
    if (user.role === 'member') {
      const [rows] = await pool.execute(
        `SELECT t.id, t.name FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.member_id = ? ORDER BY t.name`,
        [req.params.id]
      );
      return res.json({ team_ids: rows.map((r) => r.id), teams: rows });
    }
    if (user.role === 'supervisor') {
      const [rows] = await pool.execute(
        `SELECT t.id, t.name FROM team_supervisors ts JOIN teams t ON t.id = ts.team_id WHERE ts.supervisor_id = ? ORDER BY t.name`,
        [req.params.id]
      );
      return res.json({ team_ids: rows.map((r) => r.id), teams: rows });
    }
    res.json({ team_ids: [], teams: [] });
  })
);

router.put(
  '/users/:id/teams',
  asyncHandler(async (req, res) => {
    const [[user]] = await pool.query(`SELECT id, role FROM users WHERE id = ?`, [req.params.id]);
    if (!user) throw new HttpError(404, 'User not found.');
    if (user.role === 'member') {
      await setMemberTeams(user.id, req.body.team_ids);
      return res.json({ message: 'Member team memberships updated.' });
    }
    if (user.role === 'supervisor') {
      await setSupervisorTeams(user.id, req.body.team_ids);
      return res.json({ message: 'Supervisor team assignments updated.' });
    }
    throw new HttpError(400, 'Only members and supervisors have team assignments.');
  })
);

// ---- System settings -------------------------------------------------------

router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(`SELECT setting_key, setting_value, description FROM system_settings ORDER BY setting_key`);
    res.json({ settings: rows });
  })
);

router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const updates = req.body.settings || {};
    for (const [key, value] of Object.entries(updates)) {
      await pool.execute(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, String(value)]
      );
    }
    res.json({ message: 'Settings saved.' });
  })
);

// ---- Audit & health --------------------------------------------------------

router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT la.*, u.full_name FROM login_audit la LEFT JOIN users u ON u.id = la.user_id
       ORDER BY la.created_at DESC LIMIT 100`
    );
    res.json({ audit: rows });
  })
);

router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const tables = ['users', 'tasks', 'task_assignments', 'submissions', 'report_comments', 'notifications', 'activity_logs'];
    const counts = {};
    for (const t of tables) {
      const [r] = await pool.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
      counts[t] = r[0].c;
    }
    const [byRole] = await pool.execute(`SELECT role, COUNT(*) AS c FROM users GROUP BY role`);
    const [recentLogins] = await pool.execute(
      `SELECT COUNT(*) AS c FROM login_audit WHERE success = 1 AND created_at > (NOW() - INTERVAL 1 DAY)`
    );
    const [failed] = await pool.execute(
      `SELECT COUNT(*) AS c FROM login_audit WHERE success = 0 AND created_at > (NOW() - INTERVAL 1 DAY)`
    );
    res.json({
      status: 'ok',
      uptime_seconds: Math.round(process.uptime()),
      db: 'connected',
      counts,
      users_by_role: byRole,
      logins_24h: recentLogins[0].c,
      failed_logins_24h: failed[0].c,
    });
  })
);

export default router;
