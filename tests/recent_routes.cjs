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
  await evaluate(`(async()=>{window.originalRoute=document.getElementById('route').value;window.savedPayload=await (await fetch('/api/data?route='+originalRoute)).json();window.originalFetch=fetch;window.fetch=async (...args)=>{const url=String(args[0]);if(!url.startsWith('/api/data?'))return originalFetch(...args);const routeId=new URL(url,location.href).searchParams.get('route');return new Response(JSON.stringify({...savedPayload,routeId,projects:[],permits:[]}));};window.alternativeRoute=[...document.getElementById('route').options].find(o=>o.value!==originalRoute).value;document.getElementById('route').value=alternativeRoute;document.getElementById('route').dispatchEvent(new Event('change'));})()`);
  await sleep(600);
  assert.ok(await evaluate(`document.getElementById('stop-summary').textContent.includes('Development data unavailable')`));
  assert.equal(await evaluate(`document.getElementById('stop-summary').textContent.includes('$0')`),false);
  assert.ok(await evaluate(`document.querySelector('.recent-routes button')!==null`));
  await evaluate(`document.getElementById('comparison-measure').value='value';document.getElementById('comparison-measure').dispatchEvent(new Event('change'))`);
  assert.ok(await evaluate(`document.getElementById('comparison-title').textContent.includes('estimated construction value')`));
  await evaluate(`document.querySelector('.mobile-route-picker').open=true;document.querySelector('.recent-routes button').click()`);
  await sleep(600);
  assert.ok(await evaluate(`document.getElementById('route').value===originalRoute`));
  assert.equal(await evaluate(`document.querySelectorAll('.recent-routes button').length`),1);
  assert.ok(await evaluate(`!document.getElementById('stop-summary').textContent.includes('Development data unavailable')`));
  assert.deepEqual(exceptions,[]);
  console.log('Recent-route return, missing-data display and metric-specific chart labels passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
