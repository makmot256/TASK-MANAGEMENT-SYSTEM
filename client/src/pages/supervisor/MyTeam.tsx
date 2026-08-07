import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Avatar, RiskBadge, Loader, EmptyState, pct } from '../../components/ui';
import { IcoTeam } from '../../lib/icons';

export default function MyTeam() {
  const [data, setData] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [o, t] = await Promise.all([api.get('/analytics/overview'), api.get('/users/me/teams')]);
      setData(o.data); setTeams(t.data.teams); setLoading(false);
    })();
  }, []);

  if (loading) return <div className="page"><Loader /></div>;
  const members = data.members || [];

  return (
    <div className="page">
      <h1 className="page-title">My Team</h1>
      <p className="page-sub">Members under your supervision{teams.length ? ` · ${teams.map((t) => t.name).join(', ')}` : ''}.</p>

      {members.length === 0 ? (
        <div className="card card-pad" style={{ marginTop: 22 }}><EmptyState icon={<IcoTeam size={56} />} title="No members assigned" sub="Your administrator assigns members to your team." /></div>
      ) : (
        <div className="grid grid-3" style={{ marginTop: 22 }}>
          {members.map((m: any) => (
            <div key={m.id} className="card card-pad">
              <div className="row" style={{ gap: 12 }}><Avatar name={m.full_name} color={m.avatar_color} /><div><div style={{ fontWeight: 700 }}>{m.full_name}</div><div className="tiny">{m.title || 'Member'}</div></div></div>
              <div style={{ marginTop: 14 }}><RiskBadge risk={m.risk} /></div>
              <div className="divider" />
              <Row label="Performance Index" value={pct(m.performance.pi)} />
              <Row label="Engagement score" value={m.engagement.score != null ? String(m.engagement.score) : 'No data'} />
              <Row label="Timeliness" value={pct(m.performance.timeliness)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="row between" style={{ padding: '6px 0' }}><span className="muted" style={{ fontSize: 14 }}>{label}</span><strong style={{ fontSize: 14 }}>{value}</strong></div>
);
