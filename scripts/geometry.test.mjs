import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { buildRecords, readSheetRows } from './lib/dataset.mjs';
import { parseGazetteer } from './lib/gazetteer.mjs';
import { geocodeRecords, readOverrides } from './lib/geocode.mjs';
import {
  VIEWBOX_HEIGHT,
  VIEWBOX_WIDTH,
  buildBasemap,
  createProjection,
  isInsideViewBox,
  projectPoint,
} from './lib/geometry.mjs';

const url = (path) => fileURLToPath(new URL(path, import.meta.url));

const records = buildRecords(readSheetRows(url('../data/source/NLC_Survey_database_final.xlsx')));
const places = parseGazetteer(url('../data/source/2025_Gaz_place_national.txt'));
const overrides = readOverrides(url('../data/source/geo-overrides.json'));
const report = geocodeRecords(records, places, overrides);

const find = (city, state) => records.find((r) => r.city === city && r.state === state);

test('every city resolves — no unresolved names left for the overrides file', () => {
  const { exact, incorporated, override } = report.methodCounts;
  assert.equal(exact + incorporated + override, records.length);
  assert.equal(override, 5);
});

test('382 of 384 cities are placed; the 2 exceptions are the documented Puerto Rico ones', () => {
  const placed = records.filter((record) => record.x !== null);
  const unplaced = records.filter((record) => record.x === null);
  assert.equal(placed.length, 382);
  assert.deepEqual(
    unplaced.map((record) => `${record.city}, ${record.state}`).sort(),
    ['San Juan, PR', 'Utuado, PR']
  );
  // Unplaced still means "not on the map", never "not in the data".
  assert.equal(records.length, 384);
});

test('every placed city lands inside the 975x610 viewBox', () => {
  for (const record of records) {
    if (record.x === null) continue;
    assert.ok(
      isInsideViewBox(record),
      `${record.city}, ${record.state} at (${record.x}, ${record.y})`
    );
    assert.ok(record.x >= 0 && record.x <= VIEWBOX_WIDTH);
    assert.ok(record.y >= 0 && record.y <= VIEWBOX_HEIGHT);
  }
});

test('coordinates are rounded to 1 decimal', () => {
  for (const record of records) {
    if (record.x === null) continue;
    assert.equal(record.x, Math.round(record.x * 10) / 10);
    assert.equal(record.y, Math.round(record.y * 10) / 10);
  }
});

test('cities land where they belong on the map', () => {
  const boston = find('Boston', 'MA');
  assert.ok(boston.x > 850 && boston.y < 220, `Boston at (${boston.x}, ${boston.y})`);

  // Alaska and Hawaii are drawn as insets in the lower left of the AlbersUsa frame.
  const anchorage = find('Anchorage', 'AK');
  assert.ok(anchorage.x < 300 && anchorage.y > 400, `Anchorage at (${anchorage.x}, ${anchorage.y})`);

  const seattle = find('Seattle', 'WA');
  assert.ok(seattle.x < 200 && seattle.y < 150, `Seattle at (${seattle.x}, ${seattle.y})`);

  const miami = find('Miami', 'FL');
  assert.ok(miami.x > 750 && miami.y > 500, `Miami at (${miami.x}, ${miami.y})`);

  const denver = find('Denver', 'CO');
  assert.ok(
    denver.x > 300 && denver.x < 450 && denver.y > 200 && denver.y < 350,
    `Denver at (${denver.x}, ${denver.y})`
  );

  // Athens GA and Athens OH must not share a location (D6).
  assert.notEqual(find('Athens', 'GA').x, find('Athens', 'OH').x);
});

test('Boston resolves to its real WGS84 coordinates before projection', () => {
  const boston = places.find((place) => place.state === 'MA' && place.name === 'Boston city');
  assert.ok(Math.abs(boston.lat - 42.3) < 0.2);
  assert.ok(Math.abs(boston.lon + 71.06) < 0.2);
});

test('a point outside AlbersUsa coverage projects to null rather than a wrong place', () => {
  const projection = createProjection();
  assert.equal(projectPoint(projection, -66.06, 18.4), null); // San Juan, PR
  assert.ok(projectPoint(projection, -71.06, 42.36)); // Boston, MA
});

test('the basemap bakes into two usable SVG path strings', () => {
  const basemap = buildBasemap(url('../data/source/states-albers-10m.json'));
  assert.equal(basemap.width, VIEWBOX_WIDTH);
  assert.equal(basemap.height, VIEWBOX_HEIGHT);
  for (const key of ['statesPath', 'nationPath']) {
    assert.ok(basemap[key].length > 1000, `${key} is suspiciously short`);
    assert.ok(basemap[key].startsWith('M'), `${key} should start with M`);
  }
  // Rounded to 1 decimal — no long floats survive.
  assert.equal(/\d+\.\d{2,}/.test(basemap.statesPath), false);
  assert.equal(/\d+\.\d{2,}/.test(basemap.nationPath), false);
});
