/* Cached terrain uses the same distance axis as the route; no live requests. */
function elevationAt(samples,distance){
  if(!samples?.length)return null;
  const exact=samples.find(s=>Math.abs(s.distanceFeet-distance)<.001);
  if(exact)return exact.elevationMeters;
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i];
    if(distance<a.distanceFeet||distance>b.distanceFeet)continue;
    if(b.breakBefore||a.elevationMeters==null||b.elevationMeters==null)return null;
    const t=(distance-a.distanceFeet)/(b.distanceFeet-a.distanceFeet||1);
    return a.elevationMeters+t*(b.elevationMeters-a.elevationMeters);
  }
  return null;
}
if(typeof module!=='undefined')module.exports={elevationAt};
if(typeof window!=='undefined')window.ElevationLens=class{
  constructor(frontage){
    this.frontage=frontage;this.mode='zoning';
    this.toggle=document.getElementById('profile-lens-mode');
    this.chart=document.getElementById('elevation-chart');
    this.toggle.addEventListener('click',()=>{this.mode=this.mode==='zoning'?'elevation':'zoning';this.draw();frontage.preview(Number(frontage.slider.value)/1000,false);});
  }
  load(profile,profiles){
    this.profile=profile;this.profiles=profiles;
    this.draw();
  }
  draw(){
    const available=!!this.profile?.elevation?.samples?.some(s=>Number.isFinite(s.elevationMeters));
    this.toggle.disabled=!available;
    this.toggle.title=available?'Switch between current zoning and terrain':'Elevation not cached for this route geometry';
    const terrain=available&&this.mode==='elevation';
    this.chart.toggleAttribute('hidden',!terrain);
    for(const id of ['frontage-left','frontage-right'])document.getElementById(id).hidden=terrain;
    this.toggle.textContent=!available?'Elevation unavailable':terrain?'Current zoning':'Elevation';
    this.toggle.setAttribute('aria-pressed',String(terrain));
    if(!available)document.getElementById('elevation-source').textContent='Elevation is unavailable for this cached route geometry.';
    else document.getElementById('elevation-source').textContent=`USGS 3DEP terrain · retrieved ${this.profile.elevation.retrievedAt.slice(0,10)}. Ground may differ from bridge or tunnel height.`;
    if(!terrain)return;
    const samples=this.profile.elevation.samples;
    const values=this.profiles.flatMap(p=>p.elevation?.samples||[]).filter(s=>Number.isFinite(s.elevationMeters)).map(s=>s.elevationMeters/0.3048);
    const low=Math.floor(Math.min(...values)/50)*50,high=Math.max(low+100,Math.ceil(Math.max(...values)/50)*50);
    this.low=low;this.high=high;
    let d='',connected=false;
    for(const s of samples){
      if(s.elevationMeters==null){connected=false;continue;}
      const x=s.distanceFeet/this.profile.lengthFeet*600,y=38-(s.elevationMeters/0.3048-low)/(high-low)*34;
      d+=(connected&&!s.breakBefore?' L':' M')+x+','+y;connected=true;
    }
    document.getElementById('elevation-trace').setAttribute('d',d);
    const data=this.profile.elevation;
    const datums=[...new Set(data.models.map(m=>m.VerticalDatum||'Vertical datum unavailable'))];
    const datum=datums.every(d=>/NAVD.?88|Datum of 1988/i.test(d))?'NAVD88':datums.join(' / ');
    this.chart.setAttribute('aria-label',`Terrain elevation, ${low} to ${high} feet ${datum} over ${(this.profile.lengthFeet/5280).toFixed(1)} miles. Vertical and horizontal axes use different scales. Gaps mean missing data.`);
    document.getElementById('elevation-source').textContent=`USGS 3DEP ground terrain · ${datum} · ${data.sampleStepFeet.toFixed(0)} ft sampling · retrieved ${data.retrievedAt.slice(0,10)}. Ground may differ from bridge or tunnel height. Axes scale independently; missing data are gaps.`;
  }
  update(distance){
    const samples=this.profile?.elevation?.samples;
    const meters=elevationAt(samples,distance);
    const output=document.getElementById('elevation-current');
    output.textContent=samples?(meters==null?'Elevation unavailable':Math.round(meters/0.3048)+' ft terrain'):'';
    output.hidden=this.mode!=='elevation'||!samples;
    const marker=document.getElementById('elevation-marker');
    marker.setAttribute('visibility',meters==null||this.mode!=='elevation'?'hidden':'visible');
    if(meters!=null&&this.mode==='elevation'){marker.setAttribute('cx',distance/this.profile.lengthFeet*600);marker.setAttribute('cy',38-(meters/0.3048-this.low)/(this.high-this.low)*34);}
    return meters;
  }
};
