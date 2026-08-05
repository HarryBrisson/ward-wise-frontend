// The map/ranker/score views work over any of three geographies (area_type). Each score and geojson
// feature carries a uniform area_id (ward_id for wards); these configs say how to load + label each.
const AREA_TYPES = {
  ward: {
    label: "Wards",
    noun: "ward",
    idProp: "ward_id",
    loadAreas: () => WardWiseExplorer.fetchExplorerWards().then((r) => r.wards || []),
    loadGeojson: () => WardWiseExplorer.fetchWardGeojson(),
    rankerTitle: "Top wards by weighted composite",
  },
  community_area: {
    label: "Neighborhoods",
    noun: "neighborhood",
    idProp: "community_area_id",
    loadAreas: () => WardWiseExplorer.fetchCommunityAreas().then((r) => r.community_areas || []),
    loadGeojson: () => WardWiseExplorer.fetchCommunityAreaGeojson(),
    rankerTitle: "Top neighborhoods by weighted composite",
  },
  chi: {
    // User-facing labels use the χGRID brand mark; the area_type key stays the ASCII "chi".
    label: "χGRIDs",
    noun: "χGRID",
    idProp: "chi_id",
    loadAreas: () => WardWiseExplorer.fetchChis().then((r) => r.chis || []),
    loadGeojson: () => WardWiseExplorer.fetchChigridGeojson(),
    rankerTitle: "Top χGRIDs by weighted composite",
  },
};

// Singular geography noun for the active area type ("ward" / "neighborhood" / "χGRID").
function areaNoun() {
  return areaConfig().noun;
}

function capitalize(text) {
  if (!text) return text;
  // Leave intentionally-cased brand nouns (e.g. "χGRID") as-is; only title-case plain words.
  if (text !== text.toLowerCase()) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Plural geography label, lowercased for mid-sentence use but preserving brand casing (χGRIDs).
function labelLower() {
  const label = areaConfig().label;
  return label.slice(1) === label.slice(1).toLowerCase() ? label.toLowerCase() : label;
}

const explorerState = {
  areaType: "ward",
  wards: [], // areas for the current area_type (named "wards" for history)
  areaById: new Map(),
  geojsonCache: new Map(),
  metrics: [],
  metricTimeline: null,
  timelineMetricKey: "",
  timelineLoading: false,
  metricCoverage: {},
  snapshots: [],
  weights: {},
  scores: [],
  scoreDetailsCache: new Map(),
  scoreDetailsLoading: new Set(),
  mapLayers: new Map(),
  mapAreaLayer: null,
  profileCache: new Map(),
  currentWardId: null,
  hoveredWardId: null,
  currentDetailsWardId: null,
  currentVisualizer: "visualizer-map",
  fullCityBounds: null,
  scoreRefreshId: 0,
  scoreMatrices: {},      // area_type -> precomputed component matrix; the client scores against this
  dataYears: [],          // distinct data years available (from period_end)
  metricDataYears: {},     // metric_id -> [years] it was measured (from period_end)
  timeInvariantMetrics: new Set(), // metrics valid for any year (e.g. Bean distance) — the rest are latest-only
  metricValidFrom: {},     // metric_id -> earliest valid year (e.g. Bean from 2006)
  forwardCarryYears: 0,    // a vintage measurement stays usable this many years forward
  metricMethodology: {},   // area_type -> {metric_id: [caveat keys]} for the Methodology notes panel
  selectedYear: null,     // null = latest; otherwise repoint scores to this data year
  deltaMode: false,       // when true, map shows change between deltaFromYear and deltaToYear
};

function areaConfig() {
  return AREA_TYPES[explorerState.areaType] || AREA_TYPES.ward;
}

function areaIdOf(area) {
  return area?.[areaConfig().idProp] ?? area?.area_id ?? area?.ward_id;
}

function findArea(areaId) {
  return explorerState.areaById.get(String(areaId));
}

const METRIC_SELECTION_SESSION_KEY = "wardWiseMetricSelectionSessionId";
const MAP_DETAILS_STORAGE_KEY = "wardWiseMapDetailsVisible";

// Static main-page map: user pan/zoom is disabled so the city stays framed (deliberate view
// changes still happen programmatically via setView/fitBounds below). Interaction handlers left
// on made the choropleth easy to lose; keeping it fixed reads clearer for most visitors.
const map = L.map("map", {
  dragging: false,
  scrollWheelZoom: false,
  doubleClickZoom: false,
  boxZoom: false,
  touchZoom: false,
  keyboard: false,
  zoomControl: false,
  zoomSnap: 0, // fractional zoom: fitBounds frames the city exactly (integer snap wastes ~half the pane at narrow widths); safe because the map is non-interactive
}).setView([41.8781, -87.6298], 10);
const mapDetailsLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "&copy; OpenStreetMap contributors",
});

function cssVariable(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function randomInitialWeights(metrics, count) {
  const ids = metrics.map((m) => m.metric_id);
  const picked = new Set();
  while (picked.size < Math.min(count, ids.length)) {
    picked.add(ids[Math.floor(Math.random() * ids.length)]);
  }
  return Object.fromEntries(ids.map((id) => [id, picked.has(id) ? 1 : 0]));
}

function shuffledMetrics(metrics) {
  const shuffled = [...metrics];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

// Optional focused view: ?viewtype=ejmetrics narrows the whole tool to just the Chicago EJ Index metrics
// (the 18 ej_* indicators + component scores), so a single link can drop someone into an
// environmental-justice-only version of the explorer — picker, "surprise me", and scoring all see only
// these. Falls back to the full set if the requested view has no matching metrics.
const METRIC_VIEWS = {
  ejmetrics: (metric) => String(metric.metric_id).startsWith("ej_"),
};

function applyMetricView(metrics) {
  const view = new URLSearchParams(window.location.search).get("viewtype");
  const predicate = view && METRIC_VIEWS[view];
  if (!predicate) return metrics;
  const filtered = metrics.filter(predicate);
  return filtered.length ? filtered : metrics;
}

async function initExplorer() {
  initVisualizerTabs();
  window.addEventListener("resize", () => {
    const grid = document.querySelector("#metric-weights");
    if (grid) markOverflowingDomains(grid);
  });
  initSettingsModal();
  initMobileControls();
  initMapDetailToggle();
  initAreaTypeToggle();
  setMetricControlsLoading(true);
  try {
    const metricData = await WardWiseExplorer.fetchExplorerManifest();
    explorerState.metrics = shuffledMetrics(applyMetricView(metricData.metrics));
    explorerState.metricCoverage = metricData.coverage || {};
    explorerState.metricAreaTypes = metricData.metric_area_types || {};
    explorerState.snapshots = metricData.snapshots || [];
    explorerState.dataYears = metricData.data_years || [];
    explorerState.metricDataYears = metricData.metric_data_years || {};
    explorerState.timeInvariantMetrics = new Set(metricData.time_invariant_metrics || []);
    explorerState.metricValidFrom = metricData.metric_valid_from || {};
    explorerState.forwardCarryYears = metricData.forward_carry_years || 0;
    explorerState.metricMethodology = metricData.metric_methodology || {};
    explorerState.weights = randomInitialWeights(explorerState.metrics, 5);

    renderMetricControls();
    initMetricSelectionActions();
    initTimeControls();
    initMethodology();
    await loadAreaType("ward");
  } catch (error) {
    renderMetricLoadError(error);
    renderMetricError(error);
  }
}

function initTimeControls() {
  const yearSelect = document.getElementById("year-selector");
  const deltaToggle = document.getElementById("delta-mode-toggle");
  const deltaControls = document.getElementById("delta-year-controls");
  const fromSelect = document.getElementById("delta-from-year");
  const toSelect = document.getElementById("delta-to-year");
  const years = explorerState.dataYears || [];

  if (yearSelect) {
    while (yearSelect.options.length > 1) yearSelect.remove(1); // keep the "Latest" default
    years.slice().reverse().forEach((y) => yearSelect.add(new Option(String(y), String(y))));
    yearSelect.addEventListener("change", (event) => {
      explorerState.selectedYear = event.target.value || null;
      pruneUnavailableSelections(); // drop weighted metrics with no data for this year
      renderMetricControls(); // re-offer only the metrics with data for this year
      refreshMetricViews();
    });
  }
  [fromSelect, toSelect].forEach((select) => {
    if (!select) return;
    select.innerHTML = "";
    years.forEach((y) => select.add(new Option(String(y), String(y))));
  });
  if (fromSelect && toSelect && years.length >= 2) {
    // Default to a recent ~10-year window rather than the full menu range (2005→2025), so the ACS metrics
    // (2009–2023) fall inside both endpoints and show up in change-over-time out of the box.
    fromSelect.value = String(years[Math.max(0, years.length - 11)]);
    toSelect.value = String(years.at(-1));
  }
  if (yearSelect) {
    yearSelect.addEventListener("change", updateTimeButtonLabel);
  }
  if (deltaToggle) {
    deltaToggle.addEventListener("change", (event) => {
      explorerState.deltaMode = event.target.checked;
      if (deltaControls) deltaControls.hidden = !event.target.checked;
      if (yearSelect) yearSelect.disabled = event.target.checked; // year-pick is the non-delta view
      updateTimeButtonLabel();
      pruneUnavailableSelections(); // delta needs both endpoints — drop metrics that can't span them
      renderMetricControls(); // delta needs both endpoints — re-offer only metrics that span them
      refreshMetricViews();
    });
  }
  [fromSelect, toSelect].forEach((select) =>
    select?.addEventListener("change", () => {
      if (explorerState.deltaMode) {
        updateTimeButtonLabel();
        pruneUnavailableSelections(); // a narrower window can strip a metric's second endpoint
        renderMetricControls();
        refreshMetricViews();
      }
    }),
  );

  const openBtn = document.getElementById("open-time-modal");
  const modal = document.getElementById("time-modal");
  if (openBtn && modal) {
    openBtn.addEventListener("click", () => { modal.hidden = false; });
    modal.querySelectorAll("[data-close-time-modal]").forEach((el) =>
      el.addEventListener("click", () => { modal.hidden = true; }));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) modal.hidden = true;
    });
  }
  updateTimeButtonLabel();
}

// Reflect the active time view on the "Change time" button so it's visible without opening the modal.
function updateTimeButtonLabel() {
  const btn = document.getElementById("open-time-modal");
  if (!btn) return;
  if (explorerState.deltaMode) {
    const from = document.getElementById("delta-from-year")?.value;
    const to = document.getElementById("delta-to-year")?.value;
    btn.textContent = from && to ? `Δ ${from}→${to}` : "Change time";
  } else if (explorerState.selectedYear) {
    btn.textContent = `Year ${explorerState.selectedYear}`;
  } else {
    btn.textContent = "Change time";
  }
  btn.classList.toggle("is-active", explorerState.deltaMode || Boolean(explorerState.selectedYear));
}

