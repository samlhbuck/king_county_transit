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

  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:(process.env.APP_URL || 'http://127.0.0.1:8000')+'/?offline=1'});
  let ready=false;
  for(let i=0;i<300;i++){ready=await evaluate(`!!document.querySelector('#dashboard:not([hidden]) .stop-marker')`);if(ready)break;await sleep(100);}
  assert.ok(ready,'app loaded');

  await evaluate(`(()=>{const proto=RouteMap.prototype,begin=proto.beginRide;proto.beginRide=function(point){window.testMap=this;return begin.call(this,point);};const slider=document.getElementById('frontage-position');slider.value=500;slider.dispatchEvent(new Event('input'));})()`);
  await sleep(650);
  assert.ok(await evaluate(`testMap.view[2]<=1400*testMap.scale+1`),'scrubbing enters ride view');
  const layer=await evaluate(`testMap.tileLayer===document.querySelector('.geographic-tiles')`);assert.ok(layer);
  await evaluate(`testMap.node.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',isPrimary:true}));window.manualView=[...testMap.view];const slider=document.getElementById('frontage-position');slider.value=700;slider.dispatchEvent(new Event('input'));`);
  assert.ok(await evaluate(`JSON.stringify(testMap.view)===JSON.stringify(manualView)`),'manual map interaction suspends follow');
  await evaluate(`document.getElementById('frontage-position').dispatchEvent(new Event('change'));testMap.openProjectCard({OriginalAddress1:'Test address',CompletedDate:'2024-04-01',PermitTypeDesc:'New',HousingUnitsAdded:48,EstProjectCostNumeric:12600000,Description:'Apartment building',x:testMap.data.stops[0].x,y:testMap.data.stops[0].y})`);
  assert.ok(await evaluate(`document.getElementById('project-floating-card').textContent.includes('$12.6M')`));
  assert.ok(await evaluate(`document.getElementById('project-floating-card').textContent.includes('48')`));
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#project-floating-card button')].map(b=>b.textContent)`),['How to explore'],'existing help remains available without a separate close button');
  await evaluate(`testMap.didPan=false;testMap.node.dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('project-floating-card')`),null);
  await evaluate(`testMap.fit();document.getElementById('map-all-stops').checked=true;document.getElementById('map-all-stops').dispatchEvent(new Event('change'));`);
  const keys=await evaluate(`Array.from(document.querySelectorAll('.project-marker')).slice(0,2).map(n=>n.dataset.projectKey)`);
  assert.equal(keys.length,2,'two real permits available');
  const clickPermit=key=>evaluate(`testMap.didPan=false;document.querySelector('.project-marker[data-project-key='+CSS.escape(${JSON.stringify(key)})+']').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await clickPermit(keys[0]);
  assert.equal(await evaluate(`document.getElementById('project-floating-card').dataset.projectKey`),keys[0]);
  await clickPermit(keys[0]);
  assert.equal(await evaluate(`document.getElementById('project-floating-card')`),null,'second tap dismisses');
  await clickPermit(keys[0]);await clickPermit(keys[1]);
  assert.equal(await evaluate(`document.getElementById('project-floating-card').dataset.projectKey`),keys[1],'another permit replaces callout');
  await evaluate(`testMap.didPan=false;testMap.node.dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('project-floating-card')`),null,'tap away dismisses');
  assert.deepEqual(exceptions,[]);
  console.log('Ride zoom, manual override, retained tile layer, immediate permit facts and tap-away dismissal passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
