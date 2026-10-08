#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import XLSX from 'xlsx';

const ROOT = new URL('../', import.meta.url);
const path = (relative) => fileURLToPath(new URL(relative, ROOT));
const SOURCE_DIR = path('data/source/');
const OUTPUT_JS = path('src/ccg-data.js');
const OUTPUT_CITIES = path('src/us-cities.json');

// ---------------------------------------------------------------- survey schema

const SHEET_NAME = 'Database_Dataset';
const NO_RESPONSE = 'no_response';
const PRACTICE_KEYS = ['council', 'cabinet', 'impact', 'ombuds', 'budget'];
const REGIONS = ['South', 'West', 'Midwest', 'Northeast/Mid-Atlantic'];
const POPULATION_BUCKETS = ['<10,000', '10,001-50,000', '50,001-200,000', '>200,000'];

const STATUS = {
  'Yes, in practice': 'in_practice',
  'Yes, in planning': 'in_planning',
  'Yes, not currently active': 'not_active',
  'No': 'no',
  'Unsure': 'unsure',
};
const MANDATE = { 'Mandated': 'mandated', 'Not mandated': 'not_mandated', 'Unsure': 'unsure' };
// The budget detail columns are Yes/No questions answered with the mandate labels.
const YES_NO = {
  'Yes': 'yes',
  'No': 'no',
  'Mandated': 'yes',
  'Not mandated': 'no',
  'Unsure': 'unsure',
  'Not sure': 'unsure',
};
const LEADER = { 'Municipality': 'municipality', 'Other Org': 'other_org', 'Unsure': 'unsure' };

const DETAIL_COLUMNS = {
  council: {
    council_educ_local_govt: YES_NO,
    council_plan_events: YES_NO,
    council_input_budg: YES_NO,
    council_input_policy: YES_NO,
    council_input_prog: YES_NO,
    council_input_serv: YES_NO,
  },
  cabinet: {
    cabinet_invst_leader: LEADER,
    cabinet_planning_leader: LEADER,
    cabinet_progs_leader: LEADER,
    cabinet_other_leader: LEADER,
  },
  impact: { impact_budg_decisions: YES_NO, impact_policies: YES_NO },
  ombuds: { ombuds_leadership: 'multiselect' },
  budget: { budget_dedicated: YES_NO, budget_expenditures: YES_NO, budget_other: YES_NO },
};

const REQUIRED_COLUMNS = [
  'city',
  'state',
  'region',
  'population_size',
  'CCG_count',
  ...PRACTICE_KEYS.flatMap((key) => [key, `${key}_mandate`, ...Object.keys(DETAIL_COLUMNS[key])]),
];

const STATE_NAMES = {
  AK: 'Alaska', AL: 'Alabama', AR: 'Arkansas', AZ: 'Arizona', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DC: 'District of Columbia', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', IA: 'Iowa', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', MA: 'Massachusetts',
  MD: 'Maryland', ME: 'Maine', MI: 'Michigan', MN: 'Minnesota', MO: 'Missouri',
  MS: 'Mississippi', MT: 'Montana', NC: 'North Carolina', ND: 'North Dakota',
  NE: 'Nebraska', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NV: 'Nevada',
  NY: 'New York', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VA: 'Virginia', VT: 'Vermont',
  WA: 'Washington', WI: 'Wisconsin', WV: 'West Virginia', WY: 'Wyoming',
};

// ------------------------------------------------------------------- UI labels

