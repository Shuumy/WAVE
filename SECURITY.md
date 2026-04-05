# WAVE — Journal des correctifs de sécurité

Ce document détaille tous les correctifs appliqués au projet WAVE et les raisons qui les justifient.

---

## 🔴 Correctifs critiques

### 1. XSS via métadonnées audio/playlists — `js/app.js`

**Problème :** Les données utilisateur (titres, artistes, noms de playlists) étaient injectées directement dans le DOM via `innerHTML` sans échappement. Un fichier MP3 avec des tags ID3 malveillants (ex. `title = <img onerror="...">`) pouvait exécuter du JavaScript.

**Correctif appliqué :**
- Ajout d'une fonction `esc(s)` qui échappe `&`, `<`, `>`, `"`, `'` avant toute injection dans `innerHTML`.
- Utilisation de `element.textContent = value` à la place de `innerHTML` quand aucune structure HTML n'est nécessaire (player title/artist, messages de toast, confirm dialog).
- Création via DOM API (`createElement`, `appendChild`) pour les cas complexes.

```javascript
// Avant (vulnérable)
div.innerHTML = `<div>${track.title}</div>`;

// Après (sécurisé)
div.innerHTML = `<div>${esc(track.title)}</div>`;
// ou
element.textContent = track.title;
```

---

### 2. Injection d'URLs externes — `js/app.js`

**Problème :** Les URLs de thumbnails YouTube (provenant des serveurs Piped tiers) étaient injectées directement dans les attributs `src` sans validation. Un serveur Piped compromis aurait pu retourner `javascript:malicious()` ou `" onerror="...`.

**Correctif appliqué :**
- Ajout d'une fonction `sanitizeURL(url)` qui valide le protocole (`https:`, `http:`, `data:image/`, `blob:`) et rejette tout le reste.
- Validation que les `data:` URLs sont bien des images (`data:image/`).

```javascript
function sanitizeURL(url) {
  try {
    const u = new URL(url);
    if (!['https:', 'http:', 'data:', 'blob:'].includes(u.protocol)) return '';
    if (u.protocol === 'data:' && !url.startsWith('data:image/')) return '';
    return url;
  } catch { return '' }
}
```

---

### 3. Content Security Policy (CSP) — `index.html`

**Problème :** Absence totale de CSP. Toute XSS réussie pouvait charger des scripts depuis n'importe quel domaine et exfiltrer des données.

**Correctif appliqué :** Ajout d'une balise `<meta http-equiv="Content-Security-Policy">` couvrant :
- `script-src` : uniquement `'self'`, cdnjs.cloudflare.com, youtube.com (sans `'unsafe-inline'`)
- `connect-src` : liste blanche de toutes les instances Piped et Invidious utilisées
- `object-src 'none'` : bloque les plugins Flash/Java
- `base-uri 'self'` : empêche la manipulation de l'URL de base
- `form-action 'none'` : pas de formulaires dans l'app

> **Note :** `style-src 'unsafe-inline'` est conservé car le JS génère des styles inline (couleurs de playlists, barres de progression). Pour l'éliminer, il faudrait refactoriser en CSS classes.

---

### 4. Validation des noms de playlists — `js/app.js`

**Problème :** Les noms issus de `prompt()` étaient stockés puis réinjectés en `innerHTML` sans validation ni nettoyage des caractères de contrôle.

**Correctif appliqué :**
- Ajout d'une fonction `validatePlaylistName(s)` qui strip les caractères de contrôle (`\x00-\x1F`) et limite la longueur à 100 caractères.
- Le nom nettoyé est toujours passé par `esc()` avant injection dans le DOM.

---

## 🟠 Correctifs modérés

### 5. Validation du type des images — `js/app.js`

**Problème :** Les photos de profil et covers de playlists acceptaient n'importe quel fichier (l'attribut `accept` est contournable). Un SVG malveillant (`<svg onload="...">`) aurait pu passer.

**Correctif appliqué :**
- Vérification du `file.type` MIME réel contre une liste blanche : `['image/jpeg', 'image/png', 'image/gif', 'image/webp']`.
- L'attribut `accept` dans le HTML a été mis à jour pour correspondre.
- Vérification que la `data:` URL résultante commence bien par `data:image/`.

```javascript
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
  showToast('Format non supporté. Utilise JPG, PNG, GIF ou WebP.');
  return;
}
```

---

### 6. Limite de taille des fichiers — `js/app.js`

**Problème :** Aucune limite de taille à l'import. Un fichier de plusieurs Go pouvait saturer IndexedDB (DoS local).

**Correctif appliqué :**
- Limite de **500 Mo** par fichier audio importé.
- Limite de **5 Mo** par image (profil, cover playlist).

```javascript
const MAX_AUDIO_SIZE = 500 * 1024 * 1024; // 500 Mo
const MAX_IMAGE_SIZE =   5 * 1024 * 1024; // 5 Mo
```

---

### 7. Validation du Content-Type des téléchargements audio — `js/app.js`

**Problème :** Les blobs téléchargés depuis Piped/Invidious n'étaient pas validés — n'importe quel fichier > 5 Ko était accepté.

**Correctif appliqué :** Vérification du header `Content-Type` de la réponse HTTP avant d'accepter le blob :

```javascript
const contentType = ar.headers.get('content-type') || '';
if (!contentType.startsWith('audio/') && !contentType.startsWith('video/') && !contentType.includes('octet-stream')) continue;
```

---

### 8. Validation de la cover artwork lors de la sauvegarde YouTube — `js/app.js`

**Problème :** La couverture téléchargée depuis l'URL du thumbnail n'était pas validée avant stockage.

**Correctif appliqué :**
- Vérification du `Content-Type` de la réponse thumbnail (`image/*`).
- Vérification que la data URL commence par `data:image/` avant stockage.

---

### 9. Validation HTTPS dans `fetchWithTimeout` — `js/app.js`

**Problème :** `fetchWithTimeout` acceptait n'importe quelle URL, y compris `http:` ou des schémas non-HTTP.

**Correctif appliqué :** Validation que toutes les URLs fetchées utilisent le protocole `https:`.

---

### 10. `encodeURIComponent` sur les paramètres d'URL — `js/app.js`

**Problème :** Des paramètres comme `itag` et `videoId` étaient concaténés dans des URLs sans encodage, permettant théoriquement une injection de paramètres.

**Correctif appliqué :** Utilisation systématique de `encodeURIComponent()` pour tous les paramètres dynamiques dans les URLs construites.

---

### 11. Suppression des `console.log/warn` verbeux — `js/app.js`

**Problème :** Des informations sur les instances qui échouent et les structures internes étaient loguées en clair dans la console (visibles par n'importe qui ouvrant les DevTools).

**Correctif appliqué :** Seuls les `console.error()` pour les erreurs critiques sont conservés. Tous les `console.warn` et `console.log` informatifs ont été supprimés.

---

## 🟡 Correctifs mineurs

### 12. Sanitisation de l'artwork SVG — `js/tracks.js`

**Problème :** Le premier caractère du titre était utilisé tel quel dans un SVG inline. Un caractère `<` ou `&` aurait pu déformer le SVG.

**Correctif appliqué :** Validation par regex — seuls les caractères alphanumériques et accentués sont acceptés, les autres sont remplacés par `?`.

```javascript
const letter = /^[A-Z0-9ÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ\u00C0-\u024F]$/.test(rawLetter) ? rawLetter : '?';
```

---

### 13. Stratégie Service Worker améliorée — `sw.js`

**Problème :** Stratégie cache-first pure sans mise à jour : un asset corrompu restait en cache indéfiniment.

**Correctif appliqué :** Passage à une stratégie **stale-while-revalidate** pour les assets de l'app :
- L'asset est servi depuis le cache immédiatement (performance).
- Le réseau est consulté en arrière-plan pour mettre à jour le cache.
- Les requêtes vers les serveurs externes (Piped, Invidious) ne sont **jamais** mises en cache.

---

### 14. `CSS.escape()` pour les sélecteurs dynamiques — `js/app.js`

**Problème :** Des IDs de piste générés aléatoirement étaient utilisés dans `querySelectorAll` sans échappement CSS, ce qui aurait pu produire des sélecteurs invalides.

**Correctif appliqué :**
```javascript
// Avant
$$( `.track-item[data-track-id="${firstId}"]`)

// Après
$$(`.track-item[data-track-id="${CSS.escape(firstId)}"]`)
```

---

## ⚠️ Action requise : Subresource Integrity (SRI)

Pour protéger contre une compromission du CDN Cloudflare (supply chain attack), il faut ajouter l'attribut `integrity` au script jsmediatags.

**Commande à exécuter une seule fois :**
```bash
curl -sL https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

Puis dans `index.html`, remplacer `HASH_ICI` par la valeur obtenue :
```html
<script
  src="https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js"
  integrity="sha384-VOTRE_HASH_ICI"
  crossorigin="anonymous">
</script>
```

> L'API YouTube Iframe ne supporte pas SRI (elle charge elle-même des sous-scripts dynamiquement). La CSP couvre ce risque.

---

## Ce qui reste à surveiller

| Point | Statut | Raison |
|---|---|---|
| IndexedDB non chiffré | Non corrigé | Hors scope (nécessite refonte complète avec Web Crypto API) |
| Serveurs Piped/Invidious tiers | Partiellement atténué | Content-Type validé, URLs sanitisées. La confiance reste nécessaire par design |
| Clickjacking | Couvert par CSP | `frame-ancestors` implicitement via la CSP (serveur à configurer si hébergement custom) |
