# Localisation de l’interface

## Portée de cette livraison

21 choix d’interface, plus la langue de l’appareil. Les 53 messages du catalogue
couvrent la navigation, les paramètres, le tri, plusieurs actions et les états vides.
Ce n’est **pas encore une traduction intégrale** : explications longues, messages
dynamiques, erreurs, certaines commandes et pages juridiques restent en français.
Le panneau Langues annonce explicitement cette limite. Aucun appel à un service
de traduction n’est effectué et aucune métadonnée musicale n’est envoyée ailleurs.

Les traductions sont des propositions éditoriales, sans certification ni relecture
native exhaustive. Une relecture linguistique reste nécessaire avant de déclarer
une qualité de production pour chaque langue, particulièrement pour le féroïen.
La consultation du portail Sprotin lors de cette livraison n’a pas permis de
valider individuellement les libellés féroïens ; elle n’est pas présentée comme telle.

## Choix linguistiques

- Anglais : libellés à orthographe américaine (Favorites), sans prétendre couvrir
  séparément toutes les variétés régionales. Français : rédaction actuelle du site.
- Espagnol : libellés avec « añadir », sans catalogue américain distinct.
- Arabe : standard moderne écrit, pas un dialecte oral ; interface RTL.
- Portugais : catalogues distincts Portugal et Brésil ; les autres régions
  utilisent pour l’instant le catalogue Portugal, sans les assimiler à cette norme.
- Chinois : écriture simplifiée ou traditionnelle. Ces choix ne désignent pas
  toutes les langues sinitiques. Le cantonais n’est pas proposé comme traduit.
- Coréen : usages sud-coréens ; japonais : interface standard contemporaine.
- Allemand : rédaction standard d’Allemagne, pas de catalogue autrichien ou suisse.
- Grec : moderne ; turc : Turquie ; russe : contemporain.
- Suédois, danois, islandais et féroïen sont distincts. Le norvégien distingue
  bokmål et nynorsk. Les autres langues de l’espace nordique ne sont pas assimilées
  à ces langues germaniques et ne sont pas proposées comme traduites ici.
- Indonésien : rédaction standard contemporaine, pas malais ni javanais.

## Architecture et garanties

`locales.js` contient les messages et noms natifs. `i18n.js` traduit uniquement
une liste explicite d’éléments de l’interface et les attributs d’accessibilité
connus. Les textes inconnus conservent leur source française. Un WeakMap conserve
la source de chaque nœud pour les changements de langue successifs.

Les titres, artistes, noms de playlists, saisies et aperçus de navigation sont
exclus. L’observateur traite les nœuds modifiés, sans reconstruire l’application.
Le choix est enregistré dans IndexedDB avant application ; en cas d’échec,
la sélection précédente est conservée. Les radios natives permettent l’utilisation
au clavier et avec VoiceOver. Les barres temporelles restent de gauche à droite.

Le français reste la valeur initiale pour préserver les installations existantes.
L’utilisateur peut choisir la détection de l’appareil ; une langue non prise en
charge conduit à la langue suivante de sa liste, puis au français. Le numéro
de version du site reste 1.0.

## Validation

Exécuter `node --test tests/i18n.test.js` et les tests de navigation existants.
Compléter sur iPhone avec : FR → arabe → japonais → FR, recherche au clavier,
VoiceOver, fermeture/réouverture, relance hors ligne, et lecture continue pendant
le changement. Les tests Node ne prouvent ni la qualité linguistique native,
ni le rendu Safari/VoiceOver sur appareil réel.
