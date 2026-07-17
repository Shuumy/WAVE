/** WAVE — Notes personnelles de 0,5 à 5 étoiles. */
(() => {
  'use strict';

  let ratings = new Map();
  let selectedTrackId = null;
  let draftRating = null;
  let refreshPending = false;

  const format = value => Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const getTracks = () => DB.getUserTracks();
  const currentTrack = () => {
    try { return Player.getCurrentTrack(); } catch { return null; }
  };

  async function loadRatings() {
    ratings = new Map((await DB.getRatings()).map(item => [item.id, item.value]));
  }

  function createModal() {
    if (document.getElementById('ratingModal')) return;
    const modal = document.createElement('div');
    modal.id = 'ratingModal';
    modal.className = 'rating-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <section class="rating-dialog" role="dialog" aria-modal="true" aria-labelledby="ratingTitle">
        <button type="button" class="rating-close" aria-label="Fermer">×</button>
        <img class="rating-artwork" alt="">
        <h2 id="ratingTitle">Noter ce morceau</h2>
        <p class="rating-track"></p>
        <div class="rating-choices" role="radiogroup" aria-label="Note sur 5"></div>
        <output class="rating-output">Aucune note</output>
        <div class="rating-actions">
          <button type="button" class="rating-delete">Supprimer la note</button>
          <button type="button" class="rating-confirm">Valider</button>
        </div>
      </section>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('.rating-close')) closeModal();
    });
    modal.querySelector('.rating-confirm').addEventListener('click', saveRating);
    modal.querySelector('.rating-delete').addEventListener('click', deleteRating);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !modal.hidden) closeModal();
    });
  }

  function renderChoices() {
    const modal = document.getElementById('ratingModal');
    const choices = modal.querySelector('.rating-choices');
    choices.innerHTML = '';
    for (let step = 1; step <= 10; step++) {
      const value = step / 2;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rating-choice';
      if (draftRating !== null && value <= draftRating) button.classList.add('selected');
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(draftRating === value));
      button.setAttribute('aria-label', `Noter ${format(value)} sur 5`);
      button.title = `${format(value)} / 5`;
      button.textContent = step % 2 ? '◐' : '★';
      button.addEventListener('click', () => {
        draftRating = value;
        renderChoices();
      });
      choices.appendChild(button);
    }
    modal.querySelector('.rating-output').textContent = draftRating === null
      ? 'Aucune note'
      : `★ ${format(draftRating)} / 5`;
    modal.querySelector('.rating-delete').hidden = !ratings.has(selectedTrackId);
  }

  async function openModal(trackId) {
    createModal();
    const track = (await getTracks()).find(item => item.id === trackId);
    if (!track) return;
    selectedTrackId = trackId;
    draftRating = ratings.get(trackId) ?? null;
    const modal = document.getElementById('ratingModal');
    modal.querySelector('.rating-track').textContent = `${track.artist || 'Artiste inconnu'} — ${track.title || 'Sans titre'}`;
    const artwork = modal.querySelector('.rating-artwork');
    artwork.src = track.coverArt || './assets/icons/icon-192-v2.png';
    artwork.alt = `Pochette de ${track.title || 'ce morceau'}`;
    renderChoices();
    modal.hidden = false;
    modal.querySelector('.rating-choice')?.focus();
  }

  function closeModal() {
    const modal = document.getElementById('ratingModal');
    if (modal) modal.hidden = true;
    selectedTrackId = null;
    draftRating = null;
  }

  async function saveRating() {
    if (!selectedTrackId || draftRating === null) return;
    const id = selectedTrackId;
    const value = await DB.setRating(id, draftRating);
    ratings.set(id, value);
    closeModal();
    scheduleRefresh();
  }

  async function deleteRating() {
    if (!selectedTrackId) return;
    const id = selectedTrackId;
    await DB.removeRating(id);
    ratings.delete(id);
    closeModal();
    scheduleRefresh();
  }

  function decorateTracks() {
    document.querySelectorAll('.track-item[data-track-id]').forEach(row => {
      row.querySelector('.track-rating-badge')?.remove();
      const value = ratings.get(row.dataset.trackId);
      if (value === undefined) return;
      const actions = row.querySelector('.track-actions');
      if (!actions) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'track-rating-badge';
      button.textContent = `★ ${format(value)}`;
      button.setAttribute('aria-label', `Note ${format(value)} sur 5. Modifier.`);
      button.addEventListener('click', event => {
        event.stopPropagation();
        openModal(row.dataset.trackId);
      });
      actions.insertBefore(button, actions.firstChild);
    });
  }

  function ensurePlayerRating() {
    const host = document.querySelector('.player-track-info');
    if (!host) return;
    let button = document.getElementById('playerRating');
    if (!button) {
      button = document.createElement('button');
      button.id = 'playerRating';
      button.type = 'button';
      button.className = 'player-rating';
      button.addEventListener('click', event => {
        event.stopPropagation();
        const track = currentTrack();
        if (track?.id) openModal(track.id);
      });
      host.appendChild(button);
    }
    const track = currentTrack();
    const value = track?.id ? ratings.get(track.id) : undefined;
    button.disabled = !track?.id;
    button.textContent = value === undefined ? '☆ Noter' : `★ ${format(value)}`;
    button.setAttribute('aria-label', value === undefined ? 'Noter le morceau en cours' : `Note ${format(value)} sur 5. Modifier.`);
  }

  function injectOptionsItem() {
    const list = document.getElementById('optionsList');
    if (!list || !selectedTrackId || list.querySelector('.rating-option')) return;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'options-item rating-option';
    item.innerHTML = '<span class="rating-option-icon" aria-hidden="true">★</span><span>Noter ce morceau</span>';
    item.addEventListener('click', () => {
      const overlay = document.getElementById('optionsOverlay');
      if (overlay) overlay.hidden = true;
      openModal(selectedTrackId);
    });
    list.insertBefore(item, list.firstChild);
  }

  function ensureRatingSort() {
    document.querySelectorAll('.sort-row').forEach(row => {
      if (row.querySelector('[data-rating-sort]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sort-btn';
      button.dataset.ratingSort = 'desc';
      button.textContent = 'Note ↓';
      button.addEventListener('click', () => {
        const desc = button.dataset.ratingSort === 'desc';
        button.dataset.ratingSort = desc ? 'asc' : 'desc';
        button.textContent = desc ? 'Note ↑' : 'Note ↓';
        const list = row.parentElement?.querySelector('.track-list');
        if (!list) return;
        [...list.querySelectorAll('.track-item-wrap')]
          .sort((a, b) => {
            const av = ratings.get(a.querySelector('.track-item')?.dataset.trackId) ?? -1;
            const bv = ratings.get(b.querySelector('.track-item')?.dataset.trackId) ?? -1;
            return desc ? av - bv : bv - av;
          })
          .forEach(item => list.appendChild(item));
      });
      row.appendChild(button);
    });
  }

  async function renderRatedTab() {
    const active = document.querySelector('.library-tabs .tab-btn.active');
    if (active?.dataset.tab !== 'rated') return;
    const content = document.getElementById('libraryContent');
    if (!content) return;
    const tracks = (await getTracks())
      .filter(track => ratings.has(track.id))
      .sort((a, b) => ratings.get(b.id) - ratings.get(a.id));
    content.innerHTML = '<div class="rated-header"><strong>Morceaux notés</strong><button type="button" id="ratedDirection">Meilleures notes d’abord</button></div><div class="rated-list"></div>';
    const list = content.querySelector('.rated-list');
    const draw = ordered => {
      list.innerHTML = '';
      if (!ordered.length) {
        list.innerHTML = '<p class="empty-state">Aucun morceau noté.</p>';
        return;
      }
      ordered.forEach((track, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'rated-item';
        const image = document.createElement('img');
        image.src = track.coverArt || './assets/icons/icon-192-v2.png';
        image.alt = '';
        const text = document.createElement('span');
        text.className = 'rated-copy';
        const title = document.createElement('strong');
        title.textContent = track.title || 'Sans titre';
        const artist = document.createElement('small');
        artist.textContent = track.artist || 'Artiste inconnu';
        text.append(title, artist);
        const score = document.createElement('span');
        score.className = 'rated-score';
        score.textContent = `★ ${format(ratings.get(track.id))}`;
        item.append(image, text, score);
        item.addEventListener('click', () => {
          Player.setQueue(ordered, index);
          Player.play(track);
        });
        item.addEventListener('contextmenu', event => {
          event.preventDefault();
          openModal(track.id);
        });
        list.appendChild(item);
      });
    };
    draw(tracks);
    let descending = true;
    content.querySelector('#ratedDirection').addEventListener('click', event => {
      descending = !descending;
      event.currentTarget.textContent = descending ? 'Meilleures notes d’abord' : 'Notes les plus basses d’abord';
      draw([...tracks].sort((a, b) => (ratings.get(b.id) - ratings.get(a.id)) * (descending ? 1 : -1)));
    });
  }

  function bindRatedTab() {
    const tab = document.querySelector('.library-tabs [data-tab="rated"]');
    if (!tab || tab.dataset.ratingsBound) return;
    tab.dataset.ratingsBound = 'true';
    tab.addEventListener('click', () => setTimeout(renderRatedTab, 0));
  }

  function scheduleRefresh() {
    if (refreshPending) return;
    refreshPending = true;
    setTimeout(() => {
      refreshPending = false;
      decorateTracks();
      ensurePlayerRating();
      injectOptionsItem();
      ensureRatingSort();
      bindRatedTab();
      renderRatedTab();
    }, 40);
  }

  document.addEventListener('click', event => {
    const options = event.target.closest('.track-options-btn');
    if (options) selectedTrackId = options.closest('.track-item')?.dataset.trackId || null;
  }, true);

  new MutationObserver(scheduleRefresh).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'hidden'],
  });
  setInterval(ensurePlayerRating, 750);

  async function init() {
    try {
      await loadRatings();
      createModal();
      scheduleRefresh();
    } catch (error) {
      console.error('Impossible d’initialiser les notes WAVE', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
