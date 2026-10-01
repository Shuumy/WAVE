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
test('deleted tracks and late automatic results never recreate or override manual corrections',async()=>{
  const deleted=await fixture();assert.equal(await deleted.db.saveIdentification(base,{status:'matched'},{title:'New',artist:'New'}),null);assert.equal(deleted.rows.size,0);
  const manual=await fixture({...base,metadataLocked:true,title:'My correction'});
  assert.equal(await manual.db.saveIdentification(base,{status:'matched'},{title:'New',artist:'New'}),null);
  assert.equal(manual.rows.get('a').title,'My correction');
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
