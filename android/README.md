# WAVE — téléchargement local sur Samsung

Le téléchargement n'est plus effectué par Render. La recherche reste en ligne,
mais l'audio est récupéré par `yt-dlp` directement depuis la connexion du Samsung.
Le fichier est ensuite renvoyé à la PWA WAVE et stocké dans sa bibliothèque hors
ligne.

## Sécurité

- le pont écoute uniquement sur `127.0.0.1:8765` ;
- il n'est donc pas accessible depuis le Wi-Fi, Internet ou un autre appareil ;
- seules la PWA officielle `https://shuumy.github.io` et les adresses de
  développement local sont autorisées par CORS ;
- un seul téléchargement est accepté à la fois ;
- la taille maximale est de 100 Mo ;
- aucun cookie, compte, mot de passe ou secret n'est lu par le pont.

## Installation

1. Installe Termux depuis F-Droid ou depuis le dépôt GitHub officiel Termux.
   N'utilise pas une ancienne version provenant d'une source inconnue.
2. Ouvre Termux.
3. Colle cette commande complète :

```bash
pkg update -y && pkg install -y curl && curl -fsSL https://raw.githubusercontent.com/Shuumy/WAVE/main/android/install-wave.sh | bash
```

4. Lorsque l'installation est terminée, lance :

```bash
wave-start
```

5. Laisse Termux ouvert et retourne dans WAVE.
6. Dans l'onglet **Importer**, touche la carte **Pont Samsung**. Elle doit devenir
   verte et afficher `Samsung connecté`.
7. Recherche un morceau puis touche le bouton de sauvegarde hors ligne.

## Commandes utiles

```bash
wave-start   # démarre le pont local
wave-test    # vérifie qu'il répond
wave-update  # met à jour yt-dlp et le pont
```

Pour arrêter le pont, retourne dans Termux et appuie sur `Ctrl+C`. Dans Termux,
`Ctrl` est généralement accessible avec le bouton `CTRL` de la barre de touches
ou avec la combinaison volume bas + C.

## Android et batterie

Android peut arrêter Termux en arrière-plan. Dans les paramètres du Samsung,
place Termux dans les applications **Non restreintes** ou désactive son
optimisation de batterie. Le script utilise aussi le verrou de réveil Termux tant
que `wave-start` fonctionne.
