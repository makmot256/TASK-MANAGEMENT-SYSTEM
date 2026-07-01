import React, { useEffect, useState } from 'react';
import { api, errMsg, downloadFile } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Loader, Spinner } from '../../components/ui';
import { IcoFile, IcoTrash, IcoUpload } from '../../lib/icons';

const emptyForm = {
  tasks_completed: '',
  tasks_in_progress: '',
  next_week_tasks: '',
  problems_challenges: '',
};

const fmtWeek = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const fmtSize = (b: number) =>
  b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

export default function WeeklyReport() {
  const toast = useToast();
  const [weeks, setWeeks] = useState<any[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [form, setForm] = useState(emptyForm);
  const [supervisorComment, setSupervisorComment] = useState('');
  const [savedFiles, setSavedFiles] = useState<any[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const MAX_BYTES = 1024 * 1024 * 1024;

  const loadWeeks = async () => {
    const { data } = await api.get('/weekly-reports/weeks');
    setWeeks(data.weeks);
    if (!selected && data.weeks.length) {
      const pick = data.weeks.find((w: any) => w.action === 'fill') || data.weeks[0];
      setSelected(pick.week_ending);
    }
    setLoading(false);
  };

  const loadReport = async (weekEnding: string) => {
    const { data } = await api.get(`/weekly-reports/week/${weekEnding}`);
    if (data.report) {
      setForm({
        tasks_completed: data.report.tasks_completed || '',
        tasks_in_progress: data.report.tasks_in_progress || '',
        next_week_tasks: data.report.next_week_tasks || '',
        problems_challenges: data.report.problems_challenges || '',
      });
      setSupervisorComment(data.report.supervisor_comment || '');
      setSavedFiles(data.files || []);
    } else {
      setForm(emptyForm);
      setSupervisorComment('');
      setSavedFiles([]);
    }
    setPendingFiles([]);
  };

  useEffect(() => { loadWeeks(); }, []);
  useEffect(() => { if (selected) loadReport(selected); }, [selected]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const tooBig = incoming.find((f) => f.size > MAX_BYTES);
    if (tooBig) { toast(`"${tooBig.name}" exceeds the 1 GB limit.`, 'error'); return; }
    setPendingFiles((prev) => {
      const names = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...incoming.filter((f) => !names.has(f.name + f.size))];
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append('week_ending', selected);
      body.append('tasks_completed', form.tasks_completed);
      body.append('tasks_in_progress', form.tasks_in_progress);
      body.append('next_week_tasks', form.next_week_tasks);
      body.append('problems_challenges', form.problems_challenges);
      pendingFiles.forEach((f) => body.append('files', f));
      await api.put('/weekly-reports', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast('Weekly report saved.', 'success');
      setPendingFiles([]);
      await loadWeeks();
      await loadReport(selected);
    } catch (err) { toast(errMsg(err), 'error'); } finally { setBusy(false); }
  };

  const removeSaved = async (fileId: number) => {
    try {
      await api.delete(`/weekly-reports/files/${fileId}`);
      toast('File removed.', 'success');
      loadReport(selected);
    } catch (err) { toast(errMsg(err), 'error'); }
  };

  const download = async (f: any) => {
    try { await downloadFile(`/weekly-reports/files/${f.id}/download`, f.original_name); }
    catch (err) { toast(errMsg(err), 'error'); }
  };

  if (loading) return <div className="page"><Loader /></div>;

  const current = weeks.find((w) => w.week_ending === selected);
  const isEdit = current?.action === 'edit';

  return (
    <div className="page">
      <h1 className="page-title">Weekly Progress Report</h1>
      <p className="page-sub">Fill or update your weekly progress report. Week ending must be a Friday.</p>

      <div className="card card-pad" style={{ marginTop: 22, maxWidth: 820 }}>
        <h3 className="card-title" style={{ marginBottom: 18 }}>Fill or update your weekly progress report</h3>

        <form onSubmit={save}>
          <div className="field">
            <label className="label">Week Ending <span className="tiny">(Date selected must be a Friday)*</span></label>
            <select className="select" value={selected} onChange={(e) => setSelected(e.target.value)} required>
              {weeks.map((w) => (
                <option key={w.week_ending} value={w.week_ending}>
                  Week {w.week_number} — ending {fmtWeek(w.week_ending)}{w.action === 'edit' ? ' (saved)' : ''}
                </option>
              ))}
            </select>
          </div>

            <div className="field">
              <label className="label">Tasks Completed *</label>
              <textarea className="textarea" rows={4} value={form.tasks_completed} onChange={(e) => setForm({ ...form, tasks_completed: e.target.value })} required />
            </div>
            <div className="field">
              <label className="label">Tasks in progress *</label>
              <textarea className="textarea" rows={4} value={form.tasks_in_progress} onChange={(e) => setForm({ ...form, tasks_in_progress: e.target.value })} required />
            </div>
            <div className="field">
              <label className="label">Next Week&apos;s Tasks *</label>
              <textarea className="textarea" rows={4} value={form.next_week_tasks} onChange={(e) => setForm({ ...form, next_week_tasks: e.target.value })} required />
            </div>
            <div className="field">
              <label className="label">Problems / Challenges *</label>
              <textarea className="textarea" rows={4} value={form.problems_challenges} onChange={(e) => setForm({ ...form, problems_challenges: e.target.value })} required />
            </div>

            <div className="field">
              <label className="label">Field Supervisor&apos;s Comments</label>
              <textarea
                className="textarea"
                rows={3}
                readOnly
                value={supervisorComment || "Field Supervisor's comments will appear here when available."}
                style={{ background: 'var(--surface-2)', color: supervisorComment ? 'var(--text)' : 'var(--text-3)' }}
              />
            </div>

            <div className="divider" />
            <h4 className="card-title" style={{ marginBottom: 12 }}>Attach supporting documents</h4>

            {savedFiles.map((f) => (
              <div key={f.id} className="row between" style={{ gap: 10, padding: '8px 12px', marginBottom: 8, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)' }}>
                <button type="button" className="row" style={{ gap: 8, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }} onClick={() => download(f)}>
                  <IcoFile size={15} /><span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.original_name}</span>
                  <span className="tiny">{fmtSize(f.size_bytes)}</span>
                </button>
                <button type="button" className="icon-btn" title="Remove file" onClick={() => removeSaved(f.id)}><IcoTrash size={14} /></button>
              </div>
            ))}

            {pendingFiles.map((f, i) => (
              <div key={i} className="row between" style={{ gap: 10, padding: '8px 12px', marginBottom: 8, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)' }}>
                <div className="row" style={{ gap: 8, minWidth: 0 }}>
                  <IcoFile size={15} /><span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <span className="tiny">{fmtSize(f.size)}</span>
                </div>
                <button type="button" className="icon-btn" onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}><IcoTrash size={14} /></button>
              </div>
            ))}

            <label className="btn btn-ghost" style={{ marginTop: 8, cursor: 'pointer' }}>
              <IcoUpload size={16} /> {savedFiles.length || pendingFiles.length ? 'Add more files' : 'Attach files here'}
              <input type="file" accept=".pdf,.doc,.docx" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            <p className="tiny" style={{ marginTop: 8 }}>PDF or DOCX, up to 1 GB each. You can attach several files.</p>

            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary" disabled={busy}>{busy ? <Spinner /> : isEdit ? 'Update report' : 'Submit report'}</button>
            </div>
          </form>
      </div>
    </div>
  );
}
