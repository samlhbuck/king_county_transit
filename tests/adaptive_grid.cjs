const assert=require('node:assert/strict');
const {visibilityGrid,routeVisibility,analyzeContextRoutes}=require('../web/route_visibility.js');
for(const [w,h] of [[390,844],[844,390],[1280,844]]){
  const g=visibilityGrid(w,h,{mode:'square',usableArea:[10,100,w-10,h-100]});
  assert.equal(g.w,g.h);assert.ok(g.rows*g.cols>0);
  assert.ok(Math.abs((g.eligible[2]-g.eligible[0])/(w-20)-.88)<1e-9);
  assert.ok(g.eligible[1]>100&&g.eligible[3]<h-100);
}
const config={mode:'square',squarePixels:100,squareFraction:1};
const horizontal=[[[0,200],[600,200]]],vertical=[[[200,0],[200,600]]];
assert.equal(routeVisibility(horizontal,600,600,config).count,routeVisibility(vertical,600,600,config).count,'orientation-neutral square grid');
assert.ok(routeVisibility(horizontal,600,600,config).passes);
const loop=Array.from({length:500},(_,i)=>[[295,295],[305,295],[305,305],[295,305]][i%4]);
assert.equal(routeVisibility([loop],600,600,config).passes,false,'repeated small loops do not create geographic reach');
const short=[[[295,295],[305,305]]];
assert.equal(routeVisibility(short,600,600,config).maxSpan,routeVisibility([loop],600,600,config).maxSpan,'span ignores traveled length');
assert.equal(routeVisibility([[[0,100],[80,100]],[[520,100],[600,100]]],600,600,config).passes,false,'fragments do not pool');
assert.equal(routeVisibility([[[700,100],[900,100]]],600,600,config).candidate,false);
assert.equal(routeVisibility([[[10,10],[30,30]]],600,600,config).passes,false,'citywide fragment rejected');
const candidates=[{id:'far-reaching',paths:horizontal},{id:'loop',paths:[loop]},{id:'outside',paths:[[[1000,1000],[2000,2000]]]}];
const a=analyzeContextRoutes(candidates,600,600,{...config,mode:'calibrated'});
const b=analyzeContextRoutes(candidates,600,600,{...config,mode:'calibrated',minimumCells:99});
assert.equal(a.referenceSpan,600,'only clipped candidates calibrate');
assert.equal(a.grid.w,b.grid.w,'eligibility never changes calibration candidates');
assert.equal(b.results.get('far-reaching').passes,false);
assert.equal(a.grid.w,a.grid.h);
console.log('Adaptive grids: square cells, usable coverage, orientation, loops, fragments and nonrecursive calibration passed');
