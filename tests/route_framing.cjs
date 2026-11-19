const assert=require('node:assert/strict');
const {fittedRouteView,routeZoomWidth}=require('../web/map.js');
for(const [width,height] of [[1280,650],[390,844],[844,390]]){
  const area=[0,110,width,height-130];
  for(const bounds of [[0,0,80,85000],[0,0,30000,43000],[10,20,300,400]]){
    const view=fittedRouteView(bounds,width,height,area);
    const pixels=([x,y])=>[(x-view[0])*width/view[2],(y-view[1])*height/view[3]];
    const a=pixels(bounds.slice(0,2)),b=pixels(bounds.slice(2));
    assert.ok(a[0]>=area[0]+24-1e-8&&a[1]>=area[1]+24-1e-8);
    assert.ok(b[0]<=area[2]-24+1e-8&&b[1]<=area[3]-24+1e-8);
    assert.ok(Math.abs(view[2]/view[3]-width/height)<1e-9,'no aspect-ratio crop');
    const wider=routeZoomWidth(view,.01,4,view);
    assert.ok(wider>=view[2]*2,'manual zoom can exceed full route fit');
    assert.ok(routeZoomWidth([0,0,wider,wider*height/width],.01,.5,view)<wider,'zoom back in');
  }
}
const frame=fittedRouteView([0,0,100,810],746,468,[0,116,746,400]);
assert.ok(frame[2]>2400,'tall route on wide map exceeds former fixed cap');
assert.ok(routeZoomWidth([0,0,800,850],.01,100,frame)>frame[2]);
assert.ok(routeZoomWidth([0,0,800,850],.01,100,frame)*850/800>=frame[3],'old aspect ratios can fit too');
console.log('Padded fitting, long and short extents, aspect ratios, zoom limits and return zoom passed');
