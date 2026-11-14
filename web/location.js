/* One-time, in-memory origins. Coordinates never enter app API requests. */
function originPoint(lat,lon,accuracy=0){
  return {lat,lon,accuracy,x:6378137*lon*Math.PI/180,y:6378137*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))};
}
function originDistance(a,b){
  const r=Math.PI/180, dlat=(b.lat-a.lat)*r, dlon=(b.lon-a.lon)*r;
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2;
  return 6371008.8*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
function nearbyBoardingStops(stops,origin){
  return stops.map(stop=>({...stop,distance:originDistance(origin,stop)})).filter(stop=>stop.distance<=1000).sort((a,b)=>a.distance-b.distance);
}
function nearbyRouteOptions(stops,origin){
  const routes=new Map();
  for(const stop of nearbyBoardingStops(stops,origin)){
    for(const route of stop.routes || []){
      if(!routes.has(route))routes.set(route,{id:route,distance:stop.distance,options:new Map()});
      const groups=stop.directions?.[route] || [];
      for(const direction of groups.length?groups:[{id:'',name:'Direction unavailable'}]){
        const options=routes.get(route).options;
        if(!options.has(direction.id))options.set(direction.id,{stop,direction});
      }
    }
  }
  return [...routes.values()].map(route=>({...route,options:[...route.options.values()]}));
}
if(typeof module!=='undefined')module.exports={originPoint,originDistance,nearbyBoardingStops,nearbyRouteOptions};
if(typeof window!=='undefined')window.OriginPicker=class{
  constructor(map,chooseRoute){
    this.map=map;this.chooseRoute=chooseRoute;this.version=0;
    this.status=document.getElementById('origin-status');this.results=document.getElementById('origin-results');
    this.locate=document.getElementById('use-location');this.clear=document.getElementById('clear-origin');
    this.locate.addEventListener('click',()=>this.locateUser());
    document.getElementById('use-map-center').addEventListener('click',()=>{
      if(!map.data){this.status.textContent='Wait for the route map to load.';return;}
      const [x,y,w,h]=map.view, [mx,my]=map.inverse(x+w/2,y+h/2);
      const lat=(2*Math.atan(Math.exp(my/6378137))-Math.PI/2)*180/Math.PI;
      const lon=mx/6378137*180/Math.PI;
      if(Math.abs(lat)>85 || Math.abs(lon)>180){this.status.textContent='Choose an origin within the geographic map.';return;}
      this.set(originPoint(lat,lon),'Map-center origin');
    });
    const finishPick=()=>{map.pickingOrigin=false;document.body.classList.remove('placing-origin');map.node.classList.remove('picking-origin');document.getElementById('pin-prompt').hidden=true;};
    document.getElementById('pick-origin').addEventListener('click',()=>{
      if(!map.data)return;
      document.getElementById('origin-dialog').close();
      map.pickingOrigin=true;document.body.classList.add('placing-origin');map.node.classList.add('picking-origin');document.getElementById('pin-prompt').hidden=false;
      document.querySelector('.mobile-route-picker')?.removeAttribute('open');
    });
    const cancelPick=()=>{if(!map.pickingOrigin)return;finishPick();document.querySelector('.mobile-route-picker')?.setAttribute('open','');};
    document.getElementById('cancel-pin').addEventListener('click',cancelPick);
    document.addEventListener('keydown',e=>{if(e.key==='Escape')cancelPick();});
    document.addEventListener('route-location-cancel',()=>{this.version++;this.locate.disabled=false;this.status.textContent='';});
    map.node.addEventListener('click',e=>{
      if(!map.pickingOrigin)return;
      e.preventDefault();e.stopImmediatePropagation();
      if(map.didPan)return;
      const point=map.mouse(e),[x,y]=map.inverse(point.x,point.y);
      const lat=(2*Math.atan(Math.exp(y/6378137))-Math.PI/2)*180/Math.PI,lon=x/6378137*180/Math.PI;
      if(Math.abs(lat)>85 || Math.abs(lon)>180)return;
      finishPick();this.set(originPoint(lat,lon),'Pinned location');

    },true);
    this.clear.addEventListener('click',()=>{
      this.version++;this.locate.disabled=false;map.setOrigin(null);this.results.replaceChildren();this.clear.hidden=true;
      this.status.textContent='Origin cleared. Use your location or pan the map and use its center.';
    });
  }
  async set(origin,label){
    this.version++;this.locate.disabled=false;this.clear.hidden=false;
    this.map.setOrigin(origin,false);
    this.status.textContent=label+(origin.accuracy?` · accuracy ±${Math.round(origin.accuracy)} m`:'');
    document.getElementById('origin-dialog').close();
    document.dispatchEvent(new CustomEvent('route-origin-selected',{detail:{label}}));
  }
  locateUser(){
    if(!this.map.data){this.status.textContent='Wait for the route map to load.';return;}
    if(!window.isSecureContext || !navigator.geolocation){this.status.textContent='Location requires a supported browser on HTTPS or localhost. Pan the map and choose Use map center.';return;}
    const version=++this.version;this.locate.disabled=true;
    this.status.textContent='Waiting for location permission…';
    const fail=error=>{
      if(version!==this.version)return;
      this.locate.disabled=false;
      this.status.textContent=({1:'Location permission was denied.',2:'Your location is unavailable.',3:'The location request timed out.'}[error.code] || 'Unable to get your location.')+' Pan the map and choose Use map center, or retry.';
    };
    try{navigator.geolocation.getCurrentPosition(position=>{
      if(version!==this.version)return;
      const {latitude,longitude,accuracy}=position.coords;
      if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>85||Math.abs(longitude)>180){fail({code:2});return;}
      this.set(originPoint(latitude,longitude,Number.isFinite(accuracy)?Math.max(0,accuracy):0),'Your location');
    },fail,{enableHighAccuracy:false,timeout:12000,maximumAge:60000});}catch(error){fail(error);}
  }
};

