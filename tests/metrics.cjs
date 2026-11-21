const assert = require('node:assert/strict');
const {inPeriod, summarize} = require('../web/app.js');
const rows = [
  {IssuedDate: '2020-01-01T00:00:00', NearestStopId: 'a', HousingUnitsAdded: 10, HousingUnitsRemoved: 2, EstProjectCostNumeric: 100},
  {IssuedDate: '2020-12-31T23:59:59', NearestStopId: 'a', HousingUnitsAdded: null, HousingUnitsRemoved: 5, EstProjectCostNumeric: null},
  {IssuedDate: '2021-01-01T00:00:00', NearestStopId: 'b', HousingUnitsAdded: 20},
  {IssuedDate: null, NearestStopId: 'b'},
];
const selected = inPeriod(rows, '2020-01-01', '2020-12-31', 'a');
assert.equal(selected.length, 2);
assert.deepEqual(summarize(selected, [...selected, selected[0]]), {permits: 3, projects: 2, added: 10, removed: 7, net: 3, value: 100});
assert.deepEqual(summarize([], []), {permits: 0, projects: 0, added: 0, removed: 0, net: 0, value: 0});
assert.equal(inPeriod(rows, '2020-01-01', '2020-12-31', 'b').length, 0);
assert.equal(inPeriod(rows, '2022-01-01', '2020-01-01').length, 0);
assert.equal(summarize([rows[1]], []).net, -5);
console.log('Date boundaries, stop filtering, missing values, negative net units and distinct permit counts passed.');
const {presetRange} = require('../web/app.js');
const historyData = {routeHistory: {service_start_date: '2024-09-14'}, minDate: '2004-01-01'};
assert.deepEqual(presetRange('life', historyData, '2026-09-23'), ['2024-09-14', '2026-09-23']);
assert.deepEqual(presetRange('ytd', historyData, '2026-09-23'), ['2026-01-01', '2026-09-23']);
assert.deepEqual(presetRange('1y', historyData, '2024-02-29'), ['2023-02-28', '2024-02-29']);
assert.deepEqual(presetRange('5y', historyData, '2026-09-23'), ['2021-09-23', '2026-09-23']);
assert.deepEqual(presetRange('all', historyData, '2026-09-23'), ['2004-01-01', '2026-09-23']);
assert.equal(presetRange('life', {}, '2026-09-23'), null);
console.log('Route-life, YTD, rolling years, leap dates and unknown opening dates passed.');
const {sortChartRows, annualSummaries} = require('../web/app.js');
const chartRows = [
  {position: 1, name: 'Zulu', summary: {net: -3, added: 2, removed: 5, value: 80, permits: 3}},
  {position: 2, name: 'Alpha', summary: {net: 10, added: 10, removed: 0, value: 50, permits: 1}},
  {position: 3, name: 'Beta', summary: {net: 10, added: 12, removed: 2, value: 90, permits: 2}},
];
assert.deepEqual(sortChartRows(chartRows, 'desc', 'housing').map(r=>r.position), [2,3,1]);
assert.deepEqual(sortChartRows(chartRows, 'asc', 'housing').map(r=>r.position), [1,2,3]);
assert.deepEqual(sortChartRows(chartRows, 'desc', 'housing', 'removed').map(r=>r.position), [1,3,2]);
assert.deepEqual(sortChartRows(chartRows, 'desc', 'value').map(r=>r.position), [3,1,2]);
assert.deepEqual(sortChartRows(chartRows, 'desc', 'permits').map(r=>r.position), [1,3,2]);
assert.deepEqual(sortChartRows(chartRows, 'name', 'housing').map(r=>r.position), [2,3,1]);
assert.deepEqual(chartRows.map(r=>r.position), [1,2,3]);
const years = annualSummaries(selected, selected, '2020-01-01', '2021-12-31');
assert.equal(years[0].summary.net, 3);
assert.equal(years[0].summary.added, 10);
assert.equal(years[0].summary.removed, 7);
assert.equal(years[1].summary.permits, 0);
console.log('Chart sorting, ties, negative net units, annual totals and empty years passed.');
const {statusClass, housingCost, annualChange, rankDifferences} = require('../web/app.js');
assert.equal(statusClass('Completed'), 'status-complete');
assert.equal(statusClass('Issued'), 'status-issued');
assert.equal(statusClass('Completed / Issued'), 'status-neutral');
assert.equal(housingCost([{HousingUnitsAdded:10,EstProjectCostNumeric:1000},{HousingUnitsAdded:0,EstProjectCostNumeric:9000}]).perUnit,100);
assert.equal(housingCost([]).perUnit,null);
assert.equal(housingCost([{HousingUnitsAdded:10,EstProjectCostNumeric:null}]).perUnit,null);
assert.equal(rankDifferences(chartRows)[0].gap, 2);
assert.equal(annualChange([],[], '2025-01-01','2026-09-24','housing','2026-09-20'),null);
assert.equal(annualSummaries([],[], '2025-06-01','2026-09-24')[0].name,'2025 (partial)');
const {projectColor,groupProjectsByStop,projectPositions}=require('../web/map.js');

