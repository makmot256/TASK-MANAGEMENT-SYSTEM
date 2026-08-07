import fs from 'fs';
import path from 'path';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { uploadRoot } from '../middleware/upload.js';

const SCORABLE_EXT = new Set(['.pdf', '.docx', '.doc']);

/**
 * Runs AI grammar/quality scoring for a submission and stores the result.
 * Called fire-and-forget right after a member submits a report — it must
 * never throw into the request path, since a slow/down ML service should
 * not block report submission.
 *
 * Picks the first scorable file (PDF/DOCX) attached to the submission; if
 * none exists, falls back to the typed `content` text.
 */
export async function runAiEvaluation(submissionId) {
  await pool.execute(
    `INSERT INTO ai_evaluations (submission_id, status) VALUES (?, 'pending')
     ON DUPLICATE KEY UPDATE status = 'pending', error_message = NULL`,
    [submissionId]
  );

  try {
    const [subs] = await pool.execute(`SELECT content FROM submissions WHERE id = ?`, [submissionId]);
    if (!subs.length) throw new Error('Submission not found.');

    const [files] = await pool.execute(
      `SELECT original_name, stored_name FROM submission_files WHERE submission_id = ?`,
      [submissionId]
    );
    const scorableFile = files.find((f) => SCORABLE_EXT.has(path.extname(f.original_name).toLowerCase()));

    let result;
    if (scorableFile) {
      try {
        result = await scoreFile(path.join(uploadRoot, scorableFile.stored_name), scorableFile.original_name);
      } catch (err) {
        const fallbackText = subs[0].content && subs[0].content.trim();
        if (fallbackText && looksLikeUnextractableDocumentError(err)) {
          console.warn(
            `[ai-evaluation] file for submission ${submissionId} was not text-extractable; falling back to typed content.`
          );
          result = await scoreText(fallbackText);
        } else {
          throw err;
        }
      }
    } else if (subs[0].content && subs[0].content.trim()) {
      result = await scoreText(subs[0].content);
    } else {
      throw new Error('Nothing to score: no PDF/DOCX file and no typed content.');
    }

    await pool.execute(
      `UPDATE ai_evaluations SET grammar_score = ?, quality_score = ?, model_name = ?, status = 'done', error_message = NULL
       WHERE submission_id = ?`,
      [result.grammar_score, result.quality_score, result.model || 'unknown', submissionId]
    );
  } catch (err) {
    console.error('[ai-evaluation] failed for submission', submissionId, err.message);
    await pool.execute(
      `UPDATE ai_evaluations SET status = 'failed', error_message = ? WHERE submission_id = ?`,
      [String(err.message).slice(0, 500), submissionId]
    );
  }
}

async function scoreFile(absPath, originalName) {
  const buf = fs.readFileSync(absPath);
  const blob = new Blob([buf]);
  const form = new FormData();
  form.append('file', blob, originalName);

  const res = await fetchWithTimeout(`${env.aiServiceUrl}/evaluate`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`AI service returned ${res.status}: ${await res.text()}`);
  return res.json();
}

function looksLikeUnextractableDocumentError(err) {
  const message = String(err?.message || '').toLowerCase();
  return (
    message.includes('no extractable text found') ||
    message.includes('could not extract text from document') ||
    message.includes('may be a scanned image')
  );
}

async function scoreText(text) {
  const res = await fetchWithTimeout(`${env.aiServiceUrl}/evaluate-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`AI service returned ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.aiServiceTimeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches the stored AI evaluation for a submission, or null if none exists. */
export async function getAiEvaluation(submissionId) {
  const [rows] = await pool.execute(
    `SELECT grammar_score, quality_score, model_name, status, error_message, supervisor_action, created_at
     FROM ai_evaluations WHERE submission_id = ?`,
    [submissionId]
  );
  return rows[0] || null;
}

/** Records whether the supervisor accepted the AI score or overrode it manually. */
export async function markAiEvaluationAction(submissionId, action) {
  await pool.execute(`UPDATE ai_evaluations SET supervisor_action = ? WHERE submission_id = ?`, [
    action,
    submissionId,
  ]);
}
