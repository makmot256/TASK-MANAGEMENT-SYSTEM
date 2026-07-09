import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api/client';
import { useToast } from '../context/ToastContext';
import { Spinner } from '../components/ui';
import { IcoEye, IcoEyeOff } from '../lib/icons';
import '../styles/onboarding.css';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [token, setToken] = useState(params.get('token') || '');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, newPassword: pw });
      toast('Password reset. Please sign in.', 'success');
      nav('/');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ob-root">
      <div className="ob-auth-screen ob-fade-in">
        <div className="ob-auth-card" style={{ gridTemplateColumns: '1fr', maxWidth: 480, minHeight: 'auto' }}>
          <div className="ob-auth-form-col" style={{ padding: '36px 32px' }}>
            <div className="ob-auth-form-inner">
              <div className="ob-auth-brand">
                <div className="ob-logo-panel">
                  <div className="ob-logo-mark">T</div>
                  <div className="ob-logo-name">TASK MANAGEMENT SYSTEM</div>
                </div>
                <div>
                  <h1 className="ob-auth-title">Set a new password</h1>
                  <p className="ob-auth-sub">Choose a strong password for your TASK MANAGEMENT SYSTEM account.</p>
                </div>
              </div>

              <form className="ob-form" onSubmit={submit}>
                {error && <div className="ob-error" role="alert">{error}</div>}
                <div className="ob-field">
                  <label className="ob-label" htmlFor="rp-token">Reset token</label>
                  <input
                    id="rp-token"
                    className="ob-input"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                  />
                </div>
                <div className="ob-field">
                  <label className="ob-label" htmlFor="rp-pw">New password</label>
                  <div className="ob-input-wrap">
                    <input
                      id="rp-pw"
                      type={show ? 'text' : 'password'}
                      className="ob-input has-toggle"
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                      placeholder="At least 8 chars, a letter and a number"
                      required
                    />
                    <button
                      type="button"
                      className="ob-pw-toggle"
                      onClick={() => setShow((s) => !s)}
                      aria-label={show ? 'Hide password' : 'Show password'}
                    >
                      {show ? <IcoEyeOff size={17} /> : <IcoEye size={17} />}
                    </button>
                  </div>
                </div>
                <div className="ob-field">
                  <label className="ob-label" htmlFor="rp-confirm">Confirm password</label>
                  <input
                    id="rp-confirm"
                    type={show ? 'text' : 'password'}
                    className="ob-input"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter new password"
                    required
                  />
                </div>
                <button type="submit" className="ob-btn ob-btn-primary" disabled={busy}>
                  {busy ? <Spinner /> : 'Reset password'}
                </button>
                <div className="ob-auth-foot">
                  <button type="button" className="ob-link" onClick={() => nav('/')}>
                    ← Back to sign in
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
