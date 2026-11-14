/* A common distance axis for adjacent zoning and a linked map preview. */
function profilePosition(profile,fraction){
  const distance=Math.max(0,Math.min(1,fraction))*profile.lengthFeet;
  const points=profile.vertices;
  let index=1;
  while(index<points.length-1 && points[index].distanceFeet<distance)index++;
  const a=points[index-1],b=points[index] || a;
  const t=(distance-a.distanceFeet)/(b.distanceFeet-a.distanceFeet || 1);
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,distance};
}
function nearestProfilePosition(profile,point){
  let best=null;
  for(let i=1;i<profile.vertices.length;i++){
    const a=profile.vertices[i-1],b=profile.vertices[i];
    if(b.breakBefore)continue;
    const dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));
    const gap=Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
    if(!best||gap<best.gap)best={gap,fraction:(a.distanceFeet+t*(b.distanceFeet-a.distanceFeet))/profile.lengthFeet};
  }
  return best;
}
function orientProfile(profile){
  const points=profile.vertices;
  if(profile.geographicOrientation)return profile;
  if(points.length<2)return profile;
  const dx=points.at(-1).x-points[0].x,dy=points.at(-1).y-points[0].y;
  if((Math.abs(dx)>=Math.abs(dy)?dx:dy)>=0)return profile;
  const length=profile.lengthFeet;
  const interval=s=>({...s,startFeet:length-s.endFeet,endFeet:length-s.startFeet});
  return {...profile,
    vertices:points.map((p,i)=>({...p,distanceFeet:length-p.distanceFeet,breakBefore:!!points[i+1]?.breakBefore})).reverse(),
    samples:profile.samples.map(s=>({...s,...(s.endFeet!=null?interval(s):{}),distanceFeet:s.distanceFeet!=null?length-s.distanceFeet:s.distanceFeet,left:s.right,right:s.left})).reverse(),
    stops:profile.stops.map(s=>({...s,distanceFeet:length-s.distanceFeet})).reverse(),
    elevation:profile.elevation?{...profile.elevation,samples:profile.elevation.samples.map((s,i,rows)=>({...s,distanceFeet:length-s.distanceFeet,breakBefore:!!rows[i+1]?.breakBefore})).reverse()}:null,
    sections:profile.sections?.map(interval).reverse()};
}
function frontageColor(name){return (typeof window!=='undefined'?window.zoningColor:require('./map.js').zoningColor)(name);}
if(typeof module!=='undefined')module.exports={profilePosition,nearestProfilePosition,frontageColor,orientProfile};
if(typeof window!=='undefined')window.FrontageLens=class{
  constructor(map,selectStop){
    this.map=map;this.selectStop=selectStop;this.selectedBoardingIds=[];
    this.panel=document.getElementById('frontage-lens');
    this.path=document.getElementById('frontage-path');
    this.slider=document.getElementById('frontage-position');
    this.elevation=new window.ElevationLens(this);
    this.path.addEventListener('change',()=>this.showPath());
    this.slider.addEventListener('input',()=>{this.startRide(Number(this.slider.value)/1000);this.preview(Number(this.slider.value)/1000,true);this.showDistance();});
    const strip=document.getElementById('frontage-strip');
    const hit=document.getElementById('frontage-scrub-hit');
    const finish=()=>{clearTimeout(this.endpointTimer);this.scrubbing=false;document.getElementById('frontage-distance').hidden=true;this.map.setProfilePin(null);};
    for(const target of [strip,this.slider,hit])for(const event of ['pointerup','pointercancel','blur','keyup','change'])target.addEventListener(event,finish);
    const scrub=e=>{
      if(!this.profile || (e.type==='pointermove' && !e.currentTarget.hasPointerCapture(e.pointerId)))return;
      const rect=strip.getBoundingClientRect();
      this.startRide(Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)));
      this.preview(Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),e.type==='pointerdown' || e.buttons===1);
      this.showDistance();
    };
    strip.addEventListener('pointermove',scrub);
    strip.addEventListener('pointerdown',e=>{e.preventDefault();scrub(e);strip.setPointerCapture(e.pointerId);});
    hit.addEventListener('pointermove',scrub);
    hit.addEventListener('pointerdown',e=>{e.preventDefault();scrub(e);hit.setPointerCapture(e.pointerId);});
  }
  startRide(fraction){
    if(!this.scrubbing&&this.profile)this.map.beginRide(profilePosition(this.profile,fraction));
    this.scrubbing=true;
  }
  showDistance(){
    if(!this.profile)return;
    const fraction=Number(this.slider.value)/1000;
    const readout=document.getElementById('frontage-distance');
    readout.textContent=`${(fraction*this.profile.lengthFeet/5280).toFixed(2)} mi`;
    readout.style.left=`${Math.max(6,Math.min(94,fraction*100))}%`;readout.hidden=false;
  }
  load(data,handoff=null){
    document.getElementById('frontage-distance').hidden=true;
    this.map.setProfilePin(null);
    this.profiles=[...(data.zoning?.frontage?.paths || [])].map(p=>orientProfile({...p,directionId:p.directionKey||p.directionId})).sort((a,b)=>b.lengthFeet-a.lengthFeet);
    this.map.profileChoices=this.profiles;
    this.map.chooseProfile=id=>{this.path.value=id;this.showPath();};
    this.path.replaceChildren(...this.profiles.map(p=>{const option=new Option(p.name,p.id);option.title=p.feedName || p.name;return option;}));
    if(handoff?.directionId){const matching=this.profiles.find(p=>p.directionId===handoff.directionId);if(matching)this.path.value=matching.id;}
    if(handoff?.boardingId&&!handoff.directionId){const matching=this.profiles.find(p=>p.stops.some(s=>s.id===handoff.boardingId));if(matching)this.path.value=matching.id;}
    if(handoff?.origin&&!handoff.directionId&&!handoff.boardingId){
      const candidates=this.profiles.map(profile=>({profile,nearest:nearestProfilePosition(profile,handoff.origin)})).filter(p=>p.nearest);
      candidates.sort((a,b)=>a.nearest.gap-b.nearest.gap);
      if(candidates[0]?.nearest.gap<=2000)this.path.value=candidates[0].profile.id;
    }
    document.getElementById('frontage-content').hidden=!this.profiles.length;
    document.getElementById('frontage-method').textContent=data.zoning?.frontage?.method || 'Adjacent zoning is unavailable for this route. An imported zoning source is required.';
    const sources=data.zoning?.sources || [];
    const loaded=sources.filter(s=>s.available).map(s=>s.name);
    const missing=sources.filter(s=>!s.available).map(s=>s.name);
    document.getElementById('zoning-coverage').textContent=`Zoning caches: ${loaded.join(', ') || 'none'}. ${missing.length?'Not loaded: '+missing.join(', ')+'. ':''}Other jurisdictions are unavailable. Unmapped samples remain unknown. Permit coverage is still Seattle only.`;
    const links=document.getElementById('zoning-sources');links.replaceChildren();
    for(const source of sources.filter(s=>s.available)){
      const link=document.createElement('a');link.href=source.source;link.target='_blank';link.rel='noopener noreferrer';
      link.textContent=`${source.name} · retrieved ${source.retrievedAt?.slice(0,10) || 'date unknown'}`;
      links.append(link,document.createTextNode(' · '));
    }
    const plan=document.createElement('a');plan.href='https://www.seattlehousing.org/sites/default/files/Yesler_Terrace_Development_Plan.pdf';plan.target='_blank';plan.rel='noopener noreferrer';plan.textContent='Yesler Terrace: mixed-use plan (2011)';
    if(this.profiles.some(p=>p.samples.some(s=>s.left.includes('MPC-YT') || s.right.includes('MPC-YT'))))links.append(plan);
    this.showPath(handoff);
    const missingStops=data.zoning?.frontage?.missingStopIds || [];
    const offSpine=data.zoning?.frontage?.offSpineStopIds || [];
    document.getElementById('frontage-coverage').textContent=missingStops.length?`${missingStops.length} boarding stops lack nearby cached route geometry.`:offSpine.length?'Scrubbing the main path · other alignments shown on map':'';
  }
  showPath(handoff=null){
    clearTimeout(this.endpointTimer);this.scrubbing=false;this.map.setProfilePin(null);
    this.profile=this.profiles.find(p=>p.id===this.path.value);
    const profile=this.profile;this.map.setProfilePath(profile);
    this.elevation.load(profile,this.profiles);
    if(!profile){this.map.setProfilePin(null);return;}
    document.getElementById('frontage-path-note').textContent=`${profile.relationship || 'Route geometry'} · selected section highlighted; others muted.`;
    for(const side of ['left','right']){
      const band=document.getElementById(`frontage-${side}`);band.replaceChildren();
      // Render contiguous zones together so decorative texture does not restart
      // at every narrow sampling cell. Flex weights preserve the distance axis.
      let cell=null,lastName=null,count=0;
      for(const sample of profile.samples){
        const name=sample[side];
        if(name===lastName){count+=sample.endFeet!=null?sample.endFeet-sample.startFeet:1;cell.style.flex=String(count);continue;}
        cell=document.createElement('span');count=sample.endFeet!=null?sample.endFeet-sample.startFeet:1;lastName=name;
        cell.style.flex=String(count);cell.style.backgroundColor=frontageColor(name);cell.title=name;
        if(window.zoningShimmers(name))cell.classList.add('pedestrian-band');
        band.append(cell);
      }
    }
    const sections=document.getElementById('frontage-sections');sections.replaceChildren();
    for(const section of profile.sections || []){const label=document.createElement('span');label.title=section.label || 'Route '+section.route;label.textContent=(section.endFeet-section.startFeet)/profile.lengthFeet>.08?label.title:'';label.style.flex=String(section.endFeet-section.startFeet);sections.append(label);}
    const mix=document.getElementById('frontage-mix');mix.replaceChildren();
    for(const item of profile.mix){
      const label=document.createElement('span'),swatch=document.createElement('i');
      swatch.style.background=frontageColor(item.name);swatch.setAttribute('aria-hidden','true');
      label.append(swatch,document.createTextNode(`${item.name} ${Math.round(item.percent)}%`));mix.append(label);
    }
    document.getElementById('frontage-path-note').title=`${profile.feedName || 'Feed geometry'} · Shared geometry uses a 60-foot tolerance, not verified trip or service patterns.`;
    const ticks=document.getElementById('frontage-stops');ticks.replaceChildren();
    for(const stop of profile.stops){
      const tick=document.createElement('button');tick.type='button';tick.className='frontage-stop';
      tick.style.left=`${stop.distanceFeet/profile.lengthFeet*100}%`;tick.title=(stop.route?'Route '+stop.route+' · ':'')+stop.name;
      tick.setAttribute('aria-label',`Select ${stop.name}`);
      tick.dataset.boardingId=stop.id;
      tick.setAttribute('aria-pressed',String(this.selectedBoardingIds.includes(stop.id)));
      tick.addEventListener('click',()=>{this.preview(stop.distanceFeet/profile.lengthFeet,false);this.selectStop?.(stop.id,profile.name);});ticks.append(tick);
      tick.addEventListener('dblclick',()=>this.selectStop?.(stop.id,profile.name,{inspect:true}));
    }
    document.getElementById('frontage-length').textContent=`${(profile.lengthFeet/5280).toFixed(1)} mi`;
    const first=profile.stops[0],last=profile.stops.at(-1);
    document.getElementById('frontage-endpoints').textContent=first&&last?`${first.name} → ${last.name}`:'Start → End';
    const nearest=handoff?.origin?nearestProfilePosition(profile,handoff.origin):null;
    const fraction=handoff?.fraction??(nearest&&nearest.gap<=2000?nearest.fraction:0);
    this.preview(fraction,false);
    this.handoffPoint=nearest&&nearest.gap<=2000?profilePosition(profile,fraction):null;
  }
  highlightStop(stop){
    this.selectedBoardingIds=stop?.oba_stop_ids || [];
    for(const tick of document.querySelectorAll('#frontage-stops .frontage-stop'))tick.setAttribute('aria-pressed',String(this.selectedBoardingIds.includes(tick.dataset.boardingId)));
  }
  selectMapStop(stop){
    if(!stop||!this.profile)return;
    const ids=stop.oba_stop_ids||[];
    let ticks=this.profile.stops.filter(s=>ids.includes(s.id));
    if(!ticks.length){
      const matching=this.profiles.find(p=>p.directionId===this.profile.directionId&&p.stops.some(s=>ids.includes(s.id)));
      if(matching){this.path.value=matching.id;this.showPath();ticks=this.profile.stops.filter(s=>ids.includes(s.id));}
    }
    if(!ticks.length)return;
    const current=Number(this.slider.value)/1000*this.profile.lengthFeet;
    const tick=ticks.reduce((a,b)=>Math.abs(a.distanceFeet-current)<=Math.abs(b.distanceFeet-current)?a:b);
    this.preview(tick.distanceFeet/this.profile.lengthFeet,false);
  }
  syncDirection(direction){
    if(!direction||this.profile?.directionId===direction)return;
    const profile=this.profiles.find(p=>p.directionId===direction);
    if(!profile)return;
    const origin=this.profile?profilePosition(this.profile,Number(this.slider.value)/1000):null;
    this.path.value=profile.id;this.showPath({origin});
  }
  preview(fraction,follow){
    if(!this.profile)return;
    const profile=this.profile,point=profilePosition(profile,fraction);
    const sample=profile.samples.find(s=>s.endFeet!=null && point.distance<s.endFeet) || profile.samples[Math.min(profile.samples.length-1,Math.floor(fraction*profile.samples.length))];
    const nearest=profile.stops.reduce((best,stop)=>!best || Math.abs(stop.distanceFeet-point.distance)<Math.abs(best.distanceFeet-point.distance)?stop:best,null);
    this.slider.value=Math.round(fraction*1000);
    const text=`${(point.distance/5280).toFixed(2)} mi${nearest?` · nearest route stop: ${nearest.name}`:''} · Left: ${sample.left} · Right: ${sample.right}`;
    this.slider.setAttribute('aria-valuetext',text);
    document.getElementById('frontage-readout').textContent=text;
    document.getElementById('frontage-cursor').style.left=`${fraction*100}%`;
    document.getElementById('frontage-nearest').textContent=nearest?.name || '';
    this.map.setProfileProgress(profile,point.distance);
    this.elevation.update(point.distance);
    if(this.scrubbing&&follow&&nearest)this.selectStop?.(nearest.id,profile.name,{fromScrub:true});
    this.map.setProfilePin(this.scrubbing?point:null,follow);
    clearTimeout(this.endpointTimer);
    if(this.scrubbing&&follow&&!this.map.rideInterrupted&&!this.map.rideFrame&&(fraction<=.04||fraction>=.96)){
      this.endpointTimer=setTimeout(()=>{if(this.scrubbing)this.map.centerProfilePin();},450);
    }
  }
};
