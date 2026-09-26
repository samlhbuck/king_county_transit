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
assert.notEqual(projectColor({HousingUnitsAdded:0,PermitTypeDesc:'New'}),projectColor({HousingUnitsAdded:0,PermitTypeDesc:'Addition/Alteration'}));
assert.notEqual(projectColor({HousingUnitsAdded:20}),projectColor({HousingUnitsAdded:21}));
assert.notEqual(projectColor({HousingUnitsAdded:100}),projectColor({HousingUnitsAdded:101}));

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
