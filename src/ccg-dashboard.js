(function () {
  'use strict';

  function stats() {
    return state.data.stats;
  }

  function meta() {
    return state.data.meta;
  }

  function dataset() {
    return state.data.dataset;
  }

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

  // A very small and a very large city that both report all five practices.
  var DEFAULT_PINS = ['coffman-cove--ak', 'nashville--tn'];

  // More callout labels than this no longer fit on the map without covering cities.
  var MAX_PINS = 4;

  var DEFAULT_FILTERS = {
    practices: [],
    sizeBucket: 'all',
    query: ''
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

  // The statuses CCG_count counts, so the filter, the glyphs and the Practices number agree.
  var REPORTED_STATUSES = ['in_practice', 'in_planning', 'not_active'];

  function isReported(record, practiceKey) {
    var practice = record.practices[practiceKey];
    return Boolean(practice) && REPORTED_STATUSES.indexOf(practice.status) !== -1;
  }

  // At least these practices, not only these.
  function reportsEvery(record, practiceKeys) {
    return practiceKeys.every(function (key) {
      return isReported(record, key);
    });
  }

  // Strips accents so "Anasco" finds "Añasco".
  function fold(text) {
    return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function normalizeQuery(query) {
    return typeof query === 'string' ? fold(query).trim() : '';
  }

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

  // Shorter queries ("oh") would match thousands of places and bury the surveyed cities.
  var NO_DATA_MIN_QUERY = 3;

  var NO_DATA_LIMIT = 25;

  function noDataLabel(part) {
    return meta().labels.noData[part];
  }

  function isNoData(record) {
    return Boolean(record && record.noData);
  }

  function noDataRecord(city, stateCode, stateNames) {
    return {
      id: 'no-data--' + fold(city).replace(/[^a-z0-9]+/g, '-') + '--' + fold(stateCode),
      city: city,
      state: stateCode,
      stateName: stateNames[stateCode] || stateCode,
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

  // Only a bare search surfaces no-data places; practice and size filters exclude them.
  function noDataMatches(places, filters, stateNames) {
    var query = normalizeQuery(filters && filters.query);
    var none = { shown: [], total: 0 };

    if (!places || query.length < NO_DATA_MIN_QUERY) return none;
    if (practiceKeys(filters).length > 0 || filters.sizeBucket !== 'all') return none;

    var shown = [];
    var total = 0;

    Object.keys(places).forEach(function (code) {
      var haystackState = ' ' + code + ' ' + (stateNames[code] || code);
      places[code].forEach(function (city) {
        if (fold(city + haystackState).indexOf(query) === -1) return;
        total += 1;
        if (shown.length < NO_DATA_LIMIT) shown.push(noDataRecord(city, code, stateNames));
      });
    });
    return { shown: shown, total: total };
  }

  // One scan of ~31k names per filter change, shared by the status line and the table.
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

  var BUBBLE_RADII = [3, 4.5, 6.5, 9.5];

  var UNKNOWN_POPULATION_RADIUS = 3;

  // ColorBrewer Blues. The bubble stroke, not the fill, carries the 3:1 contrast.
  var COUNT_COLORS = ['#deebf7', '#b5d4ea', '#82badb', '#4f9bc9', '#2b76b0', '#08417e'];

  var ANNOTATION_RING_RADIUS = 13;

  var PIN_LABEL_WIDTH_PCT = 18;
  var PIN_LABEL_HEIGHT = 80;
  var PIN_LABEL_GAP = 6;
  var PIN_BUBBLE_PADDING = 4;
  var PIN_LEADER_CLEARANCE = 5;

  var PIN_DIRECTIONS = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 0.7, y: 0.7 }, { x: 0.7, y: -0.7 }, { x: -0.7, y: 0.7 }, { x: -0.7, y: -0.7 }
  ];

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
    return state.data.basemap;
  }

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

  function renderMap(svg, cities, options) {
    var layer = find(svg, '.ccg-map__cities');

    clear(layer);
    cities
      .filter(hasCoordinates)
      .slice()
      // Largest first, so a big bubble never covers a small one.
      .sort(function (a, b) {
        return bubbleRadius(b.populationIndex) - bubbleRadius(a.populationIndex);
      })
      .forEach(function (record) {
        layer.appendChild(bubble(record, bubbleRadius(record.populationIndex), options.highlight(record)));
      });
  }

  // --------------------------- pin callouts ---------------------------------

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

  function distanceToSegment(point, from, to) {
    var dx = to.x - from.x;
    var dy = to.y - from.y;
    var lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point.x - from.x, point.y - from.y);

    var t = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
  }

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

    // Slid back inside rather than rejected, so a city near the edge still gets a nearby label.
    return {
      left: Math.max(0, Math.min(left, bounds.width - size.width)),
      top: Math.max(0, Math.min(top, bounds.height - size.height)),
      width: size.width,
      height: size.height
    };
  }

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

  function boxFits(box, record, cities, placed, clean) {
    if (boxCovers(box, record, 0)) return false;
    if (coversAnyCity(box, cities)) return false;
    if (overlapsPlaced(box, placed)) return false;
    if (!clean) return true;
    return !leaderCrossesCity(leaderAnchor(box, record), record, cities);
  }

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

    // Then the nearest free box with a clean leader line, then the nearest free box at all.
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

  function leaderCrossesCity(anchor, record, cities) {
    return cities.some(function (city) {
      if (!hasCoordinates(city) || city.id === record.id) return false;
      if (Math.hypot(city.x - record.x, city.y - record.y) <= ANNOTATION_RING_RADIUS) return false;
      return distanceToSegment(city, anchor, record) < PIN_LEADER_CLEARANCE;
    });
  }

  // Always built: an unplaced label (and every label on narrow screens) becomes a note under the map.
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

  function legendDotSize(populationIndex) {
    return Math.round(bubbleRadius(populationIndex) * 2.2);
  }

  // The smallest size also draws cities with no reported population, hence the asterisk.
  function legendBucketLabel(index, metaData) {
    var label = metaData.populationBucketsShort[index];
    return index === 0 ? label + '*' : label;
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

  function fillMapFigure(figure, options) {
    var svg = find(figure, '.ccg-map__svg');

    paintBasemap(svg);
    fillLegend(figure);
    renderMap(svg, options.cities, options.render);
    renderCallouts(find(figure, '.ccg-map'), svg, options.callouts, options.cities);
    find(figure, 'figcaption').textContent = options.caption;
    return svg;
  }

  // ==========================================================================
  // CAPTION AND SHARED TEXT HELPERS
  // ==========================================================================

  var SEARCH_DEBOUNCE_MS = 150;

  function joinList(parts, separator) {
    if (parts.length < 2) return parts.join('');
    return parts.slice(0, -1).join(separator || ', ') + (separator || ' ') + 'and ' +
      parts[parts.length - 1];
  }

  function cityLabel(record) {
    return record.city + ', ' + record.state;
  }

  function mapCaption(statsData) {
    var missing = statsData.citiesNotOnMap;
    if (missing.length === 0) return '';

    return statsData.citiesOnMap + ' of the ' + statsData.totalCities +
      ' are plotted: ' + joinList(missing) +
      (missing.length === 1 ? ' falls' : ' fall') + ' outside the projection this map uses.';
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

  // Set after first paint so the region is not announced on page load.
  function makeLive(node) {
    afterFirstPaint(function () {
      node.setAttribute('aria-live', 'polite');
      node.setAttribute('aria-atomic', 'true');
    });
  }

  function afterFirstPaint(fn) {
    requestAnimationFrame(function () {
      requestAnimationFrame(fn);
    });
  }

  // ==========================================================================
  // TABLE
  // ==========================================================================

  var DEFAULT_SORT = { column: 'city', direction: 'ascending' };

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
      unranked: function (record) { return record.ccgCount === null; }
    }
  };

  var FILLED_MARK = '●';
  var EMPTY_MARK = '○';

  function compareValues(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
  }

  // City, then state, is a fixed tiebreak that never reverses with the sort direction.
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

  // The page is clamped: a narrower search can leave the current page past the end.
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

  // Pinned rows head every page and are left out of the pager's count.
  function tableView(records, tableState) {
    var filters = tableState.filters;
    var pinned = pinnedRecords(records, filters);
    var rest = applyFilters(records, filters).filter(function (record) {
      return !isPinned(filters, record);
    });
    var places = tableState.places || { shown: [], total: 0 };

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
    return meta().practices;
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
    return meta().labels[group][value] || value;
  }

  function shortPopulation(record) {
    return label('populationSizeShort', record.populationSize);
  }

  // ------------------------------- row rendering ----------------------------

  function textCell(text) {
    return element('td', text);
  }

  // A <wbr> after the hyphen lets "10,001-50,000" wrap instead of widening the column.
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

    // Dashes, not empty circles: no data is not the same as reporting none.
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

    var forCity = element('span', ' for ' + cityLabel(record));
    forCity.className = 'ccg-visually-hidden';
    button.appendChild(forCity);
    return button;
  }

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
    if (!isNoData(record)) {
      actions.appendChild(pinButton(record, Boolean(settings.pinned), Boolean(settings.atLimit)));
    }
    actions.appendChild(detailsButton(record));
    row.appendChild(actions);
    return row;
  }

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

  // ombuds_leadership is a multi-select, so it arrives as an array of answers.
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

    if (isNoData(record)) {
      field(fields, 'Status', noDataLabel('value'));
      field(fields, 'Mandate', noDataLabel('value'));
      block.appendChild(fields);
      return block;
    }

    field(fields, 'Status', label('status', reported.status));
    field(fields, 'Mandate', label('mandate', reported.mandate));
    Object.keys(reported.details).forEach(function (key) {
      field(fields, label('detailQuestion', key), detailValue(reported.details[key]));
    });

    block.appendChild(fields);
    return block;
  }

  function noDataCall(record) {
    var note = element(
      'p',
      'This city has no data reported. Would you like to get involved and help report? Email us at '
    );
    note.className = 'ccg-profile__cta';

    var link = element('a', 'research@unicefusa.org.');
    link.className = 'ccg-cta';
    link.href = 'mailto:research@unicefusa.org';
    link.appendChild(hiddenLabel(' for ' + cityLabel(record)));

    note.appendChild(link);
    return note;
  }

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

  // Profiles are built on first expand, not on render.
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

  function renderRows(body, rows, columnCount, options) {
    var settings = options || {};
    clear(body);

    rows.forEach(function (entry) {
      var record = entry.record || entry;
      var row = tableRow(record, { pinned: entry.pinned, atLimit: settings.atLimit });
      var profile = profileRow(record, columnCount);
      var details = find(row, '[aria-controls]');
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

  function noDataRowsSentence(view) {
    if (!view.noData) return '';
    if (view.noData === 1) return '1 place with no data reported is listed below.';
    return view.noData + ' places with no data reported are listed below.';
  }

  function sortSentence(sort) {
    var column = SORT_COLUMNS[sort && sort.column];
    return column ? 'Sorted by ' + column.label + ', ' + sort.direction + '.' : '';
  }

  function pinnedRowsSentence(pinned) {
    if (!pinned || pinned.length === 0) return '';
    if (pinned.length === 1) return '1 pinned city is above them.';
    return pinned.length + ' pinned cities are above them.';
  }

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
      matchSentence(query, view.surveyed),
      query && !paged ? '' : rangeSentence(view),
      noDataRowsSentence(view),
      pinnedRowsSentence(view.pinned),
      sortSentence(tableState.sort)
    ].filter(Boolean).join(' ');
  }

  function resultStatusText(filters, matches, totalCities, places) {
    var query = normalizeQuery(filters.query);
    var others = practiceKeys(filters).length > 0 || filters.sizeBucket !== 'all';
    var without = noDataSentence(places);

    if (!hasActiveFilter(filters)) {
      return 'Showing all ' + cityCount(totalCities) +
        '. Check a practice, choose a size, or search to narrow the map above and the table below.';
    }

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

  // ------------------------------- city not found ---------------------------

  var LOOKUP_LIMIT = 8;
  var lookupRequest = null;

  // An embed hosted at another path sets data-base-url on #ccg-dashboard to find us-cities.json.
  function lookupUrl() {
    var mount = document.getElementById('ccg-dashboard');
    var base = (mount && mount.getAttribute('data-base-url')) || '';
    return base ? base.replace(/\/+$/, '') + '/us-cities.json' : 'us-cities.json';
  }

  // Fetched once, on first need. Resolves to null on failure (e.g. over file://).
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
    var matches = [];

    Object.keys(cities).forEach(function (code) {
      var haystackState = ' ' + code + ' ' + (stateNames[code] || code);
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

  function filteredOutText(filters, withoutFilters) {
    var query = normalizeQuery(filters.query);

    if (!query) return 'No surveyed city matches these filters.';

    var lede = 'No surveyed city matches “' + query + '” with these filters.';
    if (withoutFilters === 0) return lede;
    return lede + ' ' + (withoutFilters === 1 ? '1 city matches' : withoutFilters + ' cities match') +
      ' “' + query + '” once the filters are cleared.';
  }

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

  // Always textContent. Never assign innerHTML from data-derived strings.
  function element(tagName, textContent) {
    var node = document.createElement(tagName);
    if (textContent) node.textContent = textContent;
    return node;
  }

  function cityCount(total) {
    return total + (total === 1 ? ' city' : ' cities');
  }

  // Enter in a form would otherwise reload the host page.
  function preventSubmit(event) {
    event.preventDefault();
  }

  // Each [data-ccg-stat] slot names the CCG_DATA.stats key it shows.
  function fillStats(root) {
    findAll(root, '[data-ccg-stat]').forEach(function (slot) {
      var value = stats()[slot.getAttribute('data-ccg-stat')];
      slot.textContent = value === undefined || value === null ? '' : String(value);
    });
  }

  function fillPracticeDefinitions(list) {
    clear(list);
    practiceList().forEach(function (practice) {
      list.appendChild(element('dt', practice.name));

      var definition = element('dd', practice.definition);
      var link = element('a', practice.linkToText);
      link.className = 'ccg-cta';
      link.href = practice.linkTo;
      link.setAttribute('aria-label', 'Learn more about ' + practice.shortName);
      definition.appendChild(document.createTextNode(' '));
      definition.appendChild(link);
      list.appendChild(definition);
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

  function practiceFilterOptions(metaData, statsData) {
    return metaData.practices.map(function (practice) {
      return {
        value: practice.key,
        name: practice.name,
        count: cityCount(statsData.byPractice[practice.key].any)
      };
    });
  }

  function populationOptions(metaData, statsData) {
    var options = [{ value: 'all', label: 'All sizes (' + cityCount(statsData.totalCities) + ')' }];

    metaData.populationBuckets.forEach(function (bucket, index) {
      options.push({
        value: String(index),
        label: metaData.populationBucketsShort[index] + ' (' + cityCount(statsData.byPopulation[bucket]) + ')'
      });
    });
    return options;
  }

  function allOrNumber(raw) {
    return raw === 'all' ? 'all' : Number(raw);
  }

  function fillPracticeCheckboxes(container, options, onChange) {
    clear(container);

    options.forEach(function (option) {
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.id = 'ccg-filter-practice-' + option.value;
      input.value = option.value;
      input.setAttribute('data-ccg-practice', option.value);
      input.addEventListener('change', onChange);

      var row = element('label');
      row.className = 'ccg-checkbox';
      row.setAttribute('for', input.id);

      var name = element('span', option.name);
      name.className = 'ccg-checkbox__name';

      row.appendChild(input);
      row.appendChild(name);

      var count = element('span', option.count);
      count.className = 'ccg-checkbox__count';
      row.appendChild(count);
      container.appendChild(row);
    });
  }

  function practiceSummaryText(keys, practices) {
    if (keys.length === 0) return 'Any';
    if (keys.length === 1) {
      return practices.filter(function (practice) {
        return practice.key === keys[0];
      })[0].shortName;
    }
    return keys.length + ' selected';
  }

  // <details> does not close on Escape or an outside click by itself.
  function wireDropdown(details) {
    var summary = find(details, 'summary');

    details.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !details.open) return;
      details.open = false;
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
      store.set({ sizeBucket: allOrNumber(population.value) });
    });

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
      // Pins survive a filter reset.
      store.set({ practices: [], sizeBucket: 'all', query: '' });
    }

    find(form, '[data-ccg-action="clear-filters"]').addEventListener('click', function () {
      clearAll();
      input.focus();
    });

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
      practiceState.textContent = practiceSummaryText(practiceKeys(filters), meta().practices);
    }

    store.subscribe(showStatus);
    showStatus(store.get());
  }

  // Pinned cities are drawn even when the filters would hide them.
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

    function draw(next) {
      return {
        cities: drawnCities(records, next),
        callouts: pinnedRecords(records, next),
        render: {
          highlight: function (record) {
            return isPinned(next, record);
          }
        }
      };
    }

    var svg = fillMapFigure(figure, Object.assign(draw(state.filters.get()), {
      caption: mapCaption(stats())
    }));

    state.filters.subscribe(function (next) {
      var view = draw(next);
      renderMap(svg, view.cities, view.render);
      renderCallouts(find(figure, '.ccg-map'), svg, view.callouts, view.cities);
    });
  }

  function wirePagination(root, tableState, onChange) {
    var node = find(root, '#ccg-table-pagination');
    var rows = find(node, '#ccg-table-rows');
    var previous = find(node, '[data-ccg-page="previous"]');
    var next = find(node, '[data-ccg-page="next"]');
    var count = find(node, '.ccg-pagination__count');

    tableState.perPage = allOrNumber(rows.value);

    rows.addEventListener('change', function () {
      tableState.perPage = allOrNumber(rows.value);
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
      // Disabling the clicked button would drop focus, so move it to the other one.
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
      tableState.page = 1;
      update();
    });

    var pagination = wirePagination(root, tableState, function (clicked) {
      update();
      pagination.keepFocus(clicked);
    });

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

    function ensurePlaces(filters) {
      if (state.places || state.placesRequested) return;
      if (normalizeQuery(filters.query).length < NO_DATA_MIN_QUERY) return;
      if (practiceKeys(filters).length > 0 || filters.sizeBucket !== 'all') return;

      // A flag, not an empty state.places: the no-data cache key treats any object as loaded.
      state.placesRequested = true;
      loadCityLookup().then(function (cities) {
        if (!cities) return;
        state.places = cities;
        state.filters.set({});
      });
    }

    // Lets a late lookup response tell that the table has re-rendered since.
    var renderToken = 0;

    function update() {
      renderToken += 1;
      ensurePlaces(tableState.filters);
      tableState.places = currentNoData(tableState.filters);

      var view = tableView(records, tableState);
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

    // The script fills existing markup; an embed without it has nothing to hydrate.
    if (!mount.querySelector('#ccg-table-container')) {
      console.warn('ccg-dashboard: embed markup not found inside #ccg-dashboard.');
      return;
    }

    state.data = window.CCG_DATA;
    state.places = null;
    state.placesRequested = false;
    state.filters = createStore(Object.assign({}, DEFAULT_FILTERS, {
      // Drop any default pin a data refresh removed.
      pinned: DEFAULT_PINS.filter(function (id) {
        return dataset().some(function (record) {
          return record.id === id;
        });
      })
    }));
    state.table = {
      filters: state.filters.get(),
      sort: DEFAULT_SORT,
      page: 1,
      perPage: null
    };
    hydrate(mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
