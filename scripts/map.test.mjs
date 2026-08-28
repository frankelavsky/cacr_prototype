import test from 'node:test';
import assert from 'node:assert/strict';

import { loadData, loadDashboard } from './lib/runtime.mjs';

const data = loadData();
const { MAP1_ANNOTATIONS, applyMapFilters, bubbleRadius, countColor } = loadDashboard();

const ALL = { practiceCount: 'all', sizeBucket: 'all', query: '' };

function filters(overrides) {
  return Object.assign({}, ALL, overrides);
}

test('bubble radius grows with the population bucket', () => {
  const radii = [0, 1, 2, 3].map(bubbleRadius);
  assert.deepEqual(radii, [...radii].sort((a, b) => a - b));
  assert.equal(new Set(radii).size, 4);
});

test('a city that reported no population size still gets a radius', () => {
  assert.equal(bubbleRadius(-1), bubbleRadius(0));
  assert.equal(bubbleRadius(undefined), bubbleRadius(0));
});

test('every practice count 0-5 has its own colour', () => {
  const colors = [0, 1, 2, 3, 4, 5].map(countColor);
  assert.equal(new Set(colors).size, 6);
  colors.forEach((color) => assert.match(color, /^#[0-9a-f]{6}$/));
});

test('the ramp darkens as the practice count rises', () => {
  const luminance = (hex) => {
    const channels = [1, 3, 5]
      .map((i) => parseInt(hex.substr(i, 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const steps = [0, 1, 2, 3, 4, 5].map((count) => luminance(countColor(count)));
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i] < steps[i - 1], `step ${i} is darker than step ${i - 1}`);
  }
});

test('no filters keeps every record', () => {
  assert.equal(applyMapFilters(data.dataset, ALL).length, data.stats.totalCities);
});

test('the practice-count filter matches the published distribution', () => {
  for (const [count, expected] of Object.entries(data.stats.byCcgCount)) {
    const shown = applyMapFilters(data.dataset, filters({ practiceCount: Number(count) }));
    assert.equal(shown.length, expected, `${count} practices`);
  }
});

test('the population filter matches the published distribution', () => {
  data.meta.populationBuckets.forEach((bucket, index) => {
    const shown = applyMapFilters(data.dataset, filters({ sizeBucket: index }));
    assert.equal(shown.length, data.stats.byPopulation[bucket], bucket);
  });
});

test('filters combine with AND', () => {
  const shown = applyMapFilters(data.dataset, filters({ practiceCount: 5, sizeBucket: 0 }));
  const expected = data.dataset.filter((r) => r.ccgCount === 5 && r.populationIndex === 0);
  assert.equal(shown.length, expected.length);
  assert.ok(shown.length > 0);
  shown.forEach((record) => {
    assert.equal(record.ccgCount, 5);
    assert.equal(record.populationSize, '<10,000');
  });
});

test('a combination with no cities returns an empty array, not everything', () => {
  const shown = applyMapFilters(data.dataset, filters({ practiceCount: 5, query: 'zzzz' }));
  assert.deepEqual(shown, []);
});

test('the query matches on city and on state, and ignores case and padding', () => {
  const byCity = applyMapFilters(data.dataset, filters({ query: '  MADISON ' }));
  assert.equal(byCity.length, 1);
  assert.equal(byCity[0].state, 'WI');

  // Task 09 widened this to the full state name as well, so "ak" also reaches the
  // Dakotas — the search matches city, USPS code and state name in one string.
  const byState = applyMapFilters(data.dataset, filters({ query: 'ak' }));
  assert.ok(
    byState.every((r) => `${r.city} ${r.state} ${r.stateName}`.toLowerCase().includes('ak'))
  );
  assert.ok(byState.some((r) => r.city === 'Coffman Cove'));
});

test('both Map 1 annotations name a real record whose stated facts are true', () => {
  const claims = {
    'Coffman Cove': { state: 'AK', ccgCount: 5, populationSize: '<10,000' },
    Madison: { state: 'WI', ccgCount: 1, populationSize: '>200,000' }
  };

  assert.equal(MAP1_ANNOTATIONS.length, 2);
  MAP1_ANNOTATIONS.forEach((annotation) => {
    const record = data.dataset.find(
      (r) => r.city === annotation.city && r.state === annotation.state
    );
    assert.ok(record, `${annotation.city}, ${annotation.state} is in the dataset`);
    assert.ok(record.x !== null && record.y !== null, 'the annotated city is on the map');

    const claim = claims[annotation.city];
    assert.equal(record.state, claim.state);
    assert.equal(record.ccgCount, claim.ccgCount);
    assert.equal(record.populationSize, claim.populationSize);
  });
});

test('no city bubble sits inside either annotation label box', () => {
  const { width, height } = data.basemap;
  MAP1_ANNOTATIONS.forEach((annotation) => {
    const left = (annotation.label.left / 100) * width;
    const right = left + (annotation.label.width / 100) * width;
    const top = (annotation.label.top / 100) * height;
    // Five lines of 13px text on a ~930px-wide map, converted back to viewBox units.
    const bottom = top + 80;

    const covered = data.dataset.filter(
      (r) => r.x !== null && r.x >= left && r.x <= right && r.y >= top && r.y <= bottom
    );
    assert.deepEqual(covered.map((r) => `${r.city}, ${r.state}`), [], annotation.city);
  });
});

test('each annotation ring encloses exactly the city it points at', () => {
  const RING_RADIUS = 13;
  MAP1_ANNOTATIONS.forEach((annotation) => {
    const target = data.dataset.find(
      (r) => r.city === annotation.city && r.state === annotation.state
    );
    const enclosed = data.dataset.filter(
      (r) => r.x !== null && Math.hypot(r.x - target.x, r.y - target.y) <= RING_RADIUS
    );
    assert.deepEqual(enclosed.map((r) => `${r.city}, ${r.state}`), [
      `${annotation.city}, ${annotation.state}`
    ]);
  });
});

test('every city with coordinates lands inside the basemap viewBox', () => {
  const plotted = data.dataset.filter((r) => r.x !== null);
  assert.equal(plotted.length, data.stats.citiesOnMap);
  plotted.forEach((r) => {
    assert.ok(r.x >= 0 && r.x <= data.basemap.width, `${r.city} x`);
    assert.ok(r.y >= 0 && r.y <= data.basemap.height, `${r.city} y`);
  });
});
