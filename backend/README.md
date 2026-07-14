# WAVE API

Backend FastAPI utilisé par WAVE pour effectuer des recherches publiques sur YouTube Music avec `ytmusicapi`.

## Sécurité

- aucun mot de passe, cookie YouTube ou jeton OAuth n'est stocké dans le dépôt ;
- seules les routes `GET` et `OPTIONS` sont autorisées par CORS ;
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
