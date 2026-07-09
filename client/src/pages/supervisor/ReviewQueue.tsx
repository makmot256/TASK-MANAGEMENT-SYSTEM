import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Avatar, fmtDateTime, Loader, EmptyState } from '../../components/ui';
import { IcoReview } from '../../lib/icons';

type Filter = 'all' | 'new' | 'pending' | 'completed';

function queueStatus(s: any): 'new' | 'pending' | 'completed' {
  if (s.queue_status === 'reviewed') return 'completed';
  if (s.queue_status) return s.queue_status;
  if (!s.assessed) return 'new';
  if (s.revision_requested_at && s.assignment_status !== 'Completed') return 'pending';
  return 'completed';
}

export default function ReviewQueue() {
  const nav = useNavigate();
  const [subs, setSubs] = useState<any[]>([]);
  const [counts, setCounts] = useState({ all: 0, new: 0, pending: 0, completed: 0 });
  const [attention, setAttention] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('new');

  useEffect(() => {
    (async () => {
      const { data } = await api.get('/submissions/review');
      const list = data.submissions || [];
      setSubs(list);
      const c = data.counts || {
        all: list.length,
        new: list.filter((s: any) => queueStatus(s) === 'new').length,
        pending: list.filter((s: any) => queueStatus(s) === 'pending').length,
        completed: list.filter((s: any) => queueStatus(s) === 'completed').length,
      };
      setCounts({
        all: c.all ?? list.length,
        new: c.new ?? 0,
        pending: c.pending ?? 0,
        completed: c.completed ?? c.reviewed ?? 0,
      });
      setAttention(Number(data.pending) || (c.new || 0) + (c.pending || 0));
      setLoading(false);
    })();
  }, []);

  const shown = useMemo(() => {
    if (filter === 'all') return subs;
    return subs.filter((s) => queueStatus(s) === filter);
  }, [subs, filter]);

  const emptyCopy: Record<Filter, { title: string; sub: string }> = {
    all: {
      title: 'No submissions to review',
      sub: 'Submissions from your members will appear here.',
    },
    new: {
      title: 'No new submissions',
      sub: 'Fresh member uploads waiting for your first review will show here.',
    },
    pending: {
      title: 'No pending revisions',
      sub: 'Items you reviewed but did not fully approve (revision requested) stack here.',
    },
    completed: {
      title: 'No completed reviews',
      sub: 'Approved submissions go straight here after you mark them complete.',
    },
  };

  const statusBadge = (s: any) => {
    const status = queueStatus(s);
    if (status === 'new') return <span className="badge badge-brand">New</span>;
    if (status === 'pending') return <span className="badge badge-amber">Pending revision</span>;
    return <span className="badge badge-green">Completed</span>;
  };

  return (
    <div className="page">
      <div className="row between wrap">
        <div>
          <h1 className="page-title">
            Review Queue
            {attention > 0 && <span className="page-count">{attention}</span>}
          </h1>
          <p className="page-sub">
            New uploads land in New. Request a revision and they move to Pending. Approve &amp; mark
            complete and they go straight to Completed. Peer reviewers are assigned on upload.
          </p>
        </div>
        <div className="pill-toggle">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            All{counts.all ? ` (${counts.all})` : ''}
          </button>
          <button className={filter === 'new' ? 'active' : ''} onClick={() => setFilter('new')}>
            New{counts.new ? ` (${counts.new})` : ''}
          </button>
          <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>
            Pending{counts.pending ? ` (${counts.pending})` : ''}
          </button>
          <button className={filter === 'completed' ? 'active' : ''} onClick={() => setFilter('completed')}>
            Completed{counts.completed ? ` (${counts.completed})` : ''}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        {loading ? <div className="card-pad"><Loader /></div> : shown.length === 0 ? (
          <EmptyState
            icon={<IcoReview size={56} />}
            title={emptyCopy[filter].title}
            sub={emptyCopy[filter].sub}
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
                    <td>{statusBadge(s)}</td>
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
