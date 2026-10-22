const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
(async()=>{const b=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});try{
 const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('https://www.youtube.com/**',r=>r.fulfill({contentType:'text/html',body:'<div id="player"><div id="movie_player" class="html5-video-player"><video></video><div class="ytp-right-controls"><button class="ytp-button ytp-autonav-toggle"><div class="ytp-autonav-toggle-button-container"><div class="ytp-autonav-toggle-button" aria-checked="false"></div></div></button></div></div></div>'}));await p.goto('https://www.youtube.com/watch?v=memory');
 await p.evaluate(()=>{const listeners=new Set();window.chrome={storage:{local:{get:async()=>({settings:{eqEnabled:true}}),set:async()=>{}},onChanged:{addListener:f=>listeners.add(f)}},runtime:{onMessage:{addListener(){}}}};
 window.probe={media:[],sources:[],filters:[],gains:[],contexts:[],controls:[],icons:[]};
 const original=AudioContext;window.AudioContext=class extends original{constructor(...a){super(...a);probe.contexts.push(new WeakRef(this));}createMediaElementSource(...a){const n=super.createMediaElementSource(...a);probe.sources.push(new WeakRef(n));return n;}createBiquadFilter(){const n=super.createBiquadFilter();probe.filters.push(new WeakRef(n));return n;}createGain(){const n=super.createGain();probe.gains.push(new WeakRef(n));return n;}};
 });
 await p.addStyleTag({path:path.join(root,'src/content.css')});await p.addScriptTag({path:path.join(root,'src/settings.js')});await p.addScriptTag({path:path.join(root,'src/content.js')});await p.locator('.yb-compressor').waitFor();
 const cdp=await p.context().newCDPSession(p);const gc=async()=>{for(let i=0;i<3;i++){await cdp.send('HeapProfiler.collectGarbage');await p.waitForTimeout(50);}};
 await gc();const samples=[];
 for(let batch=0;batch<5;batch++){
 for(let i=0;i<20;i++){
 await p.locator('.yb-compressor').click();await p.waitForFunction(()=>document.querySelector('.yb-compressor').getAttribute('aria-pressed')==='true');
 await p.evaluate(()=>{const v=document.querySelector('video'),c=document.querySelector('.ytp-right-controls');const icon=c.querySelector('.yb-autoplay-icon');if(icon)probe.icons.push(new WeakRef(icon));probe.media.push(new WeakRef(v));probe.controls.push(new WeakRef(c));v.replaceWith(document.createElement('video'));const next=document.createElement('div');next.className='ytp-right-controls';next.innerHTML='<button class="ytp-button ytp-autonav-toggle"><div class="ytp-autonav-toggle-button-container"><div class="ytp-autonav-toggle-button" aria-checked="false"></div></div></button>';c.replaceWith(next);});
 await p.waitForFunction(()=>document.querySelector('.yb-compressor')?.getAttribute('aria-pressed')==='false');
 }
 await gc();samples.push({cycles:(batch+1)*20,heap:(await cdp.send('Runtime.getHeapUsage')).usedSize,...await p.evaluate(()=>Object.fromEntries(Object.entries(probe).map(([k,refs])=>[k,{created:refs.length,alive:refs.filter(r=>r.deref()).length}]))) });
 }
 await p.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));await gc();
 const teardown=await p.evaluate(()=>({toolbar:document.querySelectorAll('.yb-controls').length,contexts:probe.contexts.map(r=>r.deref()?.state??'collected')}));

 if(process.argv.includes('--retention-only')){
  for(const sample of samples){assert.equal(sample.media.alive+sample.sources.alive+sample.filters.alive+sample.gains.alive+sample.controls.alive+sample.icons.alive,0,'retired objects retained');assert.equal(sample.contexts.alive,1);}
  assert.deepEqual(errors,[]);assert.equal(teardown.toolbar,0);assert(teardown.contexts.every(state=>state==='closed'||state==='collected'));
  const result={scope:'Chromium forced-GC media/control replacement; screenshot phase excluded',samples,teardown,errors};fs.writeFileSync(path.join(root,'test-results', 'memory-retention-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));return;
 }
 const bytes=Array.from(fs.readFileSync(path.join(root,'test-results/youtube-buttons-tests/sample.webm')));
 await p.reload();await p.evaluate(()=>{const listeners=new Set();window.chrome={storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener:f=>listeners.add(f)}},runtime:{onMessage:{addListener(){}}}};window.imageURLs=new Map();const create=URL.createObjectURL,revoke=URL.revokeObjectURL;URL.createObjectURL=blob=>{const url=create(blob);if(blob.type==='image/png')imageURLs.set(url,blob.size);return url;};URL.revokeObjectURL=url=>{imageURLs.delete(url);revoke(url);};});
 await p.addStyleTag({path:path.join(root,'src/content.css')});await p.addScriptTag({path:path.join(root,'src/settings.js')});await p.addScriptTag({path:path.join(root,'src/content.js')});
 await p.evaluate(bytes=>{document.querySelector('video').src=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'video/webm'}));},bytes);await p.waitForFunction(()=>document.querySelector('video').readyState>=2);
 const screenshots=[];for(let i=0;i<12;i++){const download=p.waitForEvent('download');await p.locator('.yb-screenshot').click();const d=await download;await d.delete();await p.waitForFunction(()=>!document.querySelector('.yb-screenshot').disabled);screenshots.push(await p.evaluate(()=>({urls:imageURLs.size,bytes:[...imageURLs.values()].reduce((a,b)=>a+b,0)})));}
 await p.waitForFunction(()=>imageURLs.size===0,{},{timeout:15000});const expired=await p.evaluate(()=>imageURLs.size);
 assert(screenshots.every(s=>s.urls<=3));assert.equal(expired,0);
 const result={scope:'Chromium synthetic media replacement with forced GC; source injected with extension API shim, not live YouTube or browser total RAM',samples,teardown,screenshots,expired,errors};fs.writeFileSync(path.join(root,'test-results', 'memory-retention-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));assert.deepEqual(errors,[]);
 for(const s of samples){assert.equal(s.media.alive,0,'detached media retained');assert.equal(s.controls.alive,0,'old controls retained');assert.equal(s.icons.alive,0,'old autoplay icons retained');assert.equal(s.sources.alive+s.filters.alive+s.gains.alive,0,'old audio nodes retained');assert.equal(s.contexts.alive,1,'context count grows');}
 assert.equal(teardown.toolbar,0);assert(teardown.contexts.every(s=>s==='closed'||s==='collected'));
 }finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
