const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf8');
const copy = value => structuredClone(value);
const settle = async () => { for (let i=0;i<20;i++) await new Promise(resolve => setImmediate(resolve)); };
function device(local = {}, remote = {}) {
  const state = {local:copy(local), sync:copy(remote), writes:[], pendingWrites:0, snapshots:[], alarms:new Map()};
  let listeners, alarmListeners;
  function boot() {
    listeners = new Set(); alarmListeners = new Set();
    const storage = {onChanged:{addListener:fn=>listeners.add(fn)}};
    for (const area of ['local','sync']) storage[area] = {
      get:async keys=>{if(area==='local'&&keys==='syncPending'&&state.pauseReads)await state.pauseReads;return Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(key=>key in state[area]).map(key=>[key,copy(state[area][key])]));},
      set:async patch=>{if(area==='local'&&patch.syncPending)state.pendingWrites++;const changes={};for(const [key,value] of Object.entries(patch)){changes[key]={oldValue:copy(state[area][key]),newValue:copy(value)};state[area][key]=copy(value);}if(global.gc&&area==='local'&&changes.settings)state.snapshots.push(new WeakRef(changes.settings.newValue));if(area==='sync')state.writes.push(copy(patch));for(const fn of listeners)fn(changes,area);},
      remove:async key=>{const oldValue=state[area][key];delete state[area][key];for(const fn of listeners)fn({[key]:{oldValue}},area);}
    };
    state.api={storage,runtime:{onStartup:{addListener(){}},onInstalled:{addListener(){}}},alarms:{get:async name=>state.alarms.get(name),create:async(name,options)=>state.alarms.set(name,options),onAlarm:{addListener:fn=>alarmListeners.add(fn)}}};
    vm.runInNewContext(source,{chrome:state.api});
  }
  state.boot=boot;state.fire=async()=>{for(const name of [...state.alarms.keys()]){state.alarms.delete(name);for(const fn of alarmListeners)fn({name});}await settle();};
  boot();return state;
}
(async()=>{
  const settings={step:0.25,eq:[1,2,3,4,5],compressionColor:'#123456',compactButtons:true};
  const first=device({settings,lastSpeed:1.5,compressionWanted:true});await settle();
  assert.equal(first.writes.length,0);assert.equal(first.alarms.size,1);
  await first.fire();assert.deepEqual(first.sync,{settings,lastSpeed:1.5,compressionWanted:true});assert.equal(first.local.syncPending,undefined);
  const second=device({},first.sync);await settle();assert.deepEqual(second.local,{settings,lastSpeed:1.5,compressionWanted:true});assert.equal(second.writes.length,0);assert.equal(second.alarms.size,0);
  const reinstall=device({},first.sync);await settle();assert.deepEqual(reinstall.local.settings,settings);
  const upgrade=device({settings:{step:0.1}},first.sync);await settle();assert.deepEqual(upgrade.local.settings,settings);
  for(let i=0;i<200;i++)await first.api.storage.local.set({settings:{...settings,compressionAmount:i%101}});
  await settle();assert.equal(first.alarms.size,1);assert.equal(first.writes.length,1);await first.fire();assert.equal(first.writes.length,2);assert.equal(first.sync.settings.compressionAmount,98);
  await first.api.storage.local.set({lastSpeed:2});await settle();first.alarms.clear();first.boot();await settle();assert.equal(first.alarms.size,1);await first.fire();assert.equal(first.sync.lastSpeed,2);
  await second.api.storage.sync.set({settings:{...settings,step:0.5}});await settle();assert.equal(second.local.settings.step,0.5);assert.equal(second.alarms.size,0);
  await second.api.storage.local.set({settings:{...settings,step:1}});await settle();await second.api.storage.sync.set({settings:{...settings,step:0.1}});await settle();assert.equal(second.local.settings.step,1);await second.fire();assert.equal(second.sync.settings.step,1);
  const before=second.writes.length;await second.api.storage.local.set({unrelated:'local only'});await settle();assert.equal(second.writes.length,before);assert.equal(second.alarms.size,0);assert.equal(second.sync.unrelated,undefined);
  assert.equal(first.alarms.size,0);assert.equal(JSON.stringify(first.sync).length<8192,true);
  const burst=device();await settle();
  await Promise.all(Array.from({length:1000},(_,i)=>burst.api.storage.local.set({settings:{...settings,compressionAmount:i%101}})));
  await settle();console.log('1000-change burst: '+burst.pendingWrites+' pending-storage writes');
  assert(burst.pendingWrites<=2,'Burst must retain only current and latest preference snapshots');
  await burst.fire();assert.equal(burst.sync.settings.compressionAmount,90);
  if(global.gc){
    for(let i=0;i<3;i++){await settle();global.gc();}
    const retained=burst.snapshots.filter(ref=>ref.deref()).length;
    assert.equal(retained,0,'Processed sync snapshots must be collected');
    console.log('Forced GC: '+retained+' of '+burst.snapshots.length+' processed settings snapshots retained');
    const stalled=device();await settle();let release;
    stalled.pauseReads=new Promise(resolve=>{release=resolve;});
    for(let i=0;i<1000;i++)await stalled.api.storage.local.set({settings:{...settings,compressionAmount:i%101}});
    for(let i=0;i<3;i++){await settle();global.gc();}
    const waiting=stalled.snapshots.filter(ref=>ref.deref()).length;
    assert(waiting<=2,'Stalled storage must retain at most current and latest snapshots');
    console.log('Stalled storage: '+waiting+' of 1000 settings snapshots retained before saving');
    stalled.pauseReads=null;release();await settle();await stalled.fire();assert.equal(stalled.sync.settings.compressionAmount,90);
  }
  console.log('Sync checks passed: upgrade, second device, reinstall, cloud precedence, batched writes, restart recovery, incoming changes, pending conflicts, idle state, storage size.');
})().catch(error=>{console.error(error);process.exitCode=1;});
