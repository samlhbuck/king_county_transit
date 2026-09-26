/* Stop-owned polygons and stable project detail over a geographic SVG map. */
function projectColor(project) {
  if (project.HousingUnitsAdded == null) return '#b9c0c6';
  const units = Number(project.HousingUnitsAdded) || 0;
  return units > 100 ? '#792da0' : units > 20 ? '#1978a5' : units > 0 ? '#319653' :
    project.PermitTypeDesc === 'New' ? '#ba8139' : '#707b85';
}
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
function zoningColor(name) {
  let hash=0;for(const c of name)hash=(hash*31+c.charCodeAt(0))|0;
  return `hsl(${Math.abs(hash)%360} 45% 65%)`;
}
if (typeof module !== 'undefined') module.exports = {projectColor, groupProjectsByStop, projectPositions, zoningColor};
if (typeof window !== 'undefined') window.RouteMap = class {
  constructor(node, selectStop, selectProject) {
    this.node = node; this.selectStop = selectStop; this.selectProject = selectProject || (p=>this.highlightProject(p)); this.view = [0,0,800,850]; this.projects = [];
    this.ns = 'http://www.w3.org/2000/svg'; this.tileNodes = new Map();
    node.addEventListener('wheel', e => {e.preventDefault(); const p=this.mouse(e); this.zoom(e.deltaY>0?1.2:1/1.2,p.x,p.y);}, {passive:false});
    node.addEventListener('pointerdown', e => {
      this.didPan=false;
      if(e.target.closest('[role=button]') && !e.target.closest('.ownership-areas')) return;
      this.drag=this.mouse(e);this.dragOrigin=[e.clientX,e.clientY];
    });
    node.addEventListener('pointermove',e=>{
      if(!this.drag)return;
      if(!this.didPan && Math.hypot(e.clientX-this.dragOrigin[0],e.clientY-this.dragOrigin[1])<3)return;
      this.didPan=true;node.setPointerCapture(e.pointerId);const p=this.mouse(e); this.view[0]+=this.drag.x-p.x;this.view[1]+=this.drag.y-p.y;this.setView();this.drag=this.mouse(e);
    });
    for(const event of ['pointerup','pointercancel','lostpointercapture']) node.addEventListener(event,()=>this.drag=null);
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
    this.node.replaceChildren();this.tileNodes.clear();this.tileLayer=this.el('g',{'class':'geographic-tiles'});
    this.streetLayer=this.el('path',{d:data.streets.map(g=>this.path(g)).join(' '),fill:'none',stroke:'#bac5ba','stroke-width':.6,'vector-effect':'non-scaling-stroke'});
    this.zoningLayer=this.el('g',{class:'zoning-layer'});
    for(const feature of data.zoning?.features || []){
      const name=feature.properties.DETAIL_DESC || 'Unknown';
      const shape=this.el('path',{d:this.path(feature.geometry),fill:zoningColor(name),'fill-opacity':.3,stroke:'#777','stroke-width':.4,'vector-effect':'non-scaling-stroke'},this.zoningLayer);this.el('title',{},shape).textContent=name;
    }
    this.catchmentLayer=this.el('g',{class:'ownership-areas'});
    this.el('path',{d:data.route.map(g=>this.path(g)).join(' '),fill:'none',stroke:'#204e3a','stroke-width':3,'vector-effect':'non-scaling-stroke','stroke-linejoin':'round'});
    this.spotlight=this.el('path',{class:'catchment-spotlight',fill:'#162b24','fill-opacity':.28,'fill-rule':'evenodd','pointer-events':'none'});
    this.selectionLayer=this.el('g',{'pointer-events':'none'});
    this.projectLayer=this.el('g');this.stopLayer=this.el('g');this.fit();
  }
  setView(){
    this.node.setAttribute('viewBox',this.view.join(' '));
    if(!this.data)return;
    this.drawPoints();clearTimeout(this.timer);this.timer=setTimeout(()=>this.drawTiles(),120);
  }
  fit(){this.view=[0,0,800,850];this.setView();}
  zoom(factor,x=this.view[0]+this.view[2]/2,y=this.view[1]+this.view[3]/2){
    const width=Math.min(2400,Math.max(this.scale*120, this.view[2]*factor));factor=width/this.view[2];
    this.view=[x-(x-this.view[0])*factor,y-(y-this.view[1])*factor,width,this.view[3]*factor];this.setView();
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
    this.tileLayer.style.display=enabled?'':'none';this.streetLayer.style.opacity=enabled?'.15':'1';
    document.getElementById('map-attribution').hidden=!enabled;
    if(!enabled)return;
    const unit=1/(this.node.getScreenCTM()?.a||1), world=40075016.68557849;
    const z=Math.max(1,Math.min(19,Math.floor(Math.log2(world*this.scale/unit/256))));const tile=world/2**z;
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
      }
    }
    for(const[key,node]of this.tileNodes)if(!needed.has(key)){node.remove();this.tileNodes.delete(key);}
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
  inspectProject(project){
    const panel=document.getElementById('map-project-info');panel.replaceChildren();
    const text=document.createElement('p');text.textContent=`${project.OriginalAddress1} · ${project.StatusCurrent} · ${project.HousingUnitsAdded == null?'Unknown':project.HousingUnitsAdded} added units · ${project.PermitTypeDesc} · Source permits: ${project.SourcePermitNumbers}`;panel.append(text);
  }
  drawPoints(){
    if(!this.projectLayer)return;
    const unit=1/(this.node.getScreenCTM()?.a||1), span=this.view[2]/this.scale;
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
      const assigned=this.selected ? this.byStop?.get(this.selected)||[] : this.projects;
      // Membership and colocated offsets use source locations, not the viewport.
      for(const {project,dx,dy} of projectPositions(assigned)){
        const[x,y]=this.xy([project.x,project.y]);
        if(x<vx-60*unit||x>vx+vw+60*unit||y<vy-60*unit||y>vy+vh+60*unit)continue;
        if(dx||dy)this.el('line',{x1:x,y1:y,x2:x+dx*unit,y2:y+dy*unit,stroke:'#687d70','stroke-width':.7,'vector-effect':'non-scaling-stroke','pointer-events':'none'},this.projectLayer);
        const node=this.el('g',{class:'project-marker'+(project.SourcePermitNumbers===this.options?.selectedProject?' selected-project':''),transform:`translate(${x+dx*unit},${y+dy*unit}) scale(${unit})`,'data-stop-id':this.selected,'data-project-key':project.SourcePermitNumbers},this.projectLayer);
        const measure=this.options?.size==='value'?(project.EstProjectCostNumeric||0)/1e6:project.HousingUnitsAdded||0;
        this.el('circle',{r:Math.min(9,3+Math.log2(1+measure)*.65),fill:projectColor(project),stroke:'white','stroke-width':1.2},node);
        if(project.SourcePermitNumbers===this.options?.selectedProject)this.el('circle',{r:13,fill:'none',stroke:'#d27600','stroke-width':3,'pointer-events':'none'},node);
        const label=`${project.OriginalAddress1}: ${project.StatusCurrent}`;this.el('title',{},node).textContent=label;
        this.button(node,label,()=>this.selectProject(project));
      }
    }

    const directionStops = this.data.directions?.find(d=>d.id===this.options?.direction)?.stopOrder;
    for(const stop of this.data.stops){
      if(directionStops && !directionStops.includes(stop.id))continue;
      const[x,y]=this.xy([stop.x,stop.y]), selected=this.selected===stop.id;
      const node=this.el('g',{class:'stop-marker',transform:`translate(${x},${y}) scale(${unit})`,'aria-pressed':String(selected),'data-stop-id':stop.id,opacity:!this.selected||selected?1:.35},this.stopLayer);
      if(this.options?.topStops?.includes(stop.id))this.el('circle',{class:'top-stop',r:10,fill:'none',stroke:'#b87800','stroke-width':3},node);
      this.el('circle',{r:selected?6:3,fill:selected?'#204e3a':'white',stroke:'#204e3a','stroke-width':1.5},node);
      if(selected)this.el('text',{x:10,y:0,'dominant-baseline':'central','font-size':10,'font-weight':600,fill:'#204e3a',stroke:'white','stroke-width':3,'paint-order':'stroke'},node).textContent=stop.name;
      this.el('title',{},node).textContent=stop.fullName || stop.name;
      this.button(node,`Select ${stop.name}`,()=>this.selectStop(stop.id));
    }
    const status=document.getElementById('map-selection-note');
    if(status)status.textContent=this.options?.projects===false?'Project points hidden. Turn on Projects to show them.':this.selected?`Showing only ${(this.byStop?.get(this.selected)||[]).length} projects assigned to this stop. All stops restores the overview. Colocated records fan out with location lines.`:`Showing ${this.projects.length} corridor projects in the selected filters. Select a stop to narrow the view.`;
    if(status && showAreas) status.textContent += ' Shaded areas explain project assignment, not walking reach. Splits reflect different boarding directions and downstream preferences.';
  }
};