const STATUS_LABELS = {
  in_practice: 'Yes, in practice',
  in_planning: 'Yes, in planning',
  not_active: 'Yes, not currently active',
  no: 'No',
  unsure: 'Unsure',
  no_response: 'No response',
};
const MANDATE_LABELS = {
  mandated: 'Mandated',
  not_mandated: 'Not mandated',
  unsure: 'Unsure',
  no_response: 'No response',
};
const DETAIL_LABELS = {
  yes: 'Yes',
  no: 'No',
  unsure: 'Unsure',
  municipality: 'Led by the municipality',
  other_org: 'Led by another organization',
  no_response: 'No response',
};
const POPULATION_SHORT = {
  '<10,000': '<10k',
  '10,001-50,000': '>10k-50k',
  '50,001-200,000': '>50k-200k',
  '>200,000': '>200k',
  no_response: 'No response',
};
const DETAIL_QUESTIONS = {
  council_educ_local_govt: 'Educates youth about local government',
  council_plan_events: 'Plans events and activities',
  council_input_budg: 'Provides input on city budgets',
  council_input_policy: 'Provides input on city policies',
  council_input_prog: 'Provides input on city programs',
  council_input_serv: 'Provides input on city services',
  cabinet_invst_leader: 'Coordinates on investments',
  cabinet_planning_leader: 'Coordinates on planning',
  cabinet_progs_leader: 'Coordinates on programs',
  cabinet_other_leader: 'Coordinates on other areas',
  impact_budg_decisions: 'Used for budget decisions',
  impact_policies: 'Used for policies',
  ombuds_leadership: 'Responsible party',
  budget_dedicated: "Has a dedicated children's budget",
  budget_expenditures: 'Flags child/youth expenditures in the city budget',
  budget_other: "Has other children's budget activities",
};

// ---------------------------------------------------------------- source files

function findOne(pattern, description) {
  const files = readdirSync(SOURCE_DIR).filter((name) => pattern.test(name) && !name.startsWith('~$'));
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one ${description} in data/source/, found ${files.length}` +
        (files.length ? `: ${files.join(', ')}` : '') +
        '. Keep only the one you want to use.'
    );
  }
  return files[0];
}

const readJson = (file) => JSON.parse(readFileSync(SOURCE_DIR + file, 'utf8'));

function readPractices() {
  const practices = readJson('practices.json');
  const keys = practices.map((practice) => practice.key);
  if (keys.join() !== PRACTICE_KEYS.join()) {
    throw new Error(`practices.json must list the practices in this order: ${PRACTICE_KEYS.join(', ')}`);
  }
  for (const practice of practices) {
    for (const field of ['name', 'shortName', 'definition', 'linkToText']) {
      if (!practice[field]) throw new Error(`practices.json: "${practice.key}" is missing "${field}"`);
    }
    if (!/^https:\/\//.test(practice.linkTo ?? '')) {
      throw new Error(`practices.json: "${practice.key}" needs a linkTo starting with https://`);
    }
  }
  return practices;
}

// ---------------------------------------------------------------------- survey

const slugify = (text) =>
  String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function lookup(table, value, where) {
  if (value === '') return NO_RESPONSE;
  if (!Object.hasOwn(table, value)) throw new Error(`unexpected value ${JSON.stringify(value)} at ${where}`);
  return table[value];
}

function multiSelect(value) {
  const parts = [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))];
  return parts.length === 0 ? NO_RESPONSE : parts;
}

function category(value, allowed, where) {
  if (value === '') return NO_RESPONSE;
  if (!allowed.includes(value)) throw new Error(`unexpected value ${JSON.stringify(value)} at ${where}`);
  return value;
}

