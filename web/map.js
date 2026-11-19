/* Stop-owned polygons and stable project detail over a geographic SVG map. */
// Shared visual families; official zoning names remain available in detail.
const characterPalette={residential:'#e4dfe3',multifamily:'#c57eae',mixed:'#657bd0',downtownMixed:'#3c51b2',commercial:'#54bfc9',nc1:'#d8deed',nc2:'#8e9edb',nc3:'#596dc6',nc1p:'#b8c3e8',nc2p:'#7d90d3',nc3p:'#4a60ba',institutional:'#6ba777',industrial:'#d7bf63',open:'#c5d0b5',unknown:'#b8bec1'};
const previousCharacterPalette={residential:'#c96b68',multifamily:'#358c87',mixed:'#528fc4',downtownMixed:'#103b70',commercial:'#c58b43',nc1:'#86b6d9',nc2:'#589acb',nc3:'#327bb5',nc1p:'#3985bd',nc2p:'#2169a7',nc3p:'#124d88',institutional:'#8270ac',industrial:'#9a7770',open:'#a3bb78',unknown:'#aeb6b7'};
let previousPalette=false;
if(typeof window!=='undefined'){try{previousPalette=localStorage.getItem('route-lens-palette')==='previous';}catch{} }
if(previousPalette)Object.assign(characterPalette,previousCharacterPalette);
const permitPalette={...characterPalette,residential:previousPalette?characterPalette.residential:'#b58198'};
function projectCharacter(project){
  const text=project.Description || '';
  if(project.UseHint==='Mixed-use indicated' || /mixed[ -]?use/i.test(text))return 'mixed';
  if(project.UseHint==='Institutional use indicated')return 'institutional';
  if(/\b(?:[ad]*adu)\b|accessory dwelling/i.test(text))return 'residential';
  if(/warehouse|manufactur|industrial/i.test(text))return 'industrial';
  if(/retail|commercial|office|restaurant/i.test(text))return 'commercial';
  if(project.HousingUnitsAdded>0 || /residen|apartment|dwelling|housing|townhous/i.test(text))return project.HousingUnitsAdded>5 || /apartment|multifamily|multi.family/i.test(text)?'multifamily':'residential';
  return 'unknown';
}
function zoningCharacter(name){
  // Yesler's 2011 SHA plan describes a mixed-income, mixed-use neighborhood.
  if(name==='Master Planned Community — Yesler Terrace (MPC-YT)')return 'mixed';
  // Other special plans and opaque local codes stay neutral.
  if(/master planned|overlap|unknown|unmapped/i.test(name))return 'unknown';
  if(/industrial|manufactur/i.test(name))return 'industrial';
  if(/major institution|institutional|campus/i.test(name))return 'institutional';
  // Named Seattle urban districts share the mixed-use visual family.
  if(/^(?:Seattle Mixed|Pioneer Square|International District)\b/i.test(name))return 'mixed';
  if(/^Downtown Mixed(?:$| \[)/i.test(name))return 'downtownMixed';
  const nc=name.match(/\bNC([123])(P)?(?=[\s\]-]|$)/i) || name.match(/^Neighborhood Commercial ([123])(?![0-9])/i);
  if(nc)return 'nc'+nc[1]+(nc[2]?'p':'');
  if(/^Commercial [12](?:\b)/i.test(name))return 'commercial';
  if(/mixed.?use|neighborhood commercial|commercial|downtown/i.test(name))return 'mixed';
  if(/multifamily|multi.family|lowrise|midrise|highrise/i.test(name))return 'multifamily';
  if(/neighbou?rhood residential|single.family|residential small lot|low.density residential/i.test(name))return 'residential';
  if(/open space|park|conservancy/i.test(name))return 'open';
  return 'unknown';
}
function zoningShimmers(name){
  return /^nc[123]p$/.test(zoningCharacter(name)) || /^(?:Pioneer Square|International District)(?:$| \[)/i.test(name);
}
function housingZoningMismatch(project){
  if(project.PermitTypeDesc!=='New')return null;
  const text=project.Description || '';
  if(/\b[ad]*adu\b|accessory dwelling|mixed[ -]?use/i.test(text))return null;
  const zone=zoningCharacter(project.CurrentZoning || 'Unknown');
  const single=/\bsingle[ -]family\b/i.test(text);
  const multi=/\bapartments?\b|\bmulti[ -]?family\b/i.test(text);
  if(single && !multi && (['multifamily','mixed','downtownMixed','commercial'].includes(zone) || /^nc[123]p?$/.test(zone)))return 'single';
  if(multi && !single && zone==='residential')return 'reverse';
  return null;
}
function projectColor(project){return /^expired$/i.test((project.StatusCurrent || '').trim())?'#b7babb':permitPalette[projectCharacter(project)];}
function groupProjectsByStop(projects, direction = '') {
  const groups = new Map();
  for (const project of projects) {
    const ids = project.StopAssignments ? (direction ? [project.StopAssignments[direction]].filter(Boolean) : [...new Set(Object.values(project.StopAssignments))]) : [project.NearestStopId];
    for (const id of ids) {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(project);
    }
  }
  return groups;
}
function projectPositions(projects) {
  // Separate only exactly colocated records, not arbitrary screen-grid neighbors.
  const locations = new Map();
  for (const project of projects) {
    const key = `${project.x.toFixed(3)},${project.y.toFixed(3)}`;
    if (!locations.has(key)) locations.set(key, []);
    locations.get(key).push(project);
  }
  const positions = [];
  for (const group of locations.values()) {
    group.sort((a,b)=>(a.SourcePermitNumbers || '').localeCompare(b.SourcePermitNumbers || ''));
    group.forEach((project,index)=>{
      const angle=2*Math.PI*index/group.length;
      const radius=group.length>1?Math.max(14,Math.min(45,group.length*3)):0;
      positions.push({project, dx:Math.cos(angle)*radius, dy:Math.sin(angle)*radius});
    });
  }
  return positions;
}
// Screen-space clearance includes the 44px stop hit target, not just the icon.
function crowdedStopIds(points, clearance=44){
  const hidden=new Set();
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
    if(Math.hypot(points[i].x-points[j].x,points[i].y-points[j].y)<clearance){
      hidden.add(points[i].id);hidden.add(points[j].id);
    }
  }
  return hidden;
}
// Match raster resolution to physical screen pixels instead of stretching tiles.
function basemapZoom(pixelsPerWorld, pixelRatio=1){
  const density=Math.max(1,Math.min(2,pixelRatio || 1));
  return Math.max(1,Math.min(19,Math.ceil(Math.log2(pixelsPerWorld*density/256))));
}
function zoningColor(name){return characterPalette[zoningCharacter(name)];}
// Fit projected route bounds into a usable pixel rectangle without SVG letterboxing.
function fittedRouteView(bounds, width, height, area, padding=24){
  const [left,top,right,bottom]=area;
  const unit=Math.max((bounds[2]-bounds[0])/Math.max(1,right-left-2*padding),
    (bounds[3]-bounds[1])/Math.max(1,bottom-top-2*padding),1e-6);
  return [(bounds[0]+bounds[2])/2-(left+right)/2*unit,
    (bounds[1]+bounds[3])/2-(top+bottom)/2*unit,width*unit,height*unit];
}
function routeZoomWidth(view, scale, factor, frame){
  // Retain the previous range, but allow at least twice a padded full-route fit,
  // including views whose aspect ratio predates a resize or route handoff.
  const maximum=Math.max(2400,frame[2]*2,frame[3]*2*view[2]/view[3],view[2]);
  return Math.min(maximum,Math.max(scale*120,view[2]*factor));
}
if (typeof module !== 'undefined') module.exports = {fittedRouteView, routeZoomWidth, basemapZoom, zoningShimmers, housingZoningMismatch, characterPalette, projectCharacter, zoningCharacter, crowdedStopIds, projectColor, groupProjectsByStop, projectPositions, zoningColor};
if (typeof window !== 'undefined') window.RouteMap = class {
  constructor(node, selectStop, selectProject) {
    this.node = node; this.selectStop = selectStop; this.selectProject = selectProject || (p=>this.highlightProject(p)); this.view = [0,0,800,850]; this.projects = [];
    this.ns = 'http://www.w3.org/2000/svg'; this.tileNodes = new Map();
    const manual=()=>{this.rideInterrupted=true;cancelAnimationFrame(this.rideFrame);this.rideFrame=null;cancelAnimationFrame(this.profilePanFrame);};
    node.addEventListener('pointerdown',manual);node.addEventListener('wheel',manual,{passive:true});node.addEventListener('touchstart',manual,{passive:true});
    node.addEventListener('click',e=>{if(!this.didPan&&!e.target.closest('.project-marker'))document.getElementById('project-floating-card')?.remove();},true);

    node.addEventListener('wheel', e => {e.preventDefault(); const p=this.mouse(e); this.zoom(e.deltaY>0?1.2:1/1.2,p.x,p.y);}, {passive:false});
    node.addEventListener('pointerdown', e => {
      if(e.pointerType==='touch')return;
      this.didPan=false;
      if(!this.pickingOrigin && e.target.closest('[role=button]') && !e.target.closest('.ownership-areas')) return;
      this.drag=this.mouse(e);this.dragOrigin=[e.clientX,e.clientY];
    });
    node.addEventListener('pointermove',e=>{
      if(!this.drag)return;
      if(!this.didPan && Math.hypot(e.clientX-this.dragOrigin[0],e.clientY-this.dragOrigin[1])<3)return;
      this.didPan=true;node.setPointerCapture(e.pointerId);const p=this.mouse(e); this.view[0]+=this.drag.x-p.x;this.view[1]+=this.drag.y-p.y;this.setView();this.drag=this.mouse(e);
    });
    for(const event of ['pointerup','pointercancel','lostpointercapture']) node.addEventListener(event,()=>this.drag=null);
    let touchPair=null,singleTouch=null;
    const pair=touches=>{
      const [a,b]=touches;
      return {clientX:(a.clientX+b.clientX)/2,clientY:(a.clientY+b.clientY)/2,
        distance:Math.max(1,Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY))};
    };
    node.addEventListener('touchstart',e=>{
      if(e.touches.length===1){this.didPan=false;singleTouch={clientX:e.touches[0].clientX,clientY:e.touches[0].clientY};}
      if(e.touches.length>=2){e.preventDefault();this.didPan=true;touchPair=pair(e.touches);}
    },{passive:false});
    node.addEventListener('touchmove',e=>{
      e.preventDefault();
      if(e.touches.length<2){
        const next=e.touches[0];
        if(singleTouch && next){const before=this.mouse(singleTouch),after=this.mouse(next);this.view[0]+=before.x-after.x;this.view[1]+=before.y-after.y;this.setView();}
        singleTouch=next?{clientX:next.clientX,clientY:next.clientY}:null;this.didPan=true;return;
      }
      singleTouch=null;
      const next=pair(e.touches);
      if(touchPair){
        const before=this.mouse(touchPair),after=this.mouse(next);
        this.view[0]+=before.x-after.x;this.view[1]+=before.y-after.y;
        this.zoom(touchPair.distance/next.distance,before.x,before.y);
      }
      this.didPan=true;touchPair=next;
    },{passive:false});
    for(const event of ['touchend','touchcancel'])node.addEventListener(event,e=>{
      if(e.touches.length<2)touchPair=null;
      singleTouch=e.touches.length===1?{clientX:e.touches[0].clientX,clientY:e.touches[0].clientY}:null;
    });
    for(const event of ['gesturestart','gesturechange','gestureend'])node.addEventListener(event,e=>e.preventDefault(),{passive:false});
    node.addEventListener('click',e=>{if(this.didPan){e.preventDefault();e.stopImmediatePropagation();}},true);
    const nearRoute=e=>{
      if(this.pickingOrigin||this.didPan||e.target.closest('[role=button]'))return false;
      const p=this.mouse(e),unit=1/(node.getScreenCTM()?.a||1);
      return (this.profileChoices||[]).some(profile=>profile.vertices.slice(1).some((v,i)=>{
        if(v.breakBefore)return false;
        const a=this.xy([profile.vertices[i].x,profile.vertices[i].y]),b=this.xy([v.x,v.y]);
        const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.y-a[1])*dy)/(dx*dx+dy*dy||1)));
        return Math.hypot(p.x-a[0]-t*dx,p.y-a[1]-t*dy)<=12*unit;
      }));
    };
    node.addEventListener('dblclick',e=>{if(nearRoute(e)){e.preventDefault();this.fit();}});
    let lastRouteTap=null;
    node.addEventListener('click',e=>{
      if(e.pointerType!=='touch'||!nearRoute(e)){lastRouteTap=null;return;}
      const now=Date.now();
      if(lastRouteTap&&now-lastRouteTap.time<400&&Math.hypot(e.clientX-lastRouteTap.x,e.clientY-lastRouteTap.y)<24){e.preventDefault();this.fit();lastRouteTap=null;}
      else lastRouteTap={time:now,x:e.clientX,y:e.clientY};
    });
    this.observer = new ResizeObserver(()=>{if(this.data)this.setView();});this.observer.observe(node);
  }
  el(tag,attrs={},parent=this.node){const n=document.createElementNS(this.ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);parent.append(n);return n;}
  xy(p){return [(p[0]-this.bounds[0])*this.scale+this.offsetX,(this.bounds[3]-p[1])*this.scale+this.offsetY];}
  inverse(x,y){return[(x-this.offsetX)/this.scale+this.bounds[0],this.bounds[3]-(y-this.offsetY)/this.scale];}
  path(g){
    const line=ps=>ps.map((p,i)=>`${i?'L':'M'}${this.xy(p).join(',')}`).join(' ');
    if(g.type==='LineString')return line(g.coordinates);
    if(g.type==='MultiLineString')return g.coordinates.map(line).join(' ');
    if(g.type==='Polygon')return g.coordinates.map(r=>line(r)+'Z').join(' ');
    if(g.type==='MultiPolygon')return g.coordinates.flatMap(p=>p.map(r=>line(r)+'Z')).join(' ');
    return '';
  }
  visibleBounds(){
    const rect=this.node.getBoundingClientRect(), inverse=this.node.getScreenCTM().inverse();
    const a=new DOMPoint(rect.left,rect.top).matrixTransform(inverse), b=new DOMPoint(rect.right,rect.bottom).matrixTransform(inverse);
    return [a.x,a.y,b.x-a.x,b.y-a.y];
  }
  mouse(e){return new DOMPoint(e.clientX,e.clientY).matrixTransform(this.node.getScreenCTM().inverse());}
  load(data){
    document.getElementById('map-project-info').replaceChildren();document.getElementById('map-tile-status').textContent='';
    this.data=data;this.bounds=data.bounds;this.scale=Math.min(760/(this.bounds[2]-this.bounds[0]),810/(this.bounds[3]-this.bounds[1]));
    this.offsetX=(800-(this.bounds[2]-this.bounds[0])*this.scale)/2;this.offsetY=(850-(this.bounds[3]-this.bounds[1])*this.scale)/2;
    // Keep the geographic layer mounted; only route-specific overlays change.
    for(const child of [...this.node.children])if(child!==this.tileLayer)child.remove();
    if(!this.tileLayer)this.tileLayer=this.el('g',{'class':'geographic-tiles'});
    for(const [key,image] of this.tileNodes){
      const [z,x,y]=key.split('/').map(Number),world=40075016.68557849,tile=world/2**z;
      const [px,py]=this.xy([x*tile-world/2,world/2-y*tile]);
      for(const [name,value] of Object.entries({x:px,y:py,width:tile*this.scale+.01,height:tile*this.scale+.01}))image.setAttribute(name,value);
    }
    this.streetLayer=this.el('path',{d:data.streets.map(g=>this.path(g)).join(' '),fill:'none',stroke:'#bac5ba','stroke-width':.6,'vector-effect':'non-scaling-stroke'});
    const defs=this.el('defs');
    const sheen=this.el('linearGradient',{id:'pedestrian-sheen',x1:'0%',y1:'0%',x2:'100%',y2:'100%'},defs);
    for(const [offset,color,opacity] of [['0%','#fff1a6',.06],['30%','#ffd37c',.24],['52%','#d6afff',.22],['74%','#fff5c9',.3],['100%','#ffc88c',.06]])this.el('stop',{offset,'stop-color':color,'stop-opacity':opacity},sheen);
    this.pedestrianTexture=this.el('pattern',{id:'pedestrian-texture',patternUnits:'userSpaceOnUse',width:64,height:64},defs);
    this.el('rect',{width:64,height:64,fill:'url(#pedestrian-sheen)'},this.pedestrianTexture);
    this.el('path',{d:'M18 10L19 15L24 16L19 17L18 22L17 17L12 16L17 15Z',fill:'#fff1b2',opacity:.65},this.pedestrianTexture);
    this.el('circle',{cx:47,cy:43,r:1,fill:'#fff8de',opacity:.8},this.pedestrianTexture);
    const unknownPattern=this.el('pattern',{id:'unmapped-zone',patternUnits:'userSpaceOnUse',width:10,height:10},defs);
    this.el('path',{d:'M0 10L10 0',stroke:'#87939b','stroke-width':1,opacity:.45},unknownPattern);
    this.zoningLayer=this.el('g',{class:'zoning-layer'});
    for(const feature of data.zoning?.features || []){
      const name=feature.properties.DETAIL_DESC || 'Unknown';
      const shape=this.el('path',{d:this.path(feature.geometry),fill:zoningColor(name),'fill-opacity':previousPalette?.3:.48,stroke:'#777','stroke-width':.4,'vector-effect':'non-scaling-stroke'},this.zoningLayer);this.el('title',{},shape).textContent=name;
      if(zoningCharacter(name)==='unknown')this.el('path',{d:this.path(feature.geometry),fill:'url(#unmapped-zone)','pointer-events':'none'},this.zoningLayer);
      if(zoningShimmers(name)){
        shape.classList.add('pedestrian-zone');shape.setAttribute('stroke','#d7b260');shape.setAttribute('stroke-width','1');
        this.el('path',{d:this.path(feature.geometry),fill:'url(#pedestrian-texture)','pointer-events':'none'},this.zoningLayer);
      }
    }
    this.catchmentLayer=this.el('g',{class:'ownership-areas'});
    this.spotlight=this.el('path',{class:'catchment-spotlight',fill:'#162b24','fill-opacity':.28,'fill-rule':'evenodd','pointer-events':'none'});
    this.selectionLayer=this.el('g',{'pointer-events':'none'});
    this.projectLayer=this.el('g');
    // Full network coverage remains visible independently of the scrub spine.
    this.el('path',{class:'route-coverage',d:data.route.map(g=>this.path(g)).join(' '),fill:'none',stroke:'#647f74','stroke-width':3,'vector-effect':'non-scaling-stroke','stroke-linejoin':'round','pointer-events':'none'});

    for(const continuation of data.continuations || []){
      const group=this.el('g',{'pointer-events':'none'});
      this.el('path',{d:continuation.geometry.map(g=>this.path(g)).join(' '),fill:'none',stroke:'#7161a0','stroke-width':4,'stroke-dasharray':'8 5','vector-effect':'non-scaling-stroke'},group);
      const [x,y]=this.xy(continuation.labelPoint);
      this.el('text',{x,y,'font-size':12,fill:'#59497e',stroke:'white','stroke-width':3,'paint-order':'stroke'},group).textContent=continuation.label;
    }
    this.profileRouteLayer=this.el('g',{'pointer-events':'none'});
    this.stopLayer=this.el('g');this.originLayer=this.el('g',{'pointer-events':'none'});this.profileLayer=this.el('g',{'pointer-events':'none'});this.profilePin=null;this.fit();this.contextRoutes?.attach();
  }
  setView(){
    this.node.setAttribute('viewBox',this.view.join(' '));
    if(!this.data)return;
    this.drawPoints();this.contextRoutes?.schedule();
    // Update during motion; a trailing debounce starves tiles while scrubbing.
    if(!this.tileFrame)this.tileFrame=requestAnimationFrame(()=>{this.tileFrame=null;this.drawTiles();});
  }
  routeFrameArea(){
    const rect=this.node.getBoundingClientRect(),viewport=window.visualViewport;
    let left=Math.max(rect.left,viewport?.offsetLeft||0),top=Math.max(rect.top,viewport?.offsetTop||0);
    let right=Math.min(rect.right,(viewport?.offsetLeft||0)+(viewport?.width||innerWidth));
    let bottom=Math.min(rect.bottom,(viewport?.offsetTop||0)+(viewport?.height||innerHeight));
    // Offscreen initial layout: use the map's own box until it is visible.
    if(right-left<80||bottom-top<80){left=rect.left;right=rect.right;top=rect.top;bottom=rect.bottom;}
    for(const selector of ['.map-framing','.zoom','.map-hint','.route-tools','.mobile-nav',
      '#frontage-lens','.map-zoning-toggle','#map-attribution','#mobile-detail-panel','#mobile-sheet',
      '#project-floating-card','#explore-guide']){
      const node=document.querySelector(selector);if(!node||node.hidden||!node.getClientRects().length)continue;
      const r=node.getBoundingClientRect();
      if(r.right<=left||r.left>=right||r.bottom<=top||r.top>=bottom)continue;
      const above=Math.max(0,r.top-top),below=Math.max(0,bottom-r.bottom);
      // Keep the larger unobscured vertical portion of the map.
      if(Math.max(above,below)<80)continue;
      if(above>=below)bottom=r.top-12;else top=r.bottom+12;
    }
    return [left-rect.left,top-rect.top,right-rect.left,bottom-rect.top];
  }
  routeFrameView(){
    const rect=this.node.getBoundingClientRect();
    if(!this.data||!rect.width||!rect.height)return [0,0,800,850];
    const bounds=[Infinity,Infinity,-Infinity,-Infinity];
    for(const geometry of this.data.route){
      const paths=geometry.type==='LineString'?[geometry.coordinates]:geometry.type==='MultiLineString'?geometry.coordinates:[];
      for(const path of paths)for(const point of path){
        const [x,y]=this.xy(point);bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);
      }
    }
    if(!bounds.every(Number.isFinite))return [0,0,800,850];
    return fittedRouteView(bounds,rect.width,rect.height,this.routeFrameArea());
  }
  fit(){
    this.rideInterrupted=true;cancelAnimationFrame(this.rideFrame);this.rideFrame=null;
    cancelAnimationFrame(this.profilePanFrame);this.profilePanFrame=null;
    this.view=this.routeFrameView();this.setView();
  }
  zoom(factor,x=this.view[0]+this.view[2]/2,y=this.view[1]+this.view[3]/2){
    this.rideInterrupted=true;cancelAnimationFrame(this.rideFrame);this.rideFrame=null;cancelAnimationFrame(this.profilePanFrame);
    const width=routeZoomWidth(this.view,this.scale,factor,this.routeFrameView());factor=width/this.view[2];
    this.view=[x-(x-this.view[0])*factor,y-(y-this.view[1])*factor,width,this.view[3]*factor];this.setView();
  }
  setProfilePath(profile){
    if(!this.profileRouteLayer)return;
    this.profileRouteLayer.replaceChildren();
    this.activeProfileId=profile?.id;
    if(!profile)return;
    const points=profile.vertices.map(p=>this.xy([p.x,p.y]));
    this.el('path',{d:points.map(([x,y],i)=>`${i&&!profile.vertices[i].breakBefore?'L':'M'}${x},${y}`).join(' '),fill:'none',stroke:'#e7f0ed','stroke-width':7,'vector-effect':'non-scaling-stroke'},this.profileRouteLayer);
    this.el('path',{d:points.map(([x,y],i)=>`${i&&!profile.vertices[i].breakBefore?'L':'M'}${x},${y}`).join(' '),fill:'none',stroke:'#204e3a','stroke-width':4,'vector-effect':'non-scaling-stroke'},this.profileRouteLayer);
    this.profileProgress=this.el('path',{class:'route-progress',fill:'none',stroke:'#078362','stroke-width':5,'vector-effect':'non-scaling-stroke'},this.profileRouteLayer);
  }
  setProfileProgress(profile,distance){
    if(!this.profileProgress)return;
    const points=[];
    for(let i=0;i<profile.vertices.length;i++){
      const v=profile.vertices[i];
      if(v.distanceFeet<=distance){points.push({...v});continue;}
      const a=profile.vertices[i-1];
      if(a&&!v.breakBefore){const t=(distance-a.distanceFeet)/(v.distanceFeet-a.distanceFeet||1);points.push({x:a.x+t*(v.x-a.x),y:a.y+t*(v.y-a.y)});}
      break;
    }
    this.profileProgress.setAttribute('d',points.map((p,i)=>`${i&&!p.breakBefore?'L':'M'}${this.xy([p.x,p.y]).join(',')}`).join(' '));
  }
  profileFocusBounds(){
    const rect=this.node.getBoundingClientRect();
    let top=rect.top,bottom=rect.bottom;
    if(window.matchMedia('(max-width:650px)').matches){
      top=Math.max(top,120);
      const strip=document.getElementById('frontage-lens');
      if(strip && strip.getBoundingClientRect().height)bottom=Math.min(bottom,strip.getBoundingClientRect().top-12);
      for(const id of ['mobile-detail-panel','mobile-sheet','project-floating-card']){
        const card=document.getElementById(id);if(!card||card.hidden||!card.getClientRects().length)continue;
        const r=card.getBoundingClientRect();
        if(r.top>top && r.top<bottom){if(r.top-top>=bottom-r.bottom)bottom=r.top-12;else top=r.bottom+12;}
        else if(r.top<=top && r.bottom>top)top=r.bottom+12;
      }
    }
    if(bottom-top<80){top=rect.top+rect.height*.25;bottom=rect.bottom-rect.height*.25;}
    const inverse=this.node.getScreenCTM().inverse();
    const a=new DOMPoint(rect.left+rect.width*.2,top+(bottom-top)*.2).matrixTransform(inverse);
    const b=new DOMPoint(rect.right-rect.width*.2,bottom-(bottom-top)*.2).matrixTransform(inverse);
    return [a.x,a.y,b.x,b.y];
  }
  beginRide(point){
    this.rideInterrupted=false;
    document.getElementById('project-floating-card')?.remove();
    const width=1400*this.scale;
    if(this.view[2]<=width)return;
    const start=[...this.view],ratio=start[3]/start[2],began=performance.now();
    const duration=window.matchMedia('(prefers-reduced-motion:reduce)').matches?0:420;
    cancelAnimationFrame(this.rideFrame);
    const frame=now=>{
      if(this.rideInterrupted)return;
      const t=duration?Math.min(1,(now-began)/duration):1,e=1-(1-t)**3;
      const target=this.profilePin||point,[x,y]=this.xy([target.x,target.y]);
      const w=start[2]+(width-start[2])*e,h=w*ratio;
      this.view=[start[0]+(x-width/2-start[0])*e,start[1]+(y-width*ratio/2-start[1])*e,w,h];this.setView();
      this.rideFrame=t<1?requestAnimationFrame(frame):null;
    };
    this.rideFrame=requestAnimationFrame(frame);
  }
  centerProfilePin(){
    if(!this.profilePin||this.rideInterrupted)return;
    const [x,y]=this.xy([this.profilePin.x,this.profilePin.y]),[left,top,right,bottom]=this.profileFocusBounds();
    const start=[...this.view],dx=x-(left+right)/2,dy=y-(top+bottom)/2;
    const duration=window.matchMedia('(prefers-reduced-motion:reduce)').matches?0:240;
    const began=performance.now();
    cancelAnimationFrame(this.profilePanFrame);
    const frame=now=>{const t=duration?Math.min(1,(now-began)/duration):1,e=1-(1-t)**3;
      this.view=[start[0]+dx*e,start[1]+dy*e,start[2],start[3]];this.setView();
      if(t<1)this.profilePanFrame=requestAnimationFrame(frame);
    };this.profilePanFrame=requestAnimationFrame(frame);
  }
  setProfilePin(point,follow=false){
    cancelAnimationFrame(this.profilePanFrame);
    this.profilePin=point;
    if(point&&follow&&!this.rideFrame&&!this.rideInterrupted){
      const[x,y]=this.xy([point.x,point.y]),[left,top,right,bottom]=this.profileFocusBounds();
      this.view[0]+=x<left?x-left:x>right?x-right:0;
      this.view[1]+=y<top?y-top:y>bottom?y-bottom:0;
    }
    if(this.data)this.setView();
  }
  setOrigin(origin,center=true){
    this.origin=origin;
    document.dispatchEvent(new Event("route-origin-change"));
    if(origin&&center){const[x,y]=this.xy([origin.x,origin.y]);this.view=[x-this.view[2]/2,y-this.view[3]/2,this.view[2],this.view[3]];}
    this.setView();
  }
  panToStopIfZoomed(id){
    if(this.view[2]>=800)return;
    const stop=this.data.stops.find(s=>s.id===id);if(!stop)return;
    const[x,y]=this.xy([stop.x,stop.y]);
    this.view=[x-this.view[2]/2,y-this.view[3]/2,this.view[2],this.view[3]];this.setView();
  }
  focusStop(id){
    const stop=this.data.stops.find(s=>s.id===id);if(!stop)return;
    const bounds=this.data.catchmentBounds?.[id] || [stop.x-800,stop.y-800,stop.x+800,stop.y+800];
    const[x,y]=this.xy([(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2]);
    const width=Math.max(600,bounds[2]-bounds[0],(bounds[3]-bounds[1])*800/850)*1.25*this.scale;
    this.view=[x-width/2,y-width*850/800/2,width,width*850/800];this.setView();
  }
  update(projects,selected,options){
    document.getElementById('map-project-info').replaceChildren();
    this.projects=projects;this.selected=selected;this.options=options;
    this.byStop=groupProjectsByStop(projects,options.direction);this.setView();
    const picked=projects.find(p=>p.SourcePermitNumbers===options.selectedProject);if(picked)this.inspectProject(picked);
  }
  drawTiles(){
    const enabled=this.options?.geography;
    this.tileLayer.classList.toggle('subdued',this.options?.basemapStyle==='quiet');
    this.tileLayer.style.display=enabled?'':'none';this.streetLayer.style.opacity=enabled?'.15':'1';
    document.getElementById('map-attribution').hidden=!enabled;
    if(!enabled)return;
    const unit=1/(this.node.getScreenCTM()?.a||1), world=40075016.68557849;
    const z=basemapZoom(world*this.scale/unit,window.devicePixelRatio);const tile=world/2**z;
    const [vx,vy,vw,vh]=this.visibleBounds();
    const [left,top]=this.inverse(vx,vy);const [right,bottom]=this.inverse(vx+vw,vy+vh);
    const needed=new Set();
    for(let x=Math.max(0,Math.floor((left+world/2)/tile));x<=Math.min(2**z-1,Math.floor((right+world/2)/tile));x++){
      for(let y=Math.max(0,Math.floor((world/2-top)/tile));y<=Math.min(2**z-1,Math.floor((world/2-bottom)/tile));y++){
        const key=`${z}/${x}/${y}`;needed.add(key);
        if(!this.tileNodes.has(key)){
          const[px,py]=this.xy([x*tile-world/2,world/2-y*tile]);
          const image=this.el('image',{x:px,y:py,width:tile*this.scale+.01,height:tile*this.scale+.01,href:`https://tile.openstreetmap.org/${key}.png`},this.tileLayer);
          image.addEventListener('error',()=>document.getElementById('map-tile-status').textContent='Geographic tiles unavailable. Cached Seattle streets remain available.');
          image.addEventListener('load',()=>document.getElementById('map-tile-status').textContent='');this.tileNodes.set(key,image);
        }
        const image=this.tileNodes.get(key),[px,py]=this.xy([x*tile-world/2,world/2-y*tile]);
        // Route-local projection changes, while image identity and href stay stable.
        for(const [name,value] of Object.entries({x:px,y:py,width:tile*this.scale+.01,height:tile*this.scale+.01}))image.setAttribute(name,value);
        image.style.display='';
        this.tileNodes.delete(key);this.tileNodes.set(key,image);
      }
    }
    // Keep same-resolution tiles paintable outside the viewport. The SVG clips
    // them naturally, so returning does not wait for visibility restoration.
    for(const[key,node]of this.tileNodes)node.style.display=key.startsWith(`${z}/`)?'':'none';
    // Retain recent offscreen images without unbounded decoded-image memory use.
    for(const[key,node]of this.tileNodes){
      if(this.tileNodes.size<=256)break;
      if(!needed.has(key)){node.remove();this.tileNodes.delete(key);}
    }
  }
  button(node,label,action){node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',label);node.style.cursor='pointer';node.addEventListener('click',()=>{action();});node.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();action();}});}
  highlightProject(project, focus=false){
    this.options.selectedProject=project.SourcePermitNumbers;
    if(focus){
      const [x,y]=this.xy([project.x,project.y]);
      const width=Math.min(this.view[2],1200*this.scale);
      this.view=[x-width/2,y-width*850/800/2,width,width*850/800];
    }
    this.setView();this.inspectProject(project);
  }
  placeInfoCard(card,point){
    if(!window.matchMedia('(max-width:650px)').matches)return;
    const [x,y]=this.xy([point.x,point.y]);
    const screen=new DOMPoint(x,y).matrixTransform(this.node.getScreenCTM());
    card.dataset.edge=screen.y>innerHeight/2?'top':'bottom';
    requestAnimationFrame(()=>{
      if(!card.isConnected||card.hidden)return;
      const rect=card.getBoundingClientRect(),p=new DOMPoint(x,y).matrixTransform(this.node.getScreenCTM());
      const top=120,bottom=innerHeight-140;
      const safeTop=card.dataset.edge==='top'?rect.bottom+28:top;
      const safeBottom=card.dataset.edge==='bottom'?rect.top-28:bottom;
      if(p.y<safeTop||p.y>safeBottom){
        const target=(safeTop+safeBottom)/2,unit=1/(this.node.getScreenCTM()?.a||1);
        this.view[1]+=(p.y-target)*unit;this.setView();
      }
    });
  }
  openProjectCard(project,expanded=false,preserveView=false){
    document.getElementById('project-floating-card')?.remove();
    const card=document.createElement('section');card.id='project-floating-card';card.setAttribute('aria-label','Development details');
    card.dataset.projectKey=project.SourcePermitNumbers;
    const title=document.createElement('strong');
    const year=/^(\d{4})-/.exec(project.CompletedDate||'')?.[1];
    title.textContent=(project.OriginalAddress1||'Development')+(year?` (${year} · permit completed)`:'');card.append(title);
    const families={residential:'Neighborhood residential',multifamily:'Multifamily',mixed:'Other mixed use',commercial:'Commercial',institutional:'Institutional',industrial:'Industrial',unknown:'Unclassified'};
    const family=projectCharacter(project),category=document.createElement('p');
    const swatch=document.createElement('i');swatch.className='legend-swatch';swatch.style.background=permitPalette[family];swatch.setAttribute('aria-hidden','true');
    const work=project.PermitTypeDesc==='New'?'New construction':project.PermitTypeDesc||'Work type unknown';
    category.append(swatch,document.createTextNode(`${work} · ${families[family]||'Unclassified'}`));card.append(category);
    const facts=document.createElement('p'),parts=[];
    if(Number(project.HousingUnitsAdded)>0)parts.push(`🏠 +${project.HousingUnitsAdded}`);
    if(Number(project.HousingUnitsRemoved)>0)parts.push(`−${project.HousingUnitsRemoved} homes`);
    const cost=project.EstProjectCostNumeric;
    if(cost!=null&&Number.isFinite(Number(cost)))parts.push(new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(cost));
    facts.textContent=parts.join(' · ');
    facts.setAttribute('aria-label',`Housing units added: ${project.HousingUnitsAdded??'unavailable'}; removed: ${project.HousingUnitsRemoved??'unavailable'}; estimated construction value: ${cost??'unavailable'} dollars`);
    card.append(facts);
    const details=document.createElement('details');details.open=expanded;
    const summary=document.createElement('summary');summary.textContent='More';details.append(summary);
    for(const text of [project.Description,project.StatusCurrent,`Source permits: ${project.SourcePermitNumbers||'Unavailable'}`]){if(text){const p=document.createElement('p');p.textContent=text;details.append(p);}}
    card.append(details);
    document.body.append(card);if(!preserveView)this.placeInfoCard(card,project);
    document.dispatchEvent(new Event('project-card-open'));
  }
  inspectProject(project){
    const panel=document.getElementById('map-project-info');panel.replaceChildren();
    const completionYear=/^(\d{4})-/.exec(project.CompletedDate || '')?.[1];
    const completion=completionYear ? ` · Permit completed: ${completionYear}` : /completed|approved to occupy/i.test(project.StatusCurrent || '') ? ' · Completion year unavailable' : '';
    const text=document.createElement('p');text.textContent=`${project.OriginalAddress1} · ${project.StatusCurrent}${completion} · ${project.HousingUnitsAdded == null?'Unknown':project.HousingUnitsAdded} added units · ${project.PermitTypeDesc} · Source permits: ${project.SourcePermitNumbers}`;panel.append(text);
    const names={residential:'Neighborhood residential',multifamily:'Multifamily',mixed:'Other mixed use',downtownMixed:'Downtown Mixed',commercial:'Commercial',nc1:'Neighborhood Commercial 1',nc2:'Neighborhood Commercial 2',nc3:'Neighborhood Commercial 3',nc1p:'NC1 · Pedestrian',nc2p:'NC2 · Pedestrian',nc3p:'NC3 · Pedestrian',institutional:'Institutional',industrial:'Industrial',open:'Open space',unknown:'Unmapped / unclassified'};
    const use=projectCharacter(project),zone=zoningCharacter(project.CurrentZoning || 'Unknown');
    const context=document.createElement('p');context.className='project-zoning-context';
    context.textContent=`Pin: ${names[use]} · Current zoning: ${project.CurrentZoning || 'Unknown / unmapped'} · Wheel category: ${names[zone]}.`;
    panel.append(context);
  }
  drawPoints(){
    if(!this.projectLayer)return;
    const unit=1/(this.node.getScreenCTM()?.a||1);
    this.pedestrianTexture?.setAttribute('patternTransform',`scale(${unit})`);
    this.profileLayer.replaceChildren();
    if(this.profilePin){
      const[x,y]=this.xy([this.profilePin.x,this.profilePin.y]);
      this.el('circle',{class:'profile-pin',cx:x,cy:y,r:9*unit,fill:'#c13a68',stroke:'white','stroke-width':3,'vector-effect':'non-scaling-stroke'},this.profileLayer);
      this.el('circle',{cx:x,cy:y,r:2*unit,fill:'white'},this.profileLayer);
    }
    this.originLayer.replaceChildren();
    if(this.origin){
      const [x,y]=this.xy([this.origin.x,this.origin.y]);
      if(this.origin.accuracy)this.el('circle',{cx:x,cy:y,r:this.origin.accuracy/Math.cos(this.origin.lat*Math.PI/180)*this.scale,fill:'#167bd5','fill-opacity':.12,stroke:'#167bd5','stroke-width':1,'vector-effect':'non-scaling-stroke'},this.originLayer);
      this.el('circle',{cx:x,cy:y,r:7*unit,fill:'#167bd5',stroke:'white','stroke-width':2,'vector-effect':'non-scaling-stroke'},this.originLayer);
    }
    this.zoningLayer.style.display=this.options?.zoning?'':'none';
    this.selectionLayer.replaceChildren();this.projectLayer.replaceChildren();this.stopLayer.replaceChildren();
    const showAreas=this.options?.catchments!==false;
    this.catchmentLayer.style.display='none';
    const region=this.selected?(this.data.directionCatchments?.[this.options?.direction || 'all'] || this.data.catchments)[this.selected]:(this.data.directionCorridors?.[this.options?.direction || 'all'] || this.data.corridor);
    const [vx,vy,vw,vh]=this.visibleBounds();
    this.spotlight.setAttribute('d',`M${vx},${vy}h${vw}v${vh}h${-vw}Z ${region?this.path(region):''}`);
    this.spotlight.style.display=showAreas?'':'none';
    if(showAreas&&this.selected&&region)this.el('path',{d:this.path(region),fill:'none',stroke:'#c07d28','stroke-width':2,'vector-effect':'non-scaling-stroke'},this.selectionLayer);
    if(this.options?.projects!==false){
      const assigned=this.selected && !this.options?.allRoutePermits ? this.byStop?.get(this.selected)||[] : this.projects;
      // At overview scale, overlapping color describes the neighborhood fabric.
      // Reveal individual colocated permits progressively as the map zooms in.
      const detail=Math.max(0,Math.min(1,(6-unit/this.scale)/4));
      const positions=projectPositions(assigned).sort((a,b)=>Number(a.project.SourcePermitNumbers===this.options?.selectedProject)-Number(b.project.SourcePermitNumbers===this.options?.selectedProject));
      for(const position of positions){position.dx*=detail;position.dy*=detail;}
      // Count nearby screen-space points; sparse stop lenses keep full-size symbols.
      const cells=new Map();
      for(const position of positions){
        const [x,y]=this.xy([position.project.x,position.project.y]);
        position.cell=[Math.floor((x/unit+position.dx)/48),Math.floor((y/unit+position.dy)/48)];
        const key=position.cell.join(',');cells.set(key,(cells.get(key)||0)+1);
      }
      for(const position of positions){
        const {project,dx,dy}=position;
        const [cx,cy]=position.cell;
        let neighbors=0;
        for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)neighbors+=cells.get(`${cx+i},${cy+j}`)||0;
        const densityScale=Math.max(.75,Math.min(1,Math.sqrt(12/Math.max(1,neighbors))));
        const picked=project.SourcePermitNumbers===this.options?.selectedProject;
        const[x,y]=this.xy([project.x,project.y]);
        if(x<vx-60*unit||x>vx+vw+60*unit||y<vy-60*unit||y>vy+vh+60*unit)continue;
        if(dx||dy)this.el('line',{x1:x,y1:y,x2:x+dx*unit,y2:y+dy*unit,stroke:'#687d70','stroke-width':.7,'vector-effect':'non-scaling-stroke','pointer-events':'none'},this.projectLayer);
        const node=this.el('g',{class:'project-marker'+(project.SourcePermitNumbers===this.options?.selectedProject?' selected-project':''),transform:`translate(${x+dx*unit},${y+dy*unit}) scale(${unit})`,'data-stop-id':this.selected,'data-project-key':project.SourcePermitNumbers},this.projectLayer);
        const measure=this.options?.size==='value'?(project.EstProjectCostNumeric||0)/1e6:project.HousingUnitsAdded||0;
        const radius=Math.min(10,4.5+Math.log2(1+Math.max(0,measure))*.65)*(picked?1:densityScale);
        this.el('circle',{r:radius,fill:projectColor(project),'fill-opacity':picked?.95:/^expired$/i.test((project.StatusCurrent || '').trim())?.25:.58+.27*detail,stroke:detail>0?'white':'none','stroke-width':.6*detail},node);
        if(picked){
          this.el('circle',{r:radius+4,fill:'none',stroke:'white','stroke-width':5,'pointer-events':'none'},node);
          this.el('circle',{r:radius+4,fill:'none',stroke:'#d27600','stroke-width':2.5,'pointer-events':'none'},node);
        }
        const label=`${project.OriginalAddress1}: ${project.StatusCurrent}`;this.el('title',{},node).textContent=label;
        this.button(node,label,()=>{
          const card=document.getElementById('project-floating-card');
          if(card?.dataset.projectKey===project.SourcePermitNumbers){card.remove();this.selectProject(null);return;}
          this.selectProject(project);this.openProjectCard(project);
        });
      }
    }

    const directionStops = this.data.directions?.find(d=>d.id===this.options?.direction)?.stopOrder;
    const visibleStops=this.data.stops.filter(stop=>!directionStops || directionStops.includes(stop.id));
    const crowded=crowdedStopIds(visibleStops.map(stop=>{
      const [x,y]=this.xy([stop.x,stop.y]);return {id:stop.id,x:x/unit,y:y/unit};
    }),20);
    for(const stop of this.data.stops){
      if(directionStops && !directionStops.includes(stop.id))continue;
      const[x,y]=this.xy([stop.x,stop.y]), selected=this.selected===stop.id;
      const node=this.el('g',{class:'stop-marker',transform:`translate(${x},${y}) scale(${unit})`,'aria-pressed':String(selected),'data-stop-id':stop.id,opacity:!this.selected||selected?1:.75},this.stopLayer);
      // Keep a selected stop as the one explicit anchor even at overview scale.
      const hidden=crowded.has(stop.id) && !selected;
      if(hidden){node.style.display='none';node.setAttribute('aria-hidden','true');}
      this.el('circle',{class:'stop-hit-target',r:22,fill:'transparent','pointer-events':'all'},node);
      if(this.options?.topStops?.includes(stop.id))this.el('circle',{class:'top-stop',r:10,fill:'none',stroke:'#b87800','stroke-width':3},node);
      this.el('rect',{class:'stop-symbol',x:selected?-7:-5,y:selected?-7:-5,width:selected?14:10,height:selected?14:10,rx:3,fill:'#173f57',stroke:'white','stroke-width':2},node);
      this.el('title',{},node).textContent=stop.fullName || stop.name;
      this.button(node,`Select ${stop.name}`,()=>{
        const now=Date.now();
        const double=this.lastStopTap?.id===stop.id && now-this.lastStopTap.time<400;
        this.lastStopTap=double?null:{id:stop.id,time:now};
        this.selectStop(stop.id,double);
        if(double)this.focusStop(stop.id);
      });
      node.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();this.selectStop(stop.id,true);this.focusStop(stop.id);});
      if(hidden)node.setAttribute('tabindex','-1');
    }
    const status=document.getElementById('map-selection-note');
    if(status)status.textContent=this.options?.projects===false?'Project points hidden. Turn on Projects to show them.':this.selected&&!this.options?.allRoutePermits?`Showing only ${(this.byStop?.get(this.selected)||[]).length} projects assigned to this stop. Enable All route permits to restore the overview. Colocated records fan out with location lines.`:`Showing ${this.projects.length} corridor projects in the selected filters. Select a stop to narrow the view.`;
    if(status && showAreas) status.textContent += ' Shaded areas explain project assignment, not walking reach. Splits reflect different boarding directions and downstream preferences.';
  }
};
