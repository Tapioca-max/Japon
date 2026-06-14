# 日本旅行 2026 — Guide de voyage & sélection d'activités

Application web pour préparer notre voyage au Japon (21 sept → 7 oct 2026) :
un **guide compilé** depuis nos deux documents + une **liste d'activités à voter**.

> **Règle de vote :** chaque membre (Sacha, Manon, Raph, Ivo) vote pour les
> activités qui lui plaisent. **Dès 2 votes ou plus, l'activité est « validée »**
> et passe au programme. Tout est visible sur la carte/tableau de bord en page 1.

## Ce que contient l'app

1. **Page 1 — Tableau de bord visuel** : carte interactive de l'itinéraire
   (les 7 villes reliées par le tracé train, comme le screenshot d'origine),
   compte à rebours avant le départ, nombre d'activités validées, votes par
   membre, et progression de la sélection par étape.
2. **Activités à voter** : ~80 idées compilées des deux guides, classées par
   ville et catégorie, avec filtres (validées seulement, etc.).
3. **Itinéraire jour par jour**, **infos pratiques** et **phrases utiles**.

## Utilisation

Ouvre simplement le site, choisis ton prénom en haut à droite (« Je suis… »),
puis vote. C'est tout.

- **Mode local (par défaut)** : tes votes sont stockés dans ton navigateur.
  Parfait pour tester, mais les votes **ne sont pas partagés** entre les membres.
- **Mode cloud temps réel** : une fois Firebase configuré (ci-dessous), tout le
  monde vote sur son téléphone et **voit les votes des autres en direct**. La
  pastille en haut à droite passe au vert ☁.

---

## 🔌 Activer le partage des votes (Firebase — 5 min, gratuit)

Une seule personne fait ça une fois, puis on partage le lien du site.

1. Va sur <https://console.firebase.google.com> → **Ajouter un projet**
   (nom : `japon-2026`, désactive Google Analytics, c'est inutile ici).
2. Menu de gauche **Build → Realtime Database → Créer une base de données**.
   - Emplacement : **europe-west1** (Belgique).
   - Démarre en **mode test** (lecture/écriture ouvertes — suffisant pour nous).
3. Toujours dans la console : icône ⚙️ **Paramètres du projet → Tes applications →
   icône Web `</>`**. Donne un surnom, **enregistre l'app**.
4. Firebase affiche un objet `firebaseConfig = { ... }`. Copie ses valeurs.
5. Ouvre [`assets/config.js`](assets/config.js) et colle-les (décommente les lignes) :

   ```js
   window.JAPON_CONFIG = {
     firebase: {
       apiKey:      "AIza...",
       authDomain:  "japon-2026.firebaseapp.com",
       databaseURL: "https://japon-2026-default-rtdb.europe-west1.firebasedatabase.app",
       projectId:   "japon-2026",
     },
     room: "japon-2026",
   };
   ```

   > ⚠️ La `databaseURL` est **obligatoire** — c'est elle qui déclenche le mode cloud.
6. Commit + push. Au prochain chargement, la pastille passe au vert : les votes
   sont partagés en temps réel. 🎉

> Ces clés Firebase côté web sont **publiques par nature** (elles identifient le
> projet, elles ne donnent pas d'accès admin), donc pas de souci à les committer
> pour un usage privé entre amis. Le « mode test » de la base expire après 30 j :
> pense à reconduire les règles, ou colle des règles ouvertes
> (`{".read": true, ".write": true}`) le temps du voyage.

---

## 🚀 Déploiement (GitHub Pages)

Un workflow GitHub Actions est fourni ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).

1. Sur GitHub : **Settings → Pages → Build and deployment → Source = GitHub Actions**.
2. Pousse sur la branche par défaut (ou lance le workflow manuellement).
3. Le site se publie sur `https://<utilisateur>.github.io/japon/`.

Alternative ultra-simple : **Settings → Pages → Source = Deploy from a branch**,
choisis la branche et le dossier `/ (root)`.

---

## Structure

```
index.html            Structure de la page
assets/styles.css     Thème (indigo / rouge torii / washi)
assets/data.js        Toutes les données (villes, activités, itinéraire…)
assets/config.js      Config du partage des votes (Firebase facultatif)
assets/app.js         Logique : carte, dashboard, votes, filtres
```

Pour **ajouter une activité**, édite `assets/data.js` (objet `activities`) — pas
besoin de toucher au reste.

良い旅を ! — Bon voyage.
