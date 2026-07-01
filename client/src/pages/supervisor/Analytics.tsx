import React, { useEffect, useState } from 'react';
import { api, errMsg } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Avatar, RiskBadge, Loader, EmptyState, pct } from '../../components/ui';
import { IcoChart, IcoTrend } from '../../lib/icons';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

export default function Analytics() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [recomputing, setRecomputing] = useState(false);

  const load = async () => {
    const { data } = await api.get('/analytics/overview');
    setData(data);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (selected) api.get(`/analytics/member/${selected}`).then((r) => setDetail(r.data));
    else setDetail(null);
  }, [selected]);

  const recompute = async () => {
    setRecomputing(true);
    try { await api.post('/analytics/recompute'); toast('Analytics recomputed.', 'success'); load(); }
    catch (err) { toast(errMsg(err), 'error'); } finally { setRecomputing(false); }
  };

  if (loading) return <div className="page"><Loader /></div>;
  const members = data.members || [];

  if (members.length === 0) return (
    <div className="page"><h1 className="page-title">Performance Analytics</h1><div className="card card-pad" style={{ marginTop: 22 }}><EmptyState icon={<IcoChart size={56} />} title="Analytics will populate as activity accumulates" sub="Once tasks, reports and peer reviews exist, charts appear here." /></div></div>
  );

  const piData = members.map((m: any) => ({ name: m.full_name.split(' ')[0], PI: Math.round(m.performance.pi * 100), TP: Math.round(m.performance.tp * 100), PE: Math.round(m.performance.pe * 100), SA: Math.round(m.performance.sa * 100) }));
  const cohort = data.cohort;

  return (
    <div className="page">
      <div className="row between wrap">
        <div><h1 className="page-title">Performance Analytics</h1><p className="page-sub">Performance Index = {pct(data.weights.pi_weight_tp)} TP + {pct(data.weights.pi_weight_pe)} PE + {pct(data.weights.pi_weight_sa)} SA</p></div>
        <div className="row" style={{ gap: 10 }}>
          <select className="select" style={{ width: 200 }} value={selected || ''} onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All members</option>
            {members.map((m: any) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
          <button className="btn btn-ghost" onClick={recompute} disabled={recomputing}>{recomputing ? 'Recomputing...' : 'Refresh data'}</button>
        </div>
      </div>

      {cohort && (
        <div className="grid grid-4" style={{ marginTop: 22 }}>
          <Mini label="Avg. Performance Index" value={pct(cohort.avg_pi)} />
          <Mini label="Avg. Task Performance" value={pct(cohort.avg_tp)} />
          <Mini label="Avg. Peer Evaluation" value={pct(cohort.avg_pe)} />
          <Mini label="Avg. Supervisor Assessment" value={pct(cohort.avg_sa)} />
        </div>
      )}

      {!selected ? (
        <>
          <div className="card card-pad" style={{ marginTop: 18 }}>
            <h3 className="card-title" style={{ marginBottom: 16 }}>Performance Index breakdown by member</h3>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={piData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--text-2)', fontSize: 12 }} />
                <YAxis tick={{ fill: 'var(--text-2)', fontSize: 12 }} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }} />
                <Legend />
                <Bar dataKey="TP" fill="#2453d6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="PE" fill="#0d9488" radius={[4, 4, 0, 0]} />
                <Bar dataKey="SA" fill="#f4793b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-pad" style={{ paddingBottom: 0 }}><span className="card-title">Member performance table</span></div>
            <table className="table" style={{ marginTop: 12 }}>
              <thead><tr><th>Member</th><th>Risk</th><th>PI</th><th>TP</th><th>PE</th><th>SA</th><th>Penalty</th></tr></thead>
              <tbody>
                {members.map((m: any) => (
                  <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(m.id)}>
                    <td><div className="row" style={{ gap: 10 }}><Avatar name={m.full_name} color={m.avatar_color} size="sm" /><span style={{ fontWeight: 600 }}>{m.full_name}</span></div></td>
                    <td><RiskBadge risk={m.risk} /></td>
                    <td><strong>{pct(m.performance.pi)}</strong></td>
                    <td>{pct(m.performance.tp)}</td>
                    <td>{pct(m.performance.pe)}</td>
                    <td>{pct(m.performance.sa)}</td>
                    <td>{m.performance.penalty_applied ? <span className="badge badge-red">Applied</span> : <span className="tiny">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <MemberDetail member={members.find((m: any) => m.id === selected)} detail={detail} />
      )}
    </div>
  );
}

function MemberDetail({ member, detail }: any) {
  if (!member || !detail) return <div style={{ marginTop: 18 }}><Loader /></div>;
  const p = detail.performance;
  const radar = [
    { metric: 'Task Perf.', value: Math.round(p.tp * 100) },
    { metric: 'Peer Eval.', value: Math.round(p.pe * 100) },
    { metric: 'Supervisor', value: Math.round(p.sa * 100) },
    { metric: 'Timeliness', value: Math.round(p.timeliness * 100) },
  ];
  const trend = (detail.trend || []).map((t: any) => ({ day: t.day, responsiveness: Number(t.responsiveness) || 0, quality: Number(t.quality) || 0 }));

  return (
    <div style={{ marginTop: 18, display: 'grid', gap: 18 }}>
      <div className="row" style={{ gap: 12 }}><Avatar name={member.full_name} color={member.avatar_color} /><div><h2 style={{ fontSize: 20 }}>{member.full_name}</h2><RiskBadge risk={member.risk} /></div></div>
      <div className="grid grid-2">
        <div className="card card-pad">
          <h3 className="card-title" style={{ marginBottom: 12 }}>Performance radar</h3>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radar}>
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: 'var(--text-2)', fontSize: 12 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
              <Radar dataKey="value" stroke="#2453d6" fill="#2453d6" fillOpacity={0.35} />
            </RadarChart>
          </ResponsiveContainer>
          {(p.reviewer_penalties?.missed_reviews > 0 || p.reviewer_penalties?.vulgar_comments > 0) && (
            <div className="card" style={{ padding: 12, marginTop: 12, background: 'var(--red-soft)' }}>
              <div className="label" style={{ marginBottom: 6 }}>Reviewer penalties (Task Performance)</div>
              <p className="tiny" style={{ margin: 0, lineHeight: 1.5 }}>
                {p.reviewer_penalties.missed_reviews > 0 && `${p.reviewer_penalties.missed_reviews} missed review(s). `}
                {p.reviewer_penalties.vulgar_comments > 0 && `${p.reviewer_penalties.vulgar_comments} vulgar comment(s). `}
                TP reduced by {pct(p.reviewer_penalties.tp_deduction)} (base TP: {pct(p.base_tp ?? p.tp)}).
              </p>
            </div>
          )}
        </div>
        <div className="card card-pad">
          <h3 className="card-title row" style={{ marginBottom: 12, gap: 8 }}><IcoTrend size={16} className="" /> Quality &amp; responsiveness trend</h3>
          {trend.length === 0 ? <EmptyState title="No assessment history yet" /> : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fill: 'var(--text-2)', fontSize: 11 }} />
                <YAxis domain={[0, 5]} tick={{ fill: 'var(--text-2)', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} />
                <Legend />
                <Line type="monotone" dataKey="quality" stroke="#2453d6" strokeWidth={2} />
                <Line type="monotone" dataKey="responsiveness" stroke="#f4793b" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="card-title" style={{ marginBottom: 12 }}>Peer &amp; collaboration assessments (full attribution)</h3>
        {detail.peers.length === 0 ? <p className="muted">No peer assessments yet.</p> : (
          <table className="table">
            <thead><tr><th>Assessor</th><th>Type</th><th>Score</th><th>Comment</th></tr></thead>
            <tbody>
              {detail.peers.map((pr: any, i: number) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{pr.assessor_name}</td>
                  <td><span className="badge badge-grey">{pr.kind === 'peer_review' ? 'Peer' : 'Collaboration'}</span></td>
                  <td>{pr.score}/5{pr.vulgar_comment ? <span className="badge badge-red" style={{ marginLeft: 6 }}>Vulgar</span> : null}</td>
                  <td className="muted">{pr.comment || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const Mini = ({ label, value }: { label: string; value: string }) => (
  <div className="stat"><div className="stat-label">{label}</div><div className="stat-value" style={{ fontSize: 26 }}>{value}</div></div>
);
