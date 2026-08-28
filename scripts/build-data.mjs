#!/usr/bin/env node
// Dev-time only. Reads the survey workbook and writes src/ccg-data.js, the single
// file the runtime reads. Nothing here ships to the browser.
//
// Usage: npm run data

import { statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildRecords, readSheetRows, validate } from './lib/dataset.mjs';
import { buildBasemap } from './lib/geometry.mjs';
import { geocodeRecords, readOverrides } from './lib/geocode.mjs';
import { buildCityLookupList, parseGazetteer } from './lib/gazetteer.mjs';
import { buildMeta } from './lib/meta.mjs';
import { buildStats } from './lib/stats.mjs';
import { serializeDataFile } from './lib/serialize.mjs';

const ROOT = new URL('../', import.meta.url);
const SOURCE_XLSX = new URL('data/source/NLC_Survey_database_final.xlsx', ROOT);
const SOURCE_GAZETTEER = new URL('data/source/2025_Gaz_place_national.txt', ROOT);
const SOURCE_BASEMAP = new URL('data/source/states-albers-10m.json', ROOT);
const SOURCE_OVERRIDES = new URL('data/source/geo-overrides.json', ROOT);
const OUTPUT_JS = new URL('src/ccg-data.js', ROOT);
const OUTPUT_CITIES = new URL('src/us-cities.json', ROOT);

function reportCountWarnings(warnings) {
  if (warnings.length === 0) return;
  console.warn(
    `\n${warnings.length} cities where the published CCG_count disagrees with the ` +
      'Codebook rule ("in practice" or "in planning"):'
  );
  console.warn(
    warnings
      .map(
        (w) =>
          `  ${w.city.padEnd(22)} published=${w.published}  codebookRule=${w.codebookRule}` +
          `  countingNotActive=${w.countingNotActive}`
      )
      .join('\n')
  );
  const explained = warnings.every((w) => w.countingNotActive === w.published);
  console.warn(
    explained
      ? '  All are explained by CCG_count also counting "Yes, not currently active".\n' +
          '  The published CCG_count is kept as-is. See docs/PROGRESS.md, Task 02.\n'
      : '  Unexplained by the "not currently active" rule — investigate before shipping.\n'
  );
}

function reportUnmappableCities(outsideProjection) {
  if (outsideProjection.length === 0) return;
  console.warn(
    `\n${outsideProjection.length} cities are in the data but cannot be placed on the map ` +
      '(outside the Albers USA projection):'
  );
  for (const item of outsideProjection) console.warn(`  ${item.city}, ${item.state}`);
  console.warn(
    '  They keep x/y = null and stay in the dataset and the table. The map caption must\n' +
      '  say they are not shown. See docs/PROGRESS.md, Task 03.\n'
  );
}

function main() {
  const rows = readSheetRows(fileURLToPath(SOURCE_XLSX));
  const records = buildRecords(rows);
  const warnings = validate(records);
  reportCountWarnings(warnings);

  const places = parseGazetteer(fileURLToPath(SOURCE_GAZETTEER));
  const overrides = readOverrides(fileURLToPath(SOURCE_OVERRIDES));
  const { methodCounts, outsideProjection } = geocodeRecords(records, places, overrides);
  reportUnmappableCities(outsideProjection);

  const basemap = buildBasemap(fileURLToPath(SOURCE_BASEMAP));
  const stats = buildStats(records);
  stats.citiesOnMap = records.filter((record) => record.x !== null).length;
  stats.citiesNotOnMap = outsideProjection.map((item) => `${item.city}, ${item.state}`);

  const output = serializeDataFile(
    { basemap, dataset: records, stats, meta: buildMeta() },
    'scripts/build-data.mjs'
  );
  writeFileSync(fileURLToPath(OUTPUT_JS), output);

  const cityList = buildCityLookupList(places);
  writeFileSync(fileURLToPath(OUTPUT_CITIES), JSON.stringify(cityList));
  const cityCount = Object.values(cityList).reduce((total, names) => total + names.length, 0);

  const sizeKb = (Buffer.byteLength(output) / 1024).toFixed(1);
  console.log(`wrote src/ccg-data.js — ${records.length} records, ${sizeKb}KB`);
  console.log(
    `  geocoding: ${methodCounts.exact} exact, ${methodCounts.incorporated} incorporated-preferred, ` +
      `${methodCounts.override} override → ${stats.citiesOnMap}/${records.length} on the map`
  );
  console.log(
    `wrote src/us-cities.json — ${cityCount} places in ${Object.keys(cityList).length} states, ` +
      `${(statSync(fileURLToPath(OUTPUT_CITIES)).size / 1024).toFixed(0)}KB`
  );
  console.log(
    `  cities per practice count: ${[0, 1, 2, 3, 4, 5]
      .map((n) => `${n}→${stats.byCcgCount[n]}`)
      .join('  ')}`
  );
  console.log(`  warnings: ${warnings.length}`);
}

main();
