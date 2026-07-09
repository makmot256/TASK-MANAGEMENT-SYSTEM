import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme, type ThemeMode } from '../context/ThemeContext';
import { api } from '../api/client';
import { Avatar, fmtDateTime, timeAgo } from './ui';
import {
  IcoDashboard, IcoTasks, IcoReport, IcoReview, IcoChart, IcoUsers, IcoTeam, IcoSettings,
  IcoShield, IcoBell, IcoSun, IcoMoon, IcoLogout, IcoMenu, IcoStar, IcoUser, IcoMonitor, IcoUserCog,
} from '../lib/icons';

interface NavDef { to: string; label: string; icon: React.ReactNode; badgeKey?: 'reviewQueue'; }

const NAV: Record<string, NavDef[]> = {
  member: [
    { to: '/', label: 'Dashboard', icon: <IcoDashboard className="nav-ico" /> },
    { to: '/tasks', label: 'My Tasks', icon: <IcoTasks className="nav-ico" /> },
    { to: '/team', label: 'My Team', icon: <IcoTeam className="nav-ico" /> },
    { to: '/reports', label: 'My Reports', icon: <IcoReport className="nav-ico" /> },
    { to: '/peer-reviews', label: 'Peer Reviews', icon: <IcoStar className="nav-ico" /> },
  ],
  supervisor: [
    { to: '/', label: 'Dashboard', icon: <IcoDashboard className="nav-ico" /> },
    { to: '/tasks', label: 'Tasks', icon: <IcoTasks className="nav-ico" /> },
    { to: '/review', label: 'Review Queue', icon: <IcoReview className="nav-ico" />, badgeKey: 'reviewQueue' },
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

const THEME_OPTIONS: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { id: 'light', label: 'Light', icon: <IcoSun size={14} /> },
  { id: 'dark', label: 'Dark', icon: <IcoMoon size={14} /> },
  { id: 'system', label: 'System', icon: <IcoMonitor size={14} /> },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [reviewPending, setReviewPending] = useState(0);
  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const loadNotifs = async () => {
    try {
      const { data } = await api.get('/notifications');
      setNotifs(data.notifications);
      setUnread(data.unread);
    } catch { /* ignore */ }
  };

  const loadReviewPending = async () => {
    if (user?.role !== 'supervisor' && user?.role !== 'admin') return;
    try {
      const { data } = await api.get('/submissions/review-pending-count');
      setReviewPending(Number(data.pending) || 0);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadNotifs();
    const t = setInterval(loadNotifs, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user) return;
    loadReviewPending();
    const t = setInterval(loadReviewPending, 30000);
    return () => clearInterval(t);
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!profileOpen && !notifOpen) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (profileOpen && profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
      if (notifOpen && notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setProfileOpen(false);
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [profileOpen, notifOpen]);

  const openNotif = async () => {
    setProfileOpen(false);
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
        <div className="sidebar-glass-bg" aria-hidden="true">
          <span className="sidebar-orb sidebar-orb-1" />
          <span className="sidebar-orb sidebar-orb-2" />
          <span className="sidebar-orb sidebar-orb-3" />
        </div>
        <div className="sidebar-inner">
          <div className="brand-logo">
            <div className="brand-mark">T</div>
            <div>
              <div className="brand-name">TaskFlow</div>
              <div className="tiny brand-sub">Management System</div>
            </div>
          </div>
          <nav className="nav">
            <div className="nav-section">{ROLE_LABEL[user.role]} Menu</div>
            {items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setOpen(false)}>
                {it.icon}
                <span className="nav-item-label">{it.label}</span>
                {it.badgeKey === 'reviewQueue' && reviewPending > 0 && (
                  <span className="nav-count" aria-label={`${reviewPending} items need review`}>
                    {reviewPending > 99 ? '99+' : reviewPending}
                  </span>
                )}
              </NavLink>
            ))}
            <div className="nav-section">Account</div>
            <NavLink to="/profile" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setOpen(false)}>
              <IcoUser className="nav-ico" /> Profile
            </NavLink>
            <div className="nav-item" onClick={logout}><IcoLogout className="nav-ico" /> Sign out</div>
          </nav>
          <div className="sidebar-user row">
            <Avatar name={user.full_name} color={user.avatar_color} size="sm" />
            <div style={{ minWidth: 0 }}>
              <div className="sidebar-user-name">{user.full_name}</div>
              <div className="tiny sidebar-user-email">{user.email}</div>
            </div>
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
            <div style={{ position: 'relative' }} ref={notifRef}>
              <button className="icon-btn" onClick={openNotif} title="Notifications">
                <IcoBell size={18} />
                {unread > 0 && (
                  <span className="notif-count" aria-label={`${unread} unread notifications`}>
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
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

            <div style={{ position: 'relative' }} ref={profileRef}>
              <button
                className={`avatar-btn ${profileOpen ? 'open' : ''}`}
                onClick={() => { setNotifOpen(false); setProfileOpen((o) => !o); }}
                title="Account menu"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
              >
                <Avatar name={user.full_name} color={user.avatar_color} size="sm" />
              </button>

              {profileOpen && (
                <div className="profile-menu" role="menu">
                  <div className="profile-menu-glass-bg" aria-hidden="true">
                    <span className="profile-menu-orb profile-menu-orb-1" />
                    <span className="profile-menu-orb profile-menu-orb-2" />
                  </div>
                  <div className="profile-menu-inner">
                    <div className="profile-menu-head">
                      <Avatar name={user.full_name} color={user.avatar_color} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <div className="profile-menu-name">{user.full_name}</div>
                        <div className="tiny profile-menu-meta">
                          {ROLE_LABEL[user.role]} · {user.email}
                        </div>
                        {user.last_login_at && (
                          <div className="tiny profile-menu-login">
                            Last sign-in: {fmtDateTime(user.last_login_at)}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="profile-menu-section">
                      <button
                        className="profile-menu-item"
                        role="menuitem"
                        onClick={() => { setProfileOpen(false); nav('/profile'); }}
                      >
                        <IcoUserCog size={16} /> Edit profile
                      </button>
                    </div>

                    <div className="profile-menu-section">
                      <div className="profile-menu-label">Theme</div>
                      <div className="theme-seg" role="group" aria-label="Theme">
                        {THEME_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            className={`theme-seg-btn ${theme === opt.id ? 'active' : ''}`}
                            onClick={() => setTheme(opt.id)}
                          >
                            {opt.icon}
                            <span>{opt.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="profile-menu-section">
                      <button className="profile-menu-item danger" role="menuitem" onClick={logout}>
                        <IcoLogout size={16} /> Sign out
                      </button>
                    </div>

                    <div className="profile-menu-foot">TaskFlow · v1.0.0</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
