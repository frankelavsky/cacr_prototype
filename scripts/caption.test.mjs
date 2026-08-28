import test from 'node:test';
import assert from 'node:assert/strict';

import { loadData, loadDashboard } from './lib/runtime.mjs';

const data = loadData();
const { applyMapFilters, mapCaption } = loadDashboard();
const BUCKETS = data.meta.populationBuckets;

function filters(overrides) {
  return Object.assign({ practiceCount: 'all', sizeBucket: 'all', query: '' }, overrides);
}

function captionFor(overrides) {
  const active = filters(overrides);
  return mapCaption(active, applyMapFilters(data.dataset, active), data.stats, BUCKETS);
}

// Every pair the two selects can produce, plus searches that reach the branches the
// selects cannot: a single region, a blank region answer, and no match at all.
function eachFilterCombination(check) {
  ['all', 0, 1, 2, 3, 4, 5].forEach((practiceCount) => {
    ['all', 0, 1, 2, 3].forEach((sizeBucket) => {
      check(filters({ practiceCount, sizeBucket }));
    });
  });
  ['ohio', 'maine', 'gloucester', 'athens', 'tx', 'zzzz'].forEach((query) => {
    check(filters({ query }));
  });
}

test('the unfiltered view gets the overview sentence and the headline distribution', () => {
  const caption = captionFor({});
  assert.match(caption, /^Showing all 384 surveyed cities\./);
  assert.match(caption, /most common answer is 1 practice \(111 cities\)/);
  assert.match(caption, /78 report none of the five and 22 report all five/);
});

test('the unfiltered view says which cities are not plotted', () => {
  assert.match(
    captionFor({}),
    /2 of them are not on the map — San Juan, PR and Utuado, PR fall outside/
  );
});

test('a practice-count filter names the count and pairs it with the total', () => {
  assert.match(
    captionFor({ practiceCount: 3 }),
    /^Showing 47 of 384 surveyed cities: cities with 3 child-centered governance practices, all sizes\./
  );
});

test('zero practices reads as "none of the five", not as the digit alone', () => {
  const caption = captionFor({ practiceCount: 0 });
  assert.match(caption, /cities with none of the five child-centered governance practices/);
  assert.match(caption, /^Showing 78 of 384/);
});

test('one practice is singular', () => {
  assert.match(captionFor({ practiceCount: 1 }), /cities with 1 child-centered governance practice,/);
});

test('a population filter names the bucket and leaves the practice side open', () => {
  assert.match(
    captionFor({ sizeBucket: 3 }),
    /^Showing 69 of 384 surveyed cities: cities with any number of child-centered governance practices, population >200,000\./
  );
});

test('every single-value filter produces a caption whose count matches the filter', () => {
  const cases = [
    ...[0, 1, 2, 3, 4, 5].map((practiceCount) => ({ practiceCount })),
    ...[0, 1, 2, 3].map((sizeBucket) => ({ sizeBucket }))
  ];

  cases.forEach((overrides) => {
    const active = filters(overrides);
    const shown = applyMapFilters(data.dataset, active);
    const plotted = shown.filter((r) => r.x !== null).length;
    assert.match(
      mapCaption(active, shown, data.stats, BUCKETS),
      new RegExp(`^Showing ${plotted} of 384 surveyed cities`),
      JSON.stringify(overrides)
    );
  });
});

test('a combined filter states both halves and one observation', () => {
  const caption = captionFor({ practiceCount: 5, sizeBucket: 0 });
  assert.match(caption, /cities with 5 child-centered governance practices, population <10,000\./);
  assert.match(caption, /Both are in the West\./);
});

test('a search term is quoted and added to the filter phrase', () => {
  assert.match(captionFor({ query: 'coffman' }), /matching “coffman”/);
});

test('a single result is named, city and state', () => {
  assert.match(captionFor({ query: 'coffman' }), /The only one is Coffman Cove, AK\./);
});

test('the empty case names the filters and says what to do', () => {
  const caption = captionFor({ practiceCount: 5, query: 'zzzz' });
  assert.equal(
    caption,
    'No surveyed cities match: 5 child-centered governance practices, all sizes, ' +
      'matching “zzzz”. Try removing a filter.'
  );
});

