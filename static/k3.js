// K3: the sequenced explorer. Landing -> your ward -> choose what matters -> compare.
//
// Three commitments, carried from the design review:
//   1. A named starter set replaces the random default. Every visitor sees the
//      same Chicago until they change it, and the copy never claims they chose.
//   2. Rank leads everywhere. The composite rescales whenever the mix changes,
//      so the raw score never appears as a headline number.
//   3. Every edit states its consequence in one sentence, next to the row that
//      caused it, and the URL always carries the exact view for sharing.
//
// Scoring mirrors the server: each metric's ward value is min-max normalized to
// 0-100 across wards (direction-aware), the composite is the weighted average of
// those, and rank is position within the 50. All client math runs on the same
// score matrix the classic explorer uses.

(function () {
  "use strict";

  const api = window.WardWiseExplorer;

  const STARTER = {
    park_count: 1,
    library_count: 1,
    community_belonging_pct: 1,
    frequent_mental_distress_pct: 1,
    landmark_count: 1,
  };

  const STARTER_SENTENCE =
    "parks, libraries, landmarks, community belonging, and mental distress";

  const state = {
    view: "landing", // landing | ward | list | compare
    wardId: null,
    vsId: null,
    weights: { ...STARTER },
    edited: false,
    lastShift: null, // { metricId, label, from, to, removed }
    openDomains: new Set(),
    detailFor: null,
    search: "",
    sessionId: `k3-${Math.random().toString(36).slice(2, 10)}`,
  };

  const data = {
    metrics: [],
    metricById: new Map(),
    wards: [],
    wardById: new Map(),
    cells: {}, // wardId -> metricId -> { s, v }
    geojson: null,
  };

  let map = null;
  let geoLayer = null;

  // ---------- small helpers ----------

  const esc = (value) => api.escapeHtml(value);

  function ord(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function el(id) {
    return document.getElementById(id);
  }

  function show(id, visible) {
    el(id).hidden = !visible;
  }

  function toast(message) {
    const node = el("k3-toast");
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      node.hidden = true;
    }, 2600);
  }

  function wardName(wardId) {
    const ward = data.wardById.get(String(wardId));
    return ward ? ward.display_name : `Ward ${wardId}`;
  }

  function wardHoods(wardId) {
    const ward = data.wardById.get(String(wardId));
    const overlaps = ward?.community_area_overlaps || [];
    return overlaps
      .slice(0, 2)
      .map((area) => area.name)
      .join(" & ");
  }

  // ---------- scoring, the same math as the server ----------

  function computeScores(weights) {
    const active = Object.entries(weights).filter(([, w]) => Number(w) > 0);
    const rows = [];
    Object.entries(data.cells).forEach(([wardId, cells]) => {
      let total = 0;
      let applied = 0;
      let used = 0;
      active.forEach(([metricId, weight]) => {
        if (metricId in cells) {
          total += cells[metricId].s * Number(weight);
          applied += Number(weight);
          used += 1;
        }
      });
      rows.push({
        wardId,
        score: applied ? Math.round((total / applied) * 100) / 100 : null,
        used,
        of: active.length,
      });
    });
    const ranked = rows.filter((r) => r.score !== null);
    ranked.sort((a, b) => b.score - a.score);
    ranked.forEach((row, index) => {
      row.rank = index + 1;
    });
    return ranked;
  }

  function scoreRow(wardId, weights) {
    return computeScores(weights).find((row) => row.wardId === String(wardId)) || null;
  }

  function metricStanding(metricId, wardId) {
    const entries = [];
    Object.entries(data.cells).forEach(([wid, cells]) => {
      if (metricId in cells) entries.push([wid, cells[metricId].s, cells[metricId].v]);
    });
    entries.sort((a, b) => b[1] - a[1]);
    const index = entries.findIndex(([wid]) => wid === String(wardId));
    if (index === -1) return null;
    return { rank: index + 1, n: entries.length, value: entries[index][2] };
  }

  function consequenceOf(metricId, removed) {
    const before = scoreRow(state.wardId, state.weights);
    const next = { ...state.weights };
    if (removed) delete next[metricId];
    else next[metricId] = 1;
    const after = scoreRow(state.wardId, next);
    return { from: before?.rank ?? null, to: after?.rank ?? null };
  }

  // ---------- URL as the single source of state ----------

  function writeUrl() {
    const params = new URLSearchParams();
    if (state.wardId) params.set("ward", state.wardId);
    if (state.view !== "landing" && state.view !== "ward") params.set("view", state.view);
    if (state.vsId && state.view === "compare") params.set("vs", state.vsId);
    if (state.edited) {
      const mix = Object.entries(state.weights)
        .map(([id, w]) => (Number(w) === 1 ? id : `${id}:${w}`))
        .join(",");
      params.set("m", mix);
    }
    const query = params.toString();
    history.replaceState(null, "", query ? `?${query}` : location.pathname);
  }

  function readUrl() {
    const params = new URLSearchParams(location.search);
    const ward = params.get("ward");
    if (ward && /^\d{1,2}$/.test(ward)) {
      state.wardId = String(Number(ward));
      state.view = "ward";
    }
    const view = params.get("view");
    if (state.wardId && (view === "list" || view === "compare")) state.view = view;
    const vs = params.get("vs");
    if (vs && /^\d{1,2}$/.test(vs)) state.vsId = String(Number(vs));
    const mix = params.get("m");
    if (mix) {
      const weights = {};
      mix.split(",").forEach((token) => {
        const [id, w] = token.split(":");
        if (id) weights[id.trim()] = Number(w || 1) || 1;
      });
      if (Object.keys(weights).length) {
        state.weights = weights;
        state.edited = true;
      }
    }
  }

  // ---------- boot ----------

  async function boot() {
    readUrl();
    try {
      const [metricsRaw, wardsRaw, geojson, matrixRaw] = await Promise.all([
        api.fetchMetrics(),
        api.fetchExplorerWards(),
        api.fetchWardGeojson(),
        api.fetchJson("/api/metrics/score-matrix?area_type=ward", "Unable to load scores."),
      ]);
      data.metrics = Array.isArray(metricsRaw)
        ? metricsRaw
        : metricsRaw.metrics || Object.values(metricsRaw).find(Array.isArray) || [];
      data.metrics.forEach((metric) => data.metricById.set(metric.metric_id, metric));
      data.wards = Array.isArray(wardsRaw)
        ? wardsRaw
        : wardsRaw.wards || Object.values(wardsRaw).find(Array.isArray) || [];
      data.wards.forEach((ward) => data.wardById.set(String(ward.ward_id), ward));
      const matrix = matrixRaw.matrix || matrixRaw;
      data.cells = matrix.latest || matrix;
      data.geojson = geojson;
    } catch (error) {
      el("k3-landing").insertAdjacentHTML(
        "beforeend",
        `<p class="k3-quiet">${esc(error.message)} Refresh to try again.</p>`,
      );
      return;
    }
    initMap();
    render();
  }

  // ---------- map ----------

  function hueColor(t) {
    const from = [238, 233, 250];
    const to = [46, 16, 101];
    const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t));
    return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
  }

  function initMap() {
    map = L.map("k3-map", {
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: true,
    });
    // CARTO Positron: the quiet light basemap, free for public projects.
    // It matches the page instead of fighting the choropleth.
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 15,
    }).addTo(map);
    geoLayer = L.geoJSON(data.geojson, {
      style: wardStyle,
      onEachFeature: (feature, layer) => {
        const wardId = featureWardId(feature);
        layer.bindTooltip(labelFor(wardId), {
          permanent: true,
          direction: "center",
          className: "k3-ward-label",
        });
        layer.on("click", () => {
          selectWard(wardId);
        });
      },
    }).addTo(map);
    map.fitBounds(geoLayer.getBounds(), { padding: [8, 8] });
    paintMap();
  }

  function featureWardId(feature) {
    const props = feature.properties || {};
    const raw = props.ward_id ?? props.ward ?? props.WARD ?? props.ward_num;
    return String(Number(raw));
  }

  function labelFor(wardId) {
    return `<span data-ward-label="${wardId}">${wardId}</span>`;
  }

  function wardStyle(feature) {
    const wardId = featureWardId(feature);
    const selected = wardId === state.wardId;
    const versus = wardId === state.vsId && state.view === "compare";
    return {
      fillColor: mapFill(wardId),
      fillOpacity: 0.82,
      color: selected ? "#17181c" : versus ? "#c2410c" : "#ffffff",
      weight: selected || versus ? 2.5 : 1,
    };
  }

  let paintCache = null;

  function paintMap() {
    const ranked = computeScores(state.weights);
    const scores = ranked.map((row) => row.score);
    paintCache = {
      byWard: new Map(ranked.map((row) => [row.wardId, row])),
      min: Math.min(...scores),
      max: Math.max(...scores),
    };
    geoLayer.setStyle(wardStyle);
    document.querySelectorAll("[data-ward-label]").forEach((node) => {
      const row = paintCache.byWard.get(node.dataset.wardLabel);
      const t = row
        ? (row.score - paintCache.min) / Math.max(1e-9, paintCache.max - paintCache.min)
        : 0;
      node.classList.toggle("lite", t > 0.55);
    });
    const median = medianScore(scores);
    el("k3-maplegend").innerHTML =
      `<b>Darker is a higher rank</b> on ${state.edited ? "your list" : "the starter set"}` +
      `<span class="k3-legendbar" aria-hidden="true"></span>` +
      `median ward ${Math.round(median)}, top ward ${Math.round(paintCache.max)}, ` +
      `so color spans what wards actually score, not an imaginary 100.`;
  }

  function mapFill(wardId) {
    if (!paintCache) return "#eee9fa";
    const row = paintCache.byWard.get(String(wardId));
    if (!row) return "#eee9fa";
    const t = (row.score - paintCache.min) / Math.max(1e-9, paintCache.max - paintCache.min);
    return hueColor(t);
  }

  function medianScore(scores) {
    const sorted = [...scores].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // ---------- view switching ----------

  function selectWard(wardId) {
    if (state.picking === "b") {
      state.vsId = String(wardId);
      state.picking = null;
      state.view = "compare";
    } else if (state.picking === "a") {
      state.wardId = String(wardId);
      state.picking = null;
      state.view = "compare";
    } else {
      state.wardId = String(wardId);
      state.view = "ward";
    }
    render();
  }

  function render() {
    el("k3-app").dataset.view = state.view;
    show("k3-landing", state.view === "landing");
    show("k3-ward", state.view === "ward");
    show("k3-list", state.view === "list");
    show("k3-compare", state.view === "compare");
    show("k3-context", state.view !== "landing");
    if (state.view !== "landing") {
      el("k3-context-ward").textContent =
        `${wardHoods(state.wardId) || "Chicago"} · ${wardName(state.wardId)}`;
    }
    if (state.view === "ward") renderWard();
    if (state.view === "list") renderList();
    if (state.view === "compare") renderCompare();
    if (map) paintMap();
    writeUrl();
  }

  // ---------- state 2: their ward ----------

  function renderWard() {
    const row = scoreRow(state.wardId, state.weights);
    const hoods = wardHoods(state.wardId);
    el("k3-ward-head").innerHTML =
      `<div class="k3-wardname">${esc(wardName(state.wardId))}` +
      (hoods ? `<span>${esc(hoods)}</span>` : "") +
      `</div>`;

    const active = Object.keys(state.weights);
    const standings = active
      .map((id) => ({ id, metric: data.metricById.get(id), standing: metricStanding(id, state.wardId) }))
      .filter((item) => item.metric && item.standing);
    const ahead = standings.filter((item) => item.standing.rank <= 25).length;

    const mixNoun = state.edited
      ? `the <b>${active.length} things on your list</b>`
      : `the <b>starter set</b>, five everyday measures counted equally, ${STARTER_SENTENCE}. A starting point, not a verdict`;
    el("k3-ward-hero").innerHTML =
      `<div class="k3-hero-big num">${row ? ord(row.rank) : "?"}<small>of 50 wards</small></div>` +
      `<div class="k3-starter">on ${mixNoun}. ${esc(wardName(state.wardId))} is ahead of the ` +
      `city median on ${ahead} of the ${standings.length}.</div>`;

    renderField(row);
    renderPeek(standings);
    renderOverTime(row);
  }

  function renderField(row) {
    const ranked = computeScores(state.weights);
    const scores = ranked.map((r) => r.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const span = Math.max(1e-9, max - min);
    const pct = (s) => ((s - min) / span) * 100;
    const median = medianScore(scores);

    const bins = new Array(12).fill(0);
    ranked.forEach((r) => {
      bins[Math.min(11, Math.floor(pct(r.score) / (100 / 12)))] += 1;
    });
    const smooth = bins.map((v, i) => ((bins[i - 1] || 0) + 2 * v + (bins[i + 1] || 0)) / 4);
    const peak = Math.max(...smooth);
    let hill = "0,34 ";
    smooth.forEach((v, i) => {
      hill += `${((i + 0.5) * (100 / 12)).toFixed(1)},${(34 - (v / peak) * 26).toFixed(1)} `;
    });
    hill += "100,34";

    const warm = [194, 65, 12];
    const gray = [186, 186, 196];
    const cool = [76, 29, 149];
    const tickColor = (t) => {
      const [a, b, k] = t < 0.5 ? [warm, gray, t * 2] : [gray, cool, (t - 0.5) * 2];
      const mix = a.map((c, i) => Math.round(c + (b[i] - c) * k));
      return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
    };

    let ticks = "";
    ranked.forEach((r) => {
      const x = pct(r.score).toFixed(1);
      const me = r.wardId === state.wardId;
      ticks +=
        `<line x1="${x}" y1="${me ? 8 : 22}" x2="${x}" y2="34" ` +
        `stroke="${me ? "#4c1d95" : tickColor(pct(r.score) / 100)}" ` +
        `stroke-width="${me ? 3 : 1.6}" vector-effect="non-scaling-stroke"` +
        `${me ? "" : ' opacity="0.85"'}/>`;
    });

    const you = ranked.find((r) => r.wardId === state.wardId);
    el("k3-field").innerHTML =
      `<div class="k3-field"><div class="k3-fieldviz" role="img" ` +
      `aria-label="All 50 wards by score, ${esc(wardName(state.wardId))} pinned">` +
      (you
        ? `<span class="k3-youpin" style="left:${pct(you.score).toFixed(1)}%">You · ${ord(you.rank)}</span>`
        : "") +
      `<span class="k3-medflag" style="left:${pct(median).toFixed(1)}%">middle of the pack</span>` +
      `<svg viewBox="0 0 100 36" preserveAspectRatio="none">` +
      `<defs><linearGradient id="k3fg" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0%" stop-color="#c2410c"/><stop offset="50%" stop-color="#babac4"/>` +
      `<stop offset="100%" stop-color="#4c1d95"/></linearGradient></defs>` +
      `<polygon points="${hill}" fill="url(#k3fg)" opacity="0.16"/>` +
      `<polyline points="${hill}" fill="none" stroke="url(#k3fg)" stroke-width="1.5" opacity="0.5" vector-effect="non-scaling-stroke"/>` +
      ticks +
      `<line x1="${pct(median).toFixed(1)}" y1="6" x2="${pct(median).toFixed(1)}" y2="34" ` +
      `stroke="#6f7683" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` +
      `</svg></div>` +
      `<div class="k3-fieldlabels"><span class="lo">behind</span>` +
      `<span>every line is one ward</span><span class="hi">ahead</span></div>` +
      `<div class="k3-fieldcap">The hill shows where wards bunch up. ` +
      `<b>${esc(wardName(state.wardId))} is the pinned line.</b></div></div>`;
  }

  function renderPeek(standings) {
    const sorted = [...standings].sort((a, b) => a.standing.rank - b.standing.rank);
    const strongest = sorted.slice(0, 2);
    const weakest = sorted.slice(-1);
    const railRow = (item, withEnds) => {
      const pos = ((50 - item.standing.rank) / 49) * 100;
      return (
        `<div class="k3-mrow"><span class="nm">${esc(item.metric.label)}</span>` +
        `<span class="val num">${esc(api.formatMetricValue(item.standing.value, item.metric))}</span>` +
        `<span class="rk num">${ord(item.standing.rank)}</span>` +
        `<span class="k3-rail"><span class="medt"></span>` +
        `<span class="pt" style="left:${pos.toFixed(1)}%"></span></span>` +
        (withEnds
          ? `<span class="k3-railends"><span>behind the city</span><span>ahead</span></span>`
          : "") +
        `</div>`
      );
    };
    el("k3-peek").innerHTML =
      `<div class="k3-peekhead">Strongest, on ${state.edited ? "your list" : "the starter set"}</div>` +
      strongest.map((item) => railRow(item, false)).join("") +
      `<div class="k3-peekhead">Weakest</div>` +
      weakest.map((item) => railRow(item, true)).join("") +
      `<button type="button" class="k3-seeall" data-act="open-list">` +
      `See everything we measure for ${esc(wardName(state.wardId))} ›</button>`;
  }

  async function renderOverTime(row) {
    const now = new Date();
    const monthName = now.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    const yearNow = now.getFullYear();
    const rankY = (rank) => 6 + ((rank - 1) / 49) * 26;
    let record =
      `<div class="k3-peekhead">${esc(wardName(state.wardId))} over time</div>` +
      `<div class="k3-rankrec"><svg viewBox="0 0 100 38" preserveAspectRatio="none">`;
    [1, 25, 50].forEach((r) => {
      record += `<line x1="7" y1="${rankY(r)}" x2="99" y2="${rankY(r)}" stroke="#00000012" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`;
    });
    for (let k = 0; k < 5; k += 1) {
      record += `<line x1="${10 + k * 22}" y1="4" x2="${10 + k * 22}" y2="34" stroke="#00000009" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`;
    }
    if (row) {
      record +=
        `<line x1="10" y1="${rankY(row.rank)}" x2="10" y2="${rankY(row.rank)}" stroke="#fff" stroke-width="12" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
        `<line x1="10" y1="${rankY(row.rank)}" x2="10" y2="${rankY(row.rank)}" stroke="#4c1d95" stroke-width="8" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    }
    record += `</svg>`;
    record +=
      `<span class="k3-rr-ylab" style="top:6%">1st</span>` +
      `<span class="k3-rr-ylab" style="top:46%">25th</span>` +
      `<span class="k3-rr-ylab" style="top:82%">50th</span>`;
    if (row) {
      record += `<span class="k3-rr-chip" style="left:10%;top:${((rankY(row.rank) / 38) * 100).toFixed(0)}%">${esc(monthName)} · ${ord(row.rank)}</span>`;
    }
    for (let k = 0; k < 5; k += 1) {
      record += `<span class="k3-rr-year" style="left:${10 + k * 22}%">${yearNow + k}</span>`;
    }
    record += `</div>`;
    record +=
      `<div class="k3-trendcap" style="margin-top:22px"><b>The record starts now.</b> ` +
      `Penlight saves this ward's standing from today, so this line grows each time you come back.</div>`;

    el("k3-overtime").innerHTML = record + `<div class="k3-multis" id="k3-multis"></div>`;

    // yearly series for this ward, drawn for whichever measures already have one
    try {
      const seriesRaw = await api.fetchTimeseries({ areaId: state.wardId });
      const series = seriesRaw.timeseries || [];
      const yearly = [];
      series.forEach((entry) => {
        const byYear = new Map();
        (entry.observations || []).forEach((obs) => {
          const year = (obs.period_end || "").slice(0, 4);
          if (year) byYear.set(year, obs.value);
        });
        if (byYear.size >= 6) {
          const points = [...byYear.entries()]
            .map(([year, value]) => [Number(year), Number(value)])
            .sort((a, b) => a[0] - b[0]);
          yearly.push({ metricId: entry.metric_id, points });
        }
      });
      yearly.sort((a, b) => b.points.length - a.points.length);
      const chosen = yearly.slice(0, 2);
      let html = chosen
        .map((entry) => {
          const metric = data.metricById.get(entry.metricId);
          const label = metric ? metric.label : entry.metricId;
          const first = entry.points[0];
          const last = entry.points[entry.points.length - 1];
          return (
            `<div class="k3-multi"><h6>${esc(label)}</h6>` +
            `<div class="mv num">${esc(api.formatMetricValue(first[1], metric))} in ${first[0]}, ` +
            `${esc(api.formatMetricValue(last[1], metric))} in ${last[0]}</div>` +
            miniChart(entry.points) +
            `</div>`
          );
        })
        .join("");
      html +=
        `<div class="k3-multi ghost"><h6>More coming</h6><div class="mv">as records arrive</div>` +
        `<div class="slot">each new yearly record<br>gets a chart here</div></div>`;
      el("k3-multis").innerHTML = html;
    } catch (_error) {
      el("k3-multis").innerHTML =
        `<div class="k3-multi ghost"><h6>Over the years</h6><div class="mv">history unavailable right now</div>` +
        `<div class="slot">yearly records appear here</div></div>`;
    }
  }

  function miniChart(points) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const ymax = Math.max(...ys);
    const X = (x) => ((x - x0) / Math.max(1, x1 - x0)) * 94 + 3;
    const Y = (y) => 26 - (y / (ymax * 1.08)) * 22;
    const pts = points.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
    const last = points[points.length - 1];
    const ex = X(last[0]).toFixed(1);
    const ey = Y(last[1]).toFixed(1);
    return (
      `<svg viewBox="0 0 100 28" preserveAspectRatio="none">` +
      `<polygon points="${X(points[0][0]).toFixed(1)},26 ${pts} ${ex},26" fill="rgba(76,29,149,.08)"/>` +
      `<polyline points="${pts}" fill="none" stroke="#4c1d95" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
      `<line x1="${ex}" y1="${ey}" x2="${ex}" y2="${ey}" stroke="#fff" stroke-width="9" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
      `<line x1="${ex}" y1="${ey}" x2="${ex}" y2="${ey}" stroke="#4c1d95" stroke-width="5.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
      `</svg>`
    );
  }

  // ---------- state 3: choose what matters ----------

  function renderList() {
    const row = scoreRow(state.wardId, state.weights);
    const count = Object.keys(state.weights).length;
    el("k3-statusline").textContent =
      `${wardName(state.wardId)} · ${row ? `${ord(row.rank)} of 50` : "no rank yet"} · based on your ${count}`;
    el("k3-back-num").textContent = state.wardId;

    const onListRows = Object.keys(state.weights)
      .map((id) => listRow(id, true))
      .join("");
    el("k3-onlist").innerHTML =
      `<div class="k3-listhead"><b>On your list</b> · ${count}</div>` + onListRows;

    renderAddMore();
  }

  function listRow(metricId, onList) {
    const metric = data.metricById.get(metricId);
    if (!metric) return "";
    const standing = metricStanding(metricId, state.wardId);
    const standingText = standing ? `${ord(standing.rank)} in Chicago` : "no data here";
    const isOpen = state.detailFor === metricId;
    const shift = state.lastShift && state.lastShift.metricId === metricId ? state.lastShift : null;
    let detail = "";
    if (isOpen) {
      const consequence = consequenceOf(metricId, onList);
      const consequenceText =
        consequence.from === consequence.to
          ? `${onList ? "Removing" : "Adding"} it would not change the overall rank.`
          : `${onList ? "Removing" : "Adding"} it would move ${wardName(state.wardId)} from ` +
            `${ord(consequence.from)} to ${ord(consequence.to)} of 50.`;
      detail =
        `<span class="k3-detail">${esc(metric.description || "")} ` +
        (standing && standing.n < 50 ? `Data covers ${standing.n} of 50 wards. ` : "") +
        (metric.direction === "lower" ? "Lower is better, the standing already accounts for it. " : "") +
        esc(consequenceText) +
        `</span>`;
    }
    let just = "";
    if (shift) {
      const moved =
        shift.from === shift.to
          ? "the rank held"
          : `${wardName(state.wardId)} moved from ${ord(shift.from)} to ${ord(shift.to)}`;
      just =
        `<span class="k3-justrow">${shift.removed ? "Removed" : "Added"} · ${esc(moved)}` +
        `<button type="button" data-act="undo">Undo</button></span>`;
    }
    return (
      `<div class="k3-lrow" data-metric="${esc(metricId)}">` +
      `<span class="nm">${esc(metric.label)}</span>` +
      `<span class="st num">${esc(standingText)}</span>` +
      `<span style="display:flex;gap:12px;justify-self:end">` +
      `<button type="button" class="btn quiet" data-act="detail">Details</button>` +
      `<button type="button" class="btn" data-act="${onList ? "remove" : "add"}">${onList ? "Remove" : "Add"}</button>` +
      `</span>` +
      detail +
      just +
      `</div>`
    );
  }

  function renderAddMore() {
    const query = state.search.trim().toLowerCase();
    const groups = new Map();
    data.metrics.forEach((metric) => {
      if (metric.metric_id in state.weights) return;
      if (!(metric.metric_id in (data.cells[state.wardId] || {}))) return;
      if (query && !metric.label.toLowerCase().includes(query)) return;
      const domain = api.formatCategory(metric.category);
      if (!groups.has(domain)) groups.set(domain, []);
      groups.get(domain).push(metric);
    });
    const sortedDomains = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    let html = `<div class="k3-listhead"><b>Add more</b></div>`;
    sortedDomains.forEach(([domain, metrics]) => {
      metrics.sort(
        (a, b) =>
          (metricStanding(a.metric_id, state.wardId)?.rank || 99) -
          (metricStanding(b.metric_id, state.wardId)?.rank || 99),
      );
      const open = query || state.openDomains.has(domain);
      html += `<div class="k3-domfold"><h5>${domain}</h5>`;
      html +=
        `<button type="button" class="toggle" data-act="toggle-domain" data-domain="${domain}">` +
        `${open ? "hide" : `${metrics.length} measures ›`}</button></div>`;
      if (open) html += metrics.map((metric) => listRow(metric.metric_id, false)).join("");
    });
    el("k3-addmore").innerHTML = html;
  }

  function changeMix(metricId, removed) {
    const metric = data.metricById.get(metricId);
    const consequence = consequenceOf(metricId, removed);
    if (removed) delete state.weights[metricId];
    else state.weights[metricId] = 1;
    state.edited = true;
    state.lastShift = { metricId, from: consequence.from, to: consequence.to, removed };
    state.detailFor = null;
    try {
      api.submitMetricSelectionEvent({
        action: removed ? "k3_remove" : "k3_add",
        session_id: state.sessionId,
        changed_metric_id: metricId,
        selected_metrics: Object.entries(state.weights).map(([id, w]) => ({
          metric_id: id,
          weight: w,
        })),
        weights: { ...state.weights },
      });
    } catch (_error) {
      /* telemetry is best-effort */
    }
    render();
    if (metric && consequence.from !== consequence.to) {
      toast(`${wardName(state.wardId)} is now ${ord(consequence.to)} of 50`);
    }
  }

  // ---------- state 4: compare ----------

  function renderCompare() {
    if (!state.vsId) {
      state.vsId = state.wardId === "43" ? "44" : "43";
    }
    el("k3-back-num-2").textContent = state.wardId;
    const a = scoreRow(state.wardId, state.weights);
    const b = scoreRow(state.vsId, state.weights);
    el("k3-vs").innerHTML =
      `<div class="k3-vs">` +
      `<div class="side a"><div class="wn">${esc(wardName(state.wardId))}</div>` +
      `<div class="wr num">${a ? `${ord(a.rank)} of 50` : "no rank"}</div>` +
      `<button type="button" class="sw" data-act="swap-a">${esc(wardHoods(state.wardId) || "")} · change</button></div>` +
      `<span class="mid">VS</span>` +
      `<div class="side b"><div class="wn">${esc(wardName(state.vsId))}</div>` +
      `<div class="wr num">${b ? `${ord(b.rank)} of 50` : "no rank"}</div>` +
      `<button type="button" class="sw" data-act="swap-b">${esc(wardHoods(state.vsId) || "")} · change</button></div>` +
      `</div>`;

    const duels = Object.keys(state.weights)
      .map((id) => {
        const metric = data.metricById.get(id);
        const sa = metricStanding(id, state.wardId);
        const sb = metricStanding(id, state.vsId);
        return metric && sa && sb ? { metric, sa, sb } : null;
      })
      .filter(Boolean);
    const aWins = duels.filter((d) => d.sa.rank < d.sb.rank).length;
    const bWins = duels.filter((d) => d.sb.rank < d.sa.rank).length;
    const bBest = duels
      .filter((d) => d.sb.rank < d.sa.rank)
      .map((d) => d.metric.label.toLowerCase());
    let verdict;
    if (aWins > bWins) {
      verdict =
        `<b><span class="ca">${esc(wardName(state.wardId))}</span> is ahead on ${aWins} of the ` +
        `${duels.length}</b> things on your list.` +
        (bBest.length
          ? ` <span class="cb">${esc(wardName(state.vsId))}</span> leads on ${esc(bBest.join(", "))}.`
          : "");
    } else if (bWins > aWins) {
      verdict =
        `<b><span class="cb">${esc(wardName(state.vsId))}</span> is ahead on ${bWins} of the ` +
        `${duels.length}</b> things on your list.`;
    } else {
      verdict = `<b>Even.</b> Each ward leads on ${aWins} of the ${duels.length}.`;
    }
    el("k3-verdict").innerHTML = `<div class="k3-verdict">${verdict}</div>`;

    const ranked = computeScores(state.weights);
    const scores = ranked.map((r) => r.score);
    const min = Math.min(...scores);
    const span = Math.max(1e-9, Math.max(...scores) - min);
    const pct = (s) => ((s - min) / span) * 100;
    let strip = `<svg viewBox="0 0 100 20" preserveAspectRatio="none">`;
    ranked.forEach((r) => {
      if (r.wardId === state.wardId || r.wardId === state.vsId) return;
      strip += `<line x1="${pct(r.score).toFixed(1)}" y1="6" x2="${pct(r.score).toFixed(1)}" y2="20" stroke="#d5d8df" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
    });
    if (b) strip += `<line x1="${pct(b.score).toFixed(1)}" y1="1" x2="${pct(b.score).toFixed(1)}" y2="20" stroke="#ea580c" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
    if (a) strip += `<line x1="${pct(a.score).toFixed(1)}" y1="1" x2="${pct(a.score).toFixed(1)}" y2="20" stroke="#5b21b6" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
    strip += `</svg>`;
    el("k3-pairfield").innerHTML =
      strip +
      `<div class="k3-pairkey"><span class="ka">▎ ${esc(wardName(state.wardId))}</span>` +
      `<span class="kb">▎ ${esc(wardName(state.vsId))}</span>` +
      `<span>every thin line is another ward</span></div>`;

    const width = (rank) => (((50 - rank) / 49) * 88 + 8).toFixed(1);
    el("k3-duel").innerHTML = duels
      .map((d) => {
        const aLeads = d.sa.rank < d.sb.rank;
        return (
          `<div class="k3-drow"><div class="k3-dname">${esc(d.metric.label)}</div>` +
          `<div class="k3-dbars">` +
          `<div class="k3-dcell l"><span class="k3-dbar${aLeads ? "" : " lose"}" style="width:${width(d.sa.rank)}%"></span>` +
          `<span class="k3-dord num${aLeads ? " win-a" : " lose"}">${ord(d.sa.rank)}</span></div>` +
          `<div class="k3-dcell r"><span class="k3-dbar${aLeads ? " lose" : ""}" style="width:${width(d.sb.rank)}%"></span>` +
          `<span class="k3-dord num${aLeads ? " lose" : " win-b"}">${ord(d.sb.rank)}</span></div>` +
          `</div></div>`
        );
      })
      .join("");
  }

  // ---------- address lookup ----------

  // ray-casting point-in-polygon over the ward boundaries already in memory.
  // geojson coordinates are [lng, lat].
  function pointInRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function wardAtPoint(lat, lng) {
    for (const feature of data.geojson.features || []) {
      const geom = feature.geometry || {};
      const polys =
        geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
      for (const poly of polys) {
        if (poly.length && pointInRing(lng, lat, poly[0])) {
          return featureWardId(feature);
        }
      }
    }
    return null;
  }

  async function geocodeAndGo(query) {
    const box = el("k3-search-results");
    box.hidden = false;
    box.innerHTML = `<button type="button" disabled>Looking up that address&hellip;</button>`;
    try {
      const result = await api.fetchJson(
        `/geocode?q=${encodeURIComponent(query)}`,
        "Address lookup is unavailable right now.",
      );
      if (result.match) {
        const wardId = wardAtPoint(result.match.lat, result.match.lon);
        if (wardId) {
          box.hidden = true;
          selectWard(wardId);
          toast(`That address is in ${wardName(wardId)}`);
          return;
        }
      }
      box.innerHTML =
        `<button type="button" disabled>No Chicago match for that. ` +
        `Try a street address, a neighborhood, or a ward number.</button>`;
    } catch (error) {
      box.innerHTML = `<button type="button" disabled>${esc(error.message)}</button>`;
    }
  }

  // ---------- landing search ----------

  function matchWards(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results = [];
    data.wards.forEach((ward) => {
      const num = String(ward.ward_number || ward.ward_id);
      const hoods = (ward.community_area_overlaps || []).map((a) => a.name);
      const numHit = num === q.replace(/^ward\s*/, "");
      const hoodHit = hoods.find((name) => name.toLowerCase().includes(q));
      if (numHit || hoodHit) {
        results.push({ ward, why: numHit ? "ward number" : hoodHit });
      }
    });
    results.sort((x, y) => Number(x.ward.ward_id) - Number(y.ward.ward_id));
    return results.slice(0, 6);
  }

  let suggestTimer = null;
  let suggestSeq = 0;
  let suggestPending = false;
  let addressSuggestions = [];
  const suggestCache = new Map(); // query -> suggestions, so backspacing is instant

  function renderSearchResults(query) {
    const box = el("k3-search-results");
    const locals = matchWards(query);
    const rows = [];
    locals.forEach((r) => {
      rows.push(
        `<button type="button" data-act="pick-ward" data-ward="${esc(r.ward.ward_id)}">` +
          `${esc(r.ward.display_name)}<span class="hood">${esc(r.why)}</span></button>`,
      );
    });
    addressSuggestions.forEach((s, index) => {
      rows.push(
        `<button type="button" data-act="pick-addr" data-idx="${index}">` +
          `&#9906; ${esc(s.label)}${s.extra ? `<span class="hood">${esc(s.extra)}</span>` : ""}</button>`,
      );
    });
    if (suggestPending && !addressSuggestions.length) {
      rows.push(`<button type="button" disabled>Searching addresses&hellip;</button>`);
    }
    if (!rows.length) {
      box.hidden = query.trim().length < 2;
      box.innerHTML = `<button type="button" disabled>No match yet, keep typing an address, a neighborhood, or a ward number.</button>`;
      return;
    }
    box.hidden = false;
    box.innerHTML = rows.join("");
  }

  // google-style autofill: local matches render instantly, address
  // suggestions stream in behind them, debounced and sequence-guarded
  function scheduleSuggestions(query) {
    clearTimeout(suggestTimer);
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length < 3) {
      addressSuggestions = [];
      suggestPending = false;
      renderSearchResults(query);
      return;
    }
    if (suggestCache.has(trimmed)) {
      addressSuggestions = suggestCache.get(trimmed);
      suggestPending = false;
      renderSearchResults(query);
      return;
    }
    suggestPending = true;
    renderSearchResults(query);
    suggestTimer = setTimeout(async () => {
      const seq = ++suggestSeq;
      try {
        const result = await api.fetchJson(
          `/geocode/suggest?q=${encodeURIComponent(query)}`,
          "Suggestions unavailable.",
        );
        if (suggestCache.size > 80) suggestCache.clear();
        suggestCache.set(trimmed, result.suggestions || []);
        if (seq !== suggestSeq) return; // a newer keystroke superseded this one
        addressSuggestions = result.suggestions || [];
        suggestPending = false;
        renderSearchResults(query);
      } catch (_error) {
        suggestPending = false;
        /* suggestions are best-effort, submit still resolves the address */
      }
    }, 160);
  }

  async function pickAddress(index) {
    const suggestion = addressSuggestions[index];
    if (!suggestion) return;
    el("k3-search-results").hidden = true;
    try {
      const result = await api.fetchJson(
        `/geocode/resolve?text=${encodeURIComponent(suggestion.label)}&key=${encodeURIComponent(suggestion.key || "")}`,
        "Address lookup is unavailable right now.",
      );
      const wardId = result.match ? wardAtPoint(result.match.lat, result.match.lon) : null;
      if (wardId) {
        selectWard(wardId);
        toast(`${suggestion.label} is in ${wardName(wardId)}`);
      } else {
        toast("That spot is outside Chicago's 50 wards.");
      }
    } catch (error) {
      toast(error.message);
    }
  }

  // ---------- events ----------

  function onClick(event) {
    const target = event.target.closest("[data-act]");
    if (!target) return;
    const act = target.dataset.act;
    const rowNode = target.closest("[data-metric]");
    const metricId = rowNode ? rowNode.dataset.metric : null;
    if (act === "pick-ward") selectWard(target.dataset.ward);
    if (act === "pick-addr") pickAddress(Number(target.dataset.idx));
    if (act === "open-list") {
      state.view = "list";
      render();
    }
    if (act === "detail") {
      state.detailFor = state.detailFor === metricId ? null : metricId;
      renderList();
    }
    if (act === "add") changeMix(metricId, false);
    if (act === "remove") changeMix(metricId, true);
    if (act === "undo" && state.lastShift) {
      const shift = state.lastShift;
      state.lastShift = null;
      if (shift.removed) state.weights[shift.metricId] = 1;
      else delete state.weights[shift.metricId];
      render();
    }
    if (act === "toggle-domain") {
      const domain = target.dataset.domain;
      if (state.openDomains.has(domain)) state.openDomains.delete(domain);
      else state.openDomains.add(domain);
      renderAddMore();
    }
    if (act === "swap-a" || act === "swap-b") {
      // reuse the landing picker rather than a blocking dialog: the next ward
      // chosen lands in whichever compare slot asked for it
      state.picking = act === "swap-a" ? "a" : "b";
      state.view = "landing";
      render();
      el("k3-search").focus();
    }
  }

  function wire() {
    el("k3-app").addEventListener("click", onClick);
    el("k3-change-ward").addEventListener("click", () => {
      state.view = "landing";
      render();
    });
    el("k3-open-list").addEventListener("click", () => {
      state.view = "list";
      render();
    });
    el("k3-open-compare").addEventListener("click", () => {
      state.view = "compare";
      render();
    });
    el("k3-back-ward").addEventListener("click", () => {
      state.view = "ward";
      render();
    });
    el("k3-back-ward-2").addEventListener("click", () => {
      state.view = "ward";
      render();
    });
    el("k3-share").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        toast("Link copied. It opens this exact view.");
      } catch (_error) {
        toast(location.href);
      }
    });
    const search = el("k3-search");
    search.addEventListener("input", () => scheduleSuggestions(search.value));
    // submit order: a neighborhood or ward-number match, then the top
    // address suggestion, then a one-shot geocode of whatever was typed
    const go = () => {
      const query = search.value.trim();
      if (!query) return;
      const first = matchWards(query)[0];
      if (first) selectWard(first.ward.ward_id);
      else if (addressSuggestions.length) pickAddress(0);
      else geocodeAndGo(query);
    };
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") go();
    });
    el("k3-search-go").addEventListener("click", go);
    const metricSearch = el("k3-metric-search");
    metricSearch.addEventListener("input", () => {
      state.search = metricSearch.value;
      renderAddMore();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    wire();
    boot();
  });
}());
