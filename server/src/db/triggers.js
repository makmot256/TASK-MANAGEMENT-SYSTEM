// Trigger DDL, kept out of schema.sql because that file is executed with
// `multipleStatements: true`, which splits on ';' — and a compound trigger body
// contains its own semicolons. Each statement here is issued individually.
//
// Invariant enforced: a subtask may only be handed to a member who is already
// an assignee of the same task. This cannot be expressed as a composite foreign
// key, because subtasks.task_id is NOT NULL and ON DELETE SET NULL requires
// every referencing column to be nullable.

const GUARD = `
  IF NEW.assigned_to IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM task_assignments ta
                      WHERE ta.task_id = NEW.task_id AND ta.member_id = NEW.assigned_to) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Subtask assignee must be assigned to the same task.';
  END IF;`;

export const TRIGGER_STATEMENTS = [
  `DROP TRIGGER IF EXISTS trg_subtask_assignee_insert`,
  `DROP TRIGGER IF EXISTS trg_subtask_assignee_update`,
  `CREATE TRIGGER trg_subtask_assignee_insert
     BEFORE INSERT ON subtasks FOR EACH ROW
     BEGIN${GUARD}
     END`,
  `CREATE TRIGGER trg_subtask_assignee_update
     BEFORE UPDATE ON subtasks FOR EACH ROW
     BEGIN${GUARD}
     END`,
];

/** Applies (or re-applies) every trigger. Idempotent. */
export async function applyTriggers(conn) {
  for (const stmt of TRIGGER_STATEMENTS) {
    await conn.query(stmt);
  }
}
