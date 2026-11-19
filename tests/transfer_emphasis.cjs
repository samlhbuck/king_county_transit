const assert=require('node:assert/strict');
const {verifiedTransferPoints,transferProximity}=require('../web/route_visibility.js');
const data={routeId:'active',stops:[{id:'physical',oba_stop_ids:['north','south']}],transfers:{stops:{physical:[
  {routeId:'shared',sameStop:true,boardingLocations:[{id:'north',sameStop:true}]},
  {routeId:'opposite',sameStop:true,boardingLocations:[{id:'south',sameStop:true}]},
  {routeId:'nearby',sameStop:false,boardingLocations:[{id:'near',sameStop:false,distanceFeet:1}]},
  {routeId:'unproven',sameStop:true},
  {routeId:'active',sameStop:true,boardingLocations:[{id:'north',sameStop:true}]}
]}}};
const profile={stops:[{id:'north',distanceFeet:1000},{id:'north',distanceFeet:5000}]};
const points=verifiedTransferPoints(data,profile);
assert.deepEqual(points.map(p=>p.routeId),['shared','shared'],'exact boarding identity; no crossing/nearby/opposite/active inference');
assert.equal(transferProximity(points,1000).get('shared'),1);
assert.equal(transferProximity(points,700).get('shared'),.5,'smooth approach along traversal');
assert.equal(transferProximity(points,1300).get('shared'),.5,'smooth departure along traversal');
assert.equal(transferProximity(points,3000).size,0,'same geographic stop far along a loop is not nearby along traversal');
assert.equal(transferProximity(points,5000).get('shared'),1,'repeated traversal occurrence retained');
assert.equal(transferProximity(points,null).size,0);
assert.equal(verifiedTransferPoints({},profile).length,0,'missing evidence is silent');
assert.equal(verifiedTransferPoints(data,{stops:[{id:'south',distanceFeet:100}]}).map(p=>p.routeId).join(','),'opposite','direction-specific boarding evidence');
console.log('Shared boarding evidence, direction, repeated occurrences and along-traversal cue strength passed');
