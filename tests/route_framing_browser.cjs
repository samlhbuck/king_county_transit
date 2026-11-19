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
const secondRoute = process.env.ELEVATION_TEST_ROUTE || '23_100340';
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




  for(const [width,height,mobile] of [[1280,900,false],[390,844,true]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
    await send('Page.navigate',{url:(process.env.APP_URL||'http://127.0.0.1:8018')+'/?offline=1'});
    for(let i=0;i<300;i++){if(await evaluate(`!!document.querySelector('#dashboard:not([hidden]) .stop-marker')`))break;await sleep(100);}
    await evaluate(`(()=>{const original=RouteMap.prototype.setView;RouteMap.prototype.setView=function(){window.testMap=this;return original.call(this);};document.getElementById('zoom-out').click();})()`);
    for(const route of ['40_100479','40_2LINE','23_102638']){
      await evaluate(`document.getElementById('route').value='${route}';document.getElementById('route').dispatchEvent(new Event('change'))`);
      for(let i=0;i<600;i++){if(await evaluate(`testMap.data.routeId==='${route}'&&!document.body.classList.contains('route-loading')`))break;await sleep(100);}
      assert.equal(await evaluate(`testMap.data.routeId`),route,'real cached route loaded');
      if(!mobile)await evaluate(`document.querySelector('.map-wrap').scrollIntoView({block:'center'})`);
      await evaluate(`document.getElementById('fit').click()`);

      async function assertFramed(){
        const result=await evaluate(`(()=>{
          const m=testMap,r=m.node.getBoundingClientRect(),c=m.node.getScreenCTM();
          const paths=m.data.route.flatMap(g=>g.type==='LineString'?[g.coordinates]:g.coordinates);
          const points=paths.flat().map(p=>{const [x,y]=m.xy(p);return new DOMPoint(x,y).matrixTransform(c);});
          const [l,t,rr,b]=m.routeFrameArea();
          return {area:[r.left+l,r.top+t,r.left+rr,r.top+b],line:[Math.min(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.x)),Math.max(...points.map(p=>p.y))],view:m.view};
        })()`);
        assert.ok(result.line[0]>=result.area[0]+23.9&&result.line[1]>=result.area[1]+23.9,JSON.stringify(result));
        assert.ok(result.line[2]<=result.area[2]-23.9&&result.line[3]<=result.area[3]-23.9,JSON.stringify(result));
        return result.view;
      }
      const fitted=await assertFramed();
      const shot=await send('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync('/tmp/route-lens-frame-'+width+'-'+route+'.png',Buffer.from(shot.data,'base64'));
      const state=await evaluate(`[document.getElementById('route').value,document.getElementById('direction').value,document.getElementById('frontage-position').value]`);
      await evaluate(`for(let i=0;i<15;i++)document.getElementById('zoom-out').click()`);
      const wide=await evaluate(`testMap.view[2]`);
      assert.ok(wide>=fitted[2]*1.9,'manual zoom reaches beyond full fit');
      await evaluate(`for(let i=0;i<40;i++)document.getElementById('zoom-in').click()`);
      assert.ok(await evaluate(`testMap.view[2]/testMap.scale<1500`),'return to neighborhood scale');
      assert.deepEqual(await evaluate(`[document.getElementById('route').value,document.getElementById('direction').value,document.getElementById('frontage-position').value]`),state,'frame and zoom preserve selection/progress');
      // Explicit framing must win over in-flight ride animation and endpoint dwell.
      await evaluate(`(()=>{const slider=document.getElementById('frontage-position');slider.value=1000;slider.dispatchEvent(new Event('input'));document.getElementById('fit').click();})()`);
      const settled=await evaluate(`[...testMap.view]`);
      await sleep(850);
      assert.deepEqual(await evaluate(`testMap.view`),settled,'endpoint linger cannot override Frame route');
      await assertFramed();
      assert.equal(await evaluate(`document.getElementById('frontage-position').value`),'1000','frame preserves scrub position');
      await evaluate(`document.getElementById('frontage-position').dispatchEvent(new Event('change'))`);
      if(mobile){
        await evaluate(`document.getElementById('mobile-details').click();document.getElementById('fit').click()`);
        await assertFramed();
        await evaluate(`document.getElementById('mobile-close-details').click();document.getElementById('mobile-strip-toggle').click();document.getElementById('fit').click()`);
        await assertFramed();
        await evaluate(`document.getElementById('mobile-strip-toggle').click()`);
      }
      console.log('Full route, manual zoom, neighborhood return, endpoint override and panels passed:',width,route);

    }
  }
  assert.deepEqual(exceptions,[]);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