test('matches that cannot be plotted are explained instead of silently dropped', () => {
  const caption = captionFor({ query: 'san juan' });
  assert.match(caption, /^Showing 0 of 384 surveyed cities/);
  assert.match(caption, /1 of them is not on the map — San Juan, PR falls outside/);
  // The unplotted sentence already named it; the observation would only repeat it.
  assert.doesNotMatch(caption, /The only one is/);
});

test('a tie is shown as a tie, not resolved into a winner', () => {
  // The South and the West both hold 16 of these 47. Naming one of them was a coin flip
  // decided by alphabetical order, and the caption stated it as fact.
  const caption = captionFor({ practiceCount: 3 });
  assert.match(
    caption,
    /By region: 16 in the South, 16 in the West, 10 in the Midwest and 5 in the Northeast\/Mid-Atlantic\./
  );
  assert.doesNotMatch(caption, /most common region/);
  assert.doesNotMatch(caption, /Most are in/);
});

test('every tied filter states both counts rather than picking a side', () => {
  [
    { overrides: { practiceCount: 1, sizeBucket: 3 }, tied: /5 in the Midwest, 5 in the West/ },
    { overrides: { practiceCount: 3, sizeBucket: 2 }, tied: /5 in the Midwest, 5 in the West/ },
    { overrides: { practiceCount: 3, sizeBucket: 0 }, tied: /2 in the Northeast\/Mid-Atlantic, 2 in the South/ },
    { overrides: { practiceCount: 5, sizeBucket: 1 }, tied: /1 in the Northeast\/Mid-Atlantic and 1 in the South/ }
  ].forEach(({ overrides, tied }) => {
    assert.match(captionFor(overrides), tied, JSON.stringify(overrides));
  });
});

test('"no response" is never phrased as a region, and never leads the list', () => {
  // Maine matches New Gloucester, ME, which left the region question blank.
  const caption = captionFor({ query: 'maine' });
  assert.match(caption, /1 in the Northeast\/Mid-Atlantic and 1 with no region reported\./);
  assert.doesNotMatch(caption, /in the no region reported/);
});

test('a set that sits in one region still gets the "all of them" sentence', () => {
  assert.match(captionFor({ query: 'ohio' }), /All 15 are in the Midwest\./);
  assert.match(captionFor({ practiceCount: 5, sizeBucket: 0 }), /Both are in the West\./);
});

test('the region observation is deterministic for the same filtered set', () => {
  const active = filters({ practiceCount: 2 });
  const shown = applyMapFilters(data.dataset, active);
  const once = mapCaption(active, shown, data.stats, BUCKETS);
  const twice = mapCaption(active, [...shown].reverse(), data.stats, BUCKETS);
  assert.equal(once, twice);
});

test('every caption is one or more complete sentences, with digits for numbers', () => {
  const samples = [{}, { practiceCount: 0 }, { sizeBucket: 2 }, { practiceCount: 4, sizeBucket: 3 }, { query: 'zzzz' }];
  samples.forEach((overrides) => {
    const caption = captionFor(overrides);
    assert.match(caption, /\.$/, JSON.stringify(overrides));
    assert.doesNotMatch(caption, /\bundefined\b|\bNaN\b|\[object/, JSON.stringify(overrides));
  });
});

test('the observation counts the same set the headline counts', () => {
  let checked = 0;

  eachFilterCombination((active) => {
    const shown = applyMapFilters(data.dataset, active);
    const plotted = shown.filter((record) => typeof record.x === 'number').length;
    const caption = mapCaption(active, shown, data.stats, BUCKETS);
    const spread = caption.match(/By region: (.+)\.$/);
    if (!spread) return;

    const counted = spread[1]
      .match(/\b\d+ (?:in the|with)/g)
      .reduce((total, part) => total + Number(part.match(/\d+/)[0]), 0);

    assert.equal(counted, plotted, caption);
    checked += 1;
  });

  // Guards the sweep from passing because nothing reached the spread branch at all.
  assert.equal(checked, 35);
});

test('no filter combination reaches a winner claim or a placeholder', () => {
  eachFilterCombination((active) => {
    const caption = mapCaption(active, applyMapFilters(data.dataset, active), data.stats, BUCKETS);

    assert.doesNotMatch(caption, /most common region/, JSON.stringify(active));
    assert.doesNotMatch(caption, /in the no region reported/, JSON.stringify(active));
    assert.doesNotMatch(caption, /\bundefined\b|\bNaN\b|\[object/, JSON.stringify(active));
    assert.match(caption, /\.$/, JSON.stringify(active));
  });
});
