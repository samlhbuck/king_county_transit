const assert=require('node:assert/strict');
const {originPoint,originDistance,nearbyBoardingStops,nearbyRouteOptions}=require('../web/location.js');
const a={lat:47.6,lon:-122.3};
assert.equal(originDistance(a,a),0);
assert.ok(Math.abs(originDistance(a,{lat:47.61,lon:-122.3})-1112)<2);
assert.ok(Number.isFinite(originPoint(a.lat,a.lon).y));
assert.deepEqual(nearbyBoardingStops([{...a,id:'near'},{lat:48,lon:-122.3,id:'far'}],a).map(s=>s.id),['near']);
assert.equal(nearbyBoardingStops(Array.from({length:12},(_,i)=>({...a,id:String(i)})),a).length,12);
console.log('Origin distance, coverage cutoff and result limit passed.');

const stop=(id,lat,directions)=>({id,lat,lon:a.lon,routes:['10'],directions:{'10':directions}});
const east={id:'0:e',name:'East'},west={id:'1:w',name:'West'};
const options=nearbyRouteOptions([stop('close',47.6,[east]),stop('redundant',47.601,[east]),stop('opposite',47.602,[west]),stop('unknown',47.603,[])],a);
assert.equal(options.length,1);
assert.deepEqual(options[0].options.map(o=>o.stop.id),['close','opposite','unknown']);
assert.equal(options[0].options[1].direction.name,'West');
const many=Array.from({length:12},(_,i)=>stop(String(i),47.6+i*.0001,[east]));
many.push({...stop('other-route',47.605,[west]),routes:['12'],directions:{'12':[west]}});
assert.equal(nearbyRouteOptions(many,a).length,2);
console.log('Route deduplication, destination choices, unknown directions and discovery beyond eight stops passed.');

{
  const {rankedRoutes}=require('../web/location.js');
  const catalog=[{route_id:'far',name:'40'},{route_id:'near',name:'8'},{route_id:'missing',name:'43'}];
  const stops=[{lat:47.6,lon:-122.3,routes:['near']},{lat:47.61,lon:-122.3,routes:['far']}];
  const ranked=rankedRoutes(catalog,stops,{lat:47.6,lon:-122.3});
  assert.deepEqual(ranked.map(r=>r.route_id),['near','far','missing']);
  assert.equal(rankedRoutes(catalog,stops,{lat:47.6,lon:-122.3},'43')[0].route_id,'missing');
  console.log('Route selector distance ranking and full-catalog search passed.');
}

{
 const {RecentRoutes}=require('../web/location.js');const history=new RecentRoutes();
 for(const id of ['49','8','10'])history.viewed(id);
 assert.deepEqual(history.choices('10'),['8','49']);
 history.viewed('49');assert.deepEqual(history.choices('49'),['10','8']);
 for(const id of ['1','2','3','4','5','6'])history.viewed(id);
 assert.equal(history.choices('6').length,5);
 console.log('Recent routes: successful-view ordering, deduplication and five previous choices passed');
}
