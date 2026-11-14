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
    const view=await evaluate(`document.getElementById('map').getAttribute('viewBox')`);
    await evaluate(`document.getElementById('open-guide').click();document.getElementById('open-feedback').click()`);
    for(let i=0;i<100;i++){if(await evaluate(`!document.getElementById('feedback-submit').disabled`))break;await sleep(100);}
    assert.equal(await evaluate(`document.getElementById('feedback-dialog').open`),true);
    assert.equal(await evaluate(`document.getElementById('feedback-submit').disabled`),false,'durable backend is configured');
    assert.match(await evaluate(`document.getElementById('feedback-context').textContent`),/routeId: 23_102638/);
    await evaluate(`document.getElementById('feedback-include-context').click()`);
    assert.match(await evaluate(`document.getElementById('feedback-context').textContent`),/No route, stop or lens/);
    // Observe the submitted payload without changing the real submission.
    await evaluate(`window.feedbackRequests=[];window.realFetch=window.fetch;window.fetch=(url,options)=>{if(url==='/api/feedback'&&options?.method==='POST')feedbackRequests.push(JSON.parse(options.body));return realFetch(url,options);};document.getElementById('feedback-category').value='other';document.getElementById('feedback-text').value='Automated product-feedback verification (${mobile?'mobile':'desktop'})';document.getElementById('feedback-submit').click();`);
    for(let i=0;i<200;i++){if(await evaluate(`document.getElementById('feedback-status').textContent.includes('Feedback saved')`))break;await sleep(100);}
    assert.match(await evaluate(`document.getElementById('feedback-status').textContent`),/Feedback saved.*Receipt:/);
    assert.deepEqual(await evaluate(`feedbackRequests[0].context`),{});
    assert.equal(await evaluate(`document.getElementById('feedback-submit').disabled`),true,'no duplicate submit after confirmation');
    console.log('Receipt: '+await evaluate(`document.getElementById('feedback-status').textContent.split('Receipt: ')[1]`));
    await evaluate(`document.getElementById('close-feedback').click();document.getElementById('open-feedback').click()`);
    for(let i=0;i<100;i++){if(await evaluate(`!document.getElementById('feedback-submit').disabled`))break;await sleep(100);}
    await evaluate(`window.fetch=(url,options)=>options?.method==='POST'?Promise.resolve(new Response(JSON.stringify({error:'Simulated storage failure'}),{status:503,headers:{'Content-Type':'application/json'}})):realFetch(url,options);document.getElementById('feedback-category').value='bug';document.getElementById('feedback-text').value='Draft retained on error';document.getElementById('feedback-submit').click();`);
    await sleep(100);
    assert.match(await evaluate(`document.getElementById('feedback-status').textContent`),/Simulated storage failure/);
    assert.equal(await evaluate(`document.getElementById('feedback-text').value`),'Draft retained on error');
    await evaluate(`document.getElementById('close-feedback').click();document.getElementById('open-feedback').click()`);
    assert.equal(await evaluate(`document.getElementById('feedback-text').value`),'Draft retained on error','closing does not erase an unsent draft');
    await evaluate(`document.getElementById('feedback-text').focus({preventScroll:true});`);
    if(mobile)assert.ok(await evaluate(`parseFloat(getComputedStyle(document.getElementById('feedback-text')).fontSize)>=16`),'avoid focus zoom');
    assert.ok(await evaluate(`(()=>{const r=document.getElementById('feedback-dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`),'dialog fits viewport');
    await evaluate(`document.getElementById('close-feedback').click();document.getElementById('close-guide').click()`);
    assert.equal(await evaluate(`document.getElementById('map').getAttribute('viewBox')`),view,'feedback preserves map camera');
    if(mobile)assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight`));
  }
  assert.deepEqual(exceptions,[]);
  console.log('Feedback desktop/mobile: real storage receipts, optional context, error drafts, keyboard sizing and camera preservation passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
