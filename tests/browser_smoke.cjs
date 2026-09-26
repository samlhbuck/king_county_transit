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
  await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false});
  await send('Page.navigate', {url: (process.env.APP_URL || 'http://127.0.0.1:8000') + '/?offline=1'});
  let ready = false;
  for (let i = 0; i < 150; i++) {
    ready = await evaluate(`!!document.querySelector('#dashboard:not([hidden]) .stop-marker')`);
    if (ready) break;
    await sleep(100);
  }
  assert.ok(ready, 'dashboard must load');
  assert.equal(await evaluate(`document.querySelectorAll('.stop-marker').length`), 10);
  assert.ok(await evaluate(`document.querySelectorAll('.project-marker').length>0`));
  assert.equal(await evaluate(`document.querySelectorAll('.ownership-areas path,.stop-marker text,.stop-summary-marker').length`),0);
  await evaluate(`document.getElementById('project-status').value='issued'; document.getElementById('project-status').dispatchEvent(new Event('change'))`);
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.status-badge')).every(n=>/issued/i.test(n.textContent))`));
  await evaluate(`document.getElementById('direction').selectedIndex=1; document.getElementById('direction').dispatchEvent(new Event('change'))`);
  assert.ok(await evaluate(`document.getElementById('direction').value.length>0`));
  await evaluate(`document.getElementById('reset').click()`);
  // Priorities 1–2: filter dialog, context, project selection, and departure order.
  await evaluate(`document.getElementById('edit-filters').click()`);
  assert.equal(await evaluate(`document.getElementById('filter-dialog').open`), true);
  await evaluate(`document.getElementById('close-filters').click()`);
  assert.equal(await evaluate(`document.getElementById('filter-dialog').open`), false);
  assert.match(await evaluate(`document.getElementById('active-context').textContent`), /Both \/ all directions.*Issued/);
  await evaluate(`document.querySelector('#project-rows .project-link').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.project-marker.selected-project').length`),1);
  assert.ok(await evaluate(`document.querySelectorAll('.top-stop').length>0`));
  assert.ok(await evaluate(`document.querySelector('.project-marker.selected-project').dataset.projectKey===document.querySelector('#project-rows .selected-project').dataset.projectKey`));
  assert.ok(await evaluate(`document.getElementById('map-project-info').textContent.length>0`));
  await evaluate(`document.getElementById('direction').selectedIndex=2;document.getElementById('direction').dispatchEvent(new Event('change'))`);
  assert.match(await evaluate(`document.getElementById('active-context').textContent`), /Pioneer Square/);
  assert.match(await evaluate(`document.querySelectorAll('#stop option')[1].textContent`), /Denny/);
  assert.match(await evaluate(`document.querySelector('#ranking .bar-label').textContent`), /Denny/);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#ranking .stop-number'),n=>Number(n.textContent))`),[1,2,3,4,5,6,7,8,9,10]);
  await evaluate(`document.getElementById('reset').click()`);
  const initialSummary = await evaluate(`document.getElementById('stop-summary').textContent`);
  await evaluate(`document.querySelectorAll('.stop-marker')[3].dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  assert.match(await evaluate(`document.getElementById('stop-full-name').textContent`), /12th & Jackson/);
  assert.notEqual(await evaluate(`document.getElementById('stop-summary').textContent`), initialSummary);
  assert.equal(await evaluate(`document.querySelectorAll('.stop-marker[aria-pressed="true"]').length`), 1);
  assert.equal(await evaluate(`document.querySelectorAll('.stop-marker text').length`),1);
  assert.ok(await evaluate(`document.querySelectorAll('#transfers .connection-route').length>0`));
  assert.match(await evaluate(`document.getElementById('transfer-note').textContent`), /Cached connections/);
  await evaluate(`document.getElementById('focus-stop').click()`);
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.project-marker')).every(n=>n.dataset.stopId===document.getElementById('stop').value)`));
  await evaluate(`document.getElementById('show-catchments').click()`);
  assert.ok(await evaluate(`document.querySelector('.catchment-spotlight').getAttribute('d').length>0`));

  // Transfer to a cached line, arrive at its closest stop, then restore the old view.
  const beforeTransfer = await evaluate(`({stop:document.getElementById('stop').value, view:document.getElementById('map').getAttribute('viewBox'), start:document.getElementById('start').value})`);
  const expectedTransferStop = await evaluate(`(async()=>{
    const source=await (await fetch('/api/data?route=23_102638')).json();
    const target=await (await fetch('/api/data?route=1_100039')).json();
    const origin=source.stops.find(s=>s.id===document.getElementById('stop').value);
    return target.stops.sort((a,b)=>Math.hypot(a.x-origin.x,a.y-origin.y)-Math.hypot(b.x-origin.x,b.y-origin.y))[0].id;
  })()`);
  await evaluate(`document.querySelector('#transfers [data-route-id="1_100039"]').click()`);
  for(let i=0;i<200;i++){if(await evaluate(`!document.getElementById('route').disabled`))break;await sleep(100);}
  assert.equal(await evaluate(`document.getElementById('route').value`),'1_100039');
  assert.equal(await evaluate(`document.getElementById('stop').value`),expectedTransferStop);
  assert.match(await evaluate(`document.getElementById('map-route-title').textContent`),/14/);
  assert.equal(await evaluate(`document.getElementById('back-route').hidden`),false);
  await evaluate(`document.getElementById('back-route').click()`);
  for(let i=0;i<200;i++){if(await evaluate(`!document.getElementById('route').disabled`))break;await sleep(100);}
  assert.equal(await evaluate(`document.getElementById('route').value`),'23_102638');
  assert.deepEqual(await evaluate(`({stop:document.getElementById('stop').value, view:document.getElementById('map').getAttribute('viewBox'), start:document.getElementById('start').value})`),beforeTransfer);
  assert.equal(await evaluate(`document.getElementById('back-route').hidden`),true);
  assert.ok(await evaluate(`(()=>{const svg=document.getElementById('map'), r=svg.getBoundingClientRect(), inv=svg.getScreenCTM().inverse(), p=new DOMPoint(r.left,r.top).matrixTransform(inv);const nums=document.querySelector('.catchment-spotlight').getAttribute('d').match(/-?[0-9]+(?:[.][0-9]+)?(?:e[+-]?[0-9]+)?/gi).map(Number);return Math.abs(nums[0]-p.x)<.01 && Math.abs(nums[1]-p.y)<.01})()`),'spotlight covers actual SVG viewport including letterboxing');
  assert.ok(await evaluate(`document.getElementById('ranking').scrollHeight>document.getElementById('ranking').clientHeight`));

  await evaluate(`document.getElementById('fit').click()`);

  await evaluate(`document.getElementById('metric').value='value'; document.getElementById('metric').dispatchEvent(new Event('change'))`);
  assert.match(await evaluate(`document.getElementById('ranking-title').textContent`), /value/);
  await evaluate(`document.getElementById('sidebar-metric').value='housing';document.getElementById('sidebar-metric').dispatchEvent(new Event('change')); document.getElementById('sort').value='desc'; document.getElementById('sort').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate(`document.getElementById('metric').value`), 'housing');
  assert.ok(await evaluate(`document.querySelectorAll('#ranking .units-added').length === 10 && document.querySelectorAll('#ranking .units-removed').length === 10`));
  const netValues = await evaluate(`Array.from(document.querySelectorAll('#ranking .chart-row b'), n => Number(n.textContent.replace(/[^0-9.-]/g,'')))`);
  assert.deepEqual(netValues, [...netValues].sort((a,b)=>b-a));
  const selectedBeforeSort = await evaluate(`document.getElementById('stop').value`);
  await evaluate(`document.getElementById('sort').value='asc'; document.getElementById('sort').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate(`document.getElementById('stop').value`), selectedBeforeSort);
  assert.ok(await evaluate(`document.querySelectorAll('#annual-chart .chart-row').length > 0`));
  const annualBeforeClick = await evaluate(`document.getElementById('annual-chart').textContent`);
  await evaluate(`document.querySelector('#ranking .chart-row').click()`);
  assert.match(await evaluate(`document.getElementById('annual-title').textContent`), /Development by issue year/);
  assert.ok(await evaluate(`document.getElementById('annual-title').textContent.includes(document.getElementById('selection-title').textContent)`));
  await evaluate(`document.getElementById('sidebar-metric').value='permits';document.getElementById('sidebar-metric').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate(`document.getElementById('metric').value`), 'permits');
  assert.equal(await evaluate(`document.querySelector('.housing-legend').hidden`), true);
  await evaluate(`document.getElementById('sidebar-metric').value='value';document.getElementById('sidebar-metric').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate(`document.getElementById('metric').value`), 'value');
  const view = await evaluate(`document.getElementById('map').getAttribute('viewBox')`);
  await evaluate(`document.getElementById('zoom-in').click()`);
  assert.notEqual(await evaluate(`document.getElementById('map').getAttribute('viewBox')`), view);
  await evaluate(`document.getElementById('fit').click(); document.getElementById('show-projects').click()`);
  assert.equal(await evaluate(`document.getElementById('map').getAttribute('viewBox')`), view);
  await evaluate(`document.getElementById('show-projects').click(); document.getElementById('start').value='2099-01-01'; document.getElementById('end').value='2099-12-31'; document.getElementById('end').dispatchEvent(new Event('change'))`);
  assert.match(await evaluate(`document.getElementById('project-rows').textContent`), /No development projects/);
  await evaluate(`document.getElementById('start').value='2100-01-01'; document.getElementById('start').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate(`document.getElementById('dashboard').hidden`), true);
  await evaluate(`document.getElementById('reset').click()`);
  assert.equal(await evaluate(`document.getElementById('dashboard').hidden`), false);
  assert.equal(await evaluate(`document.getElementById('stop-summary').textContent`), initialSummary);
  // Real cached routes that previously failed the equal-direction restriction.
  for (const [routeId, minimumStops] of [['1_102745', 15], ['1_100089', 54], ['1_100275', 41], ['1_100230', 20], ['40_100479', 20], ['40_2LINE', 10], ['23_102638', 10]]) {
    await evaluate(`document.getElementById('route').value='${routeId}'; document.getElementById('route').dispatchEvent(new Event('change'))`);
    let loaded = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      loaded = await evaluate(`!document.getElementById('route').disabled`);
      if (loaded) break;
      await sleep(100);
    }
    assert.ok(loaded, `route ${routeId} should load`);
    assert.equal(await evaluate(`document.getElementById('route').value`), routeId);
    assert.ok(await evaluate(`document.querySelectorAll('.stop-marker').length >= ${minimumStops}`));
    assert.equal(await evaluate(`document.getElementById('status').classList.contains('error')`), false);
    if (routeId === '40_100479' || routeId === '40_2LINE') {
      assert.equal(await evaluate(`document.getElementById('start').value`), routeId === '40_100479' ? '2009-07-18' : '2024-04-27');
      assert.equal(await evaluate(`document.querySelectorAll('.project-cluster,.stop-summary-marker,.stop-marker text').length`), 0);
      await evaluate(`document.querySelector('.stop-marker').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
      await evaluate(`document.getElementById('focus-stop').click()`);
      assert.ok(await evaluate(`document.querySelectorAll('.stop-marker circle').length > 0`));
      assert.ok(await evaluate(`document.querySelector('.stop-marker').getAttribute('transform').includes('scale(')`));
    }
    if (routeId === '1_102745') {
      assert.equal(await evaluate(`document.getElementById('start').value`), '2024-09-14');
      assert.equal(await evaluate(`document.querySelectorAll('.stop-marker').length`), 15);
      assert.equal(await evaluate(`document.querySelectorAll('#stop option').length`), 16);
      await evaluate(`document.querySelector('[data-preset="ytd"]').click()`);
      assert.ok(await evaluate(`document.getElementById('start').value.endsWith('-01-01')`));
      await evaluate(`document.querySelector('[data-preset="1y"]').click()`);
      assert.equal(await evaluate(`document.querySelector('[data-preset="1y"]').getAttribute('aria-pressed')`), 'true');
      await evaluate(`document.querySelector('[data-preset="5y"]').click()`);
      assert.equal(await evaluate(`document.querySelector('[data-preset="5y"]').getAttribute('aria-pressed')`), 'true');
      await evaluate(`document.getElementById('life-preset').click()`);
      assert.equal(await evaluate(`document.getElementById('start').value`), '2024-09-14');
    }
    if (routeId === '1_100275') {
      const names = await evaluate(`Array.from(document.querySelectorAll('#stop option'), o=>o.textContent)`);
      assert.ok(names.some(name=>name.includes('27th')));
      assert.ok(names.some(name=>name.includes('S Hill St / S Walker St')));
      await evaluate(`const target=Array.from(document.querySelectorAll('#stop option')).find(o=>o.textContent.includes('S Hill St / S Walker St')); document.getElementById('stop').value=target.value; document.getElementById('stop').dispatchEvent(new Event('change'))`);
      assert.match(await evaluate(`document.getElementById('selection-title').textContent`), /S Hill St \/ S Walker St/);
    }
    if (routeId === '1_100230') {
      const labels=await evaluate(`Array.from(document.querySelectorAll('#stop option'),n=>n.textContent)`);
      assert.ok(labels.includes('SW Hanford St'),'Route 50 omits California for its unique Hanford stop');
      assert.ok(labels.includes('California / Admiral'),'reversed Admiral intersection names collapse');
    }
    if (routeId === '1_100089') assert.equal(await evaluate(`document.getElementById('life-preset').disabled`), true);

    await evaluate(`document.querySelector('.stop-marker').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
    assert.equal(await evaluate(`document.querySelectorAll('.stop-marker[aria-pressed="true"]').length`), 1);
  }
  await evaluate(`document.getElementById('reset').click()`);
  const unauthorized = await evaluate(`fetch('/api/refresh?source=transit',{method:'POST'}).then(r=>r.status)`);
  assert.equal(unauthorized, 403);
  assert.equal(await evaluate(`fetch('/api/data?route=unknown').then(r=>r.status)`), 400);
  // Verify the refresh UI calls the intended endpoint without downloading live datasets.
  await evaluate(`window.originalFetch=window.fetch; window.fetch=async (url,options)=>{window.lastRequest={url,options}; return new Response(JSON.stringify({error:'Simulated download failure'}),{status:503,headers:{'Content-Type':'application/json'}})}; document.getElementById('refresh').click()`);
  await sleep(100);
  assert.match(await evaluate(`window.lastRequest.url`), /api\/refresh.*source=transit/);
  assert.match(await evaluate(`document.getElementById('status').textContent`), /previous route remains/);
  assert.equal(await evaluate(`document.querySelectorAll('.stop-marker').length`), 10);
  await evaluate(`window.fetch=window.originalFetch; document.getElementById('status').textContent='Browser interaction checks passed';`);
  assert.ok(await evaluate(`document.querySelectorAll('.status-badge').length > 0`));
  assert.ok(await evaluate(`document.getElementById('housing-cost').textContent.length > 0`));
  assert.ok(await evaluate(`document.getElementById('zoning-note').textContent.length > 0`));
  await evaluate(`document.getElementById('show-zoning').click()`);
  assert.equal(await evaluate(`document.querySelector('.zoning-layer').style.display`), '');
  await evaluate(`document.getElementById('status').className='';document.getElementById('map').scrollIntoView({block:'start'});document.querySelectorAll('.stop-marker')[3].dispatchEvent(new MouseEvent('click',{bubbles:true}));document.getElementById('focus-stop').click()`);
  assert.ok(await evaluate(`document.querySelector('#ranking .bar-label').getBoundingClientRect().width > 200`), 'stop chart should use the available width');
  // Real pointer movement: consecutive drags should produce equal map translations.
  const dragOrigin=await evaluate(`(()=>{const r=document.getElementById('map').getBoundingClientRect();return {x:r.right-100,y:r.top+150}})()`);
  const dragView=await evaluate(`document.getElementById('map').getAttribute('viewBox').split(' ').map(Number)`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:dragOrigin.x,y:dragOrigin.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:dragOrigin.x+20,y:dragOrigin.y,button:'left',buttons:1});
  const dragOne=await evaluate(`document.getElementById('map').getAttribute('viewBox').split(' ').map(Number)`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:dragOrigin.x+40,y:dragOrigin.y,button:'left',buttons:1});
  const dragTwo=await evaluate(`document.getElementById('map').getAttribute('viewBox').split(' ').map(Number)`);
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:dragOrigin.x+40,y:dragOrigin.y,button:'left',clickCount:1});
  assert.ok(Math.abs(dragOne[0]-dragView[0])>1,'drag moves map');
  assert.ok(Math.abs((dragTwo[0]-dragOne[0])-(dragOne[0]-dragView[0]))<.1,'drag remains anchored');
  assert.ok(await evaluate(`document.getElementById('map-route-title').getBoundingClientRect().top>=0`),'route identity stays visible');
  const shot = await send('Page.captureScreenshot', {format: 'png'});
  fs.writeFileSync('/tmp/route-explorer-desktop.png', Buffer.from(shot.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
  await sleep(100);
  await evaluate(`document.getElementById('map').scrollIntoView({block:'start'})`);
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), 'mobile page should not overflow horizontally');
  const mobile = await send('Page.captureScreenshot', {format: 'png'});
  fs.writeFileSync('/tmp/route-explorer-mobile.png', Buffer.from(mobile.data, 'base64'));
  assert.deepEqual(exceptions, []);
  console.log('Browser passed: load, map stop click, summaries, metric/date controls, empty and invalid ranges, reset, zoom, refresh error recovery, API validation, mobile layout.');
  console.log('Screenshots: /tmp/route-explorer-desktop.png and /tmp/route-explorer-mobile.png');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { socket?.close(); chrome.kill(); });
