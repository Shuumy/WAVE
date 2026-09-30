// Local-only UI localization. Music metadata and user input are never translated.
const WaveI18n = (() => {
  let preference = 'fr', locale = 'fr', database, observer;
  const sources = new WeakMap();
  const protectedContent = '.track-title,.track-artist,.playlist-card-name,.options-track-name,.options-track-artist,.organizer-track,.rating-track,#playlistNameSpan,#playlistCompactName,#playerTitle,#playerArtist,#nowPlayingTitle,#nowPlayingArtist,input,textarea,[translate="no"],.motion-frame';
  // Deliberate allowlist: never walk and replace arbitrary text throughout the app.
  const chrome = '.nav-btn span,.view-title,.section-title,.tab-btn,.empty-state,.sort-pill span,.sort-sheet h3,.sort-sheet-option,.shuffle-section-btn,.settings-header h3,.settings-entry strong,.settings-theme-choice,.settings-legal-link,.settings-back,#settingsPanelTitle,.dropzone-text,.dropzone-or,.import-btn,.organizer-head button,.organizer-head h3,.organizer-foot button,.playlist-back-btn,#playlistShuffleBtn,#playlistAddTracksBtn,.options-item-label,.modal-header h3,.modal-create-btn,.confirm-yes,.confirm-no,.rating-actions button,.rating-dialog h2,[data-i18n]';
  const aliases = { '‹ Retour':'Retour','Lire en aléatoire':'Aléatoire','Personnalisé':'Tri personnalisé','Ordre personnalisé':'Tri personnalisé','Renommer la playlist':'Renommer','Supprimer la playlist':'Supprimer','Modifier le titre':'Titre','Modifier l’artiste':'Artiste','Enregistrer':'Sauvegarder','Nom de la playlist:':'Nouvelle playlist','Trier les morceaux':'Trier','Rechercher dans la bibliothèque':'Rechercher dans la bibliothèque...','Rechercher sur YouTube':'Rechercher sur YouTube...','Lancer la recherche YouTube':'Rechercher','Favori':'Favoris','Ajouter à une playlist':'Ajouter des morceaux' };
  function resolve(code) {
    if (typeof code !== 'string') return null;
    code = code.replace(/_/g,'-').toLowerCase();
    const exact = WaveLocales.definitions.find(([id]) => id.toLowerCase() === code);
    if (exact) return exact[0];
    if (code.startsWith('zh-')) {
      if (code.split('-').includes('hans')) return 'zh-Hans';
      if (code.split('-').includes('hant')) return 'zh-Hant';
      return /(?:tw|hk|mo)(?:-|$)/.test(code) ? 'zh-Hant' : 'zh-Hans';
    }
    if (code === 'zh') return 'zh-Hans';
    if (code.startsWith('pt-')) return code.split('-')[1] === 'br' ? 'pt-BR' : 'pt-PT';
    if (code === 'pt') return 'pt-PT';
    if (code === 'no' || code.startsWith('no-')) return 'nb';
    const base = code.split('-')[0];
    return Object.hasOwn(WaveLocales.catalogs,base) ? base : null;
  }
  function deviceLocale(languages) {
    for (const code of languages || []) { const match = resolve(code); if (match) return match; }
    return 'fr';
  }
  function t(source) {
    if (typeof source !== 'string') return source;
    const trimmed = source.trim();
    const key = Object.hasOwn(aliases,trimmed) ? aliases[trimmed] : trimmed;
    const catalog = WaveLocales.catalogs[locale];
    return Object.hasOwn(catalog,key) ? catalog[key] : source;
  }
  function translateNode(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(protectedContent) || !parent.closest(chrome)) return;
    const current = node.nodeValue;
    const saved = sources.get(node);
    const source = saved && saved.output === current ? saved.source : current;
    // Keep sort checks/arrows and add buttons, without changing user-authored labels.
    const match = source.match(/^(\s*[+✓]?\s*)(.*?)(\s*[↑↓]?\s*)$/s);
    const output = match ? match[1] + t(match[2]) + match[3] : t(source);
    sources.set(node,{source,output});
    if (current !== output) node.nodeValue = output;
  }
  function translateAttributes(element) {
    if (element.closest(protectedContent) && !element.matches('input')) return;
    for (const name of ['title','aria-label','placeholder']) {
      if (!element.hasAttribute(name)) continue;
      let saved = sources.get(element);
      if (!saved) { saved = {}; sources.set(element,saved); }
      const current = element.getAttribute(name), prior = saved[name];
      const source = prior && prior.output === current ? prior.source : current;
      const output = t(source); saved[name] = {source,output};
      if (current !== output) element.setAttribute(name,output);
    }
  }
  function apply(root = document.body) {
    if (root.nodeType === 3) { translateNode(root); return; }
    if (root.nodeType !== 1 || root.closest('.motion-frame,[translate="no"]')) return;
    translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) translateNode(node); else translateAttributes(node);
    }
  }
  function activate() {
    locale = preference === 'system' ? deviceLocale(navigator.languages || [navigator.language]) : preference;
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    apply();
    window.dispatchEvent(new CustomEvent('wave:language-changed',{ detail:{locale,preference} }));
  }
  async function setLanguage(value) {
    if (value !== 'system' && !Object.hasOwn(WaveLocales.catalogs,value)) throw new Error('Unsupported language');
    // Save first: a storage error must not falsely show a persisted selection.
    await database.setSetting('language',value);
    preference = value; activate();
  }
  async function init(db) {
    database = db;
    const saved = await db.getSetting('language');
    preference = saved === 'system' || Object.hasOwn(WaveLocales.catalogs,saved) ? saved : 'fr';
    activate();
    observer = new MutationObserver(records => {
      const roots = new Set();
      for (const record of records) {
        if (record.type === 'characterData') roots.add(record.target);
        else if (record.type === 'attributes') roots.add(record.target);
        else record.addedNodes.forEach(node => roots.add(node));
      }
      for (const root of roots) if (root.isConnected) apply(root);
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder']});
    window.addEventListener('languagechange',() => { if (preference === 'system') activate(); });
  }
  function renderPicker(host) {
    const description = document.createElement('p');
    description.className = 'language-note'; description.lang = 'fr'; description.translate = false;
    description.textContent = 'Traduction de l’interface principale. Certains messages secondaires et les textes juridiques restent en français. Les noms de tes morceaux ne changent pas.';
    const search = document.createElement('input'); search.type = 'search'; search.className = 'language-search';
    search.placeholder = 'Rechercher une langue'; search.setAttribute('aria-label','Rechercher une langue'); search.autocomplete = 'off';
    const list = document.createElement('fieldset'); list.className = 'language-list';
    const legend = document.createElement('legend'); legend.dataset.i18n = ''; legend.textContent = 'Langues'; list.appendChild(legend);
    const status = document.createElement('p'); status.setAttribute('role','status'); status.className = 'language-note';
    const rows = [];
    for (const [id,native,french] of [['system','Langue de l’appareil','Automatique'], ...WaveLocales.definitions]) {
      const row = document.createElement('label'); row.className = 'language-choice';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'interface-language'; radio.value = id;
      radio.checked = preference === id;
      const names = document.createElement('span');
      const name = document.createElement('bdi'); name.textContent = native;
      if (id === 'system') name.dataset.i18n = ''; else { name.lang = id; name.translate = false; }
      const subtitle = document.createElement('small'); subtitle.lang = 'fr'; subtitle.translate = false; subtitle.textContent = french;
      names.append(name,subtitle); row.append(names,radio); list.appendChild(row);
      radio.addEventListener('change',async () => {
        list.disabled = true;
        try {
          await setLanguage(id);
          // No reload or media restart; focus stays on the selected radio.
          rows.forEach(item => item.radio.checked = preference === item.id);
          status.textContent = '';
        } catch {
          rows.forEach(item => item.radio.checked = preference === item.id);
          status.lang = 'fr'; status.textContent = 'Impossible d’enregistrer la langue. Réessaie.';
        } finally {
          list.disabled = false;
          if (host.isConnected) radio.focus({preventScroll:true});
        }
      });
      rows.push({id,row,radio,text:`${native} ${french} ${id}`});
    }
    const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
    search.addEventListener('input',() => {
      const query = normalize(search.value.trim());
      rows.forEach(item => item.row.hidden = !normalize(item.text).includes(query));
      status.textContent = rows.some(item => !item.row.hidden) ? '' : t('Aucun résultat.');
    });
    host.replaceChildren(description,search,list,status); apply(host);
  }
  return { init,t,apply,renderPicker,setLanguage,resolve,deviceLocale,get locale() { return locale; },get preference() { return preference; } };
})();
