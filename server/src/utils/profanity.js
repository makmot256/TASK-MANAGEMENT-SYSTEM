/**
 * Detects vulgar or abusive language in peer-review comments.
 * Uses whole-word matching on a normalized form of the text.
 */
const VULGAR_TERMS = [
  'fuck', 'fucking', 'fucker', 'fucked', 'motherfucker',
  'shit', 'shitty', 'bullshit',
  'bitch', 'bastard',
  'asshole', 'dickhead', 'dick', 'cock', 'pussy', 'cunt',
  'whore', 'slut',
  'nigger', 'nigga', 'faggot', 'retard', 'retarded',
  'piece of shit', 'kill yourself', 'kys',
];

function normalizeForScan(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function containsVulgarLanguage(text) {
  if (!text || !String(text).trim()) return false;
  const normalized = normalizeForScan(text);
  if (!normalized) return false;

  for (const term of VULGAR_TERMS) {
    if (term.includes(' ')) {
      if (normalized.includes(term)) return true;
      continue;
    }
    const re = new RegExp(`\\b${term}\\b`, 'i');
    if (re.test(normalized)) return true;
  }
  return false;
}
