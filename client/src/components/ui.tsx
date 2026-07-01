import React from 'react';
import { IcoX } from '../lib/icons';

export const initials = (name = '') =>
  name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export function Avatar({ name, color, size = 'md' }: { name: string; color?: string; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'sm' ? 'avatar avatar-sm' : size === 'lg' ? 'avatar avatar-lg' : 'avatar';
  return <span className={cls} style={{ background: color || '#2563eb' }}>{initials(name)}</span>;
}

const STATUS_BADGE: Record<string, string> = {
  'To-Do': 'badge-grey', 'In Progress': 'badge-brand', 'Under Review': 'badge-amber', Completed: 'badge-green',
};
export const StatusBadge = ({ status }: { status: string }) => (
  <span className={`badge ${STATUS_BADGE[status] || 'badge-grey'}`}>{status}</span>
);

const PRIORITY_BADGE: Record<string, string> = { High: 'badge-red', Medium: 'badge-amber', Low: 'badge-grey' };
export const PriorityBadge = ({ priority }: { priority: string }) => (
  <span className={`badge ${PRIORITY_BADGE[priority] || 'badge-grey'}`}>{priority}</span>
);

const RISK_LABEL: Record<string, string> = { green: 'On track', amber: 'Moderate', red: 'High risk', grey: 'No data' };
export const RiskBadge = ({ risk }: { risk: string }) => {
  const map: Record<string, string> = { green: 'badge-green', amber: 'badge-amber', red: 'badge-red', grey: 'badge-grey' };
  return <span className={`badge ${map[risk] || 'badge-grey'}`}><span className={`dot ${risk}`} /> {RISK_LABEL[risk] || risk}</span>;
};

export const Spinner = () => <span className="spinner" />;

export function Loader({ label = 'Loading...' }: { label?: string }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 72 }} />)}
      <p className="tiny" style={{ textAlign: 'center' }}>{label}</p>
    </div>
  );
}

export function EmptyState({ icon, title, sub }: { icon?: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="empty">
      {icon && <div className="empty-ico">{icon}</div>}
      <h3 style={{ fontSize: 16 }}>{title}</h3>
      {sub && <p className="muted" style={{ marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '-');
export const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const timeAgo = (d: string) => {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={wide ? { maxWidth: 760 } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ fontSize: 17 }}>{title}</h3>
          <button className="icon-btn" onClick={onClose}><IcoX size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
