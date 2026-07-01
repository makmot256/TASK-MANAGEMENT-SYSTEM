import React, { useEffect, useState } from 'react';
import { api, errMsg, downloadFile } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Modal, Avatar, fmtDateTime, Loader, EmptyState } from '../../components/ui';
import { IcoReport, IcoFile } from '../../lib/icons';

export default function MemberReports() {
  const toast = useToast();
  const [subs, setSubs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<any>(null);

  const download = async (f: any) => {
    try { await downloadFile(`/submissions/${open.submission.id}/files/${f.id}`, f.original_name); }
    catch (err) { toast(errMsg(err), 'error'); }
  };

  useEffect(() => {
    (async () => {
      const { data } = await api.get('/submissions/mine');
      setSubs(data.submissions);
      setLoading(false);
    })();
  }, []);

  const view = async (id: number) => {
    const { data } = await api.get(`/submissions/${id}`);
    setOpen(data);
  };

  return (
    <div className="page">
      <h1 className="page-title">My Reports</h1>
      <p className="page-sub">Your submission history and supervisor feedback.</p>

      <div className="card" style={{ marginTop: 22 }}>
        {loading ? <div className="card-pad"><Loader /></div> : subs.length === 0 ? (
          <EmptyState icon={<IcoReport size={56} />} title="No submissions yet" sub="Submit a report from a task to see it here." />
        ) : (
          <table className="table">
            <thead><tr><th>Task</th><th>Type</th><th>Submitted</th><th>Status</th><th>Feedback</th><th></th></tr></thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.task_title}</td>
                  <td><span className="badge badge-brand">{s.kind === 'daily_log' ? 'Daily log' : 'Weekly report'}</span></td>
                  <td className="muted">{fmtDateTime(s.submitted_at)}</td>
                  <td>{s.is_late ? <span className="badge badge-red">Late</span> : <span className="badge badge-green">On time</span>}</td>
                  <td>{s.comment_count > 0 ? <span className="badge badge-accent">{s.comment_count} comment(s)</span> : <span className="tiny">—</span>}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => view(s.id)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <Modal title={open.submission.task_title} onClose={() => setOpen(null)} wide>
          <div className="row" style={{ gap: 8, marginBottom: 14 }}>
            <span className="badge badge-brand">{open.submission.kind === 'daily_log' ? 'Daily log' : 'Weekly report'}</span>
            <span className="muted" style={{ fontSize: 13 }}>{fmtDateTime(open.submission.submitted_at)}</span>
          </div>
          {open.submission.content && <p style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{open.submission.content}</p>}
          {open.files.map((f: any) => (
            <button key={f.id} className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => download(f)}><IcoFile size={15} /> {f.original_name}</button>
          ))}
          <div className="divider" />
          <h4 style={{ marginBottom: 12 }}>Supervisor feedback</h4>
          {open.comments.length === 0 ? <p className="muted">No feedback yet.</p> : open.comments.map((c: any) => (
            <div key={c.id} className="row" style={{ gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
              <Avatar name={c.author_name} color={c.avatar_color} size="sm" />
              <div className="card" style={{ padding: 12, flex: 1 }}>
                <div className="row between"><strong style={{ fontSize: 13 }}>{c.author_name}</strong><span className="tiny">{fmtDateTime(c.created_at)}{c.edited_at ? ' (edited)' : ''}</span></div>
                <p style={{ marginTop: 6, fontSize: 14 }}>{c.body}</p>
              </div>
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}
