const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function fixture({online=true,hidden=false,locked=false,result,fail=false}={}) {
  const track={id:'1',title:'Song',artist:'Artist',duration:200,userImported:true,metadataLocked:locked,identification:{status:'pending',attempts:0,nextAttempt:0}};
  const calls=[],updates=[],timers=[],events={};
  const db={getSetting:async()=>({enabled:true,audio:false}),getUserTracks:async()=>[track],saveIdentification:async(snapshot,state,match)=>{
    if(track.metadataLocked||track.title!==snapshot.title||track.artist!==snapshot.artist)return null;
    Object.assign(track,match||{},{identification:state});updates.push(state);return track;
  }};
  const context=vm.createContext({URLSearchParams,AbortController,Date,File:class{},navigator:{onLine:online},document:{hidden,addEventListener:(name,fn)=>events[name]=fn},window:{addEventListener:(name,fn)=>events[name]=fn},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},fetch:async url=>{calls.push(url);if(fail)throw Error('Offline');return {ok:true,json:async()=>result||{status:'matched',source:'MusicBrainz',match:{title:'Song',artist:'Artist'},candidates:[]}};}});
  vm.runInContext(fs.readFileSync('js/identify.js','utf8')+'\nthis.api=WaveIdentify;',context);
  return {api:context.api,track,calls,updates,timers,events,context,db,async run(){await context.api.init(db,'https://example.test',async()=>{});timers[0].fn();await new Promise(resolve=>setImmediate(resolve));}};
}
test('filename cleaning retains performance qualifiers and avoids guessing hyphenated artist names',()=>{
  const f=fixture();assert.equal(f.api.name('Artist - Song [Official Video].mp3').title,'Song');
  assert.equal(f.api.name('Artist - Song (Live Remix).mp3').title,'Song (Live Remix)');
  assert.equal(f.api.name('AC-DC.mp3').artist,'Artiste inconnu');
});
test('offline, hidden and manually corrected imports are not sent',async()=>{
  for(const options of [{online:false},{hidden:true},{locked:true}]){const f=fixture(options);await f.run();assert.equal(f.calls.length,0);assert.equal(f.updates.length,0);}
});
test('confident matches persist while uncertain results stay suggestions',async()=>{
  const f=fixture();await f.run();assert.equal(f.track.identification.status,'matched');
  const uncertain=fixture({result:{status:'review',source:'MusicBrainz',candidates:[{title:'Other',artist:'Someone'}]}});
  await uncertain.run();assert.equal(uncertain.track.title,'Song');assert.equal(uncertain.track.identification.status,'review');
});
test('network failures persist exponential retry state and resume on online event',async()=>{
  const f=fixture({fail:true});await f.run();assert.equal(f.track.identification.status,'pending');assert.equal(f.track.identification.attempts,1);assert.ok(f.track.identification.nextAttempt>Date.now());
  assert.equal(typeof f.events.online,'function');f.events.online();assert.equal(f.timers.at(-1).ms,0);
});
test('malformed successful replies cannot erase title and artist',async()=>{
  const f=fixture({result:{status:'matched',match:{title:'',artist:null},candidates:[]}});await f.run();assert.equal(f.track.title,'Song');assert.equal(f.track.identification.status,'unmatched');
});
test('manual searches persist a result notification marker and expose honest no-result wording',async()=>{
  const f=fixture({result:{status:'unmatched',candidates:[]}});
  f.track.identification.manual=true;
  await f.run();
  assert.equal(f.updates[0].phase,'searching');
  assert.equal(f.track.identification.manual,true);
  assert.match(f.api.describe(f.track),/Aucune correspondance/);
  f.track.identification.status='unavailable';
  assert.match(f.api.describe(f.track),/Aucun résultat textuel/);
});
