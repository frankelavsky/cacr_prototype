// Joins dataset records to gazetteer places and bakes x/y onto each record.
// Anything the matcher cannot resolve confidently must be answered in
// data/source/geo-overrides.json — the build fails rather than guessing.

import { readFileSync } from 'node:fs';

import { indexByGeoid, indexByPlaceKey, matchPlace } from './gazetteer.mjs';
import { createProjection, isInsideViewBox, projectPoint } from './geometry.mjs';

export class GeocodeError extends Error {}

export function readOverrides(overridesPath) {
  const parsed = JSON.parse(readFileSync(overridesPath, 'utf8'));
  const overrides = new Map();
  for (const [id, value] of Object.entries(parsed)) {
    if (id.startsWith('_')) continue;
    overrides.set(id, value);
  }
  return overrides;
}

function resolveOverride(override, byGeoid, id) {
  if (override.geoid) {
    const place = byGeoid.get(override.geoid);
    if (!place) {
      throw new GeocodeError(`geo-overrides.json: no gazetteer place with GEOID ${override.geoid} (for ${id})`);
    }
    return { lat: place.lat, lon: place.lon };
  }
  if (Number.isFinite(override.lat) && Number.isFinite(override.lon)) {
    return { lat: override.lat, lon: override.lon };
  }
  throw new GeocodeError(`geo-overrides.json: entry for ${id} needs either "geoid" or "lat"+"lon"`);
}

// Mutates each record with x/y (or nulls) and returns a report.
export function geocodeRecords(records, places, overrides) {
  const byPlaceKey = indexByPlaceKey(places);
  const byGeoid = indexByGeoid(places);
  const projection = createProjection();

  const methodCounts = { exact: 0, incorporated: 0, override: 0 };
  const unresolved = [];
  const outsideProjection = [];

  for (const record of records) {
    const override = overrides.get(record.id);
    let coordinates = null;

    if (override) {
      coordinates = resolveOverride(override, byGeoid, record.id);
      methodCounts.override += 1;
    } else {
      const match = matchPlace(byPlaceKey, record.city, record.state);
      if (!match.place) {
        unresolved.push({ id: record.id, city: record.city, state: record.state, reason: match.reason });
        record.x = null;
        record.y = null;
        continue;
      }
      coordinates = { lat: match.place.lat, lon: match.place.lon };
      methodCounts[match.method] += 1;
    }

    const point = projectPoint(projection, coordinates.lon, coordinates.lat);
    if (!point) {
      // AlbersUsa has no room for Puerto Rico. Keep the record — it is a real survey
      // response — but mark it as not placeable on this map.
      outsideProjection.push({ id: record.id, city: record.city, state: record.state });
      record.x = null;
      record.y = null;
      continue;
    }
    if (!isInsideViewBox(point)) {
      throw new GeocodeError(
        `${record.city}, ${record.state} projected to (${point.x}, ${point.y}), outside the viewBox`
      );
    }
    record.x = point.x;
    record.y = point.y;
  }

  if (unresolved.length > 0) {
    const lines = unresolved.map((item) => `  ${item.id}  (${item.city}, ${item.state}) — ${item.reason}`);
    throw new GeocodeError(
      `${unresolved.length} cities could not be matched to the gazetteer. ` +
        `Add each to data/source/geo-overrides.json:\n${lines.join('\n')}`
    );
  }

  return { methodCounts, outsideProjection };
}
