(function () {
  'use strict';

  // The markup is not built here. index.html (and the Drupal embed snippet cut from it)
  // holds every element that always exists, plus all author-written copy. This file
  // fills the empty slots in that markup from CCG_DATA, renders the parts whose number
  // depends on the data — bubbles, options, rows, legend entries — and wires the
  // controls. Slots are found by id or by a data-ccg-* attribute.

  // ==========================================================================
  // DATA ACCESS
  // ==========================================================================

  function getData() {
    return window.CCG_DATA || { generated: false };
  }

  function stats() {
    return state.data.stats || {};
  }

  function meta() {
    return state.data.meta || {};
  }

  function dataset() {
    return state.data.dataset || [];
  }

  // Every lookup goes through here: a slot the markup is missing is a broken embed, not
  // something to paper over with a silent null.
  function find(root, selector) {
    var node = root.querySelector(selector);
    if (!node) throw new Error('ccg-dashboard: no element matching ' + selector);
    return node;
  }

  function findAll(root, selector) {
    return Array.prototype.slice.call(root.querySelectorAll(selector));
  }

  // ==========================================================================
  // STATE
  // ==========================================================================

  var state = {};

  // The two cities Map 1 used to call out. Map 1 is gone; they open the page as pinned
  // cities instead, so the page still starts by showing a very small city and a very
  // large one that both report all five practices. Unpinning them is allowed.
  var DEFAULT_PINS = ['coffman-cove--ak', 'nashville--tn'];

  // Four is what the map can label legibly: each callout needs a box of clear space, and
  // the fifth one starts covering cities the reader is trying to see.
  var MAX_PINS = 4;

  // One object drives everything: the map, the table and both status lines read it.
  // `practices` holds practice keys and means "reports at least all of these";
  // `pinned` holds record ids, in the order they were pinned.
  var DEFAULT_FILTERS = {
    practices: [],
    sizeBucket: 'all',
    query: '',
    pinned: DEFAULT_PINS.slice()
  };

  function createStore(initial) {
    var current = initial;
    var listeners = [];

    return {
      get: function () {
        return current;
      },
      set: function (partial) {
        current = Object.assign({}, current, partial);
        listeners.forEach(function (listener) {
          listener(current);
        });
      },
      subscribe: function (listener) {
        listeners.push(listener);
      }
    };
  }

  // ==========================================================================
  // FILTERS
  // ==========================================================================

  // One predicate, one meaning of "matches", for both views (D11). The map draws the
  // matching set plus the pinned cities; the table lists the same set with the pinned
  // cities lifted to the top.

  // A practice counts as reported when its status is one of the three CCG_count counts,
  // so the checkbox filter, the glyph row and the "Practices" number always describe the
  // same thing. The difference between "in practice", "in planning" and "not currently
  // active" is in the city profile, where there is room to state it (D5).
  var REPORTED_STATUSES = ['in_practice', 'in_planning', 'not_active'];

  function isReported(record, practiceKey) {
    var practice = record.practices[practiceKey];
    return Boolean(practice) && REPORTED_STATUSES.indexOf(practice.status) !== -1;
  }

  // Inclusive, not exclusive: checking three practices asks for cities reporting at least
  // those three, not cities reporting only those three. A city doing more is still an
  // answer to "who else has a youth council".
  function reportsEvery(record, practiceKeys) {
    return practiceKeys.every(function (key) {
      return isReported(record, key);
    });
  }

  // Accents are stripped on both sides so "Anasco" finds "Añasco": a reader typing on a
  // US keyboard cannot produce the accented form, and the national lookup is full of them.
  function fold(text) {
    return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function normalizeQuery(query) {
    return typeof query === 'string' ? fold(query).trim() : '';
  }

  // City, USPS code and state name in one string, so "athens oh" and "ohio" both work.
  function matchesQuery(record, query) {
    return fold(record.city + ' ' + record.state + ' ' + record.stateName).indexOf(query) !== -1;
  }

  function practiceKeys(filters) {
    return (filters && filters.practices) || [];
  }

  function matchesFilters(record, filters) {
    var settings = filters || {};
    var query = normalizeQuery(settings.query);

    if (!reportsEvery(record, practiceKeys(settings))) return false;
    if (settings.sizeBucket !== 'all' && record.populationIndex !== settings.sizeBucket) return false;
    if (query && !matchesQuery(record, query)) return false;
    return true;
  }

  function applyFilters(records, filters) {
    return records.filter(function (record) {
      return matchesFilters(record, filters);
    });
  }

  function hasActiveFilter(filters) {
    return practiceKeys(filters).length > 0 ||
      filters.sizeBucket !== 'all' ||
      normalizeQuery(filters.query) !== '';
  }

  function pinnedIds(filters) {
    return (filters && filters.pinned) || [];
  }

  function isPinned(filters, record) {
    return pinnedIds(filters).indexOf(record.id) !== -1;
  }

  // In pin order, not in dataset order: the reader put them there one at a time, and the
  // list they see should not reshuffle when they add one.
  function pinnedRecords(records, filters) {
    return pinnedIds(filters)
      .map(function (id) {
        return records.filter(function (record) {
          return record.id === id;
        })[0];
      })
      .filter(Boolean);
  }

  // ==========================================================================
  // PLACES WITH NO DATA
  // ==========================================================================

  // `us-cities.json` is every incorporated place the Census lists that the survey does not
  // cover — 31,743 of them. It is the absence of data rather than data, so these places
  // never appear in the default table, never reach the map, and are never counted in a
  // statistic. A search is the only thing that surfaces them, and every value they carry
  // reads "Unreported": D5's third case, never asked, as against asked-and-blank.

  // Three characters: "oh" would otherwise pull in several thousand places nobody was
  // looking for, and bury the fifteen Ohio cities that did answer.
  var NO_DATA_MIN_QUERY = 3;

  // Enough to show a reader their city is in there; not so many that the rows which
  // answer the question are buried under the rows that cannot.
  var NO_DATA_LIMIT = 25;

  function noDataLabel(part) {
    var labels = (meta().labels || {}).noData || {};
    return labels[part] || (part === 'flag' ? '(No Data)' : 'Unreported');
  }

  function isNoData(record) {
    return Boolean(record && record.noData);
  }

  // The same shape a surveyed record has, so every stage downstream — sorting, paging,
  // rendering — treats it as an ordinary row and only the places that must say
  // "Unreported" have to know the difference.
  function noDataRecord(city, stateCode, stateNames) {
    return {
      id: 'no-data--' + fold(city).replace(/[^a-z0-9]+/g, '-') + '--' + fold(stateCode),
      city: city,
      state: stateCode,
      stateName: (stateNames || {})[stateCode] || stateCode,
      region: null,
      populationSize: null,
      populationIndex: -1,
      ccgCount: null,
      practices: {},
      x: null,
      y: null,
      noData: true
    };
  }

  // Only a search reaches them, and only a search on its own: a practice or a size filter
  // asks a question about reported data, which these places by definition cannot answer.
  // Returns the capped rows and the full count, because the reader is owed both.
  function noDataMatches(places, filters, stateNames) {
    var query = normalizeQuery(filters && filters.query);
    var none = { shown: [], total: 0 };

    if (!places || query.length < NO_DATA_MIN_QUERY) return none;
    if (practiceKeys(filters).length > 0 || filters.sizeBucket !== 'all') return none;

    var names = stateNames || {};
    var shown = [];
    var total = 0;

    Object.keys(places).forEach(function (code) {
      var haystackState = ' ' + code + ' ' + (names[code] || code);
      places[code].forEach(function (city) {
        if (fold(city + haystackState).indexOf(query) === -1) return;
        total += 1;
        if (shown.length < NO_DATA_LIMIT) shown.push(noDataRecord(city, code, names));
      });
    });
    return { shown: shown, total: total };
  }

  // One scan per settled filter change, not one per subscriber: the status line and the
  // table both need this answer, and 31,743 names is not free.
  var noDataCache = { key: null, value: { shown: [], total: 0 } };

  function currentNoData(filters) {
    var key = [
      normalizeQuery(filters.query),
      practiceKeys(filters).join(','),
      filters.sizeBucket,
      state.places ? 'loaded' : 'pending'
    ].join('|');

    if (noDataCache.key !== key) {
      noDataCache = {
        key: key,
        value: noDataMatches(state.places, filters, meta().stateNames)
      };
    }
    return noDataCache.value;
  }

  // ==========================================================================
  // MAP RENDER
  // ==========================================================================

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Bubble area encodes the ordinal population bucket. Four hand-tuned radii in
  // viewBox units: big enough to read at 360px, small enough that the Northeast
  // stays legible.
  var BUBBLE_RADII = [3, 4.5, 6.5, 9.5];

  // One city reported no population size. It draws at the smallest radius and the
  // legend says so, rather than being silently folded into "under 10,000" (D5).
  var UNKNOWN_POPULATION_RADIUS = 3;

  // Six-step sequential ramp, hand-sampled from ColorBrewer Blues (no color library).
  // Adjacent steps differ by at least 1.28:1; the dark stroke every bubble carries is
  // what supplies the 3:1 non-text contrast against the map, not the fill.
  var COUNT_COLORS = ['#deebf7', '#b5d4ea', '#82badb', '#4f9bc9', '#2b76b0', '#08417e'];

  var ANNOTATION_RING_RADIUS = 13;

  // A callout is a ring on the city, a leader line and a label box. Map 1's two labels
  // sat in hand-measured empty space; a pin can land anywhere, so the box is placed at
  // run time: try the eight compass directions at growing distances and take the first
  // position that covers no bubble and no other label. Sizes are viewBox units, except
  // the width, which is a percentage because the label is HTML over the SVG.
  var PIN_LABEL_WIDTH_PCT = 18;
  var PIN_LABEL_HEIGHT = 80;
  var PIN_LABEL_GAP = 6;
  var PIN_BUBBLE_PADDING = 4;
  var PIN_LEADER_CLEARANCE = 5;

  var PIN_DIRECTIONS = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 0.7, y: 0.7 }, { x: 0.7, y: -0.7 }, { x: -0.7, y: 0.7 }, { x: -0.7, y: -0.7 }
  ];

  // Nearest first: a label two inches from its city is worse than one beside it.
  var PIN_DISTANCES = [26, 45, 70, 105, 150, 205, 270];

  function bubbleRadius(populationIndex) {
    var radius = BUBBLE_RADII[populationIndex];
    return typeof radius === 'number' ? radius : UNKNOWN_POPULATION_RADIUS;
  }

  function countColor(ccgCount) {
    var color = COUNT_COLORS[ccgCount];
    return typeof color === 'string' ? color : COUNT_COLORS[0];
  }

  function hasCoordinates(record) {
    return typeof record.x === 'number' && typeof record.y === 'number';
  }

  function svgElement(tagName) {
    return document.createElementNS(SVG_NS, tagName);
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function basemap() {
    return state.data.basemap || { width: 975, height: 610, nationPath: '', statesPath: '' };
  }

  // The markup ships the empty <svg> and its five children; the outline geometry is
  // written once here and never touched again. The viewBox comes from the data rather
  // than the markup, so a new basemap cannot leave a stale box behind.
  function paintBasemap(svg) {
    var geometry = basemap();
    svg.setAttribute('viewBox', '0 0 ' + geometry.width + ' ' + geometry.height);
    find(svg, '.ccg-map__land').setAttribute('d', geometry.nationPath);
    find(svg, '.ccg-map__states').setAttribute('d', geometry.statesPath);
    find(svg, '.ccg-map__outline').setAttribute('d', geometry.nationPath);
  }

  function bubble(record, radius, highlighted) {
    var circle = svgElement('circle');
    circle.setAttribute('class', 'ccg-map__bubble' + (highlighted ? ' is-highlighted' : ''));
    circle.setAttribute('cx', record.x);
    circle.setAttribute('cy', record.y);
    circle.setAttribute('r', radius);
    circle.setAttribute('fill', countColor(record.ccgCount));
    return circle;
  }

  // Pure: no state, no listeners, no tabindex. Redraws the city layer from `cities`.
  // options: { radiusScale: number, highlight: record => boolean }
  function renderMap(svg, cities, options) {
    var settings = options || {};
    var scale = typeof settings.radiusScale === 'number' ? settings.radiusScale : 1;
    var highlight = typeof settings.highlight === 'function' ? settings.highlight : null;
    var layer = find(svg, '.ccg-map__cities');

    clear(layer);
    cities
      .filter(hasCoordinates)
      // Largest first, so a >200,000 bubble never buries a small city drawn under it.
      .slice()
      .sort(function (a, b) {
        return bubbleRadius(b.populationIndex) - bubbleRadius(a.populationIndex);
      })
      .forEach(function (record) {
        var radius = bubbleRadius(record.populationIndex) * scale;
        layer.appendChild(bubble(record, radius, highlight ? highlight(record) : false));
      });
  }

  // --------------------------- pin callouts ---------------------------------

  // Leader line stops at the ring rather than at the city center, so it never draws
  // across the bubble it is pointing at.
  function leaderLine(from, record) {
    var dx = record.x - from.x;
    var dy = record.y - from.y;
    var length = Math.sqrt(dx * dx + dy * dy) || 1;

    var line = svgElement('line');
    line.setAttribute('class', 'ccg-map__leader');
    line.setAttribute('x1', from.x);
    line.setAttribute('y1', from.y);
    line.setAttribute('x2', record.x - (dx / length) * ANNOTATION_RING_RADIUS);
    line.setAttribute('y2', record.y - (dy / length) * ANNOTATION_RING_RADIUS);
    return line;
  }

  function annotationRing(record) {
    var ring = svgElement('circle');
    ring.setAttribute('class', 'ccg-map__ring');
    ring.setAttribute('cx', record.x);
    ring.setAttribute('cy', record.y);
    ring.setAttribute('r', ANNOTATION_RING_RADIUS);
    return ring;
  }

  // Label text is generated from the record, so a pinned city says the same kinds of
  // things the two hand-written callouts used to say, for any city the reader picks.
  function populationPhrase(record) {
    var bucket = record.populationSize;
    if (typeof bucket !== 'string' || bucket === 'no_response') return 'population not reported';
    if (bucket.charAt(0) === '<') return 'under ' + bucket.slice(1) + ' people';
    if (bucket.charAt(0) === '>') return 'over ' + bucket.slice(1) + ' people';
    return bucket + ' people';
  }

  function countPhrase(record) {
    if (record.ccgCount === 0) return 'none of the five practices';
    if (record.ccgCount === 5) return 'all five of the practices';
    return record.ccgCount + ' of the five practices';
  }

  function pinFact(record) {
    return populationPhrase(record) + ', and ' + countPhrase(record);
  }

  // Only read in the stacked layout, where there is no leader line to follow.
  function pinWhere(record) {
    if (!hasCoordinates(record)) {
      return 'Not on the map \u2014 ' + record.stateName + ' falls outside the projection this map uses.';
    }
    return 'Circled in ' + record.stateName + '.';
  }

  function boxCovers(box, point, padding) {
    return point.x >= box.left - padding &&
      point.x <= box.left + box.width + padding &&
      point.y >= box.top - padding &&
      point.y <= box.top + box.height + padding;
  }

  function boxesOverlap(a, b, gap) {
    return !(a.left + a.width + gap < b.left ||
      b.left + b.width + gap < a.left ||
      a.top + a.height + gap < b.top ||
      b.top + b.height + gap < a.top);
  }

  // Distance to the segment, not to the infinite line: a leader that stops short of a
  // bubble has not crossed it.
  function distanceToSegment(point, from, to) {
    var dx = to.x - from.x;
    var dy = to.y - from.y;
    var lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y);

    var t = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
  }

  // The leader starts at the point on the box closest to the city, so the line is as
  // short as the placement allows and never starts behind the label.
  function leaderAnchor(box, record) {
    return {
      x: Math.max(box.left, Math.min(record.x, box.left + box.width)),
      y: Math.max(box.top, Math.min(record.y, box.top + box.height))
    };
  }

  function calloutBox(record, direction, distance, size, bounds) {
    var left;
    var top;

    if (direction.x > 0) left = record.x + direction.x * distance;
    else if (direction.x < 0) left = record.x + direction.x * distance - size.width;
    else left = record.x - size.width / 2;

    if (direction.y > 0) top = record.y + direction.y * distance;
    else if (direction.y < 0) top = record.y + direction.y * distance - size.height;
    else top = record.y - size.height / 2;

    // Slid back inside rather than thrown away: a city near the edge — Coffman Cove sits
    // 40 units from the bottom — would otherwise reject every position beside it and take
    // a label halfway across the country.
    return {
      left: Math.max(0, Math.min(left, bounds.width - size.width)),
      top: Math.max(0, Math.min(top, bounds.height - size.height)),
      width: size.width,
      height: size.height
    };
  }

  // Candidate step for the fallback scan. Small enough to find the gaps the eight
  // directions miss, large enough that the whole map is a few thousand candidates.
  var PIN_SCAN_STEP = 12;

  function calloutSpot(box, record, geometry) {
    return {
      box: box,
      leader: leaderAnchor(box, record),
      left: (box.left / geometry.width) * 100,
      top: (box.top / geometry.height) * 100,
      width: PIN_LABEL_WIDTH_PCT
    };
  }

  // `clean` asks for a leader line that passes no other bubble. Nothing on the east coast
  // can satisfy that with 382 bubbles drawn, so it is a preference, not a requirement.
  function boxFits(box, record, cities, placed, clean) {
    if (boxCovers(box, record, 0)) return false;
    if (coversAnyCity(box, cities)) return false;
    if (overlapsPlaced(box, placed)) return false;
    if (!clean) return true;
    return !leaderCrossesCity(leaderAnchor(box, record), record, cities);
  }

  // Every box the map can hold, nearest to the city first. Only reached when all eight
  // directions land on a bubble — the dense northeast, or a city hemmed in by the coast —
  // and it is what keeps a callout beside its city rather than across the country.
  function scanForCallout(record, cities, placed, geometry, size, clean) {
    var candidates = [];

    for (var left = 0; left <= geometry.width - size.width; left += PIN_SCAN_STEP) {
      for (var top = 0; top <= geometry.height - size.height; top += PIN_SCAN_STEP) {
        candidates.push({
          left: left,
          top: top,
          width: size.width,
          height: size.height,
          distance: Math.hypot(left + size.width / 2 - record.x, top + size.height / 2 - record.y)
        });
      }
    }

    candidates.sort(function (a, b) {
      return a.distance - b.distance;
    });

    for (var i = 0; i < candidates.length; i += 1) {
      if (boxFits(candidates[i], record, cities, placed, clean)) return candidates[i];
    }
    return null;
  }

  // Pure, and exported for `node --test`: given a city, the bubbles currently drawn and
  // the boxes already placed, say where this callout's label goes — or null when the map
  // has no room for it, which the caller renders as a stacked note instead.
  function placeCallout(record, cities, placed, geometry) {
    var size = {
      width: (PIN_LABEL_WIDTH_PCT / 100) * geometry.width,
      height: PIN_LABEL_HEIGHT
    };

    for (var d = 0; d < PIN_DISTANCES.length; d += 1) {
      for (var i = 0; i < PIN_DIRECTIONS.length; i += 1) {
        var box = calloutBox(record, PIN_DIRECTIONS[i], PIN_DISTANCES[d], size, geometry);
        if (boxFits(box, record, cities, placed, true)) return calloutSpot(box, record, geometry);
      }
    }

    // Nearest clear box with a clean leader; then, failing that, the nearest clear box at
    // all. A short line over a bubble or two still points at the right city, and it beats
    // dropping the label out of the map entirely.
    var found = scanForCallout(record, cities, placed, geometry, size, true) ||
      scanForCallout(record, cities, placed, geometry, size, false);
    return found ? calloutSpot(found, record, geometry) : null;
  }

  function coversAnyCity(box, cities) {
    return cities.some(function (city) {
      return hasCoordinates(city) && boxCovers(box, city, PIN_BUBBLE_PADDING);
    });
  }

  function overlapsPlaced(box, placed) {
    return placed.some(function (other) {
      return boxesOverlap(box, other, PIN_LABEL_GAP);
    });
  }

  // Cities inside the ring are the ones the ring is already pointing at, so the leader
  // passing near them is not a collision.
  function leaderCrossesCity(anchor, record, cities) {
    return cities.some(function (city) {
      if (!hasCoordinates(city) || city.id === record.id) return false;
      if (Math.hypot(city.x - record.x, city.y - record.y) <= ANNOTATION_RING_RADIUS) return false;
      return distanceToSegment(city, anchor, record) < PIN_LEADER_CLEARANCE;
    });
  }

  // The label is always built, placed or not: below 780px every label is a note under the
  // map anyway, and an unplaceable one joins them there rather than vanishing.
  function calloutLabel(record, spot) {
    var note = element('p');
    note.className = 'ccg-map__annotation' + (spot ? '' : ' ccg-map__annotation--unplaced');

    if (spot) {
      note.style.setProperty('--ccg-annotation-left', spot.left + '%');
      note.style.setProperty('--ccg-annotation-top', spot.top + '%');
      note.style.setProperty('--ccg-annotation-width', spot.width + '%');
    }

    var name = element('span', cityLabel(record));
    name.className = 'ccg-map__annotation-city';
    note.appendChild(name);
    note.appendChild(document.createTextNode(' \u2014 ' + pinFact(record) + '. '));

    var where = element('span', pinWhere(record));
    where.className = 'ccg-map__annotation-where';
    note.appendChild(where);
    return note;
  }

  // Redrawn whenever the pins or the drawn cities change: placement depends on both.
  function renderCallouts(container, svg, records, cities) {
    var layer = find(svg, '.ccg-map__annotations');
    var geometry = basemap();
    var placed = [];

    clear(layer);
    findAll(container, '.ccg-map__annotation').forEach(function (node) {
      node.parentNode.removeChild(node);
    });

    records.forEach(function (record) {
      var spot = hasCoordinates(record) ? placeCallout(record, cities, placed, geometry) : null;

      if (spot) {
        placed.push(spot.box);
        layer.appendChild(leaderLine(spot.leader, record));
      }
      if (hasCoordinates(record)) layer.appendChild(annotationRing(record));
      container.appendChild(calloutLabel(record, spot));
    });
  }

  // A legend swatch is the same encoding the bubbles use, so its size and fill come from
  // the same two tables rather than from hand-written CSS that could drift from them.
  function legendDotSize(populationIndex) {
    return Math.round(bubbleRadius(populationIndex) * 2.2);
  }

  // The smallest bubble is also what a city that reported no population size is drawn at,
  // so that entry carries the marker for the note under the list. Pure, so the asterisk
  // cannot drift from the note without a test noticing.
  function legendBucketLabel(index, metaData) {
    var short = (metaData.populationBucketsShort || [])[index];
    var label = short || (metaData.populationBuckets || [])[index] || '';
    return index === 0 && label ? label + '*' : label;
  }

  function fillLegend(figure) {
    var metaData = meta();

    findAll(figure, '[data-ccg-bucket]').forEach(function (item) {
      var index = Number(item.getAttribute('data-ccg-bucket'));
      find(item, '.ccg-legend__dot').style.setProperty('--ccg-dot-size', legendDotSize(index) + 'px');
      find(item, '.ccg-legend__label').textContent = legendBucketLabel(index, metaData);
    });

    findAll(figure, '[data-ccg-count]').forEach(function (item) {
      var color = countColor(Number(item.getAttribute('data-ccg-count')));
      find(item, '.ccg-legend__dot').style.setProperty('--ccg-dot-fill', color);
    });
  }

  // Fills one of the two <figure>s the markup ships and hands back its <svg>, which is
  // the only node Map 2 needs to keep redrawing.
  function fillMapFigure(figure, options) {
    var svg = find(figure, '.ccg-map__svg');

    paintBasemap(svg);
    fillLegend(figure);
    renderMap(svg, options.cities, options.render);
    renderCallouts(find(figure, '.ccg-map'), svg, options.callouts || [], options.cities);
    find(figure, 'figcaption').textContent = options.caption;
    return svg;
  }

  // ==========================================================================
  // CAPTION
  // ==========================================================================

  // The captions are the accessible alternative to the two graphics, and they are
  // visible to everyone — nothing here is screen-reader-only.

  var CAPTION_DEBOUNCE_MS = 300;

  // Short enough to feel live while typing, long enough that a whole word is one write
  // to the two status lines rather than one per keystroke.
  var SEARCH_DEBOUNCE_MS = 150;

  function joinList(parts, separator) {
    if (parts.length < 2) return parts.join('');
    return parts.slice(0, -1).join(separator || ', ') + (separator || ' ') + 'and ' +
      parts[parts.length - 1];
  }

  function cityLabel(record) {
    return record.city + ', ' + record.state;
  }

  // Short names, lowercased for mid-sentence use: "cities reporting youth councils".
  // The caption generator takes its labels as an argument rather than reaching for
  // CCG_DATA, so `node --test` can drive it with no data loaded.
  function practiceNames(keys, metaData) {
    var practices = (metaData || {}).practices || [];
    return keys.map(function (key) {
      var found = practices.filter(function (practice) {
        return practice.key === key;
      })[0];
      return found ? found.shortName.charAt(0).toLowerCase() + found.shortName.slice(1) : key;
    });
  }

  // "Both" and "all of" carry the inclusive meaning of the checkboxes: every practice
  // checked has to be reported, and a city reporting more besides still counts.
  function practicePhrase(keys, metaData) {
    var names = practiceNames(keys, metaData);
    if (names.length === 0) return '';
    if (names.length === 1) return 'cities reporting ' + names[0];
    if (names.length === 2) return 'cities reporting both ' + names[0] + ' and ' + names[1];
    return 'cities reporting all of ' + joinList(names);
  }

  function sizePhrase(sizeBucket, buckets) {
    if (sizeBucket === 'all') return '';
    var label = buckets[sizeBucket];
    return label ? 'population ' + label : 'one population size';
  }

  function filterPhrase(filters, metaData) {
    var parts = [];
    var practices = practicePhrase(practiceKeys(filters), metaData);
    var size = sizePhrase(filters.sizeBucket, (metaData || {}).populationBuckets || []);
    var query = normalizeQuery(filters.query);

    if (practices) parts.push(practices);
    if (size) parts.push(size);
    if (query) parts.push('matching “' + query + '”');
    return parts.join(', ');
  }

  // Only sentence needed when the reader has not touched a control yet.
  function distributionSentence(statsData) {
    var byCount = statsData.byCcgCount || {};
    var mode = Object.keys(byCount).reduce(function (best, key) {
      return byCount[key] > byCount[best] ? key : best;
    }, Object.keys(byCount)[0]);
    var modeLabel = Number(mode) === 1 ? '1 practice' : mode + ' practices';

    return 'The most common answer is ' + modeLabel + ' (' + byCount[mode] + ' cities); ' +
      byCount[0] + ' report none of the five and ' + byCount[5] + ' report all five.';
  }

  // The whole distribution, never just the leader. Naming one winner meant breaking a tie
  // alphabetically and stating the result as fact — at 3 practices the South and the West
  // both hold 16 of 47, and the caption used to say the South.
  function regionTally(cities) {
    var counts = {};
    cities.forEach(function (record) {
      counts[record.region] = (counts[record.region] || 0) + 1;
    });

    // Count then name, so the same filtered set always reads the same way. "No response"
    // is not a region: it sorts last however many cities are in it.
    return Object.keys(counts)
      .sort(function (a, b) {
        if ((a === 'no_response') !== (b === 'no_response')) return a === 'no_response' ? 1 : -1;
        return counts[b] - counts[a] || a.localeCompare(b);
      })
      .map(function (region) {
        return { region: region, count: counts[region] };
      });
  }

  function regionPhrase(entry) {
    if (entry.region === 'no_response') return entry.count + ' with no region reported';
    return entry.count + ' in the ' + entry.region;
  }

  // Every count is stated, so a tie shows as a tie and a 36% plurality cannot read as
  // dominance the way "the most common region is the South" did. The lead-in is two words:
  // spelling out "spread across four regions" cost a whole line at 360px and the list
  // already says how many there are.
  function spreadSentence(tally) {
    return 'By region: ' + joinList(tally.map(regionPhrase)) + '.';
  }

  // One observation, chosen by a deliberately short rule table.
  function observationSentence(filters, cities, statsData) {
    if (cities.length === 1) return 'The only one is ' + cityLabel(cities[0]) + '.';
    if (!hasActiveFilter(filters)) return distributionSentence(statsData);

    var tally = regionTally(cities);
    if (tally.length === 1) {
      var all = cities.length === 2 ? 'Both' : 'All ' + cities.length;
      if (tally[0].region === 'no_response') return 'None of the ' + cities.length + ' reported a region.';
      return all + ' are in the ' + tally[0].region + '.';
    }
    return spreadSentence(tally);
  }

  // Matching records and plotted bubbles are not the same number, and the caption is the
  // only place a screen-reader user learns the difference.
  function unplottedSentence(cities) {
    var missing = cities
      .filter(function (record) {
        return !hasCoordinates(record);
      })
      // Named in a fixed order, like the region tally: the same set has to read the same
      // way however the array reached us.
      .sort(function (a, b) {
        return a.city.localeCompare(b.city) || a.state.localeCompare(b.state);
      });
    if (missing.length === 0) return '';

    return missing.length + (missing.length === 1 ? ' of them is' : ' of them are') +
      ' not on the map — ' + joinList(missing.map(cityLabel)) +
      (missing.length === 1 ? ' falls' : ' fall') + ' outside the projection this map uses.';
  }

  function showingSentence(filters, cities, statsData, metaData) {
    var plotted = cities.filter(hasCoordinates).length;
    if (!hasActiveFilter(filters)) return 'Showing all ' + statsData.totalCities + ' surveyed cities.';

    return 'Showing ' + plotted + ' of ' + statsData.totalCities + ' surveyed cities: ' +
      filterPhrase(filters, metaData) + '.';
  }

  // Pinned cities are drawn and circled whether or not they match, so the caption names
  // them — it is the only place a screen-reader user learns a callout exists at all.
  function pinSentence(pins) {
    if (pins.length === 0) return '';

    var described = pins.map(function (record) {
      return cityLabel(record) + ' \u2014 ' + pinFact(record);
    });
    var lead = pins.length === 1 ? 'One city is pinned and circled: ' :
      pins.length + ' cities are pinned and circled: ';
    return lead + joinList(described, '; ') + '.';
  }

  // A pin outranks a filter. Saying so is the difference between a map that looks wrong
  // and a map the reader understands.
  function pinsOutsideSentence(filters, pins, cities) {
    if (pins.length === 0 || !hasActiveFilter(filters)) return '';

    var shown = cities.map(function (record) {
      return record.id;
    });
    var outside = pins.filter(function (record) {
      return shown.indexOf(record.id) === -1;
    });
    if (outside.length === 0) return '';

    var names = joinList(outside.map(cityLabel));
    if (outside.length === 1) {
      return names + ' is pinned, so it stays on the map though it does not match these filters.';
    }
    return names + ' are pinned, so they stay on the map though they do not match these filters.';
  }

  // Pure. `metaData` is CCG_DATA.meta — it carries the practice names and the
  // index-to-label population buckets that `stats` does not. `pins` is the pinned
  // records, which are on the map in addition to `cities`.
  function mapCaption(filters, cities, statsData, metaData, pins) {
    var pinned = pins || [];

    if (cities.length === 0) {
      return [
        'No surveyed cities match: ' + filterPhrase(filters, metaData) +
          '. Try clearing a filter.',
        pinSentence(pinned)
      ].filter(Boolean).join(' ');
    }

    // The observation is computed over the plotted cities, not the matching records, so
    // every number in the caption counts the same set the reader is looking at. With
    // nothing plotted, the unplotted sentence has already named every match.
    var plotted = cities.filter(hasCoordinates);
    return [
      showingSentence(filters, cities, statsData, metaData),
      unplottedSentence(cities),
      plotted.length === 0 ? '' : observationSentence(filters, plotted, statsData),
      pinSentence(pinned),
      pinsOutsideSentence(filters, pinned, cities)
    ].filter(Boolean).join(' ');
  }

  // The one place the pure generator is handed the app's data.
  function currentMapCaption(filters, cities, pins) {
    return mapCaption(filters, cities, stats(), meta(), pins);
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(null, args);
      }, wait);
    };
  }

  // The live attributes go on after the first paint. A region that is already live when
  // it enters the accessibility tree can be announced on page load, which is exactly the
  // interruption this design is meant to avoid.
  function makeLive(node) {
    afterFirstPaint(function () {
      node.setAttribute('aria-live', 'polite');
      node.setAttribute('aria-atomic', 'true');
    });
  }

  function afterFirstPaint(fn) {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(fn, 0);
      return;
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(fn);
    });
  }

  // ==========================================================================
  // TABLE
  // ==========================================================================

  // One pure pipeline: records -> filter -> sort -> paginate -> render, with the pinned
  // cities lifted out before paging and put back on top of every page. Every stage takes
  // its inputs as arguments and returns a new array, so `node --test` can drive them
  // without a document. Every control reaches this pipeline now (D11).

  var DEFAULT_SORT = { column: 'city', direction: 'ascending' };

  // The four sortable columns, keyed by the `data-ccg-sort` value on the header cell.
  // `key` returns what to compare; `unranked` marks values the column cannot place —
  // only "No response" population, which has no size to rank.
  var SORT_COLUMNS = {
    city: { label: 'City', key: function (record) { return record.city; } },
    state: { label: 'State', key: function (record) { return record.state; } },
    populationSize: {
      label: 'Size',
      key: function (record) { return record.populationIndex; },
      unranked: function (record) { return record.populationIndex < 0; }
    },
    ccgCount: {
      label: 'Practices',
      key: function (record) { return record.ccgCount; },
      // A place with no data has no count to rank, the way "No response" has no size.
      unranked: function (record) { return record.ccgCount === null; }
    }
  };

  var FILLED_MARK = '●';
  var EMPTY_MARK = '○';

  // The table and the map now filter identically; this is the same call under a name the
  // table's pipeline reads well with.
  function filterRecords(records, filters) {
    return applyFilters(records, filters);
  }

  function compareValues(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
  }

  // City then state is the tiebreak for every column and it never reverses, so equal keys
  // keep one stable, readable order whichever way the sorted column points (D6).
  function sortRecords(records, sort) {
    var column = SORT_COLUMNS[sort && sort.column];
    if (!column) return records.slice();

    var direction = sort.direction === 'descending' ? -1 : 1;
    var unranked = column.unranked || function () { return false; };

    return records.slice().sort(function (a, b) {
      if (unranked(a) !== unranked(b)) return unranked(a) ? 1 : -1;
      return direction * compareValues(column.key(a), column.key(b)) ||
        a.city.localeCompare(b.city) ||
        a.state.localeCompare(b.state);
    });
  }

  function nextDirection(sort, columnId) {
    if (!sort || sort.column !== columnId) return 'ascending';
    return sort.direction === 'ascending' ? 'descending' : 'ascending';
  }

  function pageCount(total, perPage) {
    if (perPage === 'all') return 1;
    return Math.max(1, Math.ceil(total / perPage));
  }

  // `page` is clamped rather than trusted: a search can shrink the list under the page
  // the reader is on, and page 9 of 3 must resolve to a real page.
  function paginate(records, page, perPage) {
    var pages = pageCount(records.length, perPage);
    var current = Math.min(Math.max(page, 1), pages);
    var size = perPage === 'all' ? records.length : perPage;
    var start = (current - 1) * size;

    return {
      rows: records.slice(start, start + size),
      page: current,
      pageCount: pages,
      from: records.length === 0 ? 0 : start + 1,
      to: Math.min(start + size, records.length),
      total: records.length
    };
  }

  // Pinned cities are pulled out of the paged list and returned beside it: they head
  // every page, in pin order, whether or not they match the filters. Counting them in
  // the page total would make "rows 1-30 of 382" mean two different things on page 1 and
  // page 2, so the pager counts the rest and the status line names the pins separately.
  function tableView(records, tableState) {
    var filters = tableState.filters;
    var pinned = pinnedRecords(records, filters);
    var rest = filterRecords(records, filters).filter(function (record) {
      return !isPinned(filters, record);
    });
    var places = tableState.places || { shown: [], total: 0 };

    // Surveyed cities first, then the places with no data — sorted within each group, not
    // across them. One merged list would scatter the rows that answer the reader's
    // question among the rows that cannot.
    var ordered = sortRecords(rest, tableState.sort)
      .concat(sortRecords(places.shown, tableState.sort));

    var view = paginate(ordered, tableState.page, tableState.perPage);
    view.pinned = pinned;
    view.surveyed = rest.length;
    view.noData = places.shown.length;
    view.noDataTotal = places.total;
    return view;
  }

  function practiceList() {
    return meta().practices || [];
  }

  function practiceInitial(practice) {
    return practice.shortName.charAt(0);
  }

  function reportedPractices(record) {
    return practiceList().filter(function (practice) {
      return isReported(record, practice.key);
    });
  }

  function label(group, value) {
    var labels = (meta().labels || {})[group] || {};
    return labels[value] || value;
  }

  // The Size column and the map legend take the short form; the filter select and the
  // city profile keep the full one, where there is room and the exact bounds matter.
  function shortPopulation(record) {
    return label('populationSizeShort', record.populationSize);
  }

  // ------------------------------- row rendering ----------------------------

  function textCell(text) {
    return element('td', text);
  }

  // "10,001-50,000" has no break opportunity of its own — no line may break after a
  // hyphen that sits between digits — so the cell would set the column's width at its
  // full length. A <wbr> after the hyphen offers the one break the range should take.
  function populationCell(text) {
    var cell = element('td');
    var parts = text.split('-');

    parts.forEach(function (part, index) {
      if (index > 0) {
        cell.appendChild(document.createTextNode('-'));
        cell.appendChild(element('wbr'));
      }
      cell.appendChild(document.createTextNode(part));
    });
    return cell;
  }

  // Five fixed-width slots, in practice order. The header cell above carries the same
  // five slots holding the practice initials, so each glyph sits under its own letter —
  // that is what lets the column stay ~5em wide instead of repeating a label per row.
  function fillMarks(container, marks) {
    clear(container);
    marks.forEach(function (mark) {
      var slot = element('span', mark.text);
      slot.className = 'ccg-marks__mark' + (mark.reported ? ' is-reported' : '');
      container.appendChild(slot);
    });
    return container;
  }

  function markRow(marks) {
    var row = element('span');
    row.className = 'ccg-marks';
    row.setAttribute('aria-hidden', 'true');
    return fillMarks(row, marks);
  }

  function practiceMarksCell(record) {
    var cell = element('td');
    cell.className = 'ccg-table__marks';

    // Five empty circles would say "reported none of the five", which is a claim. A place
    // nobody surveyed has made no claim at all, so it gets dashes and says so in words.
    if (isNoData(record)) {
      cell.appendChild(markRow(practiceList().map(function () {
        return { text: '\u2013', reported: false };
      })));
      cell.appendChild(hiddenLabel(noDataLabel('value')));
      return cell;
    }

    cell.appendChild(markRow(practiceList().map(function (practice) {
      var reported = isReported(record, practice.key);
      return { text: reported ? FILLED_MARK : EMPTY_MARK, reported: reported };
    })));

    var names = reportedPractices(record).map(function (practice) {
      return practice.shortName;
    });
    var words = element('span', names.length === 0 ? 'None of the five' : joinList(names));
    words.className = 'ccg-visually-hidden';
    cell.appendChild(words);
    return cell;
  }

  function profileId(record) {
    return 'ccg-profile-' + record.id;
  }

  function detailsButton(record) {
    var button = element('button', 'Details');
    button.type = 'button';
    button.className = 'ccg-button ccg-button--small';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', profileId(record));

    // "Details" alone repeats 30 times in the button list; the city name makes each one
    // distinguishable without adding visible noise to a narrow column.
    var forCity = element('span', ' for ' + cityLabel(record));
    forCity.className = 'ccg-visually-hidden';
    button.appendChild(forCity);
    return button;
  }

  // aria-pressed, not a checkbox: pinning is a toggle on a thing, and the button's own
  // state is what a screen reader announces on the press the reader just made.
  function pinButton(record, pinned, atLimit) {
    var button = element('button', pinned ? 'Unpin' : 'Pin');
    button.type = 'button';
    button.className = 'ccg-button ccg-button--small ccg-button--pin';
    button.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    button.setAttribute('data-ccg-pin', record.id);

    if (!pinned && atLimit) {
      button.disabled = true;
      button.setAttribute('aria-describedby', 'ccg-pins-status');
    }

    var forCity = element('span', ' ' + cityLabel(record));
    forCity.className = 'ccg-visually-hidden';
    button.appendChild(forCity);
    return button;
  }

  function tableRow(record, options) {
    var settings = options || {};
    var row = element('tr');
    if (settings.pinned) row.className = 'ccg-table__row--pinned';

    var city = element('th', record.city);
    city.setAttribute('scope', 'row');
    // Position and a background colour are not available to a screen reader, and the row
    // is out of alphabetical order for a reason the reader deserves to hear.
    if (settings.pinned) city.appendChild(hiddenLabel(' (pinned)'));
    if (isNoData(record)) {
      var flag = element('span', ' ' + noDataLabel('flag'));
      flag.className = 'ccg-table__flag';
      city.appendChild(flag);
    }
    row.appendChild(city);

    row.appendChild(textCell(record.state));
    row.appendChild(populationCell(isNoData(record) ? noDataLabel('value') : shortPopulation(record)));
    row.appendChild(isNoData(record) ? unreportedCell() : textCell(String(record.ccgCount)));
    row.appendChild(practiceMarksCell(record));

    var actions = element('td');
    actions.className = 'ccg-table__actions';
    // Nothing to pin: a place with no data has nothing to compare and no bubble on the
    // map to circle.
    if (!isNoData(record)) {
      actions.appendChild(pinButton(record, Boolean(settings.pinned), Boolean(settings.atLimit)));
    }
    actions.appendChild(detailsButton(record));
    row.appendChild(actions);
    return row;
  }

  // An em dash carries nothing to a screen reader, so the word rides along hidden.
  function unreportedCell() {
    var cell = element('td');
    var mark = element('span', '\u2014');
    mark.className = 'ccg-table__unreported';
    mark.setAttribute('aria-hidden', 'true');
    cell.appendChild(mark);
    cell.appendChild(hiddenLabel(noDataLabel('value')));
    return cell;
  }

  // ------------------------------- city profile -----------------------------

  function field(list, term, description) {
    list.appendChild(element('dt', term));
    list.appendChild(element('dd', description));
  }

  // `ombuds_leadership` is free text with more than one answer allowed, so it arrives as
  // an array of the respondent's own words rather than as a coded value with a label.
  function detailValue(value) {
    if (Array.isArray(value)) return joinList(value);
    return label('detail', value);
  }

  function practiceProfile(record, practice) {
    var reported = record.practices[practice.key] || {};
    var block = element('div');
    block.className = 'ccg-profile__practice';
    block.appendChild(element('h4', practice.name));

    var fields = element('dl');
    fields.className = 'ccg-profile__fields';

    // Every field, still named, so the profile of a place with no data has the same shape
    // as the profile of a city that answered — and the difference is stated, not implied
    // by an empty space.
    if (isNoData(record)) {
      field(fields, 'Status', noDataLabel('value'));
      field(fields, 'Mandate', noDataLabel('value'));
      block.appendChild(fields);
      return block;
    }

    field(fields, 'Status', label('status', reported.status));
    field(fields, 'Mandate', label('mandate', reported.mandate));
    Object.keys(reported.details || {}).forEach(function (key) {
      field(fields, label('detailQuestion', key), detailValue(reported.details[key]));
    });

    block.appendChild(fields);
    return block;
  }

  // The one action for a place nobody has reported for. Its own sentence, because "help
  // us report" is a different ask from "tell us we got your city wrong".
  function noDataCall(record) {
    var note = element(
      'p',
      '[FILLER: this city has no data reported. Would you like to get involved and help report?] '
    );
    note.className = 'ccg-profile__cta';

    var link = element('a', '[FILLER: link placeholder]');
    link.className = 'ccg-cta';
    link.href = '#';
    link.appendChild(hiddenLabel(' for ' + cityLabel(record)));

    note.appendChild(link);
    return note;
  }

  // First thing under the city's name: the one action a reader can take about this city.
  // The link is a get-involved page elsewhere on UNICEF USA's site (O3) — this page has no
  // backend and hosts no form. Every row builds one, so the city name rides along hidden:
  // thirty links all reading "[FILLER: link text]" would be thirty identical links.
  function profileCall(record) {
    var note = element('p', '[FILLER: Want to get involved? See changes you would like to make?] ');
    note.className = 'ccg-profile__cta';

    var link = element('a', '[FILLER: link text]');
    link.className = 'ccg-cta';
    link.href = '#';
    link.appendChild(hiddenLabel(' for ' + cityLabel(record)));

    note.appendChild(link);
    return note;
  }

  function cityProfile(record) {
    var missing = isNoData(record);
    var profile = element('div');
    profile.className = 'ccg-profile' + (missing ? ' ccg-profile--no-data' : '');
    profile.appendChild(element('h3', cityLabel(record) + (missing ? ' ' + noDataLabel('flag') : '')));
    profile.appendChild(missing ? noDataCall(record) : profileCall(record));

    var facts = element('dl');
    facts.className = 'ccg-profile__fields';
    field(facts, 'Region', missing ? noDataLabel('value') : label('region', record.region));
    field(facts, 'Population size',
      missing ? noDataLabel('value') : label('populationSize', record.populationSize));
    field(facts, 'Practices reported',
      missing ? noDataLabel('value') : String(record.ccgCount));
    profile.appendChild(facts);

    practiceList().forEach(function (practice) {
      profile.appendChild(practiceProfile(record, practice));
    });
    return profile;
  }

  // Built on first expand, not on render: with "All" rows showing, eagerly building 384
  // profiles is 384 x 5 practices of DOM nobody has asked to see.
  function profileRow(record, columnCount) {
    var row = element('tr');
    row.className = 'ccg-table__profile-row';
    row.id = profileId(record);
    row.hidden = true;

    var cell = element('td');
    cell.setAttribute('colspan', String(columnCount));
    row.appendChild(cell);
    return row;
  }

  function toggleProfile(button, row, record) {
    var expanded = button.getAttribute('aria-expanded') === 'true';
    if (!expanded && !row.firstChild.firstChild) {
      row.firstChild.appendChild(cityProfile(record));
    }
    button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    row.hidden = expanded;
  }

  // The whole body is rebuilt on every change. It is at most 384 rows of five short
  // cells, and it keeps one render path instead of a diff — the cost is that open city
  // profiles close when the page, size or search changes, which is stated in the copy.
  // `options` carries the pin state and the pin toggle, which every row needs.
  function renderRows(body, rows, columnCount, options) {
    var settings = options || {};
    clear(body);

    rows.forEach(function (entry) {
      var record = entry.record || entry;
      var row = tableRow(record, { pinned: entry.pinned, atLimit: settings.atLimit });
      var profile = profileRow(record, columnCount);
      var details = find(row, '[aria-controls]');
      // A place with no data has no Pin button; every surveyed row does.
      var pin = row.querySelector('[data-ccg-pin]');

      details.addEventListener('click', function () {
        toggleProfile(details, profile, record);
      });
      if (pin) {
        pin.addEventListener('click', function () {
          settings.onPin(record);
        });
      }

      body.appendChild(row);
      body.appendChild(profile);
    });
  }

  // ------------------------------- table shell ------------------------------

  var SORT_ARROWS = { ascending: '▲', descending: '▼', none: '↕' };

  function hiddenLabel(text) {
    var node = element('span', text);
    node.className = 'ccg-visually-hidden';
    return node;
  }

  // APG sortable-table pattern: the button is inside the header cell and aria-sort lives
  // on the cell — both shipped in the markup. The column id is the cell's data-ccg-sort.
  function sortCells(head) {
    return findAll(head, '[data-ccg-sort]');
  }

  function wireSortButtons(head, onSort) {
    sortCells(head).forEach(function (cell) {
      find(cell, '.ccg-table__sort').addEventListener('click', function () {
        onSort(cell.getAttribute('data-ccg-sort'));
      });
    });
  }

  // Exactly one column is sorted at a time: every other header says so explicitly rather
  // than leaving the attribute off, so the state is never ambiguous. The arrow is a
  // second, non-color signal of the same state.
  function renderSortState(head, sort) {
    sortCells(head).forEach(function (cell) {
      var sorted = Boolean(sort) && sort.column === cell.getAttribute('data-ccg-sort');
      var value = sorted ? sort.direction : 'none';

      cell.setAttribute('aria-sort', value);
      find(cell, '.ccg-table__sort-arrow').textContent = SORT_ARROWS[value];
      cell.classList.toggle('is-sorted', sorted);
    });
  }

  function fillPracticeInitials(container) {
    fillMarks(container, practiceList().map(function (practice) {
      return { text: practiceInitial(practice) };
    }));
  }

  // The initial-to-name key under the "Which practices" column. The glyph sentence above
  // it is static copy in the markup; only the five names come from the data.
  function fillPracticeKey(list) {
    clear(list);
    practiceList().forEach(function (practice) {
      var item = element('li');
      item.className = 'ccg-table-legend__item';

      var initial = element('span', practiceInitial(practice));
      initial.className = 'ccg-table-legend__initial';
      item.appendChild(initial);
      item.appendChild(element('span', practice.shortName));
      list.appendChild(item);
    });
  }

  // ------------------------------- status line ------------------------------

  function rangeSentence(view) {
    if (view.total === 0) return 'No cities to show.';
    if (view.from === 1 && view.to === view.total) {
      return 'Showing all ' + cityCount(view.total) + '.';
    }
    return 'Showing rows ' + view.from + '–' + view.to + ' of ' + view.total + '.';
  }

  function matchSentence(query, total) {
    if (!query) return '';
    if (total === 0) return 'No surveyed city matches “' + query + '”.';
    return (total === 1 ? '1 city matches ' : total + ' cities match ') + '“' + query + '”.';
  }

  // Counted apart from the cities: they are rows, but they are not matches for a question
  // about reported practices.
  function noDataRowsSentence(view) {
    if (!view.noData) return '';
    if (view.noData === 1) return '1 place with no data reported is listed below.';
    return view.noData + ' places with no data reported are listed below.';
  }

  function sortSentence(sort) {
    var column = SORT_COLUMNS[sort && sort.column];
    return column ? 'Sorted by ' + column.label + ', ' + sort.direction + '.' : '';
  }

  // Pinned rows sit above the paged ones on every page, so the count the pager reports
  // and the number of rows on screen differ by exactly this many.
  function pinnedRowsSentence(pinned) {
    if (!pinned || pinned.length === 0) return '';
    if (pinned.length === 1) return '1 pinned city is above them.';
    return pinned.length + ' pinned cities are above them.';
  }

  // Counts, not records, so the sentence can be tested without building 25 rows.
  function noDataSentence(places) {
    if (!places || !places.total) return '';

    var lead = places.total === 1 ?
      '1 place in the United States has no data reported' :
      places.total + ' places in the United States have no data reported';

    if (places.total > places.shown) return lead + '; the first ' + places.shown + ' are in the table.';
    return lead + (places.shown === 1 ? ', and it is' : ', and they are') + ' in the table.';
  }

  function tableStatusText(view, tableState) {
    var query = normalizeQuery(tableState.filters.query);
    var paged = view.from !== 1 || view.to !== view.total;

    return [
      // The surveyed count, not the row count: a place with no data is a row, but it is
      // not a city that matched.
      matchSentence(query, view.surveyed),
      // "15 cities match" already says how many there are; the range only earns its
      // place when the reader is on one page of several.
      query && !paged ? '' : rangeSentence(view),
      noDataRowsSentence(view),
      pinnedRowsSentence(view.pinned),
      sortSentence(tableState.sort)
    ].filter(Boolean).join(' ');
  }

  // Reported under the controls, where it is visible to everyone: the map is above them
  // on a phone, so this is the only place a reader learns it changed (D9). It names the
  // count, not the filters — the controls are directly above it, and the map caption
  // already describes the set in full.
  function resultStatusText(filters, matches, totalCities, places) {
    var query = normalizeQuery(filters.query);
    var others = practiceKeys(filters).length > 0 || filters.sizeBucket !== 'all';
    var without = noDataSentence(places);

    if (!hasActiveFilter(filters)) {
      return 'Showing all ' + cityCount(totalCities) +
        '. Check a practice, choose a size, or search to narrow the map above and the table below.';
    }

    // The verb follows the subject: one city matches, several cities match.
    function sentence(subject, plural) {
      var verb = plural ? ' match' : ' matches';
      var what = query ?
        ' “' + query + '”' + (others ? ' with these filters' : '') :
        ' these filters';
      return subject + verb + what;
    }

    if (matches === 0) {
      return [sentence('No surveyed city', false) + '.', without].filter(Boolean).join(' ');
    }
    return [
      sentence(matches === 1 ? '1 city' : matches + ' cities', matches !== 1) +
        ' — shown on the map above and in the table below.',
      without
    ].filter(Boolean).join(' ');
  }

  // The visible line above the table: what pinning did, and why a Pin button is disabled.
  function pinStatusText(pins, limit) {
    if (pins.length === 0) {
      return 'No cities are pinned. Pinning one keeps it at the top of the table and circles it on the map.';
    }

    var lead = pins.length === 1 ? '1 pinned city stays' : pins.length + ' pinned cities stay';
    var text = lead + ' at the top of the table and circled on the map: ' +
      joinList(pins.map(cityLabel)) + '.';

    if (pins.length >= limit) {
      text += ' That is the limit of ' + limit + ' — unpin one to pin another.';
    }
    return text;
  }

  // --------------------------- city not found (Task 09) ---------------------------

  // 380KB of place names is not worth downloading for the readers who find their city on
  // the first try, so the list is fetched on the first miss and never again.
  var LOOKUP_LIMIT = 8;
  var lookupRequest = null;

  function lookupUrl() {
    var mount = document.getElementById('ccg-dashboard');
    var base = (mount && mount.getAttribute('data-base-url')) || '';
    return base ? base.replace(/\/+$/, '') + '/us-cities.json' : 'us-cities.json';
  }

  // Resolves to the place list, or to null when it cannot be had — over file:// the fetch
  // fails, and the fallback message is still worth showing without it.
  function loadCityLookup() {
    if (lookupRequest) return lookupRequest;

    lookupRequest = fetch(lookupUrl())
      .then(function (response) {
        if (!response.ok) throw new Error('us-cities.json: ' + response.status);
        return response.json();
      })
      .catch(function () {
        return null;
      });
    return lookupRequest;
  }

  function findPlaces(cities, query, stateNames) {
    if (!cities) return null;
    var names = stateNames || {};
    var matches = [];

    Object.keys(cities).forEach(function (code) {
      var haystackState = ' ' + code + ' ' + (names[code] || code);
      cities[code].forEach(function (city) {
        if (fold(city + haystackState).indexOf(query) !== -1) matches.push(city + ', ' + code);
      });
    });
    return matches.sort();
  }

  function learnMoreLink(place) {
    var link = element('a', '[FILLER: learn and do more]');
    link.className = 'ccg-cta';
    link.href = '#';
    if (place) link.appendChild(hiddenLabel(' about ' + place));
    return link;
  }

  // An empty table has two very different causes, and saying the wrong one is a lie:
  // the city may simply not be in the survey, or it may be sitting behind a filter the
  // reader set (D11). This branch is the second one, and it never fetches the national
  // list — the city we are talking about is right here in the data.
  function filteredOutText(filters, withoutFilters) {
    var query = normalizeQuery(filters.query);

    if (!query) return 'No surveyed city matches these filters.';

    var lede = 'No surveyed city matches “' + query + '” with these filters.';
    if (withoutFilters === 0) return lede;
    return lede + ' ' + (withoutFilters === 1 ? '1 city matches' : withoutFilters + ' cities match') +
      ' “' + query + '” once the filters are cleared.';
  }

  // The block serves both empty states, so the parts that belong to one of them are
  // shown or hidden here rather than being two blocks that can drift apart.
  function setNotFoundMode(region, mode) {
    findAll(region, '[data-ccg-not-found="missing-note"]').forEach(function (node) {
      node.hidden = mode !== 'missing';
    });
    find(region, '[data-ccg-not-found="reset"]').hidden = mode !== 'filtered';
  }

  function renderFilteredOut(region, text) {
    find(region, '[data-ccg-not-found="lede"]').textContent = text;
    clear(find(region, '[data-ccg-not-found="lookup"]'));
    setNotFoundMode(region, 'filtered');
  }

  // The region's two paragraphs are in the markup; only the first one's text and the
  // lookup results below them are written here. `places` is null while the list is still
  // loading or when it could not be loaded at all — the difference is that the second
  // case never gets a list, so it gets the link.
  function renderNotFound(region, query, places, settled) {
    setNotFoundMode(region, 'missing');
    find(region, '[data-ccg-not-found="lede"]').textContent =
      'No surveyed city matches “' + query + '”.';

    var lookup = find(region, '[data-ccg-not-found="lookup"]');
    clear(lookup);
    if (!settled) return;

    if (!places || places.length === 0) {
      lookup.appendChild(learnMoreLink(null));
      return;
    }

    var shown = places.slice(0, LOOKUP_LIMIT);
    lookup.appendChild(element('p', placesHeading(shown.length, places.length)));

    var list = element('ul');
    list.className = 'ccg-not-found__list';
    shown.forEach(function (place) {
      var item = element('li');
      item.className = 'ccg-not-found__item';
      item.appendChild(element('span', place));
      item.appendChild(learnMoreLink(place));
      list.appendChild(item);
    });
    lookup.appendChild(list);
  }

  function placesHeading(shown, total) {
    if (total === 1) return 'One place in the United States has a matching name:';
    if (shown < total) {
      return total + ' places in the United States have a matching name. The first ' +
        shown + ':';
    }
    return total + ' places in the United States have a matching name:';
  }

  function notFoundStatusText(query, places) {
    var opening = 'No surveyed city matches “' + query + '”.';
    if (places === null) return opening;
    if (places.length === 0) {
      return opening + ' No place in the United States has that name either.';
    }
    return opening + ' ' + placesHeading(Math.min(places.length, LOOKUP_LIMIT), places.length)
      .replace(/:$/, '.');
  }

  // ==========================================================================
  // WIRING
  // ==========================================================================

  // Elements are always built with createElement + textContent. Never assign
  // innerHTML from data-derived strings.
  function element(tagName, textContent) {
    var node = document.createElement(tagName);
    if (textContent) node.textContent = textContent;
    return node;
  }

  function cityCount(total) {
    return total + (total === 1 ? ' city' : ' cities');
  }

  // No submit button exists in either form, but Enter in a form still submits and would
  // reload the host page.
  function preventSubmit(event) {
    event.preventDefault();
  }

  // The big numbers in the intro copy: each slot names the CCG_DATA.stats key it shows,
  // so a stat can be moved or reworded in the markup without touching this file.
  function fillStats(root) {
    findAll(root, '[data-ccg-stat]').forEach(function (slot) {
      var value = stats()[slot.getAttribute('data-ccg-stat')];
      slot.textContent = value === undefined || value === null ? '' : String(value);
    });
  }

  // Names and definitions are authored in scripts/lib/meta.mjs and baked into CCG_DATA,
  // so the list is filled from there rather than duplicated in the markup.
  function fillPracticeDefinitions(list) {
    clear(list);
    practiceList().forEach(function (practice) {
      list.appendChild(element('dt', practice.name));
      list.appendChild(element('dd', practice.definition));
    });
  }

  function fillOptions(select, options) {
    clear(select);
    options.forEach(function (option) {
      var node = element('option', option.label);
      node.value = option.value;
      select.appendChild(node);
    });
  }

  // Option counts are read from CCG_DATA.stats, never written down here, so a data
  // refresh moves them without a code change.
  function practiceFilterOptions(metaData, statsData) {
    var byPractice = statsData.byPractice || {};

    return (metaData.practices || []).map(function (practice) {
      var reporting = (byPractice[practice.key] || {}).any || 0;
      var count = cityCount(reporting);
      return {
        value: practice.key,
        name: practice.name,
        count: count,
        // The two parts joined, which is what the row reads as to a screen reader.
        label: practice.name + ' (' + count + ')'
      };
    });
  }

  // Short labels here too (D20): the select, the table and the legend name a bucket the
  // same way, so a reader never has to work out that ">10k-50k" is "10,001-50,000".
  function populationOptions(metaData, statsData) {
    var byPopulation = statsData.byPopulation || {};
    var short = metaData.populationBucketsShort || [];
    var options = [{ value: 'all', label: 'All sizes (' + cityCount(statsData.totalCities) + ')' }];

    (metaData.populationBuckets || []).forEach(function (bucket, index) {
      options.push({
        value: String(index),
        label: (short[index] || bucket) + ' (' + cityCount(byPopulation[bucket]) + ')'
      });
    });
    return options;
  }

  // Selects carry strings; the store carries 'all' or a number, so one place converts.
  function toFilterValue(raw) {
    return raw === 'all' ? 'all' : Number(raw);
  }

  // One checkbox per practice, built from the data so the five names and their counts
  // cannot drift from CCG_DATA. A fieldset with a legend is the native grouping — no
  // role="group", no aria-labelledby.
  function fillPracticeCheckboxes(container, options, onChange) {
    clear(container);

    options.forEach(function (option) {
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.id = 'ccg-filter-practice-' + option.value;
      input.value = option.value;
      input.setAttribute('data-ccg-practice', option.value);
      input.addEventListener('change', onChange);

      // The <label> is the row, so every pixel of it toggles the box — and `for` still
      // names the control explicitly, rather than relying on the wrapping alone.
      var row = element('label');
      row.className = 'ccg-checkbox';
      row.setAttribute('for', input.id);

      var name = element('span', option.name || option.label);
      name.className = 'ccg-checkbox__name';

      row.appendChild(input);
      row.appendChild(name);

      if (option.count) {
        var count = element('span', option.count);
        count.className = 'ccg-checkbox__count';
        row.appendChild(count);
      }
      container.appendChild(row);
    });
  }

  // Pure: what the closed control reports. One practice is named; several are counted,
  // because five names do not fit on a summary line at 360px.
  function practiceSummaryText(keys, practices) {
    if (keys.length === 0) return 'Any';
    if (keys.length === 1) {
      var found = (practices || []).filter(function (practice) {
        return practice.key === keys[0];
      })[0];
      return found ? found.shortName : '1 selected';
    }
    return keys.length + ' selected';
  }

  // <details> is a disclosure, not a menu: it does not close on Escape or on an outside
  // click by itself, and a panel that overlays the page has to do both.
  function wireDropdown(details) {
    var summary = find(details, 'summary');

    details.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !details.open) return;
      details.open = false;
      // Focus would otherwise land on the body, losing the reader's place entirely.
      summary.focus();
    });

    document.addEventListener('click', function (event) {
      if (!details.open || details.contains(event.target)) return;
      details.open = false;
    });
  }

  function checkedPractices(container) {
    return findAll(container, '[data-ccg-practice]')
      .filter(function (input) {
        return input.checked;
      })
      .map(function (input) {
        return input.value;
      });
  }

  // Every control on the page writes to one store, and the store is the only thing the
  // map and the table read (D11).
  function wireFilters(root, store) {
    var records = dataset();
    var form = find(root, '[data-ccg-form="filters"]');
    var practices = find(form, '[data-ccg-options="practices"]');
    var practiceState = find(form, '[data-ccg-practice-summary]');
    var population = find(form, '#ccg-filter-population');
    var input = find(form, '#ccg-search-input');
    var status = find(root, '#ccg-result-status');

    fillPracticeCheckboxes(practices, practiceFilterOptions(meta(), stats()), function () {
      store.set({ practices: checkedPractices(practices) });
    });
    fillOptions(population, populationOptions(meta(), stats()));
    wireDropdown(find(form, '.ccg-dropdown'));

    makeLive(status);
    form.addEventListener('submit', preventSubmit);

    population.addEventListener('change', function () {
      store.set({ sizeBucket: toFilterValue(population.value) });
    });

    // One debounce for the whole search: the store is written once per settled input, so
    // every subscriber — this status line, the map and the table — updates in one tick.
    var publish = debounce(function (value) {
      store.set({ query: value });
    }, SEARCH_DEBOUNCE_MS);

    input.addEventListener('input', function () {
      publish(input.value);
    });

    function clearAll() {
      findAll(practices, '[data-ccg-practice]').forEach(function (box) {
        box.checked = false;
      });
      population.value = 'all';
      input.value = '';
      // Pins survive a filter reset on purpose: they are the reader's own shortlist,
      // not a filter.
      store.set({ practices: [], sizeBucket: 'all', query: '' });
    }

    find(form, '[data-ccg-action="clear-filters"]').addEventListener('click', function () {
      clearAll();
      input.focus();
    });

    // The "city not found" block owns a second copy of this control, because that is
    // where a reader discovers the filters are the reason they see nothing.
    findAll(root, '[data-ccg-action="clear-filters"]').forEach(function (button) {
      if (button.closest('[data-ccg-form="filters"]')) return;
      button.addEventListener('click', clearAll);
    });

    function showStatus(filters) {
      var places = currentNoData(filters);
      status.textContent = resultStatusText(
        filters,
        applyFilters(records, filters).length,
        stats().totalCities,
        { shown: places.shown.length, total: places.total }
      );
      // Driven from the store, not from the change event, so clearing the filters moves
      // the summary too.
      practiceState.textContent = practiceSummaryText(practiceKeys(filters), meta().practices);
    }

    store.subscribe(showStatus);
    showStatus(store.get());
  }

  // The map draws the matching cities plus every pinned city, whether or not the pinned
  // ones match: a callout pointing at a bubble that is not there is worse than a bubble
  // the filters would have hidden, and the caption says which is which.
  function drawnCities(records, filters) {
    var shown = applyFilters(records, filters);
    var shownIds = shown.map(function (record) {
      return record.id;
    });
    var extra = pinnedRecords(records, filters).filter(function (record) {
      return shownIds.indexOf(record.id) === -1;
    });
    return shown.concat(extra);
  }

  function setUpMap(root) {
    var records = dataset();
    var figure = find(root, '#ccg-map');
    var filters = state.filters.get();
    var caption = find(figure, 'figcaption');

    function draw(next) {
      var shown = applyFilters(records, next);
      var pins = pinnedRecords(records, next);
      return {
        cities: drawnCities(records, next),
        callouts: pins,
        caption: currentMapCaption(next, shown, pins),
        render: {
          highlight: function (record) {
            return isPinned(next, record);
          }
        }
      };
    }

    var first = draw(filters);
    var svg = fillMapFigure(figure, first);
    makeLive(caption);

    // One assignment, after the redraw: two writes would be announced twice. Debounced so
    // arrowing through a select announces where the reader stopped, not every option passed.
    var announce = debounce(function (text) {
      caption.textContent = text;
    }, CAPTION_DEBOUNCE_MS);

    state.filters.subscribe(function (next) {
      var view = draw(next);
      renderMap(svg, view.cities, view.render);
      renderCallouts(find(figure, '.ccg-map'), svg, view.callouts, view.cities);
      announce(view.caption);
    });
  }

  function toRowsPerPage(raw) {
    return raw === 'all' ? 'all' : Number(raw);
  }

  function wirePagination(root, tableState, onChange) {
    var node = find(root, '#ccg-table-pagination');
    var rows = find(node, '#ccg-table-rows');
    var previous = find(node, '[data-ccg-page="previous"]');
    var next = find(node, '[data-ccg-page="next"]');
    var count = find(node, '.ccg-pagination__count');

    // The starting page size is whichever <option> the markup marks selected.
    tableState.perPage = toRowsPerPage(rows.value);

    rows.addEventListener('change', function () {
      tableState.perPage = toRowsPerPage(rows.value);
      // Row 31 is on a different page at 100/page than it was at 30/page; page 1 is the
      // only landing spot that means the same thing at every size.
      tableState.page = 1;
      onChange(null);
    });

    previous.addEventListener('click', function () {
      tableState.page -= 1;
      onChange(previous);
    });
    next.addEventListener('click', function () {
      tableState.page += 1;
      onChange(next);
    });

    return {
      node: node,
      update: function (view) {
        count.textContent = 'Page ' + view.page + ' of ' + view.pageCount;
        previous.disabled = view.page <= 1;
        next.disabled = view.page >= view.pageCount;
      },
      // Disabling the button under the pointer would drop focus to the body; the reader
      // stays in the pagination controls by moving to the one still operable.
      keepFocus: function (clicked) {
        if (!clicked || !clicked.disabled) return;
        (clicked === previous ? next : previous).focus();
      }
    };
  }

  function wireTable(root) {
    var records = dataset();
    var tableState = state.table;

    var container = find(root, '#ccg-table-container');
    var table = find(container, '.ccg-table');
    var head = find(table, 'thead');
    var body = find(table, 'tbody');
    var legend = find(root, '.ccg-table-legend');
    var notFound = find(root, '.ccg-not-found');
    var status = find(root, '#ccg-table-status');
    var pinStatus = find(root, '#ccg-pins-status');
    var columnCount = head.rows[0].cells.length;

    fillPracticeInitials(find(head, '[data-ccg-practice-initials]'));
    fillPracticeKey(find(legend, '[data-ccg-practice-key]'));
    makeLive(status);

    wireSortButtons(head, function (columnId) {
      tableState.sort = { column: columnId, direction: nextDirection(tableState.sort, columnId) };
      // A different order makes "page 4" mean a different set of cities, so re-sorting
      // starts from the top of the new order.
      tableState.page = 1;
      update();
    });

    var pagination = wirePagination(root, tableState, function (clicked) {
      update();
      pagination.keepFocus(clicked);
    });

    // Pinning is a store write like any other, so the map redraws from the same event.
    // Focus stays on the button the reader pressed: it is still there after the rebuild,
    // in the pinned block at the top, and it now reads "Unpin".
    function togglePin(record) {
      var filters = state.filters.get();
      var pinned = pinnedIds(filters);

      var next = isPinned(filters, record) ?
        pinned.filter(function (id) {
          return id !== record.id;
        }) :
        pinned.concat([record.id]).slice(0, MAX_PINS);

      state.filters.set({ pinned: next });
      focusPin(record);
    }

    function focusPin(record) {
      var button = body.querySelector('[data-ccg-pin="' + record.id + '"]');
      if (button && !button.disabled) button.focus();
    }

    // 376KB is not worth downloading for a reader who never searches, so the list arrives
    // on the first search that could show it and the table re-renders when it lands.
    function ensurePlaces(filters) {
      if (state.places || state.placesRequested) return;
      if (normalizeQuery(filters.query).length < NO_DATA_MIN_QUERY) return;
      if (practiceKeys(filters).length > 0 || filters.sizeBucket !== 'all') return;

      // A flag, not an empty placeholder in `state.places`: the scan's cache key turns on
      // whether the list is loaded, and an empty object reads as loaded — which would
      // freeze the empty answer in place even after the real list arrived.
      state.placesRequested = true;
      loadCityLookup().then(function (cities) {
        if (!cities) return;
        state.places = cities;
        // Republished rather than re-rendered here: the status line under the controls
        // has to report the new rows too, and it is a different subscriber.
        state.filters.set({});
      });
    }

    // Bumped on every render, so a promise that resolves after the table has moved on can
    // tell that it has: the lookup and the place list share one request, and whichever
    // callback lands second used to overwrite the first one's work.
    var renderToken = 0;

    function update() {
      renderToken += 1;
      ensurePlaces(tableState.filters);
      tableState.places = currentNoData(tableState.filters);

      var view = tableView(records, tableState);
      // The page can be clamped by the pipeline; the buttons must reflect where we landed.
      tableState.page = view.page;

      var atLimit = view.pinned.length >= MAX_PINS;
      var rows = view.pinned
        .map(function (record) {
          return { record: record, pinned: true };
        })
        .concat(view.rows.map(function (record) {
          return { record: record, pinned: false };
        }));

      renderRows(body, rows, columnCount, { atLimit: atLimit, onPin: togglePin });
      renderSortState(head, tableState.sort);
      pagination.update(view);
      pinStatus.textContent = pinStatusText(view.pinned, MAX_PINS);

      // With no rows at all — nothing matching and nothing pinned — the table, its key
      // and its pager go away together: a legend for a table that is not there is noise.
      // A place with no data is still a row, so a search that finds one is not a miss.
      var empty = view.total === 0;
      var blank = empty && view.pinned.length === 0;

      legend.hidden = blank;
      container.hidden = blank;
      pagination.node.hidden = empty;
      notFound.hidden = !empty;

      if (!empty) {
        status.textContent = tableStatusText(view, tableState);
        return;
      }
      showEmptyState(tableState.filters);
    }

    // Two causes, two messages (D11). Only a genuine miss — a search that matches nothing
    // with no other filter set — is worth downloading 380KB of place names for.
    function showEmptyState(filters) {
      var query = normalizeQuery(filters.query);
      var narrowedByControls = practiceKeys(filters).length > 0 || filters.sizeBucket !== 'all';

      if (narrowedByControls) {
        var withoutFilters = query ?
          applyFilters(records, { practices: [], sizeBucket: 'all', query: query }).length : 0;
        var text = filteredOutText(filters, withoutFilters);

        renderFilteredOut(notFound, text);
        status.textContent = text;
        return;
      }
      showNotFound(query);
    }

    // The national list is fetched only here, on a miss. The status line is written once
    // the lookup has settled, so it announces one complete outcome rather than two.
    function showNotFound(query) {
      var token = renderToken;
      renderNotFound(notFound, query, null, false);
      loadCityLookup().then(function (cities) {
        if (token !== renderToken) return;
        if (normalizeQuery(state.filters.get().query) !== query) return;
        var places = findPlaces(cities, query, meta().stateNames);
        renderNotFound(notFound, query, places, true);
        status.textContent = notFoundStatusText(query, places);
      });
    }

    state.filters.subscribe(function (filters) {
      tableState.filters = filters;
      // A narrower list makes the current page number mean something else, so a new
      // search always starts at the top of its own results.
      tableState.page = 1;
      update();
    });

    update();
  }

  function hydrate(root) {
    fillStats(root);
    fillPracticeDefinitions(find(root, '[data-ccg-practice-definitions]'));
    setUpMap(root);
    wireFilters(root, state.filters);
    wireTable(root);
  }

  function init() {
    var mount = document.getElementById('ccg-dashboard');
    if (!mount) return;

    // This script fills markup it does not create. Without that markup — an embed that
    // pasted the scripts but not the block — there is nothing to hydrate.
    if (!mount.querySelector('#ccg-table-container')) {
      console.warn('ccg-dashboard: embed markup not found inside #ccg-dashboard.');
      return;
    }

    state.data = getData();
    // The places with no survey data, once a search has asked for them (never on load).
    state.places = null;
    state.placesRequested = false;
    // Every filter and the pin list are shared; the page starts with the two cities Map 1
    // used to call out already pinned, and drops any that a data refresh removed.
    state.filters = createStore(Object.assign({}, DEFAULT_FILTERS, {
      pinned: DEFAULT_PINS.filter(function (id) {
        return dataset().some(function (record) {
          return record.id === id;
        });
      })
    }));
    // Sort and page belong to the table alone (D11 shares everything else). `perPage` is
    // read from the markup when the pager is wired, before anything renders.
    state.table = {
      filters: state.filters.get(),
      sort: DEFAULT_SORT,
      page: 1,
      perPage: null
    };
    hydrate(mount);
  }

  // `node --test` loads this file to exercise the pure helpers; there is no document
  // and no CommonJS in the browser, so exactly one of these two branches ever runs.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      DEFAULT_FILTERS: DEFAULT_FILTERS,
      DEFAULT_PINS: DEFAULT_PINS,
      MAX_PINS: MAX_PINS,
      applyFilters: applyFilters,
      bubbleRadius: bubbleRadius,
      countColor: countColor,
      createStore: createStore,
      filterRecords: filterRecords,
      filteredOutText: filteredOutText,
      findPlaces: findPlaces,
      isPinned: isPinned,
      isReported: isReported,
      mapCaption: mapCaption,
      nextDirection: nextDirection,
      noDataMatches: noDataMatches,
      noDataRecord: noDataRecord,
      noDataSentence: noDataSentence,
      noDataRowsSentence: noDataRowsSentence,
      notFoundStatusText: notFoundStatusText,
      pageCount: pageCount,
      paginate: paginate,
      pinFact: pinFact,
      pinStatusText: pinStatusText,
      pinnedRecords: pinnedRecords,
      placeCallout: placeCallout,
      legendBucketLabel: legendBucketLabel,
      populationOptions: populationOptions,
      practiceFilterOptions: practiceFilterOptions,
      practiceSummaryText: practiceSummaryText,
      resultStatusText: resultStatusText,
      sortRecords: sortRecords,
      tableStatusText: tableStatusText,
      tableView: tableView
    };
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
