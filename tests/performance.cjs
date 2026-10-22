/* Reproducible development workloads, not a real-world FPS/RAM benchmark. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const pw = require('playwright');
const root = path.resolve(__dirname, '..');
const source = path.resolve(process.argv[2] || root);
const label = process.argv[3] || 'optimized';
const scratch = path.resolve(root, 'test-results/youtube-buttons-performance'); fs.mkdirSync(scratch, {recursive: true});
const results = [];
async function run(engine) {
  const browser = await pw[engine].launch({headless: true, ...(engine === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const page = await browser.newPage({acceptDownloads: true});
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await page.route('https://www.youtube.com/**',r=>r.fulfill({contentType:'text/html',body:'<title>Performance fixture - YouTube</title><div id="player"><div id="movie_player" class="html5-video-player"><video loop></video><div class="noise"></div><div class="ytp-right-controls"></div></div></div>'}));
    await page.goto('https://www.youtube.com/watch?v=perf');
    await page.evaluate(() => {
      const listeners = new Set(); let settings;
      window.chrome = {storage:{local:{get:async keys=>({settings}),set:async data=>{if (data.settings) {settings=data.settings;for(const fn of listeners)fn({settings:{newValue:settings}},'local');}}},onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}}};
      window.metrics={}; window.resetMetrics=()=>{window.metrics={queries:0,matches:0,domWrites:0,observerCalls:0,observerRecords:0,observerMilliseconds:0,connects:0,disconnects:0,resumes:0,suspends:0};};window.resetMetrics();
      for (const proto of [Element.prototype, Document.prototype]) { const original=proto.querySelector;proto.querySelector=function(...args){metrics.queries++;return original.apply(this,args);}; }
      const matches=Element.prototype.matches;Element.prototype.matches=function(...args){metrics.matches++;return matches.apply(this,args);};
      for(const method of ['append','prepend','insertBefore','removeChild','replaceChildren','setAttribute']){
        const proto=method==='insertBefore'||method==='removeChild'?Node.prototype:Element.prototype;
        const fn=proto[method];proto[method]=function(...args){metrics.domWrites++;return fn.apply(this,args);};
      }
      const descriptor=Object.getOwnPropertyDescriptor(Node.prototype,'textContent');
      Object.defineProperty(Node.prototype,'textContent',{...descriptor,set(value){metrics.domWrites++;return descriptor.set.call(this,value);}});
      const Original=MutationObserver;
      window.MutationObserver=class extends Original {constructor(fn){super((records,observer)=>{const start=performance.now();metrics.observerCalls++;metrics.observerRecords+=records.length;try{fn(records,observer);}finally{metrics.observerMilliseconds+=performance.now()-start;}});}};
      for(const [proto,method,key] of [[AudioNode.prototype,'connect','connects'],[AudioNode.prototype,'disconnect','disconnects'],[AudioContext.prototype,'resume','resumes'],[AudioContext.prototype,'suspend','suspends']]){const fn=proto[method];proto[method]=function(...args){metrics[key]++;return fn.apply(this,args);};}
      window.frames=async count=>{for(let i=0;i<count;i++)await new Promise(requestAnimationFrame);};
    });
    await page.addStyleTag({path:path.join(source,'src/content.css')});
    await page.addScriptTag({path:path.join(source,'src/settings.js')});
    await page.addScriptTag({path:path.join(source,'src/content.js')});
    await page.locator('.yb-faster').waitFor();
    let cdp, sampledAllocationBytes=null;
    if(engine==='chromium'){
      cdp=await page.context().newCDPSession(page);
      await cdp.send('HeapProfiler.startSampling',{samplingInterval:4096,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
    }
    const noChange=await page.evaluate(async()=>{
      resetMetrics();const start=performance.now();
      for(let i=0;i<120;i++){document.dispatchEvent(new Event('yt-player-updated'));await frames(2);}
      return {events:120,elapsedMilliseconds:performance.now()-start,...metrics};
    });
    if(cdp){
      const {profile}=await cdp.send('HeapProfiler.stopSampling');
      const functions = new Set(['render','updateSpeed','updateCompression','reconcile','schedule','relevant']);
      const totals={};
      function sum(node,owned=false){owned ||= functions.has(node.callFrame.functionName);if(owned){const name=node.callFrame.functionName||'(anonymous)';totals[name]=(totals[name]||0)+node.selfSize;}for(const child of node.children)sum(child,owned);}
      sum(profile.head);sampledAllocationBytes={total:Object.values(totals).reduce((a,b)=>a+b,0),byFunction:totals};
    }
    const noise=await page.evaluate(async()=>{
      const target=document.querySelector('.noise');resetMetrics();const start=performance.now();
      // 10,000 irrelevant player text updates; exclude fixture writes from the DOM-write count.
      for(let batch=0;batch<40;batch++){for(let i=0;i<250;i++){const span=document.createElement('span');span.textContent='noise';target.append(span);span.remove();}await frames(2);}
      return {insertions:10000,elapsedMilliseconds:performance.now()-start,...metrics};
    });
    const bytes=Array.from(fs.readFileSync(path.resolve(root,'test-results/youtube-buttons-tests/sample.webm')));
    await page.evaluate(bytes=>{document.querySelector('video').src=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'video/webm'}));},bytes);
    await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
    await page.locator('video').evaluate(v=>v.play());await page.locator('.yb-compressor').click();
    await page.waitForFunction(()=>document.querySelector('.yb-compressor').getAttribute('aria-pressed')==='true');
    const audio=await page.evaluate(async()=>{
      resetMetrics();
      for(let i=0;i<100;i++){await chrome.storage.local.set({settings:YBSettings.defaults()});await frames(1);}
      return {unchangedSettings:100,...metrics};
    });
    assert.equal(await page.locator('.yb-compressor').getAttribute('aria-pressed'),'true');
    if (label === 'optimized') {
      assert.equal(noChange.queries, 0, 'Unchanged player events must not query the DOM');
      assert.equal(noChange.domWrites, 0, 'Unchanged player events must not mutate the toolbar');
      assert.equal(noise.queries, 0, 'Irrelevant leaf mutations must not query subtrees');
      assert.equal(audio.connects + audio.disconnects + audio.resumes, 0, 'Unchanged settings must not churn the audio graph');
    }
    const idle=await page.evaluate(async()=>{resetMetrics();await new Promise(resolve=>setTimeout(resolve,2000));return {...metrics};});
    assert.deepEqual(errors,[]);
    const result={engine,noChange,noise,audio,idle,sampledAllocationBytes};results.push(result);console.log(JSON.stringify({label,...result}));
  } finally {await browser.close();}
}
(async()=>{for(const engine of ['chromium','firefox'])await run(engine);fs.writeFileSync(path.join(scratch,`${label}.json`),JSON.stringify({date:new Date().toISOString(),label,results},null,2));})().catch(error=>{console.error(error);process.exit(1);});
