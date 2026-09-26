// Display names are route-local; source names and stop identity stay intact.
function stopDisplayNames(stops) {
  const key = text => text.toLowerCase().replace(/\b(north|south|east|west|ne|nw|se|sw|n|s|e|w|avenue|ave|street|st|way|road|rd|boulevard|blvd)\b/g,'').replace(/[^a-z0-9]/g,'');
  const short = text => text.replace(/\b(NE|NW|SE|SW|N|S|E|W|Ave|Avenue|St|Street|Way|Rd|Road|Blvd|Boulevard)\b\.?/gi,'').replace(/\s+/g,' ').trim();
  const allPairs = stops.map(stop=>(stop.fullName || stop.name).split(/\s+\/\s+/).map(name=>name.split(/\s+(?:&|and)\s+/i)));
  const parsed = allPairs.map(pairs => {
    if (pairs.some(pair=>pair.length!==2)) return null;
    const signatures = new Set(pairs.map(pair=>pair.map(key).sort().join('|')));
    return signatures.size===1 ? pairs[0].map(text=>({text, key:key(text), short:short(text)})) : null;
  });
  const qualifiedKey = text=>text.toLowerCase().replace(/\bavenue\b/g,'ave').replace(/\bstreet\b/g,'st').replace(/\broad\b/g,'rd').replace(/\bboulevard\b/g,'blvd').replace(/[^a-z0-9]/g,'');
  const qualifiedFrequency = new Map();
  for (const pairs of allPairs) for (const k of new Set(pairs.flat().map(qualifiedKey))) qualifiedFrequency.set(k,(qualifiedFrequency.get(k)||0)+1);
  const frequency = new Map();
  for (const pairs of allPairs) for (const k of new Set(pairs.flat().map(key))) frequency.set(k,(frequency.get(k)||0)+1);
  const candidates = parsed.map((pair,i)=>{
    if (!pair) return stops[i].fullName || stops[i].name;
    const [a,b] = pair;
    const corridor = (frequency.get(a.key)||0) >= 3 && frequency.get(a.key)>frequency.get(b.key) ? a :
      (frequency.get(b.key)||0) >= 3 && frequency.get(b.key)>frequency.get(a.key) ? b : null;
    const cross = corridor===a ? b : a;
    // Search the entire route, not just adjacent stops, for a repeated cross street.
    if (corridor && frequency.get(cross.key)===1) return cross.short || cross.text;
    if (corridor && qualifiedFrequency.get(qualifiedKey(cross.text))===1) return cross.text;
    return pair.map(p=>p.short || p.text).join(' / ');
  });
  return Object.fromEntries(stops.map((stop,i)=>[stop.id,
    candidates.filter(name=>name.toLowerCase()===candidates[i].toLowerCase()).length>1 ? (stop.fullName || stop.name) : candidates[i]]));
}
function closestStop(stops, origin) {
  return origin ? stops.reduce((best,stop)=>!best || Math.hypot(stop.x-origin.x,stop.y-origin.y)<Math.hypot(best.x-origin.x,best.y-origin.y) ? stop : best,null) : null;
}
function topStops(rows, metric, housingSort='net') {
  const key=metric==='housing'?housingSort:metric;
  const max=Math.max(...rows.map(row=>row.summary[key]));
  return max>0 ? rows.filter(row=>row.summary[key]===max).map(row=>row.id) : [];
}
function assignedStops(row, direction = '') {
  if (!row.StopAssignments) return row.NearestStopId ? [row.NearestStopId] : [];
  return [...new Set(direction ? [row.StopAssignments[direction]].filter(Boolean) : Object.values(row.StopAssignments))];
}
function matchesStop(row, stop, direction = '') {
  const ids = assignedStops(row, direction);
  return stop ? ids.includes(stop) : !direction || ids.length > 0;
}
function statusGroup(status) {
  if (!status || status.includes(' / ')) return 'unknown';
  if (/completed|approved to occupy/i.test(status)) return 'complete';
  if (/expired|closed|cancel|withdraw|denied/i.test(status)) return 'inactive';
  if (/issued/i.test(status)) return 'issued';
  if (/review|application|pending|intake/i.test(status)) return 'review';
  return 'unknown';
}
function filterDevelopment(rows, status, work) {
  return rows.filter(p => (!status || statusGroup(p.StatusCurrent) === status) &&
    (!work || (work === 'new' ? p.PermitTypeDesc === 'New' : /alteration/i.test(p.PermitTypeDesc || ''))));
}
/* Pure aggregation helpers are also exercised by the Node regression tests. */
function inPeriod(rows, start, end, stop = '') {
  return rows.filter(row => {
    const date = (row.IssuedDate || '').slice(0, 10);
    return date && date >= start && date <= end && (!stop || matchesStop(row, stop));
  });
}
function summarize(projects, permits) {
  const sum = key => projects.reduce((total, p) => total + (Number(p[key]) || 0), 0);
  const added = sum('HousingUnitsAdded'), removed = sum('HousingUnitsRemoved');
  return {permits: permits.length, projects: projects.length, added, removed,
    net: added - removed, value: sum('EstProjectCostNumeric')};
}
function housingCost(projects) {
  const eligible = projects.filter(p => p.HousingUnitsAdded > 0);
  const known = eligible.filter(p => p.EstProjectCostNumeric != null && Number.isFinite(Number(p.EstProjectCostNumeric)));
  const units = known.reduce((sum,p) => sum + p.HousingUnitsAdded, 0);
  return {perUnit: units ? known.reduce((sum,p)=>sum+Number(p.EstProjectCostNumeric),0)/units : null, known: known.length, eligible: eligible.length};
}
function rankDifferences(rows) {
  const rank = (row, key) => 1 + rows.filter(other => other.summary[key] > row.summary[key]).length;
  return rows.map(row => {
    const netRank=rank(row,'net'), valueRank=rank(row,'value'), permitRank=rank(row,'permits');
    return {...row, netRank, valueRank, permitRank, gap:Math.max(Math.abs(netRank-valueRank), Math.abs(netRank-permitRank))};
  }).sort((a,b)=>b.gap-a.gap||a.position-b.position);
}
function annualChange(projects, permits, start, end, metric, coverageEnd) {
  const year = Number(end.slice(0,4)) - (end.endsWith('-12-31') ? 0 : 1);
  if (start > `${year-1}-01-01` || (coverageEnd && coverageEnd < `${year}-12-31`)) return null;
  const key=metric==='housing'?'net':metric;
  const total=y=>summarize(projects.filter(p=>p.IssuedDate.slice(0,4)===String(y)),permits.filter(p=>p.IssuedDate.slice(0,4)===String(y)))[key];
  const current=total(year), previous=total(year-1);
  return {year,current,previous,delta:current-previous,percent:previous>0?(current-previous)/previous*100:null};
}
function statusClass(status) {
  return {complete:'status-complete',inactive:'status-inactive',issued:'status-issued',review:'status-review',unknown:'status-neutral'}[statusGroup(status)];
}
function sortChartRows(rows, order, metric, housingSort = 'net') {
  const key = metric === 'housing' ? housingSort : metric;
  const sorted = [...rows].sort((a,b) => {
    const difference = order === 'name' ? a.name.localeCompare(b.name) :
      order === 'desc' ? b.summary[key]-a.summary[key] :
      order === 'asc' ? a.summary[key]-b.summary[key] : 0;
    return difference || a.position-b.position;
  });
  return sorted.map((row,index) => ({...row, rank: ['asc','desc'].includes(order) ?
    1+rows.filter(other=>order==='asc'?other.summary[key]<row.summary[key]:other.summary[key]>row.summary[key]).length :
    order==='route'?row.position:''}));
}
function annualSummaries(projects, permits, start, end) {
  const rows = [];
  for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
    const partial = start > `${year}-01-01` || end < `${year}-12-31`;
    rows.push({name: String(year) + (partial ? ' (partial)' : ''), position: year, summary: summarize(
      projects.filter(p => p.IssuedDate.slice(0, 4) === String(year)),
      permits.filter(p => p.IssuedDate.slice(0, 4) === String(year)))});
  }
  return rows;
}
function seattleToday() {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date());
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function presetRange(preset, data, today = seattleToday()) {
  if (preset === 'life') return data.routeHistory ? [data.routeHistory.service_start_date, today] : null;
  if (preset === 'all') return [data.minDate || data.defaultStart, today];
  if (preset === 'ytd') return [today.slice(0, 4) + '-01-01', today];
  if (preset === '1y' || preset === '5y') {
    const [year, month, day] = today.split('-').map(Number);
    const targetYear = year - (preset === '1y' ? 1 : 5);
    const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
    return [`${targetYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`, today];
  }
  return null;
}
if (typeof module !== 'undefined') module.exports = {stopDisplayNames, closestStop, topStops, assignedStops, matchesStop, statusGroup, filterDevelopment, inPeriod, summarize, presetRange, sortChartRows, annualSummaries, statusClass, housingCost, rankDifferences, annualChange};

