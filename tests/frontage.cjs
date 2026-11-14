const assert=require('node:assert/strict');
const {profilePosition}=require('../web/frontage.js');
const p={lengthFeet:200,vertices:[{x:0,y:0,distanceFeet:0},{x:100,y:0,distanceFeet:100},{x:100,y:100,distanceFeet:200}]};
assert.deepEqual(profilePosition(p,.75),{x:100,y:50,distance:150});
assert.deepEqual(profilePosition(p,0),{x:0,y:0,distance:0});
assert.deepEqual(profilePosition(p,2),{x:100,y:100,distance:200});
console.log('Profile interpolation follows bends, endpoints and clamped distance.');
{
  const {nearestProfilePosition}=require('../web/frontage.js');
  assert.deepEqual(nearestProfilePosition(p,{x:110,y:50}),{gap:10,fraction:.75});
  const disconnected={lengthFeet:200,vertices:[{x:0,y:0,distanceFeet:0},{x:100,y:0,distanceFeet:100},{x:1000,y:0,distanceFeet:100,breakBefore:true},{x:1100,y:0,distanceFeet:200}]};
  assert.equal(nearestProfilePosition(disconnected,{x:500,y:0}).gap,400,'handoff never projects onto an invented gap');
}
{
  const {orientProfile}=require('../web/frontage.js');
  const p={lengthFeet:100,vertices:[{x:10,y:0,distanceFeet:0},{x:5,y:0,distanceFeet:50},{x:0,y:0,distanceFeet:100,breakBefore:true}],samples:[{left:'A',right:'B',startFeet:0,endFeet:100}],stops:[{id:'east',distanceFeet:0},{id:'west',distanceFeet:100}],sections:[{route:'43',startFeet:0,endFeet:100}]};
  const r=orientProfile(p);
  assert.equal(r.vertices[0].x,0);
  assert.equal(r.vertices[1].breakBefore,true);
  assert.equal(r.samples[0].left,'B');
  assert.equal(r.stops[0].id,'west');
  assert.equal(r.stops[0].distanceFeet,0);
  assert.equal(p.samples[0].left,'A');
  assert.equal(orientProfile(r),r);
  const south=orientProfile({...p,vertices:[{x:0,y:10,distanceFeet:0},{x:0,y:0,distanceFeet:100}]});
  assert.equal(south.vertices[0].y,0);
  console.log('Geographic profile orientation, zoning sides and discontinuities passed.');
}
