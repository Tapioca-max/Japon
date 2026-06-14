/* ============================================================
   日本旅行 2026 — Logique de l'application (v2)
   - Identité du membre, votes (LOCAL ou CLOUD temps réel)
   - Édition PARTAGÉE du catalogue d'activités et de l'itinéraire
     (les votes ne sont jamais modifiés par ces éditions)
   - Carte interactive, tableau de bord, liens de réservation
   ============================================================ */

const TRIP = window.TRIP;
const MEMBERS = TRIP.members;
const THRESHOLD = TRIP.voteThreshold;
const CATS = TRIP.categories;
const ROOM = window.JAPON_CONFIG?.room || "japon-2026";

const MEMBER_COLORS = { Sacha:"#b3001b", Manon:"#c026a0", Raph:"#3b6ea5", Ivo:"#2f7d4f" };
const colorFor = (m) => MEMBER_COLORS[m] || "#1b2440";

const LS_ME      = "japon2026.me";
const LS_VOTES   = "japon2026.votes." + ROOM;
const LS_CATALOG = "japon2026.catalog." + ROOM;
const LS_ITIN    = "japon2026.itin." + ROOM;
const LS_EDIT    = "japon2026.editmode";

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let votes = {};                                   // { actId: { member:true } }
let catalog = normCatalog(null); // édition partagée : activités + villes
function normCatalog(c) {
  c = c || {};
  return {
    custom: c.custom || {}, edits: c.edits || {}, removed: c.removed || {},
    cities: c.cities || {}, cityEdits: c.cityEdits || {}, cityRemoved: c.cityRemoved || {},
  };
}
let itinOverride = null;                           // itinéraire édité (sinon TRIP.timeline)
let me = localStorage.getItem(LS_ME) || "";
let editMode = localStorage.getItem(LS_EDIT) === "1";

/* ---------- Catalogue effectif (base + éditions partagées) ---------- */
function getActs() {
  const out = [];
  TRIP.activities.forEach((a) => {
    if (catalog.removed[a.id]) return;
    out.push({ ...a, ...(catalog.edits[a.id] || {}), _base: true });
  });
  Object.values(catalog.custom || {}).forEach((a) => {
    if (a && a.id && !catalog.removed[a.id]) out.push({ ...a, _custom: true });
  });
  return out;
}
function getItinerary() { return itinOverride && itinOverride.length ? itinOverride : TRIP.timeline; }

/* ---------- Villes effectives (base + villes ajoutées), triées par date ---------- */
function getCities() {
  const out = [];
  TRIP.cities.forEach((c) => {
    if (catalog.cityRemoved[c.id]) return;
    out.push({ ...c, ...(catalog.cityEdits[c.id] || {}) });
  });
  Object.values(catalog.cities || {}).forEach((c) => {
    if (c && c.id && !catalog.cityRemoved[c.id]) out.push({ ...c });
  });
  // nombre de nuits dérivé des dates (départ − arrivée)
  out.forEach((c) => { const n = nightsBetween(c.arrival, c.departure); if (n != null) c.nights = n; });
  return out.sort((a, b) => String(a.arrival || "9999").localeCompare(String(b.arrival || "9999")));
}
const isCustomCity = (id) => !!(catalog.cities && catalog.cities[id]);

const yesMembers = (id) => MEMBERS.filter((m) => votes[id] && votes[id][m]);
const countOf    = (id) => yesMembers(id).length;
const isValid    = (id) => countOf(id) >= THRESHOLD;
const cityActs   = (cid) => getActs().filter((a) => a.city === cid);

/* ============================================================
   STOCKAGE (local <-> cloud)  — votes + catalogue + itinéraire
   ============================================================ */
