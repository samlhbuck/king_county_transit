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
const secondRoute = process.env.ELEVATION_TEST_ROUTE || '23_100340';
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



  for(const [width,height,mobile] of [[1440,1000,false],[390,844,true]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    await send('Page.navigate',{url:(process.env.APP_URL||'http://127.0.0.1:8000')+'/?offline=1'});
    let ready=false;
    for(let i=0;i<300;i++){ready=await evaluate(`!!document.querySelector('#dashboard:not([hidden]) .stop-marker')`);if(ready)break;await sleep(100);}
    assert.ok(ready,'app loaded');
    await evaluate(`(()=>{const preview=FrontageLens.prototype.preview;FrontageLens.prototype.preview=function(...args){window.testLens=this;window.testMap=this.map;return preview.apply(this,args);};window.fetchCount=0;const original=window.fetch;window.fetch=(...args)=>{fetchCount++;return original(...args);};document.getElementById('profile-lens-mode').click();})()`);
    assert.equal(await evaluate(`document.getElementById('elevation-chart').hasAttribute('hidden')`),false);
    assert.notEqual(await evaluate(`getComputedStyle(document.getElementById('elevation-chart')).display`),'none');
    assert.match(await evaluate(`document.getElementById('elevation-chart').getAttribute('aria-label')`),/feet NAVD88/);
    const initialX=await evaluate(`document.getElementById('elevation-marker').getAttribute('cx')`);
    await evaluate(`const slider=document.getElementById('frontage-position');slider.value=650;slider.dispatchEvent(new Event('input'));`);
    await sleep(600);
    assert.notEqual(await evaluate(`document.getElementById('elevation-marker').getAttribute('cx')`),initialX);
    assert.ok(await evaluate(`document.getElementById('stop').value.length>0`),'scrubbing selects corresponding stop');
    assert.match(await evaluate(`document.getElementById('elevation-current').textContent`),/ft terrain/);
    assert.equal(await evaluate(`fetchCount`),0,'scrubbing and lens switching do not request data');
    await evaluate(`document.getElementById('frontage-position').dispatchEvent(new Event('change'));testMap.fit();window.beforeStop=[...testMap.view];window.tick=testLens.profile.stops[2];window.stopId=testMap.data.stops.find(s=>s.oba_stop_ids.includes(tick.id)).id;document.querySelector('.stop-marker[data-stop-id='+CSS.escape(stopId)+']').dispatchEvent(new MouseEvent('click',{bubbles:true}));`);
    await sleep(100);
    assert.ok(await evaluate(`Math.abs(Number(testLens.slider.value)/1000-tick.distanceFeet/testLens.profile.lengthFeet)<.002`),'map stop selects matching chainage');
    assert.deepEqual(await evaluate(`testMap.view`),await evaluate(`beforeStop`),'map stop does not recenter');
    assert.ok(await evaluate(`document.querySelector('.route-progress').getAttribute('d').includes('L')`),'filled route matches selected stop');
    await evaluate(`if(!document.getElementById('mobile-detail-panel').hidden)document.getElementById('mobile-close-details').click();document.getElementById('fit').click();`);
    const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/route-elevation-'+(mobile?'mobile':'desktop')+'.png',Buffer.from(shot.data,'base64'));
    await evaluate(`document.getElementById('route').value=${JSON.stringify(secondRoute)};document.getElementById('route').dispatchEvent(new Event('change'))`);
    for(let i=0;i<300;i++){if(await evaluate(`!document.getElementById('route').disabled`))break;await sleep(100);}
    assert.equal(await evaluate(`testMap.data.routeId`),secondRoute);
    assert.ok(await evaluate(`testLens.profile.elevation.samples.every(s=>s.elevationMeters!=null)`));
    if(secondRoute==='23_100340')assert.ok(await evaluate(`testLens.elevation.high-testLens.elevation.low<200`),'flatter second route uses meaningful scale');
    const beforeRequests=await evaluate(`fetchCount`);
    await evaluate(`testMap.node.dispatchEvent(new PointerEvent('pointerdown'));window.manualView=[...testMap.view];testLens.slider.value=250;testLens.slider.dispatchEvent(new Event('input'));`);
    // Manual override within an active scrub remains authoritative.
    await evaluate(`testMap.node.dispatchEvent(new PointerEvent('pointerdown'));window.manualView=[...testMap.view];testLens.slider.value=750;testLens.slider.dispatchEvent(new Event('input'));`);
    assert.deepEqual(await evaluate(`testMap.view`),await evaluate(`manualView`));
    assert.equal(await evaluate(`fetchCount`),beforeRequests);
    await evaluate(`testLens.slider.dispatchEvent(new Event('change'));document.getElementById('direction').selectedIndex=1;document.getElementById('direction').dispatchEvent(new Event('change'));`);
    assert.ok(await evaluate(`testLens.profile.directionId===document.getElementById('direction').value`),'direction and terrain align: '+await evaluate(`JSON.stringify({profile:testLens.profile.directionId,control:document.getElementById('direction').value,paths:testLens.profiles.map(p=>p.directionId)})`));
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
    await evaluate(`testLens.elevation.mode='elevation';testLens.profile.elevation.samples[1].elevationMeters=null;testLens.elevation.draw();const rows=testLens.profile.elevation.samples;testLens.preview((rows[0].distanceFeet+rows[1].distanceFeet)/2/testLens.profile.lengthFeet,false);`);
    assert.equal(await evaluate(`document.getElementById('elevation-current').textContent`),'Elevation unavailable','missing sample is not a false zero');
    await evaluate(`testLens.profile.elevation=null;testLens.elevation.load(testLens.profile,testLens.profiles);testLens.preview(.5,false);`);
    assert.equal(await evaluate(`document.getElementById('profile-lens-mode').disabled`),true);
    assert.equal(await evaluate(`document.getElementById('elevation-chart').hasAttribute('hidden')`),true);
  }
  assert.deepEqual(exceptions,[]);
  console.log('Live desktop/mobile terrain: two cached routes, scrubbing, map-stop synchronization, direction, manual override and zero scrub fetches passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
