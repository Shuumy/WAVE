# WAVE sur GitHub Pages et iPhone 15 — vérification des 20 points

État au 27 septembre 2026. Branche de travail : `agent/iphone-pages-checklist`.

| # | Point de la vidéo | Traitement dans cette branche |
|---|---|---|
| 1 | Page RGPD | `confidentialite.html` décrit le stockage local et les services tiers. Brouillon `noindex` : identité et contact privé de l’éditeur manquants. |
| 2 | CGU | `conditions.html` décrit l’usage des contenus, le stockage local et les services externes. Brouillon `noindex` : identité et contact manquants. |
| 3 | API hors front-end | La recherche utilise déjà `backend/main.py` sur Render. Le navigateur ne contient pas de clé API ; la bibliothèque est dans IndexedDB. |
| 4 | Forcer HTTPS | Vérifié sur le site publié : HTTP renvoie 301 vers HTTPS et HTTPS envoie `Strict-Transport-Security`. C’est géré par GitHub Pages. Le pont Termux Android sur `127.0.0.1` n’est pas appelé sur iPhone. |
| 5 | Bandeau cookies | Pas de traceur WAVE au chargement : les scripts YouTube et cdnjs sont désormais différés. Ne pas ajouter de faux bandeau. Une vraie gestion du consentement sera nécessaire si des traceurs non essentiels sont introduits. |
| 6 | Meta title | Titre descriptif de l’accueil et titres des pages d’information. |
| 7 | Image réseaux | Balises Open Graph/Twitter avec l’icône WAVE existante. À remplacer par une image de partage dédiée si souhaité. |
| 8 | Favicon | SVG, PNG et icône Apple déjà présents. |
| 9 | Sitemap + robots.txt | `sitemap.xml`, lien dans `index.html` et `robots.txt` ajoutés. **Limite GitHub Pages :** `/WAVE/robots.txt` n’est pas le `https://shuumy.github.io/robots.txt` de la racine du domaine ; ce dépôt seul ne peut pas définir le robots.txt du domaine. Déclarer le sitemap dans Search Console, ou configurer la racine du domaine si elle est sous votre contrôle. |
| 10 | Textes images | Les pochettes des listes sont décoratives à côté du titre du morceau (`alt=""`) ; la pochette du dialogue de notation est libellée. Les images sociales ont des métadonnées. |
| 11 | Compresser images | Les icônes statiques pèsent environ 12 à 33 Ko. Les pochettes importées dépendent des fichiers de l’utilisateur ; surveiller le stockage local avant d’ajouter une compression destructrice. |
| 12 | Vitesse pages | Police système, retrait des scripts tiers au chargement et cache hors ligne. Mesurer les Web Vitals sur la version déployée avant une optimisation plus lourde. |
| 13 | Contraste | Couleurs des textes secondaires relevées ; focus visible ajouté. Audit complet WCAG encore à réaliser sur appareil. |
| 14 | Site responsive | Zoom restauré, saisies à 16 px, cibles tactiles agrandies, barre de lecture compacte et paysage utilisable. La mention « parfait sur iPhone 15 » exige un essai Safari réel, hors de ce dépôt. |
| 15 | Page 404 custom | `404.html` ramène à `/WAVE/` et porte `noindex`. Vérifier le statut 404 après publication. |
| 16 | Réparer liens cassés | Les cibles locales du HTML ont été vérifiées. Le lien NoTube renvoie actuellement une redirection 301 vers une autre page ; les liens tiers peuvent changer sans préavis. |
| 17 | Valider formulaires | Recherche limitée à 200 caractères dans le navigateur et l’API ; import contrôlé par type, taille et décodage ; validation des noms de playlists déjà en place. Aucun formulaire d’inscription ou de contact. |
| 18 | Anti-spam | Aucun formulaire public générant du contenu. La recherche API publique mérite une protection contre les abus côté hébergeur si le trafic augmente ; éviter un limiteur mémoire fondé sur l’IP du proxy. |
| 19 | Outil d’analytics | Pas de traceur ajouté sans finalité ni configuration de confidentialité. Utiliser d’abord les mesures techniques d’hébergement et, si nécessaire, choisir un outil d’audience respectueux de la vie privée avec la configuration légale appropriée. |
| 20 | Un seul CTA | WAVE est une application, avec plusieurs actions nécessaires (écouter, chercher, importer, bibliothèque). Il n’y a pas de page de vente à réduire à un seul appel à l’action. |

## Vérifications exécutées

- `node --check` sur les fichiers JavaScript modifiés : réussi.
- Analyse HTML des références locales : aucune cible manquante.
- `manifest.json` et `sitemap.xml` parsés : réussis.
- HTTP/HTTPS du site public : redirection et HSTS constatés.
- Un navigateur iOS ou un iPhone 15 réel n’étaient pas disponibles ; **la lecture de fichiers locaux, le clavier Safari, le partage, le mode écran d’accueil et les limites de stockage iOS restent à valider sur appareil**.

## Avant publication

1. Fournir l’identité de l’éditeur et un contact privé, puis finaliser/revoir les deux pages d’information et retirer leur `noindex`.
2. Vérifier l’état de GitHub Pages après fusion et soumettre `https://shuumy.github.io/WAVE/sitemap.xml` dans Search Console si le référencement est souhaité.
3. Tester Safari sur un iPhone 15 : portrait et paysage, zoom, import depuis Fichiers, lecture locale, notation, fermeture/réouverture, hors ligne, suppression des données du site.
