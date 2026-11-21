// Dependency-free Chrome smoke test. Requires Node 22+ and Google Chrome.
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'route-explorer-chrome-'));
const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank',
], {stdio: 'ignore'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
(async () => {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let seq = 0;
  const pending = new Map(), exceptions = [];
  socket.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.id) { const task = pending.get(data.id); pending.delete(data.id); data.error ? task.reject(data.error) : task.resolve(data.result); }
    if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); });
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await send('Runtime.enable');
  await send('Page.enable');



  const base = process.env.APP_URL || 'http://127.0.0.1:8000';
  const output = process.env.STOP_COMPARISON_DIR;
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const waitFor = async expression => {
    for(let i=0;i<400;i++){
      if(await evaluate(expression))return;
      await sleep(100);
    }
    throw new Error('Timed out waiting for '+expression);
  };
  for(const [width,height,mobile] of [[1440,1000,false],[390,844,true]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    const label=mobile?'mobile':'desktop';
    const comparison=[];
    for(const mode of [0,1]){
      await send('Page.navigate',{url:base+'/?offline=1&showAllRouteStops='+mode});
      await waitFor(`!!document.querySelector('#dashboard:not([hidden]) .route-progress')&&!document.body.classList.contains('route-loading')`);
      await evaluate(`(() => {
        const setView=RouteMap.prototype.setView;
        RouteMap.prototype.setView=function(){window.testMap=this;return setView.call(this);};
        const preview=FrontageLens.prototype.preview;
        FrontageLens.prototype.preview=function(...args){window.testLens=this;return preview.apply(this,args);};
        window.scrub=value=>{
          const slider=document.getElementById('frontage-position');
          slider.value=value;
          slider.dispatchEvent(new Event('input'));
          slider.dispatchEvent(new Event('change'));
        };
        window.loadRoute=route=>{
          const select=document.getElementById('route');
          select.value=route;
          select.dispatchEvent(new Event('change'));
        };
        document.getElementById('fit').click();
        if(!matchMedia('(max-width:650px)').matches)document.querySelector('.map-wrap').scrollIntoView({block:'center'});
      })()`);
      await evaluate(`loadRoute('1_100249')`);
      await waitFor(`testMap.data.routeId==='1_100249'&&!document.body.classList.contains('route-loading')`);
      await evaluate(`testMap.fit();window.fitView=[...testMap.view];
        window.center={
          dense:testMap.data.boardingStops.find(s=>/Broadway.*Harrison/.test(s.name)),
          sparse:testMap.data.boardingStops.find(s=>/25th Ave SW.*Henderson/.test(s.name))
        };`);
      assert.deepEqual(await evaluate(`Array.from(document.querySelector('#frontage-strip').children)
        .filter(node=>!node.hidden&&node.matches('.frontage-band,#frontage-opposite-stops,.frontage-scrub-target,#frontage-stops'))
        .map(node=>node.id||'scrubber')`),['frontage-left','frontage-opposite-stops','scrubber','frontage-stops','frontage-right']);
      assert.equal(await evaluate(`document.querySelector('.frontage-side-labels')!==null`),false);
      assert.equal(await evaluate(`document.querySelector('.frontage-toolbar').textContent.trim()`),'ReverseRIDE');
      if(mobile)assert.ok(await evaluate(`['frontage-reverse','frontage-ride'].every(id=>{
        const button=document.getElementById(id),r=button.getBoundingClientRect();
        return r.top>=0&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===button;
      })`),'both direction and camera controls fit in the phone viewport');
      const results=[];
      for(const [scale,factor,area] of [['entire-route',1,'dense'],['district',.45,'dense'],['neighborhood',.15,'dense'],['sparse-neighborhood',.15,'sparse']]){
        const result=await evaluate(`(() => {
          const m=testMap,stop=center['${area}'];const [x,y]=m.xy([stop.x,stop.y]);
          if(${factor}===1)m.view=[...fitView];
          else{
            const w=fitView[2]*${factor},h=fitView[3]*${factor};
            m.view=[x-w/2,y-h/2,w,h];
          }
          const start=performance.now();m.setView();
          return {drawMs:performance.now()-start,total:m.data.boardingStops.length,visible:m.stopLayer.querySelectorAll('.stop-marker').length,
            view:m.view,ticks:[...document.querySelectorAll('.frontage-stop')].map(n=>n.dataset.boardingId)};
        })()`);
        if(mode){
          assert.equal(result.visible,result.total);
        }
        results.push(result);
        if(output){
          const shot=await send('Page.captureScreenshot',{format:'png'});
          fs.writeFileSync(path.join(output,`${label}-${scale}-${mode?'all':'filtered'}.png`),Buffer.from(shot.data,'base64'));
        }
      }
      comparison.push(results);
      if(mode===1)continue;
      assert.ok(results[0].visible<results[2].visible,'closer view reveals boarding markers');
      for(const route of ['1_100249','1_100002','1_102745','20_217']){
        await evaluate(`loadRoute('${route}')`);
        await waitFor(`testMap.data.routeId==='${route}'&&!document.body.classList.contains('route-loading')`);
        const before=await evaluate(`(() => {
          const ride=document.getElementById('frontage-ride');
          if(ride.getAttribute('aria-pressed')==='true')ride.click();
          testMap.fit();scrub(430);
          return {point:testLens.position,view:testMap.view,profile:testLens.profile.id,opposite:testLens.opposite?.id,
            stops:testLens.profile.stops.map(s=>s.id),oppositeStops:testLens.opposite?.stops.map(s=>s.id),
            reverseVisible:!document.getElementById('frontage-reverse').hidden};
        })()`);
        assert.ok(before.reverseVisible&&before.opposite,route+' has a reverse traversal');
        const after=await evaluate(`(() => {
          document.getElementById('frontage-reverse').click();
          const p=testLens.profile,selection=testMap.data.stops.find(s=>s.oba_stop_ids.includes(testLens.indexStop.id));
          return {point:testLens.position,view:testMap.view,profile:p.id,opposite:testLens.opposite?.id,
            stops:[...document.querySelectorAll('.frontage-stop')].map(n=>n.dataset.boardingId),
            upper:document.querySelectorAll('.frontage-opposite-stop').length,
            synced:document.getElementById('stop').value===selection?.id&&testMap.activeProfileId===p.id&&!!testMap.profilePin};
        })()`);
        assert.equal(after.profile,before.opposite);
        assert.equal(after.opposite,before.profile);
        assert.deepEqual(after.stops,before.oppositeStops);
        assert.equal(after.upper,before.stops.length);
        assert.deepEqual(after.view,before.view,'RIDE off preserves the camera on Reverse');
        assert.ok(after.synced);
        assert.ok(Math.hypot(after.point.x-before.point.x,after.point.y-before.point.y)<400,'Reverse preserves local geography on '+route);
        const afterScrub=await evaluate(`scrub(700);[...testMap.view]`);
        assert.deepEqual(afterScrub,before.view,'RIDE off preserves the camera on scrub');
      }
      const framed=await evaluate(`testMap.fit();[...testMap.view]`);
      const toggled=await evaluate(`document.getElementById('frontage-ride').click();[...testMap.view]`);
      assert.deepEqual(toggled,framed,'re-enable waits for the next manual scrub');
      await evaluate(`scrub(550)`);
      await waitFor(`testMap.view[2]<${framed[2]}`);
    }
    for(let i=0;i<comparison[0].length;i++){
      const [filtered,all]=comparison.map(results=>results[i]);
      assert.deepEqual(all.view,filtered.view);
      assert.deepEqual(all.ticks,filtered.ticks);
    }
    console.log(label,comparison[0].map(({visible,total,drawMs})=>({visible,total,drawMs})));
  }
  assert.deepEqual(exceptions,[]);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
  socket?.close();
  chrome.kill();
});
