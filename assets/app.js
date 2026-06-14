/* ============================================================
   日本旅行 2026 — Logique de l'application
   - Identité du membre (qui vote depuis cet appareil)
   - Stockage des votes : LOCAL (par défaut) ou CLOUD temps réel
     (Firebase Realtime Database, si une config est fournie)
   - Carte interactive, tableau de bord, cartes d'activités à voter
   ============================================================ */

const TRIP = window.TRIP;
const MEMBERS = TRIP.members;
const THRESHOLD = TRIP.voteThreshold;
const CATS = TRIP.categories;

const MEMBER_COLORS = {
  Sacha: "#b3001b",
  Manon: "#c026a0",
  Raph:  "#3b6ea5",
  Ivo:   "#2f7d4f",
};
const colorFor = (m) => MEMBER_COLORS[m] || "#1b2440";

const LS_ME    = "japon2026.me";
const LS_VOTES = "japon2026.votes." + (window.JAPON_CONFIG?.room || "japon-2026");

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let votes = {};          // { actId: { member: true } }
let me = localStorage.getItem(LS_ME) || "";

/* ---------- État des votes ---------- */
const yesMembers = (id) => MEMBERS.filter((m) => votes[id] && votes[id][m]);
const countOf    = (id) => yesMembers(id).length;
const isValid    = (id) => countOf(id) >= THRESHOLD;
const cityActs   = (cid) => TRIP.activities.filter((a) => a.city === cid);

/* ============================================================
   COUCHE DE STOCKAGE  (local <-> cloud)
   ============================================================ */
const Store = {
  mode: "local",
  _cb: null,
  _fb: null,
  _room: window.JAPON_CONFIG?.room || "japon-2026",

  async init(cb) {
    this._cb = cb;
    const cfg = window.JAPON_CONFIG?.firebase;
    if (cfg && cfg.databaseURL) {
      try {
        await this._initCloud(cfg);
        return;
      } catch (e) {
        console.warn("[Japon] Cloud indisponible, bascule en mode local :", e);
        toast("Cloud injoignable — mode local activé");
      }
    }
    this._initLocal();
  },

  _initLocal() {
    this.mode = "local";
    try { votes = JSON.parse(localStorage.getItem(LS_VOTES) || "{}"); }
    catch { votes = {}; }
    this._cb(this.mode);
    // synchro entre onglets du même appareil
    window.addEventListener("storage", (e) => {
      if (e.key === LS_VOTES) {
        try { votes = JSON.parse(e.newValue || "{}"); } catch { votes = {}; }
        this._cb(this.mode);
      }
    });
  },

  async _initCloud(cfg) {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const { getDatabase, ref, onValue, set, remove } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    const app = initializeApp(cfg);
    const db = getDatabase(app);
    this._fb = { db, ref, set, remove };
    this.mode = "cloud";
    const votesRef = ref(db, `rooms/${this._room}/votes`);
    onValue(votesRef, (snap) => {
      votes = snap.val() || {};
      this._cb(this.mode);
    });
  },

  async toggle(actId, member, value) {
    if (this.mode === "cloud") {
      const { db, ref, set, remove } = this._fb;
      const r = ref(db, `rooms/${this._room}/votes/${actId}/${member}`);
      try {
        if (value) await set(r, true); else await remove(r);
      } catch (e) {
        console.error(e); toast("Vote non enregistré (réseau)");
      }
      // l'UI se met à jour via onValue
    } else {
      if (!votes[actId]) votes[actId] = {};
      if (value) votes[actId][member] = true; else delete votes[actId][member];
      if (Object.keys(votes[actId]).length === 0) delete votes[actId];
      localStorage.setItem(LS_VOTES, JSON.stringify(votes));
      this._cb(this.mode);
    }
  },
};

/* ============================================================
   FILTRES
   ============================================================ */
const filterState = { city: "all", cat: "all", onlyValid: false, hideVoted: false };

