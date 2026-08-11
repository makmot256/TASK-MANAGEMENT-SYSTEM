import { Router } from 'express';
import path from 'path';
import { pool, withTransaction } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { notify, logActivity } from '../utils/notify.js';
import { memberIdsForSupervisor } from '../utils/scope.js';
import { upload, uploadRoot, unlinkUploaded } from '../middleware/upload.js';

const router = Router();
router.use(authenticate);

const STATUSES = ['To-Do', 'In Progress', 'Under Review', 'Completed'];

function parseJsonArray(value, fieldName) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Allow newline-separated fallback for subtasks text fields.
      if (fieldName === 'subtasks') {
        return value.split('\n').map((s) => s.trim()).filter(Boolean);
      }
    }
  }
  throw new HttpError(400, `Invalid ${fieldName} payload.`);
}

// POST /api/tasks  (supervisor creates + assigns a task, optional briefing files)
router.post(
  '/',
  requireRole('supervisor', 'admin'),
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    const title = String(req.body.title || '').trim();
    const description = req.body.description || null;
    const priority = req.body.priority || 'Medium';
    const start_date = req.body.start_date || null;
    const deadline = req.body.deadline;
    const team_id = req.body.team_id || null;
    const member_ids = parseJsonArray(req.body.member_ids, 'member_ids').map(Number).filter(Boolean);
    const subtasks = parseJsonArray(req.body.subtasks, 'subtasks');

    if (!title || !deadline) throw new HttpError(400, 'Title and deadline are mandatory.');
    if (!member_ids.length) throw new HttpError(400, 'Assign the task to at least one member.');

    const files = req.files || [];

    let taskId;
    try {
      taskId = await withTransaction(async (conn) => {
      const [result] = await conn.execute(
        `INSERT INTO tasks (title, description, priority, start_date, deadline, team_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [title, description, priority, start_date, deadline, team_id, req.user.id]
      );
      const id = result.insertId;

      for (const memberId of member_ids) {
        const [a] = await conn.execute(
          `INSERT INTO task_assignments (task_id, member_id) VALUES (?, ?)`,
          [id, memberId]
        );
        await conn.execute(
          `INSERT INTO task_status_history (assignment_id, task_id, member_id, old_status, new_status, changed_by)
           VALUES (?, ?, ?, NULL, 'To-Do', ?)`,
          [a.insertId, id, memberId, req.user.id]
        );
      }

      let pos = 0;
      for (const st of subtasks) {
        const text = typeof st === 'string' ? st.trim() : String(st?.title || '').trim();
        if (text) {
          await conn.execute(`INSERT INTO subtasks (task_id, title, position) VALUES (?, ?, ?)`, [id, text, pos++]);
        }
      }

      for (const f of files) {
        await conn.execute(
          `INSERT INTO task_files (task_id, original_name, stored_name, mime_type, size_bytes)
           VALUES (?, ?, ?, ?, ?)`,
          [id, f.originalname, f.filename, f.mimetype, f.size]
        );
      }
      return id;
      });
    } catch (err) {
      // D4: multer writes to disk before the transaction opens, so a rollback
      // would otherwise leave the files orphaned and unreferenced.
      await unlinkUploaded(files);
      throw err;
    }

    const fileNote = files.length ? ` (${files.length} file${files.length === 1 ? '' : 's'} attached)` : '';
    for (const memberId of member_ids) {
      await notify(memberId, {
        type: 'task_assigned',
        title: 'New task assigned',
        body: `"${title}" is due ${new Date(deadline).toLocaleString()}${fileNote}`,
        link: `/tasks/${taskId}`,
      });
    }
    await logActivity(req.user.id, 'task_update', { action: 'create', taskId, files: files.length }, null);

    res.status(201).json({ id: taskId, message: 'Task created and assigned.', files: files.length });
  })
);

// GET /api/tasks  (role-scoped list)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    let sql;
    let params = [];
    if (req.user.role === 'member') {
      sql = `
        SELECT t.id, t.title, t.description, t.priority, t.start_date, t.deadline, t.created_at,
               ta.id AS assignment_id, ta.status, ta.completed_at, ta.on_time,
               creator.full_name AS created_by_name
        FROM task_assignments ta
        JOIN tasks t ON t.id = ta.task_id
        JOIN users creator ON creator.id = t.created_by
        WHERE ta.member_id = ?
        ORDER BY t.deadline IS NULL, t.deadline ASC`;
      params = [req.user.id];
    } else if (req.user.role === 'supervisor') {
      sql = `
        SELECT t.id, t.title, t.description, t.priority, t.start_date, t.deadline, t.created_at,
               COUNT(ta.id) AS assignee_count,
               SUM(ta.status = 'Completed') AS completed_count
        FROM tasks t
        LEFT JOIN task_assignments ta ON ta.task_id = t.id
        WHERE t.created_by = ?
        GROUP BY t.id
        ORDER BY t.deadline IS NULL, t.deadline ASC`;
      params = [req.user.id];
    } else {
      sql = `
        SELECT t.id, t.title, t.priority, t.deadline, t.created_at,
               COUNT(ta.id) AS assignee_count,
               SUM(ta.status = 'Completed') AS completed_count
        FROM tasks t LEFT JOIN task_assignments ta ON ta.task_id = t.id
        GROUP BY t.id ORDER BY t.created_at DESC`;
    }
    const [rows] = await pool.execute(sql, params);
    res.json({ tasks: rows });
  })
);

// GET /api/tasks/:id  (detail with assignments + subtasks)
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [tasks] = await pool.execute(
      `SELECT t.*, creator.full_name AS created_by_name, tm.name AS team_name
       FROM tasks t JOIN users creator ON creator.id = t.created_by
       LEFT JOIN teams tm ON tm.id = t.team_id WHERE t.id = ?`,
      [req.params.id]
    );
    if (!tasks.length) throw new HttpError(404, 'Task not found.');
    const task = tasks[0];

    const [assignments] = await pool.execute(
      `SELECT ta.id, ta.member_id, ta.status, ta.started_at, ta.completed_at, ta.on_time,
              u.full_name, u.avatar_color
       FROM task_assignments ta JOIN users u ON u.id = ta.member_id WHERE ta.task_id = ?`,
      [req.params.id]
    );

    // Scope enforcement
    if (req.user.role === 'member' && !assignments.some((a) => a.member_id === req.user.id))
      throw new HttpError(403, 'You are not assigned to this task.');
    if (req.user.role === 'supervisor' && task.created_by !== req.user.id) {
      const ids = await memberIdsForSupervisor(req.user.id);
      if (!assignments.some((a) => ids.includes(a.member_id))) throw new HttpError(403, 'Not in your scope.');
    }

    const [subtasks] = await pool.execute(
      `SELECT st.id, st.title, st.is_done, st.position, st.assigned_to,
              u.full_name AS assignee_name, u.avatar_color AS assignee_color
         FROM subtasks st LEFT JOIN users u ON u.id = st.assigned_to
        WHERE st.task_id = ? ORDER BY st.position`,
      [req.params.id]
    );
    const [files] = await pool.execute(
      `SELECT id, original_name, mime_type, size_bytes, uploaded_at
         FROM task_files WHERE task_id = ? ORDER BY uploaded_at`,
      [req.params.id]
    );
    res.json({ task, assignments, subtasks, files });
  })
);

// GET /api/tasks/:taskId/files/:fileId  (download briefing attachment)
router.get(
  '/:taskId/files/:fileId',
  asyncHandler(async (req, res) => {
    const [files] = await pool.execute(
      `SELECT f.*, t.created_by
         FROM task_files f
         JOIN tasks t ON t.id = f.task_id
        WHERE f.id = ? AND f.task_id = ?`,
      [req.params.fileId, req.params.taskId]
    );
    if (!files.length) throw new HttpError(404, 'File not found.');
    const file = files[0];

    if (req.user.role === 'member') {
      const [asg] = await pool.execute(
        `SELECT id FROM task_assignments WHERE task_id = ? AND member_id = ? LIMIT 1`,
        [req.params.taskId, req.user.id]
      );
      if (!asg.length) throw new HttpError(403, 'You are not assigned to this task.');
    } else if (req.user.role === 'supervisor' && file.created_by !== req.user.id) {
      const ids = await memberIdsForSupervisor(req.user.id);
      const [asg] = await pool.execute(
        `SELECT member_id FROM task_assignments WHERE task_id = ?`,
        [req.params.taskId]
      );
      if (!asg.some((a) => ids.includes(a.member_id))) throw new HttpError(403, 'Not in your scope.');
    }

    res.download(path.join(uploadRoot, file.stored_name), file.original_name);
  })
);

// PATCH /api/tasks/:id/status  (member updates own assignment status) -- SRS UC2
router.patch(
  '/:id/status',
  requireRole('member'),
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status value.');

    const [rows] = await pool.execute(
      `SELECT ta.id, ta.status, t.deadline, t.title, t.created_by
       FROM task_assignments ta JOIN tasks t ON t.id = ta.task_id
       WHERE ta.task_id = ? AND ta.member_id = ? LIMIT 1`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) throw new HttpError(403, 'You are not assigned to this task.');
    const a = rows[0];

    let extra = '';
    const params = [status, req.params.id, req.user.id];
    if (status === 'In Progress' && a.status === 'To-Do') extra = ', started_at = NOW()';
    if (status === 'Completed') {
      const onTime = a.deadline ? (new Date() <= new Date(a.deadline) ? 1 : 0) : 1;
      extra = `, completed_at = NOW(), on_time = ${onTime}`;
    }
    await pool.execute(
      `UPDATE task_assignments SET status = ?${extra} WHERE task_id = ? AND member_id = ?`,
      params
    );
    await pool.execute(
      `INSERT INTO task_status_history (assignment_id, task_id, member_id, old_status, new_status, changed_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [a.id, req.params.id, req.user.id, a.status, status, req.user.id]
    );
    await logActivity(req.user.id, 'task_update', { taskId: req.params.id, status }, null);
    await notify(a.created_by, {
      type: 'status_update',
      title: 'Task status updated',
      body: `${req.user.full_name} moved "${a.title}" to ${status}`,
      link: `/tasks/${req.params.id}`,
    });
    res.json({ message: 'Status updated.' });
  })
);

// PATCH /api/tasks/:id  (supervisor edits task)
router.patch(
  '/:id',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    const taskId = Number(req.params.id);
    const { title, description, priority, start_date, deadline, member_ids, subtasks } = req.body;

    const [existing] = await pool.execute(`SELECT id, title, created_by FROM tasks WHERE id = ?`, [taskId]);
    if (!existing.length) throw new HttpError(404, 'Task not found.');
    if (req.user.role === 'supervisor' && existing[0].created_by !== req.user.id) {
      throw new HttpError(403, 'You can only edit tasks you created.');
    }

    await withTransaction(async (conn) => {
      await conn.execute(
        `UPDATE tasks SET title = COALESCE(?, title), description = ?, priority = COALESCE(?, priority),
                start_date = ?, deadline = COALESCE(?, deadline) WHERE id = ?`,
        [title || null, description ?? null, priority || null, start_date || null, deadline || null, taskId]
      );

      if (Array.isArray(member_ids)) {
        // D3: normalise once, up front. The two comparisons below used to be
        // asymmetric — one coerced with Number(), the other did not — so a
        // payload of strings made toRemove the entire current roster while toAdd
        // correctly skipped them, unassigning everyone.
        const requested = [...new Set(member_ids.map(Number).filter(Boolean))];
        if (requested.length === 0) throw new HttpError(400, 'Assign the task to at least one member.');

        const [current] = await conn.execute(
          `SELECT member_id FROM task_assignments WHERE task_id = ?`,
          [taskId]
        );
        const currentIds = current.map((r) => Number(r.member_id));
        const toAdd = requested.filter((m) => !currentIds.includes(m));
        const toRemove = currentIds.filter((m) => !requested.includes(m));

        for (const memberId of toRemove) {
          // D1: task_assignments cascades to submissions, their files, every
          // supervisor comment, every peer assessment on them, and the peer
          // review obligations other members still owe. Removing an assignee who
          // has submitted work therefore destroyed it irreversibly, from an
          // editing action that reads as low-stakes.
          const [[{ n }]] = await conn.query(
            `SELECT COUNT(*) AS n FROM submissions s
               JOIN task_assignments ta ON ta.id = s.assignment_id
              WHERE ta.task_id = ? AND ta.member_id = ?`,
            [taskId, memberId]
          );
          if (n > 0) {
            const [[who]] = await conn.query(`SELECT full_name FROM users WHERE id = ?`, [memberId]);
            throw new HttpError(
              409,
              `${who?.full_name || 'That member'} has already submitted work for this task and cannot be unassigned. ` +
                'Delete the task instead if you really mean to discard it.'
            );
          }
          await conn.execute(`DELETE FROM task_assignments WHERE task_id = ? AND member_id = ?`, [taskId, memberId]);
        }
        for (const memberId of toAdd) {
          const [a] = await conn.execute(
            `INSERT INTO task_assignments (task_id, member_id) VALUES (?, ?)`,
            [taskId, memberId]
          );
          await conn.execute(
            `INSERT INTO task_status_history (assignment_id, task_id, member_id, old_status, new_status, changed_by)
             VALUES (?, ?, ?, NULL, 'To-Do', ?)`,
            [a.insertId, taskId, memberId, req.user.id]
          );
          await notify(memberId, {
            type: 'task_assigned',
            title: 'Task assigned to you',
            body: `You were added to "${title || existing[0].title}"`,
            link: `/tasks/${taskId}`,
          });
        }
      }

      if (Array.isArray(subtasks)) {
        // D2: reconcile by id instead of delete-and-recreate. Subtasks used to be
        // addressed by title string, so editing one typo silently un-checked the
        // team's completed items and dropped every sub-assignment.
        //
        // Accepts { id?, title, is_done?, assigned_to? } and, for backwards
        // compatibility, a bare string (treated as a new subtask).
        const incoming = subtasks
          .map((st) => (typeof st === 'string' ? { title: st } : st || {}))
          .map((st) => ({
            id: st.id ? Number(st.id) : null,
            title: String(st.title ?? '').trim(),
            is_done: st.is_done === undefined ? null : (st.is_done ? 1 : 0),
            assigned_to: st.assigned_to === undefined ? undefined : (st.assigned_to ? Number(st.assigned_to) : null),
          }))
          .filter((st) => st.title);

        const [existingSubtasks] = await conn.execute(
          `SELECT id FROM subtasks WHERE task_id = ?`,
          [taskId]
        );
        const existingIds = new Set(existingSubtasks.map((r) => Number(r.id)));
        const keptIds = new Set(incoming.map((st) => st.id).filter((id) => id && existingIds.has(id)));

        for (const row of existingSubtasks) {
          if (!keptIds.has(Number(row.id))) {
            await conn.execute(`DELETE FROM subtasks WHERE id = ?`, [row.id]);
          }
        }

        let pos = 0;
        for (const st of incoming) {
          if (st.id && existingIds.has(st.id)) {
            const sets = ['title = ?', 'position = ?'];
            const params = [st.title, pos];
            if (st.is_done !== null) { sets.push('is_done = ?'); params.push(st.is_done); }
            if (st.assigned_to !== undefined) { sets.push('assigned_to = ?'); params.push(st.assigned_to); }
            params.push(st.id);
            await conn.execute(`UPDATE subtasks SET ${sets.join(', ')} WHERE id = ?`, params);
          } else {
            await conn.execute(
              `INSERT INTO subtasks (task_id, title, position, is_done, assigned_to) VALUES (?, ?, ?, ?, ?)`,
              [taskId, st.title, pos, st.is_done ?? 0, st.assigned_to ?? null]
            );
          }
          pos += 1;
        }
      }
    });

    res.json({ message: 'Task updated.' });
  })
);

