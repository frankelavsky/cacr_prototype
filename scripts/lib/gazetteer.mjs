// Census Bureau Gazetteer "Places" file — the single source for both city coordinates
// and the all-US-cities fallback list (D4). Public domain, no API key, no runtime
// geocoding.
//
// Delimiter note: the 2024 vintage is tab-delimited with 12 columns; the 2025 vintage is
// pipe-delimited with 13 (it adds GEOIDFQ). We sniff the header so dropping in a newer
// vintage does not silently produce zero rows.

import { readFileSync } from 'node:fs';

import { slugify } from './normalize.mjs';

// LSAD codes for statistical (unincorporated) areas. Everything else is a real
// incorporated place, which we prefer when a name matches more than one row in a state.
const STATISTICAL_LSAD = new Set([
  '57', // CDP
  '62', // zona urbana (PR)
  '55', // comunidad (PR)
]);

// Trailing generic words the Census appends to place names. "Athens city" is our "Athens".
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

function detectDelimiter(headerLine) {
  if (headerLine.includes('\t')) return '\t';
  if (headerLine.includes('|')) return '|';
  throw new Error('gazetteer header uses an unrecognized delimiter');
}

// "St." and "Saint" are the same place; so are "Ft."/"Fort" and "Mt."/"Mount".
const ABBREVIATIONS = [
  [/\bst\b/g, 'saint'],
  [/\bste\b/g, 'sainte'],
  [/\bft\b/g, 'fort'],
  [/\bmt\b/g, 'mount'],
];

// Survey city names are typed by respondents from a picklist and carry no type suffix,
// so this never strips one: "Kansas City" must not become "Kansas".
export function normalizePlaceName(name) {
  let text = String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(balance\)/g, ' ')
    .replace(/[.'\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  for (const [pattern, replacement] of ABBREVIATIONS) {
    text = text.replace(pattern, replacement);
  }

  return text.replace(/\s+/g, ' ').trim();
}

// Census names are "<place> <type>" — "Athens city", "Princeton CDP". Returns the name
// without that trailing type word, or null when there is none to strip. Gazetteer rows are
// indexed under both forms so "Kansas City city" is findable as both "kansas city" and
// "kansas".
export function stripTypeSuffix(normalizedName) {
  for (const suffix of TYPE_SUFFIXES) {
    if (normalizedName.endsWith(` ${suffix}`)) {
      return normalizedName.slice(0, -(suffix.length + 1)).trim();
    }
  }
  return null;
}

export const placeKey = (name, state) => `${normalizePlaceName(name)}|${String(state).toUpperCase()}`;

export function parseGazetteer(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const delimiter = detectDelimiter(lines[0]);
  const header = lines[0].split(delimiter).map((field) => field.trim());

  const column = (name) => {
    const index = header.indexOf(name);
    if (index === -1) throw new Error(`gazetteer is missing column "${name}"`);
    return index;
  };
  const [usps, geoid, nameCol, lsad, lat, lon] = [
    'USPS',
    'GEOID',
    'NAME',
    'LSAD',
    'INTPTLAT',
    'INTPTLONG',
  ].map(column);

  return lines.slice(1).map((line) => {
    const fields = line.split(delimiter);
    const name = fields[nameCol].trim();
    return {
      geoid: fields[geoid].trim(),
      state: fields[usps].trim().toUpperCase(),
      name,
      normalizedName: normalizePlaceName(name),
      isIncorporated: !STATISTICAL_LSAD.has(fields[lsad].trim()),
      lat: Number(fields[lat]),
      lon: Number(fields[lon]),
    };
  });
}

export function indexByPlaceKey(places) {
  const index = new Map();
  const add = (key, place) => {
    if (!index.has(key)) index.set(key, []);
    const bucket = index.get(key);
    if (!bucket.includes(place)) bucket.push(place);
  };
  for (const place of places) {
    add(`${place.normalizedName}|${place.state}`, place);
    const stripped = stripTypeSuffix(place.normalizedName);
    if (stripped) add(`${stripped}|${place.state}`, place);
  }
  return index;
}

export function indexByGeoid(places) {
  return new Map(places.map((place) => [place.geoid, place]));
}

// Returns { place, method } or { place: null, reason } — never a guess. Anything this
// cannot resolve confidently goes to data/source/geo-overrides.json.
export function matchPlace(index, city, state) {
  const candidates = index.get(placeKey(city, state)) ?? [];

  if (candidates.length === 1) {
    return { place: candidates[0], method: 'exact' };
  }
  if (candidates.length === 0) {
    return { place: null, reason: 'no gazetteer place with this name in this state' };
  }

  const incorporated = candidates.filter((candidate) => candidate.isIncorporated);
  if (incorporated.length === 1) {
    return { place: incorporated[0], method: 'incorporated' };
  }
  return {
    place: null,
    reason: `ambiguous — ${candidates.length} candidates (${candidates
      .map((candidate) => `${candidate.name} [${candidate.geoid}]`)
      .join(', ')})`,
  };
}

// The all-US-cities fallback list (Task 09 consumes it). Grouped by state rather than a
// flat [{name, state}] array: the state string would otherwise repeat 32,000 times and
// roughly triple the file, which is lazy-fetched on a search miss.
//
//   { "AL": ["Abanda", "Abbeville", ...], "AK": [...] }   // names sorted within a state
export function buildCityLookupList(places) {
  const byState = new Map();
  for (const place of places) {
    const displayName = toDisplayName(place.name);
    if (displayName === '') continue;
    if (!byState.has(place.state)) byState.set(place.state, new Set());
    byState.get(place.state).add(displayName);
  }

  const grouped = {};
  for (const state of [...byState.keys()].sort()) {
    grouped[state] = [...byState.get(state)].sort((a, b) => a.localeCompare(b));
  }
  return grouped;
}

// "Athens-Clarke County unified government (balance)" -> "Athens-Clarke County".
// "Princeton CDP" -> "Princeton". Keeps the original casing; only drops the Census's
// appended type word.
export function toDisplayName(censusName) {
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

export { slugify };
