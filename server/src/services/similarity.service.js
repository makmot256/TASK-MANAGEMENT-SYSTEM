import crypto from 'crypto';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { teammateIds } from '../utils/scope.js';

const MODEL_NAME = env.embeddingModel;
const THRESHOLD = env.similarityThreshold;
const MIN_WORDS = env.similarityMinWords;
const TOP_K = env.similarityTopK;

let pipelinePromise = null;

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function contentHash(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function parseEmbedding(json) {
  const arr = typeof json === 'string' ? JSON.parse(json) : json;
  return Float32Array.from(arr);
}

function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function getEmbedder() {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      return pipeline('feature-extraction', MODEL_NAME);
    })().catch((err) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

export async function embedText(text) {
  const extractor = await getEmbedder();
  const output = await extractor(String(text || ''), { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

async function revisionExcludeIds(submissionId, revisionOf) {
  const excluded = new Set([Number(submissionId)]);
  if (revisionOf) excluded.add(Number(revisionOf));

  const [rows] = await pool.query(
    `SELECT id, revision_of FROM submissions
      WHERE id = ? OR revision_of = ? OR (? IS NOT NULL AND (id = ? OR revision_of = ?))`,
    [submissionId, submissionId, revisionOf || null, revisionOf || null, revisionOf || null]
  );
  for (const r of rows) {
    excluded.add(Number(r.id));
    if (r.revision_of) excluded.add(Number(r.revision_of));
  }
  return [...excluded];
}

/**
 * Embed (or refresh) a submission's typed content. No-op for empty/short text.
 * Returns the embedding row summary or null.
 */
export async function ensureSubmissionEmbedding(submissionId) {
  const [[sub]] = await pool.query(
    `SELECT id, content FROM submissions WHERE id = ? LIMIT 1`,
    [submissionId]
  );
  if (!sub?.content || !String(sub.content).trim()) return null;
  if (wordCount(sub.content) < MIN_WORDS) return null;

  const hash = contentHash(sub.content);
  const [[existing]] = await pool.query(
    `SELECT submission_id, content_hash, model_name, embedding_json, dims,
            top_match_score, top_match_id, top_match_kind
       FROM submission_embeddings WHERE submission_id = ? LIMIT 1`,
    [submissionId]
  );
  if (existing && existing.content_hash === hash && existing.model_name === MODEL_NAME) {
    return {
      submission_id: submissionId,
      dims: existing.dims,
      embedding: parseEmbedding(existing.embedding_json),
      top_match_score: existing.top_match_score != null ? Number(existing.top_match_score) : null,
      top_match_id: existing.top_match_id,
      top_match_kind: existing.top_match_kind,
    };
  }

  const vector = await embedText(sub.content);
  await pool.execute(
    `INSERT INTO submission_embeddings
       (submission_id, model_name, content_hash, embedding_json, dims)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       model_name = VALUES(model_name),
       content_hash = VALUES(content_hash),
       embedding_json = VALUES(embedding_json),
       dims = VALUES(dims),
       top_match_score = NULL,
       top_match_id = NULL,
       top_match_kind = NULL`,
    [submissionId, MODEL_NAME, hash, JSON.stringify(vector), vector.length]
  );

  return {
    submission_id: submissionId,
    dims: vector.length,
    embedding: Float32Array.from(vector),
    top_match_score: null,
    top_match_id: null,
    top_match_kind: null,
  };
}

/** Fire-and-forget embed + similarity cache after submit (does not block the request). */
export function scheduleSubmissionEmbedding(submissionId) {
  setImmediate(() => {
    ensureSubmissionEmbedding(submissionId)
      .then((emb) => (emb ? findSimilarSubmissions(submissionId) : null))
      .catch((err) => {
        console.error(`[similarity] embed failed for submission ${submissionId}:`, err.message);
      });
  });
}

/**
 * Find semantically similar reports for a submission (supervisor hint).
 * Compares against: same member history + teammates. Also checks task brief.
 */
export async function findSimilarSubmissions(submissionId, { memberScopeIds = null } = {}) {
  const [[source]] = await pool.query(
    `SELECT s.id, s.member_id, s.content, s.revision_of, s.submitted_at,
            t.id AS task_id, t.title AS task_title, t.description AS task_description,
            u.full_name AS member_name
       FROM submissions s
       JOIN tasks t ON t.id = s.task_id
       JOIN users u ON u.id = s.member_id
      WHERE s.id = ? LIMIT 1`,
    [submissionId]
  );
  if (!source) {
    return { ok: false, reason: 'not_found', matches: [], meta: {} };
  }

  const words = wordCount(source.content);
  if (!source.content || !String(source.content).trim()) {
    return {
      ok: true,
      reason: 'no_typed_content',
      matches: [],
      meta: {
        model: MODEL_NAME,
        threshold: THRESHOLD,
        min_words: MIN_WORDS,
        word_count: words,
        disclaimer:
          'Similarity uses typed report text only (not uploaded PDF/DOCX). This is a review hint, not a plagiarism verdict.',
      },
    };
  }
  if (words < MIN_WORDS) {
    return {
      ok: true,
      reason: 'too_short',
      matches: [],
      meta: {
        model: MODEL_NAME,
        threshold: THRESHOLD,
        min_words: MIN_WORDS,
        word_count: words,
        disclaimer:
          'Similarity uses typed report text only (not uploaded PDF/DOCX). This is a review hint, not a plagiarism verdict.',
      },
    };
  }

  let sourceEmb;
  try {
    sourceEmb = await ensureSubmissionEmbedding(submissionId);
  } catch (err) {
    console.error('[similarity] model error:', err.message);
    return {
      ok: false,
      reason: 'model_unavailable',
      message: err.message,
      matches: [],
      meta: { model: MODEL_NAME, threshold: THRESHOLD },
    };
  }
  if (!sourceEmb) {
    return {
      ok: true,
      reason: 'too_short',
      matches: [],
      meta: { model: MODEL_NAME, threshold: THRESHOLD, min_words: MIN_WORDS, word_count: words },
    };
  }

  const mates = await teammateIds(source.member_id);
  let candidateMemberIds = [Number(source.member_id), ...mates.map(Number)];
  if (Array.isArray(memberScopeIds)) {
    const allowed = new Set(memberScopeIds.map(Number));
    candidateMemberIds = candidateMemberIds.filter((id) => allowed.has(id));
  }
  if (candidateMemberIds.length === 0) {
    return {
      ok: true,
      reason: 'no_candidates',
      matches: [],
      meta: { model: MODEL_NAME, threshold: THRESHOLD, min_words: MIN_WORDS, word_count: words },
    };
  }

  const excluded = await revisionExcludeIds(source.id, source.revision_of);
  const placeholders = candidateMemberIds.map(() => '?').join(',');
  const excludePlaceholders = excluded.map(() => '?').join(',');

  const [candidates] = await pool.query(
    `SELECT s.id, s.member_id, s.content, s.submitted_at, s.revision_of,
            t.title AS task_title,
            u.full_name AS member_name, u.avatar_color,
            e.embedding_json, e.content_hash, e.model_name
       FROM submissions s
       JOIN tasks t ON t.id = s.task_id
       JOIN users u ON u.id = s.member_id
       LEFT JOIN submission_embeddings e ON e.submission_id = s.id
      WHERE s.member_id IN (${placeholders})
        AND s.id NOT IN (${excludePlaceholders})
        AND s.content IS NOT NULL AND TRIM(s.content) <> ''
      ORDER BY s.submitted_at DESC
      LIMIT 120`,
    [...candidateMemberIds, ...excluded]
  );

  const matches = [];
  for (const c of candidates) {
    if (wordCount(c.content) < MIN_WORDS) continue;

    let vector;
    try {
      if (c.embedding_json && c.model_name === MODEL_NAME && c.content_hash === contentHash(c.content)) {
        vector = parseEmbedding(c.embedding_json);
      } else {
        const emb = await ensureSubmissionEmbedding(c.id);
        if (!emb) continue;
        vector = emb.embedding;
      }
    } catch {
      continue;
    }

    const score = cosineSimilarity(sourceEmb.embedding, vector);
    if (score < THRESHOLD) continue;

    const kind = Number(c.member_id) === Number(source.member_id) ? 'own_past' : 'teammate';
    matches.push({
      submission_id: c.id,
      score: Math.round(score * 1000) / 1000,
      percent: Math.round(score * 100),
      kind,
      member_id: c.member_id,
      member_name: c.member_name,
      avatar_color: c.avatar_color,
      task_title: c.task_title,
      submitted_at: c.submitted_at,
    });
  }

  // Task brief alignment (same embedding model)
  const brief = [source.task_title || '', source.task_description || ''].join('\n').trim();
  if (brief && wordCount(brief) >= 8) {
    try {
      const briefVec = Float32Array.from(await embedText(brief));
      const briefScore = cosineSimilarity(sourceEmb.embedding, briefVec);
      if (briefScore >= THRESHOLD) {
        matches.push({
          submission_id: null,
          score: Math.round(briefScore * 1000) / 1000,
          percent: Math.round(briefScore * 100),
          kind: 'task_brief',
          member_id: null,
          member_name: null,
          avatar_color: null,
          task_title: source.task_title,
          submitted_at: null,
        });
      }
    } catch {
      /* ignore brief comparison failures */
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const top = matches.slice(0, TOP_K);

  const bestSubmission = top.find((m) => m.submission_id != null);
  await pool.execute(
    `UPDATE submission_embeddings
        SET top_match_score = ?, top_match_id = ?, top_match_kind = ?
      WHERE submission_id = ?`,
    [
      bestSubmission ? bestSubmission.score : top[0]?.score ?? null,
      bestSubmission ? bestSubmission.submission_id : null,
      top[0]?.kind || null,
      submissionId,
    ]
  );

  return {
    ok: true,
    reason: top.length ? 'ok' : 'no_matches',
    matches: top,
    meta: {
      model: MODEL_NAME,
      threshold: THRESHOLD,
      min_words: MIN_WORDS,
      word_count: words,
      candidates_scanned: candidates.length,
      disclaimer:
        'Similarity uses typed report text and sentence embeddings (meaning), not exact copy-paste only. This is a review hint, not a plagiarism verdict.',
    },
  };
}

/** Lightweight badge data for review queue rows. */
export async function similarityBadgesForIds(submissionIds) {
  if (!submissionIds?.length) return {};
  const placeholders = submissionIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT submission_id, top_match_score, top_match_kind
       FROM submission_embeddings
      WHERE submission_id IN (${placeholders})
        AND top_match_score IS NOT NULL
        AND top_match_score >= ?`,
    [...submissionIds, THRESHOLD]
  );
  const map = {};
  for (const r of rows) {
    map[r.submission_id] = {
      score: Number(r.top_match_score),
      percent: Math.round(Number(r.top_match_score) * 100),
      kind: r.top_match_kind,
    };
  }
  return map;
}

/** Backfill embeddings for all typed submissions (CLI). */
export async function backfillAllEmbeddings() {
  const [rows] = await pool.query(
    `SELECT id FROM submissions
      WHERE content IS NOT NULL AND TRIM(content) <> ''
      ORDER BY id ASC`
  );
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const emb = await ensureSubmissionEmbedding(row.id);
      if (emb) {
        await findSimilarSubmissions(row.id);
        ok += 1;
        console.log(`  ✓ submission ${row.id}`);
      } else {
        skipped += 1;
        console.log(`  · skipped ${row.id} (too short / empty)`);
      }
    } catch (err) {
      failed += 1;
      console.error(`  ✗ submission ${row.id}: ${err.message}`);
    }
  }
  return { total: rows.length, ok, skipped, failed };
}
