/* Integration tests against a local YouTube-shaped fixture, never the user's profile. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const playwright = require('playwright');
const root = path.resolve(__dirname, '..');
const scratch = path.resolve(root, 'test-results/youtube-buttons-tests');
fs.mkdirSync(scratch, {recursive: true});
const results = [];
const fixture = `<!doctype html><title>Test video - YouTube</title><style>body{background:#17191e;color:white;font:16px system-ui;margin:40px}#movie_player{position:relative;width:900px;height:520px;background:#222}video{width:900px;height:470px}.ytp-right-controls{height:44px;display:flex;justify-content:flex-end;color:white}.ytp-button{background:transparent;border:0;color:white;height:44px;width:44px}h1{font-size:20px}</style><h1>YouTube Buttons · integration fixture</h1><div id="player"><div id="movie_player" class="html5-video-player"><video crossorigin="anonymous" loop></video><div class="ytp-right-controls"><button title="YouTube settings">⚙</button><button title="Fullscreen">⛶</button></div></div></div>`;
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); results.push(name); console.log('PASS', name); }
async function paintedCentresMatchHighlights(page) {
  return page.locator('.yb-button svg').evaluateAll(icons=>icons.every(svg=>{
    const button=svg.parentElement, r=button.getBoundingClientRect(), bg=getComputedStyle(button,'::before');
    const b=svg.getBBox(), p=new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(svg.getScreenCTM());
    return Math.abs(p.x-(r.x+parseFloat(bg.left)+parseFloat(bg.width)/2))<.01 && Math.abs(p.y-(r.y+parseFloat(bg.top)+parseFloat(bg.height)/2))<.01;
  }));
}
const shim = () => {
  const listeners = new Set();
  window.testStore = {settings:{style:'original',order:['compressor','slower','speed','faster','screenshot']}};
  window.testStorageGets = 0;
  window.chrome = {storage: {local: {
    get: async keys => { window.testStorageGets++; return Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(k => [k, window.testStore[k]])); },
    set: async values => { const changes = {}; for (const [k,v] of Object.entries(values)) { changes[k] = {oldValue: window.testStore[k],newValue:v}; window.testStore[k] = v; } for (const fn of listeners) fn(changes,'local'); }
  }, onChanged: {addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)}}};
  const messages=new Set();
  chrome.runtime={onMessage:{addListener:fn=>messages.add(fn),removeListener:fn=>messages.delete(fn)}};
  window.testSendAutoplay=message=>{let response;for(const fn of messages)fn(message,{},value=>response=value);return response;};
  window.testAutoplay=true;
  chrome.tabs={query:async()=>[{id:1}],sendMessage:async(id,message)=>{if(message.type==='yb-autoplay-set')testAutoplay=message.enabled;return {available:true,enabled:testAutoplay};}};
  const OriginalObserver = window.MutationObserver;
  const activeObservers = new Set();
  window.MutationObserver = class extends OriginalObserver {
    constructor(fn) { super(fn); this.owned = /records =>|player\?\.isConnected/.test(String(fn)); }
    observe(...args) { if (this.owned) activeObservers.add(this); return super.observe(...args); }
    disconnect() { activeObservers.delete(this); return super.disconnect(); }
  };
  const OriginalAudio = window.AudioContext;
  window.testAudio = [];
  window.testAudioGains = []; window.testCompressors = [];
  window.AudioContext = class extends OriginalAudio {
    constructor(...args) { super(...args); window.testAudio.push(new WeakRef(this)); }
    createGain() {const node=super.createGain();testAudioGains.push(new WeakRef(node));return node;}
    createDynamicsCompressor() {const node=super.createDynamicsCompressor();testCompressors.push(new WeakRef(node));return node;}
  };
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const urls = new Set();
  URL.createObjectURL = blob => { const value = originalCreate(blob); urls.add(value); return value; };
  URL.revokeObjectURL = value => { urls.delete(value); return originalRevoke(value); };
  window.testStats = () => ({observers: activeObservers.size, audio: window.testAudio.length, urls: urls.size});
};
async function media(page) {
  // Record a short, original audiovisual sample. No remote video or third-party assets.
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d'); ctx.fillStyle='#243344';ctx.fillRect(0,0,640,360);ctx.fillStyle='#9de1ff';ctx.font='32px sans-serif';ctx.fillText('YouTube Buttons',180,175);
    const audio = new AudioContext(); await audio.resume();
    const oscillator = audio.createOscillator(), gain = audio.createGain(), dest = audio.createMediaStreamDestination();
    gain.gain.value = .02; oscillator.connect(gain);gain.connect(dest);oscillator.start();
    const stream=canvas.captureStream(10);stream.addTrack(dest.stream.getAudioTracks()[0]);
    const recorder = new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus'}), chunks=[];
    recorder.ondataavailable=e=>chunks.push(e.data);
    const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
    await new Promise(resolve=>setTimeout(resolve,500));recorder.stop();await done;
    oscillator.stop();stream.getTracks().forEach(t=>t.stop());await audio.close();
    return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()));
  });
}
async function run(engine) {
  const browser = await playwright[engine].launch({headless:true, ...(engine==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
  const context = await browser.newContext({acceptDownloads:true,viewport:{width:1100,height:720}});
  await context.route('https://www.youtube.com/**', route => route.fulfill({contentType:'text/html',body:fixture}));
  const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://www.youtube.com/watch?v=fixture');
  const sample=await media(page);
  if(engine==='chromium')fs.writeFileSync(path.join(scratch,'sample.webm'),Buffer.from(sample));
  await page.evaluate(shim);
  await page.addStyleTag({path:path.join(root,'src/content.css')});
  await page.addScriptTag({path:path.join(root,'src/settings.js')});
  await page.addScriptTag({path:path.join(root,'src/content.js')});
  await page.waitForSelector('.yb-faster');
  await page.evaluate(data => { const v=document.querySelector('video');v.src=URL.createObjectURL(new Blob([new Uint8Array(data)],{type:'video/webm'})); },sample);
  await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
  const prefix=engine+': ';
  await page.addStyleTag({content:'.html5-video-player .ytp-button > svg {padding:8px 12px;box-sizing:content-box}'});
  check(prefix+'native padding cannot enlarge SVGs',await page.locator('.yb-slower svg').evaluate(e=>{const r=e.getBoundingClientRect();return [r.width,r.height];}),[28,28]);
  check(prefix+'fresh defaults match requested screenshot',await page.evaluate(()=>{const d=YBSettings.normalize({});return[d.order,d.step,d.audioBoost,d.compressionEnabled,d.compressionAmount,d.eqEnabled,d.compressionColor,d.style,Object.values(d.enabled).every(Boolean)];}),[['slower','speed','faster','compressor','screenshot'],.1,1,true,100,false,'#ff0000','new',true]);
  check(prefix+'fresh install has green custom swatch with red selected and live autoplay',await page.evaluate(()=>[undefined,{}].map(raw=>{const d=YBSettings.normalize(raw);return[d.customCompressionColor,d.compressionColorChoice,d.compactButtons,d.hideAutoplay,Object.hasOwn(d,'autoplayEnabled'),d.eq];})),Array(2).fill(['#4dff00','red',true,false,false,[0,0,0,0,0]]));
  check(prefix+'new defaults preserve existing saved choices',await page.evaluate(()=>{const d=YBSettings.normalize({customCompressionColor:'#123456',compressionColor:'#83d4ff',compressionColorChoice:'blue',step:.25,audioBoost:2,compressionAmount:37,eqEnabled:true,style:'original',compactButtons:false,hideAutoplay:true});return[d.customCompressionColor,d.compressionColor,d.compressionColorChoice,d.step,d.audioBoost,d.compressionAmount,d.eqEnabled,d.style,d.compactButtons,d.hideAutoplay];}),['#123456','#83d4ff','blue',.25,2,37,true,'original',false,true]);
  check(prefix+'SVGs stay inside button bounds',await page.locator('.yb-button svg').evaluateAll(nodes=>nodes.every(e=>{const r=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();return r.left>=b.left && r.right<=b.right && r.top>=b.top && r.bottom<=b.bottom;})),true);

  await page.evaluate(()=>document.querySelector('#movie_player').classList.add('ytp-delhi-modern','ytp-big-mode'));
  await page.addStyleTag({content:'.html5-video-player.ytp-delhi-modern.ytp-big-mode .ytp-right-controls .ytp-button::before {content:"";width:56px;height:56px;position:absolute}'});
  check(prefix+'native large-player highlight fits original hit target',await page.locator('.yb-slower').evaluate(e=>{const s=getComputedStyle(e,'::before');return [s.width,s.height];}),['32px','32px']);
  await page.addStyleTag({content:'.html5-video-player.ytp-big-mode .ytp-right-controls .ytp-button svg {position:relative;top:-2px;transform:translateY(-1px);vertical-align:top}'});
  check(prefix+'original controls share one vertical centre despite host offsets',await page.locator('.yb-controls').evaluate(group=>{const g=group.getBoundingClientRect(),center=g.y+g.height/2;return [...group.querySelectorAll('.yb-button,.yb-button svg')].every(e=>{const r=e.getBoundingClientRect();return Math.abs(r.y+r.height/2-center)<0.1;});}),true);
  check(prefix+'original hit area hugs icon',await page.locator('.yb-slower').evaluate(e=>{const r=e.getBoundingClientRect();return [r.width,r.height];}),[32,32]);
  check(prefix+'original off artwork centred on actual hover paint',await paintedCentresMatchHighlights(page),true);
  const nativeTransitions=await page.addStyleTag({content:'.ytp-button{transition:opacity .1s}.ytp-button svg,.ytp-button svg path{transition:color .4s,fill .4s,d .4s}'});
  check(prefix+'compressor rejects inherited colour and shape transitions',await page.locator('.yb-compressor').evaluate(button=>[button,button.firstElementChild,button.firstElementChild.firstElementChild].every(e=>{const s=getComputedStyle(e);return s.transitionProperty==='none'&&s.animationName==='none';})),true);
  await nativeTransitions.evaluate(e=>e.remove());
  check(prefix+'five ordered buttons',await page.locator('[data-yb]').evaluateAll(nodes=>nodes.map(n=>n.dataset.yb)),['compressor','slower','speed','faster','screenshot']);
  check(prefix+'no audio context before compression click',await page.evaluate(()=>testStats().audio),0);
  check(prefix+'initialization reads storage once',await page.evaluate(()=>testStorageGets),1);
  check(prefix+'outside-player clicks do no speed-menu ancestor searches',await page.evaluate(()=>{
    const original=Element.prototype.closest;let searches=0;
    Element.prototype.closest=function(...args){searches++;return original.apply(this,args);};
    document.querySelector('h1').click();Element.prototype.closest=original;return searches;
  }),0);

  await page.locator('.yb-faster').click();check(prefix+'speed increases',await page.locator('video').evaluate(v=>v.playbackRate),1.1);
  await page.locator('video').evaluate(v=>{v.playbackRate=1.75;});
  await page.waitForFunction(()=>document.querySelector('.yb-speed').textContent==='1.75');
  await page.locator('video').evaluate(v=>{v.dispatchEvent(new Event('canplaythrough'));v.dispatchEvent(new Event('loadedmetadata'));});
  check(prefix+'native speed survives media events',await page.locator('video').evaluate(v=>v.playbackRate),1.75);
  await page.locator('.yb-faster').click();check(prefix+'extension resumes from actual native speed',await page.locator('video').evaluate(v=>v.playbackRate),1.85);
  await page.locator('video').evaluate(v=>{v.playbackRate=2;});
  await page.waitForFunction(()=>document.querySelector('.yb-speed').textContent==='2.00');
  await page.locator('.yb-speed').click();
  await page.evaluate(()=>{
    history.replaceState({},'', '/watch?v=remembered-speed');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForTimeout(40);
  await page.locator('video').evaluate(v=>{v.dispatchEvent(new Event('loadstart'));v.playbackRate=2;});
  await page.waitForTimeout(20);
  await page.locator('video').evaluate(v=>{v.dispatchEvent(new Event('loadedmetadata'));v.playbackRate=2;});
  await page.waitForTimeout(20);
  await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('canplay')));
  await page.waitForFunction(()=>document.querySelector('.yb-speed').textContent==='1.00');
  check(prefix+'next video restores own saved speed over native cached 2x',await page.locator('video').evaluate(v=>v.playbackRate),1);
  check(prefix+'native transient does not overwrite remembered speed',await page.evaluate(()=>testStore.lastSpeed),1);
  await page.locator('video').evaluate(v=>{v.playbackRate=1.75;});
  await page.waitForFunction(()=>document.querySelector('.yb-speed').textContent==='1.75');
  await page.locator('video').evaluate(v=>v.dispatchEvent(new Event('canplay')));
  check(prefix+'ready video accepts native speed without enforcing saved speed',await page.locator('video').evaluate(v=>v.playbackRate),1.75);
  // Model YouTube's separate cached speed: selecting the cached preset is a no-op.
  await page.evaluate(() => {
    const menu = document.createElement('div'); menu.className = 'ytp-variable-speed-panel-content';
    menu.innerHTML = '<input class="ytp-speedslider" type="range" min="0.25" max="2" step="0.05" value="2"><button class="ytp-variable-speed-panel-preset-button"><span>2.0</span></button><button class="ytp-variable-speed-panel-preset-button"><span>3.0</span></button><button class="ytp-variable-speed-panel-increment-button">Decrease</button>';
    let cached = 2; const video = document.querySelector('video'); video.playbackRate = cached;
    menu.querySelector('button').onclick = () => { if (cached !== 2) {cached = 2;video.playbackRate = 2;} };
    menu.lastElementChild.onclick = () => {menu.firstElementChild.value = '1.95';cached = 1.95;video.playbackRate = cached;};
    document.querySelector('#movie_player').append(menu);
  });
  await page.waitForFunction(()=>document.querySelector('.yb-speed').textContent==='2.00');
  await page.locator('.yb-faster').click();
  check(prefix+'custom speed beyond native cached preset',await page.locator('video').evaluate(v=>v.playbackRate),2.1);
  await page.locator('.ytp-variable-speed-panel-preset-button').first().click();
  await page.waitForFunction(()=>document.querySelector('.yb-speed').textContent==='2.00');
  check(prefix+'reselecting cached native 2x restores media and label',await page.locator('video').evaluate(v=>v.playbackRate),2);
  await page.locator('.yb-faster').click();
  await page.locator('.ytp-variable-speed-panel-preset-button').nth(1).click();
  check(prefix+'Premium upsell is not enabled as a speed',await page.locator('video').evaluate(v=>v.playbackRate),2.1);
  await page.locator('.ytp-variable-speed-panel-increment-button').click();
  await page.waitForFunction(()=>document.querySelector('.yb-speed').textContent==='1.95');
  check(prefix+'native increment adopts value after its handler',await page.locator('video').evaluate(v=>v.playbackRate),1.95);
  await page.evaluate(()=>{document.querySelector('.ytp-variable-speed-panel-content').remove();const menu=document.createElement('div');menu.id='legacy-speed-fixture';menu.innerHTML='<div class="ytp-menuitem" role="menuitemradio">0.25</div><div class="ytp-menuitem" role="menuitemradio">Normal</div><div class="ytp-menuitem" role="menuitemradio" tabindex="0">2</div>';document.querySelector('#movie_player').append(menu);});
  await page.locator('#legacy-speed-fixture [role="menuitemradio"]').nth(2).press('Enter');
  await page.waitForFunction(()=>document.querySelector('.yb-speed').textContent==='2.00');
  check(prefix+'legacy native preset supports keyboard selection',await page.locator('video').evaluate(v=>v.playbackRate),2);
  await page.locator('#legacy-speed-fixture [role="menuitemradio"]').nth(1).click();
  await page.waitForFunction(()=>document.querySelector('.yb-speed').textContent==='1.00');
  check(prefix+'legacy native Normal restores 1x',await page.locator('video').evaluate(v=>v.playbackRate),1);
  await page.evaluate(()=>document.querySelector('#legacy-speed-fixture').remove());
  await page.locator('.yb-speed').click();check(prefix+'speed reset',await page.locator('video').evaluate(v=>v.playbackRate),1);
  await page.locator('.yb-slower').hover();
  await page.locator('.yb-tooltip:not([hidden])').waitFor();
  check(prefix+'YouTube-style Decelerate tooltip',await page.locator('.yb-tooltip').textContent(),'Decelerate');
  await page.evaluate(()=>{
    const css=document.createElement('style');css.id='tooltip-theme-fixture';
    css.textContent='.html5-video-player .ytp-tooltip{font:500 13px/15px Arial;color:rgb(238,238,238)}.html5-video-player .ytp-tooltip-bottom-text{padding:5px 9px;background:transparent;border-radius:8px;text-shadow:0 0 2px black}.html5-video-player.yb-test-legacy .ytp-tooltip-bottom-text{background:rgba(28,28,28,.9);border-radius:4px}';document.head.append(css);
    const native=document.createElement('div');native.id='native-tooltip-fixture';native.className='ytp-tooltip ytp-bottom';native.innerHTML='<div class="ytp-tooltip-text-wrapper"><div class="ytp-tooltip-bottom-text"><span class="ytp-tooltip-text">Native</span></div></div>';document.querySelector('#movie_player').append(native);
  });
  const nativeTooltipMatches=()=>page.evaluate(()=>{
    const style=e=>{const s=getComputedStyle(e);return [s.font,s.color,s.backgroundColor,s.padding,s.borderRadius,s.textShadow];};
    const ours=document.querySelector('.yb-tooltip'),native=document.querySelector('#native-tooltip-fixture');
    return JSON.stringify([style(ours),style(ours.querySelector('.ytp-tooltip-bottom-text'))])===JSON.stringify([style(native),style(native.querySelector('.ytp-tooltip-bottom-text'))]);
  });
  check(prefix+'tooltip follows native modern styling',await nativeTooltipMatches(),true);
  await page.locator('#movie_player').evaluate(e=>e.classList.add('yb-test-legacy'));
  check(prefix+'tooltip follows native legacy styling',await nativeTooltipMatches(),true);
  check(prefix+'highlight uses native rounded shape',await page.locator('.yb-slower').evaluate(e=>getComputedStyle(e,'::before').borderRadius),'40px');
  await page.evaluate(()=>{document.querySelector('#movie_player').classList.remove('yb-test-legacy');document.querySelector('#native-tooltip-fixture').remove();document.querySelector('#tooltip-theme-fixture').remove();});
  check(prefix+'browser tooltip removed',await page.locator('.yb-slower').getAttribute('title'),null);
  await page.locator('.yb-speed').hover();
  check(prefix+'Reset tooltip',await page.locator('.yb-tooltip').textContent(),'Reset');
  check(prefix+'number has hover highlight',await page.locator('.yb-speed').evaluate(e=>getComputedStyle(e,'::before').backgroundColor),'rgba(255, 255, 255, 0.1)');
  check(prefix+'speed controls have tight equal gaps',await page.locator('.yb-controls').evaluate(g=>{const a=g.querySelector('.yb-slower').getBoundingClientRect(),b=g.querySelector('.yb-speed').getBoundingClientRect(),c=g.querySelector('.yb-faster').getBoundingClientRect();return Math.abs(b.left-a.right)<.1 && Math.abs(c.left-b.right)<.1;}),true);
  await page.locator('.yb-faster').hover();check(prefix+'Accelerate tooltip',await page.locator('.yb-tooltip').textContent(),'Accelerate');
  await page.locator('.yb-faster').click({modifiers:['Shift']});check(prefix+'Shift step',await page.locator('video').evaluate(v=>v.playbackRate),1.2);
  await page.locator('.yb-slower').click({modifiers:['Control']});check(prefix+'Ctrl half step',await page.locator('video').evaluate(v=>v.playbackRate),1.15);
  await page.locator('.yb-faster').click({modifiers:['Control']});
  await page.evaluate(()=>chrome.storage.local.set({settings:{...YBSettings.defaults(),step:.05}}));
  await page.locator('.yb-faster').click({modifiers:['Control']});check(prefix+'half of smallest step preserves precision',await page.locator('video').evaluate(v=>v.playbackRate),1.225);
  await page.locator('.yb-slower').click({modifiers:['Control']});
  await page.evaluate(()=>chrome.storage.local.set({settings:YBSettings.defaults()}));
  await page.evaluate(()=>{document.title='(2) Test video - YouTube';const OriginalDate=Date;window.Date=class extends OriginalDate{constructor(...args){if(args.length)super(...args);else super(2026,9,20,1,5,9);}};});
  const downloadPromise = page.waitForEvent('download'); await page.locator('.yb-screenshot').click(); const download=await downloadPromise;
  check(prefix+'filename strips notifications and uses local capture date/time',download.suggestedFilename(),'Test video 2026-10-20 01-05-09.png');
  await download.saveAs(path.join(scratch,`${engine}-frame.png`));
  const png=fs.readFileSync(path.join(scratch,`${engine}-frame.png`));check(prefix+'screenshot full frame 640 × 360',[png.readUInt32BE(16),png.readUInt32BE(20)],[640,360]);
  await page.evaluate(()=>{const metadata=document.createElement('ytd-watch-metadata');const heading=document.createElement('h1');heading.textContent='(2) Real title - YouTube';metadata.append(heading);document.body.append(metadata);});
  const headingDownload=page.waitForEvent('download');await page.locator('.yb-screenshot').click();
  check(prefix+'actual video heading preserves genuine title text',(await headingDownload).suggestedFilename(),'(2) Real title - YouTube 2026-10-20 01-05-09.png');
  await page.evaluate(()=>document.querySelector('ytd-watch-metadata').remove());
  await page.locator('video').evaluate(v=>v.play());
  await page.locator('.yb-compressor').click();await page.waitForFunction(()=>document.querySelector('.yb-compressor').getAttribute('aria-pressed')==='true');
  for(let i=0;i<10;i++) await page.locator('.yb-compressor').click();
  check(prefix+'compression toggles reuse one context',await page.evaluate(()=>testStats().audio),1);
  await page.locator('.yb-compressor').hover();
  check(prefix+'audio hover shows native V shortcut badge',await page.locator('.yb-tooltip .ytp-tooltip-keyboard-shortcut:not([hidden])').allTextContents(),['V']);
  check(prefix+'audio shortcuts exposed to accessibility APIs',await page.locator('.yb-compressor').getAttribute('aria-keyshortcuts'),'V');
  const nativeTooltipTransform=await page.addStyleTag({content:'.html5-video-player .ytp-tooltip {transform:none!important}'});
  await page.locator('.yb-speed').hover();await page.locator('.yb-compressor').hover();
  check(prefix+'whole tooltip including shortcut badges centred under native transform rule',await page.locator('.yb-compressor').evaluate(button=>{const a=button.getBoundingClientRect(),b=document.querySelector('.yb-tooltip').getBoundingClientRect();return Math.abs(a.x+a.width/2-b.x-b.width/2)<1;}),true);
  await nativeTooltipTransform.evaluate(e=>e.remove());
  check(prefix+'compressor-only active label',await page.locator('.yb-compressor').getAttribute('aria-label'),'Disable audio compressor');
  check(prefix+'original toggled artwork centred on hover paint',await paintedCentresMatchHighlights(page),true);
  await page.keyboard.press('v');await page.waitForFunction(()=>document.querySelector('.yb-compressor').getAttribute('aria-pressed')==='false');
  check(prefix+'compressor-only inactive label',await page.locator('.yb-compressor').getAttribute('aria-label'),'Enable audio compressor');
  await page.keyboard.press('b');check(prefix+'B no longer toggles audio',await page.locator('.yb-compressor').getAttribute('aria-pressed'),'false');await page.keyboard.press('v');await page.waitForFunction(()=>document.querySelector('.yb-compressor').getAttribute('aria-pressed')==='true');
  check(prefix+'original compressor shortcuts',await page.evaluate(()=>testStats().audio),1);
  check(prefix+'V sequence never reaches native player handlers',await page.evaluate(()=>{
    let received=0;
    const native=()=>received++;
    for(const type of ['keydown','keypress','keyup'])document.addEventListener(type,native,{capture:true});
    for(const type of ['keydown','keypress','keyup'])document.body.dispatchEvent(new KeyboardEvent(type,{key:'v',repeat:true,bubbles:true,cancelable:true}));
    for(const type of ['keydown','keypress','keyup'])document.removeEventListener(type,native,{capture:true});
    return received;
  }),0);
  check(prefix+'V remains available when typing',await page.evaluate(()=>{
    const input=document.createElement('input');document.body.append(input);
    const event=new KeyboardEvent('keydown',{key:'v',bubbles:true,cancelable:true});input.dispatchEvent(event);input.remove();return event.defaultPrevented;
  }),false);

  // Navigate away and back using the SAME video, as YouTube's SPA/miniplayer does.
  await page.evaluate(()=>{history.pushState({},'', '/results?search_query=test');document.dispatchEvent(new Event('yt-navigate-finish'));});
  await page.waitForFunction(()=>!document.querySelector('.yb-controls'));
  check(prefix+'search route has no observers',await page.evaluate(()=>testStats().observers),0);
  check(prefix+'navigation revokes screenshot and media URLs except fixture video',await page.evaluate(()=>testStats().urls),1);
  await page.evaluate(()=>{history.pushState({},'', '/watch?v=fixture2');document.dispatchEvent(new Event('yt-navigate-finish'));});
  await page.waitForSelector('.yb-compressor');
  await page.waitForFunction(()=>document.querySelector('.yb-compressor').getAttribute('aria-pressed')==='true');
  check(prefix+'same media resumes compression after SPA return',await page.evaluate(()=>testStats().audio),1);
  await page.evaluate(()=>{window.detachedVideo=document.querySelector('video');detachedVideo.remove();});
  await page.waitForFunction(()=>testAudio[0].deref().state==='suspended');
  check(prefix+'removed media suspends orphan audio context',await page.evaluate(()=>testAudio[0].deref().state),'suspended');
  await page.evaluate(()=>{document.querySelector('#movie_player').prepend(detachedVideo);delete window.detachedVideo;});
  await page.waitForFunction(()=>document.querySelector('.yb-compressor').getAttribute('aria-pressed')==='true');
  check(prefix+'reinserted media reuses its audio source',await page.evaluate(()=>testStats().audio),1);
  // Stress control replacement, without creating a new video or increasing observers.
  for(let i=0;i<100;i++) {
    await page.evaluate(()=>{const c=document.querySelector('.ytp-right-controls'); const n=document.createElement('div');n.className=c.className;c.replaceWith(n);});
    await page.waitForSelector('.yb-faster');
  }
  check(prefix+'100 replacements retain exactly five buttons',await page.locator('[data-yb]').count(),5);
  check(prefix+'observer count bounded after replacements',await page.evaluate(()=>testStats().observers),2);
  await page.locator('.yb-faster').click();check(prefix+'no duplicate click callbacks after replacements',await page.locator('video').evaluate(v=>v.playbackRate),1.3);
  // Hide/reorder through real popup code using a shared fixture storage bridge.
  const popup=await context.newPage();
  await popup.route('https://popup.test/**',route=>{const file=path.basename(new URL(route.request().url()).pathname)||'popup.html';route.fulfill({contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html',body:fs.readFileSync(path.join(root,'src',file))});});
  await popup.addInitScript(shim);
  await popup.goto('https://popup.test/popup.html');await popup.waitForSelector('[data-button="screenshot"]');
  await popup.locator('[data-button="screenshot"]').uncheck();
  await popup.locator('[data-move="screenshot:-1"]').click();
  await popup.waitForFunction(()=>testStore.settings?.order[1]==='screenshot' && testStore.settings?.enabled.screenshot===false);
  const config=await popup.evaluate(()=>testStore.settings);
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),config);
  await page.waitForFunction(()=>!document.querySelector('.yb-screenshot'));
  check(prefix+'popup toggle and order apply',await page.locator('[data-yb]').evaluateAll(ns=>ns.map(n=>n.dataset.yb)),['compressor','slower','speed','faster']);
  await popup.locator('[data-button="acceleration"]').uncheck();
  await popup.waitForFunction(()=>testStore.settings.enabled.slower===false && testStore.settings.enabled.speed===false && testStore.settings.enabled.faster===false);
  check(prefix+'group toggle disables all speed controls',await popup.evaluate(()=>testStore.settings.enabled.faster),false);
  await popup.locator('[data-button="acceleration"]').check();
  await popup.locator('[data-group="acceleration"] .handle').dragTo(popup.locator('[data-group="compressor"]'),{targetPosition:{x:30,y:3}});
  await popup.waitForFunction(()=>testStore.settings.order[0]==='slower');
  check(prefix+'drag reorders acceleration group',await popup.locator('li').first().getAttribute('data-group'),'acceleration');
  await popup.locator('[data-group="acceleration"] .handle').dragTo(popup.locator('li').last(),{targetPosition:{x:35,y:28}});
  await popup.waitForFunction(()=>testStore.settings.order.at(-1)==='faster');
  check(prefix+'dragging first row below final row reaches bottom',await popup.locator('li').last().getAttribute('data-group'),'acceleration');
  await popup.locator('[data-group="compressor"] .handle').dragTo(popup.locator('footer'));
  await popup.waitForFunction(()=>testStore.settings.order.at(-1)==='compressor');
  check(prefix+'drop below list reaches final position',await popup.locator('li').last().getAttribute('data-group'),'compressor');
  await popup.locator('[data-group="acceleration"] .handle').dragTo(popup.locator('li').first(),{targetPosition:{x:30,y:3}});
  await popup.waitForFunction(()=>testStore.settings.order[0]==='slower');
  await popup.locator('[data-group="compressor"] .handle').dragTo(popup.locator('[data-group="acceleration"]'),{targetPosition:{x:30,y:28}});
  await popup.waitForFunction(()=>testStore.settings.order[3]==='compressor');
  await popup.locator('[data-group="acceleration"] summary').click();await popup.locator('#step').selectOption('0.25');
  await popup.waitForFunction(()=>testStore.settings.step===0.25);
  check(prefix+'inline multiplier setting persists',await popup.locator('[data-group="acceleration"] summary').textContent(),'0.25×');
  await page.evaluate(()=>{window.styleSpeedNode=document.querySelector('.yb-speed');window.styleSpeedText=styleSpeedNode.textContent;});
  await popup.evaluate(style=>chrome.storage.local.set({settings:{...testStore.settings,style}}),'new');
  await popup.waitForFunction(()=>testStore.settings.style==='new');
  check(prefix+'button style option removed',await popup.locator('#button-style').count(),0);
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  await page.waitForFunction(()=>document.querySelector('.yb-controls').dataset.style==='new');
  check(prefix+'new icons apply immediately',await page.locator('.yb-slower svg').evaluate(e=>e.getBoundingClientRect().width),23);
  check(prefix+'native large-player highlight fits new hit target',await page.locator('.yb-slower').evaluate(e=>{const s=getComputedStyle(e,'::before');return [s.width,s.height];}),['27px','27px']);
  check(prefix+'new controls share one vertical centre despite host offsets',await page.locator('.yb-controls').evaluate(group=>{const g=group.getBoundingClientRect(),center=g.y+g.height/2;return [...group.querySelectorAll('.yb-button,.yb-button svg')].every(e=>{const r=e.getBoundingClientRect();return Math.abs(r.y+r.height/2-center)<0.1;});}),true);
  check(prefix+'new hit area hugs icon',await page.locator('.yb-slower').evaluate(e=>{const r=e.getBoundingClientRect();return [r.width,r.height];}),[27,27]);
  check(prefix+'new artwork centred on hover paint',await paintedCentresMatchHighlights(page),true);
  check(prefix+'style switch preserves speed number and node',await page.evaluate(()=>styleSpeedNode===document.querySelector('.yb-speed') && styleSpeedNode.textContent===styleSpeedText),true);
  await page.locator('.yb-compressor').click();await page.waitForFunction(()=>document.querySelector('.yb-compressor').getAttribute('aria-pressed')==='false');
  check(prefix+'new off artwork centred on hover paint',await paintedCentresMatchHighlights(page),true);
  await page.locator('.yb-compressor').click();await page.waitForFunction(()=>document.querySelector('.yb-compressor').getAttribute('aria-pressed')==='true');
  await popup.evaluate(style=>chrome.storage.local.set({settings:{...testStore.settings,style}}),'original');
  await popup.waitForFunction(()=>testStore.settings.style==='original');
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  await page.waitForFunction(()=>document.querySelector('.yb-controls').dataset.style==='original');
  check(prefix+'original icon style restores safely',await page.locator('.yb-slower svg').evaluate(e=>e.getBoundingClientRect().width),28);
  check(prefix+'active default is YouTube red',await page.locator('.yb-compressor svg').evaluate(e=>getComputedStyle(e).color),'rgb(255, 0, 0)');
  check(prefix+'compression button has no bloom filter',await page.locator('.yb-compressor').evaluate(e=>getComputedStyle(e).filter),'none');
  const shadowFixture=await page.addStyleTag({content:'.html5-video-player .ytp-button{filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))}'});
  check(prefix+'audio tweaks retains same native shadow as other icons',await page.evaluate(()=>getComputedStyle(document.querySelector('.yb-compressor')).filter===getComputedStyle(document.querySelector('.yb-slower')).filter&&getComputedStyle(document.querySelector('.yb-compressor')).filter!=='none'),true);
  await shadowFixture.evaluate(e=>e.remove());
  check(prefix+'speed numeral no longer shifted one pixel upward',await page.locator('.yb-speed-value').evaluate(e=>getComputedStyle(e).transform),'none');
  check(prefix+'speed numeral has native YouTube text shadow',await page.locator('.yb-speed-value').evaluate(e=>getComputedStyle(e).textShadow),'rgba(0, 0, 0, 0.5) 0px 0px 2px');

  check(prefix+'boost multiplier visible on collapsed audio row',await popup.locator('#audio-boost').isVisible(),true);
  await popup.keyboard.press('Escape');
  check(prefix+'popup controls share compact height',await popup.evaluate(()=>[document.querySelector('.boost-setting'),document.querySelector('.audio-settings-cog'),document.querySelector('.moves button'),document.querySelector('[data-group="acceleration"] summary')].map(e=>Math.round(e.getBoundingClientRect().height))),[22,22,22,22]);
  check(prefix+'speed step text centred horizontally within its box',await popup.locator('.step-value').evaluate(e=>{const a=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();return Math.abs(a.x+a.width/2-b.x-b.width/2)<.1&&getComputedStyle(e.parentElement).paddingLeft==='0px';}),true);
  check(prefix+'row arrows share horizontal columns and header centres',await popup.locator('li').evaluateAll(rows=>{const rects=rows.map(row=>({moves:row.querySelector('.moves').getBoundingClientRect(),label:row.querySelector('.toggle').getBoundingClientRect()}));return rects.every(({moves,label})=>Math.abs(moves.right-rects[0].moves.right)<.1&&Math.abs(moves.y+moves.height/2-label.y-label.height/2)<.1);}),true);
  check(prefix+'cog matches arrow box size and shared header alignment',await popup.evaluate(()=>{const cog=document.querySelector('.audio-settings-cog').getBoundingClientRect(),arrow=document.querySelector('[data-group="compressor"] .moves button').getBoundingClientRect(),step=document.querySelector('[data-group="acceleration"] summary').getBoundingClientRect();return[cog.width,cog.height,arrow.width,arrow.height,Math.abs(cog.y-arrow.y)<.1,Math.abs(cog.right-step.right)<.1];}),[22,22,22,22,true,true]);
  check(prefix+'boost symbols use sharp centred geometry',await popup.locator('.boost-setting button svg').evaluateAll(nodes=>nodes.length===2&&nodes.every(e=>{const r=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();return Math.abs(r.x+r.width/2-b.x-b.width/2)<.1&&Math.abs(r.y+r.height/2-(b.y+b.height/2))<.1;})),true);
  check(prefix+'Subscribe links to Brandyn channel',await popup.locator('#subscribe').evaluate(a=>[a.textContent,a.href,a.target,a.rel]),['Subscribe','https://www.youtube.com/c/brandyyn','_blank','noopener noreferrer']);
  check(prefix+'boost group aligns symbols around combined percentage',await popup.locator('.boost-setting').evaluate(group=>{const [minus,value,plus]=[...group.children].map(e=>e.getBoundingClientRect());const input=group.querySelector('input').getBoundingClientRect(),unit=group.querySelector('.boost-value > span').getBoundingClientRect();return Math.abs((minus.y+minus.height/2)-(plus.y+plus.height/2))<.1&&Math.abs(value.left-minus.right-(plus.left-value.right))<.1&&Math.abs(input.right-unit.left)<.1;}),true);
  await popup.locator('#audio-boost').focus();
  check(prefix+'boost number and suffix sit one pixel above symbol centres',await popup.locator('.boost-setting').evaluate(group=>{const items=[group.querySelector('input'),group.querySelector('.boost-value > span'),...group.querySelectorAll('button svg')].map(e=>{const r=e.getBoundingClientRect();return r.y+r.height/2;});return Math.abs(items[0]-items[1])<.1&&Math.abs(items[2]-items[3])<.1&&Math.abs(items[2]-items[0]-1)<.1;}),true);
  check(prefix+'focus box encloses percentage suffix',await popup.locator('.boost-value').evaluate(e=>{const s=getComputedStyle(e);return s.outlineWidth==='1px'&&e.contains(document.activeElement)&&e.lastElementChild.textContent==='%';}),true);
  check(prefix+'closed feature rows have no excess vertical padding',await popup.locator('li:not(:has(details[open]))').evaluateAll(rows=>rows.every(row=>row.getBoundingClientRect().height<=34)),true);
  await popup.getByRole('button',{name:'Increase audio boost',exact:true}).click();
  await popup.waitForFunction(()=>testStore.settings.audioBoost===1.1);
  check(prefix+'plus adjusts percentage by ten points',await popup.locator('#audio-boost').inputValue(),'110');
  await popup.getByRole('button',{name:'Decrease audio boost',exact:true}).click();
  await popup.waitForFunction(()=>testStore.settings.audioBoost===1);
  check(prefix+'minus restores 100 percent',await popup.locator('#audio-boost').inputValue(),'100');
  await popup.locator('#audio-boost').fill('900');await popup.locator('#audio-boost').press('Enter');
  await popup.waitForFunction(()=>testStore.settings.audioBoost===5);
  check(prefix+'percentage input clamps to 500 percent',await popup.locator('#audio-boost').inputValue(),'500');
  await popup.locator('#audio-boost').fill('100');await popup.locator('#audio-boost').press('Enter');
  await popup.waitForFunction(()=>testStore.settings.audioBoost===1);
  await popup.locator('.audio-settings summary').click();
  check(prefix+'colour choices in unified menu',await popup.locator('.colour-presets button').allTextContents(),['YouTube Red',"Brandyn's Blue",'Inverted']);
  await popup.locator('#compression-colour').evaluate(input=>{input.value='#12ab34';input.dispatchEvent(new Event('change',{bubbles:true}));});
  await popup.waitForFunction(()=>testStore.settings.customCompressionColor==='#12ab34');
  check(prefix+'custom picker is highlighted',await popup.locator('#compression-colour').getAttribute('data-selected'),'true');

  await popup.getByRole('button',{name:"Brandyn's Blue",exact:true}).click();
  await popup.waitForFunction(()=>testStore.settings.compressionColor==='#83d4ff');
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  check(prefix+'blue preserved in unified menu',await page.locator('.yb-compressor svg').evaluate(e=>getComputedStyle(e).color),'rgb(131, 212, 255)');
  await popup.getByRole('button',{name:'Inverted',exact:true}).click();
  await popup.waitForFunction(()=>testStore.settings.compressionColor==='inverted');
  check(prefix+'presets preserve picked custom colour',await popup.locator('#compression-colour').inputValue(),'#12ab34');
  check(prefix+'only selected preset highlighted',await popup.locator('.colour-presets button[aria-pressed="true"]').allTextContents(),['Inverted']);
  check(prefix+'custom colour persists separately',await popup.evaluate(()=>testStore.settings.customCompressionColor),'#12ab34');

  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  check(prefix+'inverted active colour',await page.locator('.yb-compressor svg').evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
  await page.locator('.yb-compressor').click();
  check(prefix+'inverted inactive colour',await page.locator('.yb-compressor svg').evaluate(e=>getComputedStyle(e).color),'rgb(51, 51, 51)');
  check(prefix+'EQ controls hidden while EQ disabled',await popup.locator('.eq-bands').isVisible(),false);
  await popup.locator('body').screenshot({path:path.join(root,'preview-compressor-settings.png')});
  await page.evaluate(()=>{
    const context=testAudio[0].deref();window.eqProbe={filters:[],gains:[]};
    for(const [method,key] of [['createBiquadFilter','filters'],['createGain','gains']]){
      const create=context[method].bind(context);context[method]=()=>{const node=create();eqProbe[key].push(node);node.testOutputs=[];
      const connect=node.connect.bind(node),disconnect=node.disconnect.bind(node);
      node.connect=target=>{node.testOutputs.push(target);return connect(target);};node.disconnect=()=>{node.testOutputs.length=0;disconnect();};return node;};
    }
  });
  await popup.locator('#eqEnabled').check();await popup.locator('#compressionEnabled').uncheck();
  await popup.waitForFunction(()=>testStore.settings.eqEnabled && !testStore.settings.compressionEnabled);
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  check(prefix+'configuring bypassed EQ creates no filters',await page.evaluate(()=>eqProbe.filters.length),0);
  check(prefix+'EQ toggle reveals bands',await popup.locator('.eq-bands').isVisible(),true);
  check(prefix+'frequency gain and dB text share identical typography',await popup.locator('.eq-band').evaluateAll(rows=>rows.every(row=>{const styles=[row.querySelector('.eq-frequency'),row.querySelector('.eq-value input'),row.querySelector('.eq-value > span')].map(e=>{const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight,s.fontVariantNumeric].join('|');});return styles.every(s=>s===styles[0]);})),true);

  check(prefix+'EQ tracks share panel midpoint and values share right edge',await popup.locator('.eq-bands').evaluate(panel=>{const p=panel.getBoundingClientRect();return [...panel.querySelectorAll('.eq-band')].every(row=>{const track=row.querySelector('input[type=range]').getBoundingClientRect(),value=row.querySelector('.eq-value').getBoundingClientRect();return Math.abs(track.x+track.width/2-p.x-p.width/2)<.1&&Math.abs(value.right-p.right)<.1;});}),true);
  check(prefix+'EQ number and unit share vertical centre',await popup.locator('.eq-value').evaluateAll(values=>values.every(value=>{const a=value.querySelector('input').getBoundingClientRect(),b=value.querySelector('span').getBoundingClientRect();return Math.abs(a.y+a.height/2-b.y-b.height/2)<.1;})),true);

  check(prefix+'Reset EQ centred directly below final band',await popup.locator('.reset-eq').evaluate(button=>{const b=button.getBoundingClientRect(),last=button.previousElementSibling.getBoundingClientRect(),slider=button.previousElementSibling.querySelector('input[type=range]').getBoundingClientRect();return Math.abs(b.x+b.width/2-slider.x-slider.width/2)<.1&&Math.abs(b.top-last.bottom+2)<.1;}),true);

  check(prefix+'compression heading capitalization',await popup.locator('.compression-row > label').textContent(),'Audio Compression');
  check(prefix+'disabled compression dims number and percent together',await popup.locator('#compression-percent').evaluate(e=>{const p=getComputedStyle(e.parentElement);return e.disabled&&p.opacity==='0.45'&&getComputedStyle(e).opacity==='1'&&getComputedStyle(e.nextElementSibling).opacity==='1';}),true);

  check(prefix+'audio option checkboxes precede aligned labels',await popup.locator('.audio-feature-toggle').evaluateAll(rows=>rows.every(row=>{const checkbox=row.querySelector('input[type=checkbox]'),label=row.querySelector('label'),a=checkbox.getBoundingClientRect(),b=label.getBoundingClientRect();return row.firstElementChild===checkbox&&a.right<b.left&&Math.abs(a.y+a.height/2-b.y-b.height/2)<.1;})),true);

  check(prefix+'readable label and numeric font sizes',await popup.evaluate(()=>[getComputedStyle(document.querySelector('.toggle')).fontSize,getComputedStyle(document.querySelector('#compression-percent')).fontSize,getComputedStyle(document.querySelector('#audio-boost')).fontSize]),['13px','13px','13px']);
  check(prefix+'compression range uses explicit centred geometry',await popup.locator('#compression-amount').evaluate(e=>{const r=e.getBoundingClientRect(),label=e.parentElement.querySelector('label').getBoundingClientRect();return[r.height,Math.abs(r.y+r.height/2-label.y-label.height/2-1)<.1,getComputedStyle(e).appearance];}),[22,true,'none']);
  check(prefix+'colour presets share themed button styling and size',await popup.locator('.colour-presets button').evaluateAll(buttons=>{const reference=getComputedStyle(document.querySelector('.moves button'));return buttons.every(e=>{const s=getComputedStyle(e);return e.getBoundingClientRect().height===22&&(e.getAttribute('aria-pressed')==='true'||(s.backgroundColor===reference.backgroundColor&&s.borderTopColor===reference.borderTopColor));});}),true);
  check(prefix+'preset labels centre with left swatches and comfortable inset',await popup.locator('.colour-presets button').evaluateAll(buttons=>buttons.every(e=>{const s=getComputedStyle(e);return s.justifyContent==='center'&&s.fontSize==='11px'&&s.paddingLeft==='5px'&&s.gap==='4px'&&getComputedStyle(e,'::before').position==='static'&&e.scrollWidth<=e.clientWidth;})),true);
  check(prefix+'EQ rows use consistent spacing and text size',await popup.locator('.eq-band').evaluateAll(rows=>rows.every(e=>{const s=getComputedStyle(e);return s.fontSize==='13px'&&e.getBoundingClientRect().height>=22;})),true);
  check(prefix+'compression controls share one row',await popup.locator('.compression-row').evaluate(row=>{const controls=[...row.children].map(e=>e.getBoundingClientRect());return Math.max(...controls.map(r=>r.y+r.height/2))-Math.min(...controls.map(r=>r.y+r.height/2))<2;}),true);
  await popup.locator('#compressionEnabled').check();
  await popup.locator('#compression-percent').fill('37');await popup.locator('#compression-percent').press('Enter');
  await popup.waitForFunction(()=>testStore.settings.compressionAmount===37);
  check(prefix+'typed compression percent synchronizes slider',await popup.locator('#compression-amount').inputValue(),'37');
  check(prefix+'compression focus box fits number and suffix',await popup.locator('#compression-percent').evaluate(input=>{const unit=input.parentElement,suffix=unit.querySelector('span');return Math.abs(unit.getBoundingClientRect().width-input.getBoundingClientRect().width-suffix.getBoundingClientRect().width)<.1&&unit.getBoundingClientRect().height===18;}),true);

  check(prefix+'compression focus encloses aligned percent suffix',await popup.locator('#compression-percent').evaluate(input=>{const unit=input.parentElement,suffix=unit.querySelector('span'),a=input.getBoundingClientRect(),b=suffix.getBoundingClientRect();return getComputedStyle(unit).outlineStyle==='solid'&&getComputedStyle(input).outlineStyle==='none'&&Math.abs(a.y+a.height/2-b.y-b.height/2)<.1;}),true);

  await popup.locator('[data-eq-value="1"]').fill('-7');await popup.locator('[data-eq-value="1"]').press('Enter');
  await popup.waitForFunction(()=>testStore.settings.eq[1]===-7);
  check(prefix+'typed dB synchronizes slider',await popup.locator('[data-eq-band="1"]').inputValue(),'-7');
  await popup.locator('[data-eq-value="1"]').fill('90');await popup.locator('[data-eq-value="1"]').press('Enter');
  await popup.waitForFunction(()=>testStore.settings.eq[1]===12);
  check(prefix+'typed dB clamps safely',await popup.locator('[data-eq-value="1"]').inputValue(),'12');
  await popup.locator('[data-eq-value="1"]').fill('0');await popup.locator('[data-eq-value="1"]').press('Enter');
  await popup.waitForFunction(()=>testStore.settings.eq[1]===0);
  await popup.locator('#compressionEnabled').uncheck();
  await popup.waitForFunction(()=>testStore.settings.compressionEnabled===false);
  check(prefix+'boost explanation moved to input tooltip',await popup.locator('#audio-boost').getAttribute('title'),'Boost multiplies YouTube volume while Audio Tweaks is on.');
  check(prefix+'boost input and buttons have no box backgrounds',await popup.locator('.boost-setting').evaluate(group=>[...group.querySelectorAll('input,button')].every(e=>{const s=getComputedStyle(e);return s.backgroundColor==='rgba(0, 0, 0, 0)'&&parseFloat(s.borderTopWidth)===0;})),true);
  for(const [band,gain] of [[0,6],[2,-3]])await popup.locator(`[data-eq-band="${band}"]`).evaluate((input,gain)=>{input.value=gain;input.dispatchEvent(new Event('change',{bubbles:true}));},gain);
  await popup.locator('#audio-boost').fill('200');await popup.locator('#audio-boost').press('Enter');
  await popup.waitForFunction(()=>testStore.settings.audioBoost===2 && testStore.settings.eq[0]===6);
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  await page.locator('video').evaluate(v=>v.volume=.4);
  await page.locator('.yb-compressor').click();
  await page.waitForFunction(()=>eqProbe.filters[0]?.gain.value>5.99 && Math.abs(testAudioGains[0].deref().gain.value-2)<.001);
  check(prefix+'boost uses a real 2x gain without changing YouTube volume',await page.evaluate(()=>[Math.abs(testAudioGains[0].deref().gain.value-2)<.001,document.querySelector('video').volume]),[true,.4]);
  check(prefix+'EQ bands and shapes',await page.evaluate(()=>eqProbe.filters.map(n=>[n.frequency.value,n.type])),[[60,'lowshelf'],[250,'peaking'],[1000,'peaking'],[4000,'peaking'],[12000,'highshelf']]);
  check(prefix+'EQ chain feeds boost directly with compression off',await page.evaluate(()=>eqProbe.filters.at(-1).testOutputs[0]===testAudioGains[0].deref()),true);
  check(prefix+'EQ bass frequency response changes',await page.evaluate(()=>{const m=new Float32Array(1);eqProbe.filters[0].getFrequencyResponse(new Float32Array([10]),m,new Float32Array(1));return m[0]>1.9;}),true);
  await popup.locator('#compressionEnabled').check();
  await popup.waitForFunction(()=>testStore.settings.compressionEnabled);
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  check(prefix+'EQ and compression run together before boost',await page.evaluate(()=>eqProbe.filters.at(-1).testOutputs[0]===testCompressors[0].deref()),true);
  await popup.locator('#compression-amount').evaluate(input=>{input.value='50';input.dispatchEvent(new Event('change',{bubbles:true}));});
  await popup.waitForFunction(()=>testStore.settings.compressionAmount===50);
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  await page.waitForFunction(()=>{const n=testCompressors[0].deref();return Math.abs(n.threshold.value+25)<.01&&Math.abs(n.ratio.value-6.5)<.01;});
  check(prefix+'compression amount adjusts actual threshold and ratio',await page.evaluate(()=>{const n=testCompressors[0].deref();return Math.abs(n.threshold.value+25)<.01&&Math.abs(n.ratio.value-6.5)<.01;}),true);
  await popup.locator('#compression-amount').evaluate(input=>{input.value='0';input.dispatchEvent(new Event('change',{bubbles:true}));});
  await popup.waitForFunction(()=>testStore.settings.compressionAmount===0);
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  await page.waitForFunction(()=>testCompressors[0].deref().ratio.value<1.001);
  check(prefix+'zero compression amount is neutral',await page.evaluate(()=>{const n=testCompressors[0].deref();return Math.abs(n.threshold.value)<.01&&n.ratio.value<1.001;}),true);
  await popup.locator('#eqEnabled').uncheck();await popup.locator('#compressionEnabled').uncheck();
  await popup.waitForFunction(()=>!testStore.settings.eqEnabled&&!testStore.settings.compressionEnabled);
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  check(prefix+'boost-only configuration disconnects EQ but keeps multiplier',await page.evaluate(()=>eqProbe.filters.every(n=>n.testOutputs.length===0)&&Math.abs(testAudioGains[0].deref().gain.value-2)<.001),true);
  await popup.locator('#eqEnabled').check();await popup.locator('#compressionEnabled').check();
  await popup.locator('#compression-amount').evaluate(input=>{input.value='50';input.dispatchEvent(new Event('change',{bubbles:true}));});
  await popup.waitForFunction(()=>testStore.settings.eqEnabled&&testStore.settings.compressionEnabled&&testStore.settings.compressionAmount===50);
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  check(prefix+'legacy audio preferences migrate to independent settings',await popup.evaluate(()=>{const s=YBSettings.normalize({audioMode:'eq',audioVolume:65});return[s.eqEnabled,s.compressionEnabled,s.audioBoost];}),[true,false,.65]);
  check(prefix+'expanded audio reorder arrows stay in header row',await popup.locator('[data-group="compressor"]').evaluate(row=>{const a=row.querySelector('.moves').getBoundingClientRect(),b=row.querySelector('.toggle').getBoundingClientRect();return Math.abs(a.y+a.height/2-b.y-b.height/2)<2;}),true);
  await page.locator('.yb-compressor').hover();
  check(prefix+'Audio Tweaks label and shortcuts',await page.locator('.yb-compressor').getAttribute('aria-label'),'Disable audio tweaks');
  check(prefix+'only V shortcut badge retained',await page.locator('.yb-tooltip .ytp-tooltip-keyboard-shortcut:not([hidden])').allTextContents(),['V']);
  await page.locator('.yb-compressor').click();
  check(prefix+'off disconnects EQ processing',await page.evaluate(()=>eqProbe.filters.every(n=>n.testOutputs.length===0)),true);
  for(let i=0;i<10;i++)await page.locator('.yb-compressor').click();
  check(prefix+'toggles reuse filters, gains and context',await page.evaluate(()=>[eqProbe.filters.length,eqProbe.gains.length,testAudio.length]),[5,1,1]);
  await page.locator('.yb-compressor').click();
  await page.evaluate(()=>{history.replaceState({},'', '/results?search_query=audio');document.dispatchEvent(new Event('yt-navigate-finish'));});await page.waitForFunction(()=>!document.querySelector('.yb-controls'));
  await page.evaluate(()=>{history.replaceState({},'', '/watch?v=fixture');document.dispatchEvent(new Event('yt-navigate-finish'));});await page.waitForFunction(()=>document.querySelector('.yb-compressor')?.getAttribute('aria-pressed')==='true');
  check(prefix+'combined audio restored after navigation without duplicate nodes',await page.evaluate(()=>[eqProbe.filters.length,eqProbe.gains.length,testAudio.length]),[5,1,1]);
  await popup.getByRole('button',{name:'Reset EQ',exact:true}).click();await popup.waitForFunction(()=>testStore.settings.eq.every(n=>n===0));
  check(prefix+'reset saves flat EQ',await popup.evaluate(()=>testStore.settings.eq),[0,0,0,0,0]);
  await popup.locator('body').screenshot({path:path.join(root,'preview-audio-tweaks.png')});
  await popup.locator('#extra-options').evaluate(e=>e.open=true);await popup.locator('#autoplay-enabled').uncheck();
  await popup.waitForFunction(()=>testAutoplay===false);
  check(prefix+'popup autoplay switch sends explicit state',await popup.evaluate(()=>testAutoplay),false);
  await page.evaluate(()=>{const button=document.createElement('button');button.className='ytp-button ytp-autonav-toggle';button.style.height='48px';button.innerHTML='<div class="ytp-autonav-toggle-button-container"><div class="ytp-autonav-toggle-button" aria-checked="true"></div></div>';window.autoplayClicks=0;button.onclick=()=>{autoplayClicks++;const c=button.querySelector('[aria-checked]');c.setAttribute('aria-checked',String(c.getAttribute('aria-checked')!=='true'));};document.querySelector('.ytp-right-controls').append(button);});
  check(prefix+'native autoplay read never toggles',await page.evaluate(()=>[testSendAutoplay({type:'yb-autoplay-get'}),autoplayClicks]),[{available:true,enabled:true},0]);
  await popup.locator('#extra-options').evaluate(e=>e.open=true);await popup.locator('#autoplay-hide').check();await popup.waitForFunction(()=>testStore.settings.hideAutoplay===true);
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  check(prefix+'optional hiding removes native autoplay hit area',await page.locator('.ytp-autonav-toggle').isVisible(),false);
  check(prefix+'hidden native autoplay still controlled through message',await page.evaluate(()=>testSendAutoplay({type:'yb-autoplay-set',enabled:false})),{available:true,enabled:false});
  check(prefix+'setting unchanged autoplay is not another click',await page.evaluate(()=>{testSendAutoplay({type:'yb-autoplay-set',enabled:false});return autoplayClicks;}),1);
  await popup.locator('#extra-options').evaluate(e=>e.open=true);await popup.locator('#autoplay-hide').uncheck();await popup.waitForFunction(()=>testStore.settings.hideAutoplay===false);
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  check(prefix+'unhide restores native autoplay button',await page.locator('.ytp-autonav-toggle').isVisible(),true);
  await page.locator('.ytp-autonav-toggle').evaluate(button=>{button.style.width='48px';button.style.padding='0 8px';});
  await popup.locator('#extra-options').evaluate(e=>e.open=true);
  check(prefix+'extra options labels and order',await popup.locator('.extra-options-panel label > span').allTextContents(),['Hide Autoplay','Enable Autoplay','Compact Buttons']);
  check(prefix+'menu trigger has no box',await popup.locator('#extra-options > summary').evaluate(e=>{const s=getComputedStyle(e);return[s.borderTopWidth,s.backgroundColor];}),['0px','rgba(0, 0, 0, 0)']);
  check(prefix+'dropdown rows are compact',await popup.locator('.extra-options-panel label').evaluateAll(rows=>rows.every(e=>e.getBoundingClientRect().height<=25)),true);
  check(prefix+'dropdown fields share right edge',await popup.locator('.extra-options-panel label').evaluateAll(rows=>{const edges=rows.map(e=>e.lastElementChild.getBoundingClientRect().right);return Math.max(...edges)-Math.min(...edges)<.1;}),true);
  check(prefix+'compact enabled by default and autoplay unmanaged',await popup.evaluate(()=>{const d=YBSettings.defaults();return[d.compactButtons,d.hideAutoplay];}),[true,false]);
  await page.evaluate(()=>{
    document.querySelector('#movie_player').classList.add('ytp-delhi-modern');
    const css=document.createElement('style');css.id='native-svg-spacing';css.textContent='.native-spacing-fixture{height:40px!important;width:48px;border:0!important;padding:0!important;box-sizing:border-box}.native-spacing-fixture>svg{width:48px;height:24px;padding:8px 12px;box-sizing:content-box}';document.head.append(css);
    const button=document.createElement('button');button.className='ytp-button native-spacing-fixture';button.innerHTML='<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>';document.querySelector('.ytp-right-controls').append(button);
  });
  await popup.locator('#compact-buttons').check();await popup.waitForFunction(()=>testStore.settings.compactButtons===true);
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  check(prefix+'compact fullscreen moves complete button two pixels toward settings',await page.evaluate(()=>{const b=document.createElement('button');b.className='ytp-button ytp-fullscreen-button';document.querySelector('.ytp-right-controls').append(b);const style=getComputedStyle(b),result=[style.position,style.left];b.remove();return result;}),['relative','-2px']);
  check(prefix+'compact native slot removes padding',await page.locator('.ytp-autonav-toggle').evaluate(e=>[e.getBoundingClientRect().width,getComputedStyle(e).paddingLeft]),[32,'0px']);
  await page.locator('.yb-autoplay-icon').waitFor();
  check(prefix+'compact autoplay uses a full-size inline vector',await page.locator('.yb-autoplay-icon').evaluate(svg=>{const r=svg.getBoundingClientRect(),c=svg.querySelector('circle');return[r.width,r.height,c.r.baseVal.value,c.getAttribute('stroke-width')];}),[28,28,9,'2.2']);
  check(prefix+'compact autoplay aligns vertically with the row',await page.locator('.yb-autoplay-icon').evaluate(svg=>{const a=svg.getBoundingClientRect(),b=svg.closest('button').getBoundingClientRect();return[Math.abs(a.x+a.width/2-b.x-b.width/2)<.01,Math.abs(a.y+a.height/2-b.y-b.height/2)<.01];}),[true,true]);
  await page.locator('.ytp-autonav-toggle').click();
  check(prefix+'native autoplay updates inline glyph without replacement',await page.locator('.yb-autoplay-icon').evaluate(svg=>getComputedStyle(svg.querySelector('.yb-autoplay-play')).display==='block'&&getComputedStyle(svg.querySelector('.yb-autoplay-pause')).display==='none'),true);
  await page.locator('.ytp-autonav-toggle').click();
  check(prefix+'native off state shows pause',await page.locator('.yb-autoplay-icon').evaluate(svg=>getComputedStyle(svg.querySelector('.yb-autoplay-pause')).display!=='none'&&getComputedStyle(svg.querySelector('.yb-autoplay-play')).display==='none'),true);
  const originalAutoplayNode=await page.locator('.yb-autoplay-icon').evaluate(svg=>{window.savedAutoplaySVG=svg;return true;});
  for(let i=0;i<20;i++)await page.locator('.ytp-autonav-toggle').click();
  check(prefix+'autoplay toggles reuse a single vector',await page.evaluate(()=>document.querySelectorAll('.yb-autoplay-icon').length===1&&savedAutoplaySVG===document.querySelector('.yb-autoplay-icon')),true);
  await page.evaluate(()=>{document.querySelector('.yb-autoplay-icon').remove();delete window.savedAutoplaySVG;});
  await page.locator('.yb-autoplay-icon').waitFor();
  check(prefix+'native child replacement repairs one vector',await page.locator('.yb-autoplay-icon').count(),1);
  check(prefix+'autoplay follows row height rather than native oversized height',await page.locator('.ytp-autonav-toggle').evaluate(e=>Math.abs(e.getBoundingClientRect().height-e.closest('.ytp-right-controls').getBoundingClientRect().height)<.01),true);
  await page.evaluate(()=>chrome.storage.local.set({settings:{...testStore.settings,style:'new'}}));
  check(prefix+'autoplay retains canvas size with heavier ring and filled symbol',await page.evaluate(()=>{const a=document.querySelector('.yb-autoplay-icon'),b=document.querySelector('.yb-slower svg');return a.getBoundingClientRect().width===b.getBoundingClientRect().width&&getComputedStyle(a.querySelector('circle')).strokeWidth==='2px'&&a.querySelector('.yb-autoplay-play').getAttribute('fill')==='currentColor';}),true);
  check(prefix+'compact native hover matches extension hover size and stays centred',await page.locator('.ytp-autonav-toggle').evaluate(button=>{const s=getComputedStyle(button,'::before');return[s.width,s.height,s.left,s.top,s.borderRadius,s.transform];}),['27px','27px','16px','22px','50%','matrix(1, 0, 0, 1, -13.5, -13.5)']);
  await page.evaluate(()=>chrome.storage.local.set({settings:{...testStore.settings,style:'original'}}));

  check(prefix+'native padded SVG retains 24px artwork without overlap',await page.locator('.native-spacing-fixture').evaluate(button=>{const svg=button.firstElementChild,r=svg.getBoundingClientRect(),b=button.getBoundingClientRect(),s=getComputedStyle(svg);return[r.width,r.height,r.width-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),r.height-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom),Math.abs(r.x+r.width/2-b.x-b.width/2)<.01];}),[32,40,24,24,true]);
  await page.evaluate(()=>{
    const original=document.querySelector('.native-spacing-fixture');
    const captions=original.cloneNode(true);captions.classList.remove('native-spacing-fixture');captions.classList.add('ytp-subtitles-button');captions.style.height='40px';
    const wrapper=document.createElement('div');wrapper.className='ytp-subtitles-button-icon';wrapper.append(captions.firstElementChild);captions.append(wrapper);original.after(captions);
    const style=document.createElement('style');style.id='native-decoration-fixture';style.textContent='.ytp-subtitles-button{border:0;padding:0}.ytp-subtitles-button-icon{width:48px;height:40px}.ytp-subtitles-button-icon>svg{width:48px;height:24px;padding:8px 12px}.native-spacing-fixture::after{content:"HD";position:absolute;top:10px;right:5px;width:13px;height:9px}';document.head.append(style);
  });
  check(prefix+'nested captions artwork fits unclipped compact slot',await page.locator('.ytp-subtitles-button').evaluate(button=>{const svg=button.querySelector('svg'),a=button.getBoundingClientRect(),b=svg.getBoundingClientRect(),s=getComputedStyle(svg);return[b.width,b.width-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),Math.abs(a.x+a.width/2-b.x-b.width/2)<.01];}),[32,24,true]);
  check(prefix+'quality badge retains native corner positioning',await page.locator('.native-spacing-fixture').evaluate(button=>{const s=getComputedStyle(button,'::after');return[s.right,s.transform,s.width];}),['5px','none','13px']);
  await page.evaluate(()=>{document.querySelector('.ytp-subtitles-button').remove();document.querySelector('#native-decoration-fixture').remove();});
  await popup.locator('#compact-buttons').uncheck();await popup.waitForFunction(()=>testStore.settings.compactButtons===false);
  await page.evaluate(config=>chrome.storage.local.set({settings:config}),await popup.evaluate(()=>testStore.settings));
  check(prefix+'disabling compact restores native dimensions',await page.locator('.ytp-autonav-toggle').evaluate(e=>[e.getBoundingClientRect().width,getComputedStyle(e).paddingLeft]),[48,'8px']);
  await page.evaluate(()=>{document.querySelector('.native-spacing-fixture').remove();document.querySelector('#native-svg-spacing').remove();document.querySelector('#movie_player').classList.remove('ytp-delhi-modern');});
  await popup.keyboard.press('Escape');check(prefix+'Escape closes options dropdown',await popup.locator('#extra-options').evaluate(e=>e.open),false);
  for(const scheme of ['light','dark']) { await popup.emulateMedia({colorScheme:scheme});await popup.locator('body').screenshot({path:path.join(scratch,`${engine}-popup-${scheme}.png`)}); }
  await page.screenshot({path:path.join(root,'preview-player.png')});
  // All disabled must remove observers too; re-enabling must rediscover the player.
  await page.evaluate(async()=>{const settings=structuredClone(testStore.settings);for(const k in settings.enabled)settings.enabled[k]=false;await chrome.storage.local.set({settings});});
  await page.waitForFunction(()=>!document.querySelector('.yb-controls'));
  check(prefix+'all disabled disconnects observers',await page.evaluate(()=>testStats().observers),0);
  await page.evaluate(async()=>{const settings=structuredClone(testStore.settings);settings.enabled.faster=true;await chrome.storage.local.set({settings});});
  await page.waitForSelector('.yb-faster');
  check(prefix+'re-enable restores control',await page.locator('[data-yb]').count(),1);
  await page.evaluate(()=>{delete chrome.storage;delete chrome.runtime;window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));});
  await page.waitForFunction(()=>testAudio[0].deref().state==='closed');
  check(prefix+'final cleanup closes audio',await page.evaluate(()=>testAudio[0].deref().state),'closed');
  check(prefix+'final cleanup disconnects observers',await page.evaluate(()=>testStats().observers),0);
  check(prefix+'invalidated API cleanup removes toolbar',await page.locator('.yb-controls').count(),0);
  // A different extension may already own the media source. Failed initialization
  // must close the otherwise unused AudioContext and leave native audio alone.
  await page.reload();
  await page.evaluate(shim);
  await page.evaluate(()=>{AudioContext.prototype.createMediaElementSource=function(){throw new DOMException('Already owned','InvalidStateError');};});
  await page.addScriptTag({path:path.join(root,'src/settings.js')});
  await page.addScriptTag({path:path.join(root,'src/content.js')});
  await page.locator('.yb-compressor').waitFor();
  await page.locator('.yb-compressor').click();
  await page.waitForFunction(()=>testAudio[0]?.deref().state==='closed');
  check(prefix+'failed audio source initialization closes unused context',await page.evaluate(()=>testAudio[0].deref().state),'closed');
  await page.evaluate(()=>{chrome.storage.onChanged.removeListener=()=>{throw new Error('Extension context invalidated');};chrome.runtime.onMessage.removeListener=()=>{throw new Error('Extension context invalidated');};window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));});
  check(prefix+'throwing invalidated event APIs cannot prevent teardown',await page.locator('.yb-controls').count(),0);
  check(prefix+'no page exceptions',errors,[]);
  await browser.close();
}
(async()=>{for(const engine of ['chromium','firefox'])await run(engine);fs.writeFileSync(path.join(root,'test-results', 'test-results.json'),JSON.stringify({date:new Date().toISOString(),scope:'Browser integration fixtures with storage shim, not live YouTube or installed Firefox add-on',passed:results.length,tests:results},null,2));console.log('All',results.length,'checks passed.');})().catch(e=>{console.error(e);process.exit(1);});
