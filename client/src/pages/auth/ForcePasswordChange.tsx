import React, { useState } from 'react';
import { api, errMsg } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

/**
 * S6: shown while the signed-in account still carries `must_reset`.
 *
 * Admin-provisioned accounts and admin password resets both set the flag, and
 * both password-change paths clear it — but nothing used to read it, so a
 * temporary password could live forever. The server refuses every route except
 * /auth/me and /auth/change-password while the flag is set, so this screen is a
 * usable way through the gate rather than the gate itself.
 */
export default function ForcePasswordChange() {
  const { user, refresh, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.patch('/auth/change-password', { currentPassword, newPassword });
      await refresh();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="card" style={{ maxWidth: 460, margin: '10vh auto', padding: 28 }}>
        <h2 style={{ marginTop: 0 }}>Choose a new password</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          {user?.full_name}, your account is using a temporary password. Set your own before
          continuing.
        </p>

        <form onSubmit={submit} style={{ display: 'grid', gap: 12, marginTop: 20 }}>
          <div>
            <label className="label" htmlFor="fpc-current">Temporary password</label>
            <input
              id="fpc-current"
              className="input"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="fpc-new">New password</label>
            <input
              id="fpc-new"
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              At least 12 characters. Avoid common words, sequences, and your email address.
            </div>
          </div>
          <div>
            <label className="label" htmlFor="fpc-confirm">Confirm new password</label>
            <input
              id="fpc-confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Set password and continue'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={logout}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
