import test from 'node:test';
import assert from 'node:assert/strict';

import { loadData, loadDashboard } from './lib/runtime.mjs';

const data = loadData();
const { filterRecords, pageCount, paginate, sortRecords } = loadDashboard();

const NO_FILTERS = { practiceCount: 'all', sizeBucket: 'all', query: '' };
const REPORTED = ['in_practice', 'in_planning', 'not_active'];

test('with no query the filter stage passes every record through', () => {
  const shown = filterRecords(data.dataset, NO_FILTERS);
  assert.equal(shown.length, data.stats.totalCities);
  assert.notEqual(shown, data.dataset, 'returns a new array rather than the input');
});

test('the map selects do not reach the table pipeline (O4)', () => {
  const shown = filterRecords(data.dataset, { practiceCount: 5, sizeBucket: 0, query: '' });
  assert.equal(shown.length, data.stats.totalCities);
});

test('the page count covers 384 rows at every offered page size', () => {
  assert.equal(pageCount(384, 30), 13);
  assert.equal(pageCount(384, 100), 4);
  assert.equal(pageCount(384, 'all'), 1);
});

test('an exact multiple does not add an empty trailing page', () => {
  assert.equal(pageCount(60, 30), 2);
  assert.equal(pageCount(100, 100), 1);
});

test('an empty result is still one page, so "Page 1 of 0" cannot happen', () => {
  assert.equal(pageCount(0, 30), 1);
  assert.equal(pageCount(0, 'all'), 1);
});

test('page one reports rows 1-30 of 384', () => {
  const view = paginate(data.dataset, 1, 30);
  assert.equal(view.rows.length, 30);
  assert.equal(view.from, 1);
  assert.equal(view.to, 30);
  assert.equal(view.total, 384);
  assert.equal(view.pageCount, 13);
});

test('the last page holds the remainder, not a full page', () => {
  const view = paginate(data.dataset, 13, 30);
  assert.equal(view.rows.length, 384 - 12 * 30);
  assert.equal(view.from, 361);
  assert.equal(view.to, 384);
});

test('every page together covers the list exactly once, in order', () => {
  const seen = [];
  for (let page = 1; page <= pageCount(data.dataset.length, 30); page += 1) {
    seen.push(...paginate(data.dataset, page, 30).rows);
  }
  assert.deepEqual(seen.map((r) => r.id), data.dataset.map((r) => r.id));
});

test('"All" is one page holding everything', () => {
  const view = paginate(data.dataset, 1, 'all');
  assert.equal(view.rows.length, 384);
  assert.equal(view.pageCount, 1);
  assert.equal(view.from, 1);
  assert.equal(view.to, 384);
});

test('a page past the end clamps to the last page rather than going blank', () => {
  const view = paginate(data.dataset, 99, 30);
  assert.equal(view.page, 13);
  assert.equal(view.rows.length, 24);
});

test('a page below one clamps to the first page', () => {
  assert.equal(paginate(data.dataset, 0, 30).page, 1);
  assert.equal(paginate(data.dataset, -5, 30).page, 1);
});

test('an empty list reports zero rows without pretending row 1 exists', () => {
  const view = paginate([], 1, 30);
  assert.deepEqual(view.rows, []);
  assert.equal(view.from, 0);
  assert.equal(view.to, 0);
  assert.equal(view.total, 0);
});

test('the sort stage is still a pass-through until Task 09', () => {
  const shown = sortRecords(data.dataset);
  assert.deepEqual(shown.map((r) => r.id), data.dataset.map((r) => r.id));
});

test('the filled-glyph count is exactly the number the Practices column shows', () => {
  data.dataset.forEach((record) => {
    const reported = Object.values(record.practices).filter((practice) =>
      REPORTED.includes(practice.status)
    ).length;
    assert.equal(reported, record.ccgCount, `${record.city}, ${record.state}`);
  });
});

test('Alexandria, VA has all five practices in place, four of them mandated', () => {
  const record = data.dataset.find((r) => r.city === 'Alexandria' && r.state === 'VA');
  assert.equal(record.ccgCount, 5);
  Object.values(record.practices).forEach((practice) => {
    assert.equal(practice.status, 'in_practice');
  });
  const mandates = Object.values(record.practices).map((p) => p.mandate);
  assert.equal(mandates.filter((m) => m === 'mandated').length, 4);
  assert.equal(mandates.filter((m) => m === 'unsure').length, 1);
});

test('Afton, WY answered "No" everywhere, and its blanks stay "no response"', () => {
  const record = data.dataset.find((r) => r.city === 'Afton' && r.state === 'WY');
  assert.equal(record.ccgCount, 0);
  Object.values(record.practices).forEach((practice) => {
    assert.equal(practice.status, 'no');
  });

  const details = Object.values(record.practices).flatMap((p) => Object.values(p.details));
  assert.ok(details.includes('no'), 'an answered "No" detail');
  assert.ok(details.includes('no_response'), 'a blank detail, kept distinct from "No" (D5)');
});

test('every value the profile renders has a label, so no cell can come out blank', () => {
  const { status, mandate, detail, detailQuestion } = data.meta.labels;
  data.dataset.forEach((record) => {
    Object.values(record.practices).forEach((practice) => {
      assert.ok(status[practice.status], practice.status);
      assert.ok(mandate[practice.mandate], practice.mandate);
      Object.entries(practice.details).forEach(([key, value]) => {
        assert.ok(detailQuestion[key], key);
        // The one free-text field arrives as an array of the respondent's own words.
        if (Array.isArray(value)) {
          assert.equal(key, 'ombuds_leadership');
          assert.ok(value.length > 0 && value.every((entry) => entry.trim() !== ''));
        } else {
          assert.ok(detail[value], value);
        }
      });
    });
  });
});
