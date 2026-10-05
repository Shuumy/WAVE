# Identification des imports

## Fonctionnement

### Recherche YouTube Music

À chaque identification, le serveur reprend le titre et l’artiste disponibles
et recherche jusqu’à dix morceaux sur YouTube Music, sans compte utilisateur ni
clé AcoustID. Il utilise les artistes structurés du catalogue, jamais le nom
d’une chaîne comme substitut. Seules les pistes audio de catalogue (`song`,
`MUSIC_VIDEO_TYPE_ATV`) sont admissibles à une correction automatique.

Le titre complet et l’artiste doivent concorder, avec une durée connue à trois
secondes près. Si l’artiste est absent, un titre exact et une durée concordante
peuvent identifier une piste de catalogue unique. Une autre identité de même
titre et durée, même issue d’une vidéo, empêche cette correction automatique.
Un titre combinant titre et artiste reste aussi accepté, par exemple
`【MV】 九尾 9Lana`. Plusieurs identités admissibles, une durée absente ou une autre
version restent sans correction en l’absence de preuve suffisante.
Ce sont des critères prudents, pas une garantie de reconnaissance parfaite.

MusicBrainz reste un recours si YouTube Music ne donne pas de correspondance
automatique ou rencontre une erreur. Les résultats internes sont conservés
si l’autre fournisseur tombe en panne. Sans aucun résultat exploitable, une panne
entraîne une nouvelle tentative. Les requêtes YouTube sont sérialisées et leurs
connexions/lectures ont des délais limites. La bibliothèque non officielle
ytmusicapi peut cesser de fonctionner si YouTube change son service.

Les corrections utilisent la sauvegarde transactionnelle locale existante ; les
informations d’origine, les corrections manuelles et l’écoute sont préservées.
Les anciens morceaux se relancent depuis leur menu ⋯. Aucun envoi massif des
anciens imports n’est déclenché par cette mise à jour.

Après fusion, redéployer Render pour activer ce fournisseur et attendre la mise à
jour GitHub Pages. Aucun nouveau secret ni téléchargement audio n’est nécessaire.

Les nouveaux imports conservent leurs informations d’origine et une tâche locale
d’identification. Les anciens morceaux ne sont pas envoyés en masse : leur menu
permet de demander une recherche. Les métadonnées intégrées sont lues en priorité,
puis le nom du fichier est nettoyé de marqueurs explicites (Official Video, etc.).
Les qualificatifs remix, live, cover, sped up restent présents. Ce nettoyage est
déterministe, sans modèle de langage ni titre/artiste inventé.

La lecture des tags utilise jsmediatags, mise en cache après son premier chargement.
Si elle est indisponible à l’import hors ligne, le fichier est conservé et ses tags
sont relus au retour de la connexion avant la recherche. Les résultats sont
enregistrés dans IndexedDB ; aucun nouveau téléchargement n’est requis pour les
afficher hors ligne. Les fichiers audio eux-mêmes ne sont pas réécrits.

MusicBrainz reçoit titre/artiste/durée via le serveur. L’application n’applique
automatiquement une réponse textuelle que si titre et artiste concordent et que
la durée diffère d’au plus 3 secondes. Ce seuil est une heuristique conservatrice,
pas une garantie d’identité. Une sélection finale compare aussi les titres
bilingues explicites, les qualificatifs de version, l’artiste, la durée et
l’écart avec le deuxième résultat. Un seul résultat suffisamment fiable est
appliqué ; aucune liste n’est affichée. Les noms sont insérés comme texte.

La file reprend à l’ouverture, au retour en ligne et au retour au premier plan.
Les échecs réseau entraînent un délai croissant jusqu’à 24 h. Les recherches sont
sérielles, avec verrou entre onglets quand Web Locks est disponible. Le serveur
limite les appels externes à moins d’un par seconde avec un seul worker.
Les réponses tardives sont rejetées dans une transaction si le morceau a été
supprimé ou modifié manuellement. Une restauration de l’original protège aussi les
champs contre de nouveaux remplacements automatiques.

### Recherche de titres provenant de vidéos