const {assignedStops,matchesStop,filterDevelopment}=require('../web/app.js');
const shared={StopAssignments:{out:'a',back:'b'},x:1,y:1,SourcePermitNumbers:'1',StatusCurrent:'Issued',PermitTypeDesc:'New'};
const paired={...shared,StopAssignments:{out:'a',back:'a'},SourcePermitNumbers:'2'};
assert.deepEqual(assignedStops(paired),['a']);
assert.equal(groupProjectsByStop([shared,paired]).get('a').length,2);
assert.equal(groupProjectsByStop([shared,paired]).get('b').length,1);
assert.equal(groupProjectsByStop([shared,paired],'out').has('b'),false);
assert.equal(matchesStop(shared,'b','out'),false);
assert.equal(filterDevelopment([shared,{...shared,StatusCurrent:'Completed'}],'issued','new').length,1);
assert.equal(filterDevelopment([shared],'issued','alteration').length,0);
assert.deepEqual(projectPositions([shared,paired]),projectPositions([paired,shared]));
assert.equal(summarize([shared,paired],[]).projects,2);
console.log('Directional membership, deduplication, status/work filters and stable colocated positions passed.');

assert.deepEqual(sortChartRows(chartRows, 'desc', 'housing').map(r=>r.rank), [1,1,3]);
assert.deepEqual(sortChartRows(chartRows, 'asc', 'housing').map(r=>r.rank), [1,2,2]);
assert.deepEqual(sortChartRows(chartRows, 'route', 'housing').map(r=>r.rank), [1,2,3]);
const {stopDisplayNames, closestStop, topStops} = require('../web/app.js');
const corridorNames = [
  {id:'a',name:'California Ave SW & SW Admiral Way / SW Admiral Way & California Ave SW'},
  {id:'h',name:'California Ave SW & SW Hanford St'},
  {id:'c',name:'California Ave SW & SW Charleston St'},
];
assert.equal(stopDisplayNames(corridorNames).a, 'Admiral');
assert.equal(stopDisplayNames(corridorNames).h, 'Hanford');
const oxbowNames=stopDisplayNames([...corridorNames,{id:'other',name:'48th Ave SW & SW Hanford St'}]);
assert.equal(oxbowNames.h, 'California / Hanford');
assert.equal(oxbowNames.other, '48th / Hanford');
const qualified=stopDisplayNames([{id:'e',name:'1st Ave & E Pine St'},{id:'w',name:'1st Ave & W Pine St'}]);
assert.notEqual(qualified.e,qualified.w);
assert.equal(closestStop([{id:'far',x:20,y:0},{id:'near',x:1,y:0}],{x:0,y:0}).id,'near');
assert.deepEqual(topStops([{id:'a',summary:{net:3}},{id:'b',summary:{net:3}}],'housing'),['a','b']);
assert.deepEqual(topStops([{id:'a',summary:{net:0}}],'housing'),[]);
console.log('Route-local stop names, oxbow ambiguity, nearest transfer stop and tied map leaders passed.');

assert.equal(stopDisplayNames([...corridorNames,{id:'branch',name:'48th Ave SW & SW Hanford St / 49th Ave SW & SW Hanford St'}]).h,'California / Hanford');

assert.equal(stopDisplayNames([...corridorNames,{id:'east',name:'1st Ave S & S Hanford St'}]).h,'SW Hanford St');

assert.equal(stopDisplayNames([...corridorNames,{id:'branch2',name:'48th Ave SW & SW Spokane St / SW Hanford St'}]).h,'California / Hanford');

