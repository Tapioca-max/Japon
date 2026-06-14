/* ============================================================
   CONFIGURATION DU PARTAGE DES VOTES
   ------------------------------------------------------------
   PAR DÉFAUT : mode LOCAL. Chacun vote sur son appareil, les
   votes sont stockés dans le navigateur. Rien à faire, ça marche.

   POUR PARTAGER LES VOTES EN TEMPS RÉEL entre Sacha, Manon, Raph
   et Ivo : créez un projet Firebase gratuit (5 min, guide dans le
   README) puis collez la config ci-dessous. Dès qu'une databaseURL
   est présente, l'app bascule automatiquement en mode cloud.
   ============================================================ */

window.JAPON_CONFIG = {
  firebase: {
    apiKey:            "AIzaSyDmVFrAr6cBPxGGJvi2_8UHTgNPkGVKq2U",
    authDomain:        "japonoue.firebaseapp.com",
    databaseURL:       "https://japonoue-default-rtdb.europe-west1.firebasedatabase.app",
    projectId:         "japonoue",
    storageBucket:     "japonoue.firebasestorage.app",
    messagingSenderId: "1060509002757",
    appId:             "1:1060509002757:web:8609911f8b2b0c203c406c",
  },

  // Identifiant de la "salle" de vote partagée (laissez tel quel,
  // ou changez-le pour repartir d'une ardoise vierge).
  room: "japon-2026",
};
