// Bounded session cache. Store raw payloads; callers receive independent copies.
class RouteDataCache {
  constructor({limit=8,ttl=5*60*1000,now=()=>Date.now()}={}){this.entries=new Map();this.limit=limit;this.ttl=ttl;this.now=now;}
  clear(){this.entries.clear();}
  async get(key,fetcher){
    let entry=this.entries.get(key);
    if(entry && this.now()-entry.time>=this.ttl){this.entries.delete(key);entry=null;}
    if(!entry){
      entry={time:this.now(),promise:Promise.resolve().then(fetcher)};
      this.entries.set(key,entry);
      entry.promise.catch(()=>{if(this.entries.get(key)===entry)this.entries.delete(key);});
    }
    this.entries.delete(key);this.entries.set(key,entry);
    while(this.entries.size>this.limit)this.entries.delete(this.entries.keys().next().value);
    return structuredClone(await entry.promise);
  }
}
if(typeof module!=='undefined')module.exports={RouteDataCache};
if(typeof window!=='undefined')window.RouteDataCache=RouteDataCache;
