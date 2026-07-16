# WAVE Android

Cette application Android affiche la version officielle de WAVE hébergée sur GitHub Pages :

```text
https://shuumy.github.io/WAVE/
```

## Ce qui est privé

- l'ouverture de l'APK demande l'empreinte, le visage ou le verrouillage du Samsung ;
- Android bloque les captures d'écran de l'APK ;
- les données de l'application ne sont pas incluses dans les sauvegardes Android ;
- aucun cookie, mot de passe, PIN ou secret n'est stocké dans le dépôt ;
- les connexions HTTP non chiffrées sont refusées, sauf vers le pont Termux local sur `127.0.0.1`.

Le site GitHub Pages et son code restent publics. Le verrouillage protège l'APK installée sur le téléphone, pas l'adresse publique du site.

## Lecteur Android en arrière-plan

La version 1.1.0 ajoute un service multimédia Android avec une notification et des commandes sur l'écran verrouillé :

- lecture et pause ;
- morceau précédent et suivant ;
- avance et retour de 10 secondes ;
- titre, artiste, album, pochette et progression ;
- commandes depuis les écouteurs et les contrôles média Samsung.

Sur Android 13 ou une version plus récente, accepte la permission **Notifications** au premier lancement. Sans cette permission, la musique peut continuer mais le lecteur ne sera pas visible dans le volet des notifications.

Le verrouillage biométrique ou par PIN ne se redéclenche pas tant qu'un morceau joue. Quand la lecture est mise en pause en arrière-plan, le délai de verrouillage de 30 secondes recommence.

## Mises à jour

Les modifications HTML, CSS et JavaScript publiées sur GitHub Pages apparaissent dans l'APK sans reconstruction. Ferme puis rouvre l'application, ou actualise WAVE, pour charger la nouvelle version.

Une nouvelle APK est nécessaire uniquement lorsque les fichiers de `android-app/` changent : icône, verrouillage, permissions, comportement WebView, service multimédia ou configuration Android.

## Téléchargement local

Le téléchargement continue d'utiliser le pont Termux existant :

```bash
wave-start
```

L'APK autorise le contenu HTTP mixte uniquement parce que WAVE doit joindre `http://127.0.0.1:8765` sur le même téléphone. Aucun serveur du réseau Wi-Fi n'est autorisé par la configuration Android.

## Construction automatique

Le workflow GitHub Actions **Build WAVE Android APK** construit une APK de test à chaque changement Android.

1. Ouvre l'onglet **Actions** du dépôt.
2. Ouvre le dernier workflow **Build WAVE Android APK** réussi.
3. Télécharge l'artefact **WAVE-debug-apk**.
4. Décompresse le ZIP puis installe `WAVE-debug.apk` sur le Samsung.

L'APK de test est signée avec une clé temporaire de développement. Pour conserver les données lors des futures mises à jour, configure une signature privée permanente avec les secrets GitHub décrits ci-dessous.

## Signature privée permanente

Ne publie jamais le fichier de signature. Ajoute uniquement ces quatre secrets dans **Settings → Secrets and variables → Actions** :

- `WAVE_KEYSTORE_BASE64`
- `WAVE_KEYSTORE_PASSWORD`
- `WAVE_KEY_ALIAS`
- `WAVE_KEY_PASSWORD`

Quand ils existent, le workflow produit aussi l'artefact **WAVE-release-apk**, signé avec la même clé à chaque version. Garde une copie privée et chiffrée du keystore : sans lui, Android refusera les mises à jour de l'application déjà installée.
