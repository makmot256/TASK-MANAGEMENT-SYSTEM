import { pool } from '../config/db.js';

// Create an in-app notification for a user.
export async function notify(userId, { type, title, body = null, link = null }) {
  await pool.execute(
    `INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)`,
    [userId, type, title, body, link]
  );
}

// Record a raw activity event (feeds the ML engagement engine).
export async function logActivity(userId, actionType, meta = null, ip = null) {
  try {
    await pool.execute(
      `INSERT INTO activity_logs (user_id, action_type, meta, ip_address) VALUES (?, ?, ?, ?)`,
      [userId, actionType, meta ? JSON.stringify(meta) : null, ip]
    );
  } catch {
    // activity logging must never break the request flow
  }
}