// DELETE /api/tasks/:id
router.delete(
  '/:id',
  requireRole('supervisor', 'admin'),
  asyncHandler(async (req, res) => {
    // D6: this used to report success even when it matched zero rows, so a
    // supervisor deleting someone else's task saw "Task deleted." and the item
    // reappeared on refresh.
    const [existing] = await pool.execute(`SELECT id FROM tasks WHERE id = ?`, [req.params.id]);
    if (!existing.length) throw new HttpError(404, 'Task not found.');

    // D4: remove the files from disk too. The row cascade never touched them.
    const [files] = await pool.execute(
      `SELECT stored_name FROM task_files WHERE task_id = ?
        UNION ALL
       SELECT sf.stored_name FROM submission_files sf
         JOIN submissions s ON s.id = sf.submission_id
        WHERE s.task_id = ?`,
      [req.params.id, req.params.id]
    );

    const [r] = await pool.execute(`DELETE FROM tasks WHERE id = ? AND (created_by = ? OR ? = 'admin')`, [
      req.params.id, req.user.id, req.user.role,
    ]);
    if (r.affectedRows === 0) throw new HttpError(403, 'You can only delete tasks you created.');

    await unlinkUploaded(files.map((f) => ({ filename: f.stored_name })));
    res.json({ message: 'Task deleted.' });
  })
);

