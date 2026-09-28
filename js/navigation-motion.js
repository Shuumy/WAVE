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
  // One frozen viewport per page: headers and artwork travel together, and the
  // old page covers asynchronous DB reads instead of exposing an intermediate layout.
  let navigating = false;
  function snapshot(surface) {
    const rect = surface.getBoundingClientRect();
    const frame = document.createElement('div');
    frame.className = 'motion-frame'; frame.inert = true;
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, { left:`${rect.left}px`, top:`${rect.top}px`, width:`${rect.width}px`, height:`${rect.height}px` });
    const copy = surface.cloneNode(true);
    // Snapshot-specific layout, without duplicate IDs or a second interactive UI.
    const originals = [surface, ...surface.querySelectorAll('*')];
    const copies = [copy, ...copy.querySelectorAll('*')];
    originals.forEach((original, index) => {
      const clone = copies[index];
      if (original.id || original.matches('.top-bar, .view-title, .library-tabs')) clone.style.display = getComputedStyle(original).display;
      clone.removeAttribute('id'); clone.removeAttribute('autofocus');
      if (clone.tagName === 'IMG') clone.loading = 'eager';
    });
    Object.assign(copy.style, { position:'absolute', inset:'0', width:'100%', height:'100%', margin:'0', opacity:'1', overflow:'hidden', padding:getComputedStyle(surface).padding });
    copy.inert = true; frame.appendChild(copy);
    const compact = copy.querySelector('.playlist-compact-header');
    if (compact) Object.assign(compact.style, { left:'0', right:'0' });
    const scroll = surface.scrollTop;
    return { frame, mount() { document.body.appendChild(frame); copy.scrollTop = scroll; }, remove() { frame.remove(); } };
  }
  async function navigate(surface, render, direction = 0) {
    if (navigating) return;
    navigating = true;
    const opacity = surface.style.opacity, inert = surface.inert;
    let before, after;
    try {
      if (!reduced()) { before = snapshot(surface); before.mount(); surface.style.opacity = '0'; }
      surface.inert = true;
      await render();
      if (!before) return;
      await new Promise(requestAnimationFrame);
      after = snapshot(surface); after.mount();
      const width = surface.clientWidth;
      const forward = direction > 0, backward = direction < 0;
      const duration = direction ? 320 : 180;
      const opts = { duration, easing, fill:'forwards' };
      if (backward) document.body.appendChild(before.frame);
      const incoming = after.frame.animate([
        { transform:`translate3d(${forward ? width : backward ? -width * .22 : 0}px,0,0)`, opacity:direction ? 1 : 0 },
        { transform:'translate3d(0,0,0)', opacity:1 }
      ], opts);
      const outgoing = before.frame.animate([
        { transform:'translate3d(0,0,0)', opacity:1 },
        { transform:`translate3d(${forward ? -width * .22 : backward ? width : 0}px,0,0)`, opacity:direction ? 1 : 0 }
      ], opts);
      await Promise.all([incoming.finished, outgoing.finished]);
    } finally {
      surface.style.opacity = opacity; surface.inert = inert;
      before?.remove(); after?.remove(); navigating = false;
    }
  }
  function swipeVisual(surface, previousPage) {
    const front = snapshot(surface);
    const back = previousPage();
    const opacity = surface.style.opacity;
    back?.mount(); front.mount(); surface.style.opacity = '0';
    navigating = true;
    const width = surface.clientWidth;
    const update = dx => {
      front.frame.style.transform = `translate3d(${dx}px,0,0)`;
      if (back) back.frame.style.transform = `translate3d(${-width * .22 * (1 - dx / width)}px,0,0)`;
    };
    update(0);
    return {
      update,
      animate(dx, commit, options) {
        const target = commit ? width : 0;
        const animations = [front.frame.animate([{ transform:`translate3d(${dx}px,0,0)` }, { transform:`translate3d(${target}px,0,0)` }], options)];
        if (back) animations.push(back.frame.animate([{ transform:`translate3d(${-width * .22 * (1 - dx / width)}px,0,0)` }, { transform:`translate3d(${commit ? 0 : -width * .22}px,0,0)` }], options));
        return animations;
      },
      dispose() { surface.style.opacity = opacity; front.remove(); back?.remove(); navigating = false; }
    };
  }
  function edgeBack(surface, content, onBack, blocked = () => false, makeVisual = null) {
    let state = null, frame = 0, animations = [], disposed = false, settling = false;
    let visual = null;
    const children = () => [...content.children];
    const paint = () => {
      frame = 0;
      if (!state) return;
      if (visual) visual.update(state.dx);
      else for (const child of children()) child.style.translate = `${state.dx}px 0`;
    };
    const clear = () => {
      cancelAnimationFrame(frame); frame = 0;
      animations.forEach(a => a.cancel()); animations = [];
      for (const child of children()) child.style.removeProperty('translate');
      visual?.dispose(); visual = null;
      state = null; settling = false;
    };
    const settle = (commit) => {
      if (!state) return;
      const dx = state.dx, width = surface.clientWidth;
      state = null; cancelAnimationFrame(frame); frame = 0; settling = true;
      const finish = async () => {
        if (disposed) return;
        // Hold the destination beneath the outgoing page until its live DOM is ready.
        const held = commit ? visual : null;
        if (held) { visual = null; held.update(width); }
        clear();
        try { if (commit) await onBack(); } finally { held?.dispose(); }
      };
      if (reduced() || !content.animate) { finish(); return; }
      animations = visual ? visual.animate(dx, commit, { duration:commit ? 210 : 260, easing, fill:'forwards' }) : children().map(child => child.animate([
        { translate:`${dx}px 0` }, { translate:`${commit ? width : 0}px 0` }
      ], { duration:commit ? 210 : 240, easing, fill:'forwards' }));
      Promise.all(animations.map(a => a.finished)).then(finish, () => {});
    };
    const start = event => {
      if (event.touches.length !== 1) { if (state) settle(false); return; }
      if (settling || navigating || blocked() || surface.clientWidth > 768) return;
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
        if (!reduced() && makeVisual) visual = makeVisual();
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
  return { enter, close, open, edgeBack, snapshot, navigate, swipeVisual };
})();
