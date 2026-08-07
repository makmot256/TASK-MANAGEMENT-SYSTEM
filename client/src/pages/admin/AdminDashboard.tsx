import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Loader } from '../../components/ui';
import { IcoUsers, IcoTasks, IcoReport, IcoShield, IcoCheck, IcoAlert } from '../../lib/icons';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

const ROLE_COLORS: Record<string, string> = { admin: '#7c3aed', supervisor: '#2453d6', member: '#0d9488' };

export default function AdminDashboard() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await api.get('/admin/health');
      setHealth(data);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="page"><Loader /></div>;

  const c = health.counts;
  const roleData = health.users_by_role.map((r: any) => ({ name: r.role, value: r.c }));
  const uptime = Math.floor(health.uptime_seconds / 3600);

  return (
    <div className="page">
      <h1 className="page-title">System Administration</h1>
      <p className="page-sub">Platform health, users and configuration overview.</p>

      <div className="grid grid-4" style={{ marginTop: 22 }}>
        <Stat icon={<IcoUsers size={22} />} color="var(--brand)" bg="var(--brand-soft)" label="Total users" value={c.users} />
        <Stat icon={<IcoTasks size={22} />} color="var(--green)" bg="var(--green-soft)" label="Tasks" value={c.tasks} />
        <Stat icon={<IcoReport size={22} />} color="var(--amber)" bg="var(--amber-soft)" label="Submissions" value={c.submissions} />
        <Stat icon={<IcoShield size={22} />} color="var(--accent)" bg="var(--accent-soft)" label="API uptime" value={`${uptime}h`} />
      </div>

      <div className="grid responsive-split" style={{ gridTemplateColumns: '1fr 1.4fr', marginTop: 18 }}>
        <div className="card card-pad">
          <h3 className="card-title" style={{ marginBottom: 12 }}>Users by role</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={roleData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}>
                {roleData.map((r: any) => <Cell key={r.name} fill={ROLE_COLORS[r.name] || '#64748b'} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card card-pad">
          <h3 className="card-title" style={{ marginBottom: 16 }}>System health</h3>
          <HealthRow icon={<IcoCheck size={16} />} ok label="Database connection" value={health.db} />
          <HealthRow icon={<IcoCheck size={16} />} ok label="Successful logins (24h)" value={String(health.logins_24h)} />
          <HealthRow icon={<IcoAlert size={16} />} ok={health.failed_logins_24h < 10} label="Failed logins (24h)" value={String(health.failed_logins_24h)} />
          <HealthRow icon={<IcoCheck size={16} />} ok label="Activity log records" value={String(c.activity_logs)} />
          <HealthRow icon={<IcoCheck size={16} />} ok label="Notifications sent" value={String(c.notifications)} />
          <div className="divider" />
          <div className="row" style={{ gap: 10 }}>
            <Link to="/users" className="btn btn-primary btn-sm">Manage users</Link>
            <Link to="/settings" className="btn btn-ghost btn-sm">System settings</Link>
            <Link to="/audit" className="btn btn-ghost btn-sm">View audit log</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const Stat = ({ icon, color, bg, label, value }: any) => (
  <div className="stat"><div className="row between"><div><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div><div className="stat-ico" style={{ background: bg, color }}>{icon}</div></div></div>
);
const HealthRow = ({ icon, ok, label, value }: any) => (
  <div className="row between" style={{ padding: '9px 0' }}>
    <span className="row" style={{ gap: 8 }}><span style={{ color: ok ? 'var(--green)' : 'var(--red)' }}>{icon}</span><span style={{ fontSize: 14 }}>{label}</span></span>
    <strong style={{ fontSize: 14, textTransform: 'capitalize' }}>{value}</strong>
  </div>
);