// Returns the member ids assigned to a task (its collaborators).
async function taskAssigneeIds(taskId) {
  const [rows] = await pool.execute(`SELECT member_id FROM task_assignments WHERE task_id = ?`, [taskId]);
  return rows.map((r) => r.member_id);
}

// True if the requester may manage a task's subdivision (an assignee, the
// supervisor who created it, or an admin).
async function canManageSubtasks(user, taskId) {
  if (user.role === 'admin') return true;
  const [t] = await pool.execute(`SELECT created_by FROM tasks WHERE id = ?`, [taskId]);
  if (!t.length) return false;
  if (user.role === 'supervisor' && t[0].created_by === user.id) return true;
  const ids = await taskAssigneeIds(taskId);
  return ids.includes(user.id);
}

// POST /api/tasks/:id/subtasks  (assignee subdivides a task and assigns a teammate)
router.post(
  '/:id/subtasks',
  asyncHandler(async (req, res) => {
    const { title, assigned_to } = req.body;
    if (!title || !title.trim()) throw new HttpError(400, 'Subtask title is required.');
    if (!(await canManageSubtasks(req.user, req.params.id)))
      throw new HttpError(403, 'You are not part of this task.');

    let assignee = null;
    if (assigned_to) {
      const ids = await taskAssigneeIds(req.params.id);
      if (!ids.includes(Number(assigned_to)))
        throw new HttpError(400, 'You can only assign a subtask to someone working on this task.');
      assignee = Number(assigned_to);
    }

    const [[{ maxPos }]] = await pool.execute(
      `SELECT COALESCE(MAX(position), -1) + 1 AS maxPos FROM subtasks WHERE task_id = ?`,
      [req.params.id]
    );
    const [r] = await pool.execute(
      `INSERT INTO subtasks (task_id, title, position, assigned_to) VALUES (?, ?, ?, ?)`,
      [req.params.id, title.trim(), maxPos, assignee]
    );

    if (assignee && assignee !== req.user.id) {
      await notify(assignee, {
        type: 'subtask_assigned',
        title: 'A teammate assigned you part of a task',
        body: `${req.user.full_name}: "${title.trim()}"`,
        link: `/tasks/${req.params.id}`,
      });
    }
    res.status(201).json({ id: r.insertId, message: 'Subtask added.' });
  })
);

