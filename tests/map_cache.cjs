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

  await send('Emulation.setDeviceMetricsOverride',{width:Number(process.env.TEST_WIDTH||390),height:844,deviceScaleFactor:1,mobile:!process.env.TEST_WIDTH});
  await send('Page.navigate',{url:(process.env.APP_URL || 'http://127.0.0.1:8000')+'/?offline=1'});
  let ready=false;
  for(let i=0;i<300;i++){ready=await evaluate(`!!document.querySelector('#dashboard:not([hidden]) .stop-marker')`);if(ready)break;await sleep(100);}
  assert.ok(ready,'app loaded');
  await evaluate(`(()=>{const p=window.RouteMap.prototype,draw=p.drawTiles;p.drawTiles=function(){window.testMap=this;return draw.call(this);};document.getElementById('show-geography').checked=true;document.getElementById('show-geography').dispatchEvent(new Event('change'));})()`);
  await sleep(300);
  await evaluate(`(()=>{const m=window.testMap;window.tileLayer=m.tileLayer;window.oldView=[...m.view];window.oldTiles=new Map(m.tileNodes);m.view[0]+=m.view[2]*2;m.setView();})()`);
  await sleep(300);
  await evaluate(`testMap.view=[...oldView];testMap.setView()`);
  await sleep(300);
  assert.ok(await evaluate(`[...oldTiles].every(([key,node])=>testMap.tileNodes.get(key)===node)`),'revisited tiles retain identity');
  assert.ok(await evaluate(`[...oldTiles.values()].every(node=>node.style.display!=='none')`),'cached same-zoom tiles remain paintable');
  const beforeStyle=await evaluate(`JSON.stringify({view:testMap.view,route:testMap.data.routeId,position:document.getElementById('frontage-position').value})`);
  await evaluate(`document.getElementById('basemap-style').value='quiet';document.getElementById('basemap-style').dispatchEvent(new Event('change'))`);
  await sleep(100);
  assert.match(await evaluate(`getComputedStyle(testMap.tileLayer).filter`),/saturate/,'subdued raster style applied');
  assert.equal(await evaluate(`getComputedStyle(testMap.profileRouteLayer).filter`),'none','route colors unaffected');
  assert.equal(await evaluate(`document.getElementById('map-attribution').hidden`),false,'OSM attribution retained');
  assert.equal(await evaluate(`JSON.stringify({view:testMap.view,route:testMap.data.routeId,position:document.getElementById('frontage-position').value})`),beforeStyle);
  await evaluate(`document.getElementById('basemap-style').value='standard';document.getElementById('basemap-style').dispatchEvent(new Event('change'))`);
  await sleep(100);
  assert.equal(await evaluate(`getComputedStyle(testMap.tileLayer).filter`),'none','original style restored');
  assert.ok(await evaluate(`[...oldTiles].every(([key,node])=>testMap.tileNodes.get(key)===node)`),'style switching reuses cached images');
  const updates=await evaluate(`new Promise(resolve=>{const m=testMap,draw=m.drawTiles;let frames=0,ticks=0;m.drawTiles=function(){frames++;return draw.call(this);};const timer=setInterval(()=>{m.view[0]+=ticks%2?1:-1;m.setView();if(++ticks===24){clearInterval(timer);m.drawTiles=draw;resolve(frames);}},16);})`);
  assert.ok(updates>3,'tiles update during sustained movement, before scrubbing stops');

  await evaluate(`window.fetchCount=0;window.realFetch=window.fetch;window.fetch=(...args)=>{if(String(args[0]).startsWith('/api/data'))window.fetchCount++;return realFetch(...args);};document.querySelectorAll('.stop-marker')[1].dispatchEvent(new MouseEvent('click',{bubbles:true}));`);
  await sleep(300);
  assert.ok(await evaluate(`testMap.tileLayer===tileLayer`),'stop selection preserves tile layer');
  await evaluate(`document.getElementById('route').dispatchEvent(new Event('change'))`);
  for(let i=0;i<100;i++){if(await evaluate(`!document.getElementById('route').disabled`))break;await sleep(100);}
  await sleep(300);
  assert.equal(await evaluate(`fetchCount`),0,'returning to loaded route reuses payload');
  assert.ok(await evaluate(`testMap.tileLayer===tileLayer`),'route reload preserves tile layer');
  assert.ok(await evaluate(`[...oldTiles].every(([key,node])=>testMap.tileNodes.get(key)===node)`),'route reload retains tiles');
  assert.deepEqual(exceptions,[]);
  console.log('Browser: tile identity after pan/backtrack, stable layer on stop/route selection, cached route payload passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
