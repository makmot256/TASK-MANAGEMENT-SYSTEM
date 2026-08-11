import { pool } from '../config/db.js';
import { MIGRATIONS } from './migrations.js';

// Applies every migration not yet recorded in `schema_migrations`, in order.
//
// Idempotent: re-running applies nothing. Resumable: a failure mid-run leaves
// earlier migrations recorded, so the next run continues from the failure point.
// A database can now report its own version, which is what `schema.sql` and this
// script previously had no way to agree on.

async function ensureLedger() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         VARCHAR(80)  NOT NULL,
      applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function appliedIds() {
  const [rows] = await pool.query(`SELECT id FROM schema_migrations`);
  return new Set(rows.map((r) => r.id));
}

/**
 * A database created by schema.sql already has the final shape, so every
 * migration is a no-op there. Recording them up front turns `db:migrate` into a
 * genuine no-op on a fresh install instead of a series of redundant ALTERs.
 */
async function isFreshSchemaInstall() {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND ((TABLE_NAME = 'users'            AND COLUMN_NAME = 'last_seen_at')
          OR (TABLE_NAME = 'task_status_history' AND COLUMN_NAME = 'task_id')
          OR (TABLE_NAME = 'evaluation_cycles'   AND COLUMN_NAME = 'open_flag'))`
  );
  return Number(row.c) === 3;
}

async function run() {
  console.log('> Running migrations...');
  await ensureLedger();

  let applied = await appliedIds();

  if (applied.size === 0 && (await isFreshSchemaInstall())) {
    console.log('  - database matches schema.sql; recording all migrations as applied');
    for (const m of MIGRATIONS) {
      await pool.query(`INSERT IGNORE INTO schema_migrations (id) VALUES (?)`, [m.id]);
    }
    applied = await appliedIds();
  }

  const pending = MIGRATIONS.filter((m) => !applied.has(m.id));
  if (pending.length === 0) {
    console.log(`  - up to date (${applied.size} migration(s) applied)`);
    await pool.end();
    return;
  }

  for (const migration of pending) {
    console.log(`  - applying ${migration.id}`);
    const conn = await pool.getConnection();
    try {
      // DDL is not transactional in MySQL, so a failure can leave a migration
      // half-applied. Each `up` is written to be re-runnable for that reason.
      await migration.up(conn);
      await conn.query(`INSERT INTO schema_migrations (id) VALUES (?)`, [migration.id]);
    } catch (err) {
      console.error(`\n  Migration ${migration.id} failed: ${err.message}`);
      console.error('  Nothing after this point was applied. Fix the cause and re-run.');
      conn.release();
      await pool.end();
      process.exit(1);
    }
    conn.release();
  }

  console.log(`> Migrations complete (${pending.length} applied).`);
  await pool.end();
}

run().catch(async (err) => {
  console.error('Migration failed:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
