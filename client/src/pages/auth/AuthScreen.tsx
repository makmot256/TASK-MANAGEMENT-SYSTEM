import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api, errMsg } from '../../api/client';
import { Spinner } from '../../components/ui';
import { IcoArrowLeft, IcoEye, IcoEyeOff, IcoMailCheck } from '../../lib/icons';

type Mode = 'signin' | 'access' | 'forgot';

const SLIDES = [
  {
    image: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1000&q=70',
    title: 'Work that stays on track',
    text: 'Assign tasks, set deadlines, and keep every team member aligned.',
  },
  {
    image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1000&q=70',
    title: 'Reviews without the chase',
    text: 'Collect reports, leave feedback, and approve work in one queue.',
  },
  {
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1000&q=70',
    title: 'Performance you can trust',
    text: 'Quality scores, peer reviews, and engagement insights for supervisors.',
  },
  {
    image: 'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=1000&q=70',
    title: 'Built for every role',
    text: 'Admin, supervisor, and member workspaces — secure and role-aware.',
  },
];

function PropertySlider() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    SLIDES.forEach((s) => {
      const img = new Image();
      img.src = s.image;
    });
  }, []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), 4200);
    return () => window.clearInterval(t);
  }, []);

  const active = SLIDES[index];

  return (
    <div className="ob-slider" aria-hidden="true">
      {SLIDES.map((s, i) => (
        <div
          key={i}
          className={`ob-slider-img ${i === index ? 'active' : ''}`}
          style={{ backgroundImage: `url("${s.image}")` }}
        />
      ))}
      <div className="ob-slider-scrim" />
      <div className="ob-slider-caption">
        <h3 key={`t-${index}`}>{active.title}</h3>
        <p key={`p-${index}`}>{active.text}</p>
      </div>
      <div className="ob-slider-dots">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            className={`ob-slider-dot ${i === index ? 'active' : ''}`}
            aria-label={`Show slide ${i + 1}`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="ob-input-wrap">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        className="ob-input has-toggle"
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        minLength={6}
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
  );
}

const COPY: Record<Mode, { title: string; sub: string }> = {
  signin: { title: 'Welcome back', sub: 'Sign in to continue to TASK MANAGEMENT SYSTEM.' },
  access: {
    title: 'Need an account?',
    sub: 'Accounts are created by your administrator. Use a demo login below, or ask admin for access.',
  },
  forgot: { title: 'Reset your password', sub: "Enter your email and we'll send a reset link." },
};

type AuthScreenProps = {
  onAuthenticated: () => void;
};