function readRecords(xlsxPath) {
  const sheet = XLSX.read(readFileSync(xlsxPath), { type: 'buffer' }).Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`sheet "${SHEET_NAME}" not found in ${xlsxPath}`);
  // raw:false keeps every cell a string so a blank never turns into 0.
  const [header, ...rows] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });

  const missing = REQUIRED_COLUMNS.filter((name) => !header.includes(name));
  if (missing.length) throw new Error(`the sheet is missing these columns: ${missing.join(', ')}`);
  if (rows.length === 0) throw new Error('the sheet has no data rows');

  return rows.map((row, index) => {
    const cell = (name) => String(row[header.indexOf(name)] ?? '').trim();
    const at = (column) => `row ${index + 2}, column "${column}"`;

    const city = cell('city');
    const state = cell('state');
    if (!city || !state) throw new Error(`missing city or state at row ${index + 2}`);

    const ccgCount = Number(cell('CCG_count'));
    if (!Number.isInteger(ccgCount) || ccgCount < 0 || ccgCount > 5) {
      throw new Error(`CCG_count ${JSON.stringify(cell('CCG_count'))} out of range at ${at('CCG_count')}`);
    }

    const practices = {};
    for (const key of PRACTICE_KEYS) {
      const details = {};
      for (const [column, table] of Object.entries(DETAIL_COLUMNS[key])) {
        details[column] = table === 'multiselect' ? multiSelect(cell(column)) : lookup(table, cell(column), at(column));
      }
      practices[key] = {
        status: lookup(STATUS, cell(key), at(key)),
        mandate: lookup(MANDATE, cell(`${key}_mandate`), at(`${key}_mandate`)),
        details,
      };
    }

    const populationSize = category(cell('population_size'), POPULATION_BUCKETS, at('population_size'));
    return {
      id: `${slugify(city)}--${slugify(state)}`,
      city,
      state,
      stateName: STATE_NAMES[state] || state,
      region: category(cell('region'), REGIONS, at('region')),
      populationSize,
      populationIndex: POPULATION_BUCKETS.indexOf(populationSize),
      ccgCount,
      practices,
    };
  });
}

const isPresent = (status) => status === 'in_practice' || status === 'in_planning' || status === 'not_active';

function checkRecords(records) {
  const seen = new Set();
  const duplicates = [];
  for (const record of records) {
    if (seen.has(record.id)) duplicates.push(`${record.city}, ${record.state}`);
    seen.add(record.id);
  }
  if (duplicates.length) throw new Error(`duplicate city+state: ${duplicates.join('; ')}`);

  // The Codebook defines CCG_count as "in practice or in planning", but the source also
  // counts "not currently active". The source value is kept; disagreements are reported.
  return records
    .map((record) => {
      const statuses = PRACTICE_KEYS.map((key) => record.practices[key].status);
      return {
        city: `${record.city}, ${record.state}`,
        published: record.ccgCount,
        codebookRule: statuses.filter((s) => s === 'in_practice' || s === 'in_planning').length,
        countingNotActive: statuses.filter(isPresent).length,
      };
    })
    .filter((w) => w.codebookRule !== w.published);
}

// ------------------------------------------------------------------- gazetteer

// LSAD codes for unincorporated statistical areas: CDP, zona urbana, comunidad.
const STATISTICAL_LSAD = new Set(['57', '62', '55']);
const TYPE_SUFFIXES = [
  'city and borough',
  'consolidated government',
  'metropolitan government',
  'unified government',
  'metro government',
  'zona urbana',
  'municipality',
  'corporation',
  'plantation',
  'comunidad',
  'township',
  'borough',
  'village',
  'county',
  'city',
  'town',
  'cdp',
];
const ABBREVIATIONS = [
  [/\bst\b/g, 'saint'],
  [/\bste\b/g, 'sainte'],
  [/\bft\b/g, 'fort'],
  [/\bmt\b/g, 'mount'],
];

function normalizePlaceName(name) {
  let text = String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(balance\)/g, ' ')
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  for (const [pattern, replacement] of ABBREVIATIONS) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, ' ').trim();
}

function stripTypeSuffix(normalizedName) {
  const suffix = TYPE_SUFFIXES.find((s) => normalizedName.endsWith(` ${s}`));
  return suffix ? normalizedName.slice(0, -(suffix.length + 1)).trim() : null;
}

function toDisplayName(censusName) {
  let name = String(censusName).replace(/\s*\(balance\)\s*/gi, ' ').trim();
  for (const suffix of TYPE_SUFFIXES) {
    const pattern = new RegExp(`\\s+${suffix.replace(/ /g, '\\s+')}$`, 'i');
    if (pattern.test(name)) {
      name = name.replace(pattern, '');
      break;
    }
  }
  return name.replace(/\s+/g, ' ').trim();
}