/* ============================================================
   INITIALISATION
   ============================================================ */
function init() {
  buildMeSelect();
  buildHeroDates();
  buildMap();
  buildFilters();
  renderTimeline();
  renderPractical();
  renderPhrases();
  bindFilters();

  Store.init((mode) => {
    setSyncIndicator(mode);
    renderAll();
  });
}

/* ---------- Sélecteur "Je suis" ---------- */
function buildMeSelect() {
  const sel = $("#meSelect");
  sel.innerHTML = `<option value="">— choisis —</option>` +
    MEMBERS.map((m) => `<option value="${m}" ${m === me ? "selected" : ""}>${m}</option>`).join("");
  sel.addEventListener("change", () => {
    me = sel.value;
    localStorage.setItem(LS_ME, me);
    sel.style.background = me ? colorFor(me) : "var(--gold)";
    sel.style.color = me ? "#fff" : "var(--indigo)";
    renderActivities();
  });
  if (me) { sel.style.background = colorFor(me); sel.style.color = "#fff"; }
}

function buildHeroDates() {
  const fmt = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  $("#heroDates").textContent =
    `${fmt(TRIP.period.start)} → ${fmt(TRIP.period.end)} · ${TRIP.cities.length} villes`;
}

function setSyncIndicator(mode) {
  const pill = $("#syncPill");
  pill.className = "sync-pill " + (mode === "cloud" ? "cloud" : "local");
  pill.title = mode === "cloud"
    ? "Cloud temps réel — les votes sont partagés en direct"
    : "Mode local — votes stockés sur cet appareil (configure Firebase pour partager)";
  $("#footerSync").textContent = mode === "cloud" ? "· ☁ votes synchronisés" : "· 💾 mode local";
}

/* ============================================================
   CARTE (Leaflet)
   ============================================================ */
let map, cityLayers = {};
function buildMap() {
  map = L.map("map", { scrollWheelZoom: false, zoomControl: true });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '© OpenStreetMap · © CARTO',
    maxZoom: 18,
  }).addTo(map);

  const pts = TRIP.cities.map((c) => [c.lat, c.lng]);
  // tracé "train" : ordre du voyage + retour à Tokyo (boucle, comme le screenshot)
  const route = [...pts, pts[0]];
  L.polyline(route, { color: "#b3001b", weight: 3, opacity: .75, dashArray: "1 0" }).addTo(map);

  TRIP.cities.forEach((c, i) => {
    const icon = L.divIcon({
      className: "",
      html: `<div class="city-pin"><span>${i + 1}</span></div>`,
      iconSize: [30, 30], iconAnchor: [15, 28],
    });
    const acts = cityActs(c.id).length;
    const fmt = (d) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    const m = L.marker([c.lat, c.lng], { icon }).addTo(map);
    m.bindPopup(
      `<div class="popup-city">${c.name} <span class="popup-jp">${c.jp}</span></div>
       <div class="popup-meta">${fmt(c.arrival)} → ${fmt(c.departure)} · ${c.nights} nuit${c.nights > 1 ? "s" : ""}<br>${acts} activités proposées</div>
       <button class="popup-btn" data-city="${c.id}">Voir les activités →</button>`
    );
    cityLayers[c.id] = m;
  });

  map.on("popupopen", (e) => {
    const btn = e.popup._contentNode.querySelector(".popup-btn");
    if (btn) btn.addEventListener("click", () => {
      setCityFilter(btn.dataset.city);
      document.getElementById("activites").scrollIntoView({ behavior: "smooth" });
    });
  });

  map.fitBounds(pts, { padding: [40, 40] });
}

/* ============================================================
   FILTRES (chips)
   ============================================================ */
