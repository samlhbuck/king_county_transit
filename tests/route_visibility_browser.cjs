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
  async function checkDescription(expected) {
    const state=()=>evaluate(`JSON.stringify({route:contextTest.map.data.routeId,view:contextTest.map.view,direction:document.getElementById('direction').value,position:document.getElementById('frontage-position').value,lens:document.getElementById('profile-lens-mode').getAttribute('aria-pressed'),zoning:document.getElementById('show-zoning').checked,back:document.getElementById('back-route').textContent})`);
    const before=await state();
    if(!process.env.TEST_WIDTH)await evaluate(`document.getElementById('mobile-details').click()`);
    for(let i=0;i<2;i++){
      await evaluate(`document.querySelector('#active-route-description summary').click()`);
      assert.ok(await evaluate(`document.getElementById('active-route-description').open`),'reopenable active summary');
      assert.equal(await evaluate(`document.getElementById('active-route-description-text').textContent`),expected);
      await evaluate(`document.querySelector('#active-route-description summary').click()`);
    }
    if(!process.env.TEST_WIDTH)await evaluate(`document.getElementById('mobile-close-details').click()`);
    await evaluate(`document.dispatchEvent(new Event('general-guide-request'))`);
    assert.equal(await evaluate(`document.getElementById('guide-route-description').textContent`),expected,'guide has same catalog description');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    assert.equal(await state(),before,'description and guide preserve all exploration state');
  }
  await checkDescription(await evaluate(`routeDescription(contextTest.actions.describe(contextTest.map.data.routeId))`));

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

  // Deterministic overlapping geometry; use real selection/back handlers with a
  // route payload fixture so this test does not depend on remote route analysis.
  await evaluate(`(()=>{
    const c=contextTest,m=c.map;window.originalRoute=m.data.routeId;
    window.originalView=[...m.view];window.originalFraction=document.getElementById('frontage-position').value;
    const ids=c.routes.filter(r=>r.id!==originalRoute&&c.actions.describe(r.id)).slice(0,2).map(r=>r.id);
    window.testRoute=ids[0];
    const box=m.node.getBoundingClientRect(),matrix=m.node.getScreenCTM().inverse();
    const center=new DOMPoint(box.left+box.width/2,box.top+box.height/2).matrixTransform(matrix);
    const a=m.inverse(center.x-50,center.y),b=m.inverse(center.x+50,center.y);
    c.routes=ids.map(id=>({id,paths:[[a,b]],bounds:[[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])]]}));
    c.filtered=false;c.attach();c.update();
    const payload=JSON.parse(JSON.stringify(m.data));payload.routeId=testRoute;
    const fetchOriginal=window.fetch;window.fetch=(url,options)=>String(url).includes('/api/data?route='+encodeURIComponent(testRoute))?Promise.resolve(new Response(JSON.stringify(payload),{status:200})):fetchOriginal(url,options);
    window.tapPoint=[box.left+box.width/2,box.top+box.height/2];
  })()`);
  await evaluate(`contextTest.map.didPan=false;contextTest.map.node.dispatchEvent(new PointerEvent('click',{bubbles:true,clientX:tapPoint[0],clientY:tapPoint[1],pointerType:${JSON.stringify(process.env.TEST_WIDTH?"mouse":"touch")}}))`);
  assert.equal(await evaluate(`document.querySelectorAll('#context-route-preview [data-route-id]').length`),2,'overlap chooser lists both routes');
  assert.equal(await evaluate(`document.querySelector('#context-route-preview>button:last-child').textContent`),'Explore route','no unverified transfer claim');
  assert.ok(await evaluate(`document.querySelector('#context-route-preview p').textContent.includes(routeDescription(contextTest.actions.describe(contextTest.previewId)))`),'preview uses the same description');
  await evaluate(`[...document.querySelectorAll('#context-route-preview [data-route-id]')].find(b=>b.dataset.routeId===testRoute).click();document.querySelector('#context-route-preview>button:last-child').click()`);
  for(let i=0;i<200;i++){if(await evaluate(`contextTest.map.data.routeId===testRoute&&!document.body.classList.contains('route-loading')`))break;await sleep(100);}
  assert.ok(await evaluate(`contextTest.map.data.routeId===testRoute`),'Explore activates route');
  await checkDescription(await evaluate(`routeDescription(contextTest.actions.describe(testRoute))`));
  assert.ok(await evaluate(`Number(document.getElementById('frontage-position').value)>0`),'handoff starts along route');
  assert.ok(await evaluate(`Math.abs(contextTest.map.view[2]-originalView[2])<.01`),'zoom preserved');
  assert.ok(await evaluate(`!document.getElementById('context-route-back').hidden`),'previous route action visible');
  await evaluate(`document.getElementById('context-route-back').click()`);
  for(let i=0;i<200;i++){if(await evaluate(`contextTest.map.data.routeId===originalRoute&&!document.body.classList.contains('route-loading')`))break;await sleep(100);}
  assert.ok(await evaluate(`contextTest.map.data.routeId===originalRoute`),'previous route restored');
  assert.deepEqual(await evaluate(`contextTest.map.view`),await evaluate(`originalView`),'previous viewport restored');
  assert.equal(await evaluate(`document.getElementById('frontage-position').value`),await evaluate(`originalFraction`),'previous scrub position restored');

  await evaluate(`contextTest.update();const node=[...contextTest.nodes.values()].find(n=>n.getAttribute('tabindex')==='0');node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  assert.ok(await evaluate(`!!document.getElementById('context-route-preview')`),'keyboard opens preview');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  assert.equal(await evaluate(`!!document.getElementById('context-route-preview')`),false,'Escape closes preview');
  await evaluate(`window.stopClicks=0;document.addEventListener('route-stop-selected',()=>stopClicks++);contextTest.map.didPan=false;document.querySelector('.stop-marker').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:tapPoint[0],clientY:tapPoint[1]}))`);
  assert.ok(await evaluate(`stopClicks>0`),'stop selection still works above contextual routes');
  assert.equal(await evaluate(`!!document.getElementById('context-route-preview')`),false,'stop click is not intercepted');
  await evaluate(`contextTest.map.didPan=false;document.querySelector('.project-marker').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:tapPoint[0],clientY:tapPoint[1]}))`);
  assert.equal(await evaluate(`!!document.getElementById('context-route-preview')`),false,'permit click is not intercepted');
  console.log('Overlap chooser, touch click, route activation, anchored scrubber, preserved zoom and previous route passed');
  await evaluate(`document.getElementById('route').value=testRoute;document.getElementById('route').dispatchEvent(new Event('change'))`);
  for(let i=0;i<200;i++){if(await evaluate(`contextTest.map.data.routeId===testRoute&&!document.body.classList.contains('route-loading')`))break;await sleep(100);}
  assert.ok(await evaluate(`contextTest.map.data.routeId===testRoute`),'ordinary selector activates route');
  await checkDescription(await evaluate(`routeDescription(contextTest.actions.describe(testRoute))`));
  await evaluate(`window.savedDescription={...contextTest.actions.describe(testRoute)};Object.assign(contextTest.actions.describe(testRoute),{description:'',long_name:''});document.getElementById('show-zoning').checked=true;document.getElementById('show-zoning').dispatchEvent(new Event('change'))`);
  await checkDescription('Route description and major destinations are unavailable.');
  await evaluate(`Object.assign(contextTest.actions.describe(testRoute),savedDescription)`);
  console.log('Active descriptions: contextual and ordinary selection, missing metadata, reopening and state preservation passed');
  await send('Page.navigate',{url:(process.env.APP_URL || 'http://127.0.0.1:8000')+'/?offline=1'});
  for(let i=0;i<300;i++){if(await evaluate(`!!document.querySelector('#dashboard:not([hidden]) .stop-marker')`))break;await sleep(100);}
  assert.equal(await evaluate(`document.querySelector('.context-routes')`),null,'default app has no contextual layer');
  assert.equal(await evaluate(`document.getElementById('route-visibility-controls')`),null,'default app has no experimental controls');
  assert.deepEqual(exceptions,[]);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
