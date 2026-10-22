/* Real Chromium lifecycle probe without attaching a debugger to the worker. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'youtube-buttons-lifecycle-'));
 const extension=path.join(root,'chrome');
 const child=spawn(chromium.executablePath(),['--headless=new','--no-sandbox','--no-first-run','--disable-default-apps','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'--disable-extensions-except='+extension,'--load-extension='+extension,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let socket;const pending=new Map();let id=0;
 try{
  const portFile=path.join(profile,'DevToolsActivePort');for(let i=0;!fs.existsSync(portFile);i++){if(i>100)throw Error('Browser did not start');await pause(100);}
  const [port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);
  socket=new WebSocket('ws://127.0.0.1:'+port+endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id){const waiter=pending.get(value.id);pending.delete(value.id);value.error?waiter.reject(Error(value.error.message)):waiter.resolve(value.result);}});
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const request={id:++id,method,params};if(sessionId)request.sessionId=sessionId;pending.set(id,{resolve,reject});socket.send(JSON.stringify(request));});
  let worker;for(let i=0;i<100;i++){worker=(await send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.endsWith('/src/background.js'));if(worker)break;await pause(100);}assert(worker,'Extension worker started');
  const extensionId=new URL(worker.url).host;
  const {targetId}=await send('Target.createTarget',{url:'chrome-extension://'+extensionId+'/src/popup.html'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  for(let i=0;i<100;i++){
   const ready=await send('Runtime.evaluate',{expression:'Boolean(globalThis.chrome?.storage?.local)',returnByValue:true},sessionId);
   if(ready.result?.value)break;
   if(i===99)throw Error('Extension page did not load: '+JSON.stringify(await send('Runtime.evaluate',{expression:'({url:location.href,title:document.title,text:document.body?.textContent.slice(0,200)})',returnByValue:true},sessionId)));await pause(100);
  }
  const seeded=await send('Runtime.evaluate',{expression:'chrome.storage.local.set({settings:{step:0.25},lastSpeed:1.5,compressionWanted:true})',awaitPromise:true,returnByValue:true},sessionId);
  assert(!seeded.exceptionDetails,'Local settings saved: '+JSON.stringify(seeded.exceptionDetails));
  await send('Target.detachFromTarget',{sessionId});await send('Target.closeTarget',{targetId});
  const started=Date.now();let stopped=false;
  for(let i=0;i<100;i++){
   await pause(1000);
   const running=(await send('Target.getTargets')).targetInfos.some(t=>t.type==='service_worker'&&t.url===worker.url);
   if(!running){stopped=true;break;}
  }
  assert(stopped,'Worker must stop after pending save and idle timeout');
  const idleMilliseconds=Date.now()-started;
  const reopened=await send('Target.createTarget',{url:'chrome-extension://'+extensionId+'/src/popup.html'});
  const attached=await send('Target.attachToTarget',{targetId:reopened.targetId,flatten:true});await pause(500);
  const stored=await send('Runtime.evaluate',{expression:'Promise.all([chrome.storage.sync.get(["settings","lastSpeed","compressionWanted"]),chrome.storage.local.get("syncPending"),chrome.alarms.getAll()])',awaitPromise:true,returnByValue:true},attached.sessionId);
  assert(!stored.exceptionDetails);const [cloud,local,alarms]=stored.result.value;
  assert.equal(cloud.settings.step,0.25);assert.equal(cloud.lastSpeed,1.5);assert.equal(cloud.compressionWanted,true);assert.equal(local.syncPending,undefined);assert.equal(alarms.length,0);
  const result={scope:'Installed Chromium; worker never debugger-attached',idleMilliseconds,workerUnloaded:true,pendingKeys:0,idleAlarms:0,cloud};
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/sync-lifecycle.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  await send('Browser.close');
 }finally{
  socket?.close();if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  if(path.dirname(profile)===os.tmpdir()&&path.basename(profile).startsWith('youtube-buttons-lifecycle-'))fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
