# WAVE API

Backend FastAPI utilisé par WAVE pour effectuer des recherches publiques sur YouTube Music avec `ytmusicapi`.

## Sécurité

- aucun mot de passe, cookie YouTube ou jeton OAuth n'est stocké dans le dépôt ;
- les routes `GET`, `POST` et `OPTIONS` sont autorisées par CORS ;
- les origines front-end autorisées sont configurées avec `FRONTEND_ORIGINS` ;
- la longueur des recherches et le nombre de résultats sont limités ;
- des en-têtes de sécurité sont ajoutés à toutes les réponses.

## Routes

- `GET /` : informations générales ;
- `GET /api/health` : état du service pour Render ;
- `GET /api/search?query=Daft%20Punk&limit=10` : recherche de morceaux ;
- `GET /docs` : documentation interactive FastAPI.

## Exécution locale

Depuis le dossier `backend` :

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8001
```

Sous Windows, l'activation se fait avec :

```powershell
.venv\Scripts\activate
```

Puis ouvrir `http://127.0.0.1:8001/docs`.

## Déploiement manuel sur Render

Créer un **Web Service** relié au dépôt `Shuumy/WAVE`, puis utiliser :

- Branch : `feature/render-ytmusic-backend` tant que la pull request n'est pas fusionnée, ensuite `main` ;
- Root Directory : `backend` ;
- Runtime : `Python 3` ;
- Build Command : `pip install --upgrade pip && pip install -r requirements.txt` ;
- Start Command : `uvicorn main:app --host 0.0.0.0 --port $PORT` ;
- Health Check Path : `/api/health` ;
- Instance Type : `Free`.

Variable d'environnement recommandée :

```text
FRONTEND_ORIGINS=https://shuumy.github.io
```

Le fichier `render.yaml` à la racine contient la même configuration pour un déploiement Render Blueprint.

## Après le déploiement

Render fournit une URL du type :

```text
https://wave-api.onrender.com
```

Tester :

```text
https://wave-api.onrender.com/api/health
https://wave-api.onrender.com/api/search?query=Daft%20Punk&limit=5
```

L'URL exacte du service devra ensuite être ajoutée au front-end WAVE et à sa Content Security Policy.

## Import audio par lien (préparation, désactivé par défaut)

La rubrique **Importer** contient un formulaire YouTube → MP3/M4A. Le fichier
est récupéré par le navigateur, ajouté à la bibliothèque IndexedDB, puis disponible
au téléchargement local. L'import de fichiers existants et le pont Samsung sont
conservés. Le formulaire utilise `/api/imports`, indépendamment de l'ancienne route
`/api/download/{id}` du pont Samsung.

### Déploiement et activation

Utiliser le Dockerfile (FFmpeg + Node 24 + `yt-dlp[default]`). Le mode Python natif
sans ces binaires ne suffit pas. Garder **un seul worker**, comme dans `start.sh` :
la file de travaux est en mémoire et ne convient pas à plusieurs instances.
Définir `AUDIO_IMPORT_ENABLED=true` uniquement après avoir validé une récupération
réelle depuis l'hébergeur choisi. Cette variable est volontairement absente du
Blueprint actuel : le déploiement existant ne l'active pas automatiquement.

Un hébergement Render peut être refusé par YouTube ; installer yt-dlp ne garantit
pas l'extraction depuis une IP de centre de données. Aucun contournement, cookie
YouTube, mot de passe ou proxy n'est configuré. Les médias privés, protégés et les
playlists ne sont pas pris en charge. La version actuelle accepte exclusivement
les liens HTTPS YouTube, Shorts, Music et youtu.be vers une vidéo publique.

### API

- `POST /api/imports` avec `{"url":"https://youtu.be/VIDEO_ID","format":"mp3"}` :
  retourne `202` et un identifiant aléatoire servant de jeton d'accès.
- `GET /api/imports/{id}` : `queued`, `extracting`, `converting`, `ready` ou `failed`.
- `GET /api/imports/{id}/file` : fichier avec `Content-Disposition: attachment`.
- `DELETE /api/imports/{id}` : libère le fichier et sa place dans la file.

Ne pas publier les jetons d'import. Le navigateur libère le fichier serveur dès
sa réception ; sinon il expire après 20 minutes, avec nettoyage toutes les
30 secondes. Une conversion active, quatre travaux retenus maximum, source de
30 minutes/100 Mo maximum, délai de récupération 240 s et conversion 120 s.
Le processus complet est arrêté à expiration ; aucun pourcentage inventé.
Les données temporaires sont perdues au redémarrage. Le service est destiné à un
usage personnel limité ; avant une ouverture publique, ajouter authentification,
quotas par utilisateur, file persistante et supervision. CORS ne remplace pas
l'authentification et les quatre places sont une limite globale.