const Store = {
  mode: "local", _cb: null, _fb: null, _room: ROOM,

  async init(cb) {
    this._cb = cb;
    const cfg = window.JAPON_CONFIG?.firebase;
    if (cfg && cfg.databaseURL) {
      try { await this._initCloud(cfg); return; }
      catch (e) { console.warn("[Japon] Cloud indisponible → mode local :", e); toast("Cloud injoignable — mode local"); }
    }
    this._initLocal();
  },

  _loadLocal() {
    try { votes = JSON.parse(localStorage.getItem(LS_VOTES) || "{}"); } catch { votes = {}; }
    try { catalog = normCatalog(JSON.parse(localStorage.getItem(LS_CATALOG) || "{}")); }
    catch { catalog = normCatalog(null); }
    try { itinOverride = JSON.parse(localStorage.getItem(LS_ITIN) || "null"); } catch { itinOverride = null; }
  },

  _initLocal() {
    this.mode = "local";
    this._loadLocal();
    this._cb(this.mode);
    window.addEventListener("storage", (e) => {
      if ([LS_VOTES, LS_CATALOG, LS_ITIN].includes(e.key)) { this._loadLocal(); this._cb(this.mode); }
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
    onValue(ref(db, `rooms/${this._room}`), (snap) => {
      const v = snap.val() || {};
      votes = v.votes || {};
      catalog = normCatalog(v.catalog);
      itinOverride = v.itinerary ? normalizeArr(v.itinerary) : null;
      this._cb(this.mode);
    });
  },

  // ---- Votes (logique inchangée) ----
  async toggleVote(actId, member, value) {
    if (this.mode === "cloud") {
      const { db, ref, set, remove } = this._fb;
      try {
        const r = ref(db, `rooms/${this._room}/votes/${actId}/${member}`);
        if (value) await set(r, true); else await remove(r);
      } catch (e) { console.error(e); toast("Vote non enregistré (réseau)"); }
    } else {
      if (!votes[actId]) votes[actId] = {};
      if (value) votes[actId][member] = true; else delete votes[actId][member];
      if (Object.keys(votes[actId]).length === 0) delete votes[actId];
      localStorage.setItem(LS_VOTES, JSON.stringify(votes));
      this._cb(this.mode);
    }
  },

  // ---- Catalogue ----
  async saveActivity(obj, isCustom) {
    if (this.mode === "cloud") {
      const { db, ref, set } = this._fb;
      const path = isCustom ? `catalog/custom/${obj.id}` : `catalog/edits/${obj.id}`;
      await set(ref(db, `rooms/${this._room}/${path}`), obj);
    } else {
      if (isCustom) catalog.custom[obj.id] = obj; else catalog.edits[obj.id] = obj;
      this._persistCatalog();
    }
  },
  async removeActivity(id, isCustom) {
    if (this.mode === "cloud") {
      const { db, ref, set, remove } = this._fb;
      if (isCustom) await remove(ref(db, `rooms/${this._room}/catalog/custom/${id}`));
      else await set(ref(db, `rooms/${this._room}/catalog/removed/${id}`), true);
    } else {
      if (isCustom) delete catalog.custom[id]; else catalog.removed[id] = true;
      this._persistCatalog();
    }
  },
  async restoreActivity(id) {
    if (this.mode === "cloud") {
      const { db, ref, remove } = this._fb;
      await remove(ref(db, `rooms/${this._room}/catalog/removed/${id}`));
    } else { delete catalog.removed[id]; this._persistCatalog(); }
  },
  _persistCatalog() { localStorage.setItem(LS_CATALOG, JSON.stringify(catalog)); this._cb(this.mode); },

  // ---- Villes ----
  async saveCity(obj, isCustom) {
    if (this.mode === "cloud") {
      const { db, ref, set } = this._fb;
      const path = isCustom ? `catalog/cities/${obj.id}` : `catalog/cityEdits/${obj.id}`;
      await set(ref(db, `rooms/${this._room}/${path}`), obj);
    } else {
      if (isCustom) catalog.cities[obj.id] = obj; else catalog.cityEdits[obj.id] = obj;
      this._persistCatalog();
    }
  },
  async removeCity(id, isCustom) {
    if (this.mode === "cloud") {
      const { db, ref, set, remove } = this._fb;
      if (isCustom) await remove(ref(db, `rooms/${this._room}/catalog/cities/${id}`));
      else await set(ref(db, `rooms/${this._room}/catalog/cityRemoved/${id}`), true);
    } else {
      if (isCustom) delete catalog.cities[id]; else catalog.cityRemoved[id] = true;
      this._persistCatalog();
    }
  },
  async restoreCity(id) {
    if (this.mode === "cloud") {
      const { db, ref, remove } = this._fb;
      await remove(ref(db, `rooms/${this._room}/catalog/cityRemoved/${id}`));
    } else { delete catalog.cityRemoved[id]; this._persistCatalog(); }
  },

  // ---- Itinéraire ----
  async saveItinerary(arr) {
    if (this.mode === "cloud") {
      const { db, ref, set } = this._fb;
      await set(ref(db, `rooms/${this._room}/itinerary`), arr);
    } else {
      itinOverride = arr; localStorage.setItem(LS_ITIN, JSON.stringify(arr)); this._cb(this.mode);
    }
  },
};

function normalizeArr(v) { return Array.isArray(v) ? v.filter(Boolean) : Object.values(v).filter(Boolean); }

/* ============================================================
   FILTRES
   ============================================================ */
const filterState = { city:"all", cat:"all", onlyValid:false, hideVoted:false, q:"" };
const norm = (s) => (s || "").toString().toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");   // insensible aux accents

/* ============================================================
   INIT
   ============================================================ */
function init() {
  buildMeSelect();
  buildHeroDates();
  buildMap();
  buildFilters();
  bindFilters();
  bindEditUI();
  renderPractical();
  renderPhrases();
  applyEditMode();
  setupRouter();

  Store.init((mode) => { setSyncIndicator(mode); renderAll(); });
}

/* ---------- Routeur : une vue (page) à la fois ---------- */
const VIEW_IDS = ["tableau", "activites", "plan", "itineraire", "pratique"];
function showView(id) {
  if (!VIEW_IDS.includes(id)) id = "tableau";
  VIEW_IDS.forEach((v) => document.getElementById(v).classList.toggle("active", v === id));
  [...$$(".nav a"), ...$$(".botnav a")].forEach((a) =>
    a.classList.toggle("active", a.getAttribute("href") === "#" + id));
  window.scrollTo(0, 0);
  // Le bouton « Éditer » n'a de sens que sur les pages éditables (ni Plan, ni Infos)
  $("#editToggle").style.display = (id === "pratique" || id === "plan") ? "none" : "";
  // Leaflet a besoin d'un recalcul quand sa vue (re)devient visible
  if (id === "tableau" && map) setTimeout(() => map.invalidateSize(), 80);
}
function goView(id) { if (location.hash.slice(1) === id) showView(id); else location.hash = id; }
function setupRouter() {
  // délégation : tout lien #vue (nav, barre du bas, boutons internes) change de page
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]'); if (!a) return;
    const id = a.getAttribute("href").slice(1);
    if (VIEW_IDS.includes(id)) { e.preventDefault(); goView(id); }
  });
  window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
  showView(location.hash.slice(1) || "tableau");
}

