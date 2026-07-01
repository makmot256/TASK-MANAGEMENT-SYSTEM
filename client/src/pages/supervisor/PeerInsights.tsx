import React, { useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Avatar, Loader, EmptyState, fmtDate } from '../../components/ui';
import { IcoStar } from '../../lib/icons';

export default function PeerInsights() {
  const toast = useToast();
  const [reviews, setReviews] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [distribution, setDistribution] = useState<any[]>([]);
  const [assignStats, setAssignStats] = useState<any>(null);
  const [poolSize, setPoolSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState('');
  const [kind, setKind] = useState('');
  const [assignFilter, setAssignFilter] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [rev, asn] = await Promise.all([
          api.get('/analytics/peer-reviews'),
          api.get('/analytics/peer-assignments'),
        ]);
        setReviews(rev.data.reviews);
        setMembers(rev.data.members);
        setAssignments(asn.data.assignments || []);
        setDistribution(asn.data.distribution || []);
        setAssignStats(asn.data.stats || null);
        setPoolSize(asn.data.poolSize || 0);
      } catch (err) {
        toast(errMsg(err), 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => reviews.filter((r) => {
    if (kind && r.kind !== kind) return false;
    if (member && String(r.assessor_id) !== member && String(r.assessee_id) !== member) return false;
    return true;
  }), [reviews, member, kind]);

  const filteredAssignments = useMemo(() => assignments.filter((a) => {
    if (assignFilter === 'pending' && a.status !== 'pending') return false;
    if (assignFilter === 'completed' && a.status !== 'completed') return false;
    if (assignFilter === 'missed' && a.status !== 'missed') return false;
    if (member && String(a.reviewer_id) !== member && String(a.reviewee_id) !== member) return false;
    return true;
  }), [assignments, assignFilter, member]);

  const stats = useMemo(() => {
    const peer = reviews.filter((r) => r.kind === 'peer_review');
    const collab = reviews.filter((r) => r.kind === 'collaboration');
    const avg = (a: any[]) => (a.length ? (a.reduce((s, r) => s + Number(r.score), 0) / a.length).toFixed(1) : '—');
    return { total: reviews.length, peerAvg: avg(peer), collabAvg: avg(collab) };
  }, [reviews]);

  const workloadSpread = useMemo(() => {
    const withAssignments = distribution.filter((d) => Number(d.assigned_count) > 0);
    if (!withAssignments.length) return { min: 0, max: 0 };
    const counts = withAssignments.map((d) => Number(d.assigned_count));
    return { min: Math.min(...counts), max: Math.max(...counts) };
  }, [distribution]);

  if (loading) return <div className="page"><Loader /></div>;

  return (
    <div className="page">
      <div className="row between wrap">
        <div>
          <h1 className="page-title">Peer Reviews</h1>
          <p className="page-sub">
            When a member uploads a task report, the system automatically assigns up to 3 peer
            reviewers from the entire member pool (any group). Reviewer identity is hidden from
            the author — only supervisors see who reviewed whom.
          </p>
        </div>
        <span className="badge badge-brand">Auto on upload</span>
      </div>

      <div className="grid grid-3" style={{ marginTop: 22 }}>
        <div className="stat"><div className="stat-label">Total reviews</div><div className="stat-value" style={{ fontSize: 26 }}>{stats.total}</div></div>
        <div className="stat"><div className="stat-label">Avg. peer-review score</div><div className="stat-value" style={{ fontSize: 26 }}>{stats.peerAvg}</div></div>
        <div className="stat"><div className="stat-label">Avg. collaboration score</div><div className="stat-value" style={{ fontSize: 26 }}>{stats.collabAvg}</div></div>
      </div>

      <div className="card card-pad" style={{ marginTop: 18 }}>
        <h3 className="card-title">Reviewer distribution</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          Up to 3 reviewers are picked per upload from {poolSize} eligible members, prioritizing
          lower engagement and balancing workload.
        </p>

        <div className="grid grid-4" style={{ marginTop: 16, gap: 12 }}>
          <div className="stat" style={{ padding: 14 }}><div className="stat-label">Assignments</div><div className="stat-value" style={{ fontSize: 22 }}>{assignStats?.total ?? 0}</div></div>
          <div className="stat" style={{ padding: 14 }}><div className="stat-label">Pending</div><div className="stat-value" style={{ fontSize: 22 }}>{assignStats?.pending ?? 0}</div></div>
          <div className="stat" style={{ padding: 14 }}><div className="stat-label">Missed (penalized)</div><div className="stat-value" style={{ fontSize: 22 }}>{assignStats?.missed ?? 0}</div></div>
          <div className="stat" style={{ padding: 14 }}><div className="stat-label">Avg. per reviewer</div><div className="stat-value" style={{ fontSize: 22 }}>{assignStats?.avgPerReviewer ?? 0}</div></div>
          <div className="stat" style={{ padding: 14 }}><div className="stat-label">Workload spread</div><div className="stat-value" style={{ fontSize: 22 }}>{workloadSpread.min}–{workloadSpread.max}</div></div>
        </div>

        {distribution.every((d) => !Number(d.assigned_count)) ? (
          <EmptyState icon={<IcoStar size={48} />} title="No assignments yet" sub="Assignments appear when members upload task reports." />
        ) : (
          <div className="table-scroll" style={{ marginTop: 16 }}>
            <table className="table">
              <thead><tr><th>Reviewer</th><th>Assigned</th><th>Completed</th><th>Pending</th><th>Missed</th><th>Engagement</th></tr></thead>
              <tbody>
                {distribution.filter((d) => Number(d.assigned_count) > 0).map((d) => (
                  <tr key={d.id}>
                    <td><div className="row" style={{ gap: 8 }}><Avatar name={d.full_name} color={d.avatar_color} size="sm" /><span style={{ fontWeight: 600 }}>{d.full_name}</span></div></td>
                    <td><strong>{d.assigned_count}</strong></td>
                    <td>{d.completed_count}</td>
                    <td>{d.pending_count}</td>
                    <td>{d.missed_count ?? 0}</td>
                    <td><span className={`badge ${d.engagement_status === 'at_risk' ? 'badge-red' : d.engagement_status === 'moderate' ? 'badge-amber' : 'badge-grey'}`}>{d.engagement_score != null ? Number(d.engagement_score).toFixed(0) : '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="row between wrap card-pad" style={{ paddingBottom: 0, gap: 10 }}>
          <span className="card-title">Assignment ledger</span>
          <div className="row" style={{ gap: 10 }}>
            <select className="select" style={{ maxWidth: 200 }} value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="">All members</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
            <div className="pill-toggle">
              {[['', 'All'], ['pending', 'Pending'], ['completed', 'Done'], ['missed', 'Missed']].map(([v, l]) => (
                <button key={v} className={assignFilter === v ? 'active' : ''} onClick={() => setAssignFilter(v)}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        {filteredAssignments.length === 0 ? (
          <EmptyState icon={<IcoStar size={48} />} title="No assignments to show" sub="Each uploaded report triggers up to 3 peer review assignments." />
        ) : (
          <div className="table-scroll">
            <table className="table" style={{ marginTop: 12 }}>
              <thead><tr><th>Task / report</th><th>Reviewer</th><th>Author</th><th>Status</th><th>Assigned</th></tr></thead>
              <tbody>
                {filteredAssignments.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.task_title}</strong></td>
                    <td><div className="row" style={{ gap: 8 }}><Avatar name={a.reviewer_name} color={a.reviewer_color} size="sm" /><span>{a.reviewer_name}</span></div></td>
                    <td><div className="row" style={{ gap: 8 }}><Avatar name={a.reviewee_name} color={a.reviewee_color} size="sm" /><span>{a.reviewee_name}</span></div></td>
                    <td><span className={`badge ${a.status === 'completed' ? 'badge-green' : a.status === 'missed' ? 'badge-red' : 'badge-amber'}`}>{a.status}</span></td>
                    <td className="muted">{fmtDate(a.assigned_at)}{a.due_at ? ` · due ${fmtDate(a.due_at)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="row between wrap card-pad" style={{ paddingBottom: 0, gap: 10 }}>
          <span className="card-title">Completed reviews</span>
          <div className="pill-toggle">
            {[['', 'All'], ['peer_review', 'Peer'], ['collaboration', 'Collab']].map(([v, l]) => (
              <button key={v} className={kind === v ? 'active' : ''} onClick={() => setKind(v)}>{l}</button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<IcoStar size={56} />} title="No peer reviews to show" sub="Reviews appear once assigned members complete their reviews." />
        ) : (
          <div className="table-scroll">
            <table className="table" style={{ marginTop: 12 }}>
              <thead><tr><th>Reviewer</th><th>Reviewed</th><th>Type</th><th>Score</th><th>Comment</th><th>Date</th></tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td><div className="row" style={{ gap: 8 }}><Avatar name={r.assessor_name} color={r.assessor_color} size="sm" /><span style={{ fontWeight: 600 }}>{r.assessor_name}</span></div></td>
                    <td><div className="row" style={{ gap: 8 }}><Avatar name={r.assessee_name} color={r.assessee_color} size="sm" /><span style={{ fontWeight: 600 }}>{r.assessee_name}</span></div></td>
                    <td><span className={`badge ${r.kind === 'peer_review' ? 'badge-brand' : 'badge-grey'}`}>{r.kind === 'peer_review' ? 'Peer' : 'Collaboration'}</span></td>
                    <td><strong>{r.score}/5</strong>{r.vulgar_comment ? <span className="badge badge-red" style={{ marginLeft: 6 }}>Vulgar</span> : null}</td>
                    <td className="muted" style={{ maxWidth: 320 }}>{r.comment || '—'}</td>
                    <td className="muted">{fmtDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
