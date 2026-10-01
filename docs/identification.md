# Identification des imports

## Fonctionnement

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
pas une garantie d’identité. Les résultats incertains sont proposés dans le menu
du morceau. Les noms sont insérés comme texte, jamais comme HTML.

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
Ce résultat élargi est proposé à confirmation : il ne suffit pas à justifier
une correction automatique sans artiste initial fiable.

Le menu indique explicitement l’absence de résultat textuel. Une recherche
manuelle signale sa fin par un message et les propositions restent dans le menu
du morceau. Les morceaux protégés peuvent être relancés après confirmation
explicite ; les informations d’origine sont conservées. Une modification faite
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
textuelle est disponible. Les deux options sont désactivables dans les paramètres.
Un transfert en cours peut finir même si une option est désactivée ; aucune nouvelle
correction automatique n’est appliquée après désactivation générale.
Safari ne permet pas de garantir le Wi-Fi exclusivement, et une PWA fermée n’exécute
pas cette file en continu. Pas de prétention de fonctionnement en arrière-plan.

## Références consultées le 1 octobre 2026

- MusicBrainz API : https://musicbrainz.org/doc/MusicBrainz_API
- Limites : https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
- AcoustID (clé d’application, lookup, usage non commercial et limites) :
  https://acoustid.org/webservice

Les tests simulent les fournisseurs. La reconnaissance réelle de fichiers de
l’utilisateur nécessite la clé, le déploiement et une vérification sur iPhone.
