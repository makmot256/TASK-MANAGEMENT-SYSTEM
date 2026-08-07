import mysql from 'mysql2/promise';
import { env } from './env.js';

// Shared connection pool used across the whole API.
export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  namedPlaceholders: true,
});

// Convenience helper returning just the rows.
export async function query(sql, params = {}) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// Run a function inside a transaction with automatic commit/rollback.
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
