# SoundCloud — état de l'intégration

Cette branche ajoute l'onglet **SoundCloud** dans la vue **Rechercher** sans toucher à `app.js`.

## Ce qui est déjà inclus

- injection d'un onglet SoundCloud
- recherche par **lien SoundCloud**
- lecture via **widget SoundCloud**
- recherche texte prête si un `client_id` SoundCloud est ajouté dans `js/soundcloud_ui.js`
- interception des contrôles du player WAVE quand SoundCloud joue

## Limite importante

Si ton `index.html` principal n'autorise pas encore SoundCloud dans la **CSP**, il faut ajouter :

### `script-src`
- `https://w.soundcloud.com`

### `frame-src`
- `https://w.soundcloud.com`

### `connect-src`
- `https://soundcloud.com`
- `https://api-v2.soundcloud.com`
- `https://w.soundcloud.com`

Sans ça :
- l'onglet s'affiche
- mais la lecture SoundCloud peut être bloquée par le navigateur

## Recherche texte

Par défaut, le code est prêt mais aucun `client_id` n'est fourni.

Dans `js/soundcloud_ui.js`, tu peux remplir :

```js
const W = window.WaveSC = window.WaveSC || {
  SOUNDCLOUD_CLIENT_IDS: ['TON_CLIENT_ID_ICI'],
  ...
};
```

Sans `client_id`, l'utilisateur peut toujours :
- coller un lien SoundCloud direct
- ou ouvrir la recherche publique SoundCloud
