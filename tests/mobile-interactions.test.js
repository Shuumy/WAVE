const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const c=vm.createContext({Date});vm.runInContext(fs.readFileSync('js/mobile-interactions.js','utf8')+';this.api=WaveMobile;',c);
test('only two fast taps on the same tab trigger scroll-to-top',()=>{
  let time=0;const tap=c.api.tabTap(()=>time);
  assert.equal(tap('home'),false);time=200;assert.equal(tap('home'),true);
  time=210;assert.equal(tap('home'),false);time=800;assert.equal(tap('home'),false);
  time=900;assert.equal(tap('search'),false);time=1100;assert.equal(tap('search'),true);
});
test('zoom gestures are blocked but one-finger scroll and input editing remain usable',()=>{
  const handlers={};c.api.preventZoom({addEventListener:(key,fn)=>handlers[key]=fn});
  let prevented=0;const event={cancelable:true,preventDefault:()=>prevented++,touches:[{}],target:{closest:()=>null}};
  handlers.touchmove(event);assert.equal(prevented,0);
  handlers.touchmove({...event,touches:[{},{}]});handlers.gesturestart(event);handlers.dblclick(event);
  assert.equal(prevented,3);
  handlers.dblclick({...event,target:{closest:()=>({})}});handlers.wheel({...event,ctrlKey:false});assert.equal(prevented,3);
  handlers.wheel({...event,ctrlKey:true});assert.equal(prevented,4);
});
