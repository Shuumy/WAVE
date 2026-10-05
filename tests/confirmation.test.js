const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture() {
  const handlers={},classes=new Set();
  const modal={addEventListener:(type,fn)=>handlers[type]=fn};
  const yes={classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}},no={},message={};
  const c=vm.createContext({confirmModal:modal,confirmYes:yes,confirmNo:no,confirmMessage:message,WaveMotion:{open(){},close(){}}});
  const source=fs.readFileSync('js/app.js','utf8');
  vm.runInContext(source.slice(source.indexOf('  let cancelConfirmation'),source.indexOf('  function formatTotalDuration'))+';this.ask=showConfirm;',c);
  return {ask:c.ask,yes,no,classes,handlers,modal};
}
test('correction confirmation is distinct from deletion and resets on each opening',async()=>{
  const f=fixture();const correction=f.ask('Correct?',{label:'Confirmer la correction',destructive:false});
  assert.equal(f.yes.textContent,'Confirmer la correction');assert.ok(f.classes.has('confirm-action'));
  f.yes.onclick();assert.equal(await correction,true);
  const deletion=f.ask('Delete?');assert.equal(f.yes.textContent,'Supprimer');assert.equal(f.classes.has('confirm-action'),false);
  f.no.onclick();assert.equal(await deletion,false);
});
test('outside click and Escape resolve as cancellation',async()=>{
  const f=fixture();const first=f.ask('Correct?');f.handlers.click({target:f.modal});assert.equal(await first,false);
  const second=f.ask('Correct?');f.handlers.keydown({key:'Escape'});assert.equal(await second,false);
});