// Composite-score change between the two chosen years: score(to) - score(from) per area, reusing the
// year-filtered scores endpoint. Drives the diverging delta choropleth.
// The precomputed component matrix the dashboard scores against. Shape per geography:
// { yearKey: { area_id: { metric_id: {s,v} } } }. Served one year-slice per request (the whole history
// at once blew past Lambda's 6 MB response cap on χGRIDs), so we fill this store lazily and cache each
// slice; weight changes never refetch. No observation-level data ever reaches the client.
async function ensureYears(areaType, yearKeys) {
  const store = (explorerState.scoreMatrices[areaType] ||= {});
  const inflight = (explorerState.matrixInflight ||= {});
  await Promise.all(
    [...new Set(yearKeys)].filter(Boolean).map((yearKey) => {
      if (yearKey in store) return null; // slice already loaded
      const cacheKey = `${areaType}:${yearKey}`;
      if (!inflight[cacheKey]) {
        inflight[cacheKey] = WardWiseExplorer.fetchJson(
          `/api/metrics/score-matrix?area_type=${encodeURIComponent(areaType)}&year=${encodeURIComponent(yearKey)}`,
          "Unable to load score matrix.",
        )
          .then((data) => {
            Object.assign(store, data.matrix || {});
          })
          .finally(() => {
            delete inflight[cacheKey];
          });
      }
      return inflight[cacheKey];
    }),
  );
  return store;
}

// Year-slices the current view needs before it can score: always "latest" (delta's fixed domain comes
// from it and it's the score fallback), plus the chosen year or the two change-window endpoints.
function neededYearKeys() {
  const keys = ["latest"];
  if (explorerState.deltaMode) {
    const from = document.getElementById("delta-from-year")?.value;
    const to = document.getElementById("delta-to-year")?.value;
    if (from) keys.push(from);
    if (to) keys.push(to);
  } else if (explorerState.selectedYear) {
    keys.push(String(explorerState.selectedYear));
  }
  return keys;
}

// The only weight-dependent step, run client-side: weighted average of each area's precomputed
// components. Matches the server's compute_weighted_scores exactly (verified to the displayed digit).
function computeScores(weights, yearKey) {
  const matrix = explorerState.scoreMatrices[explorerState.areaType] || {};
  const slice = matrix[yearKey] || matrix.latest || {};
  const active = Object.entries(weights).filter(([, weight]) => Number(weight) > 0);
  const rows = Object.entries(slice).map(([areaId, cells]) => {
    let total = 0;
    let applied = 0;
    for (const [metricId, weight] of active) {
      if (metricId in cells) {
        total += cells[metricId].s * Number(weight);
        applied += Number(weight);
      }
    }
    return { area_id: areaId, score: applied ? Math.round((total / applied) * 100) / 100 : null };
  });
  rows.sort(
    (a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || String(a.area_id).localeCompare(String(b.area_id)),
  );
  let rank = 1;
  for (const row of rows) if (row.score != null) row.rank = rank++;
  return rows;
}

function computeDeltaScores() {
  const fromYear = document.getElementById("delta-from-year")?.value;
  const toYear = document.getElementById("delta-to-year")?.value;
  if (!fromYear || !toYear) return [];
  const matrix = explorerState.scoreMatrices[explorerState.areaType] || {};
  const active = Object.entries(explorerState.weights).filter(([, weight]) => Number(weight) > 0);
  // FIXED per-metric domain so both years score on the SAME scale (not each year's own distribution, which
  // would make the "delta" a within-year rank shift instead of the metric's actual movement).
  const { domain, normalize } = deltaNormalizer();
  // Per-metric change FIRST, then weight-average the changes — over only the metrics measurable in BOTH
  // years. Computing each metric's own movement (nₜₒ − nfᵣₒₘ) and averaging avoids the score-then-delta
  // trap where the two years average over different metric baskets (ACS/PLACES vintages don't all span the
  // same years), letting composition changes masquerade as real movement. Identical to score-then-delta
  // when the basket matches; correct when it doesn't.
  const areaIds = new Set([...Object.keys(matrix[toYear] || {}), ...Object.keys(matrix[fromYear] || {})]);
  const rows = [...areaIds].map((areaId) => {
    const fromCells = (matrix[fromYear] || {})[areaId] || {};
    const toCells = (matrix[toYear] || {})[areaId] || {};
    let total = 0;
    let applied = 0;
    for (const [metricId, weight] of active) {
      const a = fromCells[metricId];
      const b = toCells[metricId];
      if (a && b && domain[metricId]) {
        total += (normalize(b.v, metricId) - normalize(a.v, metricId)) * Number(weight);
        applied += Number(weight);
      }
    }
    const delta = applied ? Math.round((total / applied) * 100) / 100 : null;
    return { area_id: areaId, score: delta };
  });
  // Rank by signed change (biggest improvement = rank 1), mirroring computeScores so the leaderboard's
  // top-10 are the most-improved areas — not the first 10 by id, which the old rank:0 left it showing.
  rows.sort(
    (a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || String(a.area_id).localeCompare(String(b.area_id)),
  );
  let rank = 1;
  for (const row of rows) if (row.score != null) row.rank = rank++;
  return rows;
}

async function loadAreaType(areaType) {
  explorerState.areaType = AREA_TYPES[areaType] ? areaType : "ward";
  setMapShadeLoading(true); // spinner while the (slow) geojson loads + first scores render
  const config = areaConfig();
  const [areas, geojson] = await Promise.all([
    config.loadAreas(),
    explorerState.geojsonCache.get(explorerState.areaType) || config.loadGeojson(),
  ]);
  explorerState.geojsonCache.set(explorerState.areaType, geojson);
  explorerState.wards = areas;
  explorerState.areaById = new Map(areas.map((area) => [String(areaIdOf(area)), area]));
  explorerState.currentWardId = null;
  explorerState.currentDetailsWardId = null;
  explorerState.hoveredWardId = null;
  explorerState.metricTimeline = null;
  explorerState.timelineMetricKey = "";
  hideWardDetails();
  updateSelectedWardLabel(null);
  renderMap(geojson);
  renderMetricControls(); // re-filter the metric picker to what's available for this geography
  await refreshMetricViews();
}

function initAreaTypeToggle() {
  const group = document.getElementById("area-type-toggle");
  if (!group) return;
  group.querySelectorAll("button[data-area-type]").forEach((button) => {
    button.addEventListener("click", async () => {
      const areaType = button.dataset.areaType;
      if (areaType === explorerState.areaType) return;
      group.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b === button));
      group.setAttribute("aria-busy", "true");
      WardWiseExplorer.track("explore_area_type", { area_type: areaType });
      try {
        await loadAreaType(areaType);
      } finally {
        group.removeAttribute("aria-busy");
      }
    });
  });
}

// Phone layout (≤640px): a Map/Leaderboard segmented toggle shows one card at a time, and the input
// panel collapses into a bottom metric strip with an "All metrics" sheet expander. The controls are
// display:none on desktop, so this wiring is inert there.
// Display settings (gear in the input panel): picker layout choice, remembered per browser.
function initSettingsModal() {
  const modal = document.getElementById("settings-modal");
  const openBtn = document.getElementById("open-settings-modal");
  if (!modal || !openBtn) return;
  explorerState.pickerLayout = localStorage.getItem("penlightPickerLayout") === "flat" ? "flat" : "domains";
  const radio = modal.querySelector(`input[name="picker-layout"][value="${explorerState.pickerLayout}"]`);
  if (radio) radio.checked = true;
  openBtn.addEventListener("click", () => { modal.hidden = false; });
  modal.querySelectorAll("[data-close-settings-modal]").forEach((el) =>
    el.addEventListener("click", () => { modal.hidden = true; }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) modal.hidden = true;
  });
  modal.querySelectorAll('input[name="picker-layout"]').forEach((input) =>
    input.addEventListener("change", () => {
      explorerState.pickerLayout = input.value === "flat" ? "flat" : "domains";
      localStorage.setItem("penlightPickerLayout", explorerState.pickerLayout);
      renderMetricControls();
    }));
}

function initMobileControls() {
  const cards = document.querySelector(".visualizer-cards");
  document.querySelectorAll(".mobile-view-toggle button").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.mobileView;
      cards?.setAttribute("data-mobile-view", view);
      document.querySelectorAll(".mobile-view-toggle button").forEach((b) => {
        b.classList.toggle("is-active", b === button);
      });
      // The map tile/overlay sizes were computed while hidden; recompute once it's visible again.
      if (view === "map") requestAnimationFrame(() => map.invalidateSize());
    });
  });
  const expander = document.getElementById("input-panel-expander");
  const panel = document.querySelector(".input-panel");
  expander?.addEventListener("click", () => {
    const expanded = panel.classList.toggle("is-expanded");
    expander.setAttribute("aria-expanded", String(expanded));
  });
  // The strip pills are shorthands for the full panel's own actions.
  const delegate = [
    ["mobile-random-metrics", "surprise-me"],
    ["mobile-all-metrics", "select-all-metrics"],
    ["mobile-no-metrics", "deselect-all-metrics"],
  ];
  for (const [pillId, targetId] of delegate) {
    document.getElementById(pillId)?.addEventListener("click", () => {
      document.getElementById(targetId)?.click();
    });
  }
}

function initVisualizerTabs() {
  const tabs = [...document.querySelectorAll(".visualizer-tabs [role='tab']")];
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => setActiveVisualizer(tab.dataset.visualizerTarget));
    tab.addEventListener("keydown", (event) => handleVisualizerTabKeydown(event, index, tabs));
  });
  setActiveVisualizer(explorerState.currentVisualizer);
}

function handleVisualizerTabKeydown(event, index, tabs) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

  event.preventDefault();
  let nextIndex = index;
  if (event.key === "ArrowLeft") {
    nextIndex = (index - 1 + tabs.length) % tabs.length;
  } else if (event.key === "ArrowRight") {
    nextIndex = (index + 1) % tabs.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = tabs.length - 1;
  }

  tabs[nextIndex].focus();
  setActiveVisualizer(tabs[nextIndex].dataset.visualizerTarget);
}

