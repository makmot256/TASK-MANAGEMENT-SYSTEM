import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../api/client';
import { Avatar, timeAgo } from './ui';
import {
  IcoDashboard, IcoTasks, IcoReport, IcoReview, IcoChart, IcoUsers, IcoTeam, IcoSettings,
  IcoShield, IcoBell, IcoSun, IcoMoon, IcoLogout, IcoMenu, IcoStar, IcoUser, IcoAlert,
} from '../lib/icons';

interface NavDef { to: string; label: string; icon: React.ReactNode; }

const NAV: Record<string, NavDef[]> = {
  member: [
    { to: '/', label: 'Dashboard', icon: <IcoDashboard className="nav-ico" /> },
    { to: '/tasks', label: 'My Tasks', icon: <IcoTasks className="nav-ico" /> },
    { to: '/weekly-report', label: 'Weekly Report', icon: <IcoReport className="nav-ico" /> },
    { to: '/team', label: 'My Team', icon: <IcoTeam className="nav-ico" /> },
    { to: '/reports', label: 'My Reports', icon: <IcoReport className="nav-ico" /> },
    { to: '/peer-reviews', label: 'Peer Reviews', icon: <IcoStar className="nav-ico" /> },
  ],
  supervisor: [
    { to: '/', label: 'Dashboard', icon: <IcoDashboard className="nav-ico" /> },
    { to: '/tasks', label: 'Tasks', icon: <IcoTasks className="nav-ico" /> },
    { to: '/review', label: 'Review Queue', icon: <IcoReview className="nav-ico" /> },
    { to: '/analytics', label: 'Performance', icon: <IcoChart className="nav-ico" /> },
    { to: '/peer-reviews', label: 'Peer Reviews', icon: <IcoStar className="nav-ico" /> },
    { to: '/team', label: 'My Team', icon: <IcoTeam className="nav-ico" /> },
  ],
  admin: [
    { to: '/', label: 'Dashboard', icon: <IcoDashboard className="nav-ico" /> },
    { to: '/users', label: 'Users', icon: <IcoUsers className="nav-ico" /> },
    { to: '/teams', label: 'Teams', icon: <IcoTeam className="nav-ico" /> },
    { to: '/settings', label: 'System Settings', icon: <IcoSettings className="nav-ico" /> },
    { to: '/audit', label: 'Security & Audit', icon: <IcoShield className="nav-ico" /> },
  ],
};

const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', supervisor: 'Supervisor', member: 'Member' };

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);

  const loadNotifs = async () => {
    try {
      const { data } = await api.get('/notifications');
      setNotifs(data.notifications);
      setUnread(data.unread);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadNotifs();
    const t = setInterval(loadNotifs, 30000);
    return () => clearInterval(t);
  }, []);

  const openNotif = async () => {
    setNotifOpen((o) => !o);
    if (!notifOpen && unread > 0) {
      await api.post('/notifications/read-all');
      setUnread(0);
    }
  };

  if (!user) return null;
  const items = NAV[user.role] || [];

  return (
    <div className="app-shell">
      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand-logo">
          <div className="brand-mark">T</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>TaskFlow</div>
            <div className="tiny">Management System</div>
          </div>
        </div>
        <nav className="nav">
          <div className="nav-section">{ROLE_LABEL[user.role]} Menu</div>
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setOpen(false)}>
              {it.icon} {it.label}
            </NavLink>
          ))}
          <div className="nav-section">Account</div>
          <NavLink to="/profile" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setOpen(false)}>
            <IcoUser className="nav-ico" /> Profile
          </NavLink>
          <div className="nav-item" onClick={logout}><IcoLogout className="nav-ico" /> Sign out</div>
        </nav>
        <div className="row" style={{ padding: '12px 8px', borderTop: '1px solid var(--border)' }}>
          <Avatar name={user.full_name} color={user.avatar_color} size="sm" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.full_name}</div>
            <div className="tiny" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="row">
            <button className="icon-btn mobile-toggle" onClick={() => setOpen((o) => !o)}><IcoMenu size={18} /></button>
            <span className="badge badge-brand topbar-tag" style={{ textTransform: 'capitalize' }}>{ROLE_LABEL[user.role]} workspace</span>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="icon-btn" onClick={toggle} title="Toggle theme">
              {theme === 'light' ? <IcoMoon size={18} /> : <IcoSun size={18} />}
            </button>
            <div style={{ position: 'relative' }}>
              <button className="icon-btn" onClick={openNotif} title="Notifications">
                <IcoBell size={18} />
                {unread > 0 && <span style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: '50%', background: 'var(--red)' }} />}
              </button>
              {notifOpen && (
                <div className="dropdown">
                  <div className="row between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                    <strong style={{ fontSize: 14 }}>Notifications</strong>
                  </div>
                  {notifs.length === 0 && <div className="empty"><p className="muted">No notifications yet</p></div>}
                  {notifs.map((n) => (
                    <div key={n.id} className={`notif-item ${n.is_read ? '' : 'unread'}`} onClick={() => { setNotifOpen(false); if (n.link) nav(n.link); }}>
                      {!n.is_read && <span className="notif-dot" />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
                        {n.body && <div className="tiny" style={{ marginTop: 2 }}>{n.body}</div>}
                        <div className="tiny" style={{ marginTop: 3 }}>{timeAgo(n.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Avatar name={user.full_name} color={user.avatar_color} size="sm" />
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
