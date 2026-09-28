const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture(reduced = true, visualFactory = null, backHandler = () => {}) {
  const animations=[];
  const node = () => ({
    animate() { let resolve, reject; const finished=new Promise((yes,no)=>{resolve=yes;reject=no;}); const a={finished,resolve,cancel:()=>reject(new Error("cancelled"))}; animations.push(a); return a; },
    listeners:{}, style:{ removeProperty(name) { delete this[name]; } }, children:[], clientWidth:390,
    addEventListener(name, fn) { this.listeners[name] = fn; },
    removeEventListener(name) { delete this.listeners[name]; },
    getBoundingClientRect() { return { left:0 }; },
    emit(name, x=0, y=100, timeStamp=0, count=1) {
      const event = { touches:Array.from({length:count}, (_,identifier) => ({identifier,clientX:x,clientY:y})), timeStamp, cancelable:true, preventDefault() { this.prevented=true; } };
      this.listeners[name]?.(event); return event;
    }
  });
  const surface=node(), content=node(), win=node(), doc=node(); content.children=[node(),node()];
  let back=0, blocked=false; const raf=new Map(); let id=0;
  const context=vm.createContext({ matchMedia:()=>({matches:reduced}), window:win, document:doc,
    requestAnimationFrame:fn=>{raf.set(++id,fn);return id;}, cancelAnimationFrame:id=>raf.delete(id) });
  vm.runInContext(fs.readFileSync('js/navigation-motion.js','utf8')+'\nthis.motion=WaveMotion;', context);
  const cleanup=context.motion.edgeBack(surface,content,()=>{back++;return backHandler();},()=>blocked,visualFactory);
  return {surface,content,win,doc,cleanup,animations,back:()=>back,block:()=>blocked=true,paint:()=>{for(const fn of raf.values())fn();raf.clear();}};
}
test('left edge follows the finger and commits a deliberate rightward swipe',()=>{
  const f=fixture(); f.surface.emit('touchstart',8); const e=f.surface.emit('touchmove',160,102,200); f.paint();
  assert.equal(e.prevented,true); assert.equal(f.content.children[0].style.translate,'152px 0');
  f.surface.emit('touchend',160,102,210); assert.equal(f.back(),1); assert.equal(f.content.children[0].style.translate,undefined);
});
test('vertical scroll, wrong edge and leftward motions never navigate',()=>{
  for(const [start,x,y] of [[8,12,180],[100,290,100],[20,2,100]]){
    const f=fixture(); f.surface.emit('touchstart',start); const e=f.surface.emit('touchmove',x,y,200);
    f.surface.emit('touchend',x,y,210); assert.equal(f.back(),0); assert.equal(e.prevented,undefined);
  }
});
test('short drag and stale flick return to original position',()=>{
  const f=fixture(); f.surface.emit('touchstart',8); f.surface.emit('touchmove',75,100,30); f.paint();
  f.surface.emit('touchend',75,100,250); assert.equal(f.back(),0); assert.equal(f.content.children[0].style.translate,undefined);
});
test('touch cancellation, extra finger, blur and cleanup cannot commit',()=>{
  for(const reason of ['touchcancel','multiple','blur','cleanup']){
    const f=fixture();f.surface.emit('touchstart',8);f.surface.emit('touchmove',180,100,200);f.paint();
    if(reason==='multiple') f.surface.emit('touchmove',200,100,220,2);
    else if(reason==='blur') f.win.emit('blur');
    else if(reason==='cleanup') f.cleanup();
    else f.surface.emit(reason);
    f.surface.emit('touchend',180,100,230); assert.equal(f.back(),0);assert.equal(f.content.children[0].style.translate,undefined);
  }
});
test('open sheets block gestures; cleanup removes every listener',()=>{
  const f=fixture();f.block();f.surface.emit('touchstart',8);f.surface.emit('touchmove',250,100,200);f.surface.emit('touchend',250,100,210);
  assert.equal(f.back(),0);f.cleanup();assert.deepEqual(Object.keys(f.surface.listeners),[]);assert.deepEqual(Object.keys(f.win.listeners),[]);assert.deepEqual(Object.keys(f.doc.listeners),[]);
});

test('animated completion commits once, disposal cancels pending navigation',async()=>{
  for(const dispose of [false,true]) {
    const f=fixture(false);f.surface.emit('touchstart',8);f.surface.emit('touchmove',200,100,200);f.surface.emit('touchend',200,100,210);
    assert.equal(f.back(),0);assert.equal(f.animations.length,2);
    if(dispose)f.cleanup();else f.animations.forEach(a=>a.resolve());
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.back(),dispose?0:1);assert.equal(f.content.children[0].style.translate,undefined);
  }
});

test('a tap on a left-edge button is not swallowed',()=>{
  const f=fixture(false);f.surface.emit('touchstart',15);f.surface.emit('touchend',15,100,70);
  assert.equal(f.animations.length,0);assert.equal(f.surface.emit('click').prevented,undefined);
});
test('backgrounding during the completion animation cancels navigation',async()=>{
  const f=fixture(false);f.surface.emit('touchstart',8);f.surface.emit('touchmove',200,100,200);f.surface.emit('touchend',200,100,210);
  f.win.emit('blur');await new Promise(resolve=>setImmediate(resolve));assert.equal(f.back(),0);
});

test('swipe destination stays visible until asynchronous navigation finishes',async()=>{
  let disposed=0, resolveBack, progress=0;
  const done=new Promise(resolve=>resolveBack=resolve);
  const visual={update:x=>progress=x,dispose:()=>disposed++,animate:()=>[]};
  const f=fixture(false,()=>visual,()=>done);
  f.surface.emit('touchstart',8);f.surface.emit('touchmove',200,100,200);f.paint();
  assert.equal(progress,192);assert.equal(f.content.children[0].style.translate,undefined);
  f.surface.emit('touchend',200,100,210);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.back(),1);assert.equal(disposed,0);assert.equal(progress,390);
  f.cleanup();assert.equal(disposed,0);
  resolveBack();await new Promise(resolve=>setImmediate(resolve));assert.equal(disposed,1);
});
