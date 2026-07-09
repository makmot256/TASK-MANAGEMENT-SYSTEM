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
  const [assignTab, setAssignTab] = useState<'pending' | 'past' | 'all'>('pending');
  const [target, setTarget] = useState<any>(null);
  const [collabTarget, setCollabTarget] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [viewOnly, setViewOnly] = useState(false);
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

  const openReview = async (assignment: any, readOnly = false) => {
    try {
      const { data } = await api.get(`/submissions/${assignment.submission_id}`);
      setPreview(data);
      setTarget(assignment);
      setViewOnly(readOnly || assignment.status === 'completed');
      setScore(readOnly || assignment.status === 'completed' ? Number(assignment.review_score) || 0 : 0);
      setComment(readOnly || assignment.status === 'completed' ? (assignment.review_comment || '') : '');
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
      setViewOnly(false);
      setScore(0);
      setComment('');
      setAssignTab('past');
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
  const past = assigned.filter((a) => a.status === 'completed');
  const missed = assigned.filter((a) => a.status === 'missed');
  const shownAssigned =
    assignTab === 'pending' ? pending : assignTab === 'past' ? past : assigned.filter((a) => a.status !== 'missed');
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

          {(mine?.groups?.length > 0 || mine?.comments?.length > 0) && (
            <div className="card card-pad" style={{ marginTop: 18 }}>
              <h3 className="card-title" style={{ marginBottom: 14 }}>Anonymous feedback for you</h3>
              <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
                Grouped by the task each peer review relates to. Reviewer names stay hidden.
              </p>
              {(mine.groups?.length
                ? mine.groups
                : [{
                    key: 'all',
                    task_title: 'Feedback',
                    comments: mine.comments || [],
                  }]
              ).map((group: any) => (
                <div key={group.key} style={{ marginBottom: 18 }}>
                  <div className="row between wrap" style={{ gap: 8, marginBottom: 10 }}>
                    <div className="row" style={{ gap: 8, minWidth: 0 }}>
                      <strong style={{ fontSize: 14 }}>{group.task_title}</strong>
                      <span className="badge badge-grey">{group.comments.length}</span>
                    </div>
                  </div>
                  {group.comments.map((c: any, i: number) => (
                    <div key={`${group.key}-${i}`} className="card" style={{ padding: 12, marginBottom: 10 }}>
                      <div className="row between wrap" style={{ gap: 8 }}>
                        <span className={`badge ${c.kind === 'peer_review' ? 'badge-brand' : 'badge-grey'}`}>
                          {c.kind === 'peer_review' ? 'Peer review' : 'Collaboration'}
                        </span>
                        {c.score != null && <span className="tiny">{c.score}/5</span>}
                      </div>
                      <p style={{ marginTop: 8, fontSize: 14, marginBottom: 0 }}>{c.comment}</p>
                    </div>
                  ))}
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
            <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
              <h3 className="card-title" style={{ margin: 0 }}>Assigned report reviews</h3>
              <div className="pill-toggle">
                <button className={assignTab === 'pending' ? 'active' : ''} onClick={() => setAssignTab('pending')}>
                  Pending{pending.length ? ` (${pending.length})` : ''}
                </button>
                <button className={assignTab === 'past' ? 'active' : ''} onClick={() => setAssignTab('past')}>
                  Past{past.length ? ` (${past.length})` : ''}
                </button>
                <button className={assignTab === 'all' ? 'active' : ''} onClick={() => setAssignTab('all')}>
                  All
                </button>
              </div>
            </div>

            {shownAssigned.length === 0 ? (
              <EmptyState
                title={assignTab === 'past' ? 'No past reviews yet' : assignTab === 'all' ? 'No assigned reviews' : 'No pending reviews'}
                sub={
                  assignTab === 'past'
                    ? 'After you complete a peer review, it will appear here with your score and comment.'
                    : "You'll be notified when an uploaded report is assigned to you for peer review."
                }
              />
            ) : assignTab === 'past' || (assignTab === 'all' && past.length > 0 && pending.length === 0) ? (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Author</th>
                      <th>Your score</th>
                      <th>Your comment</th>
                      <th>Reviewed</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownAssigned.filter((a) => a.status === 'completed').map((a) => (
                      <tr key={a.id}>
                        <td><strong>{a.task_title}</strong></td>
                        <td>
                          <div className="row" style={{ gap: 8 }}>
                            <Avatar name={a.reviewee_name} color={a.reviewee_color} size="sm" />
                            <span>{a.reviewee_name}</span>
                          </div>
                        </td>
                        <td>
                          <strong>{a.review_score != null ? `${a.review_score}/5` : '—'}</strong>
                          {a.review_vulgar ? <span className="badge badge-red" style={{ marginLeft: 6 }}>Flagged</span> : null}
                        </td>
                        <td className="muted" style={{ maxWidth: 280 }}>{a.review_comment || '—'}</td>
                        <td className="muted">{fmtDateTime(a.reviewed_at || a.completed_at)}</td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => openReview(a, true)}>View</button>
                        </td>
                      </tr>
                    ))}
                    {assignTab === 'all' && pending.map((a) => (
                      <tr key={a.id}>
                        <td><strong>{a.task_title}</strong></td>
                        <td>
                          <div className="row" style={{ gap: 8 }}>
                            <Avatar name={a.reviewee_name} color={a.reviewee_color} size="sm" />
                            <span>{a.reviewee_name}</span>
                          </div>
                        </td>
                        <td><span className="badge badge-amber">Pending</span></td>
                        <td className="muted">—</td>
                        <td className="muted">{a.due_at ? `Due ${fmtDateTime(a.due_at)}` : '—'}</td>
                        <td>
                          <button className="btn btn-primary btn-sm" onClick={() => openReview(a)}>Review</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-2">
                {shownAssigned.map((a) => (
                  <div key={a.id} className="card" style={{ padding: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{a.task_title}</div>
                    <div className="tiny" style={{ marginTop: 4 }}>Submitted {fmtDateTime(a.submission_date)}</div>
                    {a.status === 'pending' && a.due_at && (
                      <div className="tiny" style={{ marginTop: 2, color: 'var(--amber)' }}>Due {fmtDateTime(a.due_at)}</div>
                    )}
                    {a.status === 'completed' && (
                      <div className="tiny" style={{ marginTop: 2 }}>
                        Reviewed {fmtDateTime(a.reviewed_at || a.completed_at)}
                        {a.review_score != null ? ` · ${a.review_score}/5` : ''}
                      </div>
                    )}
                    <div className="row" style={{ gap: 8, marginTop: 10 }}>
                      <Avatar name={a.reviewee_name} color={a.reviewee_color} size="sm" />
                      <span className="muted" style={{ fontSize: 13 }}>{a.reviewee_name}</span>
                    </div>
                    <span
                      className={`badge ${a.status === 'completed' ? 'badge-green' : 'badge-amber'}`}
                      style={{ marginTop: 12 }}
                    >
                      {a.status === 'completed' ? 'Completed' : 'Pending review'}
                    </span>
                    <button
                      className={`btn ${a.status === 'completed' ? 'btn-ghost' : 'btn-primary'} btn-sm btn-block`}
                      style={{ marginTop: 12 }}
                      onClick={() => openReview(a, a.status === 'completed')}
                    >
                      {a.status === 'completed' ? 'View review' : 'Review report'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {missed.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <h4 className="card-title" style={{ fontSize: 14, marginBottom: 10 }}>Missed reviews (penalized)</h4>
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
          </div>

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
          title={`${viewOnly ? 'Your review' : 'Peer review'}: ${target.task_title}`}
          onClose={() => { setTarget(null); setPreview(null); setViewOnly(false); }}
          wide
          footer={(
            <>
              {!viewOnly && (
                <button className="btn btn-primary" onClick={submit} disabled={hasReviewedSubmission(target.submission_id)}>
                  Submit review
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => { setTarget(null); setPreview(null); setViewOnly(false); }}>
                {viewOnly ? 'Close' : 'Cancel'}
              </button>
            </>
          )}
        >
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            {viewOnly
              ? 'This is the review you already submitted. The author cannot see your name.'
              : `Read the full report and download any attachments before submitting your feedback. ${target.reviewee_name} will not see your name.`}
          </p>

          <div className="card card-pad" style={{ marginBottom: 16, background: 'var(--surface-2)' }}>
            <div className="row between wrap" style={{ gap: 8, marginBottom: 12 }}>
              <span className="card-title" style={{ fontSize: 14 }}>Submitted report</span>
              <div className="row" style={{ gap: 8 }}>
                <span className="badge badge-brand">
                  {preview.submission.kind === 'daily_log' ? 'Daily log' : 'Task report'}
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

          <div className="field">
            <label className="label">Score (1-5)</label>
            <Stars value={score} onPick={viewOnly ? undefined : setScore} />
          </div>
          <div className="field">
            <label className="label">{viewOnly ? 'Your comment' : 'Comment (optional)'}</label>
            {viewOnly ? (
              <p style={{ fontSize: 14, margin: 0, whiteSpace: 'pre-wrap' }}>{comment || '—'}</p>
            ) : (
              <>
                <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Constructive feedback on the report..." />
                <p className="tiny muted" style={{ marginTop: 6 }}>
                  Keep language professional. Vulgar or abusive comments reduce your Task Performance score.
                </p>
              </>
            )}
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
