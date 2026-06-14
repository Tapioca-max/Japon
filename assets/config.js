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
    // apiKey:      "AIza...........................",
    // authDomain:  "japon-2026.firebaseapp.com",
    // databaseURL: "https://japon-2026-default-rtdb.europe-west1.firebasedatabase.app",
    // projectId:   "japon-2026",
  },

  // Identifiant de la "salle" de vote partagée (laissez tel quel,
  // ou changez-le pour repartir d'une ardoise vierge).
  room: "japon-2026",
};
