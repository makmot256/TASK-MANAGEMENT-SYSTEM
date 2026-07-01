import React, { useEffect, useState } from 'react';
import { api, errMsg, downloadFile } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Avatar, Modal, Loader, EmptyState, fmtDateTime } from '../../components/ui';
import { IcoStar, IcoFile } from '../../lib/icons';

const Stars = ({ value, onPick }: { value: number; onPick?: (n: number) => void }) => (
  <div className="row" style={{ gap: 4 }}>
    {[1, 2, 3, 4, 5].map((n) => (
      <span key={n} onClick={() => onPick?.(n)} style={{ cursor: onPick ? 'pointer' : 'default', color: n <= value ? 'var(--accent)' : 'var(--border-strong)' }}>
        <IcoStar size={20} />
      </span>
    ))}
  </div>
);

export default function PeerReviews() {
  const toast = useToast();
  const [assigned, setAssigned] = useState<any[]>([]);
  const [penaltyPolicy, setPenaltyPolicy] = useState<any>(null);
  const [given, setGiven] = useState<any[]>([]);
  const [mine, setMine] = useState<any>(null);
  const [cohort, setCohort] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<any>(null);
  const [collabTarget, setCollabTarget] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');

  const load = async () => {
    const [a, g, m, c] = await Promise.all([
      api.get('/peer/assigned'),
      api.get('/peer/given'),
      api.get('/peer/mine'),
      api.get('/users/cohort'),
    ]);
    setAssigned(a.data.assignments || []);
    setPenaltyPolicy(a.data.penaltyPolicy || null);
    setGiven(g.data.given);
    setMine(m.data);
    setCohort(c.data.cohort);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const hasReviewedSubmission = (submissionId: number) =>
    given.some((x) => x.submission_id === submissionId && x.kind === 'peer_review');

  const openReview = async (assignment: any) => {
    try {
      const { data } = await api.get(`/submissions/${assignment.submission_id}`);
      setPreview(data);
      setTarget(assignment);
      setScore(0);
      setComment('');
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  };

  const downloadAttachment = async (f: any) => {
    if (!target) return;
    try {
      await downloadFile(`/submissions/${target.submission_id}/files/${f.id}`, f.original_name);
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const submit = async () => {
    if (!score) { toast('Pick a score 1-5.', 'error'); return; }
    try {
      const { data } = await api.post('/peer', {
        submission_id: target.submission_id,
        kind: 'peer_review',
        score,
        comment,
      });
      toast(data.message || 'Peer review submitted.', data.vulgar_comment ? 'error' : 'success');
      setTarget(null);
      setPreview(null);
      setScore(0);
      setComment('');
      load();
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  };

  const submitCollab = async () => {
    if (!score) { toast('Pick a score 1-5.', 'error'); return; }
    try {
      await api.post('/peer', {
        assessee_id: collabTarget.id,
        kind: 'collaboration',
        score,
        comment,
      });
      toast('Collaboration rating submitted.', 'success');
      setCollabTarget(null);
      setScore(0);
      setComment('');
      load();
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  };

  const prAvg = mine?.aggregates?.find((a: any) => a.kind === 'peer_review');
  const coAvg = mine?.aggregates?.find((a: any) => a.kind === 'collaboration');
  const pending = assigned.filter((a) => a.status === 'pending');
  const missed = assigned.filter((a) => a.status === 'missed');
  const missedPct = Math.round((penaltyPolicy?.missed_penalty ?? 0.05) * 100);
  const vulgarPct = Math.round((penaltyPolicy?.vulgar_penalty ?? 0.03) * 100);

  return (
    <div className="page">
      <h1 className="page-title">Peer Reviews</h1>
      <p className="page-sub">
        Report peer reviews are assigned system-wide when members upload work. Collaboration
        ratings are for teammates on your team only. You never see who peer-reviewed you —
        supervisors do.
      </p>

      {loading ? <div style={{ marginTop: 22 }}><Loader /></div> : (
        <>
          <div className="grid grid-2" style={{ marginTop: 22 }}>
            <div className="card card-pad">
              <span className="card-title">My peer-review score</span>
              <div className="row" style={{ gap: 12, marginTop: 12 }}>
                <div style={{ fontSize: 32, fontWeight: 800 }}>{prAvg ? Number(prAvg.avg_score).toFixed(1) : '—'}</div>
                <div className="tiny">from {prAvg?.n || 0} peers</div>
              </div>
            </div>
            <div className="card card-pad">
              <span className="card-title">My collaboration score</span>
              <div className="row" style={{ gap: 12, marginTop: 12 }}>
                <div style={{ fontSize: 32, fontWeight: 800 }}>{coAvg ? Number(coAvg.avg_score).toFixed(1) : '—'}</div>
                <div className="tiny">from {coAvg?.n || 0} teammates</div>
              </div>
            </div>
          </div>

          {mine?.comments?.length > 0 && (
            <div className="card card-pad" style={{ marginTop: 18 }}>
              <h3 className="card-title" style={{ marginBottom: 12 }}>Anonymous feedback for you</h3>
              {mine.comments.map((c: any, i: number) => (
                <div key={i} className="card" style={{ padding: 12, marginBottom: 10 }}>
                  <span className="badge badge-grey">{c.kind === 'peer_review' ? 'Peer review' : 'Collaboration'}</span>
                  <p style={{ marginTop: 8, fontSize: 14 }}>{c.comment}</p>
                </div>
              ))}
            </div>
          )}

          <div className="card card-pad" style={{ marginTop: 18, background: 'var(--surface-2)' }}>
            <h3 className="card-title" style={{ marginBottom: 8 }}>Reviewer penalty policy</h3>
            <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
              Missing an assigned peer review by the due date deducts {missedPct}% from your Task Performance (TP).
              Vulgar or abusive language in a review comment deducts {vulgarPct}% from TP per occurrence.
              Low scores alone do not trigger a penalty — keep feedback constructive and professional.
            </p>
          </div>

          <div className="card card-pad" style={{ marginTop: 18 }}>
            <h3 className="card-title" style={{ marginBottom: 14 }}>Assigned report reviews</h3>
            {pending.length === 0 ? (
              <EmptyState title="No pending reviews" sub="You'll be notified when a uploaded report is assigned to you for peer review." />
            ) : (
              <div className="grid grid-2">
                {pending.map((a) => (
                  <div key={a.id} className="card" style={{ padding: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{a.task_title}</div>
                    <div className="tiny" style={{ marginTop: 4 }}>Submitted {fmtDateTime(a.submission_date)}</div>
                    {a.due_at && <div className="tiny" style={{ marginTop: 2, color: 'var(--amber)' }}>Due {fmtDateTime(a.due_at)}</div>}
                    <div className="row" style={{ gap: 8, marginTop: 10 }}>
                      <Avatar name={a.reviewee_name} color={a.reviewee_color} size="sm" />
                      <span className="muted" style={{ fontSize: 13 }}>{a.reviewee_name}</span>
                    </div>
                    <span className="badge badge-amber" style={{ marginTop: 12 }}>Pending review</span>
                    <button className="btn btn-primary btn-sm btn-block" style={{ marginTop: 12 }} onClick={() => openReview(a)}>
                      Review report
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {missed.length > 0 && (
            <div className="card card-pad" style={{ marginTop: 18 }}>
              <h3 className="card-title" style={{ marginBottom: 14 }}>Missed reviews (penalized)</h3>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>Task</th><th>Author</th><th>Was due</th><th>Status</th></tr></thead>
                  <tbody>
                    {missed.map((a) => (
                      <tr key={a.id}>
                        <td><strong>{a.task_title}</strong></td>
                        <td>{a.reviewee_name}</td>
                        <td className="muted">{a.due_at ? fmtDateTime(a.due_at) : '—'}</td>
                        <td><span className="badge badge-red">Missed — TP penalty</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {assigned.filter((a) => a.status === 'completed').length > 0 && (
            <div className="card card-pad" style={{ marginTop: 18 }}>
              <h3 className="card-title" style={{ marginBottom: 14 }}>Completed report reviews</h3>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>Task</th><th>Author</th><th>Submitted</th><th>Status</th></tr></thead>
                  <tbody>
                    {assigned.filter((a) => a.status === 'completed').map((a) => (
                      <tr key={a.id}>
                        <td><strong>{a.task_title}</strong></td>
                        <td>{a.reviewee_name}</td>
                        <td className="muted">{fmtDateTime(a.submission_date)}</td>
                        <td><span className="badge badge-green">Done</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card card-pad" style={{ marginTop: 18 }}>
            <h3 className="card-title" style={{ marginBottom: 8 }}>Collaboration ratings</h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Rate teammates on your team for collaboration.</p>
            {cohort.length === 0 ? (
              <EmptyState title="No teammates to rate" sub="Collaboration ratings are only available for members on your team." />
            ) : (
              <div className="grid grid-3">
                {cohort.map((m) => (
                  <div key={m.id} className="card" style={{ padding: 16 }}>
                    <div className="row" style={{ gap: 10 }}><Avatar name={m.full_name} color={m.avatar_color} size="sm" /><span style={{ fontWeight: 600 }}>{m.full_name}</span></div>
                    <span className={`badge ${given.some((x) => x.assessee_id === m.id && x.kind === 'collaboration') ? 'badge-green' : 'badge-grey'}`} style={{ marginTop: 10 }}>
                      {given.some((x) => x.assessee_id === m.id && x.kind === 'collaboration') ? 'Rated' : 'Not rated'}
                    </span>
                    <button
                      className="btn btn-ghost btn-sm btn-block"
                      style={{ marginTop: 12 }}
                      onClick={() => { setCollabTarget(m); setScore(0); setComment(''); }}
                    >
                      {given.some((x) => x.assessee_id === m.id && x.kind === 'collaboration') ? 'Update rating' : 'Rate collaboration'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {target && preview && (
        <Modal
          title={`Peer review: ${target.task_title}`}
          onClose={() => { setTarget(null); setPreview(null); }}
          wide
          footer={(
            <>
              <button className="btn btn-primary" onClick={submit} disabled={hasReviewedSubmission(target.submission_id)}>Submit review</button>
              <button className="btn btn-ghost" onClick={() => { setTarget(null); setPreview(null); }}>Cancel</button>
            </>
          )}
        >
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Read the full report and download any attachments before submitting your feedback.
            {target.reviewee_name} will not see your name.
          </p>

          <div className="card card-pad" style={{ marginBottom: 16, background: 'var(--surface-2)' }}>
            <div className="row between wrap" style={{ gap: 8, marginBottom: 12 }}>
              <span className="card-title" style={{ fontSize: 14 }}>Submitted report</span>
              <div className="row" style={{ gap: 8 }}>
                <span className="badge badge-brand">
                  {preview.submission.kind === 'daily_log' ? 'Daily log' : 'Weekly report'}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>{fmtDateTime(preview.submission.submitted_at)}</span>
              </div>
            </div>

            {preview.submission.content ? (
              <p style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                {preview.submission.content}
              </p>
            ) : (
              <p className="muted" style={{ fontSize: 14, margin: 0 }}>No written report text — see attachments below.</p>
            )}

            {preview.files?.length > 0 && (
              <>
                <div className="divider" style={{ margin: '14px 0' }} />
                <div className="label" style={{ marginBottom: 8 }}>Attachments — download to review</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {preview.files.map((f: any) => (
                    <button
                      key={f.id}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ justifyContent: 'flex-start', width: '100%' }}
                      onClick={() => downloadAttachment(f)}
                    >
                      <IcoFile size={15} />
                      <span style={{ flex: 1, textAlign: 'left' }}>{f.original_name}</span>
                      <span className="tiny">{formatSize(Number(f.size_bytes))}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="field"><label className="label">Score (1-5)</label><Stars value={score} onPick={setScore} /></div>
          <div className="field">
            <label className="label">Comment (optional)</label>
            <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Constructive feedback on the report..." />
            <p className="tiny muted" style={{ marginTop: 6 }}>
              Keep language professional. Vulgar or abusive comments reduce your Task Performance score.
            </p>
          </div>
        </Modal>
      )}

      {collabTarget && (
        <Modal
          title={`Collaboration: ${collabTarget.full_name}`}
          onClose={() => { setCollabTarget(null); setScore(0); setComment(''); }}
          footer={(
            <>
              <button className="btn btn-primary" onClick={submitCollab}>Submit</button>
              <button className="btn btn-ghost" onClick={() => { setCollabTarget(null); setScore(0); setComment(''); }}>Cancel</button>
            </>
          )}
        >
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Rate how well this teammate collaborates. Only members on your team can be rated here.
          </p>
          <div className="field"><label className="label">Score (1-5)</label><Stars value={score} onPick={setScore} /></div>
          <div className="field"><label className="label">Comment (optional)</label><textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="How do they work with the team?" /></div>
        </Modal>
      )}
    </div>
  );
}