### Vérification

```bash
pip install -r backend/requirements.txt pytest httpx
python -m pytest -q tests/test_audio_import.py
node --test tests/audio-import.test.js
```

Les tests remplacent uniquement l'acquisition YouTube par un son généré ; FFmpeg,
FFprobe, le cycle de travail HTTP, les formats et le nettoyage sont réels. Ils ne
prouvent pas que YouTube autorise l'IP de production. Avant activation, convertir
une courte vidéo publique autorisée sur l'hébergement réel, écouter le résultat,
vérifier l'ajout à la bibliothèque puis le téléchargement MP3 et M4A.

### Diagnostic et fournisseur de jetons

Le conteneur inclut le plugin Python et le générateur JavaScript bgutil **2.0.2**,
avec Node fourni par l'image versionnée du projet. Le générateur est lancé à la
demande (un seul travail à la fois) : aucun port supplémentaire n'est exposé.
Le chemin peut être configuré avec `WAVE_POT_SERVER_HOME` (défaut `/opt/bgutil`).
Les clients `mweb,default` sont sélectionnés et le chargement des plugins est actif.
Le build vérifie le chargement du générateur et du plugin. `/api/health` expose
leur disponibilité, sans jetons. La présence du fournisseur ne garantit pas que
YouTube accepte l'hébergement.

Les erreurs ont désormais un `errorCode` (vérification demandée par YouTube,
403, 429, problème réseau, fournisseur, format, conversion). Les journaux gardent
au maximum 2 000 caractères d'un tampon d'erreur borné à 16 Kio ; URL, cookies,
jetons et longs identifiants sont masqués. Aucun mode verbose ni cookie de compte
n'est utilisé. Une vérification YouTube obligatoire est signalée explicitement,
sans répétition automatique ni changement de réseau pour la contourner.

## Cobalt et Piped (import audio)

Le backend accepte `AUDIO_IMPORT_PROVIDER=yt-dlp` (défaut), `cobalt` ou `piped`.
L'interface d'import existante est conservée. Aucun annuaire n'est parcouru automatiquement et
aucune rotation d'instances n'est faite après une erreur ou une limitation.

- Cobalt : définir `COBALT_API_URL` (HTTPS) et, si l'opérateur le demande, `COBALT_API_KEY`.
  La clé reste sur le serveur et n'est envoyée qu'à l'API de traitement, jamais au téléchargement.
  Le connecteur demande un tunnel audio MP3 sur le même hôte ; FFmpeg produit ensuite MP3 ou M4A.
- Piped : définir `PIPED_API_URL` et `PIPED_MEDIA_HOSTS` (hôtes exacts du proxy média,
  séparés par des virgules). Les flux audio de `/streams/:id` sont récupérés puis convertis.
  L'instance et son proxy doivent fonctionner et autoriser cet usage.
- Configurer uniquement un service de confiance dont l'accès est ouvert pour cet usage,
  autorisé par son opérateur, ou une instance personnelle. Les instances officielles Cobalt
  protégées ne sont pas des API libres d'accès pour d'autres applications.
- HTTPS avec validation TLS, refus des IP locales/privées à la résolution DNS, aucune
  redirection, taille JSON limitée à 1 Mo, média limité à 100 Mo, durée vérifiée avec
  FFprobe (30 minutes maximum), un seul import à la fois et nettoyage automatique.
- Les challenges, authentifications et réponses 429 sont signalés sans tentative de contournement.
- `/api/health` expose `audioEngine.acquisitionProvider`, sans URL signée ni secret.

Sources : [API Cobalt](https://github.com/imputnet/cobalt/blob/main/docs/api.md),
[API Piped](https://docs.piped.video/docs/api-documentation/),
[instances Piped](https://github.com/TeamPiped/documentation/blob/main/content/docs/public-instances/index.md),
[annuaire communautaire Cobalt](https://cobalt.directory/).
Un statut dans un annuaire ne garantit ni l'autorisation d'intégration, ni la disponibilité.

### Télécharger sans importer

Dans Importer, « Télécharger l’audio » prépare le fichier puis propose son enregistrement
sur l’appareil, sans écrire dans la bibliothèque. « Convertir et importer » conserve
l’import hors ligne. Un lien de téléchargement manuel reste visible pour les navigateurs
qui bloquent le déclenchement automatique, notamment sur mobile.

Le champ `provider` optionnel de `POST /api/imports` accepte seulement `cobalt` ou `piped`.
Il sélectionne une configuration serveur existante ; aucune URL de fournisseur ni clé
n’est acceptée depuis le navigateur. Un service non configuré renvoie 503 avant création
d’un job. Sans ce champ, le fournisseur par défaut du serveur est utilisé.
