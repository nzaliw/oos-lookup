# 📡 OOS Lookup — Déploiement GRATUIT (GitHub + Render)

## Ce dont vous avez besoin
- Un compte **GitHub** (gratuit) → https://github.com
- Un compte **Render** (gratuit) → https://render.com
- Aucune carte bancaire requise sur les deux

---

## ÉTAPE 1 — Créer votre dépôt GitHub

1. Connectez-vous sur **https://github.com**
2. Cliquez sur **"New repository"** (bouton vert en haut à droite)
3. Donnez un nom : `oos-lookup`
4. Laissez **Public** coché (requis pour Render gratuit)
5. Cliquez **"Create repository"**

---

## ÉTAPE 2 — Uploader les fichiers sur GitHub

Dans votre nouveau dépôt vide :

1. Cliquez **"uploading an existing file"** (lien au centre de la page)
2. **Glissez-déposez** tous les fichiers du ZIP dans la zone d'upload :
   ```
   server.js
   package.json
   public/
     index.html
     admin-login.html
     admin-dashboard.html
   ```
   ⚠️ N'uploadez PAS `node_modules/` ni `uploads/`

3. En bas de page, cliquez **"Commit changes"**

---

## ÉTAPE 3 — Déployer sur Render

1. Allez sur **https://render.com** et créez un compte (bouton "Get Started for Free")
2. Cliquez **"New +"** → **"Web Service"**
3. Choisissez **"Connect a repository"** → connectez votre GitHub
4. Sélectionnez le dépôt **`oos-lookup`**
5. Remplissez le formulaire :

   | Champ | Valeur |
   |-------|--------|
   | **Name** | `oos-lookup` (ou ce que vous voulez) |
   | **Region** | Frankfurt (EU) — le plus proche |
   | **Branch** | `main` |
   | **Runtime** | `Node` |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Instance Type** | `Free` ✅ |

6. Faites défiler jusqu'à **"Environment Variables"** et ajoutez :

   | Key | Value |
   |-----|-------|
   | `ADMIN_PASSWORD` | `VotreMotDePasseSecret!` |
   | `SESSION_SECRET` | `une-longue-chaine-aleatoire-ici` |

7. Cliquez **"Create Web Service"**

---

## ÉTAPE 4 — Accéder à votre application

Render va déployer en 2–3 minutes. Vous obtenez une URL du type :

```
https://oos-lookup.onrender.com
```

| URL | Description |
|-----|-------------|
| `https://oos-lookup.onrender.com/` | Page visiteur |
| `https://oos-lookup.onrender.com/admin` | Login admin |
| `https://oos-lookup.onrender.com/admin/dashboard` | Upload fichiers |

---

## ÉTAPE 5 — Uploader votre fichier Excel (admin)

1. Allez sur `/admin` et connectez-vous avec votre mot de passe
2. Dans le dashboard, glissez votre fichier `DonnéesOOS.xlsx`
3. C'est tout ! Les visiteurs peuvent chercher immédiatement

---

## ⚠️ Limitations du plan gratuit Render

| Limite | Détail |
|--------|--------|
| **Sommeil** | Le serveur s'endort après 15 min sans visite. 1ère requête = ~30 sec d'attente |
| **Heures** | 750 h/mois gratuites (= un serveur toujours allumé) |
| **Disque** | Éphémère : les données uploadées peuvent disparaître au redémarrage |
| **RAM** | 512 MB (largement suffisant pour ce projet) |

**Solution pour le disque éphémère :** re-uploadez simplement le fichier Excel via le dashboard admin après un redémarrage. L'opération prend 10 secondes.

---

## 🔄 Mettre à jour les fichiers plus tard

Pour mettre à jour le code :
1. Sur GitHub → cliquez sur le fichier → icône crayon ✏️ → modifiez → "Commit changes"
2. Render redéploie automatiquement en 2 min

---

## 🔐 Changer le mot de passe admin

Dans Render → votre service → **"Environment"** → modifiez `ADMIN_PASSWORD` → "Save Changes"
Le service redémarre automatiquement.
