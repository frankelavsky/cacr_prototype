import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NormalizeError,
  normalizeLeader,
  normalizeMandate,
  normalizeMultiSelect,
  normalizeStatus,
  normalizeYesNo,
  recordId,
  slugify,
} from './lib/normalize.mjs';

test('statuses map to the documented enum', () => {
  assert.equal(normalizeStatus('Yes, in practice'), 'in_practice');
  assert.equal(normalizeStatus('Yes, in planning'), 'in_planning');
  assert.equal(normalizeStatus('Yes, not currently active'), 'not_active');
  assert.equal(normalizeStatus('No'), 'no');
  assert.equal(normalizeStatus('Unsure'), 'unsure');
});

test('blank, Unsure, and No stay three different answers (D5)', () => {
  assert.equal(normalizeStatus(''), 'no_response');
  assert.equal(normalizeStatus('   '), 'no_response');
  assert.notEqual(normalizeStatus(''), normalizeStatus('No'));
  assert.notEqual(normalizeStatus(''), normalizeStatus('Unsure'));
  assert.equal(normalizeMandate(''), 'no_response');
  assert.equal(normalizeYesNo(''), 'no_response');
  assert.equal(normalizeLeader(''), 'no_response');
});

test('mandate values map to the documented enum', () => {
  assert.equal(normalizeMandate('Mandated'), 'mandated');
  assert.equal(normalizeMandate('Not mandated'), 'not_mandated');
  assert.equal(normalizeMandate('Unsure'), 'unsure');
});

test('the budget detail columns accept the mandate label set as yes/no', () => {
  assert.equal(normalizeYesNo('Yes'), 'yes');
  assert.equal(normalizeYesNo('No'), 'no');
  assert.equal(normalizeYesNo('Mandated'), 'yes');
  assert.equal(normalizeYesNo('Not mandated'), 'no');
});

test('an unexpected value fails loudly and names where it came from', () => {
  assert.throws(
    () => normalizeStatus('Maybe', 'row 12, column "budget"'),
    (error) =>
      error instanceof NormalizeError &&
      error.message.includes('Maybe') &&
      error.message.includes('row 12')
  );
});

test('multi-select text splits, trims, and drops empties', () => {
  assert.deepEqual(normalizeMultiSelect(', Other'), ['Other']);
  assert.deepEqual(normalizeMultiSelect('Other, Other'), ['Other']);
  assert.deepEqual(normalizeMultiSelect('Dept of Youth & Family, Dept of Human Services'), [
    'Dept of Youth & Family',
    'Dept of Human Services',
  ]);
  assert.equal(normalizeMultiSelect(''), 'no_response');
  assert.equal(normalizeMultiSelect(' , '), 'no_response');
});

test('record ids key on city AND state (D6)', () => {
  assert.equal(recordId('Athens', 'GA'), 'athens--ga');
  assert.notEqual(recordId('Athens', 'GA'), recordId('Athens', 'OH'));
  assert.equal(slugify('Cañon City'), 'canon-city');
  assert.equal(slugify("St. Mary's"), 'st-mary-s');
});
