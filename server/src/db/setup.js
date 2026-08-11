import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { applyTriggers } from './triggers.js';
import { MIGRATIONS } from './migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_SETTINGS = [
  ['pi_weight_tp', '0.25', 'Performance Index weight for Task Performance'],
  ['pi_weight_pe', '0.35', 'Performance Index weight for Peer Evaluation'],
  ['pi_weight_sa', '0.40', 'Performance Index weight for Supervisor Assessment'],
  ['peer_penalty', '0.10', 'Penalty deducted when a member skips peer evaluations'],
  ['peer_review_deadline_days', '7', 'Days a reviewer has to complete an assigned peer review'],
  ['peer_review_missed_penalty', '0.05', 'TP deduction per missed peer review assignment'],
  ['peer_review_bad_penalty', '0.03', 'TP deduction per vulgar peer review comment'],
  ['engagement_risk_threshold', String(env.engagementRiskThreshold), 'Engagement score below this is flagged at-risk'],
  ['eng_weight_login', '0.34', 'Engagement weight: login frequency'],
  ['eng_weight_task', '0.33', 'Engagement weight: task update frequency'],
  ['eng_weight_submission', '0.33', 'Engagement weight: submission timeliness'],
];

/**
 * Connects, creating the database only if it is actually missing.
 *
 * Managed hosting (cPanel, Plesk, most shared MySQL) issues per-database users
 * with no CREATE DATABASE privilege — the database is created for you through
 * the control panel. Unconditionally running CREATE DATABASE there fails with
 * "Access denied", even with IF NOT EXISTS and the database already present.
 *
 * So: try the database first, and only fall back to creating it if the server
 * says it does not exist.
 */
async function connect() {
  const base = {
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  };

  try {
    const conn = await mysql.createConnection({ ...base, database: env.db.database });
    console.log(`> Using existing database "${env.db.database}".`);
    return conn;
  } catch (err) {
    if (err.code !== 'ER_BAD_DB_ERROR') throw err;
  }

  console.log(`> Database "${env.db.database}" not found, creating it...`);
  const conn = await mysql.createConnection(base);
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
  } catch (err) {
    if (err.code === 'ER_DBACCESS_DENIED_ERROR' || err.errno === 1044) {
      throw new Error(
        `This account cannot create databases. Create "${env.db.database}" in your ` +
          'hosting control panel first, grant the user ALL PRIVILEGES on it, then re-run.'
      );
    }
    throw err;
  }
  await conn.query(`USE \`${env.db.database}\`;`);
  return conn;
}

async function main() {
  console.log('> Connecting to MySQL server...');
  const root = await connect();

  console.log('> Applying schema (modular tables)...');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await root.query(schema);

  // Triggers live outside schema.sql because that file is executed with
  // multipleStatements, which splits on the semicolons inside a trigger body.
  console.log('> Applying triggers...');
  await applyTriggers(root);

  // A fresh schema.sql install is already at the latest shape, so every
  // migration is recorded as applied rather than re-run by db:migrate.
  console.log('> Recording migration ledger...');
  for (const m of MIGRATIONS) {
    await root.query(`INSERT IGNORE INTO schema_migrations (id) VALUES (?);`, [m.id]);
  }

  console.log('> Ensuring an open evaluation cycle...');
  await root.query(`
    INSERT INTO evaluation_cycles (name, start_date, end_date, status)
    SELECT CONCAT('Cycle ', DATE_FORMAT(CURDATE(), '%Y-%m')), CURDATE(), LAST_DAY(CURDATE()), 'open'
     WHERE NOT EXISTS (SELECT 1 FROM evaluation_cycles WHERE status = 'open');
  `);

  console.log('> Seeding default system settings...');
  for (const [key, value, desc] of DEFAULT_SETTINGS) {
    await root.query(
      `INSERT INTO system_settings (setting_key, setting_value, description)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description);`,
      [key, value, desc]
    );
  }

  console.log('> Ensuring default administrator account...');
  const [admins] = await root.query('SELECT id FROM users WHERE role = "admin" LIMIT 1;');
  if (admins.length === 0) {
    const hash = await bcrypt.hash(env.seedAdmin.password, 10);
    await root.query(
      `INSERT INTO users (full_name, email, password_hash, role, status, avatar_color)
       VALUES (?, ?, ?, 'admin', 'active', '#7c3aed');`,
      ['System Administrator', env.seedAdmin.email, hash]
    );
    console.log(`  Admin created -> ${env.seedAdmin.email} / ${env.seedAdmin.password}`);
  } else {
    console.log('  Admin already exists, skipping.');
  }

  await root.end();
  console.log('\n  Database setup complete.');
  console.log('  Next: run "npm run db:seed" (optional demo data) then "npm run dev".');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n  Database setup failed:');
  console.error(err.message);
  console.error('\n  Check that MySQL is running and the DB_* values in server/.env are correct.');
  process.exit(1);
});
