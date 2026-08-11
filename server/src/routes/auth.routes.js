import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pool } from '../config/db.js';
import { signToken } from '../utils/jwt.js';
import { verifyPassword, hashPassword, checkPasswordStrength } from '../utils/password.js';
import { sendMail } from '../utils/mailer.js';
import { logActivity } from '../utils/notify.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { avatarUpload, avatarRoot } from '../middleware/upload.js';
import { env } from '../config/env.js';

const router = Router();
const clientIp = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();

const USER_PUBLIC_FIELDS =
  'id, full_name, email, role, phone, title, avatar_color, avatar_url, status, must_reset, last_login_at, created_at';

// S3: online guessing is only practical against an endpoint that never says no.
// login_audit already records every attempt, so the throttle reads the data the
// system was collecting and ignoring.
async function assertNotThrottled(email, ip) {
  const windowMinutes = Number(env.loginFailureWindowMinutes) || 15;
  const [[byAccount]] = await pool.query(
    `SELECT COUNT(*) AS c FROM login_audit
      WHERE email = ? AND success = 0 AND created_at > (NOW() - INTERVAL ? MINUTE)`,
    [email || '', windowMinutes]
  );
  if (Number(byAccount.c) >= env.loginMaxFailuresPerAccount) {
    throw new HttpError(429, `Too many failed attempts. Try again in ${windowMinutes} minutes.`);
  }
  // Catches one attacker spraying many accounts, which the per-account cap misses.
  const [[byIp]] = await pool.query(
    `SELECT COUNT(*) AS c FROM login_audit
      WHERE ip_address = ? AND success = 0 AND created_at > (NOW() - INTERVAL ? MINUTE)`,
    [ip || '', windowMinutes]
  );
  if (Number(byIp.c) >= env.loginMaxFailuresPerIp) {
    throw new HttpError(429, `Too many failed attempts from this address. Try again in ${windowMinutes} minutes.`);
  }
}

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

    await assertNotThrottled(email, ip);

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

    await pool.execute(`UPDATE users SET last_login_at = NOW(), last_seen_at = NOW() WHERE id = ?`, [user.id]);
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
      avatarUrl = `/uploads/avatars/${req.file.filename}`;
      if (current.avatar_url && current.avatar_url.startsWith('/uploads/')) {
        const oldPath = path.join(avatarRoot, path.basename(current.avatar_url));
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
    const weak = checkPasswordStrength(newPassword, req.user.email);
    if (weak) throw new HttpError(400, weak);

    const [rows] = await pool.execute(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
    const ok = await verifyPassword(currentPassword || '', rows[0].password_hash);
    if (!ok) throw new HttpError(400, 'Current password is incorrect.');
    if (await verifyPassword(newPassword, rows[0].password_hash)) {
      throw new HttpError(400, 'New password must be different from the current one.');
    }

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
      // S4: never derive this from a request header. `Origin` is attacker-supplied,
      // so building the link from it let anyone have the real system email a
      // victim a link pointing at their own domain, carrying a valid token.
      const link = `${env.publicUrl.replace(/\/$/, '')}/reset-password?token=${token}`;
      await sendMail({
        to: email,
        subject: 'Reset your Task Management System password',
        text:
          `Use this link to reset your password (valid for 1 hour):\n${link}\n\n` +
          `If you did not request this, you can ignore this email.`,
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

    const [rows] = await pool.execute(
      `SELECT pr.id, pr.user_id, u.email
         FROM password_resets pr JOIN users u ON u.id = pr.user_id
        WHERE pr.token = ? AND pr.used = 0 AND pr.expires_at > NOW() LIMIT 1`,
      [token || '']
    );
    if (rows.length === 0) throw new HttpError(400, 'Reset link is invalid or has expired.');

    const weak = checkPasswordStrength(newPassword, rows[0].email);
    if (weak) throw new HttpError(400, weak);

    const hash = await hashPassword(newPassword);
    await pool.execute(`UPDATE users SET password_hash = ?, must_reset = 0 WHERE id = ?`, [hash, rows[0].user_id]);
    await pool.execute(`UPDATE password_resets SET used = 1 WHERE id = ?`, [rows[0].id]);
    res.json({ message: 'Password has been reset. You can now sign in.' });
  })
);

export default router;