/* ---------- Compteur animé ---------- */
function animateNumber(el, to) {
  if (!el) return;
  const from = parseInt(el.textContent, 10);
  if (isNaN(from) || from === to) { el.textContent = to; return; }
  const start = performance.now(), dur = 450;
  const step = (t) => {
    const k = Math.min(1, (t - start) / dur);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function buildMeSelect() {
  const sel = $("#meSelect");
  sel.innerHTML = `<option value="">— choisis —</option>` +
    MEMBERS.map((m) => `<option value="${m}" ${m === me ? "selected" : ""}>${m}</option>`).join("");
  const paint = () => { sel.style.background = me ? colorFor(me) : "var(--gold)"; sel.style.color = me ? "#fff" : "var(--indigo)"; };
  sel.addEventListener("change", () => { me = sel.value; localStorage.setItem(LS_ME, me); paint(); renderActivities(); });
  if (me) paint();
}

function buildHeroDates() {
  const fmt = (d) => new Date(d).toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" });
  $("#heroDates").textContent = `${fmt(TRIP.period.start)} → ${fmt(TRIP.period.end)} · ${getCities().length} villes`;
  updateCountdown();
}

function updateCountdown() {
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(TRIP.period.start);
  const days = Math.round((start - today) / 86400000);
  const el = $("#cdValue"), sub = $("#cdSub");
  if (!el) return;
  if (days > 0) { el.textContent = days; sub.textContent = `Départ le ${start.toLocaleDateString("fr-FR",{day:"numeric",month:"long"})}`; $("#cdUnit").textContent = days > 1 ? "jours" : "jour"; }
  else if (days === 0) { el.textContent = "🎌"; sub.textContent = "C'est aujourd'hui !"; $("#cdUnit").textContent = ""; }
  else { el.textContent = "✓"; sub.textContent = "Bon voyage !"; $("#cdUnit").textContent = ""; }
}

function setSyncIndicator(mode) {
  const pill = $("#syncPill");
  pill.className = "sync-pill " + (mode === "cloud" ? "cloud" : "local");
  pill.title = mode === "cloud"
    ? "Cloud temps réel — votes & éditions partagés en direct"
    : "Mode local — données stockées sur cet appareil";
  $("#footerSync").textContent = mode === "cloud" ? "· ☁ synchronisé" : "· 💾 local";
}

/* ============================================================
   CARTE
   ============================================================ */
let map, cityLayer, _prevCityKey = "";
function buildMap() {
  map = L.map("map", { scrollWheelZoom:false, zoomControl:true });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    { attribution:"© OpenStreetMap · © CARTO", maxZoom:18 }).addTo(map);
  cityLayer = L.layerGroup().addTo(map);
  map.setView([35.4, 136.5], 5);
  map.on("popupopen", (e) => {
    const btn = e.popup._contentNode.querySelector(".popup-btn");
    if (btn) btn.addEventListener("click", () => { setCityFilter(btn.dataset.city); scrollToId("activites"); });
  });
}

// (re)dessine le tracé et les marqueurs depuis les villes effectives — s'adapte aux ajouts/éditions
function renderMap() {
  if (!map) return;
  const cities = getCities();
  cityLayer.clearLayers();
  const pts = cities.map((c) => [c.lat, c.lng]);
  if (pts.length > 1) L.polyline([...pts, pts[0]], { color:"#d51f3f", weight:3, opacity:.7 }).addTo(cityLayer);
  const fmt = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day:"numeric", month:"short" }) : "?";
  cities.forEach((c, i) => {
    const icon = L.divIcon({ className:"", html:`<div class="city-pin"><span>${i+1}</span></div>`, iconSize:[30,30], iconAnchor:[15,28] });
    const acts = cityActs(c.id), valid = acts.filter((a)=>isValid(a.id)).length;
    L.marker([c.lat, c.lng], { icon }).addTo(cityLayer).bindPopup(
      `<div class="popup-city">${c.name} ${c.jp?`<span class="popup-jp">${c.jp}</span>`:""}</div>
       <div class="popup-meta">${fmt(c.arrival)} → ${fmt(c.departure)}${c.nights?` · ${c.nights} nuit${c.nights>1?"s":""}`:""}<br>
       <b>${valid}</b> validées / ${acts.length} idées</div>
       <button class="popup-btn" data-city="${c.id}">Voir les activités →</button>`);
  });
  const key = cities.map((c) => c.id).join(",");
  if (key !== _prevCityKey && pts.length) {
    if (pts.length === 1) map.setView(pts[0], 9); else map.fitBounds(pts, { padding:[40,40] });
    _prevCityKey = key;
  }
}

/* ============================================================
   FILTRES
   ============================================================ */
function buildFilters() {
  $("#catFilters").innerHTML =
    `<button class="chip cat active" data-cat="all">Toutes catégories</button>` +
    Object.entries(CATS).map(([k,v]) => `<button class="chip cat" data-cat="${k}" style="--catcolor:${v.color}">${v.emoji} ${v.label}</button>`).join("");
}
function renderCityFilters() {
  if (!getCities().some((c) => c.id === filterState.city)) filterState.city = "all";
  $("#cityFilters").innerHTML =
    `<button class="chip city ${filterState.city==="all"?"active":""}" data-city="all">Toutes</button>` +
    getCities().map((c) => `<button class="chip city ${filterState.city===c.id?"active":""}" data-city="${c.id}">${c.name}</button>`).join("");
}
function bindFilters() {
  $("#cityFilters").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) setCityFilter(b.dataset.city); });
  $("#catFilters").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    filterState.cat = b.dataset.cat;
    $$("#catFilters .chip").forEach((c) => c.classList.toggle("active", c === b));
    renderActivities();
  });
  $("#onlyValid").addEventListener("change", (e) => { filterState.onlyValid = e.target.checked; renderActivities(); });
  $("#hideVoted").addEventListener("change", (e) => { filterState.hideVoted = e.target.checked; renderActivities(); });
  const search = $("#searchInput"), clr = $("#searchClear");
  search.addEventListener("input", () => {
    filterState.q = norm(search.value.trim());
    clr.hidden = !search.value;
    renderActivities();
  });
  clr.addEventListener("click", () => { search.value = ""; filterState.q = ""; clr.hidden = true; search.focus(); renderActivities(); });
}
function setCityFilter(city) {
  filterState.city = city;
  $$("#cityFilters .chip").forEach((c) => c.classList.toggle("active", c.dataset.city === city));
  renderActivities();
}

/* ============================================================
   RENDU
   ============================================================ */
function renderAll() { renderMap(); renderCityFilters(); renderActivities(); renderDashboard(); renderTimeline(); renderPlan(); }

