import { verifyToken } from '../utils/jwt.js';
import { pool } from '../config/db.js';

// Verifies the JWT, loads the current user, and attaches it to req.user.
export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Authentication required.' });

    const payload = verifyToken(token);
    const [rows] = await pool.execute(
      `SELECT id, full_name, email, role, status, avatar_color FROM users WHERE id = ? LIMIT 1`,
      [payload.sub]
    );
    if (rows.length === 0) return res.status(401).json({ message: 'User no longer exists.' });
    if (rows[0].status !== 'active') return res.status(403).json({ message: 'Account is not active.' });

    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired session.' });
  }
}