function setActiveVisualizer(panelId) {
  explorerState.currentVisualizer = panelId;
  document.querySelectorAll(".visualizer-tabs [role='tab']").forEach((tab) => {
    const isActive = tab.dataset.visualizerTarget === panelId;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", isActive.toString());
    tab.tabIndex = isActive ? 0 : -1;
  });
  document.querySelectorAll(".visualizer-card[role='tabpanel']").forEach((panel) => {
    panel.hidden = panel.id !== panelId;
  });
  if (panelId === "visualizer-map") {
    requestAnimationFrame(() => map.invalidateSize());
  } else if (panelId === "visualizer-timeline") {
    refreshTimelineForSelectedMetrics();
  }
}

const WEIGHT_CYCLE = [0, 1, 10];

function weightStateClass(weight) {
  return weight === 0 ? "is-off" : weight === 1 ? "is-on" : "is-high";
}

function weightLabel(weight) {
  if (weight === 0) return "Off";
  if (weight === 1) return "On";
  return "High";
}

function metricIcon(metric) {
  return window.WardWiseIcons.svg(metric);
}

const DOMAIN_LABELS = {
  psychological_wellbeing: "Psychological wellbeing",
  social_connectedness: "Social connectedness",
  material_wellbeing: "Material wellbeing",
  health: "Health",
  time_balance: "Time balance",
  lifelong_learning: "Lifelong learning",
  good_governance: "Good governance",
  community_vitality: "Community vitality",
  physical_environment: "Physical environment",
  culture: "Culture",
  religion_spiritual: "Religion & spirituality",
};

function domainLabel(category) {
  return DOMAIN_LABELS[category] || String(category || "other").replace(/_/g, " ");
}

// One visible tile-row per domain by default; the count button accordions the rest out. The
// button only shows when a domain actually overflows its first row (responsive, so measured).
function attachDomainAccordion(container) {
  container.querySelectorAll(".metric-domain-expand").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.closest(".metric-domain-row");
      const domain = section?.dataset.domain;
      if (!domain) return;
      if (explorerState.expandedDomains.has(domain)) explorerState.expandedDomains.delete(domain);
      else explorerState.expandedDomains.add(domain);
      renderMetricControls();
    });
  });
  markOverflowingDomains(container);
}

function markOverflowingDomains(container) {
  container.querySelectorAll(".metric-domain-row").forEach((section) => {
    const tiles = section.querySelector(".metric-domain-tiles");
    if (!tiles || !tiles.firstElementChild) return;
    // Zero-height clipped rows don't grow scrollHeight, so detect overflow by position: any tile
    // sitting below the first row means the domain has more than one row's worth.
    const firstTop = tiles.firstElementChild.offsetTop;
    const overflows =
      section.classList.contains("is-expanded") ||
      [...tiles.children].some((child) => child.offsetTop > firstTop + 4);
    section.classList.toggle("has-overflow", overflows);
  });
}

function renderMetricControls() {
  const container = document.querySelector("#metric-weights");
  setMetricControlsLoading(false);
  const available = explorerState.metrics.filter(
    (metric) => metricAvailableForArea(metric.metric_id) && metricAvailableForYear(metric.metric_id),
  );
  // One row per wellbeing domain. Domain order is shuffled once per load (explorerState.domainOrder);
  // metric order within a domain inherits the load-time shuffle. Domains with nothing available for
  // the current view simply don't render.
  if (!explorerState.domainOrder) {
    explorerState.domainOrder = shuffledMetrics([...new Set(explorerState.metrics.map((m) => m.category))]);
  }
  const byDomain = new Map();
  for (const metric of available) {
    if (!byDomain.has(metric.category)) byDomain.set(metric.category, []);
    byDomain.get(metric.category).push(metric);
  }
  const tile = (metric) => {
    const weight = explorerState.weights[metric.metric_id] ?? 0;
    const weightIdx = WEIGHT_CYCLE.indexOf(weight) >= 0 ? WEIGHT_CYCLE.indexOf(weight) : 0;
    return `
      <button
        type="button"
        class="metric-toggle ${weightStateClass(weight)}"
        data-metric-id="${WardWiseExplorer.escapeHtml(metric.metric_id)}"
        data-metric-label="${WardWiseExplorer.escapeHtml(metric.label)}"
        data-weight-idx="${weightIdx}"
        aria-label="${WardWiseExplorer.escapeHtml(metric.label)}: ${weightLabel(weight)}"
        aria-pressed="${weight > 0}"
        title="${WardWiseExplorer.escapeHtml(metric.label)}"
      >
        ${metricIcon(metric)}
      </button>
    `;
  };
  explorerState.expandedDomains = explorerState.expandedDomains || new Set();
  container.innerHTML = explorerState.pickerLayout === "flat"
    ? `<div class="metric-domain-tiles">${available.map(tile).join("")}</div>`
    : explorerState.domainOrder
        .filter((category) => (byDomain.get(category) || []).length)
        .map((category) => {
          const metrics = byDomain.get(category);
          const expanded = explorerState.expandedDomains.has(category);
          return `
          <section class="metric-domain-row${expanded ? " is-expanded" : ""}" data-domain="${WardWiseExplorer.escapeHtml(category)}">
            <div class="metric-domain-head">
              <p class="metric-domain-label">${WardWiseExplorer.escapeHtml(domainLabel(category))}</p>
              <button type="button" class="metric-domain-expand" aria-expanded="${expanded}"
                aria-label="${expanded ? "Collapse" : "Expand"} ${WardWiseExplorer.escapeHtml(domainLabel(category))} (${metrics.length} metrics)">
                ${metrics.length} <span class="metric-domain-chevron">${expanded ? "▴" : "▾"}</span>
              </button>
            </div>
            <div class="metric-domain-tiles">${metrics.map(tile).join("")}</div>
          </section>
        `;
        })
        .join("");
  attachDomainAccordion(container);

  attachMetricToggleHandlers();
  initMetricButtonTooltip();
  renderWellbeingEquation();
}

function setMetricControlsLoading(isLoading) {
  const container = document.querySelector("#metric-weights");
  if (!container) return;
  container.setAttribute("aria-busy", isLoading.toString());
  container.classList.toggle("metric-button-grid-loading", isLoading);
}

function renderMetricLoadError(error) {
  const container = document.querySelector("#metric-weights");
  if (!container) return;
  setMetricControlsLoading(false);
  const message = WardWiseExplorer.escapeHtml(error.message || "Unable to load metrics.");
  container.innerHTML = `
    <div class="metric-loading-error" role="alert">
      <span>${message}</span>
    </div>
  `;
}

// Caveat compiler: surface, for the metrics the user has weighted on the current geography, only the
// methodology notes that actually apply. Tags are precomputed per (area_type, metric) in the pipeline.
const METHODOLOGY_CAVEATS = [
  { key: "modeled", title: "Modeled estimate", note: "A statistical small-area model estimate, not a direct measurement." },
  { key: "areal_allocation", title: "Area-weighted estimate", note: "Estimated by overlaying the source's geography onto this one (area-weighted), not measured within its exact boundary." },
  { key: "acs_5yr", title: "ACS 5-year estimate", note: "U.S. Census American Community Survey 5-year rolling estimate, dated to its final year." },
  { key: "current_boundaries", title: "Current boundaries", note: "Historical values use today's ward boundaries for comparability." },
  { key: "forward_carried", title: "Point-in-time, carried forward", note: "Measured for a specific period and shown for up to 3 years after, until newer data exists." },
];

function compileMethodologyNotes() {
  const byMetric = explorerState.metricMethodology[explorerState.areaType] || {};
  const labelOf = (id) => (explorerState.metrics.find((m) => m.metric_id === id) || {}).label || id;
  const byCaveat = {};
  for (const [metricId, weight] of Object.entries(explorerState.weights)) {
    if (Number(weight) <= 0) continue;
    for (const caveat of byMetric[metricId] || []) {
      (byCaveat[caveat] = byCaveat[caveat] || []).push(labelOf(metricId));
    }
  }
  return METHODOLOGY_CAVEATS.filter((c) => byCaveat[c.key]).map((c) => ({ ...c, metrics: byCaveat[c.key] }));
}

function updateMethodologyLink() {
  const link = document.getElementById("open-methodology");
  if (!link) return;
  // Always reachable: it now also holds the full equation when the bar has truncated it.
  const formula = document.getElementById("wellbeing-equation-formula");
  link.hidden = compileMethodologyNotes().length === 0 && !(formula && formula.textContent.trim());
}

function renderMethodologyPanel() {
  const body = document.getElementById("methodology-body");
  if (!body) return;
  const formula = document.getElementById("wellbeing-equation-formula");
  const full = formula ? formula.textContent.trim() : "";
  // The bar clamps to one line so it never eats the map; the untruncated equation belongs here.
  const equationHtml = full
    ? `<div class="methodology-equation"><p class="eyebrow">Your equation</p>
         <p><strong>wellbeing</strong> = ${WardWiseExplorer.escapeHtml(full)}</p></div>`
    : "";
  const notes = compileMethodologyNotes();
  if (!notes.length) {
    body.innerHTML = equationHtml +
      '<p class="methodology-empty">Your weighted metrics are all directly measured for this geography — no caveats to flag.</p>';
    return;
  }
  body.innerHTML = equationHtml + notes
    .map(
      (note) => `
      <div class="methodology-caveat">
        <h4>${WardWiseExplorer.escapeHtml(note.title)}</h4>
        <p>${WardWiseExplorer.escapeHtml(note.note)}</p>
        <span class="methodology-metrics">${note.metrics.map((m) => WardWiseExplorer.escapeHtml(m)).join(" · ")}</span>
      </div>`,
    )
    .join("");
}

function initMethodology() {
  const openBtn = document.getElementById("open-methodology");
  const modal = document.getElementById("methodology-modal");
  if (!openBtn || !modal) return;
  openBtn.addEventListener("click", () => {
    renderMethodologyPanel();
    modal.hidden = false;
  });
  modal.querySelectorAll("[data-close-methodology]").forEach((el) =>
    el.addEventListener("click", () => { modal.hidden = true; }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) modal.hidden = true;
  });
}

