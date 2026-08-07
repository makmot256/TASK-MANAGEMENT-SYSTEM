import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { StatusBadge, PriorityBadge, fmtDate, Loader, EmptyState, pct } from '../../components/ui';
import { IcoTasks, IcoCheck, IcoTrend, IcoStar } from '../../lib/icons';
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from 'recharts';

export default function MemberDashboard() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [t, s] = await Promise.all([api.get('/tasks'), api.get('/analytics/me')]);
      setTasks(t.data.tasks);
      setSummary(s.data);
      setLoading(false);
    })();
  }, []);

  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'Completed').length;
  const inProgress = tasks.filter((t) => t.status === 'In Progress').length;
  const rate = total ? Math.round((completed / total) * 100) : 0;
  const eng = summary?.engagement;
  const upcoming = [...tasks].filter((t) => t.status !== 'Completed' && t.deadline).sort((a, b) => +new Date(a.deadline) - +new Date(b.deadline)).slice(0, 5);

  return (
    <div className="page">
      <h1 className="page-title">Hello, {user?.full_name.split(' ')[0]} 👋</h1>
      <p className="page-sub">Here's your workload and progress at a glance.</p>

      {loading ? <div style={{ marginTop: 22 }}><Loader /></div> : (
        <>
          <div className="grid grid-4" style={{ marginTop: 22 }}>
            <Stat icon={<IcoTasks size={22} />} color="var(--brand)" bg="var(--brand-soft)" label="Total tasks" value={total} />
            <Stat icon={<IcoCheck size={22} />} color="var(--green)" bg="var(--green-soft)" label="Completed" value={completed} />
            <Stat icon={<IcoTrend size={22} />} color="var(--amber)" bg="var(--amber-soft)" label="In progress" value={inProgress} />
            <Stat icon={<IcoStar size={22} />} color="var(--accent)" bg="var(--accent-soft)" label="Completion rate" value={`${rate}%`} />
          </div>

          <div className="grid responsive-split" style={{ gridTemplateColumns: '1.6fr 1fr', marginTop: 18 }}>
            <div className="card card-pad">
              <div className="card-head"><span className="card-title">Upcoming deadlines</span><Link to="/tasks" className="btn btn-ghost btn-sm">View all</Link></div>
              {upcoming.length === 0 ? <EmptyState icon={<IcoTasks size={56} />} title="Nothing due" sub="You're all caught up." /> : (
                <table className="table">
                  <thead><tr><th>Task</th><th>Priority</th><th>Status</th><th>Due</th></tr></thead>
                  <tbody>
                    {upcoming.map((t) => (
                      <tr key={t.id}>
                        <td><Link to={`/tasks/${t.id}`} style={{ fontWeight: 600 }}>{t.title}</Link></td>
                        <td><PriorityBadge priority={t.priority} /></td>
                        <td><StatusBadge status={t.status} /></td>
                        <td className="muted">{fmtDate(t.deadline)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card card-pad">
              <span className="card-title">Engagement score</span>
              {eng?.status === 'insufficient_data' ? (
                <EmptyState title="Insufficient data" sub="Your score appears after ~2 weeks of activity." />
              ) : (
                <>
                  <div style={{ height: 180, position: 'relative' }}>
                    <ResponsiveContainer>
                      <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ name: 'score', value: eng?.score || 0, fill: eng?.status === 'at_risk' ? 'var(--red)' : eng?.status === 'moderate' ? 'var(--amber)' : 'var(--green)' }]} startAngle={90} endAngle={-270}>
                        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                        <RadialBar background dataKey="value" cornerRadius={20} />
                      </RadialBarChart>
                    </ResponsiveContainer>
                    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', flexDirection: 'column' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 34, fontWeight: 800 }}>{eng?.score ?? '—'}</div>
                        <div className="tiny">out of 100</div>
                      </div>
                    </div>
                  </div>
                  <Bar label="Login activity" value={eng?.login_frequency || 0} />
                  <Bar label="Task updates" value={eng?.task_update_frequency || 0} />
                  <Bar label="Submission timeliness" value={eng?.submission_timeliness || 0} />
                </>
              )}
            </div>
          </div>

          {summary?.performance && (
            <div className="card card-pad" style={{ marginTop: 18 }}>
              <span className="card-title">Task Performance (TP)</span>
              <div className="row between wrap" style={{ marginTop: 12, gap: 12 }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800 }}>{pct(summary.performance.tp)}</div>
                  <div className="tiny">Performance Index: {pct(summary.performance.pi)}</div>
                </div>
                {(summary.performance.reviewer_penalties?.missed_reviews > 0 ||
                  summary.performance.reviewer_penalties?.vulgar_comments > 0) && (
                  <span className="badge badge-red">
                    Reviewer penalties applied
                  </span>
                )}
              </div>
              {summary.performance.reviewer_penalties && (
                <p className="muted" style={{ fontSize: 13, marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>
                  {summary.performance.reviewer_penalties.missed_reviews > 0 &&
                    `${summary.performance.reviewer_penalties.missed_reviews} missed peer review(s). `}
                  {summary.performance.reviewer_penalties.vulgar_comments > 0 &&
                    `${summary.performance.reviewer_penalties.vulgar_comments} inappropriate comment(s). `}
                  {(summary.performance.reviewer_penalties.missed_reviews > 0 ||
                    summary.performance.reviewer_penalties.vulgar_comments > 0) &&
                    `TP reduced by ${pct(summary.performance.reviewer_penalties.tp_deduction)}.`}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const Stat = ({ icon, color, bg, label, value }: any) => (
  <div className="stat">
    <div className="row between">
      <div><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div>
      <div className="stat-ico" style={{ background: bg, color }}>{icon}</div>
    </div>
  </div>
);

const Bar = ({ label, value }: { label: string; value: number }) => (
  <div style={{ marginTop: 12 }}>
    <div className="row between" style={{ marginBottom: 5 }}><span className="tiny">{label}</span><span className="tiny" style={{ fontWeight: 700 }}>{Math.round(value)}%</span></div>
    <div className="progress"><span style={{ width: `${value}%` }} /></div>
  </div>
);
