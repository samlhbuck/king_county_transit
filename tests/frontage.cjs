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
{
  const {opposingProfile,reversePosition}=require('../web/frontage.js');
  const profile=(directionId,points)=>({
    directionId,lengthFeet:(points.length-1)*100,
    vertices:points.map(([x,y],i)=>({x,y,distanceFeet:i*100}))
  });
  const active=profile('north',[[0,0],[100,0],[200,0]]);
  const couplet=profile('south',[[200,24],[150,24],[0,24]]);
  const branch=profile('branch',[[220,80],[100,80],[0,80]]);
  assert.equal(opposingProfile(active,[active,branch,couplet]),couplet);
  assert.equal(reversePosition(active,couplet,.5).gap,24);
  assert.ok(Math.abs(reversePosition(active,couplet,.5).fraction-2/3)<1e-9);
  const loop=profile('clockwise',[[0,0],[100,0],[100,100],[0,100],[0,0]]);
  const reversed=profile('counterclockwise',[[0,0],[0,100],[100,100],[100,0],[0,0]]);
  assert.equal(opposingProfile(loop,[loop,reversed]),reversed);
  assert.equal(reversePosition(loop,reversed,.25).fraction,.75);
}
