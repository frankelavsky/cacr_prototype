// All geo math happens here, once, at build time (D1). The browser receives numbers:
// an x/y per city and two SVG path strings for the basemap. No geo library ships.

import { readFileSync } from 'node:fs';

import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';

// us-atlas states-albers-10m is pre-projected into this space, so city coordinates must
// be projected into the same one for the dots to land on the right states.
export const VIEWBOX_WIDTH = 975;
export const VIEWBOX_HEIGHT = 610;

// The scale/translate d3 uses to fit AlbersUsa to a 975x610 frame — the same values
// us-atlas used to pre-project the basemap.
export function createProjection() {
  return geoAlbersUsa()
    .scale(1300)
    .translate([VIEWBOX_WIDTH / 2, VIEWBOX_HEIGHT / 2]);
}

const round1 = (value) => Math.round(value * 10) / 10;

export class GeometryError extends Error {}

// Returns { x, y } or null when the point falls outside AlbersUsa coverage.
// AlbersUsa covers the 50 states and DC only — notably NOT Puerto Rico.
export function projectPoint(projection, lon, lat) {
  const point = projection([lon, lat]);
  if (!point) return null;
  const [x, y] = point;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: round1(x), y: round1(y) };
}

export function isInsideViewBox({ x, y }) {
  return x >= 0 && x <= VIEWBOX_WIDTH && y >= 0 && y <= VIEWBOX_HEIGHT;
}

// Shrinks "M123.4567,89.1234L..." to "M123.5,89.1L...". The basemap is decorative at this
// size; 1 decimal is well under a pixel and roughly halves the path strings.
function roundPathNumbers(pathString) {
  return pathString.replace(/-?\d+\.\d+/g, (match) => String(round1(Number(match))));
}

// Two paths: the state-boundary interior mesh (thin internal lines) and the nation
// outline. Drawing them separately lets CSS style borders and coastline differently.
export function buildBasemap(topojsonPath) {
  const topology = JSON.parse(readFileSync(topojsonPath, 'utf8'));
  const toPath = geoPath(null); // already projected — identity path generator

  const interiors = mesh(topology, topology.objects.states, (a, b) => a !== b);
  const nation = feature(topology, topology.objects.nation);

  const statesPath = roundPathNumbers(toPath(interiors));
  const nationPath = roundPathNumbers(toPath(nation));

  if (!statesPath.startsWith('M') || !nationPath.startsWith('M')) {
    throw new GeometryError('basemap paths are empty or malformed');
  }

  return {
    width: VIEWBOX_WIDTH,
    height: VIEWBOX_HEIGHT,
    statesPath,
    nationPath,
  };
}
