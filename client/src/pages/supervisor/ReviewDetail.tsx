import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, errMsg, downloadFile } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Avatar, fmtDateTime, Loader, Spinner } from '../../components/ui';
import { IcoFile, IcoStar, IcoTrash, IcoEdit } from '../../lib/icons';

const Stars = ({ value, onPick }: { value: number; onPick: (n: number) => void }) => (
  <div className="row" style={{ gap: 4 }}>
    {[1, 2, 3, 4, 5].map((n) => (
      <span key={n} onClick={() => onPick(n)} style={{ cursor: 'pointer', color: n <= value ? 'var(--accent)' : 'var(--border-strong)' }}><IcoStar size={22} /></span>
    ))}
  </div>
);

export default function ReviewDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [comment, setComment] = useState('');
  const [quality, setQuality] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [editBody, setEditBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await api.get(`/submissions/${id}`);
    setData(data);
    if (data.assessment) setQuality(data.assessment.quality_score);
  };
  useEffect(() => { load(); }, [id]);

  if (!data) return <div className="page"><Loader /></div>;
  const s = data.submission;

  const postComment = async () => {
    if (!comment.trim()) { toast('Comment cannot be empty.', 'error'); return; }
    try {
      await api.post(`/submissions/${id}/comments`, { body: comment });
      setComment(''); toast('Feedback posted.', 'success'); load();
    } catch (err) { toast(errMsg(err), 'error'); }
  };

  const saveEdit = async (cid: number) => {
    await api.patch(`/submissions/comments/${cid}`, { body: editBody });
    setEditing(null); toast('Comment updated.', 'success'); load();
  };
  const delComment = async (cid: number) => {
    if (!confirm('Delete this comment?')) return;
    await api.delete(`/submissions/comments/${cid}`); toast('Comment deleted.', 'success'); load();
  };

  const download = async (f: any) => {
    try { await downloadFile(`/submissions/${id}/files/${f.id}`, f.original_name); }
    catch (err) { toast(errMsg(err), 'error'); }
  };

  const assess = async (opts: any) => {
    if (!quality) { toast('Give a quality score first.', 'error'); return; }
    setBusy(true);
    try {
      await api.post(`/submissions/${id}/assess`, { quality_score: quality, ...opts });
      toast('Assessment saved.', 'success'); load();
    } catch (err) { toast(errMsg(err), 'error'); } finally { setBusy(false); }
  };

  const peerReviewers = data.peer_reviewers || [];

  return (
    <div className="page">
      <a onClick={() => nav('/review')} style={{ cursor: 'pointer', fontSize: 14 }}>← Back to review queue</a>
      <div className="row" style={{ gap: 12, marginTop: 12 }}>
        <Avatar name={s.member_name} color={s.avatar_color} />
        <div>
          <h1 className="page-title" style={{ fontSize: 22 }}>{s.task_title}</h1>
          <p className="muted" style={{ fontSize: 14 }}>
            {s.member_name} · {fmtDateTime(s.submitted_at)}{' '}
            {s.is_late ? <span className="badge badge-red">Late</span> : <span className="badge badge-green">On time</span>}
          </p>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 18 }}>
        <div className="row between wrap" style={{ gap: 10, marginBottom: 12 }}>
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>Assigned peer reviewers</h3>
            <p className="tiny" style={{ marginTop: 4, marginBottom: 0 }}>
              Assigned automatically when this report was uploaded. Visible to supervisors only.
            </p>
          </div>
          <span className="badge badge-brand">
            {peerReviewers.length} assigned
            {peerReviewers.filter((r: any) => r.status === 'completed').length
              ? ` · ${peerReviewers.filter((r: any) => r.status === 'completed').length} done`
              : ''}
          </span>
        </div>

        {peerReviewers.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            No peer reviewers were assigned for this submission yet.
          </p>
        ) : (
          <div className="grid grid-3" style={{ gap: 12 }}>
            {peerReviewers.map((r: any) => (
              <div key={r.id || r.reviewer_id} className="card" style={{ padding: 14 }}>
                <div className="row between" style={{ gap: 10 }}>
                  <div className="row" style={{ gap: 10, minWidth: 0 }}>
                    <Avatar name={r.reviewer_name} color={r.reviewer_color} size="sm" />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{r.reviewer_name}</div>
                      <div className="tiny" style={{ marginTop: 2 }}>
                        {r.status === 'completed' && r.review_score != null
                          ? `Scored ${r.review_score}/5`
                          : r.due_at
                            ? `Due ${fmtDateTime(r.due_at)}`
                            : `Assigned ${fmtDateTime(r.assigned_at)}`}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`badge ${
                      r.status === 'completed'
                        ? 'badge-green'
                        : r.status === 'missed'
                          ? 'badge-red'
                          : 'badge-amber'
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid responsive-split" style={{ gridTemplateColumns: '1.5fr 1fr', marginTop: 18 }}>
        <div style={{ display: 'grid', gap: 18 }}>
          <div className="card card-pad">
            <h3 className="card-title" style={{ marginBottom: 12 }}>Report content</h3>
            {s.content ? <p style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{s.content}</p> : <p className="muted">No typed content.</p>}
            {data.files.map((f: any) => (
              <button key={f.id} className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => download(f)}><IcoFile size={15} /> {f.original_name} ({Math.round(f.size_bytes / 1024)} KB)</button>
            ))}
          </div>

          <div className="card card-pad">
            <h3 className="card-title" style={{ marginBottom: 14 }}>Feedback thread</h3>
            {data.comments.length === 0 && <p className="muted" style={{ marginBottom: 14 }}>No feedback yet. Be the first to comment.</p>}
            {data.comments.map((c: any) => (
              <div key={c.id} className="row" style={{ gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
                <Avatar name={c.author_name} color={c.avatar_color} size="sm" />
                <div className="card" style={{ padding: 12, flex: 1 }}>
                  <div className="row between"><strong style={{ fontSize: 13 }}>{c.author_name}</strong><span className="tiny">{fmtDateTime(c.created_at)}{c.edited_at ? ' (edited)' : ''}</span></div>
                  {editing === c.id ? (
                    <div style={{ marginTop: 8 }}>
                      <textarea className="textarea" value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                      <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn btn-primary btn-sm" onClick={() => saveEdit(c.id)}>Save</button><button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button></div>
                    </div>
                  ) : (
                    <>
                      <p style={{ marginTop: 6, fontSize: 14 }}>{c.body}</p>
                      <div className="row" style={{ gap: 6, marginTop: 8 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(c.id); setEditBody(c.body); }}><IcoEdit size={13} /> Edit</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => delComment(c.id)}><IcoTrash size={13} /> Delete</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
            <div className="divider" />
            <textarea className="textarea" placeholder="Write feedback for the member..." value={comment} onChange={(e) => setComment(e.target.value)} />
            <div style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={postComment}>Post feedback</button></div>
          </div>
        </div>

        <div className="card card-pad" style={{ alignSelf: 'start' }}>
          <h3 className="card-title" style={{ marginBottom: 14 }}>Assess submission</h3>
          <div className="field"><label className="label">Quality score (0-5)</label><Stars value={quality} onPick={setQuality} /></div>
          {data.assessment?.responsiveness_score != null && (
            <div className="field"><label className="label">Responsiveness</label><span className="badge badge-brand">{data.assessment.responsiveness_score}/5</span></div>
          )}
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => assess({ mark_completed: true })}>{busy ? <Spinner /> : 'Approve & mark complete'}</button>
            <button className="btn btn-accent btn-block" disabled={busy} onClick={() => assess({ request_revision: true })}>Request revision</button>
          </div>
          <p className="tiny" style={{ marginTop: 12 }}>Quality &amp; responsiveness feed the member's Supervisor Assessment (SA) in the Performance Index.</p>
        </div>
      </div>
    </div>
  );
}
