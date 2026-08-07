import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pool } from '../config/db.js';
import { signToken } from '../utils/jwt.js';
import { verifyPassword, hashPassword, isStrongPassword } from '../utils/password.js';
import { sendMail } from '../utils/mailer.js';
import { logActivity } from '../utils/notify.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { avatarUpload, uploadRoot } from '../middleware/upload.js';

const router = Router();
const clientIp = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();

const USER_PUBLIC_FIELDS =
  'id, full_name, email, role, phone, title, avatar_color, avatar_url, status, last_login_at, created_at';

async function fetchUser(id) {
  const [rows] = await pool.execute(`SELECT ${USER_PUBLIC_FIELDS} FROM users WHERE id = ?`, [id]);
  return rows[0] || null;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// POST /api/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const ip = clientIp(req);
    const ua = (req.headers['user-agent'] || '').slice(0, 250);

    const [rows] = await pool.execute(
      `SELECT id, full_name, email, password_hash, role, status, avatar_color, avatar_url FROM users WHERE email = ? LIMIT 1`,
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
    const fresh = await fetchUser(user.id);
    res.json({
      token,
      user: fresh,
    });
  })
);

// GET /api/auth/me
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await fetchUser(req.user.id);
    if (!user) throw new HttpError(404, 'User not found.');
    res.json({ user });
  })
);

// PATCH /api/auth/profile  — update name, email, phone, and optional avatar image
router.patch(
  '/profile',
  authenticate,
  avatarUpload.single('avatar'),
  asyncHandler(async (req, res) => {
    const full_name = String(req.body.full_name ?? '').trim();
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const phone = String(req.body.phone ?? '').trim();

    if (!full_name) throw new HttpError(400, 'Full name is required.');
    if (full_name.length > 120) throw new HttpError(400, 'Full name is too long.');
    if (!isValidEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (phone.length > 40) throw new HttpError(400, 'Phone number is too long.');

    const [dup] = await pool.execute(
      `SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1`,
      [email, req.user.id]
    );
    if (dup.length) throw new HttpError(409, 'That email is already in use.');

    const current = await fetchUser(req.user.id);
    if (!current) throw new HttpError(404, 'User not found.');

    let avatarUrl = current.avatar_url;
    if (req.file) {
      avatarUrl = `/uploads/${req.file.filename}`;
      if (current.avatar_url && current.avatar_url.startsWith('/uploads/')) {
        const oldPath = path.join(uploadRoot, path.basename(current.avatar_url));
        fs.promises.unlink(oldPath).catch(() => {});
      }
    }

    await pool.execute(
      `UPDATE users SET full_name = ?, email = ?, phone = ?, avatar_url = ? WHERE id = ?`,
      [full_name, email, phone || null, avatarUrl, req.user.id]
    );

    await logActivity(req.user.id, 'profile_update', { email }, clientIp(req));
    const user = await fetchUser(req.user.id);
    res.json({ message: 'Profile updated.', user });
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
