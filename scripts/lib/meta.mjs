// Display strings and table column definitions. Everything the UI needs to render a
// value lives here, so the runtime never hard-codes a label or an enum spelling.

import { POPULATION_BUCKETS, REGIONS } from './dataset.mjs';
import { STATE_NAMES } from './states.mjs';

// Practice order is fixed by CLAUDE.md: council, cabinet, impact, ombuds, budget.
const PRACTICES = [
  {
    key: 'council',
    name: 'Youth councils & advisory boards',
    shortName: 'Youth councils',
    definition: 'Children as active participants in decisions.',
  },
  {
    key: 'cabinet',
    name: "Children's cabinets",
    shortName: 'Cabinets',
    definition: "Cross-department coordination for children's services.",
  },
  {
    key: 'impact',
    name: 'Child impact statements',
    shortName: 'Impact statements',
    definition: 'Assessing how a decision affects children before passage.',
  },
  {
    key: 'ombuds',
    name: 'Ombuds offices / independent advocates',
    shortName: 'Ombuds offices',
    definition: 'Independent representation of children.',
  },
  {
    key: 'budget',
    name: "Children's budgeting",
    shortName: 'Budgeting',
    definition: 'Transparent assessment of investment in children.',
  },
];

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

// Question text for each detail column, taken from the Codebook. Where the Codebook's
// question text is shifted against the variable names (the three cabinet leader
// columns), the variable name wins — see docs/PROGRESS.md, Task 02.
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

// Task 08 builds the table from this list. `short` is the mobile header.
const TABLE_COLUMNS = [
  { id: 'city', label: 'City', short: 'City', type: 'text' },
  { id: 'state', label: 'State', short: 'State', type: 'text' },
  { id: 'region', label: 'Region', short: 'Region', type: 'text' },
  { id: 'populationSize', label: 'Population size', short: 'Population', type: 'ordinal' },
  { id: 'ccgCount', label: 'Practices in place', short: 'Practices', type: 'number' },
  ...PRACTICES.map((practice) => ({
    id: `practices.${practice.key}.status`,
    label: practice.name,
    short: practice.shortName,
    type: 'status',
  })),
];

// Columns visible on narrow screens; the rest live in the expandable row detail (O1).
const MOBILE_COLUMN_IDS = ['city', 'state', 'ccgCount'];

export function buildMeta() {
  return {
    practices: PRACTICES,
    labels: {
      status: STATUS_LABELS,
      mandate: MANDATE_LABELS,
      detail: DETAIL_LABELS,
      detailQuestion: DETAIL_QUESTIONS,
      region: { no_response: 'No response' },
      populationSize: { no_response: 'No response' },
    },
    regions: REGIONS,
    stateNames: STATE_NAMES,
    populationBuckets: POPULATION_BUCKETS,
    tableColumns: TABLE_COLUMNS,
    mobileColumnIds: MOBILE_COLUMN_IDS,
  };
}
