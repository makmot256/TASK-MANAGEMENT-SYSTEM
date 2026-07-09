import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Avatar, fmtDateTime, Loader, EmptyState } from '../../components/ui';
import { IcoReview } from '../../lib/icons';

export default function ReviewQueue() {
  const nav = useNavigate();
  const [subs, setSubs] = useState<any[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending'>('pending');

  useEffect(() => {
    (async () => {
      const { data } = await api.get('/submissions/review');
      setSubs(data.submissions);
      setPending(Number(data.pending) || data.submissions.filter((s: any) => !s.assessed).length);
      setLoading(false);
    })();
  }, []);

  const shown = filter === 'pending' ? subs.filter((s) => !s.assessed) : subs;

  return (
    <div className="page">
      <div className="row between wrap">
        <div>
          <h1 className="page-title">
            Review Queue
            {pending > 0 && <span className="page-count">{pending}</span>}
          </h1>
          <p className="page-sub">Open member submissions, leave feedback and assess quality. Peer reviewers are assigned automatically on upload.</p>
        </div>
        <div className="pill-toggle">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            All{subs.length ? ` (${subs.length})` : ''}
          </button>
          <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>
            Pending{pending ? ` (${pending})` : ''}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        {loading ? <div className="card-pad"><Loader /></div> : shown.length === 0 ? (
          <EmptyState
            icon={<IcoReview size={56} />}
            title={filter === 'pending' ? 'No pending reviews' : 'No submissions to review'}
            sub={filter === 'pending' ? 'You are caught up — new member submissions will show here.' : 'Submissions from your members will appear here.'}
          />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Task</th>
                  <th>Type</th>
                  <th>Peer reviewers</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <Avatar name={s.member_name} color={s.avatar_color} size="sm" />
                        <span style={{ fontWeight: 600 }}>{s.member_name}</span>
                      </div>
                    </td>
                    <td>{s.task_title}</td>
                    <td>
                      <span className="badge badge-brand">
                        {s.kind === 'daily_log' ? 'Daily log' : 'Task report'}
                      </span>
                    </td>
                    <td>
                      {(s.peer_reviewers || []).length === 0 ? (
                        <span className="tiny">None assigned</span>
                      ) : (
                        <div className="row wrap" style={{ gap: 6 }}>
                          {(s.peer_reviewers || []).map((r: any) => (
                            <div
                              key={r.id || r.reviewer_id}
                              className="row"
                              style={{ gap: 6 }}
                              title={`${r.reviewer_name} · ${r.status}`}
                            >
                              <Avatar name={r.reviewer_name} color={r.reviewer_color} size="sm" />
                              <span style={{ fontSize: 13 }}>{r.reviewer_name.split(' ')[0]}</span>
                              <span
                                className={`badge ${
                                  r.status === 'completed'
                                    ? 'badge-green'
                                    : r.status === 'missed'
                                      ? 'badge-red'
                                      : 'badge-amber'
                                }`}
                                style={{ fontSize: 10, padding: '2px 6px' }}
                              >
                                {r.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="muted">{fmtDateTime(s.submitted_at)}</td>
                    <td>
                      {s.assessed
                        ? <span className="badge badge-green">Reviewed</span>
                        : <span className="badge badge-amber">Pending</span>}
                    </td>
                    <td>
                      <button className="btn btn-primary btn-sm" onClick={() => nav(`/review/${s.id}`)}>
                        Open
                      </button>
                    </td>
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
