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
  await send('Page.navigate',{url:(process.env.APP_URL || 'http://127.0.0.1:8000')+'/?offline=1&contextRoutes=1&routeGrid=1'});
  let ready=false;
  for(let i=0;i<300;i++){ready=await evaluate(`!!document.querySelector('#dashboard:not([hidden]) .stop-marker')`);if(ready)break;await sleep(100);}
  assert.ok(ready,'app loaded');
  for(let i=0;i<100;i++){if(await evaluate(`document.querySelectorAll('.context-routes path').length>0`))break;await sleep(100);}
  await evaluate(`(()=>{const proto=ContextRoutes.prototype,update=proto.update;proto.update=function(){window.contextTest=this;return update.call(this);};window.dispatchEvent(new Event('resize'));document.querySelector('.zoom button').click();})()`);
  await sleep(350);
  assert.ok(await evaluate(`contextTest.routes.length>0`));
  assert.equal(await evaluate(`document.querySelectorAll('.route-debug-grid rect').length`),9);
  const count=await evaluate(`[...document.querySelectorAll('.context-routes path')].filter(n=>Number(n.style.opacity)>0).length`);
  await evaluate(`contextTest.filtered=false;contextTest.update()`);
  const all=await evaluate(`[...document.querySelectorAll('.context-routes path')].filter(n=>Number(n.style.opacity)>0).length`);
  assert.ok(all>=count,'unfiltered comparison shows at least filtered routes');
  await evaluate(`contextTest.config.minimumCells=9;contextTest.filtered=true;contextTest.update()`);
  assert.ok(await evaluate(`contextTest.map.profileRouteLayer.querySelector('path')!==null`),'selected route still rendered');
  assert.equal(await evaluate(`contextTest.nodes.get(contextTest.map.data.routeId)?.style.opacity`),'0','selected not duplicated in contextual layer');
  const before=await evaluate(`document.getElementById('route').options.length`);
  await evaluate(`contextTest.debug=false;contextTest.update();document.getElementById('frontage-position').value=500;document.getElementById('frontage-position').dispatchEvent(new Event('input'))`);
  await sleep(550);
  assert.equal(await evaluate(`document.getElementById('route').options.length`),before);
  assert.equal(await evaluate(`getComputedStyle(contextTest.debugLayer).display`),'none');
  const timing=await evaluate(`(()=>{const start=performance.now();contextTest.update();return performance.now()-start;})()`);
  console.log('Context layer/debug, filter bypass, selected-route retention, selector inventory and scrubber checks passed; update ms:',timing);
  await evaluate(`window.contextUpdates=0;const original=contextTest.update.bind(contextTest);contextTest.update=()=>{contextUpdates++;original();};for(let i=0;i<50;i++)contextTest.schedule()`);
  await sleep(150);
  assert.ok(await evaluate(`contextUpdates<=2`),'movement updates are coalesced');
  await send('Page.navigate',{url:(process.env.APP_URL || 'http://127.0.0.1:8000')+'/?offline=1'});
  for(let i=0;i<300;i++){if(await evaluate(`!!document.querySelector('#dashboard:not([hidden]) .stop-marker')`))break;await sleep(100);}
  assert.equal(await evaluate(`document.querySelector('.context-routes')`),null,'default app has no contextual layer');
  assert.equal(await evaluate(`document.getElementById('route-visibility-controls')`),null,'default app has no experimental controls');
  assert.deepEqual(exceptions,[]);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
