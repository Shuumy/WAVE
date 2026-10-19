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

  async function convert(base, url, format, onStatus, provider = null) {
    const created = await jsonRequest(`${base}/api/imports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, format, provider: provider || null }),
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
    const direct = document.getElementById('audioLinkDirect');
    const download = document.getElementById('audioLinkDownload');
    const retry = document.getElementById('audioLinkSave');
    const providerStatus = document.getElementById('audioProviderStatus');
    const refresh = document.getElementById('audioProviderRefresh');
    const fields = [form.elements.url, form.elements.format, form.elements.provider];
    let objectUrl = null, file = null, busy = false, services = null;
    const selectedConfigured = () => services?.some(p => p.value === form.elements.provider.value && p.configured) === true;
    const updateControls = () => {
      submit.disabled = direct.disabled = busy || !selectedConfigured();
      fields.forEach(field => { field.disabled = busy; });
    };
    const clearResult = () => {
      if (busy) return;
      status.textContent = '';
      download.hidden = retry.hidden = true;
      file = null;
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      updateControls();
    };
    form.addEventListener('input', clearResult);
    form.addEventListener('change', clearResult);
    const loadServices = async () => {
      if (busy) return;
      services = null;
      updateControls();
      refresh.hidden = true;
      providerStatus.textContent = 'Vérification des services…';
      try {
        const data = await jsonRequest(`${base}/api/imports/config`);
        if (!Array.isArray(data.providers)) throw new Error('Invalid configuration');
        services = data.providers;
        for (const option of form.elements.provider.options) {
          const service = services.find(p => p.value === option.value);
          option.disabled = !service?.configured;
          option.textContent = `${service?.label || option.textContent.split(' — ')[0]}${option.disabled ? ' — indisponible' : ''}`;
        }
        if (!selectedConfigured()) form.elements.provider.value = services.find(p => p.configured)?.value || '';
        const missing = services.filter(p => p.value && !p.configured).map(p => p.label);
        providerStatus.textContent = missing.length
          ? `${missing.join(' et ')} indisponible${missing.length > 1 ? 's' : ''} : aucun serveur configuré pour WAVE. Leur sélection est désactivée.`
          : 'Services configurés. La récupération reste soumise à leur disponibilité.';
        if (!selectedConfigured()) providerStatus.textContent = 'Le téléchargement par lien est indisponible. Tu peux importer un fichier audio depuis ton appareil.';
        clearResult();
      } catch {
        providerStatus.textContent = 'Impossible de vérifier les services audio. Réessaie la vérification.';
        refresh.hidden = false;
      } finally { updateControls(); }
    };
    refresh.addEventListener('click', loadServices);
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
      if (busy || !selectedConfigured()) return;
      const downloadOnly = !event.submitter || event.submitter.value === 'download';
      busy = true; updateControls(); form.setAttribute('aria-busy', 'true');
      download.hidden = true; retry.hidden = true;
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      say('Connexion au service audio… Le premier démarrage peut prendre une minute.');
      try {
        file = await convert(base, form.elements.url.value.trim(), form.elements.format.value, say, form.elements.provider.value);
        objectUrl = URL.createObjectURL(file);
        download.href = objectUrl; download.download = file.name; download.hidden = false;
        if (downloadOnly) {
          retry.textContent = 'Ajouter aussi à la bibliothèque';
          retry.hidden = false;
          download.click();
          say('Fichier audio prêt. Si le téléchargement ne démarre pas, touche « Télécharger le fichier audio ».');
        } else {
          retry.textContent = 'Réessayer l’ajout à la bibliothèque';
          await save();
        }
      } catch (error) {
        say(error.name === 'TimeoutError' ? 'Le serveur met trop de temps à répondre. Réessaie dans une minute.' : error.message || 'Échec de l’import.');
      } finally {
        busy = false; updateControls(); form.setAttribute('aria-busy', 'false');
      }
    });
    return loadServices();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { convert, jsonRequest, init };
  else window.WaveAudioImport = { init };
})();
