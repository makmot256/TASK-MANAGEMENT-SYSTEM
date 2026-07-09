import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, errMsg } from '../api/client';
import { Avatar, fmtDateTime, Spinner } from '../components/ui';

export default function Profile() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name || '');
    setEmail(user.email || '');
    setPhone(user.phone || '');
    setPreview(user.avatar_url || null);
    setAvatarFile(null);
  }, [user]);

  useEffect(() => {
    if (!avatarFile) return;
    const url = URL.createObjectURL(avatarFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  if (!user) return null;

  const onPickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) {
      toast('Use a JPG, PNG, WEBP, or GIF image.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Image must be 5 MB or smaller.', 'error');
      return;
    }
    setAvatarFile(file);
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      toast('Full name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = new FormData();
      body.append('full_name', fullName.trim());
      body.append('email', email.trim());
      body.append('phone', phone.trim());
      if (avatarFile) body.append('avatar', avatarFile);
      await api.patch('/auth/profile', body);
      await refresh();
      setAvatarFile(null);
      toast('Profile updated.', 'success');
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      toast('New password and confirmation do not match.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.patch('/auth/change-password', { currentPassword: cur, newPassword: next });
      toast('Password updated.', 'success');
      setCur('');
      setNext('');
      setConfirm('');
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Edit profile</h1>
      <p className="page-sub">Update your name, photo, email, phone, and password. Role and account dates stay read-only.</p>

      <div className="grid grid-2" style={{ marginTop: 22 }}>
        <div className="card card-pad">
          <form onSubmit={saveProfile}>
            <div className="row" style={{ gap: 16, alignItems: 'center' }}>
              <button
                type="button"
                className="avatar-edit-btn"
                onClick={() => fileRef.current?.click()}
                title="Change profile picture"
              >
                <Avatar
                  name={fullName || user.full_name}
                  color={user.avatar_color}
                  src={preview}
                  size="lg"
                />
                <span className="avatar-edit-hint">Change</span>
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ fontSize: 20, margin: 0 }}>{fullName || user.full_name}</h2>
                <p className="muted" style={{ marginTop: 4 }}>{user.title || user.role}</p>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 8 }}
                  onClick={() => fileRef.current?.click()}
                >
                  Upload photo
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  hidden
                  onChange={onPickAvatar}
                />
              </div>
            </div>

            <div className="divider" />

            <div className="field">
              <label className="label">Full name</label>
              <input
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                maxLength={120}
              />
            </div>
            <div className="field">
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label className="label">Phone</label>
              <input
                className="input"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Optional"
                maxLength={40}
              />
            </div>

            <div className="divider" />
            <Row label="Role" value={user.role} />
            <Row label="Member since" value={fmtDateTime(user.created_at)} />
            <Row label="Last login" value={fmtDateTime(user.last_login_at)} />

            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary" disabled={saving}>
                {saving ? <Spinner /> : 'Save profile'}
              </button>
            </div>
          </form>
        </div>

        <div className="card card-pad">
          <h3 className="card-title" style={{ marginBottom: 8 }}>Change password</h3>
          <p className="tiny" style={{ marginBottom: 16 }}>
            Use at least 8 characters with a letter and a number.
          </p>
          <form onSubmit={changePw}>
            <div className="field">
              <label className="label">Current password</label>
              <input
                className="input"
                type="password"
                value={cur}
                onChange={(e) => setCur(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="field">
              <label className="label">New password</label>
              <input
                className="input"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="Min 8 chars, a letter & a number"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="field">
              <label className="label">Confirm new password</label>
              <input
                className="input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter new password"
                autoComplete="new-password"
                required
              />
            </div>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? <Spinner /> : 'Update password'}
            </button>
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
