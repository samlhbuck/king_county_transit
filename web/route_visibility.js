/* Screen-space coverage, independently evaluated for each continuous polyline. */
const routeVisibilityDefaults={gridSize:3,rectangleFraction:.7,minimumCells:3,minimumTraversal:.15,
  mode:'baseline',squareFraction:.88,squarePixels:120,minimumSpanFraction:.25};
function visibilityGrid(width,height,config={}){
  const c={...routeVisibilityDefaults,...config};
  if(!['baseline','square','calibrated'].includes(c.mode)||!Number.isInteger(c.gridSize)||c.gridSize<1||c.gridSize>10||!(c.rectangleFraction>0&&c.rectangleFraction<=1)||!Number.isInteger(c.minimumCells)||c.minimumCells<1||c.minimumCells>100||!(c.minimumTraversal>0&&c.minimumTraversal<=1)||!(c.squareFraction>0&&c.squareFraction<=1)||!(c.squarePixels>=48&&c.squarePixels<=320)||!(c.minimumSpanFraction>=0&&c.minimumSpanFraction<=1))throw Error('Invalid route visibility configuration');
  if(c.mode==='baseline'){
    if(c.minimumCells>c.gridSize**2)throw Error('Invalid cell count');
    const w=width*c.rectangleFraction/c.gridSize,h=height*c.rectangleFraction/c.gridSize;
    const x=(width-width*c.rectangleFraction)/2,y=(height-height*c.rectangleFraction)/2;
    return {...c,x,y,w,h,rows:c.gridSize,cols:c.gridSize,eligible:[x,y,x+w*c.gridSize,y+h*c.gridSize]};
  }
  const area=c.usableArea||[0,0,width,height],aw=area[2]-area[0],ah=area[3]-area[1];
  const ew=aw*c.squareFraction,eh=ah*c.squareFraction;
  const x=area[0]+(aw-ew)/2,y=area[1]+(ah-eh)/2;
  const size=c.mode==='calibrated'&&c.referenceSpan>0?Math.max(48,Math.min(320,c.referenceSpan/3)):c.squarePixels;
  const cols=Math.max(1,Math.ceil(ew/size)),rows=Math.max(1,Math.ceil(eh/size));
  // Full square cells tile beyond the eligible rectangle; edge contributions
  // are clipped to that rectangle, never stretched to fit a portrait screen.
  return {...c,x:x+(ew-cols*size)/2,y:y+(eh-rows*size)/2,w:size,h:size,cols,rows,eligible:[x,y,x+ew,y+eh]};
}
function clippedLength(a,b,x,y,w,h){
  const dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1;
  for(const [p,q] of [[-dx,a[0]-x],[dx,x+w-a[0]],[-dy,a[1]-y],[dy,y+h-a[1]]]){
    if(p===0){if(q<0)return null;continue;}
    const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
    if(lo>=hi)return null;
  }
  return {length:Math.hypot(dx,dy)*(hi-lo),mid:[a[0]+dx*(lo+hi)/2,a[1]+dy*(lo+hi)/2],a:[a[0]+dx*lo,a[1]+dy*lo],b:[a[0]+dx*hi,a[1]+dy*hi]};
}
function clippedPath(path,area){
  const segments=[],bounds=[Infinity,Infinity,-Infinity,-Infinity];
  for(let k=1;k<path.length;k++){
    if(![...path[k-1],...path[k]].every(Number.isFinite))continue;
    const hit=clippedLength(path[k-1],path[k],area[0],area[1],area[2]-area[0],area[3]-area[1]);
    if(!hit||!hit.length)continue;
    segments.push(hit);
    for(const p of [hit.a,hit.b]){bounds[0]=Math.min(bounds[0],p[0]);bounds[1]=Math.min(bounds[1],p[1]);bounds[2]=Math.max(bounds[2],p[0]);bounds[3]=Math.max(bounds[3],p[1]);}
  }
  return {segments,span:segments.length?Math.hypot(bounds[2]-bounds[0],bounds[3]-bounds[1]):0};
}
function routeVisibility(paths,width,height,config={}){
  const grid=visibilityGrid(width,height,config),{rows,cols}=grid,total=rows*cols;
  let best={count:0,cells:Array(total).fill(false),lengths:Array(total).fill(0),pathIndex:-1,span:0,spanFraction:0,passes:false,candidate:false};
  let candidate=false,maxSpan=0;
  paths.forEach((path,pathIndex)=>{
    const clipped=clippedPath(path,grid.eligible),lengths=Array(total).fill(0);
    candidate ||= !!clipped.segments.length;maxSpan=Math.max(maxSpan,clipped.span);
    for(const segment of clipped.segments){
      const a=segment.a,b=segment.b;
      // Only visit cells touched by the segment's bounds, bounding work on
      // larger adaptive grids without changing the clipping/edge ownership rule.
      const c0=Math.max(0,Math.min(cols-1,Math.floor((Math.min(a[0],b[0])-grid.x)/grid.w)));
      const c1=Math.max(0,Math.min(cols-1,Math.floor((Math.max(a[0],b[0])-grid.x)/grid.w)));
      const r0=Math.max(0,Math.min(rows-1,Math.floor((Math.min(a[1],b[1])-grid.y)/grid.h)));
      const r1=Math.max(0,Math.min(rows-1,Math.floor((Math.max(a[1],b[1])-grid.y)/grid.h)));
      for(let row=r0;row<=r1;row++)for(let col=c0;col<=c1;col++){
        const hit=clippedLength(a,b,grid.x+col*grid.w,grid.y+row*grid.h,grid.w,grid.h);
        if(!hit)continue;
        const ownerCol=Math.min(cols-1,Math.floor((hit.mid[0]-grid.x)/grid.w+1e-9));
        const ownerRow=Math.min(rows-1,Math.floor((hit.mid[1]-grid.y)/grid.h+1e-9));
        if(ownerCol===col&&ownerRow===row)lengths[row*cols+col]+=hit.length;
      }
    }
    const cells=lengths.map(v=>v>=grid.minimumTraversal*grid.w),count=cells.filter(Boolean).length;
    const spanFraction=clipped.span/Math.hypot(grid.eligible[2]-grid.eligible[0],grid.eligible[3]-grid.eligible[1]);
    const passes=count>=grid.minimumCells&&(grid.mode==='baseline'||spanFraction>=grid.minimumSpanFraction);
    if((grid.mode!=='baseline'&&passes&&!best.passes)||((grid.mode==='baseline'||passes===best.passes)&&count>best.count)||best.pathIndex<0)
      best={count,cells,lengths,pathIndex,span:clipped.span,spanFraction,passes};
  });
  return {...best,candidate,maxSpan,grid};
}
function analyzeContextRoutes(routes,width,height,config={},usableArea){
  let settings={...config,usableArea};
  const grid=visibilityGrid(width,height,settings);
  // Reference is measured from ALL intersecting candidates, before eligibility.
  // Extent diagonal estimates spatial span, never accumulated polyline length.
  const spans=routes.map(route=>Math.max(0,...route.paths.map(path=>clippedPath(path,grid.eligible).span)));
  const referenceSpan=Math.max(0,...spans);
  settings={...settings,referenceSpan};
  return {referenceSpan,results:new Map(routes.map(route=>[route.id,routeVisibility(route.paths,width,height,settings)])),grid:visibilityGrid(width,height,settings)};
}
// A visual comparison only: eligibility still comes from routeVisibility.
// Partial cell traversal makes emphasis continuous between qualifying-cell counts.
function coverageEmphasis(result){
  if(!result)return {opacity:.4,width:1.6};
  const threshold=result.grid.minimumTraversal*result.grid.w;
  const coverage=result.lengths.reduce((sum,length)=>sum+Math.min(1,Math.max(0,length)/threshold),0)/result.lengths.length;
  return {opacity:.4+.3*coverage,width:1.6+1.2*coverage};
}
function contextualHits(routes,point,project,tolerance=12){
  return routes.map(route=>{
    let best=null;
    for(const path of route.paths)for(let i=1;i<path.length;i++){
      const a=project(path[i-1]),b=project(path[i]),dx=b[0]-a[0],dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
      const gap=Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy);
      if(gap<=tolerance&&(!best||gap<best.gap))best={route,gap,origin:{x:path[i-1][0]+t*(path[i][0]-path[i-1][0]),y:path[i-1][1]+t*(path[i][1]-path[i-1][1])}};
    }
    return best;
  }).filter(Boolean).sort((a,b)=>a.gap-b.gap||a.route.id.localeCompare(b.route.id));
}
if(typeof module!=='undefined')module.exports={routeVisibility,visibilityGrid,clippedLength,contextualHits,coverageEmphasis,analyzeContextRoutes};
if(typeof window!=='undefined')window.ContextRoutes=class{
  constructor(map,actions={}){
    this.actions=actions;this.visibleIds=new Set();this.coverage=new Map();
    this.emphasis=new URLSearchParams(location.search).get('contextEmphasis')==='1';
    this.map=map;this.config={...routeVisibilityDefaults};
    const initialMode=new URLSearchParams(location.search).get('contextGrid');if(['square','calibrated'].includes(initialMode))this.config.mode=initialMode;
    this.filtered=true;this.debug=new URLSearchParams(location.search).get('routeGrid')==='1';this.routes=[];
    map.node.addEventListener('pointerdown',event=>{this.pointerType=event.pointerType;});
    map.node.addEventListener('click',event=>{
      if(map.didPan||map.pickingOrigin||event.target.closest('[role=button]'))return;
      const matrix=map.node.getScreenCTM();if(!matrix)return;
      const project=p=>{const [x,y]=map.xy(p);return [matrix.a*x+matrix.c*y+matrix.e,matrix.b*x+matrix.d*y+matrix.f];};
      const hits=contextualHits(this.routes.filter(r=>this.visibleIds.has(r.id)),[event.clientX,event.clientY],project,(event.pointerType||this.pointerType)==='touch'?18:12);
      this.dismiss();if(!hits.length)return;
      event.preventDefault();event.stopImmediatePropagation();this.preview(hits);
    },true);
    map.node.addEventListener('dblclick',event=>{if(this.card){event.preventDefault();event.stopImmediatePropagation();}},true);
    map.node.addEventListener('pointermove',()=>{if(map.didPan)this.dismiss();});
    document.addEventListener('route-loaded',()=>this.dismiss());
    document.addEventListener('route-stop-selected',()=>this.dismiss());
    document.addEventListener('project-card-open',()=>this.dismiss());
    document.getElementById('frontage-position').addEventListener('input',()=>this.dismiss());
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.card){this.dismiss();map.node.focus({preventScroll:true});}});
    const controls=document.createElement('details');controls.id='route-visibility-controls';
    const title=document.createElement('summary');title.textContent='Experimental route visibility';controls.append(title);
    const toggle=(text,value,change)=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=value;input.onchange=()=>{change(input.checked);this.schedule();};label.append(input,document.createTextNode(text));controls.append(label);return input;};
    toggle('Apply grid filter',true,v=>this.filtered=v);toggle('Show debug grid',this.debug,v=>this.debug=v);
    toggle('Compare coverage emphasis',this.emphasis,v=>this.emphasis=v).id='context-coverage-emphasis';
    const note=document.createElement('p');note.textContent='Emphasis measures visible geometry. Service frequency and transfer data are not used.';controls.append(note);
    const modeLabel=document.createElement('label');modeLabel.textContent='Grid comparison';
    const mode=document.createElement('select');mode.id='context-grid-mode';
    for(const [id,label] of [['baseline','A · Original rectangular grid'],['square','B · Expanded square cells'],['calibrated','C · Candidate-span calibrated cells']])mode.add(new Option(label,id));
    mode.value=this.config.mode;mode.onchange=()=>{this.config.mode=mode.value;if(mode.value==='baseline'){this.config.minimumCells=Math.min(this.config.minimumCells,this.config.gridSize**2);controls.querySelector('[data-config=minimumCells]').value=this.config.minimumCells;}this.schedule();};modeLabel.append(mode);controls.append(modeLabel);
    for(const [key,label] of [['gridSize','Baseline grid size'],['rectangleFraction','Baseline viewport fraction'],['squareFraction','Square usable-area fraction'],['squarePixels','Fixed square cell size (px)'],['minimumSpanFraction','Square minimum spatial span fraction'],['minimumCells','Required cells'],['minimumTraversal','Cell-width traversal fraction']]){
      const row=document.createElement('label'),input=document.createElement('input');row.textContent=label;input.type='number';input.dataset.config=key;input.step=key.includes('Fraction')||key==='minimumTraversal'?'.01':'1';input.value=this.config[key];
      input.onchange=()=>{const next={...this.config,[key]:Number(input.value)};try{visibilityGrid(100,100,next);this.config=next;input.setCustomValidity('');this.schedule();}catch{input.setCustomValidity('Invalid grid settings');input.reportValidity();}};row.append(input);controls.append(row);
    }
    this.metrics=document.createElement('pre');this.metrics.hidden=!this.debug;this.metrics.id='context-grid-metrics';controls.append(this.metrics);
    this.status=document.createElement('p');this.status.setAttribute('role','status');controls.append(this.status);document.getElementById('filter-dialog').append(controls);
    this.observer=new ResizeObserver(()=>this.schedule());this.observer.observe(map.node);
    fetch('/api/context-routes').then(r=>{if(!r.ok)throw Error('Geometry unavailable');return r.json();}).then(data=>{this.routes=data.routes.map(route=>({...route,bounds:route.paths.map(path=>{
      const bounds=[Infinity,Infinity,-Infinity,-Infinity];for(const [x,y]of path){bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);}return bounds;
    })}));this.attach();}).catch(()=>this.status.textContent='Contextual route geometry unavailable; selected route is unaffected.');
  }
  dismiss(){this.card?.remove();this.card=null;this.previewId=null;this.paint();}
  paint(){for(const [id,node] of this.nodes||[]){
    const style=this.emphasis?coverageEmphasis(this.coverage.get(id)):{opacity:.55,width:2};
    node.setAttribute('stroke',id===this.previewId?'#435c83':'#5c7189');
    node.setAttribute('stroke-width',id===this.previewId?4:style.width);
    node.style.opacity=this.visibleIds.has(id)?(id===this.previewId?'.85':style.opacity):'0';
  }}
  preview(hits){
    const card=document.createElement('section');card.id='context-route-preview';card.setAttribute('aria-label','Nearby route preview');
    const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Close route preview');close.onclick=()=>this.dismiss();card.append(close);
    const heading=document.createElement('strong');heading.textContent=hits.length>1?'Choose a route':'Route';card.append(heading);
    const choices=document.createElement('div'),detail=document.createElement('p'),explore=document.createElement('button');explore.textContent='Explore route';card.append(choices,detail,explore);
    const choose=hit=>{
      this.previewId=hit.route.id;this.paint();
      const info=this.actions.describe?.(hit.route.id)||{};
      detail.textContent=[info.name||hit.route.id,routeDescription(info)].filter(Boolean).join(' · ');
      for(const button of choices.children)button.setAttribute('aria-pressed',String(button.dataset.routeId===hit.route.id));
      explore.onclick=async()=>{explore.disabled=true;try{const ok=await this.actions.explore?.(hit.route.id,hit.origin);if(ok)this.dismiss();else detail.textContent='Unable to open route. Please retry.';}finally{explore.disabled=false;}};
    };
    for(const hit of hits){const button=document.createElement('button');button.dataset.routeId=hit.route.id;button.textContent=this.actions.describe?.(hit.route.id)?.name||hit.route.id;button.onclick=()=>choose(hit);choices.append(button);}
    document.body.append(card);this.card=card;choose(hits[0]);choices.firstElementChild.focus({preventScroll:true});
  }
  attach(){
    const m=this.map;if(!m.data)return;
    this.dismiss();this.layer?.remove();this.debugLayer?.remove();this.nodes=new Map();
    this.layer=m.el('g',{class:'context-routes','pointer-events':'none'});m.node.insertBefore(this.layer,m.catchmentLayer);
    this.debugLayer=m.el('g',{'pointer-events':'none',class:'route-debug-grid'});
    for(const route of this.routes){
      const node=m.el('path',{d:route.paths.map(p=>m.path({type:'LineString',coordinates:p})).join(' '),fill:'none',stroke:'#5c7189','stroke-width':2,'vector-effect':'non-scaling-stroke'},this.layer);
      node.style.opacity=0;node.setAttribute('role','button');node.setAttribute('aria-label',`Preview route ${this.actions.describe?.(route.id)?.name||route.id}`);node.setAttribute('tabindex','-1');
      node.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();this.dismiss();const rect=m.node.getBoundingClientRect(),ctm=m.node.getScreenCTM();if(!ctm)return;const project=p=>{const [x,y]=m.xy(p);return [ctm.a*x+ctm.c*y+ctm.e,ctm.b*x+ctm.d*y+ctm.f];};const hits=contextualHits([route],[rect.left+rect.width/2,rect.top+rect.height/2],project,Infinity);if(hits.length)this.preview(hits);}});
      this.nodes.set(route.id,node);
    }
    this.schedule();
  }
  schedule(){if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;this.update();},100);}
  update(){
    const m=this.map;if(!m.data||!this.layer?.isConnected)return;
    const rect=m.node.getBoundingClientRect(),ctm=m.node.getScreenCTM();if(!ctm||!rect.width||!rect.height)return;
    const screen=p=>{const [x,y]=m.xy(p);return [ctm.a*x+ctm.c*y+ctm.e-rect.left,ctm.b*x+ctm.d*y+ctm.f-rect.top];};
    const [vx,vy,vw,vh]=m.visibleBounds(),a=m.inverse(vx,vy),b=m.inverse(vx+vw,vy+vh);
    const projected=this.routes.map(route=>({...route,paths:route.paths.filter((_,i)=>{
      const box=route.bounds[i];return box[0]<=b[0]&&box[2]>=a[0]&&box[1]<=a[1]&&box[3]>=b[1];
    }).map(p=>p.map(screen))}));
    const analysis=analyzeContextRoutes(projected,rect.width,rect.height,this.config,m.routeFrameArea());
    this.analysis=analysis;let shown=0;this.visibleIds.clear();
    for(const route of projected){
      const coverage=analysis.results.get(route.id);this.coverage.set(route.id,coverage);
      const qualifies=this.config.mode==='baseline'&&!this.filtered?route.paths.length:coverage.candidate&&(!this.filtered||coverage.passes);
      const show=route.id!==m.data.routeId&&qualifies;
      this.nodes.get(route.id).setAttribute('tabindex',show?'0':'-1');if(show){shown++;this.visibleIds.add(route.id);}
    }
    if(this.previewId&&!this.visibleIds.has(this.previewId))this.dismiss();
    this.paint();
    this.debugLayer.replaceChildren();this.debugLayer.style.display=this.debug?'':'none';
    const selected=m.data.route.flatMap(g=>g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[]);
    const result=analysis.results.get(m.data.routeId)||routeVisibility(selected.map(p=>p.map(screen)),rect.width,rect.height,{...this.config,usableArea:m.routeFrameArea(),referenceSpan:analysis.referenceSpan}),g=result.grid;
    this.status.textContent=`${shown} contextual routes · selected route: ${result.count}/${g.rows*g.cols} cells · ${result.passes?'passes':'fails (selected route stays visible)'}. Cached geometry only.`;
    this.metrics.hidden=!this.debug;
    if(!this.debug)return;
    this.metrics.textContent=['Route · candidate · eligible · cells · chosen span px · span % · candidate max px',...projected.map(route=>{const r=analysis.results.get(route.id);return [this.actions.describe?.(route.id)?.name||route.id,r.candidate,r.passes,r.count,Math.round(r.span),Math.round(r.spanFraction*100)+'%',Math.round(r.maxSpan)].join(' · ');})].join('\n');
    const inv=ctm.inverse(),point=(x,y)=>new DOMPoint(x+rect.left,y+rect.top).matrixTransform(inv);
    for(let row=0;row<g.rows;row++)for(let col=0;col<g.cols;col++){
      const a=point(g.x+col*g.w,g.y+row*g.h),b=point(g.x+(col+1)*g.w,g.y+(row+1)*g.h);
      m.el('rect',{x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y,fill:result.cells[row*g.cols+col]?'#55ab78':'#ffffff','fill-opacity':.17,stroke:'#334d68','stroke-width':1,'vector-effect':'non-scaling-stroke'},this.debugLayer);
    }
    if(g.mode!=='baseline'){const a=point(g.eligible[0],g.eligible[1]),b=point(g.eligible[2],g.eligible[3]);m.el('rect',{class:'eligible-bounds',x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y,fill:'none',stroke:'#a35f1d','stroke-width':2,'vector-effect':'non-scaling-stroke'},this.debugLayer);}
    const p=point(g.x,g.y-8),label=m.el('text',{x:p.x,y:p.y,'font-size':12/ctm.a,fill:'#183630',stroke:'white','stroke-width':3/ctm.a,'paint-order':'stroke'},this.debugLayer);label.textContent=`${result.count} cells · ${result.passes?'PASS':'FAIL · selected retained'}`;
  }
};
