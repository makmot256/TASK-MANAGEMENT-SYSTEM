import { pool } from '../config/db.js';

// Create an in-app notification for a user.
export async function notify(userId, { type, title, body = null, link = null }) {
  await pool.execute(
    `INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)`,
    [userId, type, title, body, link]
  );
}

// Values accepted by activity_logs.action_type. Kept here so a typo is caught
// in the application rather than swallowed by the catch below. (C4)
export const ACTIVITY_TYPES = new Set([
  'login', 'task_update', 'submission', 'comment', 'peer_review', 'profile_update',
]);

// Record a raw activity event (feeds the engagement engine).
//
// Failures must never break the request, but they must not be invisible either:
// 'profile_update' was written for months while absent from the column ENUM, and
// every one of those inserts was silently discarded under STRICT_TRANS_TABLES.
export async function logActivity(userId, actionType, meta = null, ip = null) {
  if (!ACTIVITY_TYPES.has(actionType)) {
    console.warn(
      `[activity] refusing to log unknown action_type "${actionType}" — ` +
        `add it to activity_logs.action_type and ACTIVITY_TYPES first.`
    );
    return;
  }
  try {
    await pool.execute(
      `INSERT INTO activity_logs (user_id, action_type, meta, ip_address) VALUES (?, ?, ?, ?)`,
      [userId, actionType, meta ? JSON.stringify(meta) : null, ip]
    );
  } catch (err) {
    // A logging layer that fails invisibly is worse than one that fails loudly.
    console.warn(`[activity] failed to log "${actionType}" for user ${userId}: ${err.message}`);
  }
}
