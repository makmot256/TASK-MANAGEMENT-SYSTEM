import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

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

async function main() {
  console.log('> Connecting to MySQL server...');
  const root = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });

  console.log(`> Creating database "${env.db.database}" if it does not exist...`);
  await root.query(
    `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
  );
  await root.query(`USE \`${env.db.database}\`;`);

  console.log('> Applying schema (modular tables)...');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await root.query(schema);

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
