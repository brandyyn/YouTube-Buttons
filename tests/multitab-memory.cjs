/* Installed-extension tab fixture; measurements exclude native decoder/GPU RAM. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const fixture='<title>Memory fixture - YouTube</title><style>.ytp-right-controls{display:flex;height:44px}.ytp-button{height:44px;width:44px}</style><div id="player"><div id="movie_player" class="html5-video-player"><video></video><div class="ytp-right-controls"></div></div></div>';
const median=values=>values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];
(async()=>{
 const extension=path.join(root,'chrome');
 const context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 try{
  await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:fixture}));
  const tabs=[];
  for(let i=0;i<12;i++){
   const page=await context.newPage();await page.goto('https://www.youtube.com/'+(i<8?'watch?v=memory'+i:'results?search_query=memory'));
   if(i<8)await page.locator('.yb-controls').waitFor();
   const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');
   const initial=(await cdp.send('Runtime.getHeapUsage')).usedSize;
   await cdp.send('Profiler.enable');await cdp.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});await cdp.send('Profiler.takePreciseCoverage');
   tabs.push({page,cdp,initial});
  }
  await new Promise(resolve=>setTimeout(resolve,5000));
  const idle=[];
  for(const {cdp} of tabs){const {result}=await cdp.send('Profiler.takePreciseCoverage');idle.push(result.filter(script=>script.url.startsWith('chrome-extension://')&&/\/src\/(content|settings)\.js$/.test(script.url)).reduce((sum,script)=>sum+script.functions.reduce((n,fn)=>n+fn.ranges[0].count,0),0));await cdp.send('Profiler.stopPreciseCoverage');}
  assert(idle.every(count=>count===0),'Idle tabs must execute no extension content functions');
  const cycles=[];
  for(let round=0;round<5;round++){
   for(let i=0;i<tabs.length;i++){
    const {page,cdp}=tabs[i];await page.goto('https://www.youtube.com/'+(i<8?'watch?v=memory'+i+'round'+round:'results?search_query=memory'+round));
    if(i<8)await page.locator('.yb-controls').waitFor();
    assert.equal(await page.locator('.yb-controls').count(),i<8?1:0,'Exactly one toolbar on supported pages');
    await cdp.send('HeapProfiler.collectGarbage');
   }
   cycles.push({round:round+1,heapBytes:await Promise.all(tabs.map(async({cdp})=>(await cdp.send('Runtime.getHeapUsage')).usedSize))});
  }
  for(let i=0;i<tabs.length;i++)assert(cycles.at(-1).heapBytes[i]<=cycles[0].heapBytes[i]+65536,'Repeated navigation must not accumulate document heaps');
  const result={scope:'Installed Chromium extension on 12 synthetic YouTube tabs; entire renderer JS heaps, not extension-only or native/browser RAM',tabs:12,watchTabs:8,browseTabs:4,idleFunctionCalls:idle,initialMedianHeap:median(tabs.map(tab=>tab.initial)),roundMedianHeaps:cycles.map(c=>median(c.heapBytes)),cycles};
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/multitab-memory.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
