const assert=require('node:assert/strict');
const {RouteDataCache}=require('../web/cache.js');
(async()=>{
 let time=0,calls=0;
 const cache=new RouteDataCache({limit:2,ttl:100,now:()=>time});
 const fetcher=async()=>{calls++;return {stops:[{name:'Original'}]};};
 const [a,b]=await Promise.all([cache.get('a',fetcher),cache.get('a',fetcher)]);
 assert.equal(calls,1);a.stops[0].name='Changed';assert.equal(b.stops[0].name,'Original');
 assert.equal((await cache.get('a',fetcher)).stops[0].name,'Original');
 await cache.get('b',fetcher);await cache.get('a',fetcher);await cache.get('c',fetcher);
 assert.ok(!cache.entries.has('b'));
 time=101;await cache.get('a',fetcher);assert.equal(calls,4);
 cache.clear();assert.equal(cache.entries.size,0);
 await assert.rejects(cache.get('bad',async()=>{throw Error('offline');}));
 await cache.get('bad',fetcher);assert.equal(calls,5);
 console.log('Cache reuse, concurrent requests, independent payloads, expiry, eviction and failed-request retry passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
