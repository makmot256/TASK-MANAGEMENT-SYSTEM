-- ============================================================================
--  TASK MANAGEMENT SYSTEM  -  MySQL Schema
--  Organised by functional module (matches the SRS System Features)
--  Engine: InnoDB  |  Charset: utf8mb4  |  Referential integrity enforced
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
--  MODULE 1 : IDENTITY & ACCESS  (Authentication / RBAC)
--  Three user classes per SRS 2.3: admin, supervisor, member
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name     VARCHAR(120)    NOT NULL,
  email         VARCHAR(160)    NOT NULL,
  password_hash VARCHAR(255)    NOT NULL,
  role          ENUM('admin','supervisor','member') NOT NULL DEFAULT 'member',
  phone         VARCHAR(40)     NULL,
  title         VARCHAR(120)    NULL,
  avatar_color  VARCHAR(9)      NOT NULL DEFAULT '#2563eb',
  avatar_url    VARCHAR(255)    NULL,
  status        ENUM('active','inactive','pending') NOT NULL DEFAULT 'active',
  must_reset    TINYINT(1)      NOT NULL DEFAULT 0,
  created_by    BIGINT UNSIGNED NULL,
  last_login_at DATETIME        NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role),
  CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_resets (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  token      VARCHAR(128)    NOT NULL,
  expires_at DATETIME        NOT NULL,
  used       TINYINT(1)      NOT NULL DEFAULT 0,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reset_token (token),
  KEY idx_reset_user (user_id),
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SRS 5.2: log all login attempts (incl. failed) with timestamp + IP
CREATE TABLE IF NOT EXISTS login_audit (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NULL,
  email      VARCHAR(160)    NOT NULL,
  success    TINYINT(1)      NOT NULL,
  ip_address VARCHAR(64)     NULL,
  user_agent VARCHAR(255)    NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_user (user_id),
  KEY idx_audit_created (created_at),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
--  MODULE 2 : ORGANISATION  (Teams & supervision structure)
--  Teams may have multiple supervisors; members may belong to multiple teams.
-- ============================================================================

CREATE TABLE IF NOT EXISTS teams (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(120)    NOT NULL,
  description   VARCHAR(400)    NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_members (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  team_id   BIGINT UNSIGNED NOT NULL,
  member_id BIGINT UNSIGNED NOT NULL,
  joined_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_team_member (team_id, member_id),
  KEY idx_tm_member (member_id),
  CONSTRAINT fk_tm_team   FOREIGN KEY (team_id)   REFERENCES teams (id) ON DELETE CASCADE,
  CONSTRAINT fk_tm_member FOREIGN KEY (member_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lightweight team chat so members can collaborate in real time.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
--  MODULE 3 : TASK MANAGEMENT  (SRS 4.1)
--  Supervisor creates tasks -> assigns to members -> per-member status tracked
-- ============================================================================

CREATE TABLE IF NOT EXISTS tasks (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title       VARCHAR(200)    NOT NULL,
  description TEXT            NULL,
  priority    ENUM('Low','Medium','High') NOT NULL DEFAULT 'Medium',
  start_date  DATE            NULL,
  deadline    DATETIME        NULL,
  team_id     BIGINT UNSIGNED NULL,
  created_by  BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_task_creator (created_by),
  KEY idx_task_team (team_id),
  KEY idx_task_deadline (deadline),
  CONSTRAINT fk_task_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_task_team    FOREIGN KEY (team_id)    REFERENCES teams (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Briefing documents attached by supervisor when creating/assigning a task
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional checklist breakdown of a task (sub-tasks)
CREATE TABLE IF NOT EXISTS subtasks (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id     BIGINT UNSIGNED NOT NULL,
  title       VARCHAR(200)    NOT NULL,
  is_done     TINYINT(1)      NOT NULL DEFAULT 0,
  position    INT             NOT NULL DEFAULT 0,
  -- Members can subdivide a task and assign each piece to a teammate.
  assigned_to BIGINT UNSIGNED NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_subtask_task (task_id),
  KEY idx_subtask_assignee (assigned_to),
  CONSTRAINT fk_subtask_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT fk_subtask_assignee FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per (task, member). Each assignee tracks their own status.
CREATE TABLE IF NOT EXISTS task_assignments (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id      BIGINT UNSIGNED NOT NULL,
  member_id    BIGINT UNSIGNED NOT NULL,
  status       ENUM('To-Do','In Progress','Under Review','Completed') NOT NULL DEFAULT 'To-Do',
  assigned_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at   DATETIME        NULL,
  completed_at DATETIME        NULL,
  on_time      TINYINT(1)      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_assignment (task_id, member_id),
  KEY idx_assign_member (member_id),
  KEY idx_assign_status (status),
  CONSTRAINT fk_assign_task   FOREIGN KEY (task_id)   REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT fk_assign_member FOREIGN KEY (member_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Immutable audit of every status change (timestamps drive analytics)
CREATE TABLE IF NOT EXISTS task_status_history (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assignment_id BIGINT UNSIGNED NOT NULL,
  old_status    VARCHAR(20)     NULL,
  new_status    VARCHAR(20)     NOT NULL,
  changed_by    BIGINT UNSIGNED NULL,
  changed_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_history_assignment (assignment_id),
  CONSTRAINT fk_history_assignment FOREIGN KEY (assignment_id) REFERENCES task_assignments (id) ON DELETE CASCADE,
  CONSTRAINT fk_history_user       FOREIGN KEY (changed_by)    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
--  MODULE 4 : REPORTS & SUBMISSIONS  (SRS 4.1 submission + proof of work)
-- ============================================================================

CREATE TABLE IF NOT EXISTS submissions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id       BIGINT UNSIGNED NOT NULL,
  assignment_id BIGINT UNSIGNED NOT NULL,
  member_id     BIGINT UNSIGNED NOT NULL,
  content       TEXT            NULL,
  kind          ENUM('daily_log','weekly_report') NOT NULL DEFAULT 'weekly_report',
  is_late       TINYINT(1)      NOT NULL DEFAULT 0,
  revision_of   BIGINT UNSIGNED NULL,
  revision_requested_at DATETIME NULL,
  submitted_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sub_task (task_id),
  KEY idx_sub_member (member_id),
  KEY idx_sub_assignment (assignment_id),
  CONSTRAINT fk_sub_task       FOREIGN KEY (task_id)       REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_assignment FOREIGN KEY (assignment_id) REFERENCES task_assignments (id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_member     FOREIGN KEY (member_id)     REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_revision   FOREIGN KEY (revision_of)   REFERENCES submissions (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS submission_files (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(255)    NOT NULL,
  stored_name   VARCHAR(255)    NOT NULL,
  mime_type     VARCHAR(120)    NOT NULL,
  size_bytes    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  uploaded_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_file_submission (submission_id),
  CONSTRAINT fk_file_submission FOREIGN KEY (submission_id) REFERENCES submissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
--  MODULE 5 : FEEDBACK & COMMENTS  (SRS 4.1 supervisor comments)
--  Soft-delete + edit timestamp; multiple reviewers supported.
-- ============================================================================

CREATE TABLE IF NOT EXISTS report_comments (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id BIGINT UNSIGNED NOT NULL,
  author_id     BIGINT UNSIGNED NOT NULL,
  body          TEXT            NOT NULL,
  edited_at     DATETIME        NULL,
  deleted_at    DATETIME        NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_comment_submission (submission_id),
  KEY idx_comment_author (author_id),
  CONSTRAINT fk_comment_submission FOREIGN KEY (submission_id) REFERENCES submissions (id) ON DELETE CASCADE,
  CONSTRAINT fk_comment_author     FOREIGN KEY (author_id)     REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
--  MODULE 6 : PERFORMANCE MONITORING  (SRS 4.2 - Performance Index)
--  PI = w1*TP + w2*PE + w3*SA
--  TP <- Timeliness ; PE <- Peer Review + Collaboration ; SA <- Quality + Responsiveness
-- ============================================================================

-- Evaluation windows used for peer reviews + penalty logic
CREATE TABLE IF NOT EXISTS evaluation_cycles (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(120)    NOT NULL,
  start_date DATE            NOT NULL,
  end_date   DATE            NOT NULL,
  status     ENUM('open','closed') NOT NULL DEFAULT 'open',
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cycle_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Peer (cohort-wide) and Collaboration (immediate teammates) assessments.
-- One-directional anonymity is enforced at the API layer (not the schema).
CREATE TABLE IF NOT EXISTS peer_assessments (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cycle_id      BIGINT UNSIGNED NULL,
  submission_id BIGINT UNSIGNED NULL,
  assessor_id   BIGINT UNSIGNED NOT NULL,
  assessee_id   BIGINT UNSIGNED NOT NULL,
  kind          ENUM('peer_review','collaboration') NOT NULL,
  score         TINYINT UNSIGNED NOT NULL,
  comment       VARCHAR(600)    NULL,
  vulgar_comment TINYINT(1)      NOT NULL DEFAULT 0,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_assessment (cycle_id, assessor_id, assessee_id, kind),
  UNIQUE KEY uq_assess_submission (submission_id, assessor_id),
  KEY idx_assess_assessee (assessee_id),
  CONSTRAINT chk_assess_score CHECK (score BETWEEN 1 AND 5),
  CONSTRAINT fk_assess_cycle      FOREIGN KEY (cycle_id)      REFERENCES evaluation_cycles (id) ON DELETE SET NULL,
  CONSTRAINT fk_assess_submission FOREIGN KEY (submission_id) REFERENCES submissions (id) ON DELETE CASCADE,
  CONSTRAINT fk_assess_assessor   FOREIGN KEY (assessor_id)   REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_assess_assessee   FOREIGN KEY (assessee_id)   REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Submission-triggered peer review assignments (up to 3 reviewers per upload)
CREATE TABLE IF NOT EXISTS peer_review_assignments (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id BIGINT UNSIGNED NOT NULL,
  reviewer_id   BIGINT UNSIGNED NOT NULL,
  reviewee_id   BIGINT UNSIGNED NOT NULL,
  kind          ENUM('peer_review','collaboration') NOT NULL DEFAULT 'peer_review',
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quality + Responsiveness captured during the supervisor review workflow
CREATE TABLE IF NOT EXISTS supervisor_assessments (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id        BIGINT UNSIGNED NOT NULL,
  member_id            BIGINT UNSIGNED NOT NULL,
  supervisor_id        BIGINT UNSIGNED NOT NULL,
  quality_score        TINYINT UNSIGNED NOT NULL,  -- 0..5
  responsiveness_score TINYINT UNSIGNED NULL,      -- 0..5 (derived from turnaround)
  created_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sa_member (member_id),
  KEY idx_sa_submission (submission_id),
  CONSTRAINT fk_sa_submission FOREIGN KEY (submission_id) REFERENCES submissions (id) ON DELETE CASCADE,
  CONSTRAINT fk_sa_member     FOREIGN KEY (member_id)     REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_sa_supervisor FOREIGN KEY (supervisor_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Computed Performance Index snapshots (refreshed by background job)
CREATE TABLE IF NOT EXISTS performance_scores (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id       BIGINT UNSIGNED NOT NULL,
  cycle_id        BIGINT UNSIGNED NULL,
  tp              DECIMAL(6,4)    NOT NULL DEFAULT 0,
  pe              DECIMAL(6,4)    NOT NULL DEFAULT 0,
  sa              DECIMAL(6,4)    NOT NULL DEFAULT 0,
  pi              DECIMAL(6,4)    NOT NULL DEFAULT 0,
  timeliness      DECIMAL(6,4)    NOT NULL DEFAULT 0,
  penalty_applied TINYINT(1)      NOT NULL DEFAULT 0,
  computed_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_perf_member (member_id),
  KEY idx_perf_computed (computed_at),
  CONSTRAINT fk_perf_member FOREIGN KEY (member_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_perf_cycle  FOREIGN KEY (cycle_id)  REFERENCES evaluation_cycles (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
--  MODULE 7 : ML ENGAGEMENT MONITORING  (SRS 4.3)
--  Raw activity logs -> Engagement Score (0..100) -> at-risk flagging
-- ============================================================================

CREATE TABLE IF NOT EXISTS activity_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  action_type ENUM('login','task_update','submission','comment','view','peer_review') NOT NULL,
  meta        JSON            NULL,
  ip_address  VARCHAR(64)     NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_activity_user (user_id),
  KEY idx_activity_created (created_at),
  KEY idx_activity_type (action_type),
  CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS engagement_scores (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id             BIGINT UNSIGNED NOT NULL,
  score                 DECIMAL(5,2)    NULL,
  status                ENUM('on_track','moderate','at_risk','insufficient_data') NOT NULL DEFAULT 'insufficient_data',
  login_frequency       DECIMAL(5,2)    NOT NULL DEFAULT 0,
  task_update_frequency DECIMAL(5,2)    NOT NULL DEFAULT 0,
  submission_timeliness DECIMAL(5,2)    NOT NULL DEFAULT 0,
  is_flagged            TINYINT(1)      NOT NULL DEFAULT 0,
  computed_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_eng_member (member_id),
  KEY idx_eng_computed (computed_at),
  CONSTRAINT fk_eng_member FOREIGN KEY (member_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
--  MODULE 8 : NOTIFICATIONS  (in-app; email handled by mailer service)
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  type       VARCHAR(40)     NOT NULL,
  title      VARCHAR(160)    NOT NULL,
  body       VARCHAR(500)    NULL,
  link       VARCHAR(255)    NULL,
  is_read    TINYINT(1)      NOT NULL DEFAULT 0,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notif_user (user_id),
  KEY idx_notif_read (is_read),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
--  MODULE 9 : SYSTEM SETTINGS  (configurable weights, thresholds, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_settings (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  setting_key   VARCHAR(80)     NOT NULL,
  setting_value VARCHAR(255)    NOT NULL,
  description   VARCHAR(255)    NULL,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_setting_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
