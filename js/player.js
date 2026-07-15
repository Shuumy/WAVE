/**
 * Audio Player Engine
 */
const Player = (() => {
  const audio = new Audio();
  audio.playsInline = true;
  audio.setAttribute('playsinline', '');
  audio.preload = 'auto';

  const hasMediaSession = 'mediaSession' in navigator && 'MediaMetadata' in window;
  const fallbackArtwork = new URL('./assets/icons/icon-512-v2.png', window.location.href).href;

  let currentTrack = null;
  let queue = [];
  let queueIndex = -1;
  let isPlaying = false;
  let shuffle = false;
  let repeat = 'none';
  let audioUnlocked = false;
  let audioCtx = null;
  const listeners = {};

  function unlockAudio() {
    if (audioUnlocked) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = audioCtx.createBuffer(1, 1, 22050);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);
    audioCtx.resume().then(() => { audioUnlocked = true; });
    audio.play().then(() => audio.pause()).catch(() => {});
    document.removeEventListener('touchstart', unlockAudio, true);
    document.removeEventListener('click', unlockAudio, true);
  }

  async function ensureAudioContextActive() {
    if (audioCtx && audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch (_) {}
    }
  }

  function setMediaPlaybackState(state) {
    if (!hasMediaSession) return;
    try { navigator.mediaSession.playbackState = state; } catch (_) {}
  }

  function mediaArtwork(track) {
    const artwork = [];
    const cover = typeof track?.coverArt === 'string' ? track.coverArt.trim() : '';
    if (/^(https?:|blob:|data:image\/)/i.test(cover)) artwork.push({ src: cover });
    if (cover !== fallbackArtwork) {
      artwork.push({ src: fallbackArtwork, sizes: '512x512', type: 'image/png' });
    }
    return artwork;
  }

  function updateMediaMetadata(track) {
    if (!hasMediaSession) return;
    const metadata = {
      title: track?.title || 'WAVE',
      artist: track?.artist || 'Lecture audio',
      album: track?.album || 'WAVE',
      artwork: mediaArtwork(track),
    };
    try {
      navigator.mediaSession.metadata = new MediaMetadata(metadata);
    } catch (_) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          ...metadata,
          artwork: [{ src: fallbackArtwork, sizes: '512x512', type: 'image/png' }],
        });
      } catch (_) {}
    }
  }

  function updateMediaPosition() {
    if (!hasMediaSession || typeof navigator.mediaSession.setPositionState !== 'function') return;
    const duration = audio.duration;
    const position = audio.currentTime;
    const playbackRate = audio.playbackRate || 1;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate,
        position: Math.min(Math.max(position, 0), duration),
      });
    } catch (_) {}
  }

  function registerMediaAction(action, handler) {
    if (!hasMediaSession) return;
    try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {}
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureAudioContextActive();
  });
  document.addEventListener('touchstart', unlockAudio, true);
  document.addEventListener('click', unlockAudio, true);

  audio.addEventListener('timeupdate', () => {
    emit('timeupdate', { currentTime: audio.currentTime, duration: audio.duration || 0 });
    updateMediaPosition();
  });
  audio.addEventListener('durationchange', updateMediaPosition);
  audio.addEventListener('ratechange', updateMediaPosition);
  audio.addEventListener('seeked', updateMediaPosition);

  audio.addEventListener('ended', () => {
    if (repeat === 'one') {
      audio.currentTime = 0;
      audio.play();
    } else {
      next();
    }
  });

  audio.addEventListener('play', () => {
    isPlaying = true;
    setMediaPlaybackState('playing');
    updateMediaPosition();
    emit('statechange', { playing: true });
  });
  audio.addEventListener('pause', () => {
    isPlaying = false;
    setMediaPlaybackState('paused');
    updateMediaPosition();
    emit('statechange', { playing: false });
  });
  audio.addEventListener('error', (event) => {
    console.error('Audio error:', event);
    setMediaPlaybackState('none');
    emit('error', { message: 'Erreur de lecture audio' });
  });

  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
  }

  function emit(event, data) {
    if (listeners[event]) listeners[event].forEach(callback => callback(data));
  }

  async function loadTrack(track) {
    currentTrack = track;
    emit('trackchange', track);
    const blob = await DB.getUserAudioBlob(track.id);
    if (!blob) {
      emit('error', { message: 'Fichier audio introuvable' });
      return false;
    }
    if (audio.src && audio.src.startsWith('blob:')) {
      try { URL.revokeObjectURL(audio.src); } catch (_) {}
    }
    audio.src = URL.createObjectURL(blob);
    updateMediaMetadata(track);
    DB.addRecent(track.id);
    return true;
  }

  async function play(track) {
    if (track) {
      const loaded = await loadTrack(track);
      if (!loaded) return;
    }
    await ensureAudioContextActive();
    try { await audio.play(); } catch (error) { console.error('Play failed:', error); }
  }

  async function playExternal(url) {
    if (audio.src && audio.src.startsWith('blob:')) {
      try { URL.revokeObjectURL(audio.src); } catch (_) {}
    }
    currentTrack = null;
    audio.src = url;
    audio.load();
    updateMediaMetadata(null);
    await ensureAudioContextActive();
    try {
      await audio.play();
      return true;
    } catch (error) {
      console.error('playExternal failed:', error);
      emit('error', { message: 'Erreur de lecture audio' });
      return false;
    }
  }

  function pause() { audio.pause(); }

  async function togglePlay() {
    if (isPlaying) {
      pause();
      return;
    }
    if (audio.src) {
      await ensureAudioContextActive();
      audio.play().catch((error) => {
        console.error('Resume failed:', error);
        emit('error', { message: 'Impossible de reprendre la lecture' });
      });
    }
  }

  function seek(fraction) {
    if (audio.duration) audio.currentTime = fraction * audio.duration;
  }

  function seekRelative(seconds) {
    if (audio.duration) {
      audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
    }
  }

  function setVolume(volume) {
    audio.volume = Math.max(0, Math.min(1, volume));
    emit('volumechange', { volume: audio.volume });
  }

  function getVolume() { return audio.volume; }
  function setQueue(tracks, startIndex = 0) { queue = [...tracks]; queueIndex = startIndex; }

  function next() {
    if (queue.length === 0) return;
    if (shuffle) {
      let newIndex;
      do { newIndex = Math.floor(Math.random() * queue.length); }
      while (newIndex === queueIndex && queue.length > 1);
      queueIndex = newIndex;
    } else {
      queueIndex++;
      if (queueIndex >= queue.length) {
        if (repeat === 'all') queueIndex = 0;
        else {
          queueIndex = queue.length - 1;
          pause();
          return;
        }
      }
    }
    play(queue[queueIndex]);
  }

  function prev() {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (queue.length === 0) return;
    queueIndex--;
    if (queueIndex < 0) queueIndex = repeat === 'all' ? queue.length - 1 : 0;
    play(queue[queueIndex]);
  }

  function toggleShuffle() {
    shuffle = !shuffle;
    emit('shufflechange', { shuffle });
    return shuffle;
  }

  function toggleRepeat() {
    const modes = ['none', 'all', 'one'];
    const index = (modes.indexOf(repeat) + 1) % modes.length;
    repeat = modes[index];
    emit('repeatchange', { repeat });
    return repeat;
  }

  function getCurrentTrack() { return currentTrack; }
  function getIsPlaying() { return isPlaying; }

  registerMediaAction('play', () => play());
  registerMediaAction('pause', pause);
  registerMediaAction('previoustrack', prev);
  registerMediaAction('nexttrack', next);
  registerMediaAction('seekbackward', details => seekRelative(-(details.seekOffset || 10)));
  registerMediaAction('seekforward', details => seekRelative(details.seekOffset || 10));
  registerMediaAction('seekto', details => {
    if (!Number.isFinite(details.seekTime) || !audio.duration) return;
    const position = Math.max(0, Math.min(audio.duration, details.seekTime));
    if (details.fastSeek && typeof audio.fastSeek === 'function') audio.fastSeek(position);
    else audio.currentTime = position;
  });
  registerMediaAction('stop', () => {
    pause();
    audio.currentTime = 0;
  });

  return {
    on,
    play,
    pause,
    playExternal,
    togglePlay,
    seek,
    seekRelative,
    setVolume,
    getVolume,
    setQueue,
    next,
    prev,
    toggleShuffle,
    toggleRepeat,
    getCurrentTrack,
    getIsPlaying,
  };
})();
