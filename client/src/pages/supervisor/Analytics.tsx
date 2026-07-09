import React, { useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Avatar, RiskBadge, Loader, EmptyState, pct } from '../../components/ui';
import { IcoChart, IcoTrend } from '../../lib/icons';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

type ViewMode = 'team' | 'individual';

export default function Analytics() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [weekly, setWeekly] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('team');
  const [teamId, setTeamId] = useState<number | ''>('');
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [weeks, setWeeks] = useState(8);

  const load = async () => {
    try {
      const { data: overview } = await api.get('/analytics/overview');
      setData(overview);
      if (!teamId && overview.teams?.length === 1) {
        setTeamId(overview.teams[0].id);
      }
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams({ weeks: String(weeks) });
    if (view === 'team' && teamId) params.set('teamId', String(teamId));
    if (view === 'individual' && selected) params.set('memberId', String(selected));
    api.get(`/analytics/weekly?${params}`)
      .then((r) => setWeekly(r.data))
      .catch(() => setWeekly(null));
  }, [data, view, teamId, selected, weeks]);

  useEffect(() => {
    if (view === 'individual' && selected) {
      api.get(`/analytics/member/${selected}`).then((r) => setDetail(r.data)).catch(() => setDetail(null));
    } else {
      setDetail(null);
    }
  }, [view, selected]);

  const recompute = async () => {
    setRecomputing(true);
    try {
      await api.post('/analytics/recompute');
      toast('Analytics recomputed.', 'success');
      await load();
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setRecomputing(false);
    }
  };

  const teams = data?.teams || [];
  const members = data?.members || [];

  const activeTeam = useMemo(
    () => (teamId ? teams.find((t: any) => t.id === teamId) : null),
    [teams, teamId]
  );

  const scopedMembers = useMemo(() => {
    if (view === 'team' && activeTeam) return activeTeam.members || [];
    if (view === 'team' && !teamId) return members;
    return members;
  }, [view, activeTeam, teamId, members]);

  const summary = useMemo(() => {
    if (view === 'team' && activeTeam?.averages) return activeTeam.averages;
    if (view === 'individual' && selected) {
      const m = members.find((x: any) => x.id === selected);
      if (!m) return data?.cohort;
      return {
        avg_pi: m.performance.pi,
        avg_tp: m.performance.tp,
        avg_pe: m.performance.pe,
        avg_sa: m.performance.sa,
      };
    }
    return data?.cohort;
  }, [view, activeTeam, selected, members, data]);

  const barData = useMemo(() => {
    if (view === 'team' && !teamId) {
      return teams.map((t: any) => ({
        name: t.name.split(' ')[0],
        PI: Math.round((t.averages?.avg_pi || 0) * 100),
        TP: Math.round((t.averages?.avg_tp || 0) * 100),
        PE: Math.round((t.averages?.avg_pe || 0) * 100),
        SA: Math.round((t.averages?.avg_sa || 0) * 100),
      }));
    }
    return scopedMembers.map((m: any) => ({
      name: m.full_name.split(' ')[0],
      PI: Math.round(m.performance.pi * 100),
      TP: Math.round(m.performance.tp * 100),
      PE: Math.round(m.performance.pe * 100),
      SA: Math.round(m.performance.sa * 100),
    }));
  }, [view, teamId, teams, scopedMembers]);

  const weeklyChart = useMemo(() => {
    if (!weekly?.series) return [];
    return weekly.series.map((w: any) => ({
      label: w.label,
      PI: Math.round((w.avg_pi || 0) * 100),
      TP: Math.round((w.avg_tp || 0) * 100),
      PE: Math.round((w.avg_pe || 0) * 100),
      SA: Math.round((w.avg_sa || 0) * 100),
      Tasks: w.completed_tasks || 0,
    }));
  }, [weekly]);

  if (loading) return <div className="page"><Loader /></div>;

  if (members.length === 0) {
    return (
      <div className="page">
        <h1 className="page-title">Performance Analytics</h1>
        <div className="card card-pad" style={{ marginTop: 22 }}>
          <EmptyState icon={<IcoChart size={56} />} title="Analytics will populate as activity accumulates" sub="Once tasks, reports and peer reviews exist, charts appear here." />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="row between wrap" style={{ gap: 12 }}>
        <div>
          <h1 className="page-title">Performance Analytics</h1>
          <p className="page-sub">
            Performance Index = {pct(data.weights.pi_weight_tp)} TP + {pct(data.weights.pi_weight_pe)} PE + {pct(data.weights.pi_weight_sa)} SA
          </p>
        </div>
        <button className="btn btn-ghost" onClick={recompute} disabled={recomputing}>
          {recomputing ? 'Recomputing...' : 'Refresh data'}
        </button>
      </div>

      <div className="row between wrap" style={{ marginTop: 18, gap: 12 }}>
        <div className="pill-toggle">
          <button className={view === 'team' ? 'active' : ''} onClick={() => { setView('team'); setSelected(null); }}>
            By team
          </button>
          <button className={view === 'individual' ? 'active' : ''} onClick={() => setView('individual')}>
            Individual
          </button>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          {view === 'team' && (
            <select
              className="select"
              style={{ width: 200 }}
              value={teamId}
              onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">All teams</option>
              {teams.map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          {view === 'individual' && (
            <select
              className="select"
              style={{ width: 220 }}
              value={selected || ''}
              onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Select member</option>
              {members.map((m: any) => (
                <option key={m.id} value={m.id}>{m.full_name}</option>
              ))}
            </select>
          )}
          <select className="select" style={{ width: 140 }} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            <option value={4}>Last 4 weeks</option>
            <option value={8}>Last 8 weeks</option>
            <option value={12}>Last 12 weeks</option>
          </select>
        </div>
      </div>

      {summary && (
        <div className="grid grid-4" style={{ marginTop: 18 }}>
          <Mini label={view === 'individual' && selected ? 'Performance Index' : 'Avg. Performance Index'} value={pct(summary.avg_pi)} />
          <Mini label={view === 'individual' && selected ? 'Task Performance' : 'Avg. Task Performance'} value={pct(summary.avg_tp)} />
          <Mini label={view === 'individual' && selected ? 'Peer Evaluation' : 'Avg. Peer Evaluation'} value={pct(summary.avg_pe)} />
          <Mini label={view === 'individual' && selected ? 'Supervisor Assessment' : 'Avg. Supervisor Assessment'} value={pct(summary.avg_sa)} />
        </div>
      )}

      <div className="card card-pad" style={{ marginTop: 18 }}>
        <div className="row between wrap" style={{ marginBottom: 12, gap: 8 }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            Weekly progress
            {view === 'team' && activeTeam ? ` · ${activeTeam.name}` : ''}
            {view === 'individual' && selected ? ` · ${members.find((m: any) => m.id === selected)?.full_name || ''}` : ''}
          </h3>
          <span className="tiny">Week-over-week TP / PE / SA / PI</span>
        </div>
        {weeklyChart.length === 0 ? (
          <EmptyState title="No weekly activity yet" sub="Completions, peer reviews and assessments will appear by week." />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={weeklyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-2)', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-2)', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }} />
              <Legend />
              <Line type="monotone" dataKey="PI" stroke="#64748b" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="TP" stroke="#2453d6" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="PE" stroke="#0d9488" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="SA" stroke="#f4793b" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {view === 'team' && (
        <>
          <div className="card card-pad" style={{ marginTop: 18 }}>
            <h3 className="card-title" style={{ marginBottom: 16 }}>
              {teamId ? `${activeTeam?.name || 'Team'} · member breakdown` : 'Team comparison'}
            </h3>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={barData}>
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

          {!teamId ? (
            <div className="card" style={{ marginTop: 18 }}>
              <div className="card-pad" style={{ paddingBottom: 0 }}><span className="card-title">Teams</span></div>
              <table className="table" style={{ marginTop: 12 }}>
                <thead>
                  <tr><th>Team</th><th>Members</th><th>Avg PI</th><th>Avg TP</th><th>Avg PE</th><th>Avg SA</th><th>At risk</th></tr>
                </thead>
                <tbody>
                  {teams.map((t: any) => (
                    <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setTeamId(t.id)}>
                      <td><strong>{t.name}</strong></td>
                      <td>{t.member_count}</td>
                      <td><strong>{pct(t.averages?.avg_pi || 0)}</strong></td>
                      <td>{pct(t.averages?.avg_tp || 0)}</td>
                      <td>{pct(t.averages?.avg_pe || 0)}</td>
                      <td>{pct(t.averages?.avg_sa || 0)}</td>
                      <td>{t.averages?.at_risk ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card" style={{ marginTop: 18 }}>
              <div className="card-pad row between wrap" style={{ paddingBottom: 0, gap: 10 }}>
                <span className="card-title">{activeTeam?.name} members</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setTeamId('')}>All teams</button>
              </div>
              <table className="table" style={{ marginTop: 12 }}>
                <thead><tr><th>Member</th><th>Risk</th><th>PI</th><th>TP</th><th>PE</th><th>SA</th></tr></thead>
                <tbody>
                  {(activeTeam?.members || []).map((m: any) => (
                    <tr
                      key={m.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => { setView('individual'); setSelected(m.id); }}
                    >
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <Avatar name={m.full_name} color={m.avatar_color} size="sm" />
                          <span style={{ fontWeight: 600 }}>{m.full_name}</span>
                        </div>
                      </td>
                      <td><RiskBadge risk={m.risk} /></td>
                      <td><strong>{pct(m.performance.pi)}</strong></td>
                      <td>{pct(m.performance.tp)}</td>
                      <td>{pct(m.performance.pe)}</td>
                      <td>{pct(m.performance.sa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {view === 'individual' && (
        <>
          {!selected ? (
            <div className="card" style={{ marginTop: 18 }}>
              <div className="card-pad" style={{ paddingBottom: 0 }}><span className="card-title">Select a member</span></div>
              <table className="table" style={{ marginTop: 12 }}>
                <thead><tr><th>Member</th><th>Team(s)</th><th>Risk</th><th>PI</th><th>TP</th><th>PE</th><th>SA</th></tr></thead>
                <tbody>
                  {members.map((m: any) => (
                    <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(m.id)}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <Avatar name={m.full_name} color={m.avatar_color} size="sm" />
                          <span style={{ fontWeight: 600 }}>{m.full_name}</span>
                        </div>
                      </td>
                      <td className="muted">{(m.teams || []).map((t: any) => t.name).join(', ') || '—'}</td>
                      <td><RiskBadge risk={m.risk} /></td>
                      <td><strong>{pct(m.performance.pi)}</strong></td>
                      <td>{pct(m.performance.tp)}</td>
                      <td>{pct(m.performance.pe)}</td>
                      <td>{pct(m.performance.sa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <MemberDetail
              member={members.find((m: any) => m.id === selected)}
              detail={detail}
              onBack={() => setSelected(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function MemberDetail({ member, detail, onBack }: any) {
  if (!member || !detail) return <div style={{ marginTop: 18 }}><Loader /></div>;
  const p = detail.performance;
  const radar = [
    { metric: 'Task Perf.', value: Math.round(p.tp * 100) },
    { metric: 'Peer Eval.', value: Math.round(p.pe * 100) },
    { metric: 'Supervisor', value: Math.round(p.sa * 100) },
    { metric: 'Timeliness', value: Math.round(p.timeliness * 100) },
  ];
  const trend = (detail.trend || []).map((t: any) => ({
    day: t.day,
    responsiveness: Number(t.responsiveness) || 0,
    quality: Number(t.quality) || 0,
  }));
  const weekly = detail.weekly || [];

  return (
    <div style={{ marginTop: 18, display: 'grid', gap: 18 }}>
      <div className="row between wrap" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <Avatar name={member.full_name} color={member.avatar_color} />
          <div>
            <h2 style={{ fontSize: 20 }}>{member.full_name}</h2>
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <RiskBadge risk={member.risk} />
              {(detail.teams || member.teams || []).map((t: any) => (
                <span key={t.id} className="badge badge-brand">{t.name}</span>
              ))}
            </div>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>All individuals</button>
      </div>

      <div className="card card-pad">
        <h3 className="card-title row" style={{ marginBottom: 12, gap: 8 }}>
          <IcoTrend size={16} /> Weekly progress
        </h3>
        {weekly.every((w: any) => !w.has_data) ? (
          <EmptyState title="No weekly activity for this member yet" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={weekly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-2)', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-2)', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }} />
              <Legend />
              <Line type="monotone" dataKey="PI" stroke="#64748b" strokeWidth={2.5} />
              <Line type="monotone" dataKey="TP" stroke="#2453d6" strokeWidth={2} />
              <Line type="monotone" dataKey="PE" stroke="#0d9488" strokeWidth={2} />
              <Line type="monotone" dataKey="SA" stroke="#f4793b" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

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
          <h3 className="card-title row" style={{ marginBottom: 12, gap: 8 }}>
            <IcoTrend size={16} /> Quality &amp; responsiveness trend
          </h3>
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
  <div className="stat">
    <div className="stat-label">{label}</div>
    <div className="stat-value" style={{ fontSize: 26 }}>{value}</div>
  </div>
);
