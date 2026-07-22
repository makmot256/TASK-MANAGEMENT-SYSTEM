import React, { useEffect, useState } from 'react';
import { api, errMsg, downloadFile } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Modal, Avatar, PriorityBadge, StatusBadge, fmtDate, fmtDateTime, Loader, EmptyState, Spinner } from '../../components/ui';
import { IcoPlus, IcoTasks, IcoTrash, IcoUpload, IcoFile } from '../../lib/icons';

const emptyForm = {
  title: '',
  description: '',
  priority: 'Medium',
  start_date: '',
  deadline: '',
  member_ids: [] as number[],
  subtasks: '',
};

const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB
const fmtSize = (b: number) =>
  b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

export default function SupervisorTasks() {
  const toast = useToast();
  const [tasks, setTasks] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<{ task: any; assignments: any[]; subtasks: any[]; files?: any[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>({ ...emptyForm });
  const [attachFiles, setAttachFiles] = useState<File[]>([]);

  const load = async () => {
    const [t, m] = await Promise.all([api.get('/tasks'), api.get('/users/members')]);
    setTasks(t.data.tasks);
    setMembers(m.data.members);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggleMember = (id: number) =>
    setForm((f: any) => ({
      ...f,
      member_ids: f.member_ids.includes(id) ? f.member_ids.filter((x: number) => x !== id) : [...f.member_ids, id],
    }));

  const openCreate = () => {
    setForm({ ...emptyForm });
    setAttachFiles([]);
    setCreateOpen(true);
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const tooBig = incoming.find((f) => f.size > MAX_BYTES);
    if (tooBig) toast(`"${tooBig.name}" exceeds the 1 GB limit.`, 'error');
    const ok = incoming.filter((f) => f.size <= MAX_BYTES);
    setAttachFiles((prev) => {
      const names = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...ok.filter((f) => !names.has(f.name + f.size))];
    });
  };

  const openTask = async (taskId: number) => {
    setDetail(null);
    setDetailLoading(true);
    try {
      const { data } = await api.get(`/tasks/${taskId}`);
      setDetail(data);
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => setDetail(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = new FormData();
      body.append('title', form.title);
      body.append('description', form.description || '');
      body.append('priority', form.priority);
      if (form.start_date) body.append('start_date', form.start_date);
      body.append('deadline', form.deadline);
      body.append('member_ids', JSON.stringify(form.member_ids));
      body.append(
        'subtasks',
        JSON.stringify(String(form.subtasks || '').split('\n').map((s: string) => s.trim()).filter(Boolean))
      );
      attachFiles.forEach((f) => body.append('files', f));

      await api.post('/tasks', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast(
        attachFiles.length
          ? `Task created with ${attachFiles.length} file${attachFiles.length === 1 ? '' : 's'} attached.`
          : 'Task created and assigned.',
        'success'
      );
      setCreateOpen(false);
      setForm({ ...emptyForm });
      setAttachFiles([]);
      load();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this task?')) return;
    await api.delete(`/tasks/${id}`);
    toast('Task deleted.', 'success');
    if (detail?.task?.id === id) closeDetail();
    load();
  };

  const downloadTaskFile = async (taskId: number, f: any) => {
    try {
      await downloadFile(`/tasks/${taskId}/files/${f.id}`, f.original_name);
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  };

  const detailOpen = detailLoading || detail !== null;

  return (
    <div className="page">
      <div className="row between wrap">
        <div><h1 className="page-title">Tasks</h1><p className="page-sub">Create, assign and track tasks across your team. Click a task to view details.</p></div>
        <button className="btn btn-primary" onClick={openCreate}><IcoPlus size={16} /> New task</button>
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        {loading ? <div className="card-pad"><Loader /></div> : tasks.length === 0 ? (
          <EmptyState icon={<IcoTasks size={56} />} title="No tasks yet" sub="Create your first task to get started." />
        ) : (
          <table className="table">
            <thead><tr><th>Task</th><th>Priority</th><th>Assignees</th><th>Progress</th><th>Deadline</th><th></th></tr></thead>
            <tbody>
              {tasks.map((t) => {
                const total = Number(t.assignee_count) || 0;
                const done = Number(t.completed_count) || 0;
                return (
                  <tr key={t.id} onClick={() => openTask(t.id)} style={{ cursor: 'pointer' }} title="Click to view details">
                    <td style={{ fontWeight: 600 }}>{t.title}</td>
                    <td><PriorityBadge priority={t.priority} /></td>
                    <td>{total}</td>
                    <td><div className="row" style={{ gap: 8 }}><div className="progress" style={{ width: 80 }}><span style={{ width: total ? `${(done / total) * 100}%` : '0%' }} /></div><span className="tiny">{done}/{total}</span></div></td>
                    <td className="muted">{fmtDate(t.deadline)}</td>
                    <td><button className="icon-btn" onClick={(e) => del(t.id, e)} title="Delete"><IcoTrash size={15} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <Modal
          title="Create new task"
          onClose={() => setCreateOpen(false)}
          wide
          footer={(
            <>
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? <Spinner /> : 'Save'}
              </button>
              <button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
            </>
          )}
        >
          <form onSubmit={save}>
            <div className="field">
              <label className="label">Title *</label>
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Implement login API" required />
            </div>
            <div className="field">
              <label className="label">Description</label>
              <textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-3">
              <div className="field">
                <label className="label">Priority</label>
                <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option>High</option><option>Medium</option><option>Low</option>
                </select>
              </div>
              <div className="field">
                <label className="label">Start date</label>
                <input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div className="field">
                <label className="label">Deadline *</label>
                <input className="input" type="datetime-local" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} required />
              </div>
            </div>
            <div className="field">
              <label className="label">Assign to members * ({form.member_ids.length} selected)</label>
              <div className="grid grid-2" style={{ gap: 8, maxHeight: 180, overflowY: 'auto' }}>
                {members.map((m) => (
                  <div
                    key={m.id}
                    className="card"
                    style={{
                      padding: 10,
                      cursor: 'pointer',
                      borderColor: form.member_ids.includes(m.id) ? 'var(--brand)' : 'var(--border)',
                      background: form.member_ids.includes(m.id) ? 'var(--brand-soft)' : 'var(--surface)',
                    }}
                    onClick={() => toggleMember(m.id)}
                  >
                    <div className="row" style={{ gap: 8 }}>
                      <Avatar name={m.full_name} color={m.avatar_color} size="sm" />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{m.full_name}</span>
                    </div>
                  </div>
                ))}
                {members.length === 0 && <p className="tiny">No members in your team yet.</p>}
              </div>
            </div>

            <div className="field">
              <label className="label">Attach documents for members</label>
              <p className="tiny" style={{ marginBottom: 8 }}>
                Optional briefing files (PDF or DOCX). Assigned members can download these from the task.
              </p>
              {attachFiles.length > 0 && (
                <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
                  {attachFiles.map((f, i) => (
                    <div key={`${f.name}-${f.size}`} className="row between" style={{ gap: 8 }}>
                      <span className="row" style={{ gap: 8, minWidth: 0 }}>
                        <IcoFile size={15} />
                        <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.name}
                        </span>
                        <span className="tiny">{fmtSize(f.size)}</span>
                      </span>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setAttachFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        title="Remove"
                      >
                        <IcoTrash size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', width: 'fit-content' }}>
                <IcoUpload size={15} /> {attachFiles.length ? 'Add more files' : 'Attach files'}
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  multiple
                  hidden
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
                />
              </label>
            </div>

            <div className="field">
              <label className="label">Subtasks (one per line)</label>
              <textarea
                className="textarea"
                value={form.subtasks}
                onChange={(e) => setForm({ ...form, subtasks: e.target.value })}
                placeholder={'Plan approach\nImplement\nReview'}
              />
            </div>
          </form>
        </Modal>
      )}

      {detailOpen && (
        <Modal
          title={detail?.task?.title || 'Task details'}
          onClose={closeDetail}
          wide
          footer={<button className="btn btn-ghost" onClick={closeDetail}>Close</button>}
        >
          {detailLoading ? (
            <Loader />
          ) : detail ? (
            <div style={{ display: 'grid', gap: 20 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <PriorityBadge priority={detail.task.priority} />
                {detail.task.team_name && <span className="badge badge-brand">{detail.task.team_name}</span>}
              </div>

              <div>
                <div className="label" style={{ marginBottom: 6 }}>Description</div>
                <p className="muted" style={{ lineHeight: 1.6, margin: 0 }}>
                  {detail.task.description || 'No description provided.'}
                </p>
              </div>

              <div className="grid grid-3">
                <div>
                  <div className="label">Start date</div>
                  <div style={{ fontWeight: 600 }}>{fmtDate(detail.task.start_date)}</div>
                </div>
                <div>
                  <div className="label">Deadline</div>
                  <div style={{ fontWeight: 600 }}>{fmtDateTime(detail.task.deadline)}</div>
                </div>
                <div>
                  <div className="label">Created by</div>
                  <div style={{ fontWeight: 600 }}>{detail.task.created_by_name}</div>
                </div>
              </div>

              <div>
                <div className="label" style={{ marginBottom: 10 }}>
                  Attached documents ({(detail.files || []).length})
                </div>
                {(detail.files || []).length === 0 ? (
                  <p className="tiny muted">No documents attached to this task.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {(detail.files || []).map((f: any) => (
                      <button
                        key={f.id}
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ justifyContent: 'flex-start', width: 'fit-content' }}
                        onClick={() => downloadTaskFile(detail.task.id, f)}
                      >
                        <IcoFile size={15} /> {f.original_name} ({fmtSize(Number(f.size_bytes) || 0)})
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="label" style={{ marginBottom: 10 }}>
                  Assigned members ({detail.assignments.length})
                </div>
                {detail.assignments.length === 0 ? (
                  <p className="tiny muted">No members assigned.</p>
                ) : (
                  <div className="grid grid-2" style={{ gap: 8 }}>
                    {detail.assignments.map((a) => (
                      <div key={a.id} className="card" style={{ padding: 10 }}>
                        <div className="row between wrap" style={{ gap: 8 }}>
                          <div className="row" style={{ gap: 8 }}>
                            <Avatar name={a.full_name} color={a.avatar_color} size="sm" />
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{a.full_name}</span>
                          </div>
                          <StatusBadge status={a.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="label" style={{ marginBottom: 10 }}>
                  Subtasks ({detail.subtasks.length})
                </div>
                {detail.subtasks.length === 0 ? (
                  <p className="tiny muted">No subtasks.</p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
                    {detail.subtasks.map((s) => (
                      <li key={s.id} style={{ color: s.is_done ? 'var(--muted)' : 'inherit', textDecoration: s.is_done ? 'line-through' : 'none' }}>
                        {s.title}
                        {s.assignee_name && (
                          <span className="tiny muted"> · {s.assignee_name}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </Modal>
      )}
    </div>
  );
}
