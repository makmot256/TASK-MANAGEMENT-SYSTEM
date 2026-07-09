import { pool } from '../config/db.js';

// Idempotent migration to bring an existing database up to date with the latest
// schema (team chat + subtask assignment). Safe to run multiple times.
async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(table, indexName) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return rows.length > 0;
}

async function tableExists(table) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows.length > 0;
}

async function run() {
  console.log('> Running migrations...');

  if (!(await columnExists('subtasks', 'assigned_to'))) {
    console.log('  - Adding subtasks.assigned_to');
    await pool.query(`ALTER TABLE subtasks ADD COLUMN assigned_to BIGINT UNSIGNED NULL AFTER position`);
    await pool.query(`ALTER TABLE subtasks ADD KEY idx_subtask_assignee (assigned_to)`);
    await pool.query(
      `ALTER TABLE subtasks ADD CONSTRAINT fk_subtask_assignee
         FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL`
    );
  } else {
    console.log('  - subtasks.assigned_to already present');
  }

  console.log('  - Ensuring team_messages table');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_messages (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      team_id    BIGINT UNSIGNED NOT NULL,
      sender_id  BIGINT UNSIGNED NOT NULL,
      body       VARCHAR(2000)   NOT NULL,
      created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_msg_team (team_id, id),
      CONSTRAINT fk_msg_team   FOREIGN KEY (team_id)   REFERENCES teams (id) ON DELETE CASCADE,
      CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('  - Removing weekly_reports feature tables (if present)');
  await pool.query(`DROP TABLE IF EXISTS weekly_report_files`);
  await pool.query(`DROP TABLE IF EXISTS weekly_reports`);

  console.log('  - Ensuring submission-based peer_review_assignments table');
  if (!(await columnExists('peer_review_assignments', 'submission_id'))) {
    console.log('  - Recreating peer_review_assignments (submission-triggered model)');
    await pool.query(`DROP TABLE IF EXISTS peer_review_assignments`);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS peer_review_assignments (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      submission_id BIGINT UNSIGNED NOT NULL,
      reviewer_id   BIGINT UNSIGNED NOT NULL,
      reviewee_id   BIGINT UNSIGNED NOT NULL,
      kind          ENUM('peer_review','collaboration') NOT NULL DEFAULT 'peer_review',
      status        ENUM('pending','completed') NOT NULL DEFAULT 'pending',
      assigned_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at  DATETIME        NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_pra_submission_reviewer (submission_id, reviewer_id),
      KEY idx_pra_reviewer (reviewer_id, status),
      KEY idx_pra_reviewee (reviewee_id),
      KEY idx_pra_submission (submission_id),
      CONSTRAINT fk_pra_submission FOREIGN KEY (submission_id) REFERENCES submissions (id) ON DELETE CASCADE,
      CONSTRAINT fk_pra_reviewer   FOREIGN KEY (reviewer_id)   REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_pra_reviewee   FOREIGN KEY (reviewee_id)   REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  if (!(await columnExists('peer_assessments', 'submission_id'))) {
    console.log('  - Adding peer_assessments.submission_id');
    await pool.query(`ALTER TABLE peer_assessments ADD COLUMN submission_id BIGINT UNSIGNED NULL AFTER cycle_id`);
    await pool.query(`ALTER TABLE peer_assessments ADD KEY idx_assess_submission (submission_id)`);
    await pool.query(
      `ALTER TABLE peer_assessments ADD CONSTRAINT fk_assess_submission
         FOREIGN KEY (submission_id) REFERENCES submissions (id) ON DELETE CASCADE`
    );
  }
  if (!(await indexExists('peer_assessments', 'uq_assess_submission'))) {
    console.log('  - Adding peer_assessments.uq_assess_submission');
    await pool.query(`ALTER TABLE peer_assessments ADD UNIQUE KEY uq_assess_submission (submission_id, assessor_id)`);
  }

  if (!(await columnExists('peer_review_assignments', 'due_at'))) {
    console.log('  - Adding peer_review_assignments.due_at');
    await pool.query(`ALTER TABLE peer_review_assignments ADD COLUMN due_at DATETIME NULL AFTER assigned_at`);
    await pool.query(
      `UPDATE peer_review_assignments SET due_at = DATE_ADD(assigned_at, INTERVAL 7 DAY) WHERE due_at IS NULL`
    );
  }

  console.log('  - Ensuring peer_review_assignments.status includes missed');
  await pool.query(`
    ALTER TABLE peer_review_assignments
      MODIFY COLUMN status ENUM('pending','completed','missed') NOT NULL DEFAULT 'pending'
  `);

  const penaltySettings = [
    ['peer_review_deadline_days', '7', 'Days a reviewer has to complete an assigned peer review'],
    ['peer_review_missed_penalty', '0.05', 'TP deduction per missed peer review assignment'],
    ['peer_review_bad_penalty', '0.03', 'TP deduction per vulgar peer review comment'],
  ];
  for (const [key, value, desc] of penaltySettings) {
    await pool.query(
      `INSERT INTO system_settings (setting_key, setting_value, description)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [key, value, desc]
    );
  }

  if (!(await columnExists('peer_assessments', 'vulgar_comment'))) {
    console.log('  - Adding peer_assessments.vulgar_comment');
    await pool.query(
      `ALTER TABLE peer_assessments ADD COLUMN vulgar_comment TINYINT(1) NOT NULL DEFAULT 0 AFTER comment`
    );
  }

  console.log('  - Ensuring team_supervisors table (multi-supervisor teams)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_supervisors (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      team_id       BIGINT UNSIGNED NOT NULL,
      supervisor_id BIGINT UNSIGNED NOT NULL,
      assigned_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_team_supervisor (team_id, supervisor_id),
      KEY idx_ts_supervisor (supervisor_id),
      CONSTRAINT fk_ts_team       FOREIGN KEY (team_id)       REFERENCES teams (id) ON DELETE CASCADE,
      CONSTRAINT fk_ts_supervisor FOREIGN KEY (supervisor_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  if (await columnExists('teams', 'supervisor_id')) {
    console.log('  - Migrating teams.supervisor_id -> team_supervisors');
    await pool.query(`
      INSERT IGNORE INTO team_supervisors (team_id, supervisor_id)
      SELECT id, supervisor_id FROM teams WHERE supervisor_id IS NOT NULL
    `);
    await pool.query(`ALTER TABLE teams DROP FOREIGN KEY fk_team_supervisor`);
    await pool.query(`ALTER TABLE teams DROP COLUMN supervisor_id`);
  }

  if (!(await columnExists('users', 'avatar_url'))) {
    console.log('  - Adding users.avatar_url');
    await pool.query(`ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255) NULL AFTER avatar_color`);
  } else {
    console.log('  - users.avatar_url already present');
  }

  console.log('> Migrations complete.');
  await pool.end();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