const {zoningColor,crowdedStopIds,housingZoningMismatch}=require('../web/map.js');
assert.notEqual(projectColor({Description:'Construct ADU',HousingUnitsAdded:1}),zoningColor('Neighborhood Residential'));
assert.equal(projectColor({UseHint:'Mixed-use indicated',HousingUnitsAdded:120}),zoningColor('Neighborhood Commercial'));
assert.equal(projectColor({HousingUnitsAdded:120}),zoningColor('Midrise'));
assert.equal(projectColor({Description:'Unspecified work'}),zoningColor('Master Planned Community'));
assert.notEqual(projectColor({HousingUnitsAdded:1}),projectColor({HousingUnitsAdded:120}));
const stopPoints=[{id:'a',x:0,y:0},{id:'b',x:20,y:0},{id:'c',x:100,y:0}];
assert.deepEqual([...crowdedStopIds(stopPoints)],['a','b']);
assert.deepEqual([...crowdedStopIds(stopPoints.map(p=>({...p,x:p.x*3})))],[]);
assert.deepEqual([...crowdedStopIds([{id:'a',x:0,y:0},{id:'b',x:44,y:0}])],[]);
assert.deepEqual([...crowdedStopIds([{id:'a',x:0,y:0,radius:9},{id:'b',x:20,y:0,radius:12}])],['a','b']);
assert.deepEqual([...crowdedStopIds([{id:'a',x:0,y:0,radius:9},{id:'b',x:21,y:0,radius:12}])],[]);
for(const district of ['Seattle Mixed','Pioneer Square','International District','Master Planned Community — Yesler Terrace (MPC-YT)'])assert.equal(zoningColor(district),zoningColor('Neighborhood Commercial'));
assert.equal(zoningColor('Master Planned Community'),zoningColor('Unknown / unmapped'));
assert.notEqual(zoningColor('Seattle Mixed'),zoningColor('Unknown / unmapped'));
assert.notEqual(projectColor({Description:'New detached dwelling',HousingUnitsAdded:1}),zoningColor('Neighborhood Commercial 2'));
assert.equal(projectColor({StatusCurrent:'Expired',HousingUnitsAdded:50}),'#b7babb');
const contrast={PermitTypeDesc:'New',Description:'Construct single family dwelling',CurrentZoning:'Lowrise 3'};
assert.equal(housingZoningMismatch(contrast),'single');
assert.equal(housingZoningMismatch({...contrast,CurrentZoning:'Neighborhood Commercial 2'}),'single');
assert.equal(housingZoningMismatch({...contrast,Description:'Construct single family dwelling and ADU'}),null);
assert.equal(housingZoningMismatch({...contrast,PermitTypeDesc:'Addition/Alteration'}),null);
assert.equal(housingZoningMismatch({...contrast,Description:'Add one dwelling in existing apartment building'}),null);
assert.equal(housingZoningMismatch({...contrast,Description:'Construct apartment building',CurrentZoning:'Neighborhood Residential'}),'reverse');

// Route 9 / Orcas examples: expired housing must not inflate the default analysis.
const orcasProjects=[{StatusCurrent:'Expired',HousingUnitsAdded:85,EstProjectCostNumeric:13330602},
 {StatusCurrent:'Expired',HousingUnitsAdded:73,EstProjectCostNumeric:12831208},
 {StatusCurrent:'Completed',HousingUnitsAdded:10}, {StatusCurrent:'Issued',HousingUnitsAdded:2}];
assert.equal(summarize(filterDevelopment(orcasProjects,'',''),[]).added,12);
assert.equal(summarize(filterDevelopment(orcasProjects,'all',''),[]).added,170);
assert.equal(summarize(filterDevelopment(orcasProjects,'inactive',''),[]).added,158);
assert.equal(filterDevelopment([{StatusCurrent:'Expired / Issued'}],'','').length,0);

const {zoningCharacter}=require('../web/map.js');
assert.equal(zoningCharacter('Neighborhood Commercial 3 [NC3P-75 (M)]'),'nc3p');
assert.equal(zoningCharacter('Neighborhood Commercial 3 [NC3-75 (M)]'),'nc3');
assert.equal(zoningCharacter('Commercial 1'),'commercial');
assert.notEqual(zoningColor('Commercial 1'),zoningColor('Neighborhood Commercial 1'));
assert.notEqual(zoningColor('Neighborhood Commercial 3 [NC3P-75 (M)]'),zoningColor('Neighborhood Commercial 3'));
assert.equal(housingZoningMismatch({...contrast,CurrentZoning:'Neighborhood Commercial 3 [NC3P-75 (M)]'}),'single');

const {zoningShimmers}=require('../web/map.js');
assert.equal(zoningShimmers('Pioneer Square'),true);
assert.equal(zoningShimmers('Seattle Mixed'),false);
assert.equal(zoningShimmers('Neighborhood Commercial 3 [NC3P-75 (M)]'),true);

assert.equal(zoningShimmers('International District'),true);
assert.equal(zoningShimmers('Downtown Mixed'),false);

assert.equal(zoningCharacter('Downtown Mixed'),'downtownMixed');
assert.equal(zoningColor('Downtown Mixed'),'#3c51b2');
assert.notEqual(zoningColor('Downtown Mixed'),zoningColor('Seattle Mixed'));
assert.equal(housingZoningMismatch({...contrast,CurrentZoning:'Downtown Mixed'}),'single');

{
  const {basemapZoom}=require('../web/map.js');
  assert.equal(basemapZoom(256*2**12,1),12);
  assert.equal(basemapZoom(256*2**12*1.1,1),13);
  assert.equal(basemapZoom(256*2**12,2),13);
  assert.equal(basemapZoom(256*2**12,3),13);
  assert.equal(basemapZoom(256*2**22,2),19);
  console.log('Basemap resolution follows zoom and bounded screen density.');
}

{
  const {legibleStopPoints}=require('../web/map.js');
  const points=[{id:'selected',x:0,y:0,radius:12},{id:'opposing',x:0,y:0,radius:9},
    {id:'next',x:40,y:0,radius:9},{id:'next-opposing',x:41,y:0,radius:9}];
  assert.deepEqual(legibleStopPoints(points).map(stop=>stop.id),['selected','next']);
}
