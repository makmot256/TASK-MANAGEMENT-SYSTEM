import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPasswordStrength, isStrongPassword, MIN_PASSWORD_LENGTH } from '../src/utils/password.js';

// S10. Pure function, no database — the cheapest useful tests in the project.

test('rejects anything under the minimum length', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  for (const pw of ['', 'a', 'Password1', 'Short1!', 'elevenchar1']) {
    assert.match(checkPasswordStrength(pw), /at least 12 characters/);
  }
});

test('rejects the passwords that actually get guessed', () => {
  for (const pw of ['password1234', 'Password12345', 'letmein12345', 'qwerty123456']) {
    assert.notEqual(checkPasswordStrength(pw), null, `${pw} should be rejected`);
  }
});

test('rejects long runs of one character', () => {
  assert.match(checkPasswordStrength('greenaaaacircle'), /repeating the same character/);
});

test('rejects straight keyboard and alphabet sequences', () => {
  assert.match(checkPasswordStrength('marbleabcdefgate'), /sequences/);
  assert.match(checkPasswordStrength('marble12345gate'), /sequences/);
});

test('rejects a password containing the email local part', () => {
  assert.match(
    checkPasswordStrength('grace-winter-marble', 'grace@tms.local'),
    /must not contain your email/
  );
  // The same password is fine for a different account.
  assert.equal(checkPasswordStrength('grace-winter-marble', 'brian@tms.local'), null);
});

test('accepts a reasonable passphrase', () => {
  for (const pw of ['Autumn-Copper-Lantern-4', 'winter marble gate 77', 'Quiet.River.Stones.9']) {
    assert.equal(checkPasswordStrength(pw, 'someone@tms.local'), null, `${pw} should be accepted`);
  }
});

test('isStrongPassword mirrors checkPasswordStrength', () => {
  assert.equal(isStrongPassword('Password1'), false);
  assert.equal(isStrongPassword('Autumn-Copper-Lantern-4'), true);
});

test('a short local part does not veto everything', () => {
  // A two-character local part would otherwise match almost any password.
  assert.equal(checkPasswordStrength('Quiet.River.Stones.9', 'jo@tms.local'), null);
});
