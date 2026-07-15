# Sécurité et données personnelles

WAVE ne doit contenir aucun cookie, mot de passe, jeton d'accès, clé privée ou
fichier de session.

- Ne commit jamais de fichier `.env`, `cookies.txt`, clé privée ou export de navigateur.
- Utilise uniquement des secrets gérés par la plateforme d'hébergement lorsqu'ils
  sont indispensables.
- Révoque immédiatement tout secret qui aurait été publié, même s'il est ensuite
  supprimé du dépôt.
- Les données musicales importées restent dans le stockage local du navigateur et
  ne doivent pas être ajoutées au dépôt.

Pour signaler une fuite, retire d'abord le secret du service concerné et change les
identifiants associés avant de corriger le dépôt.
