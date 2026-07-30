import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, errMsg, downloadFile } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Avatar, fmtDateTime, Loader, Spinner, Modal } from '../../components/ui';
import { IcoFile, IcoStar, IcoTrash, IcoEdit, IcoShield, IcoCheck, IcoX } from '../../lib/icons';

// Compliance score thresholds: >=80 green, >=50 amber, <50 red.
const scoreColor = (score: number) =>
  score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--amber)' : 'var(--red)';

const Stars = ({ value, onPick }: { value: number; onPick: (n: number) => void }) => (
  <div className="row" style={{ gap: 4 }}>
    {[1, 2, 3, 4, 5].map((n) => (
      <span key={n} onClick={() => onPick(n)} style={{ cursor: 'pointer', color: n <= value ? 'var(--accent)' : 'var(--border-strong)' }}><IcoStar size={22} /></span>
    ))}
  </div>
);

const kindLabel: Record<string, string> = {
  own_past: 'Own past report',
  teammate: 'Teammate report',
  task_brief: 'Task brief',
};

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
  const [compliance, setCompliance] = useState<any>(null);
  const [complianceBusy, setComplianceBusy] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [similarity, setSimilarity] = useState<any>(null);
  const [simLoading, setSimLoading] = useState(true);
  const [compareMatch, setCompareMatch] = useState<any>(null);
  const [compareData, setCompareData] = useState<any>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const load = async () => {
    try {
      const { data: next } = await api.get(`/submissions/${id}`);
      setData(next);
      setQuality(next.assessment?.quality_score || 0);
      setComment('');
      setEditing(null);
    } catch (err) {
      toast(errMsg(err), 'error');
      setData(null);
    }
  };

  const runCompliance = async () => {
    setComplianceBusy(true);
    setComplianceError(null);
    try {
      const { data } = await api.get(`/submissions/${id}/compliance`);
      setCompliance(data);
    } catch (err) {
      setComplianceError(errMsg(err));
    } finally {
      setComplianceBusy(false);
    }
  };
  useEffect(() => { runCompliance(); }, [id]);

  useEffect(() => {
    setData(null);
    setSimilarity(null);
    setCompareMatch(null);
    setCompareData(null);
    load();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setSimLoading(true);
      try {
        const { data: sim } = await api.get(`/submissions/${id}/similarity`);
        if (!cancelled) setSimilarity(sim);
      } catch {
        if (!cancelled) setSimilarity({ ok: false, reason: 'unavailable', matches: [] });
      } finally {
        if (!cancelled) setSimLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const openCompare = async (match: any) => {
    if (!match?.submission_id) return;
    setCompareMatch(match);
    setCompareData(null);
    setCompareLoading(true);
    try {
      const { data: other } = await api.get(`/submissions/${match.submission_id}`);
      setCompareData(other);
    } catch (err) {
      toast(errMsg(err), 'error');
      setCompareMatch(null);
    } finally {
      setCompareLoading(false);
    }
  };

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

  if (!data) return <div className="page"><Loader /></div>;
  const s = data.submission;
  const peerReviewers = data.peer_reviewers || [];
  const memberFirstName = s.member_name?.split(' ')[0] || 'Member';

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
            <div className="row between wrap" style={{ gap: 10, marginBottom: 10 }}>
              <div>
                <h3 className="card-title" style={{ margin: 0 }}>Similarity analysis</h3>
                <p className="tiny" style={{ marginTop: 4, marginBottom: 0 }}>
                  Semantic meaning match using sentence embeddings. Review hint only — not a plagiarism verdict.
                </p>
              </div>
              {similarity?.matches?.length > 0 && (
                <span className="badge badge-amber">{similarity.matches.length} match(es)</span>
              )}
            </div>

            {simLoading ? (
              <div className="row" style={{ gap: 8 }}><Spinner /> <span className="muted" style={{ fontSize: 13 }}>Running embedding model… (first run may take a minute)</span></div>
            ) : !similarity?.ok && similarity?.reason === 'model_unavailable' ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>Similarity unavailable right now. Try again shortly.</p>
            ) : similarity?.reason === 'no_typed_content' ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>No typed report text to analyze (file-only uploads are skipped in v1).</p>
            ) : similarity?.reason === 'too_short' ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                Report is too short for a reliable comparison
                {similarity?.meta?.min_words ? ` (needs about ${similarity.meta.min_words}+ words)` : ''}.
              </p>
            ) : !similarity?.matches?.length ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>No strong similarities found among this member’s past reports or teammates.</p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {similarity.matches.map((m: any, i: number) => (
                  <div
                    key={`${m.kind}-${m.submission_id ?? 'brief'}-${i}`}
                    className="row between wrap"
                    style={{
                      gap: 12,
                      padding: '12px 14px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-2)',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row wrap" style={{ gap: 8, marginBottom: 4 }}>
                        <strong style={{ fontSize: 18 }}>~{m.percent}%</strong>
                        <span className="badge badge-brand">{kindLabel[m.kind] || m.kind}</span>
                      </div>
                      {m.kind === 'task_brief' ? (
                        <p style={{ margin: 0, fontSize: 14 }}>
                          Close in meaning to the assigned task brief
                          {m.task_title ? ` (“${m.task_title}”)` : ''}.
                        </p>
                      ) : (
                        <p style={{ margin: 0, fontSize: 14 }}>
                          Similar to {m.member_name}’s report on “{m.task_title}”
                          {m.submitted_at ? ` · ${fmtDateTime(m.submitted_at)}` : ''}
                        </p>
                      )}
                    </div>
                    {m.submission_id && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openCompare(m)}>
                        View report
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {similarity?.meta?.disclaimer && (
              <p className="tiny" style={{ marginTop: 12, marginBottom: 0 }}>{similarity.meta.disclaimer}</p>
            )}
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

        <div style={{ display: 'grid', gap: 18, alignSelf: 'start' }}>
          <div className="card card-pad">
            <div className="row between" style={{ marginBottom: 12 }}>
              <h3 className="card-title" style={{ margin: 0 }}>Compliance check</h3>
              <button className="btn btn-ghost btn-sm" onClick={runCompliance} disabled={complianceBusy}>
                {complianceBusy ? 'Checking…' : 'Refresh'}
              </button>
            </div>
            {complianceError ? (
              <div className="row between" style={{ gap: 10 }}>
                <p className="muted" style={{ margin: 0, fontSize: 13, flex: 1 }}>
                  Compliance check unavailable. {complianceError}
                </p>
                <button className="btn btn-ghost btn-sm" onClick={runCompliance} disabled={complianceBusy}>
                  <IcoShield size={13} /> Retry
                </button>
              </div>
            ) : !compliance ? (
              <Loader />
            ) : (
              <>
                <div className="row" style={{ gap: 14, alignItems: 'center' }}>
                  <div
                    style={{ fontSize: 36, fontWeight: 800, lineHeight: 1, color: scoreColor(compliance.score) }}
                  >
                    {compliance.score}%
                  </div>
                  <div>
                    <span className={`badge ${compliance.pass ? 'badge-green' : 'badge-red'}`}>
                      {compliance.pass ? `${memberFirstName} is compliant` : `${memberFirstName} is not compliant`}
                    </span>
                  </div>
                </div>

                <div className="progress" style={{ marginTop: 12 }}>
                  <span style={{ width: `${compliance.score}%`, background: scoreColor(compliance.score) }} />
                </div>

                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 12, marginBottom: 6 }}>Criteria</div>
                {(compliance.criteria || []).length > 0 && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {(compliance.criteria as any[]).map((c: any) => (
                      <div key={c.key} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                        <span
                          style={{
                            color: c.pass ? 'var(--green)' : 'var(--red)',
                            display: 'inline-flex',
                            flexShrink: 0,
                            marginTop: 1,
                          }}
                        >
                          {c.pass ? <IcoCheck size={15} /> : <IcoX size={15} />}
                        </span>
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</span>
                          <span className="tiny" style={{ display: 'block', marginTop: 1 }}>{c.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="divider" style={{ margin: '14px 0' }} />
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Suggested action</div>
                <p className="tiny" style={{ margin: 0, lineHeight: 1.6 }}>{compliance.suggested_action}</p>
              </>
            )}
          </div>

          <div className="card card-pad">
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

      {compareMatch && (
        <Modal
          title={`Compare reports (~${compareMatch.percent}% similar)`}
          onClose={() => { setCompareMatch(null); setCompareData(null); }}
          wide
          footer={
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setCompareMatch(null); setCompareData(null); }}>
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const otherId = compareMatch.submission_id;
                  setCompareMatch(null);
                  setCompareData(null);
                  nav(`/review/${otherId}`);
                }}
              >
                Open full review
              </button>
            </div>
          }
        >
          {compareLoading || !compareData ? (
            <div className="row" style={{ gap: 8 }}><Spinner /> <span className="muted">Loading matched report…</span></div>
          ) : (
            <div className="grid responsive-split" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="card card-pad" style={{ margin: 0 }}>
                <div className="row between wrap" style={{ gap: 8, marginBottom: 10 }}>
                  <h4 className="card-title" style={{ margin: 0 }}>Current report</h4>
                  <span className="badge badge-brand">This submission</span>
                </div>
                <p className="tiny" style={{ marginTop: 0 }}>
                  {s.member_name} · {s.task_title} · {fmtDateTime(s.submitted_at)}
                </p>
                {s.content
                  ? <p style={{ lineHeight: 1.65, whiteSpace: 'pre-wrap', fontSize: 14 }}>{s.content}</p>
                  : <p className="muted">No typed content.</p>}
              </div>
              <div className="card card-pad" style={{ margin: 0 }}>
                <div className="row between wrap" style={{ gap: 8, marginBottom: 10 }}>
                  <h4 className="card-title" style={{ margin: 0 }}>Matched report</h4>
                  <span className="badge badge-amber">{kindLabel[compareMatch.kind] || compareMatch.kind}</span>
                </div>
                <p className="tiny" style={{ marginTop: 0 }}>
                  {compareData.submission.member_name} · {compareData.submission.task_title} · {fmtDateTime(compareData.submission.submitted_at)}
                </p>
                {compareData.submission.content
                  ? <p style={{ lineHeight: 1.65, whiteSpace: 'pre-wrap', fontSize: 14 }}>{compareData.submission.content}</p>
                  : <p className="muted">No typed content.</p>}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
