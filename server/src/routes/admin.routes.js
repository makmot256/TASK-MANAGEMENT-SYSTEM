import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { hashPassword, checkPasswordStrength } from '../utils/password.js';
import { sendMail } from '../utils/mailer.js';
import { notify } from '../utils/notify.js';
import { getSettings } from '../services/settings.service.js';

const router = Router();
router.use(authenticate, requireRole('admin'));

const PALETTE = ['#2563eb', '#7c3aed', '#0d9488', '#db2777', '#ea580c', '#16a34a', '#dc2626', '#0891b2'];

// R3: these mirror the column ENUMs. Passing an unlisted value used to reach
// MySQL and surface as a 500 with a database message.
const ROLES = ['admin', 'supervisor', 'member'];
const STATUSES = ['active', 'inactive', 'pending'];

// S11: the system must always retain a way in. Nothing previously stopped the
// only administrator demoting or deactivating themselves, which left no recovery
// path short of direct SQL.
async function assertNotLastAdmin(targetId, { role, status } = {}) {
  const [[target]] = await pool.query(`SELECT id, role, status FROM users WHERE id = ?`, [targetId]);
  if (!target || target.role !== 'admin' || target.status !== 'active') return;

  const losingAdmin =
    (role !== undefined && role !== 'admin') ||
    (status !== undefined && status !== 'active') ||
    (role === undefined && status === undefined); // deletion
  if (!losingAdmin) return;

  const [[{ c }]] = await pool.query(
    `SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'`
  );
  if (Number(c) <= 1) {
    throw new HttpError(
      400,
      'This is the last active administrator. Promote another administrator first.'
    );
  }
}

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
    if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role.');
    const weak = checkPasswordStrength(password, email);
    if (weak) throw new HttpError(400, weak);

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

    // R3: validate against the enums before the value can reach MySQL.
    if (role !== undefined && !ROLES.includes(role)) {
      throw new HttpError(400, `Invalid role. Expected one of: ${ROLES.join(', ')}.`);
    }
    if (status !== undefined && !STATUSES.includes(status)) {
      throw new HttpError(400, `Invalid status. Expected one of: ${STATUSES.join(', ')}.`);
    }
    await assertNotLastAdmin(req.params.id, { role, status });

    const fields = [];
    const params = [];
    if (full_name !== undefined) { fields.push('full_name = ?'); params.push(full_name); }
    if (role !== undefined) { fields.push('role = ?'); params.push(role); }
    if (phone !== undefined) { fields.push('phone = ?'); params.push(phone); }
    if (title !== undefined) { fields.push('title = ?'); params.push(title); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    if (!fields.length) throw new HttpError(400, 'Nothing to update.');
    params.push(req.params.id);

    const [r] = await pool.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    if (r.affectedRows === 0) throw new HttpError(404, 'User not found.');
    res.json({ message: 'User updated.' });
  })
);

// POST /api/admin/users/:id/reset-password  (admin sets a new temp password)
router.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { password } = req.body;
    const [[target]] = await pool.query(`SELECT email FROM users WHERE id = ?`, [req.params.id]);
    if (!target) throw new HttpError(404, 'User not found.');
    const weak = checkPasswordStrength(password, target.email);
    if (weak) throw new HttpError(400, weak);
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
    await assertNotLastAdmin(req.params.id);
    const [r] = await pool.execute(`DELETE FROM users WHERE id = ?`, [req.params.id]);
    if (r.affectedRows === 0) throw new HttpError(404, 'User not found.');
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

// Ranges every tunable must stay inside. Values outside these produced scores
// that silently clamped rather than telling the admin they had made a mistake.
const SETTING_BOUNDS = {
  pi_weight_tp: [0, 1],
  pi_weight_pe: [0, 1],
  pi_weight_sa: [0, 1],
  peer_penalty: [0, 1],
  peer_review_deadline_days: [1, 90],
  peer_review_missed_penalty: [0, 1],
  peer_review_bad_penalty: [0, 1],
  engagement_risk_threshold: [0, 100],
  eng_weight_login: [0, 1],
  eng_weight_task: [0, 1],
  eng_weight_submission: [0, 1],
};

