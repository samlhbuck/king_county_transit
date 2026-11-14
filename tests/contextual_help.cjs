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
    await evaluate(`document.querySelectorAll('.frontage-stop')[3].click()`);
    const selected=await evaluate(`document.getElementById('stop').value`);
    assert.ok(selected);
    const camera=await evaluate(`document.getElementById('map').getAttribute('viewBox')`);
    const position=await evaluate(`document.getElementById('frontage-position').value`);
    assert.equal(await evaluate(`document.getElementById('mobile-detail-panel').hidden`),true,'single stop tap is selection only');
    await evaluate(`document.getElementById('open-guide').click()`);
    if(mobile)assert.equal(await evaluate(`document.getElementById('mobile-detail-panel').hidden`),false,'contextual help opens existing stop details');
    else assert.equal(await evaluate(`document.activeElement===document.querySelector('.workspace > aside')`),true);
    assert.equal(await evaluate(`document.getElementById('map').getAttribute('viewBox')`),camera);
    assert.equal(await evaluate(`document.getElementById('frontage-position').value`),position);
    await evaluate(`document.dispatchEvent(new Event('general-guide-request'))`);
    assert.equal(await evaluate(`document.getElementById('explore-guide').hidden`),false);
    assert.equal(await evaluate(`document.getElementById('mobile-detail-panel').hidden`),true);
    await evaluate(`document.getElementById('close-guide').click();document.getElementById('frontage-position').value=500;document.getElementById('frontage-position').dispatchEvent(new Event('input'));document.getElementById('open-guide').click();`);
    assert.equal(await evaluate(`document.getElementById('explore-guide').hidden`),false,'scrub progress does not become explicit stop inspection');
    await evaluate(`document.getElementById('close-guide').click();document.querySelectorAll('.frontage-stop')[3].click();document.querySelectorAll('.frontage-stop')[3].dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));`);
    if(mobile)assert.equal(await evaluate(`document.getElementById('mobile-detail-panel').hidden`),false,'deliberate double-click opens details');
    await evaluate(`document.getElementById('frontage-position').dispatchEvent(new Event('input'))`);
    assert.equal(await evaluate(`document.getElementById('mobile-detail-panel').hidden`),true,'scrubbing closes old details');
    await evaluate(`document.getElementById('frontage-position').dispatchEvent(new Event('change'));document.querySelector('.project-marker').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.getElementById('open-guide').click();`);
    assert.equal(await evaluate(`document.querySelector('#project-floating-card details').open`),true,'permit help reuses full permit provenance');
    await evaluate(`document.querySelector('#project-floating-card button').click()`);
    assert.equal(await evaluate(`document.getElementById('explore-guide').hidden`),false,'general guidance remains reachable from permit');
    await evaluate(`document.getElementById('close-guide').click();document.getElementById('profile-lens-mode').click();document.getElementById('frontage-position').dispatchEvent(new Event('input'));document.getElementById('open-guide').click();`);
    assert.equal(await evaluate(`document.getElementById('guide-title').textContent`),'About elevation');
    assert.match(await evaluate(`document.getElementById('guide-context').textContent`),/USGS 3DEP/);
    await evaluate(`document.getElementById('guide-general').click()`);
    assert.equal(await evaluate(`document.getElementById('guide-title').textContent`),'Explore the route');
    await evaluate(`document.getElementById('close-guide').click();document.querySelectorAll('.frontage-stop')[3].click();document.getElementById('open-guide').focus({preventScroll:true});`);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13,nativeVirtualKeyCode:36});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    if(mobile){
      assert.equal(await evaluate(`document.getElementById('mobile-detail-panel').hidden`),false,'keyboard help opens selected stop: '+await evaluate(`JSON.stringify({active:document.activeElement.id,stop:document.getElementById('stop').value,guide:document.getElementById('explore-guide').hidden})`));
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      assert.equal(await evaluate(`document.getElementById('mobile-detail-panel').hidden`),true,'Escape closes details');
      await evaluate(`document.getElementById('open-guide').click();document.getElementById('profile-lens-mode').click()`);
      assert.equal(await evaluate(`document.getElementById('mobile-detail-panel').hidden`),true,'lens change closes old details');
      await evaluate(`document.getElementById('open-guide').click();document.getElementById('route').value='23_100340';document.getElementById('route').dispatchEvent(new Event('change'))`);
      for(let i=0;i<300;i++){if(await evaluate(`!document.getElementById('route').disabled`))break;await sleep(100);}
      assert.equal(await evaluate(`document.getElementById('mobile-detail-panel').hidden`),true,'route change closes old details');
    }
    await evaluate(`document.getElementById('frontage-position').dispatchEvent(new Event('change'));document.getElementById('frontage-scrub-hit').scrollIntoView({block:'center'});`);
    const hit=await evaluate(`(()=>{const r=document.getElementById('frontage-scrub-hit').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
    assert.equal(hit.height,44);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:hit.x+hit.width*.2,y:hit.y+30,button:'left',buttons:1,clickCount:1});
    const start=Number(await evaluate(`document.getElementById('frontage-position').value`));
    assert.ok(Math.abs(start-200)<5,'lower invisible hit area starts a scrub');
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:hit.x+hit.width*.8,y:hit.y-25,button:'left',buttons:1});
    await sleep(100);
    assert.ok(Number(await evaluate(`document.getElementById('frontage-position').value`))>750,'pointer capture retains off-track drag: '+await evaluate(`JSON.stringify({value:document.getElementById('frontage-position').value,width:innerWidth,capture:document.getElementById('frontage-scrub-hit').hasPointerCapture(1),rect:document.getElementById('frontage-strip').getBoundingClientRect().toJSON()})`));
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:hit.x+hit.width*.8,y:hit.y-25,button:'left',buttons:0,clickCount:1});
    assert.equal(await evaluate(`document.getElementById('frontage-distance').hidden`),true);
    if(mobile)assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight`),'frame remains inside viewport');
  }
  assert.deepEqual(exceptions,[]);
  console.log('Desktop/mobile contextual help, intentional stop inspection, permit provenance, lens context and lower scrub capture passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
