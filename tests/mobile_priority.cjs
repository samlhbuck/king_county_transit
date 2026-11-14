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
  for(const mode of ['details']){
    await evaluate(`document.getElementById('mobile-${mode}').click()`);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'no horizontal page overflow');
    assert.ok(await evaluate(`document.getElementById('map').getBoundingClientRect().height>150`),'map visible');
    assert.ok(await evaluate(`document.querySelector('.map-wrap #show-zoning')!==null`),'zoning on map');
  }

  assert.ok(await evaluate(`document.getElementById('mobile-detail-panel').getBoundingClientRect().height>100`),'info card has visible content');
  assert.ok(await evaluate(`getComputedStyle(document.getElementById('mobile-detail-body')).display!=='none'`),'card body visible');
  const before=await evaluate(`document.querySelector('.map-zoning-toggle').getBoundingClientRect().top`);
  await evaluate(`document.getElementById('mobile-strip-toggle').click()`);
  assert.ok(await evaluate(`document.querySelector('.map-zoning-toggle').getBoundingClientRect().top`)>before,'zoning control moves down');

  await evaluate(`document.getElementById('mobile-details').click();document.getElementById('mobile-details').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.detail-reading-size').length`),0);
  assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.mobile-route-picker input')).fontSize)>=16`));
  await evaluate(`(()=>{const t=document.getElementById('transfers');t.replaceChildren(...Array.from({length:14},(_,i)=>{const b=document.createElement('button');b.className='connection-route';b.textContent=i;return b;}));})()`);
  await sleep(50);
  assert.equal(await evaluate(`document.querySelector('.connection-toggle').textContent`),'Connections (14) ▾');
  assert.ok(await evaluate(`document.getElementById('connection-list').hidden`));
  const height=await evaluate(`document.querySelector('.stop-card-footer').getBoundingClientRect().height`);
  await evaluate(`document.querySelector('.connection-toggle').click()`);
  assert.equal(await evaluate(`document.getElementById('connection-list').hidden`),false);
  assert.equal(await evaluate(`document.querySelector('.stop-card-footer').getBoundingClientRect().height`),height);
  await evaluate(`document.querySelector('.connection-toggle').click()`);
  assert.ok(await evaluate(`document.getElementById('connection-list').hidden`));
  await evaluate(`document.querySelector('.connection-toggle').click();document.getElementById('connection-list').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.ok(await evaluate(`document.getElementById('connection-list').hidden`),'Escape closes connections');
  assert.ok(await evaluate(`document.activeElement===document.querySelector('.connection-toggle')`),'focus returns to drawer control');
  for(const count of [4,0,5]){
    await evaluate(`document.getElementById('transfers').replaceChildren(...Array.from({length:${count}},(_,i)=>{const b=document.createElement('button');b.className='connection-route';b.textContent=i;return b;}))`);
    await sleep(50);
    assert.equal(await evaluate(`document.querySelector('.stop-card-footer').hidden`),count===0);
    assert.equal(await evaluate(`document.querySelector('.stop-card-footer .connection-toggle')!==null`),count>4);
  }
  await evaluate(`document.getElementById('mobile-close-details').click();document.querySelector('.mobile-route-picker').open=true;const input=document.querySelector('.mobile-route-picker input');input.focus();input.value='First Hill';input.dispatchEvent(new Event('input'));document.querySelector('.mobile-route-picker>div:last-child>button').click()`);
  assert.ok(await evaluate(`document.activeElement!==document.querySelector('.mobile-route-picker input')`),'route selection blurs search');
  assert.equal(await evaluate(`document.querySelector('.mobile-route-picker').open`),false);
  assert.ok(await evaluate(`!document.querySelector('meta[name=viewport]').content.match(/user-scalable=no|maximum-scale=1/)`),'browser zoom remains available');
  console.log('Search focus, accessible zoom, compact controls and connection boundary cases passed');
  const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/route-mobile-update.png',Buffer.from(shot.data,'base64'));
  assert.deepEqual(exceptions,[]);console.log('Mobile layout and controls passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
