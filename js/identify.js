const WaveIdentify = (() => {
  let db, api, onUpdate, readMetadata, busy=false, timer, preferences={enabled:true,audio:true};
  const clean = value => String(value || '').replace(/\.(mp3|m4a|flac|wav|ogg|aac|opus|webm)$/i,'')
    .replace(/\s*[\[(](?:official\s*(?:music\s*)?(?:video|audio)|lyrics?|visuali[sz]er|\d{3,4}p)[\])]\s*/gi,' ')
    .replace(/\s+/g,' ').trim();
  function name(fileName) {
    const parts=clean(fileName).split(/\s+[-–—]\s+/);
    return parts.length===2 ? {title:parts[1],artist:parts[0]} : {title:clean(fileName),artist:'Artiste inconnu'};
  }
  function initial(track) {
    return {originalMetadata:{title:track.title,artist:track.artist},metadataLocked:false,
      identification:{status:'pending',attempts:0,nextAttempt:0}};
  }
  async function request(path, options={}) {
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),90000);
    try {
      const response=await fetch(api+path,{...options,signal:controller.signal,credentials:'omit'});
      if(!response.ok) {const error=new Error(`HTTP ${response.status}`);error.status=response.status;throw error;}
      return await response.json();
    } finally {clearTimeout(timeout);}
  }
  function validMatch(match) {
    return match && typeof match.title==='string' && match.title.trim() && match.title.length<=200
      && typeof match.artist==='string' && match.artist.trim() && match.artist.length<=200;
  }
  async function identify(track) {
    if(track.metadataSource==='filename' && !track.identification.tagsChecked && readMetadata) {
      const blob=await db.getUserAudioBlob(track.id);
      if(blob) {
        const tags=await readMetadata(new File([blob],track.fileName||'audio'));
        if(tags.tagged && validMatch(tags)) {
          const updated=await db.saveIdentification(track,{...track.identification,tagsChecked:true},{title:tags.title,artist:tags.artist});
          if(!updated) return;
          await onUpdate(updated);track=updated;
        }
      }
    }
    if(!available()) return;
    const query=new URLSearchParams({title:clean(track.title).slice(0,200),artist:track.artist==='Artiste inconnu'?'':clean(track.artist).slice(0,200),duration:String(track.duration||0)});
    let result=await request('/api/identify/search?'+query);
    let audioUnavailable=false, tooLarge=false;
    if(result.status!=='matched' && preferences.audio && navigator.onLine!==false && !document.hidden) {
      const capabilities=await request('/api/identify/capabilities');
      if(capabilities.audio) {
        const blob=await db.getUserAudioBlob(track.id);
        if(blob && blob.size<=Math.min(capabilities.maxAudioBytes,25*1024*1024) && track.duration>0 && preferences.audio && available()) {
          try {
            const audioResult=await request('/api/identify/audio?duration='+encodeURIComponent(track.duration),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:blob});
            if(audioResult.status==='matched' || audioResult.candidates?.length) result=audioResult;
          } catch(error) {if(![400,413,422].includes(error.status))throw error;tooLarge=true;}
        } else tooLarge=true;
      } else audioUnavailable=true;
    }
    const match=result.status==='matched' && validMatch(result.match)?result.match:null;
    const identification={status:match?'matched':audioUnavailable?'unavailable':'unmatched',
      source:result.source,candidates:[],checkedAt:Date.now(),reason:audioUnavailable?'audio-not-configured':tooLarge?'audio-size-limit':null,
      attempts:(track.identification?.attempts||0)+1,manual:!!track.identification?.manual};
    if(!preferences.enabled && !track.identification?.manual) return;
    const updated=await db.saveIdentification(track,identification,match);
    if(updated) await onUpdate(updated);
  }
  const available=()=>navigator.onLine!==false && !document.hidden;
  async function run() {
    if(busy || !available()) return;
    busy=true;
    try {
      const work=async()=>{
        for(const track of await db.getUserTracks()) {
          if(!available()) break;
          if((!preferences.enabled && !track.identification?.manual) || track.metadataLocked || track.identification?.status!=='pending' || track.identification.nextAttempt>Date.now()) continue;
          try {
            const running=await db.saveIdentification(track,{...track.identification,phase:'searching'});
            if(!running) continue;
            await onUpdate(running);await identify(running);
          } catch {
            const attempts=(track.identification.attempts||0)+1;
            const updated=await db.saveIdentification(track,{...track.identification,status:'pending',attempts,
              nextAttempt:Date.now()+Math.min(86400000,30000*2**Math.min(attempts,12)),reason:'network',phase:'waiting'});
            if(updated) await onUpdate(updated);
          }
        }
      };
      if(navigator.locks) await navigator.locks.request('wave-identification',{ifAvailable:true},lock=>lock?work():undefined);
      else await work();
    } finally {busy=false;wake(60000);}
  }
  function wake(delay=0) {clearTimeout(timer);timer=setTimeout(()=>run().catch(()=>wake(60000)),delay);}
  async function retry(track, unlock=false) {
    if(!canIdentify(track) || (track.metadataLocked && !unlock)) return false;
    const updated=await db.queueIdentification(track,unlock);
    if(updated) {await onUpdate(updated);wake();}return !!updated;
  }
  function describe(track) {
    if(track.metadataLocked) return '';
    const state=track.identification;
    if(state?.status==='pending') {
      if(!preferences.enabled) return 'Identification désactivée dans les paramètres.';
      if(navigator.onLine===false) return 'En attente de connexion Internet.';
      if(state.reason==='network') return 'Le service ne répond pas. Une nouvelle tentative est prévue.';
      return state.phase==='searching' ? 'Recherche sur Internet en cours…' : 'Recherche en attente…';
    }
    return ({matched:'Identifié via '+(state?.source||'les métadonnées')+'.',
      review:'Résultats trouvés : choisis une proposition ci-dessous pour la confirmer.',
      unavailable:'Aucun résultat textuel trouvé. La reconnaissance audio n’est pas configurée.',
      unmatched:'Aucune correspondance trouvée. Les informations ont été conservées.'}[state?.status] || 'Identification non demandée.');
  }
  async function init(database,base,callback,reader) {
    db=database;api=base;onUpdate=callback;readMetadata=reader;
    const saved=await db.getSetting('identificationPreferences');
    if(saved) preferences={enabled:saved.enabled!==false,audio:saved.audio!==false};
    window.addEventListener('online',()=>wake());
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)wake();});wake();
  }
  function canIdentify(track) { return !['matched','confirmed'].includes(track.identification?.status); }
  return {name,clean,initial,init,wake,retry,validMatch,describe,canIdentify};
})();