Les marqueurs explicites tels que `【MV】` sont retirés de la requête, ainsi que
le suffixe de chaîne ` - Topic` du champ artiste. Live, remix et cover restent
présents. Après une recherche exacte infructueuse, une seconde requête limitée
cherche les mots du titre dans les champs titre ou artiste. Par exemple,
`【MV】 九尾 9Lana` peut retrouver `九尾` / `9Lana` sans inventer une séparation.
Ce résultat élargi MusicBrainz est évalué par la sélection finale. Hors piste de
catalogue YouTube exacte et unique, un artiste absent doit être présent
intégralement dans le titre importé pour une correction automatique.

Le menu contient « Rechercher et corriger les informations ». Une confirmation
autorise la recherche puis la correction directe. Un message signale la fin ou
l’absence de correspondance fiable. Les états internes et les propositions ne
sont plus affichés dans le menu. L’action disparaît après succès et revient
après restauration des originaux ou édition manuelle. Les informations d’origine
sont conservées. Une modification faite
entre l’ouverture de la confirmation et sa validation annule cette relance.

## Déploiement requis

1. Merger la PR et déployer le backend Render depuis `backend/Dockerfile`.
2. La recherche MusicBrainz n’exige pas de clé ; conserver le User-Agent de contact.
3. Pour la reconnaissance audio, enregistrer une application AcoustID et ajouter
   **ACOUSTID_API_KEY** aux variables secrètes Render. Ne jamais la mettre dans
   GitHub, dans le JavaScript, ou dans une conversation publique.
4. Vérifier `GET /api/identify/capabilities` : `audio:true` après configuration.

Sans clé, la recherche textuelle fonctionne ; l’interface indique l’indisponibilité
de la reconnaissance audio au lieu de prétendre avoir analysé le fichier.
Une nouvelle recherche se demande depuis le menu du morceau après configuration.

## Reconnaissance audio

Quand elle est activée, le navigateur envoie au backend un fichier de 25 Mo maximum.
FFmpeg décode au plus 120 secondes, mono 11 025 Hz, puis Chromaprint calcule une
empreinte. Les entrées FFmpeg sont limitées au pipe et ne peuvent ouvrir une URL
ou un fichier référencé par le contenu. Le dossier temporaire est supprimé après
traitement. AcoustID reçoit seulement l’empreinte et la durée totale. Une clé
d’application est nécessaire. Aucun envoi d’empreinte à la base contributive.

Pour les fichiers plus volumineux ou les formats incompatibles, seule la recherche
textuelle est disponible. La rubrique d’identification a été retirée des paramètres.
Les anciennes préférences de désactivation restent respectées pour les recherches
automatiques. Une nouvelle confirmation manuelle mentionne explicitement l’envoi
du fichier pour reconnaissance (25 Mo maximum) et autorise cet essai audio pour
cette demande, même si une ancienne préférence le désactivait. Les anciennes
demandes déjà en attente ne reçoivent pas rétroactivement ce consentement.
Les messages distinguent fichier absent, durée inconnue, limite de taille,
format non analysable, service non configuré et absence de correspondance fiable.
Safari ne permet pas de garantir le Wi-Fi exclusivement, et une PWA fermée n’exécute
pas cette file en continu. Pas de prétention de fonctionnement en arrière-plan.

## Références consultées le 1 octobre 2026

- MusicBrainz API : https://musicbrainz.org/doc/MusicBrainz_API
- Limites : https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
- AcoustID (clé d’application, lookup, usage non commercial et limites) :
  https://acoustid.org/webservice

Les tests simulent les fournisseurs. La reconnaissance réelle de fichiers de
l’utilisateur nécessite la clé, le déploiement et une vérification sur iPhone.

Vérification du 5 octobre 2026 : le MP3 fourni par l’utilisateur (185,573875 s,
4 453 817 octets) a reçu HTTP 200 et `matched` sur la route audio Render.
AcoustID crédite « アヴちゃん(女王蜂) », tandis que YouTube Music crédite
« kensuke ushio » pour « Devilman No Uta ». Ces différences de crédits ne sont
pas fusionnées arbitrairement. Aucun fichier audio ni secret n’est versionné.