function parseGazetteer(filePath) {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.trim() !== '');
  // Older vintages are tab-delimited; 2025 is pipe-delimited.
  const delimiter = lines[0].includes('\t') ? '\t' : '|';
  const header = lines[0].split(delimiter).map((field) => field.trim());
  const [usps, geoid, name, lsad, lat, lon] = ['USPS', 'GEOID', 'NAME', 'LSAD', 'INTPTLAT', 'INTPTLONG'].map(
    (column) => {
      const index = header.indexOf(column);
      if (index === -1) throw new Error(`gazetteer is missing column "${column}"`);
      return index;
    }
  );

  const places = lines.slice(1).map((line) => {
    const fields = line.split(delimiter);
    return {
      geoid: fields[geoid].trim(),
      state: fields[usps].trim().toUpperCase(),
      name: fields[name].trim(),
      normalizedName: normalizePlaceName(fields[name]),
      isIncorporated: !STATISTICAL_LSAD.has(fields[lsad].trim()),
      lat: Number(fields[lat]),
      lon: Number(fields[lon]),
    };
  });
  if (places.length < 30000) {
    throw new Error(`the gazetteer has only ${places.length} places; expected the full national places file`);
  }
  return places;
}

function indexByPlaceKey(places) {
  const index = new Map();
  const add = (key, place) => {
    if (!index.has(key)) index.set(key, []);
    if (!index.get(key).includes(place)) index.get(key).push(place);
  };
  for (const place of places) {
    add(`${place.normalizedName}|${place.state}`, place);
    const stripped = stripTypeSuffix(place.normalizedName);
    if (stripped) add(`${stripped}|${place.state}`, place);
  }
  return index;
}

function matchPlace(index, city, state) {
  const candidates = index.get(`${normalizePlaceName(city)}|${state.toUpperCase()}`) ?? [];
  if (candidates.length === 1) return { place: candidates[0], method: 'exact' };
  if (candidates.length === 0) return { reason: 'no gazetteer place with this name in this state' };

  const incorporated = candidates.filter((candidate) => candidate.isIncorporated);
  if (incorporated.length === 1) return { place: incorporated[0], method: 'incorporated' };
  return {
    reason: `ambiguous — ${candidates.length} candidates (${candidates
      .map((candidate) => `${candidate.name} [${candidate.geoid}]`)
      .join(', ')})`,
  };
}

// ----------------------------------------------------------------------- map

// states-albers-10m is pre-projected into this 975x610 frame; cities must match it.
const VIEWBOX_WIDTH = 975;
const VIEWBOX_HEIGHT = 610;
const round1 = (value) => Math.round(value * 10) / 10;

function geocode(records, places, overrides) {
  const byPlaceKey = indexByPlaceKey(places);
  const byGeoid = new Map(places.map((place) => [place.geoid, place]));
  const projection = geoAlbersUsa().scale(1300).translate([VIEWBOX_WIDTH / 2, VIEWBOX_HEIGHT / 2]);

  const methodCounts = { exact: 0, incorporated: 0, override: 0 };
  const surveyedGeoids = new Set();
  const unresolved = [];
  const outsideProjection = [];

  for (const record of records) {
    const override = overrides[record.id];
    let coordinates;

    if (override) {
      if (override.geoid) {
        const place = byGeoid.get(override.geoid);
        if (!place) throw new Error(`geo-overrides.json: no gazetteer place with GEOID ${override.geoid} (for ${record.id})`);
        coordinates = place;
        surveyedGeoids.add(place.geoid);
      } else if (Number.isFinite(override.lat) && Number.isFinite(override.lon)) {
        coordinates = override;
      } else {
        throw new Error(`geo-overrides.json: entry for ${record.id} needs either "geoid" or "lat"+"lon"`);
      }
      methodCounts.override += 1;
    } else {
      const match = matchPlace(byPlaceKey, record.city, record.state);
      if (!match.place) {
        unresolved.push(`  ${record.id}  (${record.city}, ${record.state}) — ${match.reason}`);
        continue;
      }
      coordinates = match.place;
      surveyedGeoids.add(match.place.geoid);
      methodCounts[match.method] += 1;
    }

    // AlbersUsa has no room for Puerto Rico: those records are kept but not placed.
    const point = projection([coordinates.lon, coordinates.lat]);
    if (!point || !point.every(Number.isFinite)) {
      outsideProjection.push(`${record.city}, ${record.state}`);
      record.x = null;
      record.y = null;
      continue;
    }
    const [x, y] = point.map(round1);
    if (x < 0 || x > VIEWBOX_WIDTH || y < 0 || y > VIEWBOX_HEIGHT) {
      throw new Error(`${record.city}, ${record.state} projected to (${x}, ${y}), outside the viewBox`);
    }
    record.x = x;
    record.y = y;
  }

  if (unresolved.length) {
    throw new Error(
      `${unresolved.length} cities could not be matched to the gazetteer. ` +
        `Add each to data/source/geo-overrides.json:\n${unresolved.join('\n')}`
    );
  }
  return { methodCounts, outsideProjection, surveyedGeoids };
}

