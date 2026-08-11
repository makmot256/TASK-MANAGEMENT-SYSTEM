import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { applyTriggers } from './triggers.js';

// Ordered, numbered migrations. `db:migrate` records each id in
// `schema_migrations` and never re-runs it, so this file is the authoritative
// history of how an existing database reaches the shape schema.sql declares.
//
// Rules:
//   - append only; never edit an id that has shipped
//   - each `up` must be safe to run against a database at the previous id
//   - anything added here must also be reflected in schema.sql for fresh installs

// ---- helpers ---------------------------------------------------------------

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return rows.length > 0;
}

async function constraintExists(conn, table, name) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, name]
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows.length > 0;
}

async function dropForeignKeyIfExists(conn, table, name) {
  if (await constraintExists(conn, table, name)) {
    await conn.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${name}\``);
  }
}

// ---- migrations ------------------------------------------------------------

export const MIGRATIONS = [
  {
    id: '0001_legacy_bootstrap',
    description:
      'Pre-ledger upgrades: subtask assignees, team chat, submission-based peer review ' +
      'assignments, multi-supervisor teams, avatars, task briefing files.',
    async up(conn) {
      if (!(await columnExists(conn, 'subtasks', 'assigned_to'))) {
        await conn.query(`ALTER TABLE subtasks ADD COLUMN assigned_to BIGINT UNSIGNED NULL AFTER position`);
        await conn.query(`ALTER TABLE subtasks ADD KEY idx_subtask_assignee (assigned_to)`);
        await conn.query(
          `ALTER TABLE subtasks ADD CONSTRAINT fk_subtask_assignee
             FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL`
        );
      }

      await conn.query(`
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

      await conn.query(`DROP TABLE IF EXISTS weekly_report_files`);
      await conn.query(`DROP TABLE IF EXISTS weekly_reports`);

      // The old shape keyed reviews to evaluation cycles rather than submissions.
      if (
        (await tableExists(conn, 'peer_review_assignments')) &&
        !(await columnExists(conn, 'peer_review_assignments', 'submission_id'))
      ) {
        await conn.query(`DROP TABLE IF EXISTS peer_review_assignments`);
      }
      await conn.query(`
        CREATE TABLE IF NOT EXISTS peer_review_assignments (
          id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          submission_id BIGINT UNSIGNED NOT NULL,
          reviewer_id   BIGINT UNSIGNED NOT NULL,
          reviewee_id   BIGINT UNSIGNED NOT NULL,
          status        ENUM('pending','completed','missed') NOT NULL DEFAULT 'pending',
          assigned_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
          due_at        DATETIME        NULL,
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

      if (!(await columnExists(conn, 'peer_assessments', 'submission_id'))) {
        await conn.query(`ALTER TABLE peer_assessments ADD COLUMN submission_id BIGINT UNSIGNED NULL AFTER cycle_id`);
        await conn.query(`ALTER TABLE peer_assessments ADD KEY idx_assess_submission (submission_id)`);
        await conn.query(
          `ALTER TABLE peer_assessments ADD CONSTRAINT fk_assess_submission
             FOREIGN KEY (submission_id) REFERENCES submissions (id) ON DELETE CASCADE`
        );
      }
      if (!(await indexExists(conn, 'peer_assessments', 'uq_assess_submission'))) {
        await conn.query(
          `ALTER TABLE peer_assessments ADD UNIQUE KEY uq_assess_submission (submission_id, assessor_id)`
        );
      }

      if (!(await columnExists(conn, 'peer_review_assignments', 'due_at'))) {
        await conn.query(`ALTER TABLE peer_review_assignments ADD COLUMN due_at DATETIME NULL AFTER assigned_at`);
        await conn.query(
          `UPDATE peer_review_assignments SET due_at = DATE_ADD(assigned_at, INTERVAL 7 DAY) WHERE due_at IS NULL`
        );
      }
      await conn.query(`
        ALTER TABLE peer_review_assignments
          MODIFY COLUMN status ENUM('pending','completed','missed') NOT NULL DEFAULT 'pending'
      `);

      if (!(await columnExists(conn, 'peer_assessments', 'vulgar_comment'))) {
        await conn.query(
          `ALTER TABLE peer_assessments ADD COLUMN vulgar_comment TINYINT(1) NOT NULL DEFAULT 0 AFTER comment`
        );
      }

      await conn.query(`
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

      if (await columnExists(conn, 'teams', 'supervisor_id')) {
        await conn.query(`
          INSERT IGNORE INTO team_supervisors (team_id, supervisor_id)
          SELECT id, supervisor_id FROM teams WHERE supervisor_id IS NOT NULL
        `);
        await dropForeignKeyIfExists(conn, 'teams', 'fk_team_supervisor');
        await conn.query(`ALTER TABLE teams DROP COLUMN supervisor_id`);
      }

      if (!(await columnExists(conn, 'users', 'avatar_url'))) {
        await conn.query(`ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255) NULL AFTER avatar_color`);
      }

      await conn.query(`
        CREATE TABLE IF NOT EXISTS task_files (
          id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          task_id       BIGINT UNSIGNED NOT NULL,
          original_name VARCHAR(255)    NOT NULL,
          stored_name   VARCHAR(255)    NOT NULL,
          mime_type     VARCHAR(120)    NOT NULL,
          size_bytes    BIGINT UNSIGNED NOT NULL DEFAULT 0,
          uploaded_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_tfile_task (task_id),
          CONSTRAINT fk_tfile_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    },
  },

  {
    id: '0002_activity_log_profile_update',
    description: "Add 'profile_update' to activity_logs.action_type and drop the never-written 'view'. (C4)",
    async up(conn) {
      // Widen first so existing rows stay valid, then narrow away 'view'.
      await conn.query(`
        ALTER TABLE activity_logs MODIFY COLUMN action_type
          ENUM('login','task_update','submission','comment','view','peer_review','profile_update') NOT NULL
      `);
      await conn.query(`DELETE FROM activity_logs WHERE action_type = 'view'`);
      await conn.query(`
        ALTER TABLE activity_logs MODIFY COLUMN action_type
          ENUM('login','task_update','submission','comment','peer_review','profile_update') NOT NULL
      `);
    },
  },

  {
    id: '0003_analytics_composite_indexes',
    description:
      'Composite indexes matching the multi-predicate analytics queries; drops the ' +
      'single-column indexes they subsume. (data-model finding 5, supports P1)',
    async up(conn) {
      if (!(await indexExists(conn, 'activity_logs', 'idx_activity_user_type_created'))) {
        await conn.query(
          `ALTER TABLE activity_logs ADD KEY idx_activity_user_type_created (user_id, action_type, created_at)`
        );
      }
      // user_id and action_type are now covered as prefixes of the composite.
      for (const idx of ['idx_activity_user', 'idx_activity_type']) {
        if (await indexExists(conn, 'activity_logs', idx)) {
          await conn.query(`ALTER TABLE activity_logs DROP INDEX \`${idx}\``);
        }
      }

      if (!(await indexExists(conn, 'task_assignments', 'idx_assign_member_status_completed'))) {
        await conn.query(
          `ALTER TABLE task_assignments
             ADD KEY idx_assign_member_status_completed (member_id, status, completed_at)`
        );
      }
      if (!(await indexExists(conn, 'submissions', 'idx_sub_member_submitted'))) {
        await conn.query(
          `ALTER TABLE submissions ADD KEY idx_sub_member_submitted (member_id, submitted_at)`
        );
      }
    },
  },

  {
    id: '0004_evaluation_cycle_integrity',
    description:
      'Guarantee at most one open cycle, attach orphaned collaboration ratings to it, ' +
      'de-duplicate the rows the NULL cycle_id allowed to accumulate. (C1)',
    async up(conn) {
      // De-duplicate before any constraint can be applied: keep the newest rating
      // per (assessor, assessee, kind) among the NULL-cycle collaboration rows.
      await conn.query(`
        DELETE p1 FROM peer_assessments p1
          JOIN peer_assessments p2
            ON p1.assessor_id = p2.assessor_id
           AND p1.assessee_id = p2.assessee_id
           AND p1.kind = p2.kind
           AND p1.cycle_id <=> p2.cycle_id
           AND p1.id < p2.id
         WHERE p1.kind = 'collaboration'
      `);

      // Close any surplus open cycles, oldest first, keeping the newest.
      await conn.query(`
        UPDATE evaluation_cycles SET status = 'closed'
         WHERE status = 'open'
           AND id <> (SELECT * FROM (SELECT MAX(id) FROM evaluation_cycles WHERE status = 'open') x)
      `);

      if (!(await columnExists(conn, 'evaluation_cycles', 'open_flag'))) {
        await conn.query(`
          ALTER TABLE evaluation_cycles
            ADD COLUMN open_flag TINYINT UNSIGNED AS (IF(status = 'open', 1, NULL)) STORED
        `);
      }
      if (!(await indexExists(conn, 'evaluation_cycles', 'uq_cycle_single_open'))) {
        await conn.query(`ALTER TABLE evaluation_cycles ADD UNIQUE KEY uq_cycle_single_open (open_flag)`);
      }

      // Ensure one exists, then adopt every orphaned collaboration rating into it.
      const [open] = await conn.query(`SELECT id FROM evaluation_cycles WHERE status = 'open' LIMIT 1`);
      let cycleId = open[0]?.id;
      if (!cycleId) {
        const [ins] = await conn.query(`
          INSERT INTO evaluation_cycles (name, start_date, end_date, status)
          VALUES (CONCAT('Cycle ', DATE_FORMAT(CURDATE(), '%Y-%m')), CURDATE(), LAST_DAY(CURDATE()), 'open')
        `);
        cycleId = ins.insertId;
      }
      await conn.query(
        `UPDATE peer_assessments SET cycle_id = ? WHERE kind = 'collaboration' AND cycle_id IS NULL`,
        [cycleId]
      );
    },
  },

  {
    id: '0005_peer_assessment_parent_check',
    description:
      'Each assessment kind gets exactly one parent: peer_review→submission, ' +
      'collaboration→cycle. (data-model finding 2)',
    async up(conn) {
      // Legacy seeds wrote peer_review rows against a cycle with no submission;
      // they cannot be repaired (the submission is unknown), so they are removed.
      await conn.query(`DELETE FROM peer_assessments WHERE kind = 'peer_review' AND submission_id IS NULL`);
      await conn.query(`UPDATE peer_assessments SET cycle_id = NULL WHERE kind = 'peer_review'`);
      await conn.query(`DELETE FROM peer_assessments WHERE kind = 'collaboration' AND cycle_id IS NULL`);
      await conn.query(`UPDATE peer_assessments SET submission_id = NULL WHERE kind = 'collaboration'`);

      // MySQL forbids a CHECK on a column carrying a SET NULL referential action,
      // and SET NULL would now break the invariant anyway.
      await dropForeignKeyIfExists(conn, 'peer_assessments', 'fk_assess_cycle');
      await conn.query(
        `ALTER TABLE peer_assessments ADD CONSTRAINT fk_assess_cycle
           FOREIGN KEY (cycle_id) REFERENCES evaluation_cycles (id)`
      );

      if (!(await constraintExists(conn, 'peer_assessments', 'chk_assess_parent'))) {
        await conn.query(`
          ALTER TABLE peer_assessments ADD CONSTRAINT chk_assess_parent CHECK (
            (kind = 'peer_review'   AND submission_id IS NOT NULL AND cycle_id IS NULL) OR
            (kind = 'collaboration' AND cycle_id      IS NOT NULL AND submission_id IS NULL)
          )
        `);
      }
    },
  },

  {
    id: '0006_score_range_checks',
    description: 'Enforce the documented 0..5 supervisor score range in the schema. (data-model finding 4)',
    async up(conn) {
      await conn.query(`UPDATE supervisor_assessments SET quality_score = 5 WHERE quality_score > 5`);
      await conn.query(
        `UPDATE supervisor_assessments SET responsiveness_score = 5 WHERE responsiveness_score > 5`
      );
      if (!(await constraintExists(conn, 'supervisor_assessments', 'chk_sa_quality'))) {
        await conn.query(
          `ALTER TABLE supervisor_assessments ADD CONSTRAINT chk_sa_quality CHECK (quality_score BETWEEN 0 AND 5)`
        );
      }
      if (!(await constraintExists(conn, 'supervisor_assessments', 'chk_sa_responsiveness'))) {
        await conn.query(`
          ALTER TABLE supervisor_assessments ADD CONSTRAINT chk_sa_responsiveness
            CHECK (responsiveness_score IS NULL OR responsiveness_score BETWEEN 0 AND 5)
        `);
      }
    },
  },

  {
    id: '0007_unique_team_name',
    description: 'Team names must be unique. (data-model finding 4)',
    async up(conn) {
      // Disambiguate existing duplicates before the constraint can apply.
      const [dupes] = await conn.query(
        `SELECT name FROM teams GROUP BY name HAVING COUNT(*) > 1`
      );
      for (const { name } of dupes) {
        const [rows] = await conn.query(`SELECT id FROM teams WHERE name = ? ORDER BY id`, [name]);
        for (let i = 1; i < rows.length; i += 1) {
          await conn.query(`UPDATE teams SET name = ? WHERE id = ?`, [`${name} (${i + 1})`, rows[i].id]);
        }
      }
      if (!(await indexExists(conn, 'teams', 'uq_team_name'))) {
        await conn.query(`ALTER TABLE teams ADD UNIQUE KEY uq_team_name (name)`);
      }
    },
  },

  {
    id: '0008_audit_survives_assignment_delete',
    description:
      'task_status_history keeps task_id/member_id and survives assignment deletion. ' +
      '(data-model finding 6)',
    async up(conn) {
      if (!(await columnExists(conn, 'task_status_history', 'task_id'))) {
        await conn.query(
          `ALTER TABLE task_status_history ADD COLUMN task_id BIGINT UNSIGNED NULL AFTER assignment_id`
        );
      }
      if (!(await columnExists(conn, 'task_status_history', 'member_id'))) {
        await conn.query(
          `ALTER TABLE task_status_history ADD COLUMN member_id BIGINT UNSIGNED NULL AFTER task_id`
        );
      }
      await conn.query(`
        UPDATE task_status_history h
          JOIN task_assignments ta ON ta.id = h.assignment_id
           SET h.task_id = ta.task_id, h.member_id = ta.member_id
         WHERE h.task_id IS NULL
      `);
      await dropForeignKeyIfExists(conn, 'task_status_history', 'fk_history_assignment');
      await conn.query(`ALTER TABLE task_status_history MODIFY COLUMN assignment_id BIGINT UNSIGNED NULL`);
      await conn.query(`
        ALTER TABLE task_status_history ADD CONSTRAINT fk_history_assignment
          FOREIGN KEY (assignment_id) REFERENCES task_assignments (id) ON DELETE SET NULL
      `);
      if (!(await indexExists(conn, 'task_status_history', 'idx_history_task'))) {
        await conn.query(`ALTER TABLE task_status_history ADD KEY idx_history_task (task_id, changed_at)`);
      }
    },
  },

  {
    id: '0009_drop_dead_schema',
    description:
      'Remove performance_scores.cycle_id and peer_review_assignments.kind, neither of ' +
      'which the application ever writes meaningfully. (data-model finding 7)',
    async up(conn) {
      if (await columnExists(conn, 'performance_scores', 'cycle_id')) {
        await dropForeignKeyIfExists(conn, 'performance_scores', 'fk_perf_cycle');
        await conn.query(`ALTER TABLE performance_scores DROP COLUMN cycle_id`);
      }
      if (await columnExists(conn, 'peer_review_assignments', 'kind')) {
        await conn.query(`ALTER TABLE peer_review_assignments DROP COLUMN kind`);
      }
    },
  },

  {
    id: '0010_idle_session_tracking',
    description: 'users.last_seen_at backs the idle-session timeout. (S5)',
    async up(conn) {
      if (!(await columnExists(conn, 'users', 'last_seen_at'))) {
        await conn.query(`ALTER TABLE users ADD COLUMN last_seen_at DATETIME NULL AFTER last_login_at`);
        await conn.query(`UPDATE users SET last_seen_at = last_login_at WHERE last_seen_at IS NULL`);
      }
    },
  },

  {
    id: '0011_split_avatar_uploads',
    description:
      'Move avatars into uploads/avatars/ so only that subtree can be served without ' +
      'authentication, and repoint avatar_url. (S1)',
    async up(conn) {
      const uploadRoot = path.resolve(process.cwd(), env.uploadDir);
      const avatarRoot = path.join(uploadRoot, 'avatars');
      fs.mkdirSync(avatarRoot, { recursive: true });

      const [rows] = await conn.query(
        `SELECT id, avatar_url FROM users
          WHERE avatar_url IS NOT NULL AND avatar_url LIKE '/uploads/%'
            AND avatar_url NOT LIKE '/uploads/avatars/%'`
      );
      for (const row of rows) {
        const file = path.basename(row.avatar_url);
        const from = path.join(uploadRoot, file);
        const to = path.join(avatarRoot, file);
        try {
          if (fs.existsSync(from)) fs.renameSync(from, to);
        } catch (err) {
          console.warn(`  ! could not move avatar ${file}: ${err.message}`);
        }
        await conn.query(`UPDATE users SET avatar_url = ? WHERE id = ?`, [`/uploads/avatars/${file}`, row.id]);
      }
      if (rows.length) console.log(`  - repointed ${rows.length} avatar(s) to /uploads/avatars/`);
    },
  },

  {
    id: '0012_subtask_assignee_triggers',
    description:
      'Triggers enforcing that a subtask assignee is an assignee of the same task. ' +
      '(data-model finding 4)',
    async up(conn) {
      // Clear rows that predate the rule, otherwise later updates to them fail.
      await conn.query(`
        UPDATE subtasks st
           SET st.assigned_to = NULL
         WHERE st.assigned_to IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM task_assignments ta
                            WHERE ta.task_id = st.task_id AND ta.member_id = st.assigned_to)
      `);
      await applyTriggers(conn);
    },
  },

  {
    id: '0013_peer_anonymity_view',
    description:
      'peer_assessments_anon: a view without assessor_id, which member-facing ' +
      'routes are required to use. (S7)',
    async up(conn) {
      await conn.query(`
        CREATE OR REPLACE VIEW peer_assessments_anon AS
        SELECT id, submission_id, cycle_id, assessee_id, kind, score, comment,
               vulgar_comment, created_at
          FROM peer_assessments
      `);
    },
  },
];
