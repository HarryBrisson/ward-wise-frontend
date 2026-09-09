/* Presentation layer for the original explorer's geography and scoring engine. */
(function () {
  "use strict";
  const el = (id) => document.getElementById(id);
  const esc = (value) => WardWiseExplorer.escapeHtml(String(value ?? ""));
  const number = (value) => value == null ? "—" : Number(value).toFixed(1);
  let reportOpen = false;
  let reportReady = false;
  let receivingReport = false;
  let reportSignature = "";
  const activeWeights = () => Object.fromEntries(Object.entries(explorerState.weights).filter(([, w]) => w > 0));
  const overlaps = (area) => (area?.community_area_overlaps || []).slice().sort((a, b) => b.ward_area_pct - a.ward_area_pct).slice(0, 2)
    .map((a) => `${number(a.ward_area_pct)}% ${a.name}`).join(" • ");
  const areaLabel = (id) => findArea(id)?.display_name || `${capitalize(areaNoun())} ${id}`;
  const components = (id) => wardScoreComponents(id).sort((a, b) => b.normalized_score - a.normalized_score);
  const metricName = (id) => explorerState.metrics.find((m) => m.metric_id === id)?.label || id;

  function setWeight(id, weight) {
    explorerState.weights[id] = weight;
    renderMetrics();
    refreshMetricViews();
    recordMetricSelection("toggle", { changedMetricId: id });
  }

  function renderMetrics() {
    setMetricControlsLoading(false);
    const query = el("metric-search").value.trim().toLowerCase();
    const available = explorerState.metrics.filter((m) => metricAvailableForArea(m.metric_id) && metricAvailableForYear(m.metric_id));
    el("metric-count").textContent = available.length;
    const groups = new Map();
    available.slice().sort((a, b) => a.label.localeCompare(b.label)).forEach((metric) => {
      const category = domainLabel(metric.category);
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(metric);
    });
    el("metric-weights").innerHTML = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([category, metrics]) => {
      const matches = metrics.filter((m) => `${m.label} ${m.description || ""} ${category}`.toLowerCase().includes(query));
      if (!matches.length) return "";
      return `<section class="home-domain"><div class="home-domain-heading"><h3>${esc(category)}</h3><span>${metrics.filter((m) => explorerState.weights[m.metric_id] > 0).length} Active</span></div><div class="home-domain-metrics">${matches.map((m) => {
        const weight = explorerState.weights[m.metric_id] || 0;
        const source = WardWiseMetricDetails.metricSource(m, metricCoverage(m.metric_id));
        return `<article class="home-metric ${weight ? "is-on" : "is-off"}"><div class="home-metric-copy"><div><strong>${esc(m.label)}</strong>${m.direction === "lower" ? '<span class="home-inverse" title="Lower raw values receive higher wellbeing scores">Inverse</span>' : ""}</div><p title="${esc(source)}">${esc(m.description || source || "Chicago open data")}</p></div><div class="home-weight-control" role="group" aria-label="${esc(m.label)} weight">${[0, 1, 10].map((w) => `<button type="button" data-weight="${w}" data-metric="${esc(m.metric_id)}" aria-label="${esc(m.label)}: ${w === 0 ? "Off" : w === 1 ? "On" : "High"}" aria-pressed="${w === weight}" class="${w === weight ? "is-active" : ""} ${w === 10 ? "priority" : ""}">${w === 0 ? "Off" : w === 1 ? "On" : "High"}</button>`).join("")}</div></article>`;
      }).join("")}</div></section>`;
    }).join("") || '<p class="home-empty">No metrics match this search or time window.</p>';
    renderFormula();
  }

  function renderFormula() {
    updateMethodologyLink();
    el("wellbeing-equation-formula").innerHTML = explorerState.metrics.filter((m) => explorerState.weights[m.metric_id] > 0 && metricAvailableForArea(m.metric_id)).map((m) => {
      const w = explorerState.weights[m.metric_id];
      return `<button type="button" class="home-formula-chip ${w === 10 ? "priority" : ""}" data-remove="${esc(m.metric_id)}" aria-label="Remove ${esc(m.label)}"><b>${m.direction === "lower" ? "−" : ""}${w === 10 ? "★" : ""}${w}×</b><span>${esc(m.label)}</span><span aria-hidden="true">×</span></button>`;
    }).join("") || '<span class="home-empty-formula">Choose metrics to calculate wellbeing scores.</span>';
    syncReport();
  }

  function leaderboardMetricRanks() {
    // Rank each active metric across the full geography, before search filtering.
    // Component scores already account for inverse metrics and the selected year.
    const byMetric = new Map();
    for (const row of explorerState.scores) {
      for (const component of wardScoreComponents(row.area_id)) {
        if (!Number.isFinite(component.normalized_score)) continue;
        if (!byMetric.has(component.metric_id)) byMetric.set(component.metric_id, []);
        byMetric.get(component.metric_id).push({ areaId: String(row.area_id), score: component.normalized_score });
      }
    }
    const badges = new Map();
    for (const [metricId, standings] of byMetric) {
      standings.sort((a, b) => b.score - a.score);
      let rank = 0;
      standings.forEach((standing, index) => {
        // Equal scores share a rank; the next rank skips the tied places.
        if (index === 0 || standing.score !== standings[index - 1].score) rank = index + 1;
        if (rank > 3) return;
        if (!badges.has(standing.areaId)) badges.set(standing.areaId, []);
        badges.get(standing.areaId).push({ metric_id: metricId, rank });
      });
    }
    for (const chips of badges.values()) {
      chips.sort((a, b) => a.rank - b.rank || metricName(a.metric_id).localeCompare(metricName(b.metric_id)));
    }
    return badges;
  }

  function renderRanks() {
    const metricRanks = leaderboardMetricRanks();
    const query = el("ward-search").value.trim().toLowerCase();
    const rows = explorerState.scores.filter((row) => `${areaLabel(row.area_id)} ${overlaps(findArea(row.area_id))}`.toLowerCase().includes(query));
    el("comparison-table").innerHTML = rows.map((row) => {
      const selected = String(row.area_id) === explorerState.currentWardId;
      const top = metricRanks.get(String(row.area_id)) || [];
      return `<button type="button" class="home-rank-row comparison-row${selected ? " is-selected" : ""}" data-ward-id="${esc(row.area_id)}" aria-pressed="${selected}"><span class="home-rank-top"><span class="home-rank-number">${row.rank ? String(row.rank).padStart(2, "0") : "—"}</span><span class="home-rank-copy"><strong>${esc(areaLabel(row.area_id))}${selected ? '<small class="home-selected-badge">SELECTED</small>' : ""}</strong></span><span class="home-rank-score"><strong>${explorerState.deltaMode && row.score > 0 ? "+" : ""}${number(row.score)}</strong>${explorerState.deltaMode ? "<small>Score change</small>" : ""}</span></span>${top.length ? `<span class="home-rank-tags">${top.map((c) => `<span>#${c.rank} ${esc(metricName(c.metric_id))}</span>`).join("")}</span>` : ""}</button>`;
    }).join("") || '<p class="home-empty">No areas match your search.</p>';
    el("map-hint").textContent = `● Click ${areaNoun()} to inspect`;
    el("ward-search").placeholder = `Filter by ${areaNoun()} or name…`;
    document.querySelectorAll("[data-area-type]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.areaType === explorerState.areaType)));
    el("home-selection").hidden = false;
    renderSelection(explorerState.currentWardId);
    syncReport();
  }

  function renderSelection(id) {
    const box = el("home-selection");
    if (!id) {
      box.innerHTML = '<p class="home-empty">Select an area to explore its score and metrics.</p>';
      return;
    }
    const area = findArea(id);
    const top = components(id).slice(0, 3);
    box.innerHTML = `<div class="home-selection-heading"><strong>${esc(areaLabel(id))}</strong>${explorerState.areaType === "ward" ? '<button id="view-profile" type="button">View full profile <span aria-hidden="true">›</span></button>' : '<span class="home-area-note">Area summary</span>'}</div><p class="home-selection-hoods">${esc(overlaps(area))}</p><div class="home-summary-components">${top.map((c) => `<div><span>${esc(metricName(c.metric_id))}</span><strong>${number(c.normalized_score)}</strong><small class="${c.weight === 10 ? "home-priority-text" : ""}">${c.weight === 10 ? "★ " : ""}${c.weight}×</small></div>`).join("") || '<p class="home-empty">No selected metric data for this area.</p>'}</div>`;
    el("view-profile")?.addEventListener("click", () => openReport(id));
  }

  function mapStyle(id) {
    const score = scoreForWard(id)?.score;
    const low = cssVariable("--home-metric-on", "#0b7892");
    const high = cssVariable("--home-metric-high", "#df8000");
    const color = score == null ? "#dce1e4" : explorerState.deltaMode ? fillColorForDelta(score) : interpolateHexColor(low, high, score / 100);
    return { color: id === explorerState.currentWardId ? "#111827" : "#ffffff", weight: id === explorerState.currentWardId ? 3 : 1.3, fillColor: color, fillOpacity: 0.9 };
  }

  function reportState() {
    return { type: "wardwise:report-state", wardId: explorerState.currentWardId, weights: activeWeights(), year: explorerState.deltaMode ? el("delta-to-year").value : explorerState.selectedYear || "latest" };
  }

  function syncReport() {
    if (!reportOpen || !reportReady || receivingReport) return;
    const state = reportState();
    const signature = JSON.stringify(state);
    if (signature === reportSignature) return;
    reportSignature = signature;
    el("ward-report-frame").contentWindow.postMessage(state, location.origin);
  }

  function openReport(id) {
    explorerState.currentWardId = String(id);
    reportOpen = true;
    document.querySelector(".home-layout").classList.add("is-report-open");
    el("home-inputs").hidden = true;
    el("visualizer-ranker").hidden = true;
    el("home-report").hidden = false;
    el("show-explorer").hidden = false;
    if (!el("ward-report-frame").getAttribute("src")) {
      const params = new URLSearchParams({ embedded: "1", ward: String(Number(id)), m: Object.entries(activeWeights()).map(([key, w]) => `${key}:${w}`).join(","), y: String(reportState().year) });
      el("ward-report-frame").src = `/report?${params}`;
    }
    syncReport();
    el("show-explorer").focus();
  }

  function closeReport() {
    reportOpen = false;
    document.querySelector(".home-layout").classList.remove("is-report-open");
    el("home-inputs").hidden = false;
    el("visualizer-ranker").hidden = false;
    el("home-report").hidden = true;
    el("show-explorer").hidden = true;
    requestAnimationFrame(fitFullCity);
    el("view-profile")?.focus();
  }

  window.WardWiseHome = { renderMetrics, renderFormula, renderRanks, renderSelection, mapStyle };
  document.addEventListener("DOMContentLoaded", () => {
    el("metric-search").addEventListener("input", renderMetrics);
    el("ward-search").addEventListener("input", renderRanks);
    el("show-explorer").addEventListener("click", closeReport);
    el("metric-weights").addEventListener("click", (event) => {
      const b = event.target.closest("[data-weight]");
      if (!b) return;
      setWeight(b.dataset.metric, Number(b.dataset.weight));
      // Re-rendering a metric must not lose the keyboard user's place.
      el("metric-weights").querySelector(`[data-metric="${CSS.escape(b.dataset.metric)}"][data-weight="${b.dataset.weight}"]`)?.focus({ preventScroll: true });
    });
    el("wellbeing-equation-formula").addEventListener("click", (event) => {
      const b = event.target.closest("[data-remove]");
      if (b) setWeight(b.dataset.remove, 0);
    });
    el("comparison-table").addEventListener("click", (event) => {
      const row = event.target.closest("[data-ward-id]");
      if (row) selectWard(row.dataset.wardId);
    });
    window.addEventListener("message", (event) => {
      if (event.origin !== location.origin || event.source !== el("ward-report-frame").contentWindow) return;
      if (event.data?.type === "wardwise:report-ready") { reportReady = true; reportSignature = ""; syncReport(); }
      if (event.data?.type === "wardwise:report-close") closeReport();
      if (event.data?.type !== "wardwise:report-change" || !reportOpen) return;
      receivingReport = true;
      explorerState.weights = Object.fromEntries(Object.entries(event.data.weights || {}).filter(([id, w]) => explorerState.metrics.some((m) => m.metric_id === id) && [1, 10].includes(w)));
      if (findArea(event.data.wardId)) explorerState.currentWardId = event.data.wardId;
      updateSelectedWardLabel(explorerState.currentWardId);
      explorerState.selectedYear = event.data.year === "latest" ? null : String(event.data.year);
      explorerState.deltaMode = false;
      el("year-selector").value = explorerState.selectedYear || "";
      el("year-selector").disabled = false;
      el("delta-mode-toggle").checked = false;
      el("delta-year-controls").hidden = true;
      updateTimeButtonLabel();
      renderMetrics();
      reportSignature = JSON.stringify(reportState());
      receivingReport = false;
      refreshMetricViews();
    });
  });
}());