function renderWellbeingEquation() {
  updateMethodologyLink();
  const formula = document.getElementById("wellbeing-equation-formula");
  if (!formula) return;

  const selected = explorerState.metrics
    .map((metric) => ({
      metric,
      weight: Number(explorerState.weights[metric.metric_id] ?? 0),
    }))
    .filter(({ metric, weight }) => Number.isFinite(weight) && weight > 0 && metricAvailableForArea(metric.metric_id));

  if (!selected.length) {
    if (explorerState.deltaMode) {
      const from = document.getElementById("delta-from-year")?.value;
      const to = document.getElementById("delta-to-year")?.value;
      formula.textContent = `no selected metrics were remeasured between ${from} and ${to} — widen the window`;
    } else {
      formula.textContent = "choose metrics in the panel";
    }
  } else {
    const terms = selected.map(({ metric, weight }, index) => {
      const sign = metric.direction === "lower" ? "-" : "+";
      const variable = WardWiseExplorer.escapeHtml(metricEquationVariable(metric));
      const weightedVariable = weight === 1
        ? variable
        : `${WardWiseExplorer.formatNumber(weight, { maximumFractionDigits: 1 })} x ${variable}`;
      return sign === "+" && index === 0 ? weightedVariable : `${sign} ${weightedVariable}`;
    });
    formula.innerHTML = terms.join(" ");
  }
}

function metricEquationVariable(metric) {
  if (metric.metric_id === "bean_distance_miles") {
    return "bean_distance";
  }
  return String(metric.label || metric.metric_id)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_") || metric.metric_id;
}

function renderMetricTooltipContent(tooltip, metric, metricId) {
  const coverage = metricCoverage(metricId);
  const status = WardWiseMetricDetails.metricStatus(coverage, metric);
  const currentWeight = explorerState.weights[metricId] ?? 0;
  const methodology = WardWiseMetricDetails.metricMethodologySummary(metric);
  const source = WardWiseMetricDetails.metricSource(metric, coverage);
  const notableStatus = status.id !== "populated" && status.id !== "disabled_from_scoring"
    ? WardWiseMetricDetails.renderMetricStatusBadge(status)
    : "";
  tooltip.innerHTML = `
    <strong>${WardWiseExplorer.escapeHtml(metric.label)}</strong>
    <span>${WardWiseExplorer.escapeHtml(metric.description)}</span>
    ${notableStatus ? `<div class="metric-tooltip-row">${notableStatus}</div>` : ""}
    ${methodology ? `<small>Methodology: ${WardWiseExplorer.escapeHtml(methodology)}</small>` : ""}
    ${source ? `<small>Source: ${WardWiseExplorer.escapeHtml(source)}</small>` : ""}
    <small>Weight: ${WardWiseExplorer.escapeHtml(weightLabel(currentWeight))} (${currentWeight})</small>
  `;
}

function attachMetricToggleHandlers() {
  const tooltip = document.getElementById("metric-button-tooltip");
  document.querySelectorAll(".metric-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const metricId = button.dataset.metricId;
      const currentIdx = Number(button.dataset.weightIdx);
      const nextIdx = (currentIdx + 1) % WEIGHT_CYCLE.length;
      const nextWeight = WEIGHT_CYCLE[nextIdx];
      explorerState.weights[metricId] = nextWeight;
      button.dataset.weightIdx = nextIdx;
      button.classList.remove("is-off", "is-on", "is-high");
      button.classList.add(weightStateClass(nextWeight));
      button.setAttribute(
        "aria-label",
        `${button.dataset.metricLabel}: ${weightLabel(nextWeight)}`,
      );
      button.setAttribute("aria-pressed", nextWeight > 0);
      renderWellbeingEquation();
      if (tooltip && !tooltip.hidden) {
        const metric = explorerState.metrics.find((m) => m.metric_id === metricId);
        if (metric) renderMetricTooltipContent(tooltip, metric, metricId);
      }
      recordMetricSelection("toggle", { changedMetricId: metricId });
      refreshMetricViews();
    });
  });
}

function initMetricButtonTooltip() {
  const tooltip = document.getElementById("metric-button-tooltip");
  if (!tooltip) return;

  document.querySelectorAll(".metric-toggle").forEach((button) => {
    button.addEventListener("mouseenter", () => {
      const metricId = button.dataset.metricId;
      const metric = explorerState.metrics.find((m) => m.metric_id === metricId);
      if (!metric) return;
      tooltip.hidden = false;
      renderMetricTooltipContent(tooltip, metric, metricId);
      positionMetricTooltip(button, tooltip);
    });
    button.addEventListener("mouseleave", () => {
      tooltip.hidden = true;
    });
  });
}

