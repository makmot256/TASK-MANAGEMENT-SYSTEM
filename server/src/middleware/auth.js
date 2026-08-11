import { verifyToken } from '../utils/jwt.js';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';

// Routes that stay reachable while an account is flagged must_reset, so the
// user has a way out of the lock. (S6)
const MUST_RESET_ALLOWED = new Set([
  'GET /api/auth/me',
  'PATCH /api/auth/change-password',
  'GET /api/health',
]);

// Writing last_seen_at on literally every request would add a write per read to
// a 10-connection pool. A minute of granularity is ample for a 30-minute idle
// window. (S5)
const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

function idleLimitMs() {
  const minutes = Number(env.sessionIdleMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0;
}

// Verifies the JWT, loads the current user, enforces the idle window and the
// forced-password-change gate, then attaches the user to req.user.
export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Authentication required.' });

    const payload = verifyToken(token);
    const [rows] = await pool.execute(
      `SELECT id, full_name, email, role, status, avatar_color, must_reset, last_seen_at
         FROM users WHERE id = ? LIMIT 1`,
      [payload.sub]
    );
    if (rows.length === 0) return res.status(401).json({ message: 'User no longer exists.' });

    const user = rows[0];
    if (user.status !== 'active') return res.status(403).json({ message: 'Account is not active.' });

    // S5: SRS 5.2 requires sessions to expire on inactivity, not merely at the
    // JWT's 8h expiry. last_seen_at is server-side, so it cannot be forged, and
    // it measures true inactivity rather than time since issue.
    const limit = idleLimitMs();
    const lastSeen = user.last_seen_at ? new Date(`${user.last_seen_at}Z`.replace(' ', 'T')) : null;
    const idleMs = lastSeen ? Date.now() - lastSeen.getTime() : 0;
    if (limit && lastSeen && idleMs > limit) {
      return res.status(401).json({
        code: 'session_idle',
        message: 'Your session expired after a period of inactivity. Please sign in again.',
      });
    }

    if (!lastSeen || idleMs > LAST_SEEN_WRITE_INTERVAL_MS) {
      // Fire-and-forget: a failed heartbeat must never fail the request.
      pool.execute(`UPDATE users SET last_seen_at = NOW() WHERE id = ?`, [user.id]).catch(() => {});
    }

    // S6: a temporary password must actually be temporary. The gate lives on the
    // server so it cannot be skipped by calling the API directly.
    if (user.must_reset) {
      const route = `${req.method} ${req.baseUrl || ''}${req.route?.path || req.path || ''}`.replace(/\/$/, '');
      const key = `${req.method} ${(req.baseUrl || '') + (req.path || '')}`.replace(/\/$/, '');
      if (!MUST_RESET_ALLOWED.has(key) && !MUST_RESET_ALLOWED.has(route)) {
        return res.status(403).json({
          code: 'must_reset',
          message: 'You must change your temporary password before continuing.',
        });
      }
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired session.' });
  }
}
