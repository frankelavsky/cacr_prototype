// Loads the two shipped runtime files so `node --test` can exercise the app's pure
// helpers. They are classic scripts, not modules — there is no import to reach for —
// so each is evaluated with the one global it expects. `ccg-dashboard.js` exports its
// pure functions onto `module.exports` and skips init when there is no `document`.

import { readFileSync } from 'node:fs';

function evaluate(fileName, globalName, globalValue) {
  const source = readFileSync(new URL('../../src/' + fileName, import.meta.url), 'utf8');
  new Function(globalName, source)(globalValue);
  return globalValue;
}

export function loadData() {
  return evaluate('ccg-data.js', 'window', {}).CCG_DATA;
}

export function loadDashboard() {
  return evaluate('ccg-dashboard.js', 'module', { exports: {} }).exports;
}