// PATCH /api/tasks/subtasks/:subtaskId  (toggle done and/or reassign)
router.patch(
  '/subtasks/:subtaskId',
  asyncHandler(async (req, res) => {
    const { is_done, assigned_to } = req.body;
    const [rows] = await pool.execute(`SELECT task_id FROM subtasks WHERE id = ?`, [req.params.subtaskId]);
    if (!rows.length) throw new HttpError(404, 'Subtask not found.');
    const taskId = rows[0].task_id;
    if (!(await canManageSubtasks(req.user, taskId))) throw new HttpError(403, 'You are not part of this task.');

    const fields = [];
    const params = [];
    if (is_done !== undefined) { fields.push('is_done = ?'); params.push(is_done ? 1 : 0); }
    if (assigned_to !== undefined) {
      let assignee = null;
      if (assigned_to) {
        const ids = await taskAssigneeIds(taskId);
        if (!ids.includes(Number(assigned_to)))
          throw new HttpError(400, 'You can only assign a subtask to someone working on this task.');
        assignee = Number(assigned_to);
      }
      fields.push('assigned_to = ?'); params.push(assignee);
    }
    if (!fields.length) throw new HttpError(400, 'Nothing to update.');
    params.push(req.params.subtaskId);
    await pool.execute(`UPDATE subtasks SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ message: 'Subtask updated.' });
  })
);

// DELETE /api/tasks/subtasks/:subtaskId
router.delete(
  '/subtasks/:subtaskId',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(`SELECT task_id FROM subtasks WHERE id = ?`, [req.params.subtaskId]);
    if (!rows.length) return res.json({ message: 'Subtask deleted.' });
    if (!(await canManageSubtasks(req.user, rows[0].task_id))) throw new HttpError(403, 'You are not part of this task.');
    await pool.execute(`DELETE FROM subtasks WHERE id = ?`, [req.params.subtaskId]);
    res.json({ message: 'Subtask deleted.' });
  })
);

export default router;
