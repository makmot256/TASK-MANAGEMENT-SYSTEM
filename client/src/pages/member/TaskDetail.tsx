import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, errMsg, downloadFile } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { StatusBadge, PriorityBadge, Avatar, fmtDateTime, Loader, Spinner } from '../../components/ui';
import { IcoUpload, IcoCheck, IcoFile, IcoPlus, IcoTrash } from '../../lib/icons';
import type { TaskStatus } from '../../types';

const COLUMNS: TaskStatus[] = ['To-Do', 'In Progress', 'Under Review', 'Completed'];

export default function TaskDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB per file
  const fmtSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const tooBig = incoming.find((f) => f.size > MAX_BYTES);
    if (tooBig) { toast(`"${tooBig.name}" exceeds the 1 GB limit.`, 'error'); }
    const ok = incoming.filter((f) => f.size <= MAX_BYTES);
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...ok.filter((f) => !names.has(f.name + f.size))];
    });
  };
  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));
  const [subTitle, setSubTitle] = useState('');
  const [subAssignee, setSubAssignee] = useState('');

  const load = async () => {
    const { data } = await api.get(`/tasks/${id}`);
    setData(data);
  };
  useEffect(() => { load(); }, [id]);

  if (!data) return <div className="page"><Loader /></div>;
  const me = data.assignments[0]; // member sees own assignment first
  const myAssign = data.assignments.find((a: any) => a) || me;

  const setStatus = async (status: TaskStatus) => {
    try {
      await api.patch(`/tasks/${id}/status`, { status });
      toast(`Status updated to ${status}`, 'success');
      load();
    } catch (err) { toast(errMsg(err), 'error'); }
  };

  const toggleSub = async (st: any) => {
    await api.patch(`/tasks/subtasks/${st.id}`, { is_done: !st.is_done });
    load();
  };

  const addSub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subTitle.trim()) return;
    try {
      await api.post(`/tasks/${id}/subtasks`, { title: subTitle.trim(), assigned_to: subAssignee || null });
      setSubTitle(''); setSubAssignee('');
      toast('Work item added.', 'success');
      load();
    } catch (err) { toast(errMsg(err), 'error'); }
  };

  const reassignSub = async (st: any, assigned_to: string) => {
    try { await api.patch(`/tasks/subtasks/${st.id}`, { assigned_to: assigned_to || null }); load(); }
    catch (err) { toast(errMsg(err), 'error'); }
  };

  const deleteSub = async (st: any) => {
    try { await api.delete(`/tasks/subtasks/${st.id}`); load(); }
    catch (err) { toast(errMsg(err), 'error'); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content && files.length === 0) { toast('Add a report or attach a file.', 'error'); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('task_id', String(id));
      form.append('content', content);
      files.forEach((f) => form.append('files', f));
      await api.post('/submissions', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast('Report submitted!', 'success');
      setContent(''); setFiles([]);
      load();
    } catch (err) { toast(errMsg(err), 'error'); } finally { setBusy(false); }
  };

  const t = data.task;

  return (
    <div className="page">
      <a onClick={() => nav('/tasks')} style={{ cursor: 'pointer', fontSize: 14 }}>← Back to tasks</a>
      <div className="row between wrap" style={{ marginTop: 12 }}>
        <div>
          <h1 className="page-title">{t.title}</h1>
          <div className="row" style={{ gap: 8, marginTop: 8 }}><PriorityBadge priority={t.priority} /><StatusBadge status={myAssign?.status || 'To-Do'} /><span className="muted" style={{ fontSize: 14 }}>Due {fmtDateTime(t.deadline)}</span></div>
        </div>
      </div>

      <div className="grid responsive-split" style={{ gridTemplateColumns: '1.5fr 1fr', marginTop: 20 }}>
        <div style={{ display: 'grid', gap: 18 }}>
          <div className="card card-pad">
            <h3 className="card-title" style={{ marginBottom: 12 }}>Description</h3>
            <p className="muted" style={{ lineHeight: 1.6 }}>{t.description || 'No description provided.'}</p>
            <div className="divider" />
            <div className="row" style={{ gap: 8 }}><span className="muted" style={{ fontSize: 14 }}>Assigned by</span><strong style={{ fontSize: 14 }}>{t.created_by_name}</strong>{t.team_name && <span className="badge badge-brand">{t.team_name}</span>}</div>
          </div>

          {(data.files || []).length > 0 && (
            <div className="card card-pad">
              <h3 className="card-title" style={{ marginBottom: 12 }}>
                Documents from supervisor ({data.files.length})
              </h3>
              <p className="tiny" style={{ marginBottom: 10 }}>Download briefing files attached to this assignment.</p>
              <div style={{ display: 'grid', gap: 8 }}>
                {data.files.map((f: any) => (
                  <button
                    key={f.id}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ justifyContent: 'flex-start', width: 'fit-content' }}
                    onClick={async () => {
                      try {
                        await downloadFile(`/tasks/${id}/files/${f.id}`, f.original_name);
                      } catch (err) {
                        toast(errMsg(err), 'error');
                      }
                    }}
                  >
                    <IcoFile size={15} /> {f.original_name} ({fmtSize(Number(f.size_bytes) || 0)})
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="card card-pad">
            <div className="row between" style={{ marginBottom: 4 }}>
              <h3 className="card-title">Subdivide work</h3>
              {data.assignments.length > 1 && <span className="tiny">Split this task and assign pieces to teammates</span>}
            </div>
            {data.subtasks.length === 0 && <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>No work items yet. Break the task into smaller pieces below.</p>}
            {data.subtasks.map((st: any) => (
              <div key={st.id} className="row between" style={{ gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="row" style={{ gap: 10, minWidth: 0, flex: 1, cursor: 'pointer' }} onClick={() => toggleSub(st)}>
                  <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 6, border: '2px solid', display: 'grid', placeItems: 'center', background: st.is_done ? 'var(--green)' : 'transparent', borderColor: st.is_done ? 'var(--green)' : 'var(--border-strong)' }}>{st.is_done ? <IcoCheck size={13} /> : null}</span>
                  <span style={{ textDecoration: st.is_done ? 'line-through' : 'none', color: st.is_done ? 'var(--text-3)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.title}</span>
                </div>
                <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                  <select className="select" style={{ height: 32, padding: '0 8px', fontSize: 12, maxWidth: 150 }} value={st.assigned_to || ''} onChange={(e) => reassignSub(st, e.target.value)}>
                    <option value="">Unassigned</option>
                    {data.assignments.map((a: any) => <option key={a.member_id} value={a.member_id}>{a.full_name}</option>)}
                  </select>
                  <button className="icon-btn" title="Remove" onClick={() => deleteSub(st)}><IcoTrash size={14} /></button>
                </div>
              </div>
            ))}
            <form onSubmit={addSub} className="row" style={{ gap: 8, marginTop: 14 }}>
              <input className="input" style={{ flex: 1 }} placeholder="Add a work item..." value={subTitle} onChange={(e) => setSubTitle(e.target.value)} />
              <select className="select" style={{ maxWidth: 150 }} value={subAssignee} onChange={(e) => setSubAssignee(e.target.value)}>
                <option value="">Assign to…</option>
                {data.assignments.map((a: any) => <option key={a.member_id} value={a.member_id}>{a.full_name}</option>)}
              </select>
              <button className="btn btn-primary" disabled={!subTitle.trim()}><IcoPlus size={15} /> Add</button>
            </form>
          </div>

          <div className="card card-pad">
            <h3 className="card-title" style={{ marginBottom: 12 }}>Submit progress report</h3>
            <form onSubmit={submit}>
              <textarea className="textarea" placeholder="Type your progress report / daily log here..." value={content} onChange={(e) => setContent(e.target.value)} />

              {files.length > 0 && (
                <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                  {files.map((f, i) => (
                    <div key={i} className="row between" style={{ gap: 10, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)' }}>
                      <div className="row" style={{ gap: 8, minWidth: 0 }}>
                        <IcoFile size={15} />
                        <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <span className="tiny" style={{ flexShrink: 0 }}>{fmtSize(f.size)}</span>
                      </div>
                      <button type="button" className="icon-btn" title="Remove file" onClick={() => removeFile(i)}><IcoTrash size={14} /></button>
                    </div>
                  ))}
                </div>
              )}

              <label className="btn btn-ghost" style={{ marginTop: 12, cursor: 'pointer' }}>
                <IcoUpload size={16} /> {files.length ? 'Add more files' : 'Attach files here'}
                <input type="file" accept=".pdf,.doc,.docx" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </label>
              <p className="tiny" style={{ marginTop: 8 }}>PDF or DOCX, up to 1 GB each. You can attach several files.</p>

              <div style={{ marginTop: 14 }}><button className="btn btn-primary" disabled={busy}>{busy ? <Spinner /> : 'Submit report'}</button></div>
            </form>
          </div>
        </div>

        <div className="card card-pad" style={{ alignSelf: 'start' }}>
          <h3 className="card-title" style={{ marginBottom: 14 }}>Update status</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {COLUMNS.map((s) => (
              <button key={s} className={`btn ${myAssign?.status === s ? 'btn-primary' : 'btn-ghost'} btn-block`} style={{ justifyContent: 'flex-start' }} onClick={() => setStatus(s)}>
                {myAssign?.status === s && <IcoCheck size={15} />} {s}
              </button>
            ))}
          </div>
          <div className="divider" />
          <h3 className="card-title" style={{ marginBottom: 12 }}>Assignees</h3>
          {data.assignments.map((a: any) => (
            <div key={a.id} className="row" style={{ gap: 10, padding: '6px 0' }}>
              <Avatar name={a.full_name} color={a.avatar_color} size="sm" />
              <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{a.full_name}</div></div>
              <StatusBadge status={a.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
