const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture() {
  class Node {
    constructor(id) {
      this.dataset = id ? { trackId:id } : {}; this.children = []; this.style = {};
      this.events = new Map(); this.classes = new Set(); this.isConnected = true; this.scrollTop = 0;
      this.classList = { add:name => this.classes.add(name), remove:name => this.classes.delete(name) };
    }
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
    removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
    emit(type, extra = {}) { for (const fn of [...(this.events.get(type) || [])]) fn({ pointerId:1, button:0, isPrimary:true, clientY:135, preventDefault() {}, ...extra }); }
    setPointerCapture(id) { this.capture = id; }
    hasPointerCapture(id) { return this.capture === id; }
    releasePointerCapture(id) { this.capture = null; this.emit('lostpointercapture', { pointerId:id }); }
    get offsetTop() { return this.parentElement ? this.parentElement.children.indexOf(this) * 70 : 0; }
    get offsetHeight() { return 70; }
    get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    getBoundingClientRect() { const top = this.parentElement === list ? 100 + this.offsetTop - list.scrollTop : 100; return { top, left:0, width:390, height:70, bottom:this === list ? 500 : top + 70 }; }
    insertBefore(node, before) { node.remove(); const i = before ? this.children.indexOf(before) : this.children.length; this.children.splice(i, 0, node); node.parentElement = this; }
    appendChild(node) { this.insertBefore(node, null); }
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
    cloneNode() { return new Node(); }
    removeAttribute() {}
    setAttribute() {}
    querySelectorAll() { return []; }
    getAnimations() { return []; }
    animate() {}
  }
  const list = new Node(), overlay = new Node(), win = new Node(), doc = new Node();
  const rows = ['a','b','c'].map(id => new Node(id)); rows.forEach(row => list.appendChild(row));
  const handle = new Node(); handle.closest = selector => selector === '.organizer-handle' ? handle : rows[0];
  const frames = new Map(); let serial = 0; let committed = null;
  const context = vm.createContext({ window:win, document:doc, performance:{ now:() => 100 },
    requestAnimationFrame:fn => { frames.set(++serial, fn); return serial; }, cancelAnimationFrame:id => frames.delete(id) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/organizer-drag.js'), 'utf8') + '\nthis.mount = WaveOrganizerDrag.attach;', context);
  const controller = context.mount(list, overlay, order => { committed = Array.from(order); });
  const start = () => list.emit('pointerdown', { target:handle });
  const move = () => { list.emit('pointermove', { clientY:275 }); const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(116)); };
  return { list, overlay, rows, handle, frames, controller, win, doc, start, move, order:() => list.children.map(row => row.dataset.trackId), committed:() => committed };
}

test('la capture reste sur la liste stable et le dépôt produit une seule occurrence de chaque morceau', () => {
  const f = fixture(); f.start();
  assert.equal(f.list.capture, 1); assert.equal(f.handle.capture, undefined);
  f.move(); f.list.emit('pointerup', { clientY:275 });
  assert.deepEqual(f.committed(), ['b','c','a']);
  assert.equal(f.overlay.children.length, 0); assert.equal(f.frames.size, 0);
  assert.ok(f.rows.every(row => !row.classes.has('drag-placeholder')));
});

for (const event of ['pointercancel', 'lostpointercapture']) {
  test(`${event} retire la copie et restaure l’ordre initial`, () => {
    const f = fixture(); f.start(); f.move(); f.list.emit(event);
    assert.deepEqual(f.order(), ['a','b','c']); assert.equal(f.committed(), null);
    assert.equal(f.overlay.children.length, 0); assert.equal(f.frames.size, 0);
  });
}

test('un deuxième doigt ne crée pas de copie supplémentaire', () => {
  const f = fixture(); f.start(); f.list.emit('pointerdown', { target:f.handle, pointerId:2 });
  assert.equal(f.overlay.children.length, 1); f.controller.cancel();
  assert.equal(f.overlay.children.length, 0);
});

test('fermer ou reconstruire l’éditeur nettoie aussi un geste en cours', () => {
  const f = fixture(); f.start(); f.move(); f.controller.destroy();
  assert.deepEqual(f.order(), ['a','b','c']); assert.equal(f.overlay.children.length, 0);
  assert.equal(f.frames.size, 0); f.start(); assert.equal(f.overlay.children.length, 0);
});

test('le passage en arrière-plan annule le geste', () => {
  const f = fixture(); f.start(); f.move(); f.doc.hidden = true; f.doc.emit('visibilitychange');
  assert.deepEqual(f.order(), ['a','b','c']); assert.equal(f.overlay.children.length, 0);
});

test('vingt gestes interrompus ou terminés ne laissent aucune copie cumulée', () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) {
    f.start(); f.move();
    f.list.emit(i % 2 ? 'pointerup' : 'lostpointercapture', { clientY:275 });
    assert.equal(f.overlay.children.length, 0);
    assert.equal(new Set(f.order()).size, 3);
    assert.equal(f.list.children.length, 3);
    assert.equal(f.frames.size, 0);
  }
});
