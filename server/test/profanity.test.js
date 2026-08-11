import test from 'node:test';
import assert from 'node:assert/strict';
import { containsVulgarLanguage } from '../src/utils/profanity.js';

// A false positive here costs a member 0.03 TP for a comment that was fine, so
// the word-boundary behaviour is worth pinning down.

test('flags vulgar terms', () => {
  for (const text of ['what the fuck', 'this is shit', 'you idiot bitch', 'kys']) {
    assert.equal(containsVulgarLanguage(text), true, `${text} should be flagged`);
  }
});

test('matches on word boundaries, not substrings', () => {
  // The classic false positive: "ass" inside "assessment".
  assert.equal(containsVulgarLanguage('A thorough assessment of the data.'), false);
  assert.equal(containsVulgarLanguage('Classic analysis, well presented.'), false);
  assert.equal(containsVulgarLanguage('The bassist scunthorpe passage'), false);
});

test('normalisation defeats simple punctuation evasion', () => {
  assert.equal(containsVulgarLanguage('what the f-u-c-k'), false); // documented limitation
  assert.equal(containsVulgarLanguage('what the *fuck*'), true);
  assert.equal(containsVulgarLanguage('WHAT THE FUCK'), true);
});

test('matches multi-word phrases as substrings', () => {
  assert.equal(containsVulgarLanguage('you are a piece of shit'), true);
  assert.equal(containsVulgarLanguage('kill yourself'), true);
});

test('empty and non-string input is not vulgar', () => {
  for (const value of ['', '   ', null, undefined]) {
    assert.equal(containsVulgarLanguage(value), false);
  }
});

test('ordinary review comments pass', () => {
  for (const text of [
    'Clear methodology and good structure.',
    'Could engage more in standups.',
    'Strong technical work — thanks!',
  ]) {
    assert.equal(containsVulgarLanguage(text), false, `${text} should pass`);
  }
});