function buildFilters() {
  const cityWrap = $("#cityFilters");
  cityWrap.innerHTML =
    `<button class="chip city active" data-city="all">Toutes les villes</button>` +
    TRIP.cities.map((c) => `<button class="chip city" data-city="${c.id}">${c.name}</button>`).join("");

  const catWrap = $("#catFilters");
  catWrap.innerHTML =
    `<button class="chip cat active" data-cat="all">Toutes catégories</button>` +
    Object.entries(CATS).map(([k, v]) =>
      `<button class="chip cat" data-cat="${k}" style="--catcolor:${v.color}">${v.emoji} ${v.label}</button>`).join("");
}

function bindFilters() {
  $("#cityFilters").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    setCityFilter(b.dataset.city);
  });
  $("#catFilters").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    filterState.cat = b.dataset.cat;
    $$("#catFilters .chip").forEach((c) => c.classList.toggle("active", c === b));
    renderActivities();
  });
  $("#onlyValid").addEventListener("change", (e) => { filterState.onlyValid = e.target.checked; renderActivities(); });
  $("#hideVoted").addEventListener("change", (e) => { filterState.hideVoted = e.target.checked; renderActivities(); });
}

function setCityFilter(city) {
  filterState.city = city;
  $$("#cityFilters .chip").forEach((c) => c.classList.toggle("active", c.dataset.city === city));
  renderActivities();
}

/* ============================================================
   RENDU
   ============================================================ */
function renderAll() {
  renderActivities();
  renderDashboard();
}

/* ---------- Activités ---------- */
function renderActivities() {
  const list = $("#activityList");
  const items = TRIP.activities.filter((a) => {
    if (filterState.city !== "all" && a.city !== filterState.city) return false;
    if (filterState.cat !== "all" && a.cat !== filterState.cat) return false;
    if (filterState.onlyValid && !isValid(a.id)) return false;
    if (filterState.hideVoted && me && votes[a.id] && votes[a.id][me]) return false;
    return true;
  });

  $("#emptyMsg").hidden = items.length > 0;
  list.innerHTML = items.map(cardHTML).join("");

  // brancher les boutons de vote
  $$(".vote-btn", list).forEach((btn) => {
    btn.addEventListener("click", () => {
      const { act, member } = btn.dataset;
      if (!me) { toast("Sélectionne d'abord ton prénom en haut à droite ☝️"); return; }
      if (member !== me) { toast(`Tu es « ${me} » — tu ne peux voter que pour toi`); return; }
      const has = votes[act] && votes[act][member];
      Store.toggle(act, member, !has);
    });
  });
}

function cardHTML(a) {
  const cat = CATS[a.cat];
  const cnt = countOf(a.id);
  const valid = cnt >= THRESHOLD;
  const city = TRIP.cities.find((c) => c.id === a.city);

  const notes =
    (a.tip  ? `<div class="act-note tip"><b>💡</b><span>${a.tip}</span></div>` : "") +
    (a.warn ? `<div class="act-note warn"><b>⚠️</b><span>${a.warn}</span></div>` : "");

  const tags = (a.tags || []).map((t) =>
    `<span class="tag ${t}">${tagLabel(t)}</span>`).join("");

  const buttons = MEMBERS.map((m) => {
    const on = votes[a.id] && votes[a.id][m];
    const isMe = m === me;
    return `<button class="vote-btn ${on ? "on" : ""} ${isMe ? "me" : ""}"
              style="--member-color:${colorFor(m)}"
              data-act="${a.id}" data-member="${m}" title="${on ? "A voté" : "Pas de vote"}">
              <span class="v-name">${m}</span>
              <span class="v-mark">${on ? "✓" : "+"}</span>
            </button>`;
  }).join("");

  return `<article class="act ${valid ? "valid" : ""}" style="--catcolor:${cat.color}">
    <span class="act-valid-badge">✓ Validée</span>
    <div class="act-top">
      <span class="act-cat" title="${cat.label}">${cat.emoji}</span>
      <div class="act-titles">
        <div class="act-title">${a.title} ${a.jp ? `<span class="act-jp">${a.jp}</span>` : ""}</div>
        <div class="act-city">${city.name}</div>
      </div>
    </div>
    <p class="act-desc">${a.desc}</p>
    ${notes}
    ${tags ? `<div class="act-tags">${tags}</div>` : ""}
    <div class="act-vote">
      <div class="vote-row">${buttons}</div>
      <div class="vote-tally">
        <span class="tally-count"><b>${cnt}</b>/${MEMBERS.length} vote${cnt > 1 ? "s" : ""}</span>
        <span class="tally-state ${valid ? "yes" : "no"}">${valid ? "✓ Au programme" : `${THRESHOLD - cnt > 0 ? THRESHOLD - cnt : 0} pour valider`}</span>
      </div>
    </div>
  </article>`;
}

