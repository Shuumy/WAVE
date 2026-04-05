/** WAVE — SoundCloud player integration */
(() => {
  const W = window.WaveSC = window.WaveSC || {};
  const $ = W.$ || ((sel) => document.querySelector(sel));
  const $$ = W.$$ || ((sel) => document.querySelectorAll(sel));

  W.stopSCProgress = function stopSCProgress() {
    if (W.scProgressInterval) {
      clearInterval(W.scProgressInterval);
      W.scProgressInterval = null;
    }
  };

  W.startSCProgress = function startSCProgress() {
    W.stopSCProgress();
    if (!W.scWidget) return;
    const progressFill = $('#progressFill');
    const currentTimeEl = $('#currentTime');
    const totalTimeEl = $('#totalTime');
    W.scProgressInterval = setInterval(() => {
      W.scWidget.getPosition((position) => {
        W.scWidget.getDuration((duration) => {
          const currentTime = (position || 0) / 1000;
          const totalTime = (duration || 0) / 1000;
          if (!W.isDragging && totalTime > 0) {
            progressFill.style.width = `${(currentTime / totalTime) * 100}%`;
            currentTimeEl.textContent = W.formatDuration(currentTime);
            totalTimeEl.textContent = W.formatDuration(totalTime);
          }
        });
      });
    }, 500);
  };

  W.updateSCMediaSession = function updateSCMediaSession() {
    if (!W.scCurrentTrack || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: W.scCurrentTrack.title || 'SoundCloud',
      artist: W.scCurrentTrack.artist || 'SoundCloud',
      artwork: W.scCurrentTrack.thumbnail ? [{ src: W.scCurrentTrack.thumbnail, sizes: '500x500', type: 'image/jpeg' }] : [],
    });
    const btnPrev = $('#btnPrev');
    const btnNext = $('#btnNext');
    navigator.mediaSession.setActionHandler('previoustrack', () => btnPrev?.click());
    navigator.mediaSession.setActionHandler('nexttrack', () => btnNext?.click());
  };

  W.bindSCWidgetEvents = function bindSCWidgetEvents(widget) {
    const btnPlay = $('#btnPlay');
    widget.bind(SC.Widget.Events.READY, () => {
      try { widget.play(); } catch {}
      W.startSCProgress();
    });
    widget.bind(SC.Widget.Events.PLAY, () => {
      btnPlay?.classList.add('is-playing');
      W.startSCProgress();
    });
    widget.bind(SC.Widget.Events.PAUSE, () => {
      btnPlay?.classList.remove('is-playing');
      W.stopSCProgress();
    });
    widget.bind(SC.Widget.Events.FINISH, () => {
      if (W.scCurrentIndex < W.scSearchResults.length - 1) W.playSoundCloudResult(W.scCurrentIndex + 1);
      else {
        btnPlay?.classList.remove('is-playing');
        W.stopSCProgress();
      }
    });
  };

  W.exitSCMode = function exitSCMode() {
    W.scMode = false;
    W.scCurrentTrack = null;
    W.stopSCProgress();
    if (W.scWidget && typeof W.scWidget.pause === 'function') {
      try { W.scWidget.pause(); } catch {}
    }
    const playerFavorite = $('#playerFavorite');
    if (playerFavorite) playerFavorite.style.display = '';
    $$('.sc-result-item').forEach(el => el.classList.remove('yt-playing'));
    const frame = $('#scPlayer');
    if (frame) frame.src = 'about:blank';
  };

  W.playSoundCloudResult = async function playSoundCloudResult(index) {
    const item = W.scSearchResults[index];
    if (!item) return;

    if (item.type === 'external_search') {
      window.open(W.buildSoundCloudSearchUrl(item.query), '_blank', 'noopener');
      W.showToast('Recherche ouverte sur SoundCloud');
      return;
    }

    W.scMode = true;
    W.scCurrentIndex = index;
    W.scCurrentTrack = item;

    const btnPlay = $('#btnPlay');
    const playerTitle = $('#playerTitle');
    const playerArtist = $('#playerArtist');
    const playerArtwork = $('#playerArtwork');
    const playerFavorite = $('#playerFavorite');

    if (btnPlay?.classList.contains('is-playing')) {
      try { btnPlay.click(); } catch {}
    }

    if (playerTitle) playerTitle.textContent = item.title || '';
    if (playerArtist) playerArtist.textContent = item.artist || '';
    if (playerArtwork) {
      playerArtwork.innerHTML = '';
      if (item.thumbnail) {
        const img = document.createElement('img');
        img.src = item.thumbnail;
        img.alt = '';
        playerArtwork.appendChild(img);
      }
    }

    btnPlay?.classList.add('is-playing');
    if (playerFavorite) playerFavorite.style.display = 'none';
    $$('.sc-result-item').forEach(el => el.classList.remove('yt-playing'));
    const active = document.querySelector(`.sc-result-item[data-index="${index}"]`);
    if (active) active.classList.add('yt-playing');

    W.ensureSCWidgetScript();
    if (!(window.SC && typeof window.SC.Widget === 'function')) {
      W.showToast('Chargement du widget SoundCloud...');
      setTimeout(() => {
        if (window.SC && typeof window.SC.Widget === 'function') W.playSoundCloudResult(index);
        else W.showToast('Widget SoundCloud non prêt');
      }, 500);
      return;
    }

    const scPlayerContainer = $('#scPlayerContainer');
    if (!scPlayerContainer) return;
    const old = $('#scPlayer');
    if (old) old.remove();
    const iframe = document.createElement('iframe');
    iframe.id = 'scPlayer';
    iframe.title = 'SoundCloud player';
    iframe.allow = 'autoplay';
    iframe.frameBorder = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(item.permalinkUrl)}&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=false`;
    scPlayerContainer.appendChild(iframe);

    W.scWidget = SC.Widget(iframe);
    W.bindSCWidgetEvents(W.scWidget);
    W.updateSCMediaSession();
  };

  W.seekSoundCloudFromPointer = function seekSoundCloudFromPointer(event) {
    if (!W.scMode || !W.scWidget) return false;
    const progressBar = $('#progressBar');
    const progressFill = $('#progressFill');
    if (!progressBar || !progressFill) return false;
    const rect = progressBar.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    W.scWidget.getDuration((duration) => {
      if (duration > 0) {
        W.scWidget.seekTo(duration * fraction);
        progressFill.style.width = `${fraction * 100}%`;
      }
    });
    return true;
  };

  W.bindGlobalControls = function bindGlobalControls() {
    const btnPlay = $('#btnPlay');
    const btnPrev = $('#btnPrev');
    const btnNext = $('#btnNext');
    const progressBar = $('#progressBar');
    if (!btnPlay || !btnPrev || !btnNext || !progressBar) return;

    btnPlay.addEventListener('click', (e) => {
      if (!W.scMode) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (W.scWidget && typeof W.scWidget.isPaused === 'function') {
        W.scWidget.isPaused((paused) => {
          if (paused) W.scWidget.play();
          else W.scWidget.pause();
        });
      }
    }, true);

    btnPrev.addEventListener('click', (e) => {
      if (!W.scMode) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (W.scCurrentIndex > 0) W.playSoundCloudResult(W.scCurrentIndex - 1);
    }, true);

    btnNext.addEventListener('click', (e) => {
      if (!W.scMode) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (W.scCurrentIndex < W.scSearchResults.length - 1) W.playSoundCloudResult(W.scCurrentIndex + 1);
    }, true);

    document.addEventListener('keydown', (e) => {
      if (!W.scMode) return;
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        btnPlay.click();
      }
    }, true);

    progressBar.addEventListener('mousedown', (e) => {
      if (!W.scMode) return;
      W.isDragging = true;
      W.seekSoundCloudFromPointer(e);
      const move = (ev) => W.seekSoundCloudFromPointer(ev);
      const up = () => {
        W.isDragging = false;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);

    progressBar.addEventListener('touchstart', (e) => {
      if (!W.scMode) return;
      W.isDragging = true;
      W.seekSoundCloudFromPointer(e);
      e.stopImmediatePropagation();
      e.preventDefault();
    }, { capture: true, passive: false });

    progressBar.addEventListener('touchmove', (e) => {
      if (!W.scMode || !W.isDragging) return;
      W.seekSoundCloudFromPointer(e);
      e.stopImmediatePropagation();
      e.preventDefault();
    }, { capture: true, passive: false });

    progressBar.addEventListener('touchend', (e) => {
      if (!W.scMode) return;
      W.isDragging = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, { capture: true, passive: false });

    document.addEventListener('click', (e) => {
      if (!W.scMode) return;
      if (e.target.closest('.track-item') || e.target.closest('.yt-result-item:not(.sc-result-item)')) {
        W.exitSCMode();
      }
    }, true);
  };

  W.initSoundCloud = function initSoundCloud() {
    if (!W.injectSoundCloudUI()) return;
    W.bindGlobalControls();
    W.ensureSCWidgetScript();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', W.initSoundCloud, { once: true });
  } else {
    W.initSoundCloud();
  }

  window.addEventListener('pageshow', W.ensureSCWidgetScript);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) W.ensureSCWidgetScript();
  });
})();