const WEIGHT_GROUPS = [
  { name: 'Performance Index', keys: ['pi_weight_tp', 'pi_weight_pe', 'pi_weight_sa'] },
  { name: 'Engagement', keys: ['eng_weight_login', 'eng_weight_task', 'eng_weight_submission'] },
];

router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const updates = req.body.settings || {};
    if (!Object.keys(updates).length) throw new HttpError(400, 'No settings supplied.');

    for (const [key, value] of Object.entries(updates)) {
      if (!(key in SETTING_BOUNDS)) throw new HttpError(400, `Unknown setting "${key}".`);
      const n = Number(value);
      if (!Number.isFinite(n)) throw new HttpError(400, `"${key}" must be a number.`);
      const [min, max] = SETTING_BOUNDS[key];
      if (n < min || n > max) throw new HttpError(400, `"${key}" must be between ${min} and ${max}.`);
    }

    // C5: weights are used directly and the result is clamped to [0,1], so a set
    // that does not sum to 1 quietly distorts every score. Validate against the
    // merged view, since a partial update can break the invariant on its own.
    const current = await getSettings();
    const merged = { ...current, ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, Number(v)])) };
    for (const group of WEIGHT_GROUPS) {
      if (!group.keys.some((k) => k in updates)) continue;
      const sum = group.keys.reduce((acc, k) => acc + Number(merged[k] || 0), 0);
      if (Math.abs(sum - 1) > 0.001) {
        throw new HttpError(
          400,
          `${group.name} weights must sum to 1.000 (got ${sum.toFixed(3)}: ` +
            group.keys.map((k) => `${k}=${Number(merged[k] || 0)}`).join(', ') + ').'
        );
      }
    }

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

// ---- Evaluation cycles -----------------------------------------------------
// C1: collaboration ratings are keyed on the open cycle. Nothing used to create
// or rotate one, so cycle_id stayed NULL and the unique key that was supposed to
// hold one-rating-per-pair enforced nothing.

router.get(
  '/cycles',
  asyncHandler(async (req, res) => {
    const [cycles] = await pool.query(
      `SELECT c.id, c.name, c.start_date, c.end_date, c.status, c.created_at,
              (SELECT COUNT(*) FROM peer_assessments pa
                WHERE pa.cycle_id = c.id AND pa.kind = 'collaboration') AS rating_count
         FROM evaluation_cycles c ORDER BY c.id DESC`
    );
    res.json({ cycles });
  })
);

router.post(
  '/cycles',
  asyncHandler(async (req, res) => {
    const { name, start_date, end_date } = req.body;
    if (!name || !String(name).trim()) throw new HttpError(400, 'Cycle name is required.');
    if (!start_date || !end_date) throw new HttpError(400, 'Start and end dates are required.');
    if (new Date(end_date) < new Date(start_date)) {
      throw new HttpError(400, 'End date must be on or after the start date.');
    }

    // uq_cycle_single_open enforces this too; checking here produces a usable
    // message instead of a duplicate-key error.
    const [[open]] = await pool.query(`SELECT id, name FROM evaluation_cycles WHERE status = 'open' LIMIT 1`);
    if (open) {
      throw new HttpError(409, `"${open.name}" is still open. Close it before opening another cycle.`);
    }

    const [r] = await pool.execute(
      `INSERT INTO evaluation_cycles (name, start_date, end_date, status) VALUES (?, ?, ?, 'open')`,
      [String(name).trim(), start_date, end_date]
    );
    res.status(201).json({ id: r.insertId, message: 'Evaluation cycle opened.' });
  })
);

router.post(
  '/cycles/:id/close',
  asyncHandler(async (req, res) => {
    const [r] = await pool.execute(
      `UPDATE evaluation_cycles SET status = 'closed' WHERE id = ? AND status = 'open'`,
      [req.params.id]
    );
    if (r.affectedRows === 0) throw new HttpError(404, 'No open cycle with that id.');
    res.json({ message: 'Evaluation cycle closed.' });
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
