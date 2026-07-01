import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Avatar, RiskBadge, Loader, EmptyState, pct } from '../../components/ui';
import { IcoUsers, IcoAlert, IcoCheck, IcoChart } from '../../lib/icons';

export default function SupervisorDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await api.get('/analytics/overview');
      setData(data);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="page"><Loader /></div>;

  const members = data.members || [];
  const atRisk = members.filter((m: any) => m.engagement.status === 'at_risk');
  const onTrack = members.filter((m: any) => m.engagement.status === 'on_track');
  const cohort = data.cohort;

  return (
    <div className="page">
      <h1 className="page-title">Supervisor Dashboard</h1>
      <p className="page-sub">Real-time overview of your team's progress and engagement.</p>

      <div className="grid grid-4" style={{ marginTop: 22 }}>
        <Stat icon={<IcoUsers size={22} />} color="var(--brand)" bg="var(--brand-soft)" label="Team members" value={members.length} />
        <Stat icon={<IcoCheck size={22} />} color="var(--green)" bg="var(--green-soft)" label="On track" value={onTrack.length} />
        <Stat icon={<IcoAlert size={22} />} color="var(--red)" bg="var(--red-soft)" label="At risk" value={atRisk.length} />
        <Stat icon={<IcoChart size={22} />} color="var(--accent)" bg="var(--accent-soft)" label="Avg. Performance Index" value={cohort ? pct(cohort.avg_pi) : '—'} />
      </div>

      {atRisk.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 18, borderColor: 'var(--red)', borderLeftWidth: 4 }}>
          <div className="card-head"><span className="card-title row" style={{ gap: 8 }}><IcoAlert size={18} className="" /> At-risk alerts ({atRisk.length})</span><Link to="/analytics" className="btn btn-ghost btn-sm">View analytics</Link></div>
          <div className="grid grid-3">
            {atRisk.map((m: any) => (
              <div key={m.id} className="card" style={{ padding: 14 }}>
                <div className="row" style={{ gap: 10 }}><Avatar name={m.full_name} color={m.avatar_color} size="sm" /><div><div style={{ fontWeight: 600, fontSize: 14 }}>{m.full_name}</div><div className="tiny">Engagement: {m.engagement.score ?? '—'}</div></div></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-pad" style={{ paddingBottom: 0 }}><span className="card-title">Member overview</span></div>
        {members.length === 0 ? <EmptyState icon={<IcoUsers size={56} />} title="No members yet" sub="Ask your administrator to assign members to your team." /> : (
          <table className="table" style={{ marginTop: 12 }}>
            <thead><tr><th>Member</th><th>Status</th><th>Performance Index</th><th>Engagement</th><th>Timeliness</th></tr></thead>
            <tbody>
              {members.map((m: any) => (
                <tr key={m.id}>
                  <td><div className="row" style={{ gap: 10 }}><Avatar name={m.full_name} color={m.avatar_color} size="sm" /><div><div style={{ fontWeight: 600 }}>{m.full_name}</div><div className="tiny">{m.title || 'Member'}</div></div></div></td>
                  <td><RiskBadge risk={m.risk} /></td>
                  <td><div className="row" style={{ gap: 8 }}><div className="progress" style={{ width: 80 }}><span style={{ width: pct(m.performance.pi) }} /></div><strong style={{ fontSize: 13 }}>{pct(m.performance.pi)}</strong></div></td>
                  <td>{m.engagement.score ?? <span className="tiny">No data</span>}</td>
                  <td>{pct(m.performance.timeliness)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const Stat = ({ icon, color, bg, label, value }: any) => (
  <div className="stat"><div className="row between"><div><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div><div className="stat-ico" style={{ background: bg, color }}>{icon}</div></div></div>
);
