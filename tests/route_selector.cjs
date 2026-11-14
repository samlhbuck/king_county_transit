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
  const selected=await evaluate(`document.getElementById('route').value`);
  const viewport=await evaluate(`document.getElementById('map').getAttribute('viewBox')`);
  await evaluate(`document.querySelector('.mobile-route-picker').open=true;document.querySelectorAll('.route-sources button')[1].click()`);
  assert.ok(await evaluate(`document.getElementById('origin-dialog').open`));
  await evaluate(`document.getElementById('use-map-center').click()`);
  assert.equal(await evaluate(`document.getElementById('origin-dialog').open`),false);
  assert.ok(await evaluate(`document.querySelector('.mobile-route-picker').open`));
  assert.equal(await evaluate(`document.getElementById('route').value`),selected);
  assert.equal(await evaluate(`document.getElementById('map').getAttribute('viewBox')`),viewport);
  await evaluate(`navigator.geolocation.getCurrentPosition=success=>success({coords:{latitude:47.61,longitude:-122.32,accuracy:20}});document.querySelectorAll('.route-sources button')[0].click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.route-sources button')[0].getAttribute('aria-pressed')`),'true');
  assert.ok(await evaluate(`document.querySelector('.mobile-route-picker').open`));
  assert.equal(await evaluate(`document.getElementById('route').value`),selected);
  await evaluate(`document.querySelectorAll('.route-sources button')[1].click();document.getElementById('pick-origin').click();document.getElementById('cancel-pin').click()`);
  assert.ok(await evaluate(`document.querySelector('.mobile-route-picker').open`),'cancel returns to selector');
  await evaluate(`document.querySelectorAll('.route-sources button')[2].click()`);
  assert.equal(await evaluate(`document.getElementById('route').value`),selected);
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'no horizontal overflow');
  assert.ok(await evaluate(`document.getElementById('map').getBoundingClientRect().height>150`),'map visible');
  const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/route-selector.png',Buffer.from(shot.data,'base64'));
  assert.deepEqual(exceptions,[]);
  console.log('Route selector: nearby sources, preserved route/viewport, cancellation and mobile layout passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
