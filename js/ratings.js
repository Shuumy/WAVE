/** WAVE — Notes personnelles de 0,5 à 5 étoiles. */
(() => {
  'use strict';

  let ratings = new Map();
  let selectedTrackId = null;
  let draftRating = null;
  let refreshPending = false;

  const format = value => Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const getTracks = () => DB.getUserTracks();
  window.WaveRatings = { getValue: id => ratings.get(id) };

  async function loadRatings() {
    ratings = new Map((await DB.getRatings()).map(item => [item.id, item.value]));
    window.dispatchEvent(new Event('wave:ratings-changed'));
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
    window.dispatchEvent(new Event('wave:ratings-changed'));
    scheduleRefresh();
  }

  async function deleteRating() {
    if (!selectedTrackId) return;
    const id = selectedTrackId;
    await DB.removeRating(id);
    ratings.delete(id);
    closeModal();
    window.dispatchEvent(new Event('wave:ratings-changed'));
    scheduleRefresh();
  }

  function decorateTracks() {
    document.querySelectorAll('.track-item[data-track-id]').forEach(row => {
      let button = row.querySelector('.track-rating-badge');
      const value = ratings.get(row.dataset.trackId);
      if (value === undefined) { button?.remove(); return; }
      const actions = row.querySelector('.track-actions');
      if (!actions) return;
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'track-rating-badge';
        button.addEventListener('click', event => {
          event.stopPropagation();
          openModal(row.dataset.trackId);
        });
        actions.insertBefore(button, actions.firstChild);
      }
      const label = `Note ${format(value)} sur 5. Modifier.`;
      if (button.textContent !== `★ ${format(value)}`) button.textContent = `★ ${format(value)}`;
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
    });
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

  function scheduleRefresh() {
    if (refreshPending) return;
    refreshPending = true;
    setTimeout(() => {
      refreshPending = false;
      decorateTracks();
      injectOptionsItem();
    }, 40);
  }

  document.addEventListener('click', event => {
    const options = event.target.closest('.track-options-btn');
    if (options) selectedTrackId = options.closest('.track-item')?.dataset.trackId || null;
  }, true);

  new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target || target.closest('.rating-modal,.track-rating-badge')) return false;
      return Boolean(target.closest('.track-list,#libraryContent,#optionsList'));
    });
    if (relevant) scheduleRefresh();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'hidden'],
  });

  async function init() {
    try {
      await DB.open();
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