function buildBasemap(topology) {
  const toPath = geoPath(null);
  const roundPath = (d) => toPath(d).replace(/-?\d+\.\d+/g, (n) => String(round1(Number(n))));
  const statesPath = roundPath(mesh(topology, topology.objects.states, (a, b) => a !== b));
  const nationPath = roundPath(feature(topology, topology.objects.nation));
  if (!statesPath.startsWith('M') || !nationPath.startsWith('M')) {
    throw new Error('basemap paths are empty or malformed');
  }
  return { width: VIEWBOX_WIDTH, height: VIEWBOX_HEIGHT, statesPath, nationPath };
}

// Every Census place not in the survey, as { STATE: [names] }. Places are excluded by
// GEOID (Nashville's place is "Nashville-Davidson") and by name, so no surveyed city
// also shows up as a no-data row.
function buildCityList(places, surveyedGeoids, records) {
  const surveyedNames = new Set(records.map((record) => `${record.state}|${record.city}`));
  const byState = new Map();
  for (const place of places) {
    const name = toDisplayName(place.name);
    if (surveyedGeoids.has(place.geoid) || surveyedNames.has(`${place.state}|${name}`) || name === '') continue;
    if (!byState.has(place.state)) byState.set(place.state, new Set());
    byState.get(place.state).add(name);
  }
  return Object.fromEntries(
    [...byState.keys()].sort().map((state) => [state, [...byState.get(state)].sort((a, b) => a.localeCompare(b))])
  );
}

// --------------------------------------------------------------- stats and meta

const percent = (part, whole) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);
const tally = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));

function buildStats(records) {
  const totalCities = records.length;
  const count = (predicate) => records.filter(predicate).length;

  const byPractice = {};
  for (const key of PRACTICE_KEYS) {
    const inPractice = count((r) => r.practices[key].status === 'in_practice');
    const inPlanning = count((r) => r.practices[key].status === 'in_planning');
    const notActive = count((r) => r.practices[key].status === 'not_active');
    const any = inPractice + inPlanning + notActive;
    byPractice[key] = {
      inPractice,
      inPractice_pct: percent(inPractice, totalCities),
      inPlanning,
      inPlanning_pct: percent(inPlanning, totalCities),
      notActive,
      any,
      any_pct: percent(any, totalCities),
    };
  }

  const byCcgCount = tally([0, 1, 2, 3, 4, 5]);
  const byRegion = tally([...REGIONS, NO_RESPONSE]);
  const byPopulation = tally([...POPULATION_BUCKETS, NO_RESPONSE]);
  const byPopulationAndCcgCount = Object.fromEntries(
    [...POPULATION_BUCKETS, NO_RESPONSE].map((bucket) => [bucket, tally([0, 1, 2, 3, 4, 5])])
  );
  for (const record of records) {
    byCcgCount[record.ccgCount] += 1;
    byRegion[record.region] += 1;
    byPopulation[record.populationSize] += 1;
    byPopulationAndCcgCount[record.populationSize][record.ccgCount] += 1;
  }

  const citiesWithUnmandatedPractice = count((record) =>
    PRACTICE_KEYS.some(
      (key) => isPresent(record.practices[key].status) && record.practices[key].mandate === 'not_mandated'
    )
  );
  const citiesWithNoPractices = byCcgCount[0];
  const citiesWithAllPractices = byCcgCount[5];
  const citiesWithAnyPractice = totalCities - citiesWithNoPractices;

  return {
    totalCities,
    byPractice,
    byCcgCount,
    byRegion,
    byPopulation,
    byPopulationAndCcgCount,
    citiesWithUnmandatedPractice,
    citiesWithUnmandatedPractice_pct: percent(citiesWithUnmandatedPractice, totalCities),
    citiesWithAnyPractice,
    citiesWithAnyPractice_pct: percent(citiesWithAnyPractice, totalCities),
    citiesWithNoPractices,
    citiesWithNoPractices_pct: percent(citiesWithNoPractices, totalCities),
    citiesWithAllPractices,
    citiesWithAllPractices_pct: percent(citiesWithAllPractices, totalCities),
    statesRepresented: new Set(records.map((r) => r.state)).size,
  };
}

