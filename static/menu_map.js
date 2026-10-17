// Menu money · Project map: every geocoded project for a year, filterable by ward and category.
// URL is state: /menu/map?year=&ward=&category=&focus=<line id>
(function () {
  "use strict";
  const M = window.WardWiseMenu;
  const root = document.getElementById("mh-map");
  if (!root || !window.L) return;
  const esc = M.esc;
  const state = { data: null, year: null, ward: null, category: null, focus: null, items: [] };
  let map = null;
  let layer = null;
  let wardLayer = null;

  function readUrl() {
    const params = new URLSearchParams(window.location.search);
    state.year = Number(params.get("year")) || null;
    const ward = Number(params.get("ward"));
    state.ward = ward >= 1 && ward <= 50 ? ward : null;
    state.category = params.get("category") || null;
    state.focus = params.get("focus") || null;
  }
  function writeUrl() {
    M.setUrl("/menu/map", { year: state.year, ward: state.ward, category: state.category, focus: state.focus });
  }

  function controls() {
    const cats = (state.data.categories || []).map((c) => `<option value="${esc(c)}"${c === state.category ? " selected" : ""}>${esc(c)}</option>`).join("");
    return `
      <div class="ed-controls">
        <label class="report-select">Year <select id="mm-year">${M.yearOptions(state.data, state.year)}</select></label>
        <label class="report-select">Ward <select id="mm-ward"><option value="">All wards</option>${M.wardOptions(state.ward)}</select></label>
        <label class="report-select">Category <select id="mm-cat"><option value="">All categories</option>${cats}</select></label>
        <span class="mh-note" id="mm-count"></span>
      </div>`;
  }

  function popup(r) {
    return `<strong>${esc(r.item)}</strong><br>${esc(r.location)}<br>Ward ${r.ward} · ${r.year} · ${M.moneyExact(r.cost)}<br>
      <span class="mh-chip tone-${M.tone(r.category)}">${esc(M.shortName(r.category))}</span>
      ${r.source_url ? ` <a href="${esc(r.source_url)}" rel="noopener">source PDF</a>` : ""}`;
  }

  function color(category) {
    const value = getComputedStyle(document.body).getPropertyValue(`--menu-cat-${M.tone(category)}`).trim();
    return value || "#888";
  }

  function draw() {
    const shown = state.items.filter((r) => r.lat != null && (!state.category || r.category === state.category));
    const unplaced = state.items.filter((r) => r.lat == null && (!state.category || r.category === state.category)).length;
    if (layer) layer.remove();
    layer = L.layerGroup();
    let focusMarker = null;
    const maxCost = Math.max(1, ...shown.map((r) => r.cost || 0));
    shown.forEach((r) => {
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 3 + 9 * Math.sqrt((r.cost || 0) / maxCost), color: color(r.category), weight: 1,
        fillColor: color(r.category), fillOpacity: 0.55,
      }).bindPopup(popup(r));
      if (r.id === state.focus) focusMarker = marker;
      layer.addLayer(marker);
    });
    layer.addTo(map);
    const total = shown.reduce((s, r) => s + (r.cost || 0), 0);
    root.querySelector("#mm-count").textContent =
      `${shown.length.toLocaleString()} projects · ${M.money(total)}${unplaced ? ` · ${unplaced} not placed on the map (see Data &amp; methods)` : ""}`;
    if (focusMarker) {
      map.setView(focusMarker.getLatLng(), 16);
      focusMarker.openPopup();
    } else if (shown.length && state.ward) {
      map.fitBounds(L.latLngBounds(shown.map((r) => [r.lat, r.lng])).pad(0.1));
    }
    M.renderCite(root.querySelector("#mh-cite"), state.data.release,
      `project map, ${state.year}${state.ward ? `, Ward ${state.ward}` : ""}${state.category ? `, ${state.category}` : ""}`);
  }

  async function load() {
    root.querySelector("#mm-count").textContent = "Loading projects…";
    try {
      state.items = (await M.items({ year: state.year, ward: state.ward })).items || [];
    } catch (_error) {
      state.items = [];
    }
    draw();
  }

  function init() {
    root.innerHTML = `${controls()}<div id="mm-canvas" class="mh-map-canvas" role="region" aria-label="Map of menu projects"></div><div id="mh-cite"></div>`;
    map = L.map("mm-canvas", { scrollWheelZoom: false }).setView([41.84, -87.68], 11);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_2jye_1_91a0198a0781fa7a84176b2a", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);
    WardWiseExplorer.fetchJson("/api/wards.geojson", "").then((geo) => {
      wardLayer = L.geoJSON(geo, { style: { color: "#5b6472", weight: 1, fill: false, opacity: 0.5 }, interactive: false }).addTo(map);
    }).catch(() => {});
    root.querySelector("#mm-year").addEventListener("change", (e) => { state.year = Number(e.target.value); state.focus = null; writeUrl(); load(); });
    root.querySelector("#mm-ward").addEventListener("change", (e) => { state.ward = Number(e.target.value) || null; state.focus = null; writeUrl(); load(); });
    root.querySelector("#mm-cat").addEventListener("change", (e) => { state.category = e.target.value || null; writeUrl(); draw(); });
    load();
  }

  readUrl();
  M.summary().then((data) => {
    state.data = data;
    if (!M.years(data).includes(state.year)) state.year = M.defaultYear(data);
    writeUrl();
    init();
  }).catch((error) => M.unavailable(root, error));
})();
