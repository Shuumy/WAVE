# Notes de fusion — patch sécurité minimal

Branche préparée : `chatgpt/security-merge-minimal`

## Ce qui est prêt

J'ai préparé un patch minimal compatible avec les correctifs YouTube/PWA déjà présents dans `main`, en visant uniquement les ajouts sécurité suivants :

- CSP dans `index.html`
- validation stricte des images (profil + covers)
- échappement XSS et sanitation d'URLs dans `js/app.js`
- sanitation du SVG dans `js/tracks.js`
- stratégie Service Worker plus sûre dans `sw.js`
- journal sécurité dans `SECURITY.md`

## Limitation du connecteur GitHub

Le connecteur GitHub auquel j'ai accès sait **créer** de nouveaux fichiers, mais pour **mettre à jour** un fichier existant il exige le `sha` du fichier cible. Ce `sha` n'est pas exposé par ce connecteur dans cette session, donc je ne peux pas pousser directement les remplacements de :

- `index.html`
- `js/app.js`
- `js/tracks.js`
- `sw.js`

sans risquer une opération incorrecte.

## Fichiers à remplacer côté repo

Les 4 fichiers à fusionner dans `main` sont :

- `index.html`
- `js/app.js`
- `js/tracks.js`
- `sw.js`

Le contenu fusionné a été préparé localement avec les correctifs YouTube/PWA déjà en place + les ajouts sécurité.

## Priorité de fusion recommandée

1. `js/app.js`
2. `index.html`
3. `js/tracks.js`
4. `sw.js`
5. garder `SECURITY.md`

## Contrôles après fusion

- importer un fichier audio local
- changer photo de profil
- changer cover de playlist
- lancer une recherche YouTube
- vérifier lecture Piped puis fallback YouTube
- vérifier que la PWA iPhone relancée ne montre plus `API YouTube non prête`
- vérifier que le Service Worker recharge bien les assets après update

## Point restant manuel

Le hash SRI de `jsmediatags` doit être calculé manuellement si tu veux activer l'attribut `integrity` dans `index.html`.
