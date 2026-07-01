import React, { useEffect, useState } from 'react';
import { api, errMsg } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Loader, Spinner } from '../../components/ui';

const LABELS: Record<string, string> = {
  pi_weight_tp: 'PI weight - Task Performance (w1)',
  pi_weight_pe: 'PI weight - Peer Evaluation (w2)',
  pi_weight_sa: 'PI weight - Supervisor Assessment (w3)',
  peer_penalty: 'Peer evaluation penalty (P)',
  peer_review_deadline_days: 'Peer review deadline (days)',
  peer_review_missed_penalty: 'TP deduction — missed peer review',
  peer_review_bad_penalty: 'TP deduction — vulgar peer review comment',
  engagement_risk_threshold: 'Engagement risk threshold',
  eng_weight_login: 'Engagement weight - Login frequency',
  eng_weight_task: 'Engagement weight - Task updates',
  eng_weight_submission: 'Engagement weight - Submission timeliness',
};

export default function AdminSettings() {
  const toast = useToast();
  const [settings, setSettings] = useState<any[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await api.get('/admin/settings');
      setSettings(data.settings);
      const v: Record<string, string> = {};
      data.settings.forEach((s: any) => (v[s.setting_key] = s.setting_value));
      setValues(v);
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setBusy(true);
    try { await api.put('/admin/settings', { settings: values }); toast('Settings saved.', 'success'); }
    catch (err) { toast(errMsg(err), 'error'); } finally { setBusy(false); }
  };

  const piSum = ['pi_weight_tp', 'pi_weight_pe', 'pi_weight_sa'].reduce((a, k) => a + (Number(values[k]) || 0), 0);

  if (loading) return <div className="page"><Loader /></div>;

  return (
    <div className="page">
      <h1 className="page-title">System Settings</h1>
      <p className="page-sub">Configure the Performance Index weights, penalty and engagement thresholds.</p>

      <div className="card card-pad" style={{ marginTop: 22, maxWidth: 720 }}>
        <h3 className="card-title" style={{ marginBottom: 16 }}>Performance Index</h3>
        {['pi_weight_tp', 'pi_weight_pe', 'pi_weight_sa', 'peer_penalty'].map((k) => (
          <Field key={k} label={LABELS[k]} value={values[k]} onChange={(v: string) => setValues({ ...values, [k]: v })} desc={settings.find((s) => s.setting_key === k)?.description} />
        ))}
        <div className="divider" style={{ margin: '16px 0' }} />
        <h4 className="card-title" style={{ marginBottom: 12, fontSize: 14 }}>Peer review reviewer penalties (deducted from TP)</h4>
        {['peer_review_deadline_days', 'peer_review_missed_penalty', 'peer_review_bad_penalty'].map((k) => (
          <Field key={k} label={LABELS[k]} value={values[k]} onChange={(v: string) => setValues({ ...values, [k]: v })} desc={settings.find((s) => s.setting_key === k)?.description} />
        ))}
        <div className={`badge ${Math.abs(piSum - 1) < 0.001 ? 'badge-green' : 'badge-red'}`} style={{ marginTop: 4 }}>
          w1 + w2 + w3 = {piSum.toFixed(2)} {Math.abs(piSum - 1) < 0.001 ? '✓ (normalised)' : '✗ should equal 1.0'}
        </div>

        <div className="divider" />
        <h3 className="card-title" style={{ marginBottom: 16 }}>Engagement Engine</h3>
        {['engagement_risk_threshold', 'eng_weight_login', 'eng_weight_task', 'eng_weight_submission'].map((k) => (
          <Field key={k} label={LABELS[k]} value={values[k]} onChange={(v: string) => setValues({ ...values, [k]: v })} desc={settings.find((s) => s.setting_key === k)?.description} />
        ))}

        <div style={{ marginTop: 18 }}><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : 'Save settings'}</button></div>
      </div>
    </div>
  );
}

const Field = ({ label, value, onChange, desc }: any) => (
  <div className="field">
    <label className="label">{label}</label>
    <input className="input" type="number" step="0.01" value={value || ''} onChange={(e) => onChange(e.target.value)} />
    {desc && <p className="tiny" style={{ marginTop: 4 }}>{desc}</p>}
  </div>
);
