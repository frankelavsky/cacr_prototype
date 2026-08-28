import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import {
  buildCityLookupList,
  indexByPlaceKey,
  matchPlace,
  normalizePlaceName,
  parseGazetteer,
  stripTypeSuffix,
  toDisplayName,
} from './lib/gazetteer.mjs';

import { buildRecords, readSheetRows } from './lib/dataset.mjs';

const SOURCE_XLSX = fileURLToPath(
  new URL('../data/source/NLC_Survey_database_final.xlsx', import.meta.url)
);

const GAZETTEER = fileURLToPath(
  new URL('../data/source/2025_Gaz_place_national.txt', import.meta.url)
);

const places = parseGazetteer(GAZETTEER);
const index = indexByPlaceKey(places);

test('the gazetteer parses despite the vintage delimiter change', () => {
  assert.ok(places.length > 30000, `expected >30000 places, got ${places.length}`);
  const boston = places.find((place) => place.state === 'MA' && place.name === 'Boston city');
  assert.ok(boston);
  assert.ok(Math.abs(boston.lat - 42.3) < 0.5, `lat was ${boston.lat}`);
  assert.ok(Math.abs(boston.lon - -71.06) < 0.5, `lon was ${boston.lon}`);
});

test('name normalization is case, punctuation, and abbreviation insensitive', () => {
  assert.equal(normalizePlaceName('St. Louis'), 'saint louis');
  assert.equal(normalizePlaceName('Saint Louis'), 'saint louis');
  assert.equal(normalizePlaceName('Ft. Worth'), 'fort worth');
  assert.equal(normalizePlaceName('Mt. Vernon'), 'mount vernon');
  assert.equal(normalizePlaceName("Coeur d'Alene"), 'coeur dalene');
  assert.equal(normalizePlaceName('Winston-Salem'), 'winston salem');
});

test('type suffixes are stripped from Census names but never from survey names', () => {
  assert.equal(stripTypeSuffix(normalizePlaceName('Athens city')), 'athens');
  assert.equal(stripTypeSuffix(normalizePlaceName('Princeton CDP')), 'princeton');
  assert.equal(stripTypeSuffix(normalizePlaceName('San Juan zona urbana')), 'san juan');
  // A survey name is normalized only — "Kansas City" must not collapse to "Kansas".
  assert.equal(normalizePlaceName('Kansas City'), 'kansas city');
  assert.equal(normalizePlaceName('Redwood City'), 'redwood city');
});

test('a city whose real name ends in "City" still matches', () => {
  for (const [city, state] of [
    ['Kansas City', 'MO'],
    ['Oklahoma City', 'OK'],
    ['Salt Lake City', 'UT'],
    ['Redwood City', 'CA'],
    ['Rapid City', 'SD'],
  ]) {
    const match = matchPlace(index, city, state);
    assert.ok(match.place, `${city}, ${state} should match`);
    assert.equal(match.place.state, state);
  }
});

test('St. and Saint spellings both resolve to the same place', () => {
  const abbreviated = matchPlace(index, 'St. Louis', 'MO');
  const spelledOut = matchPlace(index, 'Saint Louis', 'MO');
  assert.ok(abbreviated.place);
  assert.equal(abbreviated.place.geoid, spelledOut.place.geoid);
});

test('an incorporated place beats a CDP of the same name in the same state', () => {
  const match = matchPlace(index, 'Boston', 'MA');
  assert.ok(match.place.isIncorporated);
});

test('genuine ambiguity is refused rather than guessed', () => {
  const match = matchPlace(index, 'Oakwood', 'OH');
  assert.equal(match.place, null);
  assert.match(match.reason, /ambiguous/);
});

test('a name absent from the state is refused rather than matched elsewhere', () => {
  const match = matchPlace(index, 'Nashville', 'TN');
  assert.equal(match.place, null);
  assert.match(match.reason, /no gazetteer place/);
});

test('the lookup list is grouped by state with clean display names', () => {
  const grouped = buildCityLookupList(places);
  const total = Object.values(grouped).reduce((sum, names) => sum + names.length, 0);
  assert.ok(total > 25000, `expected >25000 places, got ${total}`);

  assert.equal(toDisplayName('Princeton CDP'), 'Princeton');
  assert.equal(toDisplayName('Boise City city'), 'Boise City');
  assert.equal(
    toDisplayName('Athens-Clarke County unified government (balance)'),
    'Athens-Clarke County'
  );

  // One place per region that is NOT a survey respondent — this is the whole point of the
  // fallback: a visitor's city should be findable even when it did not take the survey.
  const surveyed = new Set(
    buildRecords(readSheetRows(SOURCE_XLSX)).map((record) => `${record.city}|${record.state}`)
  );
  const notSurveyed = [
    ['Montpelier', 'VT', 'Northeast/Mid-Atlantic'],
    ['Tupelo', 'MS', 'South'],
    ['Minot', 'ND', 'Midwest'],
    ['Butte-Silver Bow', 'MT', 'West'],
  ];
  for (const [name, state, region] of notSurveyed) {
    assert.ok(grouped[state].includes(name), `${name}, ${state} missing from the lookup (${region})`);
    assert.ok(!surveyed.has(`${name}|${state}`), `${name}, ${state} is a survey city, pick another`);
  }
});
