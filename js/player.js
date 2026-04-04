/**
 * Audio Player Engine
 */
const Player = (() => {
  let audio = new Audio();
  audio.playsInline = true;
  audio.setAttribute('playsinline', '');
  audio.preload = 'auto';

  let currentTrack = null;
  let queue = [];
  let queueIndex = -1;
  let isPlaying = false;
  let shuffle = false;
  let repeat = 'none';
  let audioUnlocked = false;
  const listeners = {};

  function unlockAudio() {
    if (audioUnlocked) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    ctx.resume().then(() => { audioUnlocked = true; });
    audio.play().then(() => audio.pause()).catch(() => {});
    document.removeEventListener('touchstart', unlockAudio, true);
    document.removeEventListener('click', unlockAudio, true);
  }
  document.addEventListener('touchstart', unlockAudio, true);
  document.addEventListener('click', unlockAudio, true);

  audio.addEventListener('timeupdate', () => {
    emit('timeupdate', { currentTime: audio.currentTime, duration: audio.duration || 0 });
  });

  audio.addEventListener('ended', () => {
    if (repeat === 'one') { audio.currentTime = 0; audio.play(); }
    else { next(); }
  });

  audio.addEventListener('play', () => { isPlaying = true; emit('statechange', { playing: true }); });
  audio.addEventListener('pause', () => { isPlaying = false; emit('statechange', { playing: false }); });
  audio.addEventListener('error', (e) => { console.error('Audio error:', e); emit('error', { message: 'Erreur de lecture audio' }); });

  function on(event, callback) { if (!listeners[event]) listeners[event] = []; listeners[event].push(callback); }
  function emit(event, data) { if (listeners[event]) listeners[event].forEach(cb => cb(data)); }

  async function loadTrack(track) {
    currentTrack = track;
    emit('trackchange', track);
    const blob = await DB.getUserAudioBlob(track.id);
    if (blob) {
      if (audio.src && audio.src.startsWith('blob:')) { try { URL.revokeObjectURL(audio.src); } catch (_) {} }
      audio.src = URL.createObjectURL(blob);
    } else { emit('error', { message: 'Fichier audio introuvable' }); return false; }
    DB.addRecent(track.id);
    return true;
  }

  async function play(track) {
    if (track) { const loaded = await loadTrack(track); if (!loaded) return; }
    try { await audio.play(); } catch (err) { console.error('Play failed:', err); }
  }

  async function playExternal(url) {
    if (audio.src && audio.src.startsWith('blob:')) { try { URL.revokeObjectURL(audio.src); } catch (_) {} }
    currentTrack = null;
    audio.src = url;
    audio.load();
    try { await audio.play(); return true; } catch (err) { console.error('playExternal failed:', err); return false; }
  }

  function pause() { audio.pause(); }
  function togglePlay() { if (isPlaying) pause(); else if (currentTrack) play(); }
  function seek(fraction) { if (audio.duration) audio.currentTime = fraction * audio.duration; }
  function seekRelative(seconds) { if (audio.duration) audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds)); }
  function setVolume(vol) { audio.volume = Math.max(0, Math.min(1, vol)); emit('volumechange', { volume: audio.volume }); }
  function getVolume() { return audio.volume; }
  function setQueue(tracks, startIndex = 0) { queue = [...tracks]; queueIndex = startIndex; }

  function next() {
    if (queue.length === 0) return;
    if (shuffle) { let newIndex; do { newIndex = Math.floor(Math.random() * queue.length); } while (newIndex === queueIndex && queue.length > 1); queueIndex = newIndex; }
    else { queueIndex++; if (queueIndex >= queue.length) { if (repeat === 'all') { queueIndex = 0; } else { queueIndex = queue.length - 1; pause(); return; } } }
    play(queue[queueIndex]);
  }

  function prev() {
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (queue.length === 0) return;
    queueIndex--;
    if (queueIndex < 0) queueIndex = repeat === 'all' ? queue.length - 1 : 0;
    play(queue[queueIndex]);
  }

  function toggleShuffle() { shuffle = !shuffle; emit('shufflechange', { shuffle }); return shuffle; }
  function toggleRepeat() {
    const modes = ['none', 'all', 'one'];
    const idx = (modes.indexOf(repeat) + 1) % modes.length;
    repeat = modes[idx];
    emit('repeatchange', { repeat });
    return repeat;
  }

  function getCurrentTrack() { return currentTrack; }
  function getIsPlaying() { return isPlaying; }

  return { on, play, pause, playExternal, togglePlay, seek, seekRelative, setVolume, getVolume, setQueue, next, prev, toggleShuffle, toggleRepeat, getCurrentTrack, getIsPlaying };
})();
