import { pool } from '../config/db.js';
import { getSettings } from './settings.service.js';
import { notify } from '../utils/notify.js';
import { sendMail } from '../utils/mailer.js';

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/**
 * ML-style Engagement Score (SRS 4.3): weighted behavioural features over a
 * rolling 14-day window. Requires >= 2 weeks of history, else "insufficient_data".
 *   features: login frequency, task-update frequency, submission timeliness
 *   score 0..100 ; below threshold => at_risk
 */
export async function computeEngagementForMember(memberId, settings) {
  const s = settings || (await getSettings());

  const [[acct]] = await pool.query(
    `SELECT DATEDIFF(NOW(), created_at) AS age_days FROM users WHERE id = ?`,
    [memberId]
  );
  const [[firstAct]] = await pool.query(
    `SELECT DATEDIFF(NOW(), MIN(created_at)) AS hist_days FROM activity_logs WHERE user_id = ?`,
    [memberId]
  );
  const historyDays = Math.max(Number(acct?.age_days) || 0, Number(firstAct?.hist_days) || 0);
  if (historyDays < 14) {
    return { member_id: memberId, score: null, status: 'insufficient_data', login_frequency: 0, task_update_frequency: 0, submission_timeliness: 0, is_flagged: 0 };
  }

  // Feature 1: distinct login days in last 14 (target: 10 active days = full)
  const [[login]] = await pool.query(
    `SELECT COUNT(DISTINCT DATE(created_at)) AS days FROM activity_logs
     WHERE user_id = ? AND action_type = 'login' AND created_at > (NOW() - INTERVAL 14 DAY)`,
    [memberId]
  );
  const loginScore = clamp01(Number(login.days) / 10) * 100;

  // Feature 2: task updates in last 14 days (target: 7)
  const [[upd]] = await pool.query(
    `SELECT COUNT(*) AS c FROM activity_logs
     WHERE user_id = ? AND action_type = 'task_update' AND created_at > (NOW() - INTERVAL 14 DAY)`,
    [memberId]
  );
  const taskScore = clamp01(Number(upd.c) / 7) * 100;

  // Feature 3: submission timeliness in last 30 days
  const [[sub]] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(is_late = 0) AS on_time FROM submissions
     WHERE member_id = ? AND submitted_at > (NOW() - INTERVAL 30 DAY)`,
    [memberId]
  );
  const subScore = Number(sub.total) > 0 ? clamp01(Number(sub.on_time) / Number(sub.total)) * 100 : 0;

  const score =
    Number(s.eng_weight_login) * loginScore +
    Number(s.eng_weight_task) * taskScore +
    Number(s.eng_weight_submission) * subScore;

  const threshold = Number(s.engagement_risk_threshold);
  let status = 'on_track';
  if (score < threshold) status = 'at_risk';
  else if (score < threshold + 20) status = 'moderate';

  return {
    member_id: memberId,
    score: Math.round(score * 100) / 100,
    status,
    login_frequency: Math.round(loginScore * 100) / 100,
    task_update_frequency: Math.round(taskScore * 100) / 100,
    submission_timeliness: Math.round(subScore * 100) / 100,
    is_flagged: status === 'at_risk' ? 1 : 0,
  };
}

// Was this member already flagged at the previous computation?
async function wasPreviouslyFlagged(memberId) {
  const [[row]] = await pool.query(
    `SELECT is_flagged FROM engagement_scores WHERE member_id = ? ORDER BY computed_at DESC LIMIT 1`,
    [memberId]
  );
  return row ? !!row.is_flagged : false;
}

// Find the supervisor(s) responsible for a member.
async function supervisorsForMember(memberId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT ts.supervisor_id AS id FROM team_members tm
     JOIN team_supervisors ts ON ts.team_id = tm.team_id WHERE tm.member_id = ?`,
    [memberId]
  );
  return rows.map((r) => r.id);
}

export async function recomputeAllEngagement() {
  const s = await getSettings();
  const [members] = await pool.query(`SELECT id, full_name, email FROM users WHERE role = 'member'`);
  let flaggedNew = 0;

  for (const m of members) {
    const prevFlagged = await wasPreviouslyFlagged(m.id);
    const e = await computeEngagementForMember(m.id, s);
    await pool.execute(
      `INSERT INTO engagement_scores
        (member_id, score, status, login_frequency, task_update_frequency, submission_timeliness, is_flagged)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [e.member_id, e.score, e.status, e.login_frequency, e.task_update_frequency, e.submission_timeliness, e.is_flagged]
    );

    // SRS: email only when NEWLY flagged
    if (e.is_flagged && !prevFlagged) {
      flaggedNew++;
      const supers = await supervisorsForMember(m.id);
      for (const supId of supers) {
        await notify(supId, {
          type: 'at_risk',
          title: 'Member flagged as at-risk',
          body: `${m.full_name} has a low engagement score (${e.score}).`,
          link: '/analytics',
        });
        const [[sup]] = await pool.query(`SELECT email FROM users WHERE id = ?`, [supId]);
        if (sup) {
          await sendMail({
            to: sup.email,
            subject: `At-risk alert: ${m.full_name}`,
            text: `${m.full_name} has dropped below the engagement threshold (score ${e.score}). Please follow up.`,
          });
        }
      }
    }
  }
  return { members: members.length, flaggedNew };
}
