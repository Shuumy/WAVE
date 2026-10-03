const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
async function fixture(record) {
  const rows=new Map(record?[[record.id,structuredClone(record)]]:[]);
  const database={transaction(){const tx={};tx.objectStore=()=>({
    get(id){const req={};queueMicrotask(()=>{req.result=structuredClone(rows.get(id));req.onsuccess();queueMicrotask(()=>tx.oncomplete());});return req;},
    put(track){rows.set(track.id,structuredClone(track));}
  });return tx;}};
  const indexedDB={open(){const req={result:database};queueMicrotask(()=>req.onsuccess());return req;}};
  const c=vm.createContext({indexedDB});vm.runInContext(fs.readFileSync('js/db.js','utf8')+'\nthis.api=DB;',c);await c.api.open();return {db:c.api,rows};
}
const base={id:'a',userImported:true,title:'Original',artist:'Artist'};
test('explicit retry unlocks only with consent, preserving original data and rejecting stale views',async()=>{
  const f=await fixture({...base,metadataLocked:true,originalMetadata:{title:'Import',artist:'Unknown'}});
  assert.equal(await f.db.queueIdentification(base),null);
  assert.equal(await f.db.queueIdentification({...base,title:'Stale'},true),null);
  const updated=await f.db.queueIdentification(base,true);
  assert.equal(updated.metadataLocked,false);
  assert.equal(updated.originalMetadata.title,'Import');
  assert.equal(updated.identification.status,'pending');
  assert.equal(updated.identification.manual,true);
  const missing=await fixture();assert.equal(await missing.db.queueIdentification(base,true),null);
});
test('deleted tracks and late automatic results never recreate or override manual corrections',async()=>{
  const deleted=await fixture();assert.equal(await deleted.db.saveIdentification(base,{status:'matched'},{title:'New',artist:'New'}),null);assert.equal(deleted.rows.size,0);
  const manual=await fixture({...base,metadataLocked:true,title:'My correction'});
  assert.equal(await manual.db.saveIdentification(base,{status:'matched'},{title:'New',artist:'New'}),null);
  assert.equal(manual.rows.get('a').title,'My correction');
});
test('a completed correction cannot be queued from a stale menu, but editing and restoration allow it',async()=>{
  const f=await fixture({...base,identification:{status:'matched'}});
  assert.equal(await f.db.queueIdentification(base,true),null);
  for(const status of ['edited','restored']) {
    await f.db.updateUserTrack('a',{identification:{status},metadataLocked:true});
    assert.ok(await f.db.queueIdentification(base,true));
  }
});
test('metadata and identification result commit together without losing playlist-independent track data',async()=>{
  const f=await fixture({...base,coverArt:'local-cover',originalMetadata:{title:'Original',artist:'Artist'}});
  const result=await f.db.saveIdentification(base,{status:'matched',source:'MusicBrainz'},{title:'Corrected',artist:'Artist'});
  assert.equal(result.title,'Corrected');assert.equal(result.coverArt,'local-cover');assert.equal(f.rows.get('a').identification.status,'matched');assert.equal(f.rows.get('a').originalMetadata.title,'Original');
});
test('manual edit merges in one transaction and sets protection before a later automatic write',async()=>{
  const f=await fixture(base);await f.db.updateUserTrack('a',{title:'Mine',metadataLocked:true});
  assert.equal(await f.db.saveIdentification(base,{status:'matched'},{title:'Other',artist:'Other'}),null);assert.equal(f.rows.get('a').title,'Mine');
});
