/** Un seul geste actif, capturé sur la liste qui ne quitte jamais le DOM. */
const WaveOrganizerDrag = (() => {
  function attach(list, overlay, onCommit) {
    let active = null;
    let destroyed = false;
    const listeners = [];
    const listen = (target, type, handler) => {
      target.addEventListener(type, handler);
      listeners.push(() => target.removeEventListener(type, handler));
    };
    const stopAnimations = () => {
      [...list.children].forEach(row => row.getAnimations().forEach(animation => animation.cancel()));
    };
    function finish(commit = false) {
      if (!active) return;
      const gesture = active;
      active = null; // releasePointerCapture peut déclencher lostpointercapture.
      cancelAnimationFrame(gesture.frame);
      gesture.ghost.remove();
      gesture.row.classList.remove('drag-placeholder');
      stopAnimations();
      if (!commit) gesture.original.forEach(row => list.appendChild(row));
      if (list.hasPointerCapture(gesture.pointerId)) list.releasePointerCapture(gesture.pointerId);
      if (commit) onCommit([...list.children].map(row => row.dataset.trackId));
    }
    function schedule() {
      if (!active || active.frame) return;
      const gesture = active;
      gesture.frame = requestAnimationFrame(time => {
        if (active !== gesture) return;
        gesture.frame = 0;
        paint(time);
      });
    }
    function paint(time) {
      if (!active) return;
      const g = active;
      if (!list.isConnected || !overlay.isConnected) { finish(false); return; }
      const bounds = list.getBoundingClientRect();
      g.ghost.style.transform = `translate3d(0, ${g.y - g.startY}px, 0)`;
      const edge = g.y > bounds.bottom - 48 ? 1 : g.y < bounds.top + 48 ? -1 : 0;
      const elapsed = Math.min(32, Math.max(0, time - g.lastTime));
      g.lastTime = time;
      if (edge) list.scrollTop += edge * elapsed * .45;
      const middle = g.y - g.grip + g.row.offsetHeight / 2;
      // Les coordonnées de disposition restent indépendantes des animations.
      const siblings = [...list.children].filter(row => row !== g.row);
      const before = siblings.find(row => middle < bounds.top + row.offsetTop - list.scrollTop + row.offsetHeight / 2) || null;
      if (g.row.nextElementSibling !== before) {
        const previous = new Map(siblings.map(row => [row, row.getBoundingClientRect().top]));
        stopAnimations();
        list.insertBefore(g.row, before);
        siblings.forEach(row => {
          const delta = previous.get(row) - row.getBoundingClientRect().top;
          if (Math.abs(delta) > 1) row.animate([
            { transform:`translate3d(0, ${delta}px, 0)` }, { transform:'none' }
          ], { duration:150, easing:'cubic-bezier(.2,.8,.2,1)' });
        });
      }
      if (edge) schedule();
    }
    listen(list, 'pointerdown', event => {
      if (destroyed || active || event.button !== 0 || event.isPrimary === false) return;
      const handle = event.target.closest('.organizer-handle');
      const row = handle?.closest('.organizer-track');
      if (!row || row.parentElement !== list) return;
      event.preventDefault();
      stopAnimations();
      const rect = row.getBoundingClientRect();
      const ghost = row.cloneNode(true);
      ghost.classList.add('organizer-ghost');
      ghost.removeAttribute('data-track-id');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.querySelectorAll('button').forEach(button => { button.tabIndex = -1; });
      Object.assign(ghost.style, { left:`${rect.left}px`, top:`${rect.top}px`, width:`${rect.width}px`, height:`${rect.height}px` });
      active = { row, ghost, original:[...list.children], pointerId:event.pointerId,
        y:event.clientY, startY:event.clientY, grip:event.clientY - rect.top, lastTime:performance.now(), frame:0 };
      overlay.appendChild(ghost);
      row.classList.add('drag-placeholder');
      try { list.setPointerCapture(event.pointerId); } catch { finish(false); }
    });
    listen(list, 'pointermove', event => {
      if (!active || event.pointerId !== active.pointerId) return;
      active.y = event.clientY; schedule();
    });
    listen(list, 'pointerup', event => {
      if (!active || event.pointerId !== active.pointerId) return;
      active.y = event.clientY; paint(performance.now()); finish(true);
    });
    listen(list, 'pointercancel', event => { if (event.pointerId === active?.pointerId) finish(false); });
    listen(list, 'lostpointercapture', event => { if (event.pointerId === active?.pointerId) finish(false); });
    listen(window, 'blur', () => finish(false));
    listen(document, 'visibilitychange', () => { if (document.hidden) finish(false); });
    return {
      cancel:() => finish(false),
      destroy() { destroyed = true; finish(false); listeners.forEach(remove => remove()); }
    };
  }
  return { attach };
})();
