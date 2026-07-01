import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler } from '../middleware/error.js';
import { memberIdsForSupervisor, peerCollaboratorIds } from '../utils/scope.js';

const router = Router();
router.use(authenticate);

// GET /api/users/me/teams  - teams the current user belongs to / supervises
router.get(
  '/me/teams',
  asyncHandler(async (req, res) => {
    let rows;
    if (req.user.role === 'supervisor') {
      [rows] = await pool.execute(
        `SELECT DISTINCT t.id, t.name, t.description
           FROM team_supervisors ts JOIN teams t ON t.id = ts.team_id
          WHERE ts.supervisor_id = ?`,
        [req.user.id]
      );
    } else {
      [rows] = await pool.execute(
        `SELECT t.id, t.name, t.description FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.member_id = ?`,
        [req.user.id]
      );
    }
    res.json({ teams: rows });
  })
);

// GET /api/users/members  - members visible to the requester (supervisor scope)
router.get(
  '/members',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    if (req.user.role === 'admin') {
      const [rows] = await pool.execute(
        `SELECT id, full_name, email, avatar_color, title FROM users WHERE role = 'member' ORDER BY full_name`
      );
      return res.json({ members: rows });
    }
    const ids = await memberIdsForSupervisor(req.user.id);
    if (ids.length === 0) return res.json({ members: [] });
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT id, full_name, email, avatar_color, title FROM users WHERE id IN (${placeholders}) ORDER BY full_name`,
      ids
    );
    res.json({ members: rows });
  })
);

// GET /api/users/cohort  - teammates the requester may rate on collaboration (same team only).
router.get(
  '/cohort',
  requireRole('member'),
  asyncHandler(async (req, res) => {
    const ids = await peerCollaboratorIds(req.user.id);
    if (ids.length === 0) return res.json({ cohort: [] });
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT id, full_name, avatar_color, title FROM users
        WHERE id IN (${placeholders}) ORDER BY full_name`,
      ids
    );
    res.json({ cohort: rows });
  })
);

export default router;
