# Déployer WAVE avec yt-dlp et un fournisseur de PO Token

Le backend Docker lance deux processus dans le même service Render :

1. `bgutil-ytdlp-pot-provider` sur `127.0.0.1:4416` ;
2. FastAPI/Uvicorn sur le port fourni par Render.

Le plugin Python `bgutil-ytdlp-pot-provider` transmet automatiquement à yt-dlp les jetons générés par le serveur local. yt-dlp utilise le client YouTube `mweb`.

## Configuration Render

Crée un **nouveau Web Service** à partir de `Shuumy/WAVE` avec :

- Language / Runtime : `Docker`
- Branch : `main`
- Root Directory : `backend`
- Dockerfile Path : `./Dockerfile`
- Instance : `Free`
- Health Check Path : `/api/health`

Variables :

- `FRONTEND_ORIGINS=https://shuumy.github.io`
- `POT_PROVIDER_URL=http://127.0.0.1:4416`

Ajoute ensuite un Secret File nommé exactement `cookies.txt`. Son contenu doit être le fichier Netscape exporté depuis la session YouTube secondaire.

## Vérification

`GET /api/health` doit renvoyer :

```json
{
  "status": "ok",
  "version": "1.3.0",
  "youtubeCookies": "configured",
  "poTokenProvider": "ready"
}
```

Aucun cookie ou jeton n'est exposé par cette route.

## Limites

- Un seul téléchargement simultané.
- Taille maximale : 100 Mo.
- Fichiers temporaires supprimés après envoi.
- Le plan gratuit peut s'endormir et YouTube peut encore bloquer certaines IP ou sessions.
