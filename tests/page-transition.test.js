const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture() {
  const animations=[];
  class Element {
    constructor() { this.style={opacity:''}; this.children=[]; this.scrollTop=160; this.clientWidth=390; this.inert=false; }
    setAttribute() {} removeAttribute() {} matches() { return false; }
    querySelectorAll() { return []; } querySelector() { return null; }
    getBoundingClientRect() { return {left:0,top:0,width:390,height:760}; }
    cloneNode() { return new Element(); }
    appendChild(child) { child.remove();this.children.push(child);child.parent=this; }
    remove() { if(this.parent) this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null; }
    animate(frames) {
      let resolve;const finished=new Promise(yes=>resolve=yes);
      const animation={frames,finished,resolve};animations.push(animation);return animation;
    }
  }
  const surface=new Element(),body=new Element();let raf;
  const context=vm.createContext({matchMedia:()=>({matches:false}),document:{body,createElement:()=>new Element()},getComputedStyle:()=>({padding:'16px',display:'block'}),requestAnimationFrame:fn=>raf=fn});
  vm.runInContext(fs.readFileSync('js/navigation-motion.js','utf8')+'\nthis.motion=WaveMotion;',context);
  return {motion:context.motion,surface,body,animations,frame:()=>raf?.()};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('old viewport covers pending render; rapid navigation cannot interleave',async()=>{
  const f=fixture();let finishRender, second=0;
  const render=new Promise(resolve=>finishRender=resolve);
  const transition=f.motion.navigate(f.surface,()=>render,1);
  assert.equal(f.body.children.length,1);assert.equal(f.surface.style.opacity,'0');assert.equal(f.surface.inert,true);
  await f.motion.navigate(f.surface,()=>second++,1);assert.equal(second,0);
  finishRender();await tick();assert.equal(f.body.children.length,1);
  f.frame();await tick();assert.equal(f.body.children.length,2);
  assert.equal(f.animations[0].frames[0].transform,'translate3d(390px,0,0)');
  f.animations.forEach(a=>a.resolve());await transition;
  assert.equal(f.body.children.length,0);assert.equal(f.surface.style.opacity,'');assert.equal(f.surface.inert,false);
});
test('render failure always removes snapshots and releases navigation lock',async()=>{
  const f=fixture();await assert.rejects(f.motion.navigate(f.surface,async()=>{throw Error('DB');}));
  assert.equal(f.body.children.length,0);assert.equal(f.surface.inert,false);assert.equal(f.surface.style.opacity,'');
  const next=f.motion.navigate(f.surface,async()=>{},-1);await tick();f.frame();await tick();
  f.animations.forEach(a=>a.resolve());await next;assert.equal(f.body.children.length,0);
});
