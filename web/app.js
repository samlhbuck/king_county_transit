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
  return rows.filter(p => (status==='all' || (status ? statusGroup(p.StatusCurrent) === status : !/\bexpired\b/i.test(p.StatusCurrent || ''))) &&
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
    removed: 'Units removed', net: 'Net units', value: 'Estimated construction value'};
  const number = new Intl.NumberFormat('en-US', {maximumFractionDigits: 0});
  const money = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0});
  const compactMoney = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1});
  let lastSummaryStop = '', lastSummaryRoute = '';
  let data, selectedProject = '', selected = '', catalog = [], busy = false, departureStop = '', view = [0, 0, 800, 850], scale, bounds;
  const navigation = [];
  let explicitStop='';
  function showGuide(general=false){
    mobileRides.setMode('map');
    updateGuide();
    const terrain=frontageLens.elevation.mode==='elevation';
    const lens=!general&&(terrain||$('show-zoning').checked);
    $('guide-title').textContent=lens?(terrain?'About elevation':'About current zoning'):'Explore the route';
    $('guide-context').hidden=!lens;
    $('guide-context').textContent=lens?(terrain?$('elevation-source').textContent:$('guide-zoning').textContent):'';
    $('explore-guide').hidden=false;$('open-guide').setAttribute('aria-expanded','true');
    $('open-guide').setAttribute('aria-controls','explore-guide');
    $('explore-guide').tabIndex=-1;$('explore-guide').focus({preventScroll:true});
  }
  function inspectStop(){
    const stop=data?.stops.find(s=>s.id===selected);
    if(!stop)return;
    closeGuide();
    document.dispatchEvent(new CustomEvent('route-stop-inspect',{detail:{map:routeMap,stop,preserveView:true}}));
    if(!mobileRides.media.matches){const panel=document.querySelector('.workspace > aside');panel.id='stop-details';panel.tabIndex=-1;panel.focus({preventScroll:true});}
    $('open-guide').setAttribute('aria-controls',mobileRides.media.matches?'mobile-detail-panel':'stop-details');
    $('open-guide').setAttribute('aria-expanded','true');
  }
  function updateGuide(){
    if(!data)return;
    $('guide-route').textContent=routeLabel();
    const history=data.routeHistory;
    if(history?.service_start_date){
      const source=el('a','Service began '+history.service_start_date);source.href=history.source_url;source.target='_blank';source.rel='noopener noreferrer';
      $('guide-route').append(document.createTextNode(' · '),source);
    }
    $('guide-dates').textContent=`Permit issue dates shown: ${$('start').value} through ${$('end').value}. Issued does not mean completed, or caused by transit.`;
    const sources=(data.zoning?.sources||[]).filter(s=>s.available);
    $('guide-zoning').textContent=sources.map(s=>`${s.name}: ${s.effectiveDate?'effective '+s.effectiveDate.slice(0,10):'effective date unavailable'}${s.retrievedAt?', retrieved '+s.retrievedAt.slice(0,10):''}`).join(' · ');
    $('guide-zoning').hidden=!sources.length;
    $('guide-zoning-details').hidden=!sources.length;
    $('guide-prompts').hidden=data.routeId!=='23_102638';
  }
  function closeGuide(restoreFocus=false){
    $('explore-guide').hidden=true;$('open-guide').setAttribute('aria-expanded','false');
    if(restoreFocus)$('open-guide').focus({preventScroll:true});
  }
  $('open-guide').addEventListener('click',()=>{
    if(!$('explore-guide').hidden){closeGuide(true);return;}
    const project=selectedProject&&$('project-floating-card')&&data?.projects.find(p=>p.SourcePermitNumbers===selectedProject);
    if(project){routeMap.openProjectCard(project,true,true);return;}
    if(explicitStop&&explicitStop===selected){
      if(mobileRides.media.matches&&mobileRides.mode==='details'){mobileRides.setMode('map');return;}
      inspectStop();return;
    }
    showGuide();
  });
  document.addEventListener('general-guide-request',()=>showGuide(true));
  $('guide-general').addEventListener('click',()=>showGuide(true));
  document.addEventListener('mobile-details-closed',()=>{if($('explore-guide').hidden){$('open-guide').setAttribute('aria-expanded','false');$('open-guide').setAttribute('aria-controls','explore-guide');}});
  document.addEventListener('project-card-open',()=>{
    const card=$('project-floating-card');if(!card)return;
    const general=el('button','How to explore');general.addEventListener('click',()=>{card.remove();showGuide(true);});card.append(general);
  });
  const general=el('button','How to explore');general.addEventListener('click',()=>showGuide(true));document.querySelector('.workspace > aside').prepend(general);
  $('close-guide').addEventListener('click',()=>closeGuide(true));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('explore-guide').hidden){event.preventDefault();closeGuide(true);}});
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('#explore-guide,#open-guide'))closeGuide();});
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
  const routeMap = new window.RouteMap($('map'), (id,stopArea) => selectStop(id,stopArea), p => selectProject(p));
  const mobileRides = new window.MobileRides();
  new window.OriginPicker(routeMap, async (route, origin, boardingId, directionId) => {
    if(busy || !data)return;
    document.getElementById('origin-dialog').close();
    const previous=snapshot();
    $('route').value=route;
    await load(false,{origin,previous,boardingId,directionId});
  });
  const frontageLens = new window.FrontageLens(routeMap, (boardingId, pathName, options={}) => {
    if(options.fromScrub){explicitStop='';closeGuide();if(mobileRides.mode==='details')mobileRides.setMode('map');}
    const stop = data?.stops.find(s => s.oba_stop_ids.includes(boardingId));
    if (!stop) return;
    const direction = data.directions.find(d => d.id === $('direction').value);
    if (direction && !direction.stopOrder.includes(stop.id)) {
      $('direction').value = data.directions.find(d => (d.id === frontageLens.profile?.directionId) && d.stopOrder.includes(stop.id))?.id || '';
    }
    if(options.fromScrub&&selected===stop.id&&!selectedProject)return;
    selectStop(stop.id,false,options);
  });
  for(const [id,event] of [['profile-lens-mode','click'],['show-zoning','change'],['frontage-path','change']])$(id).addEventListener(event,()=>{closeGuide();if(mobileRides.mode==='details')mobileRides.setMode('map');});
  function fit() { routeMap.fit(); }
  new window.FeedbackForm(()=>{
    const stop=data?.stops.find(s=>s.id===selected);
    const context={routeId:data?.routeId||'',routeName:routeLabel(),lens:frontageLens.elevation.mode==='elevation'?'Elevation':$('show-zoning').checked?'Current zoning':'Development'};
    if(stop){context.stopId=stop.id;context.stopName=stop.name;}
    return Object.fromEntries(Object.entries(context).map(([key,value])=>[key,String(value).slice(0,200)]));
  });
  $('open-feedback').addEventListener('click',()=>document.dispatchEvent(new Event('feedback-open')));
  function zoom(factor) { routeMap.zoom(factor); }
  function makeMap(handoff) { routeMap.load(data); frontageLens.load(data,handoff); }
  function stats(target, summary, available=true) {
    target.replaceChildren();
    for (const [key, label] of Object.entries(labels).filter(([key])=>["permits","net","value"].includes(key))) {
      const card = el('div', undefined, 'stat');
      card.append(el('span', label), el('strong', available ? fmt(key, summary[key]) : '—'));
      if (key === 'value' && available) card.title = money.format(summary[key]);
      target.append(card);
    }
  }
  function renderZoningPie(zone,projects=[],permits=[],available=true){
    const pie=$('zoning-pie'), key=$('zoning-pie-key');key.replaceChildren();pie.replaceChildren();
    const labels={residential:'Neighborhood residential',multifamily:'Multifamily',mixed:'Other mixed use',downtownMixed:'Downtown Mixed',commercial:'Commercial',nc:'Neighborhood Commercial',ncp:'Neighborhood Commercial · Pedestrian',institutional:'Institutional',industrial:'Industrial',open:'Open space',unknown:'Unmapped / unclassified'};
    const group=name=>{const k=zoningCharacter(name);return /^nc[123]p$/.test(k)?'ncp':/^nc[123]$/.test(k)?'nc':k;};
    const palette={...characterPalette,nc:characterPalette.nc2,ncp:characterPalette.nc3p}, measure=$('comparison-measure').value;
    const measureLabel={permits:'Permit records',added:'Housing units added',value:'Estimated construction value'}[measure];
    $('comparison-title').textContent=`Land share vs ${measureLabel.toLowerCase()}`;
    $('comparison-caption').textContent=`Inner: land area · Outer: ${measureLabel.toLowerCase()} by zoning`;
    const land=Object.fromEntries(Object.keys(labels).map(k=>[k,0])), actual={...land};
    for(const c of zone?.categories || [])land[group(c.name)]+=c.percent;
    land.unknown+=Math.max(0,100-(zone?.coveredPercent || 0));
    const records=measure==='permits'?permits:projects;
    const mismatch=Object.fromEntries(Object.keys(labels).map(k=>[k,0]));
    let total=0,missing=0;
    for(const p of records){
      const raw=measure==='permits'?1:p[measure==='added'?'HousingUnitsAdded':'EstProjectCostNumeric'];
      if(raw==null || !Number.isFinite(Number(raw))){missing++;continue;}
      const amount=Math.max(0,Number(raw));total+=amount;const family=group(p.CurrentZoning || 'Unknown');actual[family]+=amount;
      if(housingZoningMismatch(p)==='single')mismatch[family]+=amount;
    }
    const gradient=values=>{let offset=0;return 'conic-gradient('+Object.keys(labels).map(k=>{const start=offset;offset+=values[k];return `${palette[k]} ${start}% ${offset}%`;}).join(',')+')';};
    const shares=Object.fromEntries(Object.keys(labels).map(k=>[k,total?actual[k]/total*100:0]));
    pie.hidden=!!zone?.overlap;
    let offset=0;const segments=[];
    for(const k of Object.keys(labels)){
      const flagged=total?(mismatch[k] || 0)/total*100:0;
      segments.push(`${palette[k]} ${offset}% ${offset+shares[k]-flagged}%`);offset+=shares[k]-flagged;
      if(flagged){segments.push(`${palette.residential} ${offset}% ${offset+flagged}%`);offset+=flagged;}
    }
    pie.style.background=total?'conic-gradient('+segments.join(',')+')':'#e1e5e2';
    const inner=el('div',undefined,'comparison-inner');inner.style.background=gradient(land);pie.append(inner,el('div',undefined,'comparison-hole'));
    pie.setAttribute('aria-label',`Land area and ${measureLabel.toLowerCase()} shares; percentages in adjacent table.`);
    for(const k of Object.keys(labels)){
      if(!land[k]&&!actual[k])continue;
      if(k==='unknown' && land[k]<1 && shares[k]<1)continue;
      const row=el('div'),swatch=el('i');swatch.style.background=palette[k];if(k==='ncp')swatch.classList.add('pedestrian-swatch');
      row.append(swatch,el('span',labels[k]),el('strong',`${land[k].toFixed(1)}% / ${total?shares[k].toFixed(1)+'%':'—'}`));
      row.title=`${labels[k]}: ${land[k].toFixed(1)}% land; ${total?shares[k].toFixed(1)+'% '+measureLabel.toLowerCase():'no measured development'}`;key.append(row);
    }
    $('comparison-coverage').textContent=`Both rings group by current zoning. Pale residential segments within development slices identify explicit new single-family construction. Category totals include these segments. Seattle permits only.${missing?' '+missing+' records lack this measure.':''}${!available?' Development data unavailable for this area; Seattle permit coverage only.':!total?' No measured '+measureLabel.toLowerCase()+' in this selection.':''}${zone?.overlap?' Overlapping land categories: shares are not additive; wheel unavailable.':''}`;
  }
  function selectStop(id,stopArea=false,options={}) {
    explicitStop=options.fromScrub?'':id;closeGuide();
    $('project-floating-card')?.remove();
    if(!id)$('map-all-stops').checked=true;else if(!options.fromScrub&&(stopArea||!selected))$('map-all-stops').checked=false;
    selectedProject='';selected=id;$('stop').value=id;render();
    if(id&&!options.fromScrub){
      frontageLens.selectMapStop(data.stops.find(s=>s.id===id));
      document.getElementById('project-floating-card')?.remove();
    }
    document.dispatchEvent(new CustomEvent('route-stop-selected',{detail:{map:routeMap,stop:data.stops.find(s=>s.id===id),preserveView:true}}));
    if(options.inspect)inspectStop();
  }
  function selectProject(project, fromRow = false) {
    explicitStop='';closeGuide();
    selectedProject = project?.SourcePermitNumbers || '';
    if (fromRow) $('show-projects').checked = true;
    render();
    if(project)routeMap.highlightProject(project, fromRow);
    else $('map-project-info').replaceChildren();
    if (fromRow && !mobileRides.media.matches) $('map').scrollIntoView({block:'center',behavior:'smooth'});
  }
  function snapshot() {
    return {route:data.routeId, stop:selected, project:selectedProject, view:[...routeMap.view],
      profileId:frontageLens.profile?.id, fraction:Number(frontageLens.slider.value)/1000,
      label:`${routeLabel()} · ${data.stops.find(s=>s.id===selected)?.name || 'All stops'}`,
      controls:Object.fromEntries(controlIds.map(id=>[id,$(id).value]))};
  }
  function routeLabel() {
    const info=catalog.find(r=>r.route_id===data?.routeId);
    return data?.routeId==='23_102638' ? 'First Hill Streetcar · 96' : (info?.name && /^\d+$/.test(info.name) ? 'Route '+info.name : info?.name) || data?.routeName || '';
  }
  async function connect(route, sourceStop) {
    if (busy) return;
    const previous=snapshot(), origin=sourceStop || data.stops.find(s=>s.id===selected);
    $('route').value=route;
    await load(false,{origin, previous});
  }
  async function loadDepartures() {
    if (!selected || busy) return;
    const requestedStop = selected, requestedRoute = data.routeId;
    departureStop = `${requestedRoute}:${requestedStop}`;
    $('load-departures').disabled = true;
    $('departure-note').textContent = 'Checking this route and nearby departures… Sparse routes may need a daily schedule search.';
    $('departures').replaceChildren();
    try {
      const response = await fetch(`/api/departures?route=${encodeURIComponent(data.routeId)}&stop=${encodeURIComponent(requestedStop)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load departures.');
      if (selected !== requestedStop || data.routeId !== requestedRoute) return;
      const now = Date.now();
      const showGroup=(heading,items)=>{
        $('departures').append(el('h4',heading));
        for(const item of items){
          const minutes=Math.max(0,Math.round((item.departureTime-now)/60000));
          const row=el('div',undefined,'departure');
          const when=minutes<60?(minutes===0?'Due':`${minutes} min`):new Date(item.departureTime).toLocaleString('en-US',{timeZone:'America/Los_Angeles',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
          row.append(el('strong',item.route || 'Route'),el('span',item.destination),el('b',when));
          const basis=el('small',item.predicted?'Live prediction':'Scheduled · Seattle time');row.append(basis);
          row.title=`${basis.textContent} · ${new Date(item.departureTime).toLocaleString('en-US',{timeZone:'America/Los_Angeles'})}`;
          $('departures').append(row);
          for(const link of item.linkedTrips || []){
            const routeName=catalog.find(r=>r.route_id===link.routeId)?.name || link.route;
            const text=link.relation==='next'?`Vehicle’s next scheduled trip: ${routeName} toward ${link.destination}.`:`Vehicle’s previous scheduled trip: ${routeName} toward ${link.destination}.`;
            $('departures').append(el('p',text+' Same-vehicle schedule link; confirm whether you can stay aboard.','departure-link'));
          }
          if(item.linksChecked===false)$('departures').append(el('p','Through-trip details unavailable.','departure-link'));
        }
      };
      showGroup(`Selected route · ${routeLabel()}`,result.selectedDepartures || []);
      if(!result.selectedDepartures?.length)$('departures').append(el('p',result.selectedMessage));
      if(result.otherDepartures?.length)showGroup('Other routes at this stop · next two hours',result.otherDepartures);
      $('departure-note').textContent=`OneBusAway · ${result.scheduleSearched?'Daily schedules searched up to seven days ahead. ':''}Scheduled times are not live predictions. Refresh manually. ${(result.notes || []).join(' ')}`;

    } catch (error) {
      if (selected === requestedStop && data.routeId === requestedRoute) $('departure-note').textContent = error.message;
    } finally {
      if (selected === requestedStop && data.routeId === requestedRoute) $('load-departures').disabled = false;
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
      if(row.available===false){node.append(el('span',row.name),el('b','—'));node.setAttribute('aria-label',`${row.name}: development data unavailable`);target.append(node);continue;}
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
    updateGuide();
    const start = $('start').value, end = $('end').value;
    const valid = start && end && start <= end;
    $('date-error').textContent = valid ? '' : 'Choose both dates, with the start on or before the end.';
    $('dashboard').hidden = !valid;
    if (!valid) return;
    $('date-coverage').textContent = data.maxDate && end > data.maxDate ? `Latest cached qualifying permit in this corridor: ${data.maxDate}. The selected range extends beyond that date; recent data may be incomplete.` : '';
    const direction = $('direction').value;
    frontageLens.syncDirection(direction);
    const orderedIds = (data.directions || []).find(d=>d.id === direction)?.stopOrder;
    const orderedStops = orderedIds ? orderedIds.map(id=>data.stops.find(s=>s.id===id)).filter(Boolean) : data.stops;
    if (selected && !orderedStops.some(s=>s.id===selected)) { selected=''; selectedProject=''; }
    $('stop').replaceChildren(new Option('All stops', ''), ...orderedStops.map(s=>new Option(s.name,s.id)));
    $('stop').value = selected;
    const stopIndex=orderedStops.findIndex(s=>s.id===selected);
    $('previous-stop').disabled=stopIndex<=0;
    $('first-stop').disabled=!orderedStops.length||stopIndex===0;
    $('last-stop').disabled=!orderedStops.length||stopIndex===orderedStops.length-1;
    $('next-stop').disabled=!orderedStops.length || stopIndex===orderedStops.length-1;
    const scope = rows => filterDevelopment(inPeriod(rows, start, end), $('project-status').value, $('work-type').value).filter(p => matchesStop(p, '', direction));
    const projects = scope(data.projects);
    const permits = scope(data.permits);
    if (!projects.some(p=>p.SourcePermitNumbers===selectedProject && matchesStop(p, selected, direction))) selectedProject='';
    const chosenProjects = selected ? projects.filter(p => matchesStop(p, selected, direction)) : projects;
    const chosenPermits = selected ? permits.filter(p => matchesStop(p, selected, direction)) : permits;

    // Record absence is not proof of zero development or geographic coverage.
    // Establish evidence from all cached dates, before applying UI filters.
    const developmentAvailable=data.permits.some(p=>matchesStop(p,selected,direction));
    stats($('stop-summary'), summarize(chosenProjects, chosenPermits),developmentAvailable);
    if(!developmentAvailable)$('stop-summary').prepend(el('p','Development data unavailable · No cached Seattle permit records for this area.','development-unavailable'));
    else if(chosenProjects.length && chosenProjects.every(p=>p.EstProjectCostNumeric==null)){const card=$('stop-summary').lastElementChild;card.querySelector('strong').textContent='—';card.title='Estimated construction value unavailable';}
    $('period').textContent = `${start} — ${end} · issue dates`;
    const stop = data.stops.find(s => s.id === selected);
    if (stop) { lastSummaryStop=stop.id; lastSummaryRoute=data.routeId; }
    const remembered=lastSummaryRoute===data.routeId && orderedStops.find(s=>s.id===lastSummaryStop);
    $('summary-title').textContent=stop ? stop.name : 'Full route';
    $('summary-stop').disabled=!remembered;
    $('summary-stop').textContent=remembered ? remembered.name : 'Selected stop';
    $('summary-stop').setAttribute('aria-pressed',String(!!stop));
    $('summary-route').setAttribute('aria-pressed',String(!stop));
    if (departureStop !== `${data.routeId}:${selected}`) {
      departureStop = '';
      $('departures').replaceChildren();
      $('departure-note').textContent = stop ? 'Check this route’s next departure and other routes at this stop.' : 'Select a stop to check departures.';
    }
    $('load-departures').disabled = !stop || busy;
    $('selection-title').textContent = stop ? stop.name : 'All stops';
    $('selection-title').title = stop?.fullName || '';
    $('stop-full-name').textContent = stop?.fullName || '';
    $('map-route-title').textContent = routeLabel();
    $('continuation-note').hidden=data.routeId!=='1_100223';
    $('continuation-note').textContent=data.routeId==='1_100223'?'Includes Route 44 stops and development to Ballard.':'';
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
      available:data.permits.some(p=>matchesStop(p,s.id,direction)),
      summary: summarize(projects.filter(p => matchesStop(p, s.id, direction)), permits.filter(p => matchesStop(p, s.id, direction)))}));
    drawBars($('ranking'), sortChartRows(rows, $('sort').value, metric, $('housing-sort').value), metric, true);
    $('ranking-note').textContent = ['asc','desc'].includes($('sort').value) ? 'Ranks follow the selected metric and sort direction; ties share a rank.' : $('sort').value === 'name' ? 'Stops sorted alphabetically.' : direction ? 'Numbers follow the selected departure direction.' : 'Choose a direction for departure order. Combined view uses the first group, with additional stops appended.';
    $('annual-metric').textContent = $('metric').selectedOptions[0].textContent;
    drawBars($('annual-chart'), annualSummaries(chosenProjects, chosenPermits, start, end), metric);
    $('annual-title').textContent = `${$('metric').selectedOptions[0].textContent} by issue year${stop?' · '+stop.name:''}`;
    if(!developmentAvailable){$('annual-chart').replaceChildren(el('p','Development data unavailable'));$('ranking').replaceChildren(el('p','Development data unavailable'));}
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

    const mapProjects=projects;
    routeMap.update(mapProjects, selected, {direction, selectedProject, topStops:topStops(rows,metric,$('housing-sort').value), permitCounts: Object.fromEntries(rows.map(row => [row.id, row.summary.permits])), projects: $('show-projects').checked, catchments: $('show-catchments').checked, allRoutePermits: $('map-all-stops').checked, geography: $('show-geography').checked, size: $('project-size').value, zoning: $('show-zoning').checked});
    $('comparison-note').textContent = `Gold rings mark the highest ${metric==='housing' ? labels[$('housing-sort').value] : labels[metric]} totals among stops in the selected direction(s); ties included. Filters change the totals. Point colors show suggested use; size shows the selected development measure. No rings when all totals are zero or negative.`;
    frontageLens.highlightStop(stop);
    $('focus-stop').disabled = !selected;
    $('map-all-stops').disabled=!selected;
    if(!selected)$('map-all-stops').checked=true;
    $('map-all-stops').setAttribute('aria-label','Show all route permits instead of stop-area permits');
    $('zoning-summary').replaceChildren();
    renderZoningPie(null,chosenProjects,chosenPermits,developmentAvailable);
    if (data.zoning) {
      const zone=(direction ? data.zoning.directionSummaries?.[direction]?.[selected || 'all'] : data.zoning.summaries[selected || 'all']) || {coveredPercent:0,categories:[],overlap:false};
      renderZoningPie(zone,chosenProjects,chosenPermits,developmentAvailable);
      $('zoning-note').textContent = `${stop ? stop.name : 'Whole route corridor'} · ${zone.coveredPercent.toFixed(1)}% mapped · ${data.zoning.sources?.filter(s=>s.available&&s.inView).map(s=>s.name).join(', ') || 'no imported zoning in this view'}${zone.overlap ? ' · Overlapping categories: percentages are not additive.' : ''}`;
      for(const category of [...zone.categories, {name:'Unmapped / coverage unavailable',percent:Math.max(0,100-zone.coveredPercent)}]) {
        const row=el('div', undefined, 'zone-row'); const name=el('span', category.name);const swatch=el('i', undefined, 'legend-swatch');swatch.style.background=window.zoningColor(category.name);name.prepend(swatch);row.append(name,el('strong', category.percent.toFixed(1)+'%')); $('zoning-summary').append(row);
      }
    } else $('zoning-note').textContent = 'No zoning cache yet. Choose a zoning source under Retrieve updated data.';

    const choice=id=>$(id).selectedOptions[0]?.textContent || '';
    $('active-context').textContent = `Permits since ${start}${end!==seattleToday() ? ' · through '+end : ''}${choice('work-type')!=='All work' ? ' · '+choice('work-type') : ''} · ${choice('project-status')}`;
    $('transfers').replaceChildren();
    $('transfer-note').textContent = '';
    const connections=new Map();
    for(const source of stop ? [stop] : orderedStops){
      for(const connection of data.transfers?.stops[source.id] || []){
        if(!connections.has(connection.routeId))connections.set(connection.routeId,{...connection,source});
      }
    }
    for(const connection of connections.values()){
      const button=el('button',connection.name,'connection-route');
      button.disabled=busy || !catalog.some(r=>r.route_id===connection.routeId);
      button.dataset.routeId=connection.routeId;
      button.setAttribute('aria-label',`Explore ${connection.name}`);
      button.title=`${connection.source.name} · ${connection.sameStop?'Same boarding stop':connection.distanceFeet+' ft straight-line; walking access unverified'}`;
      button.addEventListener('click',()=>connect(connection.routeId,connection.source));
      $('transfers').append(button);
    }
    if(!connections.size)$('transfer-note').textContent='No connections found in cached data.';

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
    if (!sorted.length) { const cell = el('td', developmentAvailable?'No development projects in this selection. Try a wider date range.':'Development data unavailable for this area. Seattle permits only.'); cell.colSpan = 7; const row = el('tr'); row.append(cell); $('project-rows').append(row); }
  }
  const routeDataCache=new window.RouteDataCache();
  async function load(refresh = false, transition = null) {
    if (busy) return;
    busy = true; document.body.classList.add('route-loading'); $('refresh').disabled = true; $('route').disabled = true;
    $('status').className = '';
    const loadingName=catalog.find(r=>r.route_id===$('route').value)?.name || 'route';
    $('status').textContent = refresh ? 'Updating source data… This can take a few minutes.' : `Loading ${loadingName}… Preparing the map and development stats.`;
    const loadingReminder=setTimeout(()=>{if(busy)$('status').textContent=refresh?'Still updating source data… Large downloads can take a few minutes.':`Still loading ${loadingName}… The route analysis is taking a little longer.`;},10000);
    const route = $('route').value || '23_102638';
    const oldScale=routeMap.scale;
    const oldView=[...routeMap.view];
    const center=data?routeMap.inverse(oldView[0]+oldView[2]/2,oldView[1]+oldView[3]/2):null;
    const riding=data&&Number(frontageLens.slider.value)>0;
    const oldPosition=riding&&frontageLens.profile?profilePosition(frontageLens.profile,Number(frontageLens.slider.value)/1000):null;
    const handoff=transition?.origin?transition:!refresh&&data&&route!==data.routeId?{origin:oldPosition||data.stops.find(s=>s.id===selected)||(center?{x:center[0],y:center[1]}:null)}:null;
    const url = refresh ? `/api/refresh?route=${encodeURIComponent(route)}&source=${$('source').value}` : `/api/data?route=${encodeURIComponent(route)}`;
    try {
      // A source refresh can affect multiple corridors, so invalidate all entries.
      if(refresh)routeDataCache.clear();
      const result = await routeDataCache.get(route,async()=>{
        const response = await fetch(url, refresh ? {method: 'POST', headers: {'X-Route-Explorer': '1'}} : {});
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load route.');
        return payload;
      });
      const changed = !data || data.routeId !== result.routeId;
      const displayNames=stopDisplayNames(result.stops);
      for (const stop of result.stops) { stop.fullName=stop.name; stop.name=displayNames[stop.id]; }
      document.getElementById('project-floating-card')?.remove();
      data = result; selected = ''; selectedProject = '';explicitStop='';closeGuide();mobileRides.setMode('map');

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
      if (transition?.restore) {
        for (const [id,value] of Object.entries(transition.restore.controls)) $(id).value=value;
        selected=transition.restore.stop; selectedProject=transition.restore.project;
        markPreset('custom'); navigation.pop();
      } else if (transition?.origin) {
        if(transition.directionId && data.directions.some(d=>d.id===transition.directionId))$('direction').value=transition.directionId;
        selected=data.stops.find(s=>s.oba_stop_ids.includes(transition.boardingId))?.id || closestStop(data.stops,transition.origin)?.id || '';
        navigation.push(transition.previous);
      } else if (!refresh) navigation.length=0;
      makeMap(transition?.restore?{fraction:transition.restore.fraction,directionId:transition.restore.controls.direction}:handoff);
      if(transition?.restore?.profileId){frontageLens.path.value=transition.restore.profileId;frontageLens.showPath({fraction:transition.restore.fraction});}
      render();
      if (transition?.restore) { routeMap.view=[...transition.restore.view]; routeMap.setView(); }
      else if(handoff&&frontageLens.handoffPoint){
        const point=frontageLens.handoffPoint,[x,y]=routeMap.xy([point.x,point.y]);
        const width=Math.min(oldView[2]/oldScale,1400)*routeMap.scale,height=width*oldView[3]/oldView[2];
        routeMap.view=[x-width/2,y-height/2,width,height];routeMap.setView();
      }
      else if (transition?.origin && selected) routeMap.focusStop(selected);
      document.dispatchEvent(new CustomEvent('route-loaded',{detail:{routeId:data.routeId}}));
      $('status').textContent = `${refresh ? 'Data refreshed. ' : ''}${data.stops.length} physical stops · ${number.format(data.projects.length)} projects across all cached dates. Choose dates to explore.`;
    } catch (error) {
      $('status').className = 'error';
      $('status').textContent = `${error.message}${data ? ' The previous route remains displayed.' : ''}`;
      if (data) $('route').value = data.routeId;
    } finally { clearTimeout(loadingReminder);busy = false; document.body.classList.remove('route-loading'); $('refresh').disabled = false; $('route').disabled = false; }
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
  function stepStop(delta){
    const options=Array.from($('stop').options).filter(o=>o.value);
    const index=options.findIndex(o=>o.value===selected), next=index+delta;
    if(next>=0 && next<options.length){
      selectStop(options[next].value);
      if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)$('stop-summary').animate([{opacity:.4,transform:`translateX(${delta*10}px)`},{opacity:1,transform:'translateX(0)'}],{duration:160,easing:'ease-out'});
    }
  }
  for(const [id,last] of [['first-stop',false],['last-stop',true]])$(id).addEventListener('click',()=>{const stops=Array.from($('stop').options).filter(o=>o.value);const target=last?stops.at(-1):stops[0];if(target)selectStop(target.value);});
  $('previous-stop').addEventListener('click',()=>stepStop(-1));
  $('next-stop').addEventListener('click',()=>stepStop(1));
  $('comparison-measure').addEventListener('change',render);
  let swipeStart=null;
  $('stop-summary').addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')swipeStart={x:e.clientX,y:e.clientY};});
  $('stop-summary').addEventListener('pointerup',e=>{
    if(!swipeStart)return;
    const dx=e.clientX-swipeStart.x,dy=e.clientY-swipeStart.y;swipeStart=null;
    if(Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy)*1.5)stepStop(dx<0?1:-1);
  });
  $('stop-summary').addEventListener('pointercancel',()=>swipeStart=null);
  $('summary-route').addEventListener('click',()=>selectStop(''));
  $('summary-stop').addEventListener('click',()=>selectStop(lastSummaryStop));
  $('map-all-stops').addEventListener('change',render);
  $('clear').addEventListener('click', () => selectStop(''));
  $('reset').addEventListener('click', () => { if (!data) return; $('direction').value = ''; $('project-status').value = ''; $('work-type').value = ''; $('metric').value = 'housing'; $('sort').value = 'route'; $('housing-sort').value = 'net'; selected = ''; selectedProject = ''; $('stop').value = ''; applyPreset(data.defaultPreset); });
  $('route').addEventListener('change', () => load());
  $('refresh').addEventListener('click', () => load(true));
  $('fit').addEventListener('click', fit);
  $('zoom-in').addEventListener('click', () => zoom(.75));
  $('color-palette').value=previousPalette?'previous':'urban';
  $('color-palette').addEventListener('change',()=>{
    try{localStorage.setItem('route-lens-palette',$('color-palette').value);location.reload();}
    catch{$('status').className='error';$('status').textContent='Palette preference could not be saved on this device.';}
  });
  const legendKeys=['residential','multifamily','commercial','nc1','nc2','nc3','nc3p','downtownMixed','mixed','institutional','industrial','open','unknown'];
  document.querySelectorAll('.project-key .legend-swatch').forEach((node,i)=>{node.style.background=permitPalette[legendKeys[i]];});
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
      new window.MobileRoutePicker(catalog,routeMap);
      await load();
    } catch (error) { $('status').className = 'error'; $('status').textContent = error.message; }
  })();
}
