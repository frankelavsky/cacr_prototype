// Source-string → enum mapping for the survey data.
//
// Rule D5 (DECISIONS.md): blank, "Unsure", and "No" are three different answers.
// A blank cell always becomes `no_response` and never `no`. Any string not listed
// here is a data change we have not seen — the caller fails the build rather than
// guessing.

export const NO_RESPONSE = 'no_response';

export const PRACTICE_KEYS = ['council', 'cabinet', 'impact', 'ombuds', 'budget'];

const STATUS = {
  'Yes, in practice': 'in_practice',
  'Yes, in planning': 'in_planning',
  'Yes, not currently active': 'not_active',
  'No': 'no',
  'Unsure': 'unsure',
};

const MANDATE = {
  'Mandated': 'mandated',
  'Not mandated': 'not_mandated',
  'Unsure': 'unsure',
};

// The three budget detail columns ask Yes/No questions (per the Codebook) but the
// source file answers them with the mandate label set. See docs/PROGRESS.md, Task 02.
const YES_NO = {
  'Yes': 'yes',
  'No': 'no',
  'Mandated': 'yes',
  'Not mandated': 'no',
  'Unsure': 'unsure',
  'Not sure': 'unsure',
};

const LEADER = {
  'Municipality': 'municipality',
  'Other Org': 'other_org',
  'Unsure': 'unsure',
};

export class NormalizeError extends Error {}

function lookup(table, raw, where) {
  const value = String(raw ?? '').trim();
  if (value === '') return NO_RESPONSE;
  const mapped = table[value];
  if (mapped === undefined) {
    throw new NormalizeError(`unexpected value ${JSON.stringify(value)} at ${where}`);
  }
  return mapped;
}

export const normalizeStatus = (raw, where) => lookup(STATUS, raw, where);
export const normalizeMandate = (raw, where) => lookup(MANDATE, raw, where);
export const normalizeYesNo = (raw, where) => lookup(YES_NO, raw, where);
export const normalizeLeader = (raw, where) => lookup(LEADER, raw, where);

// Multi-select free text, e.g. ", Other" or "Other, Dept of Human Services".
// Returns an array of the selected labels, or `no_response` when nothing was picked.
export function normalizeMultiSelect(raw) {
  const parts = String(raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const unique = [...new Set(parts)];
  return unique.length === 0 ? NO_RESPONSE : unique;
}

export const isPresent = (status) =>
  status === 'in_practice' || status === 'in_planning' || status === 'not_active';

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const recordId = (city, state) => `${slugify(city)}--${slugify(state)}`;