function buildMeta(practices) {
  return {
    practices,
    labels: {
      status: STATUS_LABELS,
      mandate: MANDATE_LABELS,
      detail: DETAIL_LABELS,
      detailQuestion: DETAIL_QUESTIONS,
      region: { no_response: 'No response' },
      populationSize: { no_response: 'No response' },
      populationSizeShort: POPULATION_SHORT,
      noData: { flag: '(No Data)', value: 'Unreported' },
    },
    regions: REGIONS,
    stateNames: STATE_NAMES,
    populationBuckets: POPULATION_BUCKETS,
    populationBucketsShort: POPULATION_BUCKETS.map((bucket) => POPULATION_SHORT[bucket]),
    tableColumns: [
      { id: 'city', label: 'City', short: 'City', type: 'text' },
      { id: 'state', label: 'State', short: 'State', type: 'text' },
      { id: 'region', label: 'Region', short: 'Region', type: 'text' },
      { id: 'populationSize', label: 'Population size', short: 'Population', type: 'ordinal' },
      { id: 'ccgCount', label: 'Practices reported', short: 'Practices', type: 'number' },
      ...practices.map((practice) => ({
        id: `practices.${practice.key}.status`,
        label: practice.name,
        short: practice.shortName,
        type: 'status',
      })),
    ],
    mobileColumnIds: ['city', 'state', 'ccgCount'],
  };
}

// ---------------------------------------------------------------------- output

// Sorted keys so the same input always produces a byte-identical file.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

function serialize(data) {
  return (
    '// GENERATED by scripts/build-data.mjs — do not edit; run npm run data\n' +
    '//\n' +
    '// One global, one assignment. Loaded as a classic script before ccg-dashboard.js.\n' +
    'window.CCG_DATA = ' +
    JSON.stringify(sortKeys(data), null, 1) +
    ';\n'
  );
}

function readPrevious() {
  if (!existsSync(OUTPUT_JS)) return null;
  const window = {};
  new Function('window', readFileSync(OUTPUT_JS, 'utf8'))(window);
  return window.CCG_DATA;
}

function list(title, items) {
  if (items.length === 0) return;
  console.log(`\n${title} (${items.length}):`);
  for (const item of items) console.log(`  ${item}`);
}

