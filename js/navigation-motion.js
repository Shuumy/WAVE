// Shared motion timings and cancellable left-edge navigation. No layout writes per move.
const WaveMotion = (() => {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const easing = 'cubic-bezier(.22,1,.36,1)';
  const closing = new WeakMap();
  function enter(element, direction = 1) {
    if (!element || reduced()) return;
    // Animate direct sections, not their parent: fixed playlist headers keep their viewport.
    for (const child of element.children) {
      if (child.classList.contains('playlist-compact-header')) continue;
      child.animate?.([{ opacity:.35, translate:`${direction * 24}px 0` }, { opacity:1, translate:'0 0' }], { duration:300, easing });
    }
  }
  function close(element, remove = false) {
    if (!element || closing.has(element)) return;
    const finish = () => { closing.delete(element); element.inert = false; if (remove) element.remove(); else element.hidden = true; };
    if (reduced() || !element.animate) { finish(); return; }
    element.inert = true;
    const animation = element.animate([{ opacity:1 }, { opacity:0 }], { duration:160, easing:'ease-out' });
    closing.set(element, animation);
    animation.finished.then(finish, () => {});
  }
  function open(element) {
    closing.get(element)?.cancel(); closing.delete(element);
    element.inert = false; element.hidden = false;
  }
  function edgeBack(surface, content, onBack, blocked = () => false) {
    let state = null, frame = 0, animations = [], disposed = false, settling = false;
    const children = () => [...content.children];
    const paint = () => {
      frame = 0;
      if (!state) return;
      for (const child of children()) child.style.translate = `${state.dx}px 0`;
    };
    const clear = () => {
      cancelAnimationFrame(frame); frame = 0;
      animations.forEach(a => a.cancel()); animations = [];
      for (const child of children()) child.style.removeProperty('translate');
      state = null; settling = false;
    };
    const settle = (commit) => {
      if (!state) return;
      const dx = state.dx, width = surface.clientWidth;
      state = null; cancelAnimationFrame(frame); frame = 0; settling = true;
      const finish = () => { if (disposed) return; clear(); if (commit) onBack(); };
      if (reduced() || !content.animate) { finish(); return; }
      animations = children().map(child => child.animate([
        { translate:`${dx}px 0` }, { translate:`${commit ? width : 0}px 0` }
      ], { duration:commit ? 210 : 240, easing, fill:'forwards' }));
      Promise.all(animations.map(a => a.finished)).then(finish, () => {});
    };
    const start = event => {
      if (event.touches.length !== 1) { if (state) settle(false); return; }
      if (settling || blocked() || surface.clientWidth > 768) return;
      const t = event.touches[0], rect = surface.getBoundingClientRect();
      if (t.clientX < rect.left || t.clientX - rect.left > 28) return;
      state = { id:t.identifier, x:t.clientX, y:t.clientY, dx:0, lastX:t.clientX, lastTime:event.timeStamp, velocity:0, locked:false };
    };
    const move = event => {
      if (!state) return;
      if (event.touches.length !== 1 || blocked()) { settle(false); return; }
      const t = [...event.touches].find(t => t.identifier === state.id);
      if (!t) { settle(false); return; }
      const dx = t.clientX - state.x, dy = Math.abs(t.clientY - state.y);
      if (!state.locked) {
        if (dy > 9 && dy > dx || dx < -6) { clear(); return; }
        if (dx < 9 || dx < dy * 1.25) return;
        state.locked = true;
      }
      if (!event.cancelable) { settle(false); return; }
      event.preventDefault();
      const dt = event.timeStamp - state.lastTime;
      if (dt > 0) state.velocity = (t.clientX - state.lastX) / dt;
      state.lastX = t.clientX; state.lastTime = event.timeStamp;
      state.dx = Math.max(0, Math.min(surface.clientWidth, dx));
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const end = event => {
      if (!state) return;
      if (!state.locked) { clear(); return; }
      const recent = event.timeStamp - state.lastTime < 100;
      const commit = state.locked && (state.dx > surface.clientWidth * .3 || (state.dx > 50 && recent && state.velocity > .5));
      settle(commit);
    };
    const cancel = () => { if (settling) clear(); else if (state) settle(false); };
    const click = event => { if (settling || state?.locked) { event.preventDefault(); event.stopImmediatePropagation(); } };
    surface.addEventListener('touchstart', start, { passive:true });
    surface.addEventListener('touchmove', move, { passive:false });
    surface.addEventListener('touchend', end);
    surface.addEventListener('touchcancel', cancel);
    surface.addEventListener('click', click, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      disposed = true; clear();
      surface.removeEventListener('touchstart', start); surface.removeEventListener('touchmove', move);
      surface.removeEventListener('touchend', end); surface.removeEventListener('touchcancel', cancel);
      surface.removeEventListener('click', click, true);
      window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', cancel);
    };
  }
  return { enter, close, open, edgeBack };
})();
