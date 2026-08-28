// Precomputed aggregates for the narrative "big numbers" and the map annotations.
// The runtime never recomputes these — it reads CCG_DATA.stats and renders.

import { PRACTICE_KEYS, isPresent } from './normalize.mjs';
import { POPULATION_BUCKETS, REGIONS } from './dataset.mjs';

const percent = (part, whole) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);

const tally = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));

export function buildStats(records) {
  const totalCities = records.length;

  const byPractice = {};
  for (const key of PRACTICE_KEYS) {
    const inPractice = records.filter((r) => r.practices[key].status === 'in_practice').length;
    const inPlanning = records.filter((r) => r.practices[key].status === 'in_planning').length;
    const notActive = records.filter((r) => r.practices[key].status === 'not_active').length;
    byPractice[key] = {
      inPractice,
      inPractice_pct: percent(inPractice, totalCities),
      inPlanning,
      inPlanning_pct: percent(inPlanning, totalCities),
      notActive,
      any: inPractice + inPlanning + notActive,
      any_pct: percent(inPractice + inPlanning + notActive, totalCities),
    };
  }

  const byCcgCount = tally([0, 1, 2, 3, 4, 5]);
  for (const record of records) byCcgCount[record.ccgCount] += 1;

  const byRegion = tally([...REGIONS, 'no_response']);
  for (const record of records) byRegion[record.region] += 1;

  const byPopulation = tally([...POPULATION_BUCKETS, 'no_response']);
  for (const record of records) byPopulation[record.populationSize] += 1;

  const byPopulationAndCcgCount = Object.fromEntries(
    [...POPULATION_BUCKETS, 'no_response'].map((bucket) => [bucket, tally([0, 1, 2, 3, 4, 5])])
  );
  for (const record of records) {
    byPopulationAndCcgCount[record.populationSize][record.ccgCount] += 1;
  }

  // "Has a practice but no policy behind it": at least one practice the city actually
  // has (in practice, in planning, or paused) that is explicitly not mandated.
  const citiesWithUnmandatedPractice = records.filter((record) =>
    PRACTICE_KEYS.some(
      (key) =>
        isPresent(record.practices[key].status) &&
        record.practices[key].mandate === 'not_mandated'
    )
  ).length;

  const citiesWithNoPractices = byCcgCount[0];
  const citiesWithAllPractices = byCcgCount[5];

  return {
    totalCities,
    byPractice,
    byCcgCount,
    byRegion,
    byPopulation,
    byPopulationAndCcgCount,
    citiesWithUnmandatedPractice,
    citiesWithUnmandatedPractice_pct: percent(citiesWithUnmandatedPractice, totalCities),
    citiesWithNoPractices,
    citiesWithNoPractices_pct: percent(citiesWithNoPractices, totalCities),
    citiesWithAllPractices,
    citiesWithAllPractices_pct: percent(citiesWithAllPractices, totalCities),
    statesRepresented: new Set(records.map((r) => r.state)).size,
  };
}
