/* WAVE: link -> server job -> audio -> existing offline library. */
(() => {
  'use strict';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function jsonRequest(url, options = {}) {
    const response = await fetch(url, { ...options, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000) });
    let data;
    try { data = await response.json(); } catch { throw new Error('Le serveur audio ne répond pas correctement. Réessaie dans un instant.'); }
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Le lien ou le format est invalide.');
    return data;
  }

  async function convert(base, url, format, onStatus) {
    const created = await jsonRequest(`${base}/api/imports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, format }),
    });
    const id = encodeURIComponent(created.id);
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      const job = await jsonRequest(`${base}/api/imports/${id}`);
      onStatus(job.message || 'En attente…');
      if (job.state === 'failed') throw new Error(job.message);
      if (job.state === 'ready') {
        const response = await fetch(`${base}/api/imports/${id}/file`, {
          cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(120000),
        });
        if (!response.ok) throw new Error('Le fichier a expiré ou son téléchargement a échoué. Relance la conversion.');
        const blob = await response.blob();
        if (!blob.size || blob.size > 100 * 1024 * 1024 || !blob.type.startsWith('audio/')) throw new Error('Le serveur n’a pas renvoyé un fichier audio valide.');
        // The browser now owns the audio; free the server slot immediately.
        fetch(`${base}/api/imports/${id}`, { method: 'DELETE', credentials: 'omit', signal: AbortSignal.timeout(10000) }).catch(() => {});
        const stem = [job.artist, job.title].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180) || 'audio';
        return new File([blob], `${stem}.${format}`, { type: blob.type });
      }
      await sleep(2000);
    }
    throw new Error('Le traitement prend trop de temps. Réessaie plus tard.');
  }

  function init(base, saveFile) {
    const form = document.getElementById('audioLinkForm');
    if (!form) return;
    const status = document.getElementById('audioLinkStatus');
    const submit = document.getElementById('audioLinkSubmit');
    const download = document.getElementById('audioLinkDownload');
    const retry = document.getElementById('audioLinkSave');
    let objectUrl = null, file = null, busy = false;
    const say = text => { status.textContent = text; };
    const save = async () => {
      retry.disabled = true;
      try {
        const count = await saveFile([file]);
        if (count !== 1) throw new Error('L’ajout à la bibliothèque a échoué.');
        say('Audio ajouté à ta bibliothèque hors ligne. Tu peux aussi télécharger le fichier.');
        retry.hidden = true;
      } catch {
        say('Le fichier est prêt, mais la sauvegarde hors ligne a échoué. Télécharge-le ou réessaie l’ajout.');
        retry.hidden = false;
      } finally { retry.disabled = false; }
    };
    retry.addEventListener('click', save);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      busy = true; submit.disabled = true; form.setAttribute('aria-busy', 'true');
      download.hidden = true; retry.hidden = true;
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      say('Connexion au service audio… Le premier démarrage peut prendre une minute.');
      try {
        file = await convert(base, form.elements.url.value.trim(), form.elements.format.value, say);
        objectUrl = URL.createObjectURL(file);
        download.href = objectUrl; download.download = file.name; download.hidden = false;
        await save();
      } catch (error) {
        say(error.name === 'TimeoutError' ? 'Le serveur met trop de temps à répondre. Réessaie dans une minute.' : error.message || 'Échec de l’import.');
      } finally {
        busy = false; submit.disabled = false; form.setAttribute('aria-busy', 'false');
      }
    });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { convert, jsonRequest };
  else window.WaveAudioImport = { init };
})();
