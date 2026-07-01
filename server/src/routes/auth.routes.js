import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { signToken } from '../utils/jwt.js';
import { verifyPassword, hashPassword, isStrongPassword } from '../utils/password.js';
import { sendMail } from '../utils/mailer.js';
import { logActivity } from '../utils/notify.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error.js';

const router = Router();
const clientIp = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();

// POST /api/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const ip = clientIp(req);
    const ua = (req.headers['user-agent'] || '').slice(0, 250);

    const [rows] = await pool.execute(
      `SELECT id, full_name, email, password_hash, role, status, avatar_color FROM users WHERE email = ? LIMIT 1`,
      [email || '']
    );
    const user = rows[0];
    const ok = user && (await verifyPassword(password || '', user.password_hash));

    // SRS 5.2 - log every attempt (success + failure) with timestamp + IP
    await pool.execute(
      `INSERT INTO login_audit (user_id, email, success, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`,
      [user ? user.id : null, email || '', ok ? 1 : 0, ip, ua]
    );

    if (!ok) throw new HttpError(401, 'Invalid email or password.');
    if (user.status !== 'active') throw new HttpError(403, 'Your account is not active. Contact an administrator.');

    await pool.execute(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [user.id]);
    await logActivity(user.id, 'login', null, ip);

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        avatar_color: user.avatar_color,
      },
    });
  })
);

// GET /api/auth/me
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT id, full_name, email, role, phone, title, avatar_color, status, last_login_at, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    res.json({ user: rows[0] });
  })
);

// PATCH /api/auth/change-password
router.patch(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!isStrongPassword(newPassword))
      throw new HttpError(400, 'New password must be at least 8 characters and include a letter and a number.');

    const [rows] = await pool.execute(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
    const ok = await verifyPassword(currentPassword || '', rows[0].password_hash);
    if (!ok) throw new HttpError(400, 'Current password is incorrect.');

    const hash = await hashPassword(newPassword);
    await pool.execute(`UPDATE users SET password_hash = ?, must_reset = 0 WHERE id = ?`, [hash, req.user.id]);
    res.json({ message: 'Password updated successfully.' });
  })
);

// POST /api/auth/forgot-password
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    const [rows] = await pool.execute(`SELECT id FROM users WHERE email = ? LIMIT 1`, [email || '']);
    // Always respond the same way to avoid leaking which emails exist.
    if (rows.length > 0) {
      const token = crypto.randomBytes(24).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000);
      await pool.execute(
        `INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)`,
        [rows[0].id, token, expires.toISOString().slice(0, 19).replace('T', ' ')]
      );
      const link = `${req.headers.origin || ''}/reset-password?token=${token}`;
      await sendMail({
        to: email,
        subject: 'Reset your Task Management System password',
        text: `Use this link to reset your password (valid for 1 hour): ${link}\nReset token: ${token}`,
      });
    }
    res.json({ message: 'If that email exists, a reset link has been sent.' });
  })
);

// POST /api/auth/reset-password
router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body;
    if (!isStrongPassword(newPassword))
      throw new HttpError(400, 'Password must be at least 8 characters and include a letter and a number.');

    const [rows] = await pool.execute(
      `SELECT id, user_id FROM password_resets WHERE token = ? AND used = 0 AND expires_at > NOW() LIMIT 1`,
      [token || '']
    );
    if (rows.length === 0) throw new HttpError(400, 'Reset link is invalid or has expired.');

    const hash = await hashPassword(newPassword);
    await pool.execute(`UPDATE users SET password_hash = ?, must_reset = 0 WHERE id = ?`, [hash, rows[0].user_id]);
    await pool.execute(`UPDATE password_resets SET used = 1 WHERE id = ?`, [rows[0].id]);
    res.json({ message: 'Password has been reset. You can now sign in.' });
  })
);

export default router;