function tagLabel(t) {
  return {
    reservation: "Réservation",
    unesco: "UNESCO",
    incontournable: "Incontournable",
    insolite: "Insolite",
    food: "À manger",
    fermeture: "Fermeture",
    gratuit: "Gratuit",
  }[t] || t;
}

/* ---------- Tableau de bord ---------- */
function renderDashboard() {
  const total = TRIP.activities.length;
  const valid = TRIP.activities.filter((a) => isValid(a.id)).length;
  $("#kpiActs").textContent = total;
  $("#kpiValid").textContent = valid;
  $("#kpiCities").textContent = TRIP.cities.length;

  // votes par membre
  const counts = Object.fromEntries(MEMBERS.map((m) => [m, 0]));
  TRIP.activities.forEach((a) => yesMembers(a.id).forEach((m) => counts[m]++));
  const max = Math.max(1, ...Object.values(counts));
  $("#membersList").innerHTML = MEMBERS.map((m) => `
    <li>
      <span class="m-dot" style="background:${colorFor(m)}">${m[0]}</span>
      <span style="min-width:46px">${m}</span>
      <span class="m-bar"><span style="width:${(counts[m] / max) * 100}%;background:${colorFor(m)}"></span></span>
      <span class="m-count">${counts[m]}</span>
    </li>`).join("");

  // progression par ville
  $("#cityBars").innerHTML = TRIP.cities.map((c) => {
    const acts = cityActs(c.id);
    const v = acts.filter((a) => isValid(a.id)).length;
    const pct = acts.length ? (v / acts.length) * 100 : 0;
    return `<div class="citybar" data-city="${c.id}">
      <div class="citybar-top">
        <span class="citybar-name">${c.name}<small>${c.jp}</small></span>
        <span class="citybar-count">${v}/${acts.length}</span>
      </div>
      <div class="citybar-track"><span style="width:${pct}%"></span></div>
    </div>`;
  }).join("");
  $$("#cityBars .citybar").forEach((el) => el.addEventListener("click", () => {
    setCityFilter(el.dataset.city);
    document.getElementById("activites").scrollIntoView({ behavior: "smooth" });
  }));
}

/* ---------- Itinéraire ---------- */
function renderTimeline() {
  $("#timeline").innerHTML = TRIP.timeline.map((t) => `
    <li class="tl">
      <div class="tl-date">${t.date}<small>${t.day}</small></div>
      <div class="tl-body"><h4>${t.title}</h4><p>${t.desc}</p></div>
    </li>`).join("");
}

/* ---------- Pratique ---------- */
function renderPractical() {
  $("#practicalGrid").innerHTML = TRIP.practical.map((p) => `
    <div class="prac">
      <div class="prac-icon">${p.icon}</div>
      <h4>${p.title}</h4>
      <p>${p.body}</p>
    </div>`).join("");
}

function renderPhrases() {
  $("#phrases").innerHTML = TRIP.phrases.map(([jp, ro, fr]) => `
    <div class="phrase">
      <span class="jpw">${jp}</span>
      <span class="romaji">${ro}</span>
      <span class="fr">${fr}</span>
    </div>`).join("");
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => (t.hidden = true), 300);
  }, 2600);
}

/* ---------- Go ---------- */
init();
