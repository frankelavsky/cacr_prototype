import test from 'node:test';
import assert from 'node:assert/strict';

import { loadData, loadDashboard } from './lib/runtime.mjs';

const data = loadData();
const { applyMapFilters, createStore, populationOptions, practiceCountOptions } = loadDashboard();

test('the practice-count options are All plus every count present in the data', () => {
  const options = practiceCountOptions(data.stats);
  assert.deepEqual(
    options.map((o) => o.value),
    ['all', '0', '1', '2', '3', '4', '5']
  );
  assert.equal(options[0].label, 'All (384 cities)');
});

test('practice-count option labels carry the counts from stats, not literals', () => {
  const doubled = {
    totalCities: 8,
    byCcgCount: { 0: 5, 1: 3 }
  };
  assert.deepEqual(
    practiceCountOptions(doubled).map((o) => o.label),
    ['All (8 cities)', '0 (5 cities)', '1 (3 cities)']
  );
});

test('every practice-count option label states the number that filter will show', () => {
  practiceCountOptions(data.stats).forEach((option) => {
    const shown = applyMapFilters(data.dataset, {
      practiceCount: option.value === 'all' ? 'all' : Number(option.value),
      sizeBucket: 'all',
      query: ''
    });
    assert.ok(option.label.includes(`${shown.length} cities`), option.label);
  });
});

test('the population options are All sizes plus the four buckets, labelled from meta', () => {
  const options = populationOptions(data.meta, data.stats);
  assert.deepEqual(
    options.map((o) => o.value),
    ['all', '0', '1', '2', '3']
  );
  data.meta.populationBuckets.forEach((bucket, index) => {
    assert.ok(options[index + 1].label.startsWith(bucket), options[index + 1].label);
  });
});

test('every population option label states the number that filter will show', () => {
  populationOptions(data.meta, data.stats)
    .slice(1)
    .forEach((option) => {
      const shown = applyMapFilters(data.dataset, {
        practiceCount: 'all',
        sizeBucket: Number(option.value),
        query: ''
      });
      assert.ok(option.label.includes(`${shown.length} cities`), option.label);
    });
});

test('a count of one reads as "1 city"', () => {
  const labels = practiceCountOptions({ totalCities: 1, byCcgCount: { 2: 1 } }).map((o) => o.label);
  assert.deepEqual(labels, ['All (1 city)', '2 (1 city)']);
});

test('the store merges partial updates and leaves the rest alone', () => {
  const store = createStore({ practiceCount: 'all', sizeBucket: 'all', query: '' });
  store.set({ practiceCount: 3 });
  assert.deepEqual(store.get(), { practiceCount: 3, sizeBucket: 'all', query: '' });

  store.set({ query: 'akron' });
  assert.deepEqual(store.get(), { practiceCount: 3, sizeBucket: 'all', query: 'akron' });
});

test('every subscriber is called with the whole state on every set', () => {
  const store = createStore({ practiceCount: 'all', sizeBucket: 'all', query: '' });
  const seen = [];
  store.subscribe((s) => seen.push(s));
  store.subscribe((s) => seen.push(s));

  store.set({ sizeBucket: 2 });
  assert.equal(seen.length, 2);
  seen.forEach((s) => assert.deepEqual(s, { practiceCount: 'all', sizeBucket: 2, query: '' }));
});

test('the store never mutates the object a subscriber already received', () => {
  const store = createStore({ practiceCount: 'all', sizeBucket: 'all', query: '' });
  let first = null;
  store.subscribe((s) => {
    if (!first) first = s;
  });

  store.set({ practiceCount: 1 });
  store.set({ practiceCount: 4 });
  assert.equal(first.practiceCount, 1);
});

test('reset returns the map to every city without touching the search query', () => {
  const store = createStore({ practiceCount: 5, sizeBucket: 0, query: 'ohio' });
  store.set({ practiceCount: 'all', sizeBucket: 'all' });
  assert.deepEqual(store.get(), { practiceCount: 'all', sizeBucket: 'all', query: 'ohio' });
});

test('three hand-checked control combinations show the counts computed independently', () => {
  const combos = [
    { practiceCount: 5, sizeBucket: 'all' },
    { practiceCount: 'all', sizeBucket: 3 },
    { practiceCount: 1, sizeBucket: 1 }
  ];

  combos.forEach((combo) => {
    const shown = applyMapFilters(data.dataset, Object.assign({ query: '' }, combo));
    const expected = data.dataset.filter(
      (r) =>
        (combo.practiceCount === 'all' || r.ccgCount === combo.practiceCount) &&
        (combo.sizeBucket === 'all' || r.populationIndex === combo.sizeBucket)
    );
    assert.equal(shown.length, expected.length, JSON.stringify(combo));
  });

  assert.equal(applyMapFilters(data.dataset, { practiceCount: 5, sizeBucket: 'all', query: '' }).length, 22);
  assert.equal(applyMapFilters(data.dataset, { practiceCount: 'all', sizeBucket: 3, query: '' }).length, 69);
  assert.equal(
    applyMapFilters(data.dataset, { practiceCount: 1, sizeBucket: 1, query: '' }).length,
    data.stats.byPopulationAndCcgCount['10,001-50,000']['1']
  );
});

test('the three cities that reported no population size only appear under All sizes', () => {
  const unsized = data.dataset.filter((r) => r.populationIndex === -1);
  assert.equal(unsized.length, 3);

  const perBucket = [0, 1, 2, 3].flatMap((index) =>
    applyMapFilters(data.dataset, { practiceCount: 'all', sizeBucket: index, query: '' })
  );
  unsized.forEach((record) => assert.ok(!perBucket.includes(record), record.city));
  assert.equal(perBucket.length, data.stats.totalCities - 3);
});
