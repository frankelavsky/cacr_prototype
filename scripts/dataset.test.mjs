import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_RECORD_COUNT,
  buildRecords,
  readSheetRows,
  validate,
} from './lib/dataset.mjs';

const SOURCE_XLSX = fileURLToPath(
  new URL('../data/source/NLC_Survey_database_final.xlsx', import.meta.url)
);

const records = buildRecords(readSheetRows(SOURCE_XLSX));
const find = (city, state) => records.find((r) => r.city === city && r.state === state);

test('the sheet yields exactly 384 records', () => {
  assert.equal(records.length, EXPECTED_RECORD_COUNT);
});

test('validation passes and reports only the known CCG_count disagreements', () => {
  const warnings = validate(records);
  assert.equal(warnings.length, 8);
  // Every one is explained by CCG_count also counting "Yes, not currently active".
  for (const warning of warnings) {
    assert.equal(warning.countingNotActive, warning.published);
  }
});

test('city+state ids are unique even where city names repeat', () => {
  const ids = records.map((r) => r.id);
  assert.equal(new Set(ids).size, records.length);

  const athensGa = find('Athens', 'GA');
  const athensOh = find('Athens', 'OH');
  assert.notEqual(athensGa.id, athensOh.id);
  assert.equal(athensGa.ccgCount, 2);
  assert.equal(athensOh.ccgCount, 3);
});

test('spot checks match the source spreadsheet', () => {
  assert.equal(find('Alexandria', 'VA').ccgCount, 5);
  assert.equal(find('Afton', 'WY').ccgCount, 0);
});

test('missing region and population become no_response, never a real bucket', () => {
  const sanJuan = find('San Juan', 'PR');
  assert.equal(sanJuan.region, 'no_response');
  assert.equal(sanJuan.populationSize, 'no_response');
  assert.equal(sanJuan.populationIndex, -1);
  assert.equal(records.filter((r) => r.region === 'no_response').length, 3);
});

test('every record carries all five practices with the full shape', () => {
  for (const record of records) {
    for (const key of ['council', 'cabinet', 'impact', 'ombuds', 'budget']) {
      const practice = record.practices[key];
      assert.ok(practice, `${record.id} is missing ${key}`);
      assert.ok(typeof practice.status === 'string');
      assert.ok(typeof practice.mandate === 'string');
      assert.equal(typeof practice.details, 'object');
    }
  }
});

test('a blank status is preserved as no_response rather than collapsed to no', () => {
  const blanks = records.filter((r) => r.practices.council.status === 'no_response');
  assert.equal(blanks.length, 36);
  const nos = records.filter((r) => r.practices.council.status === 'no');
  assert.equal(nos.length, 85);
});
