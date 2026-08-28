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

  var DEFAULT_FILTERS = { practiceCount: 'all', sizeBucket: 'all', query: '' };

  // Map 2 and, from Task 09, the search read the same object. `query` is left empty here
  // so the search only has to call set({ query }).
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

  // Two data-verified callouts for Map 1, asserted in scripts/map.test.mjs. Each label
  // box was placed in space measured to contain no city bubble; `leader` is the point
  // on the label's edge the line starts from, in viewBox units. Label positions are
  // percentages of the SVG box, so they hold at every width. The labels stay in JS
  // rather than in the markup because map1Caption() reads the same `fact` strings.
  var MAP1_ANNOTATIONS = [
    {
      city: 'Coffman Cove',
      state: 'AK',
      fact: 'under 10,000 people, and all five of the practices',
      where: 'Circled in the Alaska inset.',
      label: { left: 21.3, top: 86.6, width: 20.5 },
      leader: { x: 206, y: 556 }
    },
    {
      city: 'Madison',
      state: 'WI',
      fact: 'over 200,000 people, and only one of the practices',
      where: 'Circled in Wisconsin.',
      label: { left: 66.2, top: 7.4, width: 20.5 },
      leader: { x: 675, y: 102 }
    }
  ];

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

  // The one filtering path for Map 2. Task 09's search writes `query` into the same
  // store rather than adding a second pass.
  function applyMapFilters(records, filters) {
    var settings = filters || {};
    var query = normalizeQuery(settings.query);

    return records.filter(function (record) {
      if (settings.practiceCount !== 'all' && record.ccgCount !== settings.practiceCount) return false;
      if (settings.sizeBucket !== 'all' && record.populationIndex !== settings.sizeBucket) return false;
      if (query && !matchesQuery(record, query)) return false;
      return true;
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

  function findRecord(city, stateCode) {
    var records = dataset();
    for (var i = 0; i < records.length; i += 1) {
      if (records[i].city === city && records[i].state === stateCode) return records[i];
    }
    return null;
  }

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

  function annotationLabel(annotation, record) {
    var note = element('p');
    note.className = 'ccg-map__annotation';
    note.style.setProperty('--ccg-annotation-left', annotation.label.left + '%');
    note.style.setProperty('--ccg-annotation-top', annotation.label.top + '%');
    note.style.setProperty('--ccg-annotation-width', annotation.label.width + '%');

    var name = element('span', record.city + ', ' + record.state);
    name.className = 'ccg-map__annotation-city';
    note.appendChild(name);
    note.appendChild(document.createTextNode(' \u2014 ' + annotation.fact + '. '));

    // Only useful in the stacked mobile layout, where there is no leader line.
    var where = element('span', annotation.where);
    where.className = 'ccg-map__annotation-where';
    note.appendChild(where);
    return note;
  }

  function renderAnnotations(container, svg, annotations) {
    var layer = find(svg, '.ccg-map__annotations');
    clear(layer);

    annotations.forEach(function (annotation) {
      var record = findRecord(annotation.city, annotation.state);
      if (!record || !hasCoordinates(record)) return;
      layer.appendChild(leaderLine(annotation.leader, record));
      layer.appendChild(annotationRing(record));
      container.appendChild(annotationLabel(annotation, record));
    });
  }

  // A legend swatch is the same encoding the bubbles use, so its size and fill come from
  // the same two tables rather than from hand-written CSS that could drift from them.
  function legendDotSize(populationIndex) {
    return Math.round(bubbleRadius(populationIndex) * 2.2);
  }

  function fillLegend(figure) {
    var buckets = meta().populationBuckets || [];

    findAll(figure, '[data-ccg-bucket]').forEach(function (item) {
      var raw = item.getAttribute('data-ccg-bucket');
      var index = raw === 'none' ? -1 : Number(raw);
      find(item, '.ccg-legend__dot').style.setProperty('--ccg-dot-size', legendDotSize(index) + 'px');
      if (raw !== 'none') find(item, '.ccg-legend__label').textContent = buckets[index] || '';
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
    if (options.annotations) renderAnnotations(find(figure, '.ccg-map'), svg, options.annotations);
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
  var PRACTICES_NAME = 'child-centered governance practices';

  function joinList(parts, separator) {
    if (parts.length < 2) return parts.join('');
    return parts.slice(0, -1).join(separator || ', ') + (separator || ' ') + 'and ' +
      parts[parts.length - 1];
  }

  function cityLabel(record) {
    return record.city + ', ' + record.state;
  }

  // Map 1's complete text alternative: the totals, what size and color encode, and the
  // two callouts in words, sourced from MAP1_ANNOTATIONS so there is one copy of the facts.
  function map1Caption() {
    var missing = stats().citiesNotOnMap || [];
    var callouts = MAP1_ANNOTATIONS.map(function (annotation) {
      return annotation.city + ', ' + annotation.state + ' — ' + annotation.fact;
    });

    return 'Every city in the survey, one bubble each: ' + stats().citiesOnMap + ' of the ' +
      stats().totalCities + ' are plotted, because ' + joinList(missing) +
      ' fall outside the projection this map uses. Bubble size is the city’s population; ' +
      'bubble color is how many of the five practices it reports, from light for none to ' +
      'dark for all five. Two cities are called out: ' + joinList(callouts, '; ') + '.';
  }

  function practicePhrase(practiceCount) {
    if (practiceCount === 'all') return 'any number of ' + PRACTICES_NAME;
    if (practiceCount === 0) return 'none of the five ' + PRACTICES_NAME;
    if (practiceCount === 1) return '1 child-centered governance practice';
    return practiceCount + ' ' + PRACTICES_NAME;
  }

  function sizePhrase(sizeBucket, buckets) {
    if (sizeBucket === 'all') return 'all sizes';
    var label = buckets[sizeBucket];
    return label ? 'population ' + label : 'one population size';
  }

  function filterPhrase(filters, buckets) {
    var parts = [practicePhrase(filters.practiceCount), sizePhrase(filters.sizeBucket, buckets)];
    var query = normalizeQuery(filters.query);
    if (query) parts.push('matching “' + query + '”');
    return parts.join(', ');
  }

  function hasActiveFilter(filters) {
    return filters.practiceCount !== 'all' ||
      filters.sizeBucket !== 'all' ||
      normalizeQuery(filters.query) !== '';
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
    var missing = cities.filter(function (record) {
      return !hasCoordinates(record);
    });
    if (missing.length === 0) return '';

    return missing.length + (missing.length === 1 ? ' of them is' : ' of them are') +
      ' not on the map — ' + joinList(missing.map(cityLabel)) +
      (missing.length === 1 ? ' falls' : ' fall') + ' outside the projection this map uses.';
  }

  function showingSentence(filters, cities, statsData, buckets) {
    var plotted = cities.filter(hasCoordinates).length;
    if (!hasActiveFilter(filters)) return 'Showing all ' + statsData.totalCities + ' surveyed cities.';

    return 'Showing ' + plotted + ' of ' + statsData.totalCities + ' surveyed cities: cities with ' +
      filterPhrase(filters, buckets) + '.';
  }

  // Pure. `buckets` is CCG_DATA.meta.populationBuckets — the index-to-label mapping the
  // store's numeric sizeBucket needs and `stats` does not carry.
  function mapCaption(filters, cities, statsData, buckets) {
    if (cities.length === 0) {
      return 'No surveyed cities match: ' + filterPhrase(filters, buckets || []) +
        '. Try removing a filter.';
    }

    // The observation is computed over the plotted cities, not the matching records, so
    // every number in the caption counts the same set the reader is looking at. With
    // nothing plotted, the unplotted sentence has already named every match.
    var plotted = cities.filter(hasCoordinates);
    return [
      showingSentence(filters, cities, statsData, buckets || []),
      unplottedSentence(cities),
      plotted.length === 0 ? '' : observationSentence(filters, plotted, statsData)
    ].filter(Boolean).join(' ');
  }

  // The one place the pure generator is handed the app's data.
  function map2Caption(filters, cities) {
    return mapCaption(filters, cities, stats(), meta().populationBuckets || []);
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

  // One pure pipeline: records -> filter -> sort -> paginate -> render. Every stage
  // takes its inputs as arguments and returns a new array, so `node --test` can drive
  // them without a document. The two map selects deliberately never reach this
  // pipeline (O4).

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
    ccgCount: { label: 'Practices', key: function (record) { return record.ccgCount; } }
  };

  // A practice counts as reported when its status is one of the three CCG_count counts,
  // so the glyph row and the "Practices" number always describe the same thing. The
  // difference between "in practice", "in planning" and "not currently active" is in
  // the city profile, where there is room to state it (D5).
  var REPORTED_STATUSES = ['in_practice', 'in_planning', 'not_active'];

  var FILLED_MARK = '●';
  var EMPTY_MARK = '○';

  function filterRecords(records, filters) {
    var query = normalizeQuery(filters && filters.query);
    if (!query) return records.slice();

    return records.filter(function (record) {
      return matchesQuery(record, query);
    });
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

  function tableView(records, tableState) {
    return paginate(
      sortRecords(filterRecords(records, tableState.filters), tableState.sort),
      tableState.page,
      tableState.perPage
    );
  }

  function practiceList() {
    return meta().practices || [];
  }

  function practiceInitial(practice) {
    return practice.shortName.charAt(0);
  }

  function isReported(record, practiceKey) {
    var practice = record.practices[practiceKey];
    return Boolean(practice) && REPORTED_STATUSES.indexOf(practice.status) !== -1;
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

  function tableRow(record) {
    var row = element('tr');

    var city = element('th', record.city);
    city.setAttribute('scope', 'row');
    row.appendChild(city);

    row.appendChild(textCell(record.state));
    row.appendChild(populationCell(label('populationSize', record.populationSize)));
    row.appendChild(textCell(String(record.ccgCount)));
    row.appendChild(practiceMarksCell(record));

    var actions = element('td');
    actions.className = 'ccg-table__actions';
    actions.appendChild(detailsButton(record));
    row.appendChild(actions);
    return row;
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
    field(fields, 'Status', label('status', reported.status));
    field(fields, 'Mandate', label('mandate', reported.mandate));
    Object.keys(reported.details || {}).forEach(function (key) {
      field(fields, label('detailQuestion', key), detailValue(reported.details[key]));
    });

    block.appendChild(fields);
    return block;
  }

  function cityProfile(record) {
    var profile = element('div');
    profile.className = 'ccg-profile';
    profile.appendChild(element('h3', cityLabel(record)));

    var facts = element('dl');
    facts.className = 'ccg-profile__fields';
    field(facts, 'Region', label('region', record.region));
    field(facts, 'Population size', label('populationSize', record.populationSize));
    field(facts, 'Practices in place', String(record.ccgCount));
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
  function renderRows(body, rows, columnCount) {
    clear(body);
    rows.forEach(function (record) {
      var row = tableRow(record);
      var profile = profileRow(record, columnCount);
      var button = find(row, 'button');

      button.addEventListener('click', function () {
        toggleProfile(button, profile, record);
      });

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
    return (total === 1 ? '1 city matches ' : total + ' cities match ') + '“' + query + '”.';
  }

  function sortSentence(sort) {
    var column = SORT_COLUMNS[sort && sort.column];
    return column ? 'Sorted by ' + column.label + ', ' + sort.direction + '.' : '';
  }

  function tableStatusText(view, tableState) {
    var query = normalizeQuery(tableState.filters.query);
    var paged = view.from !== 1 || view.to !== view.total;

    return [
      matchSentence(query, view.total),
      // "15 cities match" already says how many there are; the range only earns its
      // place when the reader is on one page of several.
      query && !paged ? '' : rangeSentence(view),
      sortSentence(tableState.sort)
    ].filter(Boolean).join(' ');
  }

  // Reported under the search box, where it is visible to everyone: Map 2 is above the
  // search on a phone, so this is the only place a reader learns it changed (D9).
  function searchStatusText(query, matches, mapMatches, mapNarrowed, totalCities) {
    if (!query) {
      return 'Showing all ' + cityCount(totalCities) +
        '. Type a city or state to narrow the map above and the table below.';
    }
    if (matches === 0) return 'No surveyed city matches “' + query + '”.';

    var lead = (matches === 1 ? '1 city matches ' : matches + ' cities match ') + '“' + query + '”';
    if (!mapNarrowed) return lead + ' — shown on the map above and in the table below.';

    return lead + ' — all of them in the table below; the map above shows the ' +
      mapMatches + ' that also match its own controls.';
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

  // The region's two paragraphs are in the markup; only the first one's text and the
  // lookup results below them are written here. `places` is null while the list is still
  // loading or when it could not be loaded at all — the difference is that the second
  // case never gets a list, so it gets the link.
  function renderNotFound(region, query, places, settled) {
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
  function practiceCountOptions(statsData) {
    var byCount = statsData.byCcgCount || {};
    var options = [{ value: 'all', label: 'All (' + cityCount(statsData.totalCities) + ')' }];

    Object.keys(byCount)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      })
      .forEach(function (count) {
        options.push({ value: String(count), label: count + ' (' + cityCount(byCount[count]) + ')' });
      });
    return options;
  }

  function populationOptions(metaData, statsData) {
    var byPopulation = statsData.byPopulation || {};
    var options = [{ value: 'all', label: 'All sizes (' + cityCount(statsData.totalCities) + ')' }];

    (metaData.populationBuckets || []).forEach(function (bucket, index) {
      options.push({ value: String(index), label: bucket + ' (' + cityCount(byPopulation[bucket]) + ')' });
    });
    return options;
  }

  // Selects carry strings; the store carries 'all' or a number, so one place converts.
  function toFilterValue(raw) {
    return raw === 'all' ? 'all' : Number(raw);
  }

  function wireMapControls(root, store) {
    var form = find(root, '[data-ccg-form="map"]');
    var practice = find(form, '#ccg-control-practice');
    var population = find(form, '#ccg-control-population');

    fillOptions(practice, practiceCountOptions(stats()));
    fillOptions(population, populationOptions(meta(), stats()));

    form.addEventListener('submit', preventSubmit);
    practice.addEventListener('change', function () {
      store.set({ practiceCount: toFilterValue(practice.value) });
    });
    population.addEventListener('change', function () {
      store.set({ sizeBucket: toFilterValue(population.value) });
    });

    find(form, '[data-ccg-action="reset-map"]').addEventListener('click', function () {
      practice.value = 'all';
      population.value = 'all';
      store.set({ practiceCount: 'all', sizeBucket: 'all' });
    });
  }

  function setUpMap1(root) {
    fillMapFigure(find(root, '#ccg-map1'), {
      cities: dataset(),
      annotations: MAP1_ANNOTATIONS,
      caption: map1Caption()
    });
  }

  function setUpMap2(root) {
    var records = dataset();
    var figure = find(root, '#ccg-map2');
    var filters = state.filters.get();
    var shown = applyMapFilters(records, filters);

    var svg = fillMapFigure(figure, { cities: shown, caption: map2Caption(filters, shown) });
    var caption = find(figure, 'figcaption');
    makeLive(caption);

    // One assignment, after the redraw: two writes would be announced twice. Debounced so
    // arrowing down a select announces where the reader stopped, not every option passed.
    var announce = debounce(function (next, cities) {
      caption.textContent = map2Caption(next, cities);
    }, CAPTION_DEBOUNCE_MS);

    // Only the city layer is rewritten, so nothing the reader is focused on is replaced.
    state.filters.subscribe(function (next) {
      var cities = applyMapFilters(records, next);
      renderMap(svg, cities);
      announce(next, cities);
    });
  }

  // One search, filtering the map above it and the table below it (D9). The status line
  // is not decoration: Map 2 scrolls out of view on a phone, so the shared result has to
  // be readable from here.
  function wireSearch(root) {
    var records = dataset();
    var form = find(root, '[data-ccg-form="search"]');
    var input = find(form, '#ccg-search-input');
    var status = find(root, '#ccg-search-status');

    makeLive(status);
    form.addEventListener('submit', preventSubmit);

    // One debounce for the whole search: the store is written once per settled input, so
    // every subscriber — this status line and the table's — updates in the same tick.
    var publish = debounce(function (value) {
      state.filters.set({ query: value });
    }, SEARCH_DEBOUNCE_MS);

    input.addEventListener('input', function () {
      publish(input.value);
    });

    find(form, '[data-ccg-action="clear-search"]').addEventListener('click', function () {
      input.value = '';
      // Focus stays in the control the reader just used, ready for the next attempt.
      input.focus();
      state.filters.set({ query: '' });
    });

    function showStatus(filters) {
      var query = normalizeQuery(filters.query);
      var mapNarrowed = filters.practiceCount !== 'all' || filters.sizeBucket !== 'all';
      status.textContent = searchStatusText(
        query,
        filterRecords(records, filters).length,
        applyMapFilters(records, filters).length,
        mapNarrowed,
        stats().totalCities
      );
    }

    state.filters.subscribe(showStatus);
    showStatus(state.filters.get());
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

    function update() {
      var view = tableView(records, tableState);
      // The page can be clamped by the pipeline; the buttons must reflect where we landed.
      tableState.page = view.page;

      renderRows(body, view.rows, columnCount);
      renderSortState(head, tableState.sort);
      pagination.update(view);

      // With no rows to show, the table, its key and its pager all go away together —
      // a legend for a table that is not there is just noise.
      var empty = view.total === 0;
      legend.hidden = empty;
      container.hidden = empty;
      pagination.node.hidden = empty;
      notFound.hidden = !empty;

      if (!empty) {
        status.textContent = tableStatusText(view, tableState);
        return;
      }
      showNotFound(normalizeQuery(tableState.filters.query));
    }

    // The national list is fetched only here, on a miss. The status line is written once
    // the lookup has settled, so it announces one complete outcome rather than two.
    function showNotFound(query) {
      renderNotFound(notFound, query, null, false);
      loadCityLookup().then(function (cities) {
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
    setUpMap1(root);
    wireMapControls(root, state.filters);
    setUpMap2(root);
    wireSearch(root);
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
    state.filters = createStore(DEFAULT_FILTERS);
    // Sort and page belong to the table alone; only `query` is shared (O4). `perPage` is
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
      MAP1_ANNOTATIONS: MAP1_ANNOTATIONS,
      applyMapFilters: applyMapFilters,
      bubbleRadius: bubbleRadius,
      countColor: countColor,
      createStore: createStore,
      filterRecords: filterRecords,
      findPlaces: findPlaces,
      mapCaption: mapCaption,
      nextDirection: nextDirection,
      notFoundStatusText: notFoundStatusText,
      pageCount: pageCount,
      paginate: paginate,
      populationOptions: populationOptions,
      practiceCountOptions: practiceCountOptions,
      searchStatusText: searchStatusText,
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
