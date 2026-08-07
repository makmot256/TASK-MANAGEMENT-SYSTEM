import React, { useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Avatar, Loader, EmptyState, fmtDate } from '../../components/ui';
import { IcoStar } from '../../lib/icons';

type SortKey = 'date' | 'reviewer' | 'author' | 'status';

export default function PeerInsights() {
  const toast = useToast();
  const [reviews, setReviews] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [distribution, setDistribution] = useState<any[]>([]);
  const [assignStats, setAssignStats] = useState<any>(null);
  const [poolSize, setPoolSize] = useState(0);
  const [loading, setLoading] = useState(true);

  const [member, setMember] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    (async () => {
      try {
        const [rev, asn] = await Promise.all([
          api.get('/analytics/peer-reviews'),
          api.get('/analytics/peer-assignments'),
        ]);
        setReviews(rev.data.reviews);
        setMembers(rev.data.members);
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

  const filtered = useMemo(() => {
    let rows = reviews.filter((r) => {
      if (member && String(r.assessor_id) !== member && String(r.assessee_id) !== member) return false;
      if (statusFilter === 'peer_review' && r.kind !== 'peer_review') return false;
      if (statusFilter === 'collaboration' && r.kind !== 'collaboration') return false;
      return true;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (sortBy === 'date') return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      if (sortBy === 'reviewer') return String(a.assessor_name).localeCompare(String(b.assessor_name)) * dir;
      if (sortBy === 'author') return String(a.assessee_name).localeCompare(String(b.assessee_name)) * dir;
      return String(a.kind).localeCompare(String(b.kind)) * dir;
    });
    return rows;
  }, [reviews, member, statusFilter, sortBy, sortDir]);

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

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir(key === 'date' ? 'desc' : 'asc');
    }
  };

  const sortMark = (key: SortKey) => (sortBy === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

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
          <div className="stat" style={{ padding: 14 }}><div className="stat-label">Pending</div><div className="stat-value" style={{ fontSize: 22 }}>{assignStats?.pending ?? 0}</div></div>
          <div className="stat" style={{ padding: 14 }}><div className="stat-label">Missed (penalized)</div><div className="stat-value" style={{ fontSize: 22 }}>{assignStats?.missed ?? 0}</div></div>
          <div className="stat" style={{ padding: 14 }}><div className="stat-label">Avg. per reviewer</div><div className="stat-value" style={{ fontSize: 22 }}>{assignStats?.avgPerReviewer ?? 0}</div></div>
          <div className="stat" style={{ padding: 14 }}><div className="stat-label">Workload spread</div><div className="stat-value" style={{ fontSize: 22 }}>{workloadSpread.min}–{workloadSpread.max}</div></div>
        </div>

        {distribution.every((d) => !Number(d.assigned_count)) ? (
          <EmptyState icon={<IcoStar size={48} />} title="No peer reviews yet" sub="Distribution appears when members upload task reports." />
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
          <div>
            <span className="card-title">Completed reviews</span>
            <p className="tiny" style={{ marginTop: 4 }}>
              Scored peer and collaboration reviews · {filtered.length} shown
            </p>
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            <select className="select" style={{ maxWidth: 180 }} value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="">All members</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
            <select className="select" style={{ maxWidth: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All types</option>
              <option value="peer_review">Peer reviews</option>
              <option value="collaboration">Collaboration</option>
            </select>
            <select
              className="select"
              style={{ maxWidth: 150 }}
              value={`${sortBy}:${sortDir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split(':') as [SortKey, 'asc' | 'desc'];
                setSortBy(k);
                setSortDir(d);
              }}
            >
              <option value="date:desc">Newest first</option>
              <option value="date:asc">Oldest first</option>
              <option value="reviewer:asc">Reviewer A–Z</option>
              <option value="author:asc">Author A–Z</option>
              <option value="status:asc">Type A–Z</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<IcoStar size={56} />} title="No reviews yet" sub="Completed peer and collaboration reviews will appear here." />
        ) : (
          <div className="table-scroll">
            <table className="table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Task / subject</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('reviewer')}>Reviewer{sortMark('reviewer')}</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('author')}>Author{sortMark('author')}</th>
                  <th>Type</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('status')}>Score{sortMark('status')}</th>
                  <th>Comment</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('date')}>Date{sortMark('date')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.task_title || (r.kind === 'peer_review' ? 'Peer review' : 'Collaboration')}</strong></td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <Avatar name={r.assessor_name} color={r.assessor_color} size="sm" />
                        <span style={{ fontWeight: 600 }}>{r.assessor_name}</span>
                      </div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <Avatar name={r.assessee_name} color={r.assessee_color} size="sm" />
                        <span style={{ fontWeight: 600 }}>{r.assessee_name}</span>
                      </div>
                    </td>
                    <td>
                      {r.kind === 'peer_review' ? (
                        <span className="badge badge-brand">Peer review</span>
                      ) : (
                        <span className="badge badge-grey">Collaboration</span>
                      )}
                    </td>
                    <td>
                      <strong>{r.score}/5</strong>
                      {r.vulgar_comment ? <span className="badge badge-red" style={{ marginLeft: 6 }}>Vulgar</span> : null}
                    </td>
                    <td className="muted" style={{ maxWidth: 280 }}>{r.comment || '—'}</td>
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
