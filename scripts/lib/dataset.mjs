// Reads the survey sheet and turns it into the canonical record array that the
// whole app is built on.
//
// CANONICAL RECORD SHAPE (this is the contract for everything downstream —
// the runtime is plain JS, so the shape is documented here with its producer):
//
//   {
//     id: 'athens--oh',              // slug of city + state; the only safe key (D6)
//     city: 'Athens',
//     state: 'OH',
//     stateName: 'Ohio',            // so the search can match "ohio" without a lookup
//     region: 'Midwest' | ... | 'no_response',
//     populationSize: '10,001-50,000' | ... | 'no_response',
//     populationIndex: 0..3 | -1,    // ordinal rank of the bucket; -1 when absent
//     ccgCount: 0..5,                // as published in the source file
//     practices: {
//       council|cabinet|impact|ombuds|budget: {
//         status:  'in_practice'|'in_planning'|'not_active'|'no'|'unsure'|'no_response',
//         mandate: 'mandated'|'not_mandated'|'unsure'|'no_response',
//         details: { <columnSuffix>: 'yes'|'no'|'unsure'|'no_response'|<value>|<array> }
//       }
//     }
//   }
//
// Task 03 adds `x` and `y` (projected map coordinates) to each record.

import { readFileSync } from 'node:fs';
import XLSX from 'xlsx';

import { STATE_NAMES } from './states.mjs';

import {
  NO_RESPONSE,
  PRACTICE_KEYS,
  isPresent,
  normalizeLeader,
  normalizeMandate,
  normalizeMultiSelect,
  normalizeStatus,
  normalizeYesNo,
  recordId,
} from './normalize.mjs';

export const SHEET_NAME = 'Database_Dataset';
export const EXPECTED_RECORD_COUNT = 384;

export const REGIONS = ['South', 'West', 'Midwest', 'Northeast/Mid-Atlantic'];

export const POPULATION_BUCKETS = ['<10,000', '10,001-50,000', '50,001-200,000', '>200,000'];

// Which detail column belongs to which practice, and how each one is read.
const DETAIL_COLUMNS = {
  council: {
    council_educ_local_govt: normalizeYesNo,
    council_plan_events: normalizeYesNo,
    council_input_budg: normalizeYesNo,
    council_input_policy: normalizeYesNo,
    council_input_prog: normalizeYesNo,
    council_input_serv: normalizeYesNo,
  },
  cabinet: {
    cabinet_invst_leader: normalizeLeader,
    cabinet_planning_leader: normalizeLeader,
    cabinet_progs_leader: normalizeLeader,
    cabinet_other_leader: normalizeLeader,
  },
  impact: {
    impact_budg_decisions: normalizeYesNo,
    impact_policies: normalizeYesNo,
  },
  ombuds: {
    ombuds_leadership: normalizeMultiSelect,
  },
  budget: {
    budget_dedicated: normalizeYesNo,
    budget_expenditures: normalizeYesNo,
    budget_other: normalizeYesNo,
  },
};

export class DataError extends Error {}

export function readSheetRows(xlsxPath) {
  const workbook = XLSX.read(readFileSync(xlsxPath), { type: 'buffer' });
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    throw new DataError(`sheet "${SHEET_NAME}" not found in ${xlsxPath}`);
  }
  // raw:false keeps every cell a string so blanks stay distinguishable from zeroes.
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
}

const cell = (row, header, name) => String(row[header.indexOf(name)] ?? '').trim();

function optionalCategory(value, allowed, where) {
  if (value === '') return NO_RESPONSE;
  if (!allowed.includes(value)) {
    throw new DataError(`unexpected value ${JSON.stringify(value)} at ${where}`);
  }
  return value;
}

export function buildRecord(row, header, rowNumber) {
  const at = (column) => `row ${rowNumber}, column "${column}"`;
  const city = cell(row, header, 'city');
  const state = cell(row, header, 'state');
  if (city === '' || state === '') {
    throw new DataError(`missing city or state at row ${rowNumber}`);
  }

  const populationSize = optionalCategory(
    cell(row, header, 'population_size'),
    POPULATION_BUCKETS,
    at('population_size')
  );

  const ccgCountRaw = cell(row, header, 'CCG_count');
  const ccgCount = Number(ccgCountRaw);
  if (!Number.isInteger(ccgCount) || ccgCount < 0 || ccgCount > 5) {
    throw new DataError(`CCG_count ${JSON.stringify(ccgCountRaw)} out of range at ${at('CCG_count')}`);
  }

  const practices = {};
  for (const key of PRACTICE_KEYS) {
    const details = {};
    for (const [column, normalize] of Object.entries(DETAIL_COLUMNS[key])) {
      details[column] = normalize(cell(row, header, column), at(column));
    }
    practices[key] = {
      status: normalizeStatus(cell(row, header, key), at(key)),
      mandate: normalizeMandate(cell(row, header, `${key}_mandate`), at(`${key}_mandate`)),
      details,
    };
  }

  return {
    id: recordId(city, state),
    city,
    state,
    stateName: STATE_NAMES[state] || state,
    region: optionalCategory(cell(row, header, 'region'), REGIONS, at('region')),
    populationSize,
    populationIndex: POPULATION_BUCKETS.indexOf(populationSize),
    ccgCount,
    practices,
  };
}

export function buildRecords(rows) {
  const [header, ...body] = rows;
  return body.map((row, index) => buildRecord(row, header, index + 2));
}

// The Codebook says CCG_count is "in practice or in planning", but the published
// numbers only reconcile when "Yes, not currently active" counts too (8 cities).
// We keep the source value and report the disagreement instead of silently picking one.
export function countPracticesInPlanningOrPractice(record) {
  return PRACTICE_KEYS.filter((key) => {
    const status = record.practices[key].status;
    return status === 'in_practice' || status === 'in_planning';
  }).length;
}

export function countPracticesPresent(record) {
  return PRACTICE_KEYS.filter((key) => isPresent(record.practices[key].status)).length;
}

export function validate(records) {
  const problems = [];
  const warnings = [];

  if (records.length !== EXPECTED_RECORD_COUNT) {
    problems.push(`expected ${EXPECTED_RECORD_COUNT} records, got ${records.length}`);
  }

  const byId = new Map();
  for (const record of records) {
    if (byId.has(record.id)) {
      problems.push(`duplicate city+state: ${record.city}, ${record.state}`);
    }
    byId.set(record.id, record);
  }

  for (const record of records) {
    const codebookCount = countPracticesInPlanningOrPractice(record);
    if (codebookCount !== record.ccgCount) {
      warnings.push({
        city: `${record.city}, ${record.state}`,
        published: record.ccgCount,
        codebookRule: codebookCount,
        countingNotActive: countPracticesPresent(record),
      });
    }
  }

  if (problems.length > 0) {
    throw new DataError(`validation failed:\n  - ${problems.join('\n  - ')}`);
  }
  return warnings;
}
