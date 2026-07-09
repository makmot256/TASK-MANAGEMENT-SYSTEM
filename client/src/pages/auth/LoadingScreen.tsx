import { useEffect, useRef, useState } from 'react';

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const DEFAULT_MESSAGES = [
  'Initializing TASK MANAGEMENT SYSTEM…',
  'Preparing your workspace…',
  'Checking system status…',
  'Almost ready…',
];

const SIGNIN_MESSAGES = [
  'Signing you in…',
  'Loading your workspace…',
  'Preparing your dashboard…',
  'Almost ready…',
];

const SIGNOUT_MESSAGES = [
  'Signing you out…',
  'Saving your session…',
  'Closing workspace…',
  'See you soon…',
];

const MIN_DURATION = 1100;
const STROKE = 3;
const RX = 18;

export default function LoadingScreen({
  onDone,
  variant = 'boot',
  durationMs,
}: {
  onDone: () => void;
  variant?: 'boot' | 'signin' | 'signout';
  /** Override minimum display time (ms). */
  durationMs?: number;
}) {
  const [pct, setPct] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const messages =
    variant === 'signin' ? SIGNIN_MESSAGES : variant === 'signout' ? SIGNOUT_MESSAGES : DEFAULT_MESSAGES;

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.offsetWidth, h: el.offsetHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const reduced = prefersReduced();
    const base = durationMs ?? MIN_DURATION;
    const minDuration = reduced ? Math.min(700, base) : base;
    startRef.current = Date.now();

    const tick = window.setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const timeCeil = Math.min(100, (elapsed / minDuration) * 100);
      setPct((prev) => {
        const drift = Math.max(0.6, (timeCeil - prev) * 0.18 + Math.random() * 1.4);
        const next = Math.min(timeCeil, prev + drift);
        if (next >= 99.5 && elapsed >= minDuration && !doneRef.current) {
          doneRef.current = true;
          window.clearInterval(tick);
          const exitMs =
            variant === 'signout' || variant === 'signin'
              ? 0
              : reduced
                ? 120
                : 280;
          if (exitMs === 0) {
            onDone();
          } else {
            setExiting(true);
            window.setTimeout(onDone, exitMs);
          }
          return 100;
        }
        return next;
      });
    }, reduced ? 90 : 80);

    return () => window.clearInterval(tick);
  }, [onDone, durationMs, variant]);

  const msgIndex = pct < 30 ? 0 : pct < 60 ? 1 : pct < 88 ? 2 : 3;
  const measured = size.w > 0 && size.h > 0;

  return (
    <div className={`ob-stage ob-fade-in ${exiting ? 'ld-exiting' : ''}`}>
      <div className="ld-wrap">
        <div
          className="ld-frame"
          ref={frameRef}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Loading"
        >
          {measured && (
            <svg className="ld-border" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} fill="none" aria-hidden="true">
              <defs>
                <linearGradient id="ldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#5b8bff" />
                  <stop offset="50%" stopColor="#e8edf7" />
                  <stop offset="100%" stopColor="#f4793b" />
                </linearGradient>
              </defs>
              <rect
                className="ld-track"
                x={STROKE / 2}
                y={STROKE / 2}
                width={size.w - STROKE}
                height={size.h - STROKE}
                rx={RX}
                ry={RX}
              />
              <rect
                className="ld-prog"
                x={STROKE / 2}
                y={STROKE / 2}
                width={size.w - STROKE}
                height={size.h - STROKE}
                rx={RX}
                ry={RX}
                pathLength={100}
                strokeDasharray={100}
                strokeDashoffset={100 - pct}
              />
            </svg>
          )}
          <div className="ld-panel">
            <div style={{ display: 'grid', justifyItems: 'center' }}>
              <div className="ld-mark">T</div>
              <div className="ld-brand">TASK MANAGEMENT SYSTEM</div>
            </div>
          </div>
        </div>

        <p className="ld-msg" key={msgIndex} role="status" aria-live="polite">
          {messages[msgIndex]}
        </p>
      </div>
    </div>
  );
}
