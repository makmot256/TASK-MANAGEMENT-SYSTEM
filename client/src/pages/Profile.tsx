import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, errMsg } from '../api/client';
import { Avatar, fmtDateTime } from '../components/ui';

export default function Profile() {
  const { user } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/auth/change-password', { currentPassword: cur, newPassword: next });
      toast('Password updated.', 'success');
      setCur(''); setNext('');
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Edit profile</h1>
      <p className="page-sub">Manage your account details and security.</p>

      <div className="grid grid-2" style={{ marginTop: 22 }}>
        <div className="card card-pad">
          <div className="row" style={{ gap: 16 }}>
            <Avatar name={user.full_name} color={user.avatar_color} size="lg" />
            <div>
              <h2 style={{ fontSize: 20 }}>{user.full_name}</h2>
              <p className="muted">{user.title || user.role}</p>
            </div>
          </div>
          <div className="divider" />
          <Row label="Email" value={user.email} />
          <Row label="Role" value={user.role} />
          <Row label="Phone" value={user.phone || '—'} />
          <Row label="Member since" value={fmtDateTime(user.created_at)} />
          <Row label="Last login" value={fmtDateTime(user.last_login_at)} />
        </div>

        <div className="card card-pad">
          <h3 className="card-title" style={{ marginBottom: 16 }}>Change password</h3>
          <form onSubmit={changePw}>
            <div className="field"><label className="label">Current password</label><input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} required /></div>
            <div className="field"><label className="label">New password</label><input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Min 8 chars, a letter & a number" required /></div>
            <button className="btn btn-primary" disabled={busy}>Update password</button>
          </form>
        </div>
      </div>
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="row between" style={{ padding: '9px 0' }}>
    <span className="muted" style={{ fontSize: 14 }}>{label}</span>
    <span style={{ fontWeight: 600, fontSize: 14, textTransform: label === 'Role' ? 'capitalize' : 'none' }}>{value}</span>
  </div>
);
