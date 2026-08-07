import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { Avatar, Loader, EmptyState, timeAgo } from '../../components/ui';
import { IcoTeam, IcoStar, IcoTasks } from '../../lib/icons';

const engColor = (status: string | null) =>
  status === 'at_risk' ? 'var(--red)' : status === 'moderate' ? 'var(--amber)' : status === 'on_track' ? 'var(--green)' : 'var(--text-3)';

export default function TeamHub() {
  const toast = useToast();
  const { user } = useAuth();
  const [teams, setTeams] = useState<any[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // chat
  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState('');
  const lastId = useRef(0);
  const chatEnd = useRef<HTMLDivElement>(null);

  const loadOverview = async () => {
    const { data } = await api.get('/team/overview');
    setTeams(data.teams);
    setActive((cur) => cur ?? (data.teams[0]?.id ?? null));
    setLoading(false);
  };
  useEffect(() => { loadOverview(); }, []);

  // Load + poll chat for the active team.
  useEffect(() => {
    if (!active) return;
    let stop = false;
    lastId.current = 0;
    setMessages([]);
    const poll = async () => {
      try {
        const { data } = await api.get(`/team/${active}/messages`, { params: { after: lastId.current } });
        if (stop || !data.messages.length) return;
        lastId.current = data.messages[data.messages.length - 1].id;
        setMessages((prev) => [...prev, ...data.messages]);
      } catch { /* ignore */ }
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [active]);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const team = teams.find((t) => t.id === active);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !active) return;
    setDraft('');
    try {
      const { data } = await api.post(`/team/${active}/messages`, { body });
      lastId.current = data.message.id;
      setMessages((prev) => [...prev, data.message]);
    } catch (err) { toast(errMsg(err), 'error'); setDraft(body); }
  };

  if (loading) return <div className="page"><Loader /></div>;

  if (teams.length === 0) {
    return (
      <div className="page">
        <h1 className="page-title">My Team</h1>
        <div className="card card-pad" style={{ marginTop: 22 }}>
          <EmptyState icon={<IcoTeam size={56} />} title="You're not in a team yet" sub="Once an admin adds you to a team, you'll be able to see your teammates' progress, divide tasks and chat here." />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="row between wrap">
        <div><h1 className="page-title">My Team</h1><p className="page-sub">Track teammates' progress and chat. Peer reviews on uploaded reports are assigned system-wide — see <Link to="/peer-reviews">Peer Reviews</Link>.</p></div>
      </div>

      {teams.length > 1 && (
        <div className="pill-toggle" style={{ marginTop: 18 }}>
          {teams.map((t) => (
            <button key={t.id} className={active === t.id ? 'active' : ''} onClick={() => setActive(t.id)}>{t.name}</button>
          ))}
        </div>
      )}

      {team && (
        <div className="grid responsive-split" style={{ gridTemplateColumns: '1.5fr 1fr', gap: 18, marginTop: 18, alignItems: 'start' }}>
          {/* Progress + peer review */}
          <div style={{ display: 'grid', gap: 14 }}>
            <div className="card card-pad">
              <div className="row between">
                <h3 className="card-title">{team.name}</h3>
                <span className="muted" style={{ fontSize: 13 }}>Supervisors: {team.supervisor_names || '—'}</span>
              </div>
              {team.description && <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>{team.description}</p>}
            </div>

            <div className="grid grid-2" style={{ gap: 14 }}>
              {team.members.map((m: any) => (
                <div key={m.id} className="card card-pad">
                  <div className="row between">
                    <div className="row" style={{ gap: 10 }}>
                      <Avatar name={m.full_name} color={m.avatar_color} size="sm" />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{m.full_name}{m.is_me && <span className="muted"> (you)</span>}</div>
                        <div className="tiny">{m.title || 'Member'}</div>
                      </div>
                    </div>
                    {m.engagement_score != null && (
                      <span title="Engagement" style={{ fontSize: 12, fontWeight: 700, color: engColor(m.engagement_status) }}>{Math.round(m.engagement_score)}</span>
                    )}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div className="row between" style={{ fontSize: 12 }}>
                      <span className="muted">Task completion</span>
                      <strong>{m.completion_rate}%</strong>
                    </div>
                    <div style={{ height: 7, borderRadius: 6, background: 'var(--surface-2)', marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${m.completion_rate}%`, height: '100%', background: 'var(--accent)' }} />
                    </div>
                  </div>

                  <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                    <span className="badge badge-green">{m.completed} done</span>
                    <span className="badge badge-brand">{m.in_progress} active</span>
                    <span className="badge badge-grey">{m.todo} to-do</span>
                    {m.on_time_rate != null && <span className="badge badge-grey">{m.on_time_rate}% on-time</span>}
                  </div>

                  {!m.is_me && (
                    <Link className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 12 }} to="/peer-reviews">
                      <IcoStar size={14} /> Peer reviews
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Team chat */}
          <div className="card team-chat" style={{ position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 130px)' }}>
            <div className="row between card-pad" style={{ borderBottom: '1px solid var(--border)' }}>
              <strong style={{ fontSize: 14 }}>Team chat</strong>
              <span className="badge badge-brand">{team.members.length} members</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {messages.length === 0 && <p className="muted" style={{ fontSize: 13, margin: 'auto' }}>No messages yet. Say hello to your team!</p>}
              {messages.map((msg) => {
                const mine = msg.sender_id === user?.id;
                return (
                  <div key={msg.id} className="row" style={{ gap: 8, flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
                    <Avatar name={msg.sender_name} color={msg.sender_color} size="sm" />
                    <div style={{ maxWidth: '76%' }}>
                      <div className="row" style={{ gap: 6, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{mine ? 'You' : msg.sender_name}</span>
                        <span className="tiny">{timeAgo(msg.created_at)}</span>
                      </div>
                      <div style={{ marginTop: 4, padding: '8px 12px', borderRadius: 12, fontSize: 14, lineHeight: 1.45, background: mine ? 'var(--accent)' : 'var(--surface-2)', color: mine ? '#fff' : 'var(--text)', borderTopRightRadius: mine ? 2 : 12, borderTopLeftRadius: mine ? 12 : 2, wordBreak: 'break-word' }}>
                        {msg.body}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEnd} />
            </div>
            <form onSubmit={send} className="row" style={{ gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}>
              <input className="input" placeholder="Type a message..." value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button className="btn btn-primary" disabled={!draft.trim()}>Send</button>
            </form>
          </div>
        </div>
      )}

      <div className="card card-pad" style={{ marginTop: 18 }}>
        <div className="row between wrap" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <IcoTasks size={18} />
            <span style={{ fontSize: 14 }}>Want to divide a task among teammates? Open a shared task and use <strong>"Subdivide work"</strong>.</span>
          </div>
          <Link className="btn btn-ghost btn-sm" to="/tasks">Go to my tasks</Link>
        </div>
      </div>
    </div>
  );
}
