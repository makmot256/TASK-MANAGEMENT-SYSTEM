import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Avatar, fmtDateTime, Loader, EmptyState } from '../../components/ui';
import { IcoReview } from '../../lib/icons';

export default function ReviewQueue() {
  const nav = useNavigate();
  const [subs, setSubs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending'>('all');

  useEffect(() => {
    (async () => {
      const { data } = await api.get('/submissions/review');
      setSubs(data.submissions);
      setLoading(false);
    })();
  }, []);

  const shown = filter === 'pending' ? subs.filter((s) => !s.assessed) : subs;

  return (
    <div className="page">
      <div className="row between wrap">
        <div><h1 className="page-title">Review Queue</h1><p className="page-sub">Open member submissions, leave feedback and assess quality.</p></div>
        <div className="pill-toggle">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
          <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>Pending</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        {loading ? <div className="card-pad"><Loader /></div> : shown.length === 0 ? (
          <EmptyState icon={<IcoReview size={56} />} title="No submissions to review" sub="Submissions from your members will appear here." />
        ) : (
          <table className="table">
            <thead><tr><th>Member</th><th>Task</th><th>Type</th><th>Submitted</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td><div className="row" style={{ gap: 10 }}><Avatar name={s.member_name} color={s.avatar_color} size="sm" /><span style={{ fontWeight: 600 }}>{s.member_name}</span></div></td>
                  <td>{s.task_title}</td>
                  <td><span className="badge badge-brand">{s.kind === 'daily_log' ? 'Daily log' : 'Weekly report'}</span></td>
                  <td className="muted">{fmtDateTime(s.submitted_at)}</td>
                  <td>{s.assessed ? <span className="badge badge-green">Reviewed</span> : <span className="badge badge-amber">Pending</span>}</td>
                  <td><button className="btn btn-primary btn-sm" onClick={() => nav(`/review/${s.id}`)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