if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const labels = {permits: 'Permit records', projects: 'Development projects', added: 'Gross units added',
    removed: 'Units removed', net: 'Net units', value: 'Estimated value'};
  const number = new Intl.NumberFormat('en-US', {maximumFractionDigits: 0});
  const money = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0});
  const compactMoney = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1});
  let data, selectedProject = '', selected = '', catalog = [], busy = false, departureStop = '', view = [0, 0, 800, 850], scale, bounds;
  const navigation = [];
  const controlIds = ['direction','start','end','project-status','work-type','metric','sort','housing-sort'];
  let projectLayer, stopLayer, catchmentLayer, selectionLayer;
  const fmt = (key, value) => key === 'value' ? compactMoney.format(value) : number.format(value);
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function svg(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (parent) parent.append(node);
    return node;
  }
  const routeMap = new window.RouteMap($('map'), id => selectStop(id), p => selectProject(p));
  function fit() { routeMap.fit(); }
  function zoom(factor) { routeMap.zoom(factor); }
  function makeMap() { routeMap.load(data); }
  function stats(target, summary) {
    target.replaceChildren();
    for (const [key, label] of Object.entries(labels)) {
      const card = el('div', undefined, 'stat');
      card.append(el('span', label), el('strong', fmt(key, summary[key])));
      if (key === 'value') card.title = money.format(summary[key]);
      target.append(card);
    }
  }
  function selectStop(id) { selectedProject = ''; selected = id; $('stop').value = id; render(); }
  function selectProject(project, fromRow = false) {
    selectedProject = project.SourcePermitNumbers;
    if (fromRow) $('show-projects').checked = true;
    render();
    routeMap.highlightProject(project, fromRow);
    if (fromRow) $('map').scrollIntoView({block:'center',behavior:'smooth'});
  }
  function snapshot() {
    return {route:data.routeId, stop:selected, project:selectedProject, view:[...routeMap.view],
      label:`${routeLabel()} · ${data.stops.find(s=>s.id===selected)?.name || 'All stops'}`,
      controls:Object.fromEntries(controlIds.map(id=>[id,$(id).value]))};
  }
  function routeLabel() {
    const info=catalog.find(r=>r.route_id===data?.routeId);
    return data?.routeId==='23_102638' ? 'First Hill Streetcar · 96' : (info?.name && /^\d+$/.test(info.name) ? 'Route '+info.name : info?.name) || data?.routeName || '';
  }
  async function connect(route) {
    if (busy) return;
    const previous=snapshot(), origin=data.stops.find(s=>s.id===selected);
    $('route').value=route;
    await load(false,{origin, previous});
  }
  async function loadDepartures() {
    if (!selected || busy) return;
    const requestedStop = selected;
    departureStop = requestedStop;
    $('load-departures').disabled = true;
    $('departure-note').textContent = 'Checking OneBusAway…';
    $('departures').replaceChildren();
    try {
      const response = await fetch(`/api/departures?route=${encodeURIComponent(data.routeId)}&stop=${encodeURIComponent(requestedStop)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load departures.');
      if (selected !== requestedStop) return;
      const now = Date.now();
      for (const item of result.departures.slice(0, 8)) {
        const minutes = Math.max(0, Math.round((item.departureTime - now) / 60000));
        const row = el('div', undefined, 'departure');
        row.append(el('strong', item.route || 'Route'), el('span', item.destination),
          el('b', minutes === 0 ? 'Due' : `${minutes} min`));
        row.title = `${item.predicted ? 'Live prediction' : 'Scheduled time'} · ${new Date(item.departureTime).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
        $('departures').append(row);
      }
      if (!result.departures.length) $('departures').append(el('p', 'No departures found in the next two hours.'));
      $('departure-note').textContent = 'OneBusAway · live predictions where available; otherwise scheduled times. Refresh manually.';
    } catch (error) {
      if (selected === requestedStop) $('departure-note').textContent = error.message;
    } finally {
      if (selected === requestedStop) $('load-departures').disabled = false;
    }
  }
  function markPreset(preset) {
    for (const button of document.querySelectorAll('[data-preset]')) button.setAttribute('aria-pressed', String(button.dataset.preset === preset));
    $('preset-label').textContent = preset === 'custom' ? 'Custom range' : 'Through today · Seattle time';
  }
  function applyPreset(preset) {
    if (!data) return;
    const range = presetRange(preset, data);
    if (!range) return;
    [$('start').value, $('end').value] = range;
    markPreset(preset); render();
  }
  function drawBars(target, rows, metric, clickable = false) {
    target.replaceChildren();
    const housing = metric === 'housing';
    const max = Math.max(1, ...rows.map(row => housing ? Math.max(row.summary.added, row.summary.removed) : Math.abs(row.summary[metric])));
    for (const row of rows) {
      const summary = row.summary;
      const node = el(clickable ? 'button' : 'div', undefined, `rank chart-row${selected === row.id ? ' selected' : ''}`);
      if (clickable) {
        node.dataset.stopId = row.id;
        node.setAttribute('aria-pressed', String(selected === row.id));
        node.addEventListener('click', () => selectStop(row.id));
      }
      const label = el('span', row.name, 'bar-label');
      const track = el('span', undefined, housing ? 'bar-track diverging' : 'bar-track');
      if (housing) {
        const added = el('span', undefined, 'segment units-added');
        const removed = el('span', undefined, 'segment units-removed');
        added.style.width = `${summary.added / max * 50}%`;
        removed.style.width = `${summary.removed / max * 50}%`;
        track.append(removed, added);
        label.append(track, el('small', `+${number.format(summary.added)} added / −${number.format(summary.removed)} removed`, 'bar-detail'));
        node.append(el('small', clickable ? row.rank : '', 'stop-number'), label, el('b', `${number.format(summary.net)} net`));
        node.setAttribute('aria-label', `${row.name}: ${summary.added} units added, ${summary.removed} removed, ${summary.net} net units`);
      } else {
        const bar = el('span', undefined, `segment${summary[metric] < 0 || metric === 'removed' ? ' units-removed' : ' units-added'}`);
        bar.style.width = `${Math.abs(summary[metric]) / max * 100}%`;
        track.append(bar); label.append(track);
        node.append(el('small', clickable ? row.rank : '', 'stop-number'), label, el('b', fmt(metric, summary[metric])));
        node.setAttribute('aria-label', `${row.name}: ${labels[metric]} ${fmt(metric, summary[metric])}`);
      }
      target.append(node);
    }
  }
  function render() {
    if (!data) return;
    const start = $('start').value, end = $('end').value;
    const valid = start && end && start <= end;
    $('date-error').textContent = valid ? '' : 'Choose both dates, with the start on or before the end.';
    $('dashboard').hidden = !valid;
    if (!valid) return;
    $('date-coverage').textContent = data.maxDate && end > data.maxDate ? `Latest cached qualifying permit in this corridor: ${data.maxDate}. The selected range extends beyond that date; recent data may be incomplete.` : '';
    const direction = $('direction').value;
    const orderedIds = (data.directions || []).find(d=>d.id === direction)?.stopOrder;
    const orderedStops = orderedIds ? orderedIds.map(id=>data.stops.find(s=>s.id===id)).filter(Boolean) : data.stops;
    if (selected && !orderedStops.some(s=>s.id===selected)) { selected=''; selectedProject=''; }
    $('stop').replaceChildren(new Option('All stops', ''), ...orderedStops.map(s=>new Option(s.name,s.id)));
    $('stop').value = selected;
    const scope = rows => filterDevelopment(inPeriod(rows, start, end), $('project-status').value, $('work-type').value).filter(p => matchesStop(p, '', direction));
    const projects = scope(data.projects);
    const permits = scope(data.permits);
    if (!projects.some(p=>p.SourcePermitNumbers===selectedProject && matchesStop(p, selected, direction))) selectedProject='';
    const chosenProjects = selected ? projects.filter(p => matchesStop(p, selected, direction)) : projects;
    const chosenPermits = selected ? permits.filter(p => matchesStop(p, selected, direction)) : permits;
    stats($('route-summary'), summarize(projects, permits));
    stats($('stop-summary'), summarize(chosenProjects, chosenPermits));
    $('period').textContent = `${start} — ${end} · issue dates`;
    const stop = data.stops.find(s => s.id === selected);
    if (departureStop !== selected) {
      departureStop = '';
      $('departures').replaceChildren();
      $('departure-note').textContent = stop ? 'Check live arrivals for this boarding location.' : 'Select a stop to check live departures.';
    }
    $('load-departures').disabled = !stop || busy;
    $('selection-title').textContent = stop ? stop.name : 'All stops';
    $('selection-title').title = stop?.fullName || '';
    $('stop-full-name').textContent = stop?.fullName || '';
    $('map-route-title').textContent = routeLabel();
    $('map-direction').textContent = $('direction').selectedOptions[0]?.textContent || '';
    $('back-route').hidden = !navigation.length;
    $('back-route').textContent = navigation.length ? 'Back to '+navigation.at(-1).label : '';
    $('projects-title').textContent = stop ? `Projects near ${stop.name}` : 'Development projects';
    $('project-count').textContent = `${number.format(chosenProjects.length)} projects`;
    const metric = $('metric').value;
    $('sidebar-metric').value = metric;
    $('ranking-title').textContent = $('metric').selectedOptions[0].textContent;
    for (const button of document.querySelectorAll('[data-chart-metric]')) button.setAttribute('aria-pressed', String(button.dataset.chartMetric === metric));
    for (const legend of document.querySelectorAll('.housing-legend')) legend.hidden = metric !== 'housing';
    $('housing-sort-label').hidden = metric !== 'housing';
    const rows = orderedStops.map((s,index) => ({id: s.id, name: s.name, position: index+1,
      summary: summarize(projects.filter(p => matchesStop(p, s.id, direction)), permits.filter(p => matchesStop(p, s.id, direction)))}));
    drawBars($('ranking'), sortChartRows(rows, $('sort').value, metric, $('housing-sort').value), metric, true);
    $('ranking-note').textContent = ['asc','desc'].includes($('sort').value) ? 'Ranks follow the selected metric and sort direction; ties share a rank.' : $('sort').value === 'name' ? 'Stops sorted alphabetically.' : direction ? 'Numbers follow the selected departure direction.' : 'Choose a direction for departure order. Combined view uses the first group, with additional stops appended.';
    $('annual-metric').textContent = $('metric').selectedOptions[0].textContent;
    drawBars($('annual-chart'), annualSummaries(chosenProjects, chosenPermits, start, end), metric);
    $('annual-title').textContent = stop ? `Development by issue year · ${stop.name}` : 'Route development by issue year';
    $('annual-note').textContent = `${stop ? 'Selected stop' : 'Entire selected route'} · selected dates · first/last years may be partial. Removals include demolition and other recorded unit losses.`;
    const cost = housingCost(chosenProjects);
    $('housing-cost').textContent = cost.perUnit == null ? 'Not available' : `${money.format(cost.perUnit)} / added unit`;
    $('housing-cost-note').textContent = `${cost.known} of ${cost.eligible} housing-adding projects have a recorded valuation. Excludes zero-unit projects; includes nonhousing costs within mixed-use projects.`;
    const change = annualChange(chosenProjects, chosenPermits, start, end, metric, data.maxDate);
    $('trend').textContent = change ? `${change.delta >= 0 ? '+' : ''}${fmt(metric === 'housing' ? 'net' : metric, change.delta)} (${change.year} vs ${change.year-1})` : 'Choose a range covering two complete years';
    $('trend-note').textContent = change ? `${change.percent == null ? 'Percentage change unavailable from a nonpositive baseline.' : change.percent.toFixed(1)+'% change.'} Permit issuance activity, not verified construction pace. Partial years excluded; source completeness is not guaranteed.` : 'No like-for-like full-year comparison is available in this selection.';
    $('rank-comparison').replaceChildren();
    for (const row of rankDifferences(rows).slice(0,5)) {
      const button=el('button', `${row.name} — housing #${row.netRank} · value #${row.valueRank} · permits #${row.permitRank}`, 'rank-difference');
      button.addEventListener('click',()=>selectStop(row.id)); $('rank-comparison').append(button);
    }
    const mixed=chosenProjects.filter(p=>p.UseHint==='Mixed-use indicated').length;
    const institution=chosenProjects.filter(p=>p.UseHint==='Institutional use indicated').length;
    const adu=chosenProjects.filter(p=>/\b[ad]*adu\b|accessory dwelling/i.test(p.Description||'')).length;
    $('use-signals').textContent = `Description hints: ${mixed} mixed-use · ${institution} institutional · ${adu} accessory dwelling projects. These do not establish neighborhood form or zoning compliance.`;

    routeMap.update(projects, selected, {direction, selectedProject, topStops:topStops(rows,metric,$('housing-sort').value), permitCounts: Object.fromEntries(rows.map(row => [row.id, row.summary.permits])), projects: $('show-projects').checked, catchments: $('show-catchments').checked, geography: $('show-geography').checked, size: $('project-size').value, zoning: $('show-zoning').checked});
    $('comparison-note').textContent = `Gold rings mark the highest ${metric==='housing' ? labels[$('housing-sort').value] : labels[metric]} totals among stops in the selected direction(s); ties included. Filters change the totals. Point colors show housing added. No rings when all totals are zero or negative.`;
    $('focus-stop').disabled = !selected;
    $('zoning-summary').replaceChildren();
    if (data.zoning) {
      const zone=(direction ? data.zoning.directionSummaries?.[direction]?.[selected || 'all'] : data.zoning.summaries[selected || 'all']) || {coveredPercent:0,categories:[],overlap:false};
      $('zoning-note').textContent = `${stop ? stop.name : 'Whole route corridor'} · ${zone.coveredPercent.toFixed(1)}% mapped · cached ${data.zoning.retrievedAt?.slice(0,10) || 'date unknown'}${zone.overlap ? ' · Overlapping categories: percentages are not additive.' : ''}`;
      for(const category of [...zone.categories, {name:'Unmapped / outside Seattle',percent:Math.max(0,100-zone.coveredPercent)}]) {
        const row=el('div', undefined, 'zone-row'); const name=el('span', category.name);const swatch=el('i', undefined, 'legend-swatch');swatch.style.background=window.zoningColor(category.name);name.prepend(swatch);row.append(name,el('strong', category.percent.toFixed(1)+'%')); $('zoning-summary').append(row);
      }
    } else $('zoning-note').textContent = 'No zoning cache yet. Choose Seattle zoning under Retrieve updated data.';

    const choice=id=>$(id).selectedOptions[0]?.textContent || '';
    $('active-context').textContent = `${catalog.find(r=>r.route_id===data.routeId)?.name || data.routeName} · ${choice('direction')} · ${stop?.name || 'All stops'} · ${choice('work-type')} · ${choice('project-status')} · Issued ${start}–${end} · ${choice('metric')} · Seattle permits${data.maxDate ? ' through '+data.maxDate : ''}`;
    $('transfers').replaceChildren();
    $('transfer-note').textContent = stop ? 'Cached connections · select a line to explore nearby boarding.' : 'Select a stop for connecting lines.';
    if (stop) {
      for (const connection of data.transfers?.stops[stop.id] || []) {
        const button=el('button',connection.name,'connection-route');
        button.disabled=busy || !catalog.some(r=>r.route_id===connection.routeId);
        button.dataset.routeId=connection.routeId;
        button.title=connection.sameStop?'Same boarding stop':`Nearby · ${connection.distanceFeet} ft straight-line; walking access unverified`;
        button.addEventListener('click',()=>connect(connection.routeId));
        $('transfers').append(button);
      }
      if (!$('transfers').children.length) $('transfers').append(el('p','No connections found in cached data.'));
    }

    $('project-rows').replaceChildren();
    const sorted = [...chosenProjects].sort((a, b) => b.IssuedDate.localeCompare(a.IssuedDate));
    for (const p of sorted) {
      const row = el('tr', undefined, selectedProject===p.SourcePermitNumbers?'selected-project':'');
      row.dataset.projectKey=p.SourcePermitNumbers;
      const address = el('td');
      const pick=el('button',p.OriginalAddress1 || 'Address not recorded','project-link');
      pick.setAttribute('aria-pressed',String(selectedProject===p.SourcePermitNumbers));
      pick.addEventListener('click',()=>selectProject(p,true)); address.append(pick);
      row.addEventListener('click',event=>{if(!event.target.closest('button,details,a'))selectProject(p,true);});
      address.append(el('small', p.Description || 'No description recorded'));
      const status = el('span', p.StatusCurrent || 'Unknown', `status-badge ${statusClass(p.StatusCurrent)}`);
      const statusCell = el('td'); statusCell.append(status);
      address.append(el('small', `${p.PermitTypeDesc} · ${p.UseHint}`));
      const details = el('details'); details.append(el('summary', 'Source permits & reconciliation'), el('p', p.SourcePermitNumbers || 'Unknown'));
      if (p.ReconciliationNote) details.append(el('p', p.ReconciliationNote), el('p', `Separate supporting permit value: ${money.format(p.SupportingPermitValue || 0)}`));
      address.append(details);
      row.append(address, statusCell, el('td', p.IssuedDate.slice(0, 10)));
      for (const key of ['HousingUnitsAdded', 'HousingUnitsRemoved', 'HousingUnitsNet', 'EstProjectCostNumeric']) {
        row.append(el('td', p[key] == null ? '—' : key === 'EstProjectCostNumeric' ? money.format(p[key]) : number.format(p[key])));
      }
      $('project-rows').append(row);
    }
    if (!sorted.length) { const cell = el('td', 'No development projects in this selection. Try a wider date range.'); cell.colSpan = 7; const row = el('tr'); row.append(cell); $('project-rows').append(row); }
  }
  async function load(refresh = false, transition = null) {
    if (busy) return;
    busy = true; $('refresh').disabled = true; $('route').disabled = true;
    $('status').className = ''; $('status').textContent = refresh ? 'Retrieving updated data… Permit and street downloads can take a few minutes.' : 'Loading route geometry, stops and development…';
    const route = $('route').value || '23_102638';
    const url = refresh ? `/api/refresh?route=${encodeURIComponent(route)}&source=${$('source').value}` : `/api/data?route=${encodeURIComponent(route)}`;
    try {
      const response = await fetch(url, refresh ? {method: 'POST', headers: {'X-Route-Explorer': '1'}} : {});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load route.');
      const changed = !data || data.routeId !== result.routeId;
      const displayNames=stopDisplayNames(result.stops);
      for (const stop of result.stops) { stop.fullName=stop.name; stop.name=displayNames[stop.id]; }
      data = result; selected = ''; selectedProject = '';
      const routeInfo = catalog.find(r => r.route_id === data.routeId);
      const name = routeInfo?.name || routeInfo?.description || data.routeName;
      document.title = `Route Explorer · ${name}`;
      document.querySelector('.route-name').replaceChildren(document.createTextNode(name), el('small', `${data.stops.length} physical stops · ⅓-mile corridor`));
      $('map').setAttribute('aria-label', `Interactive ${name} route map: select a stop`);
      $('direction').replaceChildren(new Option('Both / all directions', ''), ...(data.directions || []).map(d => new Option(d.name, d.id)));
      $('direction-note').textContent = data.directionNote + ' Each project counts once per selected stop and once in route totals. Stop totals can overlap across directions.';
      $('stop').replaceChildren(new Option('All stops', ''), ...data.stops.map(s => new Option(s.name, s.id)));
      $('life-preset').disabled = !data.routeHistory;
      $('life-preset').title = data.routeHistory ? 'Since first passenger service' : 'Opening date is not yet known for this route';
      $('route-history').replaceChildren();
      if (data.routeHistory) {
        const history = data.routeHistory;
        const link = el('a', 'Source'); link.href = history.source_url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        $('route-history').append(document.createTextNode(`Service began ${history.service_start_date}. `), link, document.createTextNode(` · ${history.note}`));
      } else $('route-history').textContent = 'Service opening date not yet known. Life of route is unavailable; use other presets or custom dates.';
      if (changed) {
        [$('start').value, $('end').value] = presetRange(data.defaultPreset, data);
        markPreset(data.defaultPreset);
      }
      $('coverage').textContent = data.minDate ? `Cached qualifying permit issue dates for this corridor: ${data.minDate} through ${data.maxDate}.` : 'No qualifying Seattle permits were found in this route corridor.';
      makeMap();
      if (transition?.restore) {
        for (const [id,value] of Object.entries(transition.restore.controls)) $(id).value=value;
        selected=transition.restore.stop; selectedProject=transition.restore.project;
        markPreset('custom'); navigation.pop();
      } else if (transition?.origin) {
        selected=closestStop(data.stops,transition.origin)?.id || '';
        navigation.push(transition.previous);
      } else if (!refresh) navigation.length=0;
      render();
      if (transition?.restore) { routeMap.view=[...transition.restore.view]; routeMap.setView(); }
      else if (transition?.origin && selected) routeMap.focusStop(selected);
      $('status').textContent = `${refresh ? 'Data refreshed. ' : ''}${data.stops.length} physical stops · ${number.format(data.projects.length)} projects across all cached dates. Choose dates to explore.`;
    } catch (error) {
      $('status').className = 'error';
      $('status').textContent = `${error.message}${data ? ' The previous route remains displayed.' : ''}`;
      if (data) $('route').value = data.routeId;
    } finally { busy = false; $('refresh').disabled = false; $('route').disabled = false; }
  }
  for (const id of ['direction', 'project-status', 'work-type', 'metric', 'sort', 'housing-sort', 'show-projects', 'show-catchments', 'show-geography', 'project-size', 'show-zoning']) $(id).addEventListener('change', render);
  for (const id of ['start', 'end']) $(id).addEventListener('change', () => { markPreset('custom'); render(); });
  for (const button of document.querySelectorAll('[data-preset]')) button.addEventListener('click', () => applyPreset(button.dataset.preset));
  for (const button of document.querySelectorAll('[data-chart-metric]')) button.addEventListener('click', () => { $('metric').value = button.dataset.chartMetric; render(); });
  for (const id of ['open-filters','edit-filters']) $(id).addEventListener('click',()=>$('filter-dialog').showModal());
  $('sidebar-metric').addEventListener('change',()=>{$('metric').value=$('sidebar-metric').value;render();});
  $('back-route').addEventListener('click',()=>{if(busy || !navigation.length)return;const restore=navigation.at(-1);$('route').value=restore.route;load(false,{restore});});
  $('close-filters').addEventListener('click',()=>$('filter-dialog').close());
  $('stop').addEventListener('change', e => selectStop(e.target.value));
  $('clear').addEventListener('click', () => selectStop(''));
  $('reset').addEventListener('click', () => { if (!data) return; $('direction').value = ''; $('project-status').value = ''; $('work-type').value = ''; $('metric').value = 'housing'; $('sort').value = 'route'; $('housing-sort').value = 'net'; selected = ''; selectedProject = ''; $('stop').value = ''; applyPreset(data.defaultPreset); });
  $('route').addEventListener('change', () => load());
  $('refresh').addEventListener('click', () => load(true));
  $('fit').addEventListener('click', fit);
  $('zoom-in').addEventListener('click', () => zoom(.75));
  $('zoom-out').addEventListener('click', () => zoom(1.33));
  $('focus-stop').addEventListener('click', () => routeMap.focusStop(selected));
  $('load-departures').addEventListener('click', loadDepartures);
  if (new URLSearchParams(location.search).has('offline')) $('show-geography').checked = false;
  (async () => {
    try {
      const response = await fetch('/api/routes');
      if (!response.ok) throw new Error('Unable to load the route catalog.');
      catalog = await response.json();
      catalog.sort((a, b) => (a.name || a.route_id).localeCompare(b.name || b.route_id, undefined, {numeric: true}));
      $('route').replaceChildren(...catalog.map(r => new Option(`${r.name || r.route_id} · ${r.description || r.long_name || r.route_id}`, r.route_id)));
      $('route').value = '23_102638';
      await load();
    } catch (error) { $('status').className = 'error'; $('status').textContent = error.message; }
  })();
}
