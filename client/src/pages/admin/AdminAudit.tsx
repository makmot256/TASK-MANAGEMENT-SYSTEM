import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { fmtDateTime, Loader, EmptyState } from '../../components/ui';
import { IcoShield } from '../../lib/icons';

export default function AdminAudit() {
  const [audit, setAudit] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await api.get('/admin/audit');
      setAudit(data.audit);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="page">
      <h1 className="page-title">Security &amp; Audit</h1>
      <p className="page-sub">Login attempts are logged with timestamp and IP address (SRS 5.2).</p>

      <div className="card" style={{ marginTop: 22 }}>
        {loading ? <div className="card-pad"><Loader /></div> : audit.length === 0 ? (
          <EmptyState icon={<IcoShield size={56} />} title="No login activity yet" />
        ) : (
          <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Time</th><th>User</th><th>Email</th><th>Result</th><th>IP address</th></tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="muted">{fmtDateTime(a.created_at)}</td>
                  <td style={{ fontWeight: 600 }}>{a.full_name || '—'}</td>
                  <td className="muted">{a.email}</td>
                  <td>{a.success ? <span className="badge badge-green">Success</span> : <span className="badge badge-red">Failed</span>}</td>
                  <td className="muted" style={{ fontFamily: 'monospace', fontSize: 13 }}>{a.ip_address || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
