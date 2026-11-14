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


  for(const [width,height,mobile] of [[1440,1000,false],[390,844,true]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    await send('Page.navigate',{url:(process.env.APP_URL||'http://127.0.0.1:8000')+'/?offline=1'});
    let ready=false;
    for(let i=0;i<300;i++){ready=await evaluate(`!!document.querySelector('#dashboard:not([hidden]) .stop-marker')`);if(ready)break;await sleep(100);}
    assert.ok(ready,'app loaded');
    const before=await evaluate(`document.getElementById('map').getAttribute('viewBox')`);
    assert.equal(await evaluate(`document.getElementById('explore-guide').hidden`),true,'no blocking welcome tour');
    await evaluate(`document.getElementById('open-guide').click()`);
    assert.equal(await evaluate(`document.getElementById('explore-guide').hidden`),false);
    assert.equal(await evaluate(`document.getElementById('open-guide').getAttribute('aria-expanded')`),'true');
    assert.match(await evaluate(`document.getElementById('guide-route').textContent`),/First Hill Streetcar.*2016-01-23/);
    assert.match(await evaluate(`document.getElementById('guide-dates').textContent`),/Permit issue dates shown/);
    assert.match(await evaluate(`document.getElementById('explore-guide').textContent`),/not necessarily completed buildings/);
    assert.match(await evaluate(`document.getElementById('explore-guide').textContent`),/Drag to ride/);
    assert.equal(await evaluate(`document.getElementById('guide-prompts').hidden`),false);
    assert.ok(await evaluate(`(()=>{const r=document.getElementById('explore-guide').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()`),'panel fits viewport');
    assert.equal(await evaluate(`document.getElementById('map').getAttribute('viewBox')`),before,'opening help preserves camera');
    await evaluate(`document.getElementById('close-guide').click()`);
    assert.equal(await evaluate(`document.activeElement.id`),'open-guide');
    await evaluate(`document.getElementById('open-guide').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.equal(await evaluate(`document.getElementById('explore-guide').hidden`),true,'Escape closes');
    await evaluate(`document.getElementById('open-guide').click();document.getElementById('start').value='2020-01-01';document.getElementById('start').dispatchEvent(new Event('change'))`);
    assert.match(await evaluate(`document.getElementById('guide-dates').textContent`),/2020-01-01/,'metadata follows filters');
    await evaluate(`document.getElementById('map').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
    assert.equal(await evaluate(`document.getElementById('explore-guide').hidden`),true,'outside interaction dismisses');
    await evaluate(`document.getElementById('open-guide').click()`);
    const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/route-guide-'+(mobile?'mobile':'desktop')+'.png',Buffer.from(shot.data,'base64'));
  }
  assert.deepEqual(exceptions,[]);
  console.log('Desktop/mobile guide: route/date context, reopen, dismissal, bounds and preserved camera passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
