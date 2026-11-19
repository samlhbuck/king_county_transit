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

  const results=[];
  for(const [width,height,mobile] of [[390,844,true],[844,390,false],[1280,844,false]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await sleep(150);
    for(const [place,box] of [['Seattle',[-122.45,47.35,-122.15,47.85]],['RapidRide F area',[-122.4,47.4,-122.16,47.51]],['Capitol Hill',[-122.34,47.59,-122.29,47.64]]]){
      await evaluate(`(()=>{const m=contextTest.map,box=${JSON.stringify(box)};const merc=(lon,lat)=>[6378137*lon*Math.PI/180,6378137*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))];const a=m.xy(merc(box[0],box[3])),b=m.xy(merc(box[2],box[1]));const r=m.node.getBoundingClientRect();m.view=fittedRouteView([...a,...b],r.width,r.height,[0,0,r.width,r.height],0);m.setView();})()`);
      for(const mode of ['baseline','square','calibrated']){
        const result=await evaluate(`(()=>{const c=contextTest;c.config.mode='${mode}';c.debug=true;const start=performance.now();c.update();const ms=performance.now()-start;const g=c.analysis.grid;const f=c.routes.find(r=>c.actions.describe(r.id)?.name==='F Line');const fResult=f&&c.analysis.results.get(f.id);return {mode:c.config.mode,shown:c.visibleIds.size,rows:g.rows,cols:g.cols,w:g.w,h:g.h,ms,F:fResult?{candidate:fResult.candidate,eligible:fResult.passes,span:fResult.maxSpan,share:fResult.spanFraction}:null,selectedHidden:c.nodes.get(c.map.data.routeId)?.style.opacity==='0'};})()`);
        assert.ok(result.selectedHidden,'active route is not duplicated');
        if(mode!=='baseline')assert.equal(result.w,result.h,'square screen cells');
        assert.ok(await evaluate(`!document.getElementById('context-grid-metrics').hidden`));
        assert.ok(await evaluate(`[...contextTest.visibleIds].every(id=>contextTest.nodes.get(id).getAttribute('tabindex')==='0')`),'eligible lines remain selectable');
        results.push({width,place,...result});
      }
    }
  }
  console.log(JSON.stringify(results,null,2));
  const city=results.find(r=>r.width===390&&r.place==='Seattle'&&r.mode==='square');
  const local=results.find(r=>r.width===390&&r.place==='RapidRide F area'&&r.mode==='square');
  assert.ok(city.F&&local.F,'RapidRide F cache available');
  assert.ok(local.F.share>city.F.share,'local service geography has greater relative spatial reach');
  assert.equal(city.F.eligible,false,'small far-zoomed F fragment not eligible');
  assert.equal(local.F.eligible,true,'F becomes eligible in its own service geography');
  assert.deepEqual(exceptions,[]);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();chrome.kill();});