function reportChanges(previous, next) {
  if (!previous) return;
  const label = (record) => `${record.city}, ${record.state}`;
  const before = new Map(previous.dataset.map((record) => [record.id, record]));
  const after = new Map(next.dataset.map((record) => [record.id, record]));

  list('Cities added', next.dataset.filter((r) => !before.has(r.id)).map(label));
  list('Cities removed', previous.dataset.filter((r) => !after.has(r.id)).map(label));
  list(
    'Practice count changed',
    next.dataset
      .filter((r) => before.has(r.id) && before.get(r.id).ccgCount !== r.ccgCount)
      .map((r) => `${label(r)}: ${before.get(r.id).ccgCount} → ${r.ccgCount}`)
  );

  console.log('\nHeadline numbers (before → after):');
  for (const [name, key] of [
    ['Cities surveyed', 'totalCities'],
    ['Cities on the map', 'citiesOnMap'],
    ['Report at least one practice (%)', 'citiesWithAnyPractice_pct'],
    ['Report no practices (%)', 'citiesWithNoPractices_pct'],
    ['Report all five practices', 'citiesWithAllPractices'],
  ]) {
    const from = previous.stats[key];
    const to = next.stats[key];
    console.log(`  ${name.padEnd(34)} ${from} → ${to}${from === to ? '' : '   (changed)'}`);
  }
}

function reportWarnings(warnings) {
  if (warnings.length === 0) return;
  console.log(
    `\n${warnings.length} cities where CCG_count also counts "Yes, not currently active" ` +
      '(the published CCG_count is kept as-is):'
  );
  for (const w of warnings) {
    console.log(`  ${w.city.padEnd(22)} CCG_count=${w.published}  in practice or planning=${w.codebookRule}`);
  }
  if (!warnings.every((w) => w.countingNotActive === w.published)) {
    console.log('  Some of these are NOT explained by "not currently active" — check them in the spreadsheet.');
  }
}

function main() {
  const surveyFile = findOne(/\.xlsx$/i, '.xlsx survey file');
  const gazetteerFile = findOne(/Gaz_place.*\.txt$/i, 'Census places gazetteer (*Gaz_place*.txt)');

  const records = readRecords(SOURCE_DIR + surveyFile);
  const warnings = checkRecords(records);
  const practices = readPractices();
  const places = parseGazetteer(SOURCE_DIR + gazetteerFile);
  const overrides = Object.fromEntries(
    Object.entries(readJson('geo-overrides.json')).filter(([id]) => !id.startsWith('_'))
  );
  const { methodCounts, outsideProjection, surveyedGeoids } = geocode(records, places, overrides);

  const stats = buildStats(records);
  stats.citiesOnMap = records.filter((record) => record.x !== null).length;
  stats.citiesNotOnMap = outsideProjection;

  const data = {
    basemap: buildBasemap(readJson('states-albers-10m.json')),
    dataset: records,
    stats,
    meta: buildMeta(practices),
  };
  const cityList = buildCityList(places, surveyedGeoids, records);

  const previous = readPrevious();
  const output = serialize(data);
  writeFileSync(OUTPUT_JS, output);
  writeFileSync(OUTPUT_CITIES, JSON.stringify(cityList));

  const cityCount = Object.values(cityList).reduce((total, names) => total + names.length, 0);
  console.log(`Read data/source/${surveyFile} and data/source/${gazetteerFile}`);
  console.log(`Wrote src/ccg-data.js — ${stats.totalCities} cities, ${(Buffer.byteLength(output) / 1024).toFixed(0)}KB`);
  console.log(
    `Wrote src/us-cities.json — ${cityCount} places with no survey data, ` +
      `${(statSync(OUTPUT_CITIES).size / 1024).toFixed(0)}KB`
  );
  console.log(
    `Map: ${stats.citiesOnMap} of ${stats.totalCities} placed ` +
      `(${methodCounts.exact} exact, ${methodCounts.incorporated} incorporated, ${methodCounts.override} override)` +
      (outsideProjection.length ? `; not shown: ${outsideProjection.join(', ')}` : '')
  );
  console.log(`Cities per practice count: ${[0, 1, 2, 3, 4, 5].map((n) => `${n}→${stats.byCcgCount[n]}`).join('  ')}`);

  reportWarnings(warnings);
  reportChanges(previous, data);
}

try {
  main();
} catch (error) {
  console.error(`\nData update stopped. Nothing was written.\n\n${error.message}`);
  process.exit(1);
}
