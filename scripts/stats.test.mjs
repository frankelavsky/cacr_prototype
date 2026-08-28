import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { buildRecords, readSheetRows } from './lib/dataset.mjs';
import { buildStats } from './lib/stats.mjs';
import { serializeDataFile } from './lib/serialize.mjs';

const SOURCE_XLSX = fileURLToPath(
  new URL('../data/source/NLC_Survey_database_final.xlsx', import.meta.url)
);

const records = buildRecords(readSheetRows(SOURCE_XLSX));
const stats = buildStats(records);

test('cities per practice count match the hand-checked distribution', () => {
  assert.deepEqual(stats.byCcgCount, { 0: 78, 1: 111, 2: 86, 3: 47, 4: 40, 5: 22 });
  const total = Object.values(stats.byCcgCount).reduce((sum, n) => sum + n, 0);
  assert.equal(total, stats.totalCities);
  assert.equal(stats.totalCities, 384);
});

test('population buckets match the hand-checked distribution', () => {
  assert.equal(stats.byPopulation['<10,000'], 61);
  assert.equal(stats.byPopulation['10,001-50,000'], 142);
  assert.equal(stats.byPopulation['50,001-200,000'], 109);
  assert.equal(stats.byPopulation['>200,000'], 69);
  assert.equal(stats.byPopulation.no_response, 3);
});

test('region counts match the source and keep blanks separate', () => {
  assert.equal(stats.byRegion.South, 154);
  assert.equal(stats.byRegion.West, 118);
  assert.equal(stats.byRegion.Midwest, 80);
  assert.equal(stats.byRegion['Northeast/Mid-Atlantic'], 29);
  assert.equal(stats.byRegion.no_response, 3);
});

test('per-practice counts match the source columns', () => {
  assert.equal(stats.byPractice.council.inPractice, 230);
  assert.equal(stats.byPractice.council.inPlanning, 22);
  assert.equal(stats.byPractice.cabinet.inPractice, 102);
  assert.equal(stats.byPractice.budget.notActive, 8);
  assert.equal(stats.byPractice.ombuds.inPractice, 67);
});

test('the population x practice-count grid sums back to the totals', () => {
  for (const [bucket, byCount] of Object.entries(stats.byPopulationAndCcgCount)) {
    const total = Object.values(byCount).reduce((sum, n) => sum + n, 0);
    assert.equal(total, stats.byPopulation[bucket], `bucket ${bucket}`);
  }
});

test('percentages are consistent with their counts', () => {
  assert.equal(stats.citiesWithNoPractices, 78);
  assert.equal(stats.citiesWithNoPractices_pct, 20.3);
  assert.equal(stats.citiesWithAllPractices, 22);
});

test('the generated file is byte-identical for identical input', () => {
  const once = serializeDataFile({ dataset: records, stats }, 'scripts/build-data.mjs');
  const twice = serializeDataFile({ dataset: buildRecords(readSheetRows(SOURCE_XLSX)), stats }, 'scripts/build-data.mjs');
  assert.equal(once, twice);
});