function rankedRoutes(catalog,stops,origin,query=''){
  const distances=new Map();
  if(origin)for(const stop of stops){const d=originDistance(origin,stop);for(const id of stop.routes||[])distances.set(id,Math.min(distances.get(id)??Infinity,d));}
  const term=query.trim().toLowerCase();
  return catalog.filter(r=>!term||[r.name,r.description,r.long_name,r.route_id].join(' ').toLowerCase().includes(term))
    .map(r=>({...r,distance:distances.get(r.route_id)??Infinity}))
    .sort((a,b)=>(term?Number(b.name?.toLowerCase()===term)-Number(a.name?.toLowerCase()===term):0)||(a.distance-b.distance)||(a.name||a.route_id).localeCompare(b.name||b.route_id,undefined,{numeric:true}));
}
if(typeof module!=='undefined')module.exports.rankedRoutes=rankedRoutes;
class RecentRoutes {
  constructor(limit=5){this.limit=limit;this.ids=[];}
  viewed(id){if(id)this.ids=[id,...this.ids.filter(other=>other!==id)].slice(0,this.limit+1);}
  choices(current){return this.ids.filter(id=>id!==current).slice(0,this.limit);}
}
if(typeof module!=='undefined')module.exports.RecentRoutes=RecentRoutes;
if(typeof window!=='undefined')window.MobileRoutePicker=class{
  constructor(catalog,map){
    this.catalog=catalog;this.map=map;this.stops=[];
    const native=document.getElementById('route');
    this.root=document.createElement('details');this.root.className='mobile-route-picker';
    this.summary=document.createElement('summary');this.summary.textContent='Choose route';
    this.search=document.createElement('input');this.search.type='search';this.search.placeholder='Search any route';this.search.setAttribute('aria-label','Search all routes');
    this.search.enterKeyHint='go';
    this.search.autocomplete='off';this.search.spellcheck=false;
    // WebKit skips its focus-reveal zoom when focus explicitly prevents scroll.
    // Do this synchronously within the user's first tap so the keyboard can open.
    // Subsequent taps keep native caret/selection behavior; never intercept pinch.
    this.search.addEventListener('pointerdown',event=>{
      if(event.pointerType!=='touch'||!event.isPrimary||document.activeElement===this.search)return;
      this.search.focus({preventScroll:true});
      if(document.activeElement===this.search)event.preventDefault();
    });
    this.search.addEventListener('keydown',event=>{
      if(event.key==='Enter'&&!event.isComposing){
        event.preventDefault();this.list.querySelector('button')?.click();
      }
    });
    this.note=document.createElement('p');this.list=document.createElement('div');
    this.history=new RecentRoutes();
    this.recent=document.createElement('section');this.recent.className='recent-routes';
    this.source='all';
    const sources=document.createElement('div');sources.className='route-sources';sources.setAttribute('role','group');sources.setAttribute('aria-label','Route list source');
    this.sourceButtons={};
    for(const [key,label] of [['me','Routes near me'],['point','Routes near a point'],['all','All routes']]){
      const button=document.createElement('button');button.type='button';button.textContent=label;this.sourceButtons[key]=button;sources.append(button);
      button.addEventListener('click',()=>{
        this.search.blur();this.search.value='';
        document.dispatchEvent(new Event('route-location-cancel'));
        if(key==='me'){document.getElementById('use-location').click();}
        else if(key==='point'){document.getElementById('origin-dialog').showModal();}
        else{this.source='all';this.render();}
      });
    }
    this.originMessage=document.createElement('p');this.originMessage.setAttribute('role','status');
    new MutationObserver(()=>{this.originMessage.textContent=document.getElementById('origin-status').textContent;}).observe(document.getElementById('origin-status'),{childList:true,subtree:true,characterData:true});
    document.addEventListener('route-origin-selected',e=>{this.source=e.detail.label==='Your location'?'me':'point';this.root.open=true;this.search.value='';this.render();this.summary.focus({preventScroll:true});});
    this.root.append(this.summary,sources,this.originMessage,this.search,this.recent,this.note,this.list);native.parentElement.after(this.root);
    this.choose=route=>{
      if(native.disabled)return;
      this.search.blur();this.root.open=false;this.search.value='';
      native.value=route.route_id;native.dispatchEvent(new Event('change'));this.render();
      if(window.matchMedia('(max-width:650px)').matches)window.scrollTo({top:0,left:0,behavior:'instant'});
    };
    this.render=()=>{
      const current=catalog.find(r=>r.route_id===native.value);this.summary.textContent=current?.name||'Choose route';
      const query=this.search.value,origin=this.source==='all'?null:map.origin;
      for(const [key,button] of Object.entries(this.sourceButtons))button.setAttribute('aria-pressed',String(key===this.source));
      const routes=rankedRoutes(catalog,this.stops,origin,query).filter(r=>query||!origin||r.distance<=1000);
      this.note.textContent=query?`${routes.length} matching routes`:origin?(routes.length?'Nearest 10 within 1 km · straight-line distance':'No cached routes within 1 km. Choose another point or search all routes.'):'All routes · type to search';
      this.recent.replaceChildren();
      const recent=this.history.choices(native.value).map(id=>catalog.find(r=>r.route_id===id)).filter(Boolean);
      this.recent.hidden=!recent.length;
      if(recent.length){
        const title=document.createElement('p');title.textContent='Recent routes';this.recent.append(title);
        for(const route of recent){const button=document.createElement('button');button.type='button';button.textContent=route.name||route.route_id;button.setAttribute('aria-label',`Return to ${route.name||route.route_id}`);button.addEventListener('click',()=>this.choose(route));this.recent.append(button);}
      }
      this.list.replaceChildren();
      for(const route of (query?routes:routes.slice(0,10))){
        const button=document.createElement('button');button.type='button';
        button.textContent=[route.name||route.route_id,route.description||route.long_name,Number.isFinite(route.distance)?`${Math.round(route.distance)} m`:null].filter(Boolean).join(' · ');
        button.setAttribute('aria-pressed',String(native.value===route.route_id));
        button.addEventListener('click',()=>this.choose(route));this.list.append(button);
      }
    };
    this.search.addEventListener('input',this.render);this.root.addEventListener('toggle',()=>{if(!this.root.open)this.search.blur();this.render();});
    document.addEventListener('route-origin-change',this.render);document.addEventListener('route-loaded',event=>{this.history.viewed(event.detail?.routeId);this.render();});
    this.render();fetch('/api/boarding-stops').then(r=>{if(!r.ok)throw Error();return r.json();}).then(stops=>{this.stops=stops;this.render();}).catch(()=>{this.note.textContent='Nearby distances unavailable. Search any route.';});
  }
};