function positionMetricTooltip(button, tooltip) {
  const buttonRect = button.getBoundingClientRect();
  const tooltipWidth = 220;
  const gap = 8;
  const left = Math.max(gap, Math.min(buttonRect.left, window.innerWidth - tooltipWidth - gap));
  const top = buttonRect.bottom + gap;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function initMetricSelectionActions() {
  document.getElementById("surprise-me")?.addEventListener("click", () => {
    // Only roll among metrics the current time view can honor (e.g. both endpoints in change-over-time).
    const ok = new Set(availableMetricIds());
    const pool = explorerState.metrics.filter((m) => ok.has(m.metric_id));
    explorerState.weights = randomInitialWeights(pool.length ? pool : explorerState.metrics, 5);
    renderMetricControls();
    recordMetricSelection("surprise_me");
    refreshMetricViews();
  });
  document.getElementById("select-all-metrics")?.addEventListener("click", () => {
    const ok = new Set(availableMetricIds()); // only weight metrics valid for the current time view
    explorerState.weights = Object.fromEntries(
      explorerState.metrics.map((m) => [m.metric_id, ok.has(m.metric_id) ? 1 : 0]),
    );
    renderMetricControls();
    recordMetricSelection("select_all");
    refreshMetricViews();
  });
  document.getElementById("deselect-all-metrics")?.addEventListener("click", () => {
    explorerState.weights = weightsForAllMetrics(0);
    renderMetricControls();
    recordMetricSelection("deselect_all");
    refreshMetricViews();
  });
}

function weightsForAllMetrics(weight) {
  return Object.fromEntries(explorerState.metrics.map((metric) => [metric.metric_id, weight]));
}

function recordMetricSelection(action, { changedMetricId = null } = {}) {
  const payload = {
    action,
    session_id: metricSelectionSessionId(),
    changed_metric_id: changedMetricId,
    metric_order: explorerState.metrics.map((metric) => metric.metric_id),
    selected_metrics: selectedMetricWeights().map(([metricId, weight]) => ({
      metric_id: metricId,
      weight,
    })),
    weights: Object.fromEntries(
      explorerState.metrics.map((metric) => [
        metric.metric_id,
        Number(explorerState.weights[metric.metric_id] ?? 0),
      ]),
    ),
  };
  WardWiseExplorer.submitMetricSelectionEvent(payload).catch(() => {});
  // Mirror to GA so metric experimentation shows up alongside the first-party event log.
  WardWiseExplorer.track("explore_metric_weight", {
    weight_action: action,
    changed_metric_id: changedMetricId || undefined,
    selected_count: selectedMetricWeights().length,
  });
}

function metricSelectionSessionId() {
  try {
    const existing = window.localStorage.getItem(METRIC_SELECTION_SESSION_KEY);
    if (existing) return existing;
    const generated = window.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random()}`;
    window.localStorage.setItem(METRIC_SELECTION_SESSION_KEY, generated);
    return generated;
  } catch (_error) {
    return "";
  }
}

function metricCoverage(metricId) {
  return explorerState.metricCoverage?.[metricId] || null;
}
// A metric shows in the picker only if it has data for the selected geography (e.g. a ward-only
// metric is hidden on χGRID). If the manifest carries no availability info, show everything.
function metricAvailableForArea(metricId) {
  const map = explorerState.metricAreaTypes;
  if (!map || !Object.keys(map).length) return true;
  return (map[metricId] || []).includes(explorerState.areaType);
}

// Year-honesty math lives in common.js (WardWiseExplorer.yearMath) so the Reports views share the
// exact same semantics; these wrappers just bind the explorer's state as the context.
function yearMathCtx() {
  return {
    metricDataYears: explorerState.metricDataYears,
    forwardCarryYears: explorerState.forwardCarryYears,
    timeInvariantMetrics: explorerState.timeInvariantMetrics,
    metricValidFrom: explorerState.metricValidFrom,
  };
}

function metricHasValueForYear(metricId, target) {
  return WardWiseExplorer.yearMath.hasValueForYear(yearMathCtx(), metricId, target);
}

function latestMeasurementFor(metricId, target) {
  return WardWiseExplorer.yearMath.latestMeasurementFor(yearMathCtx(), metricId, target);
}

function deltaExclusionReason(metricId, from, to) {
  return WardWiseExplorer.yearMath.deltaExclusionReason(yearMathCtx(), metricId, from, to);
}

function metricAvailableForYear(metricId) {
  // Which metrics the picker offers for the chosen time. Snapshot metrics aren't carried back; a year
  // shows only what we can honestly attribute to it.
  if (explorerState.deltaMode) {
    // Change-over-time requires the metric to have been REMEASURED between the endpoints. Merely having
    // a value at both (via forward-carry) isn't enough: a 2023 vintage carried to both 2024 and 2025
    // would "change" by exactly zero — a fake comparison the map would present as measured stability.
    const from = Number(document.getElementById("delta-from-year")?.value);
    const to = Number(document.getElementById("delta-to-year")?.value);
    return deltaExclusionReason(metricId, from, to) == null;
  }
  if (!explorerState.selectedYear) return true; // "Latest" — everything
  return metricHasValueForYear(metricId, Number(explorerState.selectedYear));
}

// The metrics the current time view (latest / a year / a change window) can honestly offer.
function availableMetricIds() {
  return explorerState.metrics
    .filter((m) => metricAvailableForArea(m.metric_id) && metricAvailableForYear(m.metric_id))
    .map((m) => m.metric_id);
}

// Turn OFF any weighted metric the current time view can't honor, so a metric hidden from the grid
// (e.g. a live snapshot in change-over-time, which has no second endpoint) can't silently keep
// contributing to the score or the change. Call before re-rendering whenever the time view changes.
function pruneUnavailableSelections() {
  const ok = new Set(availableMetricIds());
  explorerState.deltaSetAside = explorerState.deltaSetAside || {};
  let changed = false;
  if (!explorerState.deltaMode) {
    // Leaving the change view: give back everything it set aside.
    for (const [id, weight] of Object.entries(explorerState.deltaSetAside)) {
      if (!Number(explorerState.weights[id])) {
        explorerState.weights[id] = weight;
        changed = true;
      }
    }
    explorerState.deltaSetAside = {};
  } else {
    // A wider window can make a set-aside metric comparable again — give its weight back.
    for (const [id, weight] of Object.entries(explorerState.deltaSetAside)) {
      if (ok.has(id)) {
        explorerState.weights[id] = weight;
        delete explorerState.deltaSetAside[id];
        changed = true;
      }
    }
  }
  for (const id of Object.keys(explorerState.weights)) {
    if (Number(explorerState.weights[id]) > 0 && !ok.has(id)) {
      if (explorerState.deltaMode) {
        // Remember the weight so the metric returns when the window widens or delta mode ends.
        explorerState.deltaSetAside[id] = Number(explorerState.weights[id]);
      }
      explorerState.weights[id] = 0;
      changed = true;
    }
  }
  return changed;
}

// Fixed per-metric domain (min/max raw value across the latest distribution) + a direction-aware
// normalizer, shared by the delta score and the per-metric change breakdown so they always agree.
function deltaNormalizer() {
  const matrix = explorerState.scoreMatrices[explorerState.areaType] || {};
  const directionById = new Map(explorerState.metrics.map((m) => [m.metric_id, m.direction || "higher"]));
  const domain = {};
  for (const cells of Object.values(matrix.latest || {})) {
    for (const [metricId, cell] of Object.entries(cells)) {
      const value = cell.v;
      if (!(metricId in domain)) domain[metricId] = [value, value];
      else {
        if (value < domain[metricId][0]) domain[metricId][0] = value;
        if (value > domain[metricId][1]) domain[metricId][1] = value;
      }
    }
  }
  const normalize = (value, metricId) => {
    const span = domain[metricId];
    if (!span || span[1] === span[0]) return 50;
    let n = ((value - span[0]) / (span[1] - span[0])) * 100;
    if (directionById.get(metricId) === "lower") n = 100 - n; // higher score is always "better"
    return Math.max(0, Math.min(100, n));
  };
  return { domain, normalize };
}

function renderMap(geojson) {
  if (explorerState.mapAreaLayer) {
    map.removeLayer(explorerState.mapAreaLayer);
  }
  explorerState.mapLayers.clear();
  const idProp = areaConfig().idProp;
  const layer = L.geoJSON(geojson, {
    style: (feature) => wardStyle(String(feature.properties[idProp])),
    onEachFeature: (feature, mapLayer) => {
      const areaId = String(feature.properties[idProp]);
      explorerState.mapLayers.set(areaId, mapLayer);
      mapLayer.on({
        click: () => selectWard(areaId),
        mouseover: (event) => previewWard(areaId, event),
        mousemove: (event) => repositionHoverDetails(areaId, event),
        mouseout: () => clearWardPreview(areaId),
      });
    },
  }).addTo(map);
  explorerState.mapAreaLayer = layer;
  explorerState.fullCityBounds = layer.getBounds();
  fitFullCity();
  // The whole visualizer reveals with the map's first render — showing pieces earlier means
  // half-built cards flash and jump while data loads.
  const equation = document.getElementById("wellbeing-equation");
  if (equation) equation.hidden = false;
  document.querySelector(".visualizer-cards")?.classList.remove("is-loading");
  // The container can reach its final size after this runs (font load / panel reflow), leaving a
  // fit computed for a smaller box — the city then huddles tiny in a corner. The map is
  // non-interactive, so refitting on every container resize never clobbers user view state.
  if (!explorerState.mapResizeObserver && window.ResizeObserver) {
    explorerState.mapResizeObserver = new ResizeObserver(() => fitFullCity());
    explorerState.mapResizeObserver.observe(document.getElementById("map"));
  }
}

function fitFullCity() {
  if (!explorerState.fullCityBounds) return;
  const mapEl = document.getElementById("map");
  // Never fit a container smaller than the fit padding — the effective size goes negative and
  // Leaflet's zoom math lands on NaN, permanently poisoning the projection (every path renders
  // "M0 0"). The resize observer re-invokes this once the container has a usable size.
  if (!mapEl || mapEl.clientWidth < 120 || mapEl.clientHeight < 180) return;
  // Self-heal: if a poisoned fit already slipped through, reset to a sane view first.
  if (!Number.isFinite(map.getZoom())) map.setView([41.8781, -87.6298], 10, { animate: false });
  // animate: false — an animated fit needs requestAnimationFrame to finish, and browsers starve
  // rAF in background/occluded tabs, stranding the map mid-zoom (tiny city in a corner). The
  // instant fit has no frame dependency, so a tab opened in the background lands framed correctly.
  map.invalidateSize({ animate: false });
  // Asymmetric padding clears the overlays that float on the map: the geography toggle across the
  // top and the "Map details" control at the bottom — a symmetric 16px let the city run into both.
  map.fitBounds(explorerState.fullCityBounds, {
    paddingTopLeft: [20, 60],
    paddingBottomRight: [20, 52],
    animate: false,
  });
}

function wardStyle(wardId) {
  const score = scoreForWard(wardId)?.score;
  const isSelected = wardId === explorerState.currentWardId;
  return {
    color: isSelected
      ? cssVariable("--selected-ward", "#0f766e")
      : cssVariable("--action", "#155e75"),
    fillColor: fillColorForScore(score),
    fillOpacity: isSelected ? 0.72 : 0.44,
    weight: isSelected ? 3 : 1,
  };
}

function fillColorForDelta(delta) {
  // Diverging scale around 0: gains lean teal (--score-high), declines lean orange (--score-low),
  // little change stays slate (--score-mid). Reuses the existing palette, scaled by the largest |Δ|.
  if (delta === null || delta === undefined) {
    return cssVariable("--map-fill", "#94a3b8");
  }
  const magnitudes = explorerState.scores
    .map((entry) => Math.abs(Number(entry.score)))
    .filter(Number.isFinite);
  const maxAbs = Math.max(1, ...magnitudes);
  // Centered at ZERO change (neutral grey, NOT the median): a wellbeing-score improvement is green, a
  // decline is red. Magnitude is scaled to the biggest mover on the map so the strongest changes saturate.
  const t = Math.max(-1, Math.min(1, delta / maxAbs));
  const neutral = cssVariable("--score-mid", "#94a3b8");
  return t >= 0
    ? interpolateHexColor(neutral, "#15803d", t) // good / positive change → green
    : interpolateHexColor(neutral, "#b91c1c", -t); // bad / negative change → red
}

function fillColorForScore(score) {
  if (explorerState.deltaMode) {
    return fillColorForDelta(score);
  }
  if (score === null || score === undefined) {
    return cssVariable("--map-fill", "#38bdf8");
  }
  const scale = mapColorScale();
  const normalized = normalizeScoreForMapColor(score, scale);
  if (normalized >= 0.5) {
    return interpolateHexColor(
      cssVariable("--score-mid", "#94a3b8"),
      cssVariable("--score-high", "#0f766e"),
      (normalized - 0.5) * 2,
    );
  }
  return interpolateHexColor(
    cssVariable("--score-low", "#f97316"),
    cssVariable("--score-mid", "#94a3b8"),
    normalized * 2,
  );
}

function mapColorScale() {
  const scores = explorerState.scores
    .map((score) => Number(score.score))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!scores.length) {
    return { min: 0, max: 100, useLog: false };
  }
  const min = scores[0];
  const max = scores.at(-1);
  const median = percentile(scores, 0.5);
  const p90 = percentile(scores, 0.9);
  const p10 = percentile(scores, 0.1);
  return {
    min,
    median,
    max,
    useLogLow: median > min && (median - p10) / Math.max(1, median - min) <= 0.35,
    useLogHigh: max > median && p90 / Math.max(1, median) >= 3,
  };
}

function normalizeScoreForMapColor(score, scale) {
  if (scale.max === scale.min) return 0.5;
  const value = Math.max(scale.min, Math.min(scale.max, Number(score)));
  if (value === scale.median) return 0.5;
  if (value < scale.median) {
    const distance = scale.median - value;
    const span = scale.median - scale.min;
    const scaled = scale.useLogLow
      ? Math.log1p(distance) / Math.log1p(span)
      : distance / span;
    return 0.5 - scaled * 0.5;
  }
  const distance = value - scale.median;
  const span = scale.max - scale.median;
  const scaled = scale.useLogHigh
    ? Math.log1p(distance) / Math.log1p(span)
    : distance / span;
  return 0.5 + scaled * 0.5;
}

function percentile(sortedValues, pct) {
  if (!sortedValues.length) return 0;
  const index = (sortedValues.length - 1) * pct;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

function interpolateHexColor(startHex, endHex, amount) {
  const start = hexToRgb(startHex);
  const end = hexToRgb(endHex);
  const clamped = Math.max(0, Math.min(1, amount));
  if (!start || !end) return startHex;
  const rgb = start.map((channel, index) => Math.round(channel + (end[index] - channel) * clamped));
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

function hexToRgb(hex) {
  const normalized = String(hex).trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16));
}

// Change-over-time coverage lives in a small info icon beside the equation (the equation itself
// already shows what's being compared). The icon's tooltip carries the set-aside detail — which
// selected metrics the window can't honestly compare, and why — without covering the map.
function renderDeltaCoverageNote() {
  const info = document.getElementById("delta-info");
  if (!info) return;
  if (!explorerState.deltaMode) {
    info.hidden = true;
    return;
  }
  const from = document.getElementById("delta-from-year")?.value;
  const to = document.getElementById("delta-to-year")?.value;
  // Reasons computed fresh against the CURRENT window, so year changes keep the tooltip truthful.
  const pruned = Object.keys(explorerState.deltaSetAside || {}).map((id) => ({
    label: explorerState.metrics.find((m) => m.metric_id === id)?.label || id,
    reason: deltaExclusionReason(id, Number(from), Number(to)) || "unavailable for this view",
  }));
  const comparedCount = Object.values(explorerState.weights).filter((w) => Number(w) > 0).length;
  let text = `Change ${from}→${to} compares only metrics remeasured in that window.`;
  if (pruned.length) {
    text += ` Set aside: ${pruned.map((p) => `${p.label} (${p.reason})`).join("; ")}.`;
  }
  if (!comparedCount) {
    text += " None of the selected metrics qualify — try a wider window.";
  }
  info.title = text;
  info.setAttribute("aria-label", text);
  info.hidden = false;
}

async function refreshMetricViews() {
  const refreshId = explorerState.scoreRefreshId + 1;
  explorerState.scoreRefreshId = refreshId;
  setMapShadeLoading(true);
  try {
    explorerState.scoreDetailsCache.clear();
    explorerState.scoreDetailsLoading.clear();
    await ensureYears(explorerState.areaType, neededYearKeys()); // lazy per-year; weight changes never refetch
    if (refreshId !== explorerState.scoreRefreshId) return;
    const scores = explorerState.deltaMode
      ? computeDeltaScores()
      : computeScores(explorerState.weights, explorerState.selectedYear || "latest");
    explorerState.scores = scores;
    updateMapStyles();
    renderDeltaCoverageNote();
    renderWeightedRanker();
    if (explorerState.currentVisualizer === "visualizer-timeline") {
      await refreshTimelineForSelectedMetrics();
    }
    refreshVisibleWardDetails();
  } catch (error) {
    if (refreshId !== explorerState.scoreRefreshId) return;
    renderMetricError(error);
  } finally {
    if (refreshId === explorerState.scoreRefreshId) {
      setMapShadeLoading(false);
    }
  }
}

function setMapShadeLoading(isLoading) {
  const mapCard = document.getElementById("visualizer-map");
  const loading = document.getElementById("map-shade-loading");
  mapCard?.classList.toggle("is-shading-loading", isLoading);
  mapCard?.setAttribute("aria-busy", isLoading.toString());
  if (loading) {
    loading.hidden = !isLoading;
  }
}

function initMapDetailToggle() {
  const toggle = document.getElementById("map-detail-toggle");
  if (!toggle) return;

  const showDetails = storedMapDetailsPreference();
  toggle.checked = showDetails;
  setMapDetailsVisible(showDetails);
  toggle.addEventListener("change", () => {
    setMapDetailsVisible(toggle.checked);
    storeMapDetailsPreference(toggle.checked);
  });
}

function storedMapDetailsPreference() {
  try {
    return window.localStorage.getItem(MAP_DETAILS_STORAGE_KEY) === "true";
  } catch (_error) {
    return false;
  }
}

function storeMapDetailsPreference(isVisible) {
  try {
    window.localStorage.setItem(MAP_DETAILS_STORAGE_KEY, isVisible.toString());
  } catch (_error) {
    // Map details are optional, so storage failures can be ignored.
  }
}

function setMapDetailsVisible(isVisible) {
  if (isVisible && !map.hasLayer(mapDetailsLayer)) {
    mapDetailsLayer.addTo(map);
  } else if (!isVisible && map.hasLayer(mapDetailsLayer)) {
    map.removeLayer(mapDetailsLayer);
  }
}

function updateMapStyles() {
  for (const [wardId, layer] of explorerState.mapLayers.entries()) {
    layer.setStyle(wardStyle(wardId));
  }
}

function selectWard(wardId) {
  explorerState.currentWardId = String(wardId);
  const ward = findArea(wardId);
  if (!ward) return;

  WardWiseExplorer.track("explore_area_select", { area_type: explorerState.areaType, area_id: wardId });
  updateMapStyles();
  updateSelectedWardLabel(wardId);
  showWardDetails(wardId);
  renderWeightedRanker();
  renderCompositeTimeline();
}

function clearSelectedWard() {
  explorerState.currentWardId = null;
  explorerState.hoveredWardId = null;
  updateMapStyles();
  updateSelectedWardLabel(null);
  renderWeightedRanker();
  renderCompositeTimeline();
  hideWardDetails();
}

function previewWard(wardId, event) {
  explorerState.hoveredWardId = wardId;
  highlightRankerRow(wardId); // elevate the matching leaderboard entry
  // On a map hover we pass the Leaflet event so the details tooltip follows the cursor; a ranker-row
  // hover (no event) leaves it in its anchored spot.
  showWardDetails(wardId, event);
}

function clearWardPreview(wardId) {
  if (explorerState.hoveredWardId !== wardId) return;
  explorerState.hoveredWardId = null;
  highlightRankerRow(null);
  if (explorerState.currentWardId) {
    showWardDetails(explorerState.currentWardId);
  } else {
    hideWardDetails();
  }
}

// Emphasize the hovered area's row in the leaderboard (and scroll it into view) without a full re-render.
function highlightRankerRow(wardId) {
  const table = document.querySelector("#comparison-table");
  if (!table) return;
  table.querySelectorAll(".comparison-row.is-hovered").forEach((row) => row.classList.remove("is-hovered"));
  if (wardId == null) return;
  const row = table.querySelector(`.comparison-row[data-ward-id="${CSS.escape(String(wardId))}"]`);
  if (row) {
    row.classList.add("is-hovered");
    row.scrollIntoView({ block: "nearest" });
  }
}

// Keep the tooltip under the cursor as it moves across a map area (mousemove fires continuously).
function repositionHoverDetails(wardId, event) {
  if (explorerState.hoveredWardId !== wardId) return;
  const panel = document.querySelector("#ward-details-popover");
  if (panel && !panel.hidden) positionWardDetails(panel, event);
}

// Map hover -> place the tooltip beside the mouse (fixed to the viewport, flipped/clamped to stay on
// screen). Any other trigger (selection, ranker-row hover, score refresh) clears the inline overrides so
// it falls back to its CSS-anchored position.
function positionWardDetails(panel, event) {
  const mouse = event?.originalEvent || (event && "clientX" in event ? event : null);
  if (!mouse) {
    panel.style.position = "";
    panel.style.left = "";
    panel.style.top = "";
    panel.style.right = "";
    return;
  }
  const gap = 16;
  const width = panel.offsetWidth || 320;
  const height = panel.offsetHeight || 240;
  let left = mouse.clientX + gap;
  if (left + width + gap > window.innerWidth) left = mouse.clientX - width - gap; // flip left near the edge
  left = Math.max(gap, left);
  let top = mouse.clientY + gap;
  if (top + height + gap > window.innerHeight) top = Math.max(gap, window.innerHeight - height - gap);
  panel.style.position = "fixed";
  panel.style.right = "auto";
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function hideWardDetails() {
  const detailsPanel = document.querySelector("#ward-details-popover");
  if (!detailsPanel) return;
  explorerState.currentDetailsWardId = null;
  detailsPanel.hidden = true;
  detailsPanel.innerHTML = "";
}

function refreshVisibleWardDetails() {
  if (!explorerState.currentDetailsWardId) return;
  showWardDetails(explorerState.currentDetailsWardId);
}

function showWardDetails(wardId, event) {
  const detailsPanel = document.querySelector("#ward-details-popover");
  const ward = findArea(wardId);
  if (!detailsPanel || !ward) return;

  explorerState.currentDetailsWardId = String(wardId);
  detailsPanel.hidden = false;
  detailsPanel.innerHTML = renderMetricWardDetails(wardId, ward);
  attachWardDetailsActions();
  positionWardDetails(detailsPanel, event); // beside the cursor on map hover, anchored otherwise
}

function attachWardDetailsActions() {
  document.querySelector("#ward-details-popover .details-close")?.addEventListener("click", clearSelectedWard);
}

// The hover popover's per-metric breakdown, computed client-side from the already-loaded matrix — the
// score AND the raw value are both in each cell — so there's no per-hover fetch and no "loading" state.
function wardScoreComponents(wardId) {
  const matrix = explorerState.scoreMatrices[explorerState.areaType] || {};
  if (explorerState.deltaMode) {
    // In change-over-time, a component's contribution is its normalized CHANGE between endpoints, and the
    // "raw value" people want is the difference (with pre→post), not a single year's snapshot.
    const fromYear = document.getElementById("delta-from-year")?.value;
    const toYear = document.getElementById("delta-to-year")?.value;
    const fromCells = (matrix[fromYear] || {})[String(wardId)] || {};
    const toCells = (matrix[toYear] || {})[String(wardId)] || {};
    const { domain, normalize } = deltaNormalizer();
    const components = [];
    for (const [metricId, weight] of Object.entries(explorerState.weights)) {
      const a = fromCells[metricId];
      const b = toCells[metricId];
      if (Number(weight) > 0 && a && b && domain[metricId]) {
        components.push({
          metric_id: metricId,
          normalized_score: normalize(b.v, metricId) - normalize(a.v, metricId), // per-metric change
          value: b.v - a.v,        // raw difference
          value_from: a.v,         // pre
          value_to: b.v,           // post
          weight: Number(weight),
          isDelta: true,
        });
      }
    }
    return components;
  }
  const slice = matrix[explorerState.selectedYear || "latest"] || matrix.latest || {};
  const cells = slice[String(wardId)] || {};
  const components = [];
  for (const [metricId, weight] of Object.entries(explorerState.weights)) {
    if (Number(weight) > 0 && cells[metricId]) {
      components.push({
        metric_id: metricId,
        normalized_score: cells[metricId].s,
        value: cells[metricId].v,
        weight: Number(weight),
      });
    }
  }
  return components;
}

function renderMetricWardDetails(wardId, ward) {
  // In delta mode rank by magnitude of weighted change so the biggest movers (either direction) surface;
  // otherwise by weighted contribution to the score.
  const contribution = (c) =>
    explorerState.deltaMode ? c.weight * Math.abs(c.normalized_score) : c.weight * c.normalized_score;
  const components = wardScoreComponents(wardId)
    .sort((a, b) => contribution(b) - contribution(a))
    .slice(0, 5);
  const componentRows = components.length
    ? components.map(renderMetricComponentRow).join("")
    : `<p>No weighted metric components are available for this ${areaNoun()}.</p>`;
  return `
    <button class="details-close" type="button">Close</button>
    <div class="panel-heading">
      <p class="eyebrow">Metric focus</p>
      <h2>${WardWiseExplorer.escapeHtml(ward.display_name)}</h2>
    </div>
    ${renderWardScore(wardId)}
    <section class="metric-breakdown">
      <p class="eyebrow">${explorerState.deltaMode ? "Biggest changes" : "Top weighted inputs"}</p>
      <div class="metric-component-list">${componentRows}</div>
    </section>
  `;
}

function renderMetricComponentRow(component) {
  const metric = explorerState.metrics.find((item) => item.metric_id === component.metric_id);
  const label = WardWiseExplorer.escapeHtml(metric?.label || component.metric_id);
  const weight = `weight ${WardWiseExplorer.formatNumber(component.weight, { maximumFractionDigits: 1 })}`;
  if (component.isDelta) {
    // Change-over-time: show the raw movement (pre → post) and the SIGNED normalized change.
    const fmt = (v) => WardWiseExplorer.formatMetricValue(v, metric);
    const sign = component.normalized_score > 0 ? "+" : "";
    const change = `${sign}${WardWiseExplorer.formatNumber(component.normalized_score, { maximumFractionDigits: 1 })}`;
    return `
      <article class="metric-component-row">
        <div>
          <strong>${label}</strong>
          <span>${fmt(component.value_from)} → ${fmt(component.value_to)}</span>
        </div>
        <div>
          <strong>${change}</strong>
          <span>${weight}</span>
        </div>
      </article>
    `;
  }
  return `
    <article class="metric-component-row">
      <div>
        <strong>${label}</strong>
        <span>${WardWiseExplorer.formatMetricValue(component.value, metric)} raw value</span>
      </div>
      <div>
        <strong>${WardWiseExplorer.formatNumber(component.normalized_score, { maximumFractionDigits: 1 })}</strong>
        <span>${weight}</span>
      </div>
    </article>
  `;
}

function renderWardScore(wardId) {
  const score = scoreForWard(wardId);
  const delta = explorerState.deltaMode;
  const hasScore = !(score?.score === null || score?.score === undefined);
  const scoreLabel = hasScore ? rankerScoreText(score.score) : (delta ? "No change data" : "No score");
  const eyebrow = delta ? "Change over time" : "Current weighted score";
  const fromYear = document.getElementById("delta-from-year")?.value;
  const toYear = document.getElementById("delta-to-year")?.value;
  const subline = delta
    ? (hasScore ? `${fromYear} → ${toYear} · wellbeing points` : "")
    : (score?.rank ? `Rank ${score.rank} of ${rankedScoreCount()}` : "No rank");
  const scoreAccent = !hasScore
    ? cssVariable("--map-fill", "#94a3b8")
    : (delta ? fillColorForDelta(score.score) : fillColorForScore(score.score));
  return `
    <section class="score-card metric-score-card" style="--score-accent: ${scoreAccent};">
      <p class="eyebrow">${eyebrow}</p>
      <strong>${scoreLabel}</strong>
      <span>${subline}</span>
    </section>
  `;
}

function renderWardTopCommunityAreasMarkup(ward) {
  const overlaps = [...(ward?.community_area_overlaps || [])]
    .filter((area) => area.name && (area.ward_area_pct ?? 0) > 0)
    .sort((left, right) => (right.ward_area_pct ?? 0) - (left.ward_area_pct ?? 0))
    .slice(0, 3);
  if (!overlaps.length) {
    return "";
  }
  const label = overlaps
    .map((area) => {
      const pct = WardWiseExplorer.formatNumber(area.ward_area_pct ?? 0, {
        maximumFractionDigits: 1,
      });
      return `${pct}% ${area.name}`;
    })
    .map((text) => WardWiseExplorer.escapeHtml(text))
    .join(" / ");
  return `<small class="comparison-row-community-areas">${label}</small>`;
}

function renderWardVisualSignifierMarkup(ward) {
  const signifier = ward?.visual_signifier;
  if (!signifier?.image_url) {
    let badge;
    if (explorerState.areaType === "community_area") {
      // Neighborhood: the initial of its name (like the biplot) — community-area numbers aren't familiar.
      badge = String(ward?.name || ward?.display_name || "?").trim().charAt(0).toUpperCase() || "?";
    } else if (explorerState.areaType === "chi") {
      // χGRID: the bare coordinate (chi_id), dropping the "χ:" prefix to save space.
      badge = ward?.chi_id ?? "";
    } else {
      badge = ward?.ward_number ?? areaIdOf(ward) ?? "";
    }
    const cls = explorerState.areaType === "chi"
      ? "ward-signifier-fallback ward-signifier-fallback--code"  // smaller font for the 6-char coordinate
      : "ward-signifier-fallback";
    return `<span class="${cls}" aria-hidden="true">${WardWiseExplorer.escapeHtml(badge)}</span>`;
  }
  return `
    <img
      class="ward-signifier-thumb"
      src="${WardWiseExplorer.escapeHtml(signifier.image_url)}"
      alt="${WardWiseExplorer.escapeHtml(signifier.alt || signifier.name)}"
      loading="lazy"
      decoding="async"
    >
  `;
}

// In change-over-time, show the value as a SIGNED change (+ for improvement) so a number like 27.6 reads
// unambiguously as "+27.6 wellbeing points gained," not a raw score. Negatives already carry "-".
function rankerScoreText(score) {
  const text = WardWiseExplorer.formatNumber(score, { maximumFractionDigits: explorerState.deltaMode ? 1 : 2 });
  return explorerState.deltaMode && Number(score) > 0 ? `+${text}` : text;
}

function renderWeightedRanker() {
  const table = document.querySelector("#comparison-table");
  if (!table) return;
  const heading = document.getElementById("ranker-title");
  if (heading) heading.textContent = areaConfig().rankerTitle;
  const rows = [...explorerState.scores]
    .filter((score) => score.score !== null && score.score !== undefined)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 10);
  table.innerHTML = `
    <div class="comparison-header">
      <span>${WardWiseExplorer.escapeHtml(areaConfig().label)}</span>
      <span>${explorerState.deltaMode ? "Change" : "Score"}</span>
    </div>
    ${rows
      .map((row) => {
        const isSelected = String(row.area_id) === explorerState.currentWardId;
        const ward = findArea(row.area_id);
        return `
          <button class="comparison-row${isSelected ? " is-selected" : ""}" type="button" data-ward-id="${row.area_id}">
            <span class="comparison-row-main">
              ${renderWardVisualSignifierMarkup(ward)}
              <span class="comparison-row-copy">
                <span class="comparison-row-title">${WardWiseExplorer.escapeHtml(ward?.display_name || row.area_id)}</span>
                ${renderWardTopCommunityAreasMarkup(ward)}
              </span>
            </span>
            <strong>${rankerScoreText(row.score)}</strong>
          </button>
        `;
      })
      .join("")}
  `;
  table.querySelectorAll(".comparison-row").forEach((row) => {
    row.addEventListener("click", () => selectWard(row.dataset.wardId));
    row.addEventListener("mouseenter", () => previewWard(row.dataset.wardId));
    row.addEventListener("mouseleave", () => clearWardPreview(row.dataset.wardId));
  });
}

function renderSelectedWardHistory() {
  refreshTimelineForSelectedMetrics();
}

async function refreshTimelineForSelectedMetrics() {
  const metricIds = selectedTimelineMetricIds();
  if (!metricIds.length) {
    explorerState.metricTimeline = null;
    explorerState.timelineMetricKey = "";
    explorerState.timelineLoading = false;
    renderCompositeTimeline();
    return;
  }

  const metricKey = metricIds.join(",");
  if (explorerState.timelineMetricKey === metricKey && explorerState.metricTimeline) {
    renderCompositeTimeline();
    return;
  }

  explorerState.timelineMetricKey = metricKey;
  explorerState.timelineLoading = true;
  renderCompositeTimeline();
  try {
    const timelineData = await WardWiseExplorer.fetchTimeline({
      areaType: explorerState.areaType,
      metricIds,
    });
    if (explorerState.timelineMetricKey !== metricKey) return;
    explorerState.metricTimeline = timelineData;
    explorerState.timelineLoading = false;
    renderCompositeTimeline();
  } catch (error) {
    if (explorerState.timelineMetricKey !== metricKey) return;
    explorerState.metricTimeline = null;
    explorerState.timelineLoading = false;
    renderTimelineError(error);
  }
}

function selectedTimelineMetricIds() {
  return selectedMetricWeights().map(([metricId]) => metricId);
}

function renderCompositeTimeline() {
  const container = document.querySelector("#time-series");
  if (!container) return;

  if (explorerState.timelineLoading) {
    container.innerHTML = "<p>Loading weighted composite history...</p>";
    return;
  }

  if (!selectedMetricWeights().length) {
    container.innerHTML = "<p>Choose at least one metric to see history.</p>";
    return;
  }

  const timeline = buildCompositeTimeline();
  if (!timeline.series.length) {
    container.innerHTML = "<p>No weighted composite timeline is available yet.</p>";
    return;
  }

  container.innerHTML = renderCompositeTimeseries(timeline);
  attachTimelineHoverHandlers(container);
}

function buildCompositeTimeline() {
  const selectedWeights = selectedMetricWeights();
  const metricTimeline = explorerState.metricTimeline;
  if (!selectedWeights.length || !metricTimeline?.series?.length) {
    return { series: [] };
  }

  const metricById = new Map(explorerState.metrics.map((metric) => [metric.metric_id, metric]));
  const selectedMetricIds = new Set(selectedWeights.map(([metricId]) => metricId));
  const snapshots = new Map();
  metricTimeline.series.forEach((metricSeries) => {
    if (!selectedMetricIds.has(metricSeries.metric_id)) return;
    (metricSeries.values || []).forEach((value, index) => {
      if (value === null || value === undefined) return;
      const snapshotRecord = metricTimeline.snapshots?.[index] || {};
      const snapshotId = snapshotRecord.snapshot_id || snapshotRecord.collected_at;
      if (!snapshotId) return;
      if (!snapshots.has(snapshotId)) {
        snapshots.set(snapshotId, {
          snapshotId,
          collectedAt: snapshotRecord.collected_at,
          observationsByMetric: new Map(),
        });
      }
      const snapshot = snapshots.get(snapshotId);
      if (!snapshot.observationsByMetric.has(metricSeries.metric_id)) {
        snapshot.observationsByMetric.set(metricSeries.metric_id, new Map());
      }
      snapshot.observationsByMetric
        .get(metricSeries.metric_id)
        .set(metricSeries.area_id, Number(value));
    });
  });

  const orderedSnapshots = [...snapshots.values()].sort((a, b) =>
    String(a.collectedAt || a.snapshotId).localeCompare(String(b.collectedAt || b.snapshotId)),
  );
  const wardSeries = explorerState.wards.map((ward) => ({
    ward,
    observations: [],
  }));
  const averageObservations = [];

  orderedSnapshots.forEach((snapshot) => {
    const domains = metricDomainsForSnapshot(snapshot.observationsByMetric, selectedWeights);
    const snapshotScores = [];
    wardSeries.forEach((series) => {
      const score = compositeScoreForWard({
        wardId: areaIdOf(series.ward),
        observationsByMetric: snapshot.observationsByMetric,
        domains,
        metricById,
        selectedWeights,
      });
      if (score === null) return;
      const observation = {
        value: score,
        collected_at: snapshot.collectedAt,
        snapshot_id: snapshot.snapshotId,
      };
      series.observations.push(observation);
      snapshotScores.push(score);
    });
    if (snapshotScores.length) {
      averageObservations.push({
        value: snapshotScores.reduce((sum, value) => sum + value, 0) / snapshotScores.length,
        collected_at: snapshot.collectedAt,
        snapshot_id: snapshot.snapshotId,
      });
    }
  });

  const visibleWardSeries = wardSeries.filter((series) => series.observations.length);
  const allValues = [
    ...visibleWardSeries.flatMap((series) => series.observations.map((observation) => observation.value)),
    ...averageObservations.map((observation) => observation.value),
  ];
  return {
    series: visibleWardSeries,
    averageSeries: {
      observations: averageObservations,
    },
    selectedWardId: explorerState.currentWardId,
    snapshotIds: orderedSnapshots.map((snapshot) => snapshot.snapshotId),
    snapshotCount: orderedSnapshots.length,
    rangeStart: orderedSnapshots[0]?.collectedAt,
    rangeEnd: orderedSnapshots.at(-1)?.collectedAt,
    min: Math.min(...allValues),
    max: Math.max(...allValues),
  };
}

function timelineSnapshotRangeSummary(timeline) {
  const count = timeline.snapshotCount || timeline.snapshotIds?.length || 0;
  if (!count) return "";
  if (count === 1) {
    return `Showing 1 snapshot collected ${WardWiseExplorer.formatDateTime(timeline.rangeStart)}.`;
  }
  return `Showing ${count} snapshots from ${WardWiseExplorer.formatDateTime(timeline.rangeStart)} to ${WardWiseExplorer.formatDateTime(timeline.rangeEnd)}.`;
}

function selectedMetricWeights() {
  const metricIds = new Set(explorerState.metrics.map((metric) => metric.metric_id));
  return Object.entries(explorerState.weights)
    .map(([metricId, weight]) => [metricId, Number(weight)])
    .filter(
      ([metricId, weight]) =>
        metricIds.has(metricId) &&
        Number.isFinite(weight) &&
        weight > 0 &&
        metricAvailableForArea(metricId),
    );
}

function metricDomainsForSnapshot(observationsByMetric, selectedWeights) {
  const domains = new Map();
  selectedWeights.forEach(([metricId]) => {
    const values = [...(observationsByMetric.get(metricId)?.values() || [])].filter(Number.isFinite);
    if (!values.length) return;
    domains.set(metricId, {
      min: Math.min(...values),
      max: Math.max(...values),
    });
  });
  return domains;
}

function compositeScoreForWard({
  wardId,
  observationsByMetric,
  domains,
  metricById,
  selectedWeights,
}) {
  let weightedTotal = 0;
  let appliedWeight = 0;
  selectedWeights.forEach(([metricId, weight]) => {
    const value = observationsByMetric.get(metricId)?.get(wardId);
    const domain = domains.get(metricId);
    if (!Number.isFinite(value) || !domain) return;
    const normalized = normalizeMetricValue(
      value,
      domain.min,
      domain.max,
      metricById.get(metricId)?.direction || "higher",
    );
    weightedTotal += normalized * weight;
    appliedWeight += weight;
  });
  return appliedWeight ? weightedTotal / appliedWeight : null;
}

function normalizeMetricValue(value, minimum, maximum, direction) {
  if (maximum === minimum) return 50;
  const normalized = ((value - minimum) / (maximum - minimum)) * 100;
  return Math.max(0, Math.min(100, direction === "lower" ? 100 - normalized : normalized));
}

function renderCompositeTimeseries(timeline) {
  const selectedSeries = timeline.selectedWardId
    ? timeline.series.find((series) => String(areaIdOf(series.ward)) === String(timeline.selectedWardId))
    : null;
  const selectedWard = selectedSeries?.ward;
  const title = selectedWard?.display_name || `Average across ${labelLower()}`;
  const latestAverage = timeline.averageSeries.observations.at(-1);
  const latestSelected = selectedSeries?.observations.at(-1);
  const comparisonSeries = timeline.series.filter(
    (series) => String(areaIdOf(series.ward)) !== String(timeline.selectedWardId),
  );
  return `
    <div class="history-card">
      <p class="eyebrow">Weighted composite</p>
      <h3>${WardWiseExplorer.escapeHtml(title)}</h3>
      <p class="timeline-range">${WardWiseExplorer.escapeHtml(timelineSnapshotRangeSummary(timeline))}</p>
      <p class="timeline-note">All ${areaNoun()} histories are shown at 0.1 opacity for comparison. Hover a point to see its snapshot time.</p>
      <svg class="sparkline" viewBox="0 0 100 100" role="img" aria-label="Weighted composite timeline">
        ${renderTimelinePath({
          observations: timeline.averageSeries.observations,
          timeline,
          opacity: selectedSeries ? 0.65 : 1,
          strokeWidth: 3,
          label: `Average across ${labelLower()}`,
        })}
        ${comparisonSeries.map((series) => renderTimelinePath({
          observations: series.observations,
          timeline,
          opacity: 0.1,
          strokeWidth: 1.4,
          label: series.ward.display_name,
        })).join("")}
        ${selectedSeries ? renderTimelinePath({
          observations: selectedSeries.observations,
          timeline,
          opacity: 1,
          strokeWidth: 3.4,
          label: selectedSeries.ward.display_name,
        }) : ""}
      </svg>
      <div class="timeline-tooltip" role="status" hidden></div>
      <div class="observation-list">
        <article>
          <strong>${WardWiseExplorer.formatNumber(latestAverage?.value, { maximumFractionDigits: 2 })}</strong>
          <span>${capitalize(areaNoun())} average latest ${WardWiseExplorer.formatDateTime(latestAverage?.collected_at)}</span>
          <small>Average is recalculated from every ${areaNoun()}'s weighted composite for each snapshot.</small>
        </article>
        ${
          latestSelected
            ? `
              <article>
                <strong>${WardWiseExplorer.formatNumber(latestSelected.value, { maximumFractionDigits: 2 })}</strong>
                <span>${WardWiseExplorer.escapeHtml(selectedWard.display_name)} latest ${WardWiseExplorer.formatDateTime(latestSelected.collected_at)}</span>
                <small>The selected ${areaNoun()} line is opaque; other ${areaNoun()} lines remain faint comparisons.</small>
              </article>
            `
            : ""
        }
      </div>
    </div>
  `;
}

function renderTimelinePath({ observations, timeline, opacity, strokeWidth, label }) {
  const pointData = observations
    .map((observation) => {
      const coords = timelinePoint(observation, timeline);
      if (!coords) return null;
      return { observation, coords };
    })
    .filter(Boolean);
  if (!pointData.length) return "";
  const polylinePoints = pointData.map((point) => point.coords).join(" ");
  return `
    <g class="timeline-series" opacity="${opacity}" data-label="${WardWiseExplorer.escapeHtml(label)}">
      <polyline class="timeline-hit-line" points="${polylinePoints}" fill="none" stroke="transparent" stroke-width="10" vector-effect="non-scaling-stroke" pointer-events="stroke"></polyline>
      <polyline points="${polylinePoints}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" vector-effect="non-scaling-stroke"></polyline>
      ${pointData
        .map(({ observation, coords }) => {
          const [x, y] = coords.split(",");
          return `
            <circle
              class="timeline-point"
              cx="${x}"
              cy="${y}"
              r="${Math.max(1.6, strokeWidth)}"
              data-label="${WardWiseExplorer.escapeHtml(label)}"
              data-value="${WardWiseExplorer.escapeHtml(WardWiseExplorer.formatNumber(observation.value, { maximumFractionDigits: 2 }))}"
              data-date="${WardWiseExplorer.escapeHtml(WardWiseExplorer.formatDateTime(observation.collected_at))}"
            ></circle>
          `;
        })
        .join("")}
    </g>
  `;
}

function attachTimelineHoverHandlers(container) {
  const tooltip = container.querySelector(".timeline-tooltip");
  const chart = container.querySelector(".sparkline");
  if (!tooltip || !chart) return;

  const showTimelineTooltip = (target) => {
    const series = target.closest(".timeline-series");
    if (!series) return;
    series.classList.add("is-hovered");
    tooltip.hidden = false;
    tooltip.innerHTML = `
      <strong>${target.dataset.label || series.dataset.label}</strong>
      <span>${target.dataset.value} weighted composite</span>
      <small>${target.dataset.date}</small>
    `;
  };

  const hideTimelineTooltip = (target) => {
    const series = target.closest(".timeline-series");
    if (series) series.classList.remove("is-hovered");
    tooltip.hidden = true;
  };

  container.querySelectorAll(".timeline-point, .timeline-hit-line").forEach((target) => {
    target.addEventListener("pointerenter", () => showTimelineTooltip(target));
    target.addEventListener("pointermove", (event) => positionTimelineTooltip(event, tooltip, container));
    target.addEventListener("pointerleave", () => hideTimelineTooltip(target));
  });
}

function positionTimelineTooltip(event, tooltip, container) {
  const bounds = container.getBoundingClientRect();
  const x = event.clientX - bounds.left + 12;
  const y = event.clientY - bounds.top + 12;
  tooltip.style.left = `${Math.max(8, Math.min(x, bounds.width - 190))}px`;
  tooltip.style.top = `${Math.max(8, y)}px`;
}

function timelinePoint(observation, timeline) {
  const index = timeline.snapshotIds.indexOf(observation.snapshot_id);
  if (index < 0) return null;
  const x = timeline.snapshotIds.length === 1 ? 50 : (index / (timeline.snapshotIds.length - 1)) * 100;
  const y = timeline.max === timeline.min
    ? 50
    : 100 - ((Number(observation.value) - timeline.min) / (timeline.max - timeline.min)) * 100;
  return `${roundChartCoordinate(x)},${roundChartCoordinate(y)}`;
}

function roundChartCoordinate(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, "");
}

function renderMetricError(error) {
  const message = WardWiseExplorer.escapeHtml(error.message || "Unable to load metric data.");
  document.querySelector("#comparison-table").innerHTML = "";
  document.querySelector("#time-series").innerHTML = `<p>${message}</p>`;
}

function renderTimelineError(error) {
  const message = WardWiseExplorer.escapeHtml(error.message || "Unable to load history.");
  const container = document.querySelector("#time-series");
  if (container) container.innerHTML = `<p>${message}</p>`;
}

function updateSelectedWardLabel(wardId) {
  for (const layer of explorerState.mapLayers.values()) {
    layer.unbindTooltip();
  }
  if (!wardId) return;
  const selectedLayer = explorerState.mapLayers.get(String(wardId));
  const props = selectedLayer?.feature?.properties || {};
  const labelText = props.ward_number ?? props.community_area_number ?? props.chi_id ?? props.label;
  if (!selectedLayer || labelText == null) return;
  selectedLayer
    .bindTooltip(labelText.toString(), {
      className: "ward-label",
      permanent: true,
      direction: "center",
    })
    .openTooltip();
}

function scoreForWard(wardId) {
  return explorerState.scores.find((score) => String(score.area_id) === String(wardId));
}

function rankedScoreCount() {
  return explorerState.scores.filter((score) => score.score !== null && score.score !== undefined).length;
}

initExplorer();
