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
  await send('Page.navigate',{url:(process.env.APP_URL || 'http://127.0.0.1:8000')+'/?offline=1&contextRoutes=1&routeGrid=1'});
  let ready=false;
  for(let i=0;i<300;i++){ready=await evaluate(`!!document.querySelector('#dashboard:not([hidden]) .stop-marker')`);if(ready)break;await sleep(100);}
  assert.ok(ready,'app loaded');
  for(let i=0;i<100;i++){if(await evaluate(`document.querySelectorAll('.context-routes path').length>0`))break;await sleep(100);}
  await evaluate(`(()=>{const proto=ContextRoutes.prototype,update=proto.update;proto.update=function(){window.contextTest=this;return update.call(this);};window.dispatchEvent(new Event('resize'));document.querySelector('.zoom button').click();})()`);
  await sleep(350);
  assert.ok(await evaluate(`contextTest.routes.length>0`));

  assert.equal(await evaluate(`contextTest.transferEnabled`),false,'transfer cue defaults off for independent comparison');
  if(process.env.TEST_WIDTH)await evaluate(`document.querySelector('.map-wrap').scrollIntoView({block:'center'})`);
  const target=await evaluate(`(()=>{const c=contextTest;c.filtered=false;c.update();return c.transferPoints.find(p=>c.nodes.has(p.routeId));})()`);
  assert.ok(target,'real cached shared-boarding connection available');
  await evaluate(`window.transferTarget=${JSON.stringify(target)};document.getElementById('context-transfer-emphasis').click();const p=contextTest.map.profileChoices.find(p=>p.id===contextTest.map.activeProfileId);document.getElementById('frontage-position').value=transferTarget.distanceFeet/p.lengthFeet*1000;document.getElementById('frontage-position').dispatchEvent(new Event('input'))`);
  await sleep(700);
  assert.ok(await evaluate(`contextTest.transferWeights.get(transferTarget.routeId)>.99`),'real scrub progress reaches shared boarding connection');
  assert.ok(await evaluate(`contextTest.visibleIds.has(transferTarget.routeId)`),'connecting geometry is visible at this cached stop');
  assert.ok(await evaluate(`Number(contextTest.nodes.get(transferTarget.routeId).getAttribute('stroke-width'))>2.9`),'cue increases line weight');
  assert.match(await evaluate(`contextTest.nodes.get(transferTarget.routeId).getAttribute('stroke')`),/hsl/,'cue increases saturation');
  await evaluate(`contextTest.debug=false;contextTest.update()`);
  await sleep(200);
  const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/route-lens-transfer-'+(process.env.TEST_WIDTH||390)+'.png',Buffer.from(shot.data,'base64'));
  await evaluate(`document.getElementById('frontage-position').dispatchEvent(new Event('change'));window.beforeTransferState=JSON.stringify({view:contextTest.map.view,position:document.getElementById('frontage-position').value,route:contextTest.map.data.routeId});window.transferVisible=[...contextTest.visibleIds];document.getElementById('context-transfer-emphasis').click();contextTest.update()`);
  assert.equal(await evaluate(`contextTest.nodes.get(transferTarget.routeId).getAttribute('stroke-width')`),'2','baseline restored');
  assert.equal(await evaluate(`JSON.stringify({view:contextTest.map.view,position:document.getElementById('frontage-position').value,route:contextTest.map.data.routeId})`),await evaluate(`beforeTransferState`),'comparison preserves exploration');
  assert.deepEqual(await evaluate(`[...contextTest.visibleIds]`),await evaluate(`transferVisible`),'no eligibility changes');
  await evaluate(`document.getElementById('context-transfer-emphasis').click();contextTest.nodes.get(transferTarget.routeId).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  assert.ok(await evaluate(`!!document.getElementById('context-route-preview')`),'emphasized route is discoverable by keyboard');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  assert.ok(await evaluate(`contextTest.transferWeights.get(transferTarget.routeId)>.99`),'cue remains after preview dismissal for rediscovery');
  // Same screen location cannot override along-traversal distance.
  await evaluate(`contextTest.setTransferProgress(transferTarget.distanceFeet+1000000)`);
  assert.equal(await evaluate(`contextTest.transferWeights.size`),0,'cue fades away outside traversal range');
  await evaluate(`contextTest.setTransferProfile(contextTest.map.data,null)`);
  assert.equal(await evaluate(`contextTest.transferPoints.length`),0,'missing/switched profile clears prior evidence');
  assert.deepEqual(exceptions,[]);
  console.log('Real shared-stop scrub cue, saturation, reversible styling, eligibility, keyboard preview and rediscovery passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