function renderActivities() {
  const list = $("#activityList");
  const acts = getActs();
  const q = filterState.q;
  const items = acts.filter((a) => {
    if (filterState.city !== "all" && a.city !== filterState.city) return false;
    if (filterState.cat !== "all" && a.cat !== filterState.cat) return false;
    if (filterState.onlyValid && !isValid(a.id)) return false;
    if (filterState.hideVoted && me && votes[a.id] && votes[a.id][me]) return false;
    if (q) {
      const city = getCities().find((c) => c.id === a.city);
      const hay = norm([a.title, a.jp, a.desc, a.tip, a.warn, city && city.name, (a.tags||[]).join(" ")].join(" "));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  $("#actCount").textContent = `${items.length} activité${items.length>1?"s":""}`;
  $("#emptyMsg").hidden = items.length > 0;
  list.innerHTML = items.map(cardHTML).join("");

  $$(".vote-btn", list).forEach((btn) => btn.addEventListener("click", () => {
    const { act, member } = btn.dataset;
    if (!me) { toast("Choisis d'abord ton prénom en haut à droite ☝️"); return; }
    if (member !== me) { toast(`Tu es « ${me} » — tu ne votes que pour toi`); return; }
    Store.toggleVote(act, member, !(votes[act] && votes[act][member]));
  }));
  $$(".act-edit", list).forEach((b) => b.addEventListener("click", () => openActivityModal(b.dataset.id)));
  $$(".act-del", list).forEach((b) => b.addEventListener("click", () => deleteActivity(b.dataset.id)));

  renderHiddenPanel();
}

function mapsLink(a) {
  const city = getCities().find((c) => c.id === a.city);
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${a.title} ${city?city.name:""} Japan`);
}

function cardHTML(a) {
  const cat = CATS[a.cat] || { emoji:"📍", label:"", color:"#888" };
  const cnt = countOf(a.id), valid = cnt >= THRESHOLD;
  const city = getCities().find((c) => c.id === a.city);
  const notes =
    (a.tip  ? `<div class="act-note tip"><b>💡</b><span>${a.tip}</span></div>` : "") +
    (a.warn ? `<div class="act-note warn"><b>⚠️</b><span>${a.warn}</span></div>` : "");
  const tags = (a.tags || []).map((t) => `<span class="tag ${t}">${tagLabel(t)}</span>`).join("");

  const links = `<div class="act-links">
      ${a.booking ? `<a class="lnk book" href="${a.booking}" target="_blank" rel="noopener">🎫 Réserver</a>` : ""}
      ${a.url ? `<a class="lnk" href="${a.url}" target="_blank" rel="noopener">🔗 Site</a>` : ""}
      <a class="lnk" href="${mapsLink(a)}" target="_blank" rel="noopener">📍 Carte</a>
    </div>`;

  const buttons = MEMBERS.map((m) => {
    const on = votes[a.id] && votes[a.id][m], isMe = m === me;
    return `<button class="vote-btn ${on?"on":""} ${isMe?"me":""}" style="--member-color:${colorFor(m)}"
              data-act="${a.id}" data-member="${m}"><span class="v-name">${m}</span><span class="v-mark">${on?"✓":"+"}</span></button>`;
  }).join("");

  return `<article class="act ${valid?"valid":""}" style="--catcolor:${cat.color}">
    <span class="act-valid-badge">✓ Validée</span>
    <div class="act-admin">
      <button class="act-edit" data-id="${a.id}" title="Modifier">✏️</button>
      <button class="act-del" data-id="${a.id}" title="Supprimer">🗑️</button>
    </div>
    <div class="act-top">
      <span class="act-cat" title="${cat.label}">${cat.emoji}</span>
      <div class="act-titles">
        <div class="act-title">${a.title} ${a.jp?`<span class="act-jp">${a.jp}</span>`:""}</div>
        <div class="act-city">${city?city.name:""}</div>
      </div>
    </div>
    <p class="act-desc">${a.desc || ""}</p>
    ${notes}
    ${tags ? `<div class="act-tags">${tags}</div>` : ""}
    ${links}
    <div class="act-vote">
      <div class="vote-row">${buttons}</div>
      <div class="vote-tally">
        <span class="tally-count"><b>${cnt}</b>/${MEMBERS.length} vote${cnt>1?"s":""}</span>
        <span class="tally-state ${valid?"yes":"no"}">${valid?"✓ Au programme":`encore ${Math.max(0,THRESHOLD-cnt)} pour valider`}</span>
      </div>
    </div>
  </article>`;
}

function tagLabel(t) {
  return { reservation:"Réservation", unesco:"UNESCO", incontournable:"Incontournable",
    insolite:"Insolite", food:"À manger", fermeture:"Fermeture", gratuit:"Gratuit" }[t] || t;
}

function renderDashboard() {
  const acts = getActs();
  animateNumber($("#kpiActs"), acts.length);
  animateNumber($("#kpiValid"), acts.filter((a) => isValid(a.id)).length);
  animateNumber($("#kpiCities"), getCities().length);

  const counts = Object.fromEntries(MEMBERS.map((m) => [m, 0]));
  acts.forEach((a) => yesMembers(a.id).forEach((m) => counts[m]++));
  const max = Math.max(1, ...Object.values(counts));
  $("#membersList").innerHTML = MEMBERS.map((m) => `
    <li><span class="m-dot" style="background:${colorFor(m)}">${m[0]}</span>
      <span class="m-name">${m}</span>
      <span class="m-bar"><span style="width:${(counts[m]/max)*100}%;background:${colorFor(m)}"></span></span>
      <span class="m-count">${counts[m]}</span></li>`).join("");

  $("#cityBars").innerHTML = getCities().map((c) => {
    const ca = cityActs(c.id), v = ca.filter((a) => isValid(a.id)).length;
    const pct = ca.length ? (v/ca.length)*100 : 0;
    return `<div class="citybar" data-city="${c.id}">
      <div class="citybar-top">
        <span class="citybar-name">${c.name}${c.jp?`<small>${c.jp}</small>`:""}</span>
        <span class="citybar-count">${v}/${ca.length}</span>
        <span class="citybar-admin">
          <button class="city-edit" data-id="${c.id}" title="Modifier la ville">✏️</button>
          <button class="city-del" data-id="${c.id}" title="Retirer la ville">🗑️</button>
        </span>
      </div>
      <div class="citybar-track"><span style="width:${pct}%"></span></div></div>`;
  }).join("");
  $$("#cityBars .citybar").forEach((el) => el.addEventListener("click", (e) => {
    if (e.target.closest(".citybar-admin")) return;
    setCityFilter(el.dataset.city); scrollToId("activites");
  }));
  $$("#cityBars .city-edit").forEach((b) => b.addEventListener("click", () => openCityModal(b.dataset.id)));
  $$("#cityBars .city-del").forEach((b) => b.addEventListener("click", () => deleteCity(b.dataset.id)));
}

/* ---------- Itinéraire : villes + trajets 🚄 intégrés dans le fil ---------- */
function renderTimeline() {
  const it = getItinerary();
  const cities = getCities();
  const fmt = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day:"numeric", month:"short" }) : "?";
  const belongs = (t, c) => t.cityId ? t.cityId === c.id
    : (!t.cityId && norm((t.title||"") + " " + (t.desc||"")).includes(norm(c.name)));

  const stepLi = (t, i) => {
    const assigned = (t.acts || []).map((aid) => getActs().find((a) => a.id === aid)).filter(Boolean);
    const actsHtml = assigned.length ? `<ul class="tl-acts">${assigned.map((a) =>
      `<li>${CATS[a.cat]?.emoji || "📍"} ${a.title}${a.booking?` <a class="pc-link" href="${a.booking}" target="_blank" rel="noopener">🎫</a>`:""}</li>`).join("")}</ul>` : "";
    return `
    <li class="tl">
      <div class="tl-date"><span class="tl-d">${t.date}</span>${t.day?`<small>${t.day}</small>`:""}</div>
      <div class="tl-body">
        <div class="tl-admin">
          <button class="tl-edit" data-i="${i}" title="Modifier">✏️</button>
          <button class="tl-del" data-i="${i}" title="Supprimer">🗑️</button>
        </div>
        <h4>${t.title}</h4>${t.desc?`<p>${t.desc}</p>`:""}${actsHtml}
      </div>
    </li>`;
  };
  const cityLi = (c, i) => `
    <li class="tl tl-city">
      <div class="tl-date"></div>
      <div class="tl-citybody">
        <h4><span class="tl-citynum">${i+1}</span> ${c.name} ${c.jp?`<span class="jp">${c.jp}</span>`:""}</h4>
        <span class="tl-citymeta">${fmt(c.arrival)} → ${fmt(c.departure)}${c.nights!=null?` · ${c.nights} nuit${c.nights>1?"s":""}`:""}</span>
      </div>
    </li>`;
  const transitLi = (a, b) => `<li class="tl tl-transit"><div class="tl-date"></div><div class="tt">🚄 ${a} → ${b}</div></li>`;
  const addLi = (cid, name) => `<li class="tl-insert"><button class="tl-add" data-city="${cid}" title="Ajouter une étape à ${name}">＋</button></li>`;

  const used = new Set();
  let html = "";
  cities.forEach((c, i) => {
    html += cityLi(c, i);
    it.forEach((t, idx) => { if (!used.has(idx) && belongs(t, c)) { used.add(idx); html += stepLi(t, idx); } });
    html += addLi(c.id, c.name);
    if (i < cities.length - 1) html += transitLi(c.name, cities[i + 1].name);
  });
  const others = it.map((t, idx) => ({ t, idx })).filter(({ idx }) => !used.has(idx));
  if (others.length) {
    html += `<li class="tl tl-city tl-other"><div class="tl-date"></div><div class="tl-citybody"><h4>✦ Autres étapes</h4></div></li>`;
    others.forEach(({ t, idx }) => { html += stepLi(t, idx); });
  }
  $("#timeline").innerHTML = html;
  $$("#timeline .tl-edit").forEach((b) => b.addEventListener("click", () => openItinModal(+b.dataset.i)));
  $$("#timeline .tl-del").forEach((b) => b.addEventListener("click", () => deleteItin(+b.dataset.i)));
  $$("#timeline .tl-add").forEach((b) => b.addEventListener("click", () => openItinModal(null, null, b.dataset.city)));
}

/* ---------- Plan de voyage (validées + itinéraire, par ville/date) ---------- */
function renderPlan() {
  const wrap = $("#planContent");
  if (!wrap) return;
  const cities = getCities();
  const acts = getActs();
  const it = getItinerary();
  const totalValid = acts.filter((a) => isValid(a.id)).length;
  const reservations = acts.filter((a) => isValid(a.id) && (a.tags || []).includes("reservation"));
  const fmt = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day:"numeric", month:"long" }) : "?";

  const resBanner = reservations.length ? `
    <div class="plan-res">
      <h3>🎫 À réserver à l'avance — ${reservations.length}</h3>
      <ul>${reservations.map((a) => {
        const c = getCities().find((x) => x.id === a.city);
        return `<li><b>${a.title}</b>${c?` <span class="pr-city">${c.name}</span>`:""}${a.booking?` — <a href="${a.booking}" target="_blank" rel="noopener">réserver →</a>`:""}${a.warn?`<span class="pr-warn">${a.warn}</span>`:""}</li>`;
      }).join("")}</ul>
    </div>` : "";

  const cityBlocks = cities.map((c, i) => {
    const v = acts.filter((a) => a.city === c.id && isValid(a.id));
    const pending = acts.filter((a) => a.city === c.id && !isValid(a.id)).length;
    const steps = it.filter((t) => norm((t.title||"") + " " + (t.desc||"")).includes(norm(c.name)));
    const byCat = {};
    v.forEach((a) => { (byCat[a.cat] = byCat[a.cat] || []).push(a); });
    const actsHtml = v.length
      ? Object.entries(byCat).map(([k, list]) => `
          <div class="plan-cat">
            <span class="pc-emoji" title="${CATS[k]?.label||""}">${CATS[k]?.emoji || "📍"}</span>
            <div class="pc-list">${list.map((a) => {
              const parts = yesMembers(a.id);
              const partsHtml = parts.length === MEMBERS.length
                ? `<span class="pc-all">👥 Tout le monde</span>`
                : `<span class="pc-who">${parts.map((m) => `<span class="who-chip" style="--mc:${colorFor(m)}">${m}</span>`).join("")}</span>`;
              return `
              <div class="pc-item">
                <span class="pc-title">${a.title}</span>
                ${(a.tags||[]).includes("reservation") ? `<span class="pc-tag">réservation</span>` : ""}
                ${a.booking ? `<a class="pc-link" href="${a.booking}" target="_blank" rel="noopener">🎫</a>` : ""}
                <a class="pc-link" href="${mapsLink(a)}" target="_blank" rel="noopener">📍</a>
                ${partsHtml}
              </div>`;
            }).join("")}</div>
          </div>`).join("")
      : `<p class="plan-empty">Aucune activité validée ici pour l'instant — <a href="#activites">votez !</a></p>`;
    const stepsHtml = steps.length
      ? `<div class="plan-days">${steps.map((t) => `<span class="plan-day"><b>${t.date}</b> · ${t.title}</span>`).join("")}</div>`
      : "";
    return `<article class="plan-city">
      <div class="plan-city-head">
        <span class="pch-num">${i+1}</span>
        <div class="pch-info">
          <h3>${c.name} ${c.jp?`<span class="jp">${c.jp}</span>`:""}</h3>
          <span class="pch-meta">${fmt(c.arrival)} → ${fmt(c.departure)}${c.nights?` · ${c.nights} nuit${c.nights>1?"s":""}`:""}</span>
        </div>
        <span class="pch-count">${v.length}<small>validée${v.length>1?"s":""}</small></span>
      </div>
      ${stepsHtml}
      ${actsHtml}
      ${pending ? `<p class="plan-pending">＋ ${pending} idée${pending>1?"s":""} encore en attente de votes</p>` : ""}
    </article>`;
  }).join("");

  wrap.innerHTML = `
    <div class="plan-summary">
      <span><b>${totalValid}</b> activités validées · <b>${cities.length}</b> villes</span>
      <button class="btn ghost sm" id="printPlan">🖨️ Imprimer / PDF</button>
    </div>
    ${resBanner}
    <div class="plan-cities">${cityBlocks}</div>`;
  const pb = $("#printPlan"); if (pb) pb.addEventListener("click", () => window.print());
}

function renderPractical() {
  $("#practicalGrid").innerHTML = TRIP.practical.map((p) =>
    `<div class="prac"><div class="prac-icon">${p.icon}</div><h4>${p.title}</h4><p>${p.body}</p></div>`).join("");
}
function renderPhrases() {
  $("#phrases").innerHTML = TRIP.phrases.map(([jp,ro,fr]) =>
    `<div class="phrase"><span class="jpw">${jp}</span><span class="romaji">${ro}</span><span class="fr">${fr}</span></div>`).join("");
}

/* ============================================================
   MODE ÉDITION
   ============================================================ */
function bindEditUI() {
  $("#editToggle").addEventListener("click", () => {
    editMode = !editMode;
    localStorage.setItem(LS_EDIT, editMode ? "1" : "0");
    applyEditMode();
    if (editMode) toast("✏️ Mode édition — tes modifs sont partagées avec le groupe");
  });
  $("#addActivityBtn").addEventListener("click", () => openActivityModal(null));
  $("#addItinBtn").addEventListener("click", () => openItinModal(null));
  $("#addCityBtn").addEventListener("click", startCityPick);
}
function applyEditMode() {
  document.body.classList.toggle("edit-mode", editMode);
  const t = $("#editToggle");
  t.classList.toggle("on", editMode);
  t.textContent = editMode ? "✓ Édition" : "✏️ Éditer";
  renderHiddenPanel();
}

function deleteActivity(id) {
  const a = getActs().find((x) => x.id === id) || TRIP.activities.find((x) => x.id === id);
  if (!a) return;
  confirmDialog({
    title: `Supprimer « ${a.title} » ?`,
    message: `L'activité sera retirée de la liste.<span class="confirm-sub">Les votes sont conservés ; tu pourras la restaurer.</span>`,
    confirmLabel: "Supprimer", danger: true,
    onConfirm: () => { Store.removeActivity(id, !!catalog.custom[id]); toast("Activité supprimée"); },
  });
}

/* Confirmation intégrée (remplace le popup natif du navigateur) */
function confirmDialog({ title, message, confirmLabel = "Confirmer", danger = false, onConfirm }) {
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal-overlay"><div class="modal modal-confirm">
    <div class="modal-head"><h3>${title}</h3><button class="modal-x" aria-label="Fermer">✕</button></div>
    <div class="modal-body"><p class="confirm-msg">${message}</p></div>
    <div class="modal-foot">
      <button type="button" class="btn ghost" data-act="cancel">Annuler</button>
      <button type="button" class="btn ${danger ? "danger" : "primary"}" data-act="ok">${confirmLabel}</button>
    </div></div></div>`;
  const close = () => { root.innerHTML = ""; };
  root.querySelector(".modal-x").onclick = close;
  root.querySelector('[data-act="cancel"]').onclick = close;
  root.querySelector(".modal-overlay").onclick = (e) => { if (e.target.classList.contains("modal-overlay")) close(); };
  root.querySelector('[data-act="ok"]').onclick = () => { close(); if (onConfirm) onConfirm(); };
}

function renderHiddenPanel() {
  const wrap = $("#hiddenPanel");
  if (!wrap) return;
  const aIds = Object.keys(catalog.removed || {}).filter((id) => catalog.removed[id]);
  const cIds = Object.keys(catalog.cityRemoved || {}).filter((id) => catalog.cityRemoved[id]);
  if (!editMode || (aIds.length === 0 && cIds.length === 0)) { wrap.hidden = true; wrap.innerHTML = ""; return; }
  wrap.hidden = false;
  const actBtns = aIds.map((id) => {
    const a = TRIP.activities.find((x) => x.id === id) || catalog.custom[id];
    return `<button class="hp-item" data-kind="act" data-id="${id}">↩︎ ${a ? a.title : id}</button>`;
  });
  const cityBtns = cIds.map((id) => {
    const c = getCities().find((x) => x.id === id);
    return `<button class="hp-item" data-kind="city" data-id="${id}">↩︎ ${c ? c.name : id} (ville)</button>`;
  });
  wrap.innerHTML = `<span class="hp-label">Masquées :</span>` + actBtns.join("") + cityBtns.join("");
  $$(".hp-item", wrap).forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.kind === "city") Store.restoreCity(b.dataset.id);
    else Store.restoreActivity(b.dataset.id);
    toast("Restaurée");
  }));
}

/* ---------- Villes : ajout / édition / suppression ---------- */
function startCityPick() {
  goView("tableau");
  toast("📍 Clique sur la carte pour placer la nouvelle ville");
  document.getElementById("map").classList.add("picking");
  map.once("click", (e) => {
    document.getElementById("map").classList.remove("picking");
    openCityModal(null, e.latlng);
  });
}

function openCityModal(id, latlng) {
  const c = id ? (getCities().find((x) => x.id === id) || {}) : {};
  const isNew = !id;
  const lat = latlng ? latlng.lat.toFixed(4) : (c.lat != null ? c.lat : "");
  const lng = latlng ? latlng.lng.toFixed(4) : (c.lng != null ? c.lng : "");
  const body = `
    <div class="row2">
      <label>Nom de la ville*<input name="name" value="${esc(c.name)}" required></label>
      <label>Nom japonais<input name="jp" value="${esc(c.jp)}" placeholder="例 : 札幌"></label>
    </div>
    <div class="row2">
      <label>Arrivée*<input name="arrival" type="date" value="${esc(c.arrival)}" required></label>
      <label>Départ<input name="departure" type="date" value="${esc(c.departure)}"></label>
    </div>
    <div class="row2">
      <label>Nuits <small class="lbl-auto">(calculées)</small><input name="nights" type="number" min="0" value="${esc(c.nights)}" readonly></label>
      <label>&nbsp;<button type="button" class="btn ghost" id="repickBtn">📍 Placer sur la carte</button></label>
    </div>
    <div class="row2">
      <label>Latitude*<input name="lat" value="${esc(lat)}" required></label>
      <label>Longitude*<input name="lng" value="${esc(lng)}" required></label>
    </div>
    <p class="modal-hint">Le nombre de nuits se calcule automatiquement (départ − arrivée). Le tracé se réordonne selon la date d'arrivée.</p>`;
  const root = openModal(isNew ? "Ajouter une ville" : "Modifier la ville", body, (form) => {
    const name = form.name.value.trim();
    const la = parseFloat(form.lat.value), ln = parseFloat(form.lng.value);
    if (!name) { toast("Le nom est obligatoire"); return false; }
    if (!form.arrival.value) { toast("La date d'arrivée est obligatoire"); return false; }
    if (isNaN(la) || isNaN(ln)) { toast("Place la ville sur la carte (lat/lng)"); return false; }
    const nights = nightsBetween(form.arrival.value, form.departure.value);
    const obj = {
      id: isNew ? "city-" + Date.now().toString(36) : id,
      name, jp: form.jp.value.trim(),
      arrival: form.arrival.value, departure: form.departure.value,
      nights: nights != null ? nights : undefined,
      lat: la, lng: ln,
    };
    Object.keys(obj).forEach((k) => { if (obj[k] === "" || obj[k] === undefined) delete obj[k]; });
    obj.id = isNew ? obj.id : id; obj.name = name; obj.lat = la; obj.lng = ln; obj.arrival = form.arrival.value;
    Store.saveCity(obj, isNew || isCustomCity(id));
    toast(isNew ? "Ville ajoutée ✓" : "Ville modifiée ✓");
  });
  // nuits = départ − arrivée, recalculé en direct
  const form = root.querySelector(".modal-body");
  const recompute = () => { const n = nightsBetween(form.arrival.value, form.departure.value); form.nights.value = n != null ? n : ""; };
  form.arrival.addEventListener("change", recompute);
  form.departure.addEventListener("change", recompute);
  recompute();
  const rb = root.querySelector("#repickBtn");
  if (rb) rb.addEventListener("click", () => { root.innerHTML = ""; startCityPick(); });
}
function nightsBetween(arrival, departure) {
  if (!arrival || !departure) return null;
  const n = Math.round((new Date(departure) - new Date(arrival)) / 86400000);
  return n >= 0 ? n : null;
}

function deleteCity(id) {
  const c = getCities().find((x) => x.id === id);
  if (!c) return;
  const attached = getActs().filter((a) => a.city === id);
  const n = attached.length;
  confirmDialog({
    title: `Supprimer « ${c.name} » ?`,
    message: n > 0
      ? `Cette ville et ses <b>${n} activité${n>1?"s":""} associée${n>1?"s":""}</b> seront retirées du voyage.<span class="confirm-sub">Les votes sont conservés ; les activités du guide pourront être restaurées.</span>`
      : `Cette ville sera retirée du voyage.<span class="confirm-sub">Réversible depuis le panneau « Masquées ».</span>`,
    confirmLabel: n > 0 ? `Supprimer (ville + ${n})` : "Supprimer la ville",
    danger: true,
    onConfirm: () => {
      attached.forEach((a) => Store.removeActivity(a.id, !!catalog.custom[a.id]));
      Store.removeCity(id, isCustomCity(id));
      toast(n > 0 ? `Ville et ${n} activité${n>1?"s":""} retirées` : "Ville retirée");
    },
  });
}

/* ---------- Modale générique ---------- */
function openModal(title, bodyHTML, onSave) {
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal-overlay">
    <div class="modal">
      <div class="modal-head"><h3>${title}</h3><button class="modal-x" aria-label="Fermer">✕</button></div>
      <form class="modal-body">${bodyHTML}</form>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-act="cancel">Annuler</button>
        <button type="button" class="btn primary" data-act="save">Enregistrer</button>
      </div>
    </div></div>`;
  const close = () => { root.innerHTML = ""; };
  root.querySelector(".modal-x").onclick = close;
  root.querySelector('[data-act="cancel"]').onclick = close;
  root.querySelector(".modal-overlay").onclick = (e) => { if (e.target.classList.contains("modal-overlay")) close(); };
  root.querySelector('[data-act="save"]').onclick = () => {
    const form = root.querySelector(".modal-body");
    if (onSave(form) !== false) close();
  };
  return root;
}

/* ---------- Modale activité ---------- */
function openActivityModal(id) {
  const a = id ? (getActs().find((x) => x.id === id) || {}) : {};
  const isNew = !id;
  const cityOpts = getCities().map((c) => `<option value="${c.id}" ${a.city===c.id?"selected":""}>${c.name}</option>`).join("");
  const catOpts = Object.entries(CATS).map(([k,v]) => `<option value="${k}" ${a.cat===k?"selected":""}>${v.emoji} ${v.label}</option>`).join("");
  const allTags = ["incontournable","reservation","unesco","insolite","food","gratuit","fermeture"];
  const tagChecks = allTags.map((t) =>
    `<label class="tagcheck"><input type="checkbox" name="tag" value="${t}" ${(a.tags||[]).includes(t)?"checked":""}> ${tagLabel(t)}</label>`).join("");

  const body = `
    <label>Nom de l'activité*<input name="title" value="${esc(a.title)}" required></label>
    <div class="row2">
      <label>Ville*<select name="city">${cityOpts}</select></label>
      <label>Catégorie*<select name="cat">${catOpts}</select></label>
    </div>
    <label>Nom japonais (optionnel)<input name="jp" value="${esc(a.jp)}" placeholder="例 : 浅草寺"></label>
    <label>Description<textarea name="desc" rows="3">${esc(a.desc)}</textarea></label>
    <div class="row2">
      <label>💡 Astuce<input name="tip" value="${esc(a.tip)}"></label>
      <label>⚠️ Alerte / réservation<input name="warn" value="${esc(a.warn)}"></label>
    </div>
    <div class="row2">
      <label>🔗 Site officiel<input name="url" value="${esc(a.url)}" placeholder="https://…"></label>
      <label>🎫 Lien de réservation<input name="booking" value="${esc(a.booking)}" placeholder="https://…"></label>
    </div>
    <div class="tagrow"><span class="tagrow-lbl">Étiquettes</span>${tagChecks}</div>`;

  openModal(isNew ? "Ajouter une activité" : "Modifier l'activité", body, (form) => {
    const title = form.title.value.trim();
    if (!title) { toast("Le nom est obligatoire"); return false; }
    const tags = [...form.querySelectorAll('input[name="tag"]:checked')].map((c) => c.value);
    const isCustom = isNew || !!catalog.custom[id];
    const obj = {
      id: isNew ? "custom-" + Date.now().toString(36) : id,
      city: form.city.value, cat: form.cat.value, title,
      jp: form.jp.value.trim(), desc: form.desc.value.trim(),
      tip: form.tip.value.trim(), warn: form.warn.value.trim(),
      url: form.url.value.trim(), booking: form.booking.value.trim(),
      tags,
    };
    Object.keys(obj).forEach((k) => { if (obj[k] === "" || (Array.isArray(obj[k]) && !obj[k].length)) delete obj[k]; });
    obj.id = isNew ? obj.id : id; obj.title = title; obj.city = form.city.value; obj.cat = form.cat.value;
    Store.saveActivity(obj, isCustom);
    toast(isNew ? "Activité ajoutée ✓" : "Activité modifiée ✓");
  });
}

/* ---------- Modale itinéraire ---------- */
function openItinModal(i, insertAt, cityId) {
  const it = getItinerary();
  const isEdit = i != null;
  const step = isEdit ? it[i] : {};
  const selCity = isEdit ? step.cityId : cityId;
  const title = isEdit ? "Modifier l'étape" : "Ajouter une étape";
  const cityOpts = `<option value="">— aucune —</option>` +
    getCities().map((c) => `<option value="${c.id}" ${selCity===c.id?"selected":""}>${c.name}</option>`).join("");
  const picked = new Set(step.acts || []);
  const body = `
    <div class="row2">
      <label>Dates*<input name="date" value="${esc(step.date)}" placeholder="22-24 sept" required></label>
      <label>Jour<input name="day" value="${esc(step.day)}" placeholder="Mar-Jeu"></label>
    </div>
    <label>Titre*<input name="title" value="${esc(step.title)}" required></label>
    <label>Ville (rattachement dans le fil)<select name="city">${cityOpts}</select></label>
    <label>Détail<textarea name="desc" rows="3">${esc(step.desc)}</textarea></label>
    <div class="actpick">
      <span class="tagrow-lbl">Activités validées à rattacher</span>
      <div class="actpick-list" id="actPickList"></div>
    </div>`;
  const root = openModal(title, body, (form) => {
    const date = form.date.value.trim(), ttl = form.title.value.trim();
    if (!date || !ttl) { toast("Dates et titre obligatoires"); return false; }
    const next = getItinerary().map((x) => ({ ...x }));
    const obj = { date, day: form.day.value.trim(), title: ttl, desc: form.desc.value.trim() };
    if (form.city.value) obj.cityId = form.city.value;
    if (picked.size) obj.acts = [...picked];
    if (isEdit) next[i] = obj;
    else if (insertAt != null) next.splice(insertAt, 0, obj);
    else next.push(obj);
    Store.saveItinerary(next);
    toast(isEdit ? "Étape modifiée ✓" : "Étape ajoutée ✓");
  });
  const form = root.querySelector(".modal-body");
  const pickEl = root.querySelector("#actPickList");
  renderActPicker(pickEl, selCity || "", picked);
  form.city.addEventListener("change", () => renderActPicker(pickEl, form.city.value, picked));
}

// liste de cases à cocher des activités validées (filtrée par ville)
function renderActPicker(container, cityId, picked) {
  const list = getActs().filter((a) => isValid(a.id) && (!cityId || a.city === cityId));
  if (!list.length) {
    container.innerHTML = `<p class="actpick-empty">Aucune activité validée${cityId ? " pour cette ville" : ""} pour l'instant — il en faut au moins 2 votes.</p>`;
    return;
  }
  container.innerHTML = list.map((a) => `
    <label class="actpick-item">
      <input type="checkbox" value="${a.id}" ${picked.has(a.id) ? "checked" : ""}>
      <span>${CATS[a.cat]?.emoji || "📍"} ${a.title}</span>
    </label>`).join("");
  container.querySelectorAll('input[type="checkbox"]').forEach((cb) =>
    cb.addEventListener("change", () => { cb.checked ? picked.add(cb.value) : picked.delete(cb.value); }));
}
function deleteItin(i) {
  const it = getItinerary();
  confirmDialog({
    title: `Supprimer l'étape ?`,
    message: `« ${it[i].title} » sera retirée de l'itinéraire.`,
    confirmLabel: "Supprimer", danger: true,
    onConfirm: () => {
      Store.saveItinerary(it.filter((_, idx) => idx !== i).map((x) => ({ ...x })));
      toast("Étape supprimée");
    },
  });
}
function moveItin(i, dir) {
  const it = getItinerary().map((x) => ({ ...x }));
  const j = i + dir; if (j < 0 || j >= it.length) return;
  [it[i], it[j]] = [it[j], it[i]];
  Store.saveItinerary(it);
}

/* ============================================================
   Utils
   ============================================================ */
function esc(s) { return (s == null ? "" : String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function scrollToId(id) { goView(id); }   // navigue vers la vue correspondante

let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show"); setTimeout(() => (t.hidden = true), 300); }, 2600);
}

init();
