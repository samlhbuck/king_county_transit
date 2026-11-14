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

  assert.equal(await evaluate(`document.querySelectorAll('.reset-screen-zoom').length`),0,'no recovery button');
  const meta=await evaluate(`document.querySelector('meta[name=viewport]').content`);
  const focusCheck=await evaluate(`(()=>{
    document.querySelector('.mobile-route-picker').open=true;
    const input=document.querySelector('.mobile-route-picker input'),original=input.focus;
    let options;input.focus=function(value){options=value;return original.call(this,value);};
    const tap=new PointerEvent('pointerdown',{pointerType:'touch',isPrimary:true,bubbles:true,cancelable:true});input.dispatchEvent(tap);
    const result={preventScroll:options?.preventScroll,focused:document.activeElement===input,cancelled:tap.defaultPrevented};
    const second=new PointerEvent('pointerdown',{pointerType:'touch',isPrimary:true,bubbles:true,cancelable:true});input.dispatchEvent(second);result.secondCancelled=second.defaultPrevented;
    input.focus=original;input.blur();return result;
  })()`);
  assert.deepEqual(focusCheck,{preventScroll:true,focused:true,cancelled:true,secondCancelled:false});

  await evaluate(`window.headerMoves=0;window.observer=new MutationObserver(records=>{for(const r of records)for(const n of r.removedNodes)if(n.classList?.contains('route-tools'))headerMoves++;});observer.observe(document.body,{childList:true});`);
  for(let iteration=0;iteration<3;iteration++){
    await evaluate(`document.querySelector('.mobile-route-picker').open=true;var search=document.querySelector('.mobile-route-picker input');search.focus();search.value='First Hill';search.dispatchEvent(new Event('input'));search.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`);
    await sleep(250);
    await evaluate(`document.getElementById('mobile-details').click();document.getElementById('mobile-detail-body').scrollTop=300;document.getElementById('mobile-close-details').click();document.querySelector('.stop-marker').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.getElementById('mobile-close-details').click();window.scrollTo(100,300)`);
    await sleep(150);
    assert.ok(await evaluate(`scrollX===0&&scrollY===0`),'document cannot drift');
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight`),'no blank document overflow');
    for(const selector of ['.zoom','.mobile-nav','.route-tools','.map-framing','#frontage-lens']){
      assert.ok(await evaluate(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})()`),selector+' stays in frame');
    }
  }
  assert.equal(await evaluate(`headerMoves`),0,'opening panels does not remount route controls');
  await send('Emulation.setPageScaleFactor',{pageScaleFactor:1.5});
  await evaluate(`document.getElementById('mobile-details').click();document.getElementById('mobile-close-details').click()`);
  await sleep(200);
  assert.ok(await evaluate(`visualViewport.scale>1.4`),'deliberate zoom preserved');
  assert.equal(await evaluate(`document.querySelector('meta[name=viewport]').content`),meta,'no forced viewport scaling');
  assert.deepEqual(exceptions,[]);
  console.log('Repeated mobile interactions preserve document bounds, map controls and deliberate browser zoom');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
