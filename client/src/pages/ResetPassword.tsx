import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api/client';
import { useToast } from '../context/ToastContext';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [token, setToken] = useState(params.get('token') || '');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: pw });
      toast('Password reset. Please sign in.', 'success');
      nav('/login');
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20 }}>
      <div className="card card-pad auth-card">
        <h1 className="page-title">Set a new password</h1>
        <p className="page-sub" style={{ marginBottom: 22 }}>Choose a strong password for your account.</p>
        <form onSubmit={submit}>
          <div className="field"><label className="label">Reset token</label><input className="input" value={token} onChange={(e) => setToken(e.target.value)} required /></div>
          <div className="field"><label className="label">New password</label><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 chars, a letter and a number" required /></div>
          <button className="btn btn-primary btn-block" disabled={busy}>Reset password</button>
          <div className="divider" />
          <a onClick={() => nav('/login')} style={{ cursor: 'pointer', fontSize: 14 }}>← Back to sign in</a>
        </form>
      </div>
    </div>
  );
}