export default function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const { login } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [error, setError] = useState('');
  const copy = COPY[mode];

  const switchMode = (m: Mode) => {
    setResetSent(false);
    setError('');
    setMode(m);
  };

  const submitSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await login(email, password);
      toast(`Welcome back, ${u.full_name.split(' ')[0]}!`, 'success');
      onAuthenticated();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email: forgotEmail });
      setResetSent(true);
      toast('If that email exists, a reset link has been sent.', 'success');
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const demo = (em: string) => {
    setEmail(em);
    setPassword(em === 'admin@tms.local' ? 'Admin@123' : 'Password@123');
    switchMode('signin');
  };

  return (
    <div className="ob-auth-screen ob-fade-in">
      <div className="ob-auth-card">
        <div className="ob-auth-form-col">
          {mode === 'forgot' && (
            <button type="button" className="ob-back" onClick={() => switchMode('signin')}>
              <IcoArrowLeft size={16} />
              Back
            </button>
          )}

          <div className="ob-auth-form-inner">
            <div className="ob-auth-brand">
              <div className="ob-logo-panel">
                <div className="ob-logo-mark">T</div>
                <div className="ob-logo-name">TASK MANAGEMENT SYSTEM</div>
              </div>
              <div>
                <h1 className="ob-auth-title">{copy.title}</h1>
                <p className="ob-auth-sub">{copy.sub}</p>
              </div>
            </div>

            {mode !== 'forgot' && (
              <div className="ob-tabs" role="tablist" aria-label="Authentication mode">
                <span className={`ob-tab-thumb ${mode === 'access' ? 'right' : ''}`} aria-hidden="true" />
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signin'}
                  className={`ob-tab ${mode === 'signin' ? 'active' : ''}`}
                  onClick={() => switchMode('signin')}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'access'}
                  className={`ob-tab ${mode === 'access' ? 'active' : ''}`}
                  onClick={() => switchMode('access')}
                >
                  Get Access
                </button>
              </div>
            )}

            {mode === 'signin' && (
              <form className="ob-form ob-form-anim" key="signin" onSubmit={submitSignIn}>
                {error && <div className="ob-error" role="alert">{error}</div>}
                <div className="ob-field">
                  <label className="ob-label" htmlFor="si-email">Email</label>
                  <div className="ob-input-wrap">
                    <input
                      id="si-email"
                      type="email"
                      className="ob-input"
                      placeholder="name@example.com"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="ob-field">
                  <label className="ob-label" htmlFor="si-pw">Password</label>
                  <PasswordInput
                    id="si-pw"
                    value={password}
                    onChange={setPassword}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </div>
                <div className="ob-form-row">
                  <button type="button" className="ob-link" onClick={() => switchMode('forgot')}>
                    Forgot password?
                  </button>
                </div>
                <button type="submit" className="ob-btn ob-btn-primary" disabled={busy}>
                  {busy ? <Spinner /> : 'Sign In'}
                </button>

                <div className="ob-divider">quick demo</div>
                <div className="ob-demo">
                  <button type="button" onClick={() => demo('admin@tms.local')}>Admin</button>
                  <button type="button" onClick={() => demo('sarah@tms.local')}>Supervisor</button>
                  <button type="button" onClick={() => demo('grace@tms.local')}>Member</button>
                </div>
              </form>
            )}

            {mode === 'access' && (
              <div className="ob-form ob-form-anim" key="access">
                <p className="ob-legal" style={{ textAlign: 'left', fontSize: 14, color: '#a4b1c9' }}>
                  TASK MANAGEMENT SYSTEM accounts are provisioned by an administrator. Once you have credentials,
                  return to Sign In. For demos, use one of the roles below.
                </p>
                <div className="ob-divider">try a demo role</div>
                <div className="ob-demo">
                  <button type="button" onClick={() => demo('admin@tms.local')}>Admin</button>
                  <button type="button" onClick={() => demo('sarah@tms.local')}>Supervisor</button>
                  <button type="button" onClick={() => demo('grace@tms.local')}>Member</button>
                </div>
                <button type="button" className="ob-btn ob-btn-primary" onClick={() => switchMode('signin')}>
                  Back to Sign In
                </button>
                <p className="ob-legal">
                  Need production access? Contact your system administrator.
                </p>
              </div>
            )}

            {mode === 'forgot' && (
              <form className="ob-form ob-form-anim" key="forgot" onSubmit={sendReset}>
                {resetSent && (
                  <div className="ob-note" role="status">
                    <IcoMailCheck size={18} />
                    <span>If an account exists for that email, a reset link is on its way. Check your inbox.</span>
                  </div>
                )}
                {error && <div className="ob-error" role="alert">{error}</div>}
                <div className="ob-field">
                  <label className="ob-label" htmlFor="fp-email">Email</label>
                  <div className="ob-input-wrap">
                    <input
                      id="fp-email"
                      type="email"
                      className="ob-input"
                      placeholder="name@example.com"
                      autoComplete="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="ob-btn ob-btn-primary" disabled={busy}>
                  {busy ? <Spinner /> : 'Send reset link'}
                </button>
                <div className="ob-auth-foot">
                  <button type="button" className="ob-link" onClick={() => switchMode('signin')}>
                    Back to sign in
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
        <div className="ob-auth-media-col">
          <PropertySlider />
        </div>
      </div>
    </div>
  );
}
