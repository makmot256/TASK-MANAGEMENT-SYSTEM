import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, errMsg } from '../api/client';
import { Spinner } from '../components/ui';
import { IcoTasks, IcoChart, IcoShield, IcoX } from '../lib/icons';

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await login(email, password);
      toast(`Welcome back, ${u.full_name.split(' ')[0]}!`, 'success');
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/auth/forgot-password', { email: forgotEmail });
      toast('If that email exists, a reset link has been sent.', 'success');
      setForgot(false);
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  };

  const demo = (em: string) => { setEmail(em); setPassword(em === 'admin@tms.local' ? 'Admin@123' : 'Password@123'); };

  return (
    <div className="auth-wrap">
      <div className="auth-side">
        <div className="row" style={{ gap: 12 }}>
          <div className="brand-mark" style={{ width: 44, height: 44 }}>T</div>
          <strong style={{ fontSize: 20 }}>TaskFlow</strong>
        </div>
        <div>
          <h1 style={{ fontSize: 38, lineHeight: 1.15 }}>Supervise, track and grow your team.</h1>
          <p style={{ marginTop: 16, opacity: .9, fontSize: 16, maxWidth: 440 }}>
            Assign tasks, collect reports, review work and monitor performance with built-in analytics and ML-powered engagement alerts.
          </p>
          <div className="auth-feature"><div className="fico"><IcoTasks size={20} /></div><div><strong>Task lifecycle</strong><div style={{ opacity: .85, fontSize: 14 }}>Create, assign, track and review in one flow.</div></div></div>
          <div className="auth-feature"><div className="fico"><IcoChart size={20} /></div><div><strong>Performance Index</strong><div style={{ opacity: .85, fontSize: 14 }}>Quality-weighted scoring across the cohort.</div></div></div>
          <div className="auth-feature"><div className="fico"><IcoShield size={20} /></div><div><strong>Role-based access</strong><div style={{ opacity: .85, fontSize: 14 }}>Admin, supervisor and member workspaces.</div></div></div>
        </div>
        <div className="tiny" style={{ opacity: .75 }}>© {new Date().getFullYear()} TaskFlow Management System</div>
      </div>

      <div className="auth-main">
        <div className="auth-card">
          <h1 className="page-title">Sign in</h1>
          <p className="page-sub" style={{ marginBottom: 24 }}>Welcome back. Enter your credentials to continue.</p>
          <form onSubmit={submit}>
            <div className="field">
              <label className="label">Email address</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@organisation.com" required />
            </div>
            <div className="field">
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            <div className="row between" style={{ marginBottom: 18 }}>
              <span />
              <a onClick={() => setForgot(true)} style={{ cursor: 'pointer', fontSize: 13 }}>Forgot password?</a>
            </div>
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? <Spinner /> : 'Sign in'}</button>
          </form>

          <div className="divider" />
          <p className="tiny" style={{ marginBottom: 8 }}>Quick demo logins:</p>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => demo('admin@tms.local')}>Admin</button>
            <button className="btn btn-ghost btn-sm" onClick={() => demo('sarah@tms.local')}>Supervisor</button>
            <button className="btn btn-ghost btn-sm" onClick={() => demo('grace@tms.local')}>Member</button>
          </div>
        </div>
      </div>

      {forgot && (
        <div className="modal-overlay" onClick={() => setForgot(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3 style={{ fontSize: 17 }}>Reset password</h3><button className="icon-btn" onClick={() => setForgot(false)}><IcoX size={18} /></button></div>
            <form onSubmit={sendReset}>
              <div className="modal-body">
                <p className="muted" style={{ marginBottom: 14, fontSize: 14 }}>Enter your email and we'll send a reset link.</p>
                <input className="input" type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="you@organisation.com" required />
              </div>
              <div className="modal-foot"><button className="btn btn-primary">Send link</button><button type="button" className="btn btn-ghost" onClick={() => setForgot(false)}>Cancel</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
