import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { containsVulgarLanguage } from '../utils/profanity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EVIDENCE_WORDS = [
  'attached', 'proof', 'screenshot', 'pdf', 'document',
  'evidence', 'tested', 'coverage',
];

/**
 * Rule-based compliance check, computed live in Node (no Python/ML needed).
 * Each criterion carries a weight; the score is the sum of passed weights (0-100).
 */
export function runRuleBasedComplianceCheck({
  is_late = 0,
  content = '',
  file_count = 0,
}) {
  const text = String(content || '').trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const hasFiles = Number(file_count) > 0;
  const hasEvidenceWords = EVIDENCE_WORDS.some((w) => text.toLowerCase().includes(w));
  const vulgar = containsVulgarLanguage(text);

  const criteria = [
    {
      key: 'timeliness',
      label: 'Submitted on time',
      pass: Number(is_late) === 0,
      detail: Number(is_late) === 0 ? 'On time' : 'Submitted after the task deadline',
    },
    {
      key: 'evidence',
      label: 'Evidence / proof of work',
      pass: hasFiles || hasEvidenceWords,
      detail: hasFiles
        ? `${file_count} file attachment${file_count > 1 ? 's' : ''}`
        : hasEvidenceWords
          ? 'Evidence mentioned in the report'
          : 'No attachments or evidence mentioned',
    },
    {
      key: 'length',
      label: 'Report detail',
      pass: wordCount >= 20,
      detail:
        wordCount >= 50
          ? `${wordCount} words — thorough`
          : wordCount >= 20
            ? `${wordCount} words — adequate`
            : wordCount > 0
              ? `${wordCount} words — too brief`
              : 'No typed content',
    },
    {
      key: 'language',
      label: 'Professional language',
      pass: !vulgar,
      detail: vulgar ? 'Contains vulgar or abusive language' : 'Clean',
    },
    {
      key: 'substance',
      label: 'Report submitted',
      pass: wordCount > 0 || hasFiles,
      detail: wordCount > 0 || hasFiles ? 'Content or files present' : 'Empty submission',
    },
  ];

  const weights = { timeliness: 25, evidence: 25, length: 20, language: 15, substance: 15 };
  const score = criteria.reduce((sum, c) => sum + (c.pass ? weights[c.key] : 0), 0);
  const failing = criteria.filter((c) => !c.pass);
  const gapList = failing.map((c) => c.label).join(', ');

  let suggested_action;
  if (score >= 80) {
    suggested_action = failing.length
      ? `Compliant (${score}%) — minor gap${failing.length > 1 ? 's' : ''}: ${gapList}. Safe to approve.`
      : `Fully compliant (${score}%). Safe to approve.`;
  } else {
    suggested_action = 'Revise report with clear steps completed and evidence attached to report';
  }

  return {
    score,
    pass: score >= 50,
    suggested_action,
    criteria,
    ml_available: false,
  };
}

export function runComplianceCheck({
  report_content = '',
  is_late = 0,
  on_time = 1,
  grammar_error_count = 0,
  grammar_quality_score = 5,
  content_quality_score = 5,
  vulgar_comment = 0,
}) {
  try {
    const report_length = report_content.trim().split(/\s+/).length;

    const has_evidence = EVIDENCE_WORDS.some(w =>
      report_content.toLowerCase().includes(w)
    ) ? 1 : 0;

    const scriptPath = path.join(__dirname, '../../ml/predict.py');

    const args = [
      is_late, on_time, grammar_error_count,
      grammar_quality_score, content_quality_score,
      vulgar_comment, report_length, has_evidence,
    ].join(' ');

    const result = execSync(`python "${scriptPath}" ${args}`, {
      encoding: 'utf-8',
      timeout: 10000,
    });

    const parsed = JSON.parse(result.trim());
    return parsed;
  } catch (err) {
    console.error('[compliance] ML check failed:', err.message);
    return {
      compliance_pass: null,
      compliance_score: null,
      ml_available: false,
    };
  }
}