import bcrypt from 'bcryptjs';

export const hashPassword = (plain) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export const MIN_PASSWORD_LENGTH = 12;

// S10: composition rules push people toward "Password1!", so length carries the
// weight here and the rest is about rejecting the passwords that actually get
// guessed first. A full strength estimator (zxcvbn) would be better still, but
// this needs no dependency and blocks the realistic attacks.
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  'qwerty', 'qwerty123', 'qwertyuiop', '123456', '1234567', '12345678',
  '123456789', '1234567890', 'letmein', 'welcome', 'welcome1', 'admin',
  'administrator', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball',
  'sunshine', 'princess', 'abc123', 'abcd1234', 'changeme', 'secret',
  'trustno1', 'master', 'login', 'starwars', 'whatever', 'zaq12wsx',
  'taskmanagement', 'tasksystem',
]);

const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function hasLongRun(pw) {
  // "aaaa" or "1111" — four or more of the same character.
  return /(.)\1{3,}/.test(pw);
}

function hasLongSequence(pw) {
  const lower = pw.toLowerCase();
  for (const seq of SEQUENCES) {
    for (let i = 0; i + 5 <= seq.length; i += 1) {
      const run = seq.slice(i, i + 5);
      if (lower.includes(run) || lower.includes([...run].reverse().join(''))) return true;
    }
  }
  return false;
}

/**
 * Returns null when acceptable, otherwise a message explaining the rejection.
 * `email` is optional; when supplied, the local part may not appear in the password.
 */
export function checkPasswordStrength(pw, email) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (pw.length > 200) return 'Password is too long.';

  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common. Choose something less predictable.';
  for (const common of COMMON) {
    if (common.length >= 6 && lower.includes(common)) {
      return 'That password contains a very common word. Choose something less predictable.';
    }
  }
  if (hasLongRun(pw)) return 'Avoid repeating the same character several times in a row.';
  if (hasLongSequence(pw)) return 'Avoid straight keyboard or alphabet sequences.';

  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 3 && lower.includes(local)) {
    return 'Password must not contain your email address.';
  }
  return null;
}

/** Boolean form, kept for call sites that only need a yes/no. */
export function isStrongPassword(pw, email) {
  return checkPasswordStrength(pw, email) === null;
}
