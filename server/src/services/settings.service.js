import { pool } from '../config/db.js';

const DEFAULTS = {
  pi_weight_tp: 0.25,
  pi_weight_pe: 0.35,
  pi_weight_sa: 0.4,
  peer_penalty: 0.1,
  peer_review_deadline_days: 7,
  peer_review_missed_penalty: 0.05,
  peer_review_bad_penalty: 0.03,
  engagement_risk_threshold: 40,
  eng_weight_login: 0.34,
  eng_weight_task: 0.33,
  eng_weight_submission: 0.33,
};

// Reads all settings and returns a typed object merged with defaults.
export async function getSettings() {
  const [rows] = await pool.execute(`SELECT setting_key, setting_value FROM system_settings`);
  const out = { ...DEFAULTS };
  for (const r of rows) {
    const n = Number(r.setting_value);
    out[r.setting_key] = Number.isNaN(n) ? r.setting_value : n;
  }
  return out;
}
