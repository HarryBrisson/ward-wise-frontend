// Metric comparison: any two measures as a scatter across one geography, with Pearson r,
// Spearman ρ and a trend line that only appears when there is a relationship to draw.
// URL is state: /reports/comparison?x=<id>&y=<id>&area=<ward|community_area|chi>.
(function () {
  "use strict";
  if (!document.getElementById("comparison-view")) return;

  const P = window.WardWiseMetricPages;
  const api = window.WardWiseExplorer || {};
  const { esc, fmt } = P;

  const state = { catalog: [], labels: {}, byId: {}, area: "ward", markers: { ward: {}, community_area: {}, chi: {} } };

  const xSelect = () => document.getElementById("compare-metric-x");
  const ySelect = () => document.getElementById("compare-metric-y");
  const label = (id) => state.labels[id] || id;

  function syncUrl() {
    P.writeQuery({ x: xSelect().value, y: ySelect().value, area: state.area === "ward" ? "" : state.area });
    api.track?.("metric_comparison", { metric_x: xSelect().value, metric_y: ySelect().value, area_type: state.area });
  }

  function markerSvg(p, areaType) {
    const marker = state.markers[areaType]?.[p.id] || {};
    const r = 9;
    const title = `<title>${esc(p.name)}\n${esc(p.xLabel)}: ${fmt(p.x)}\n${esc(p.yLabel)}: ${fmt(p.y)}</title>`;
    if (marker.image) {
      return `<g class="compare-marker" transform="translate(${(p.cx - r).toFixed(1)} ${(p.cy - r).toFixed(1)})">${title}
        <image href="${esc(marker.image)}" width="${2 * r}" height="${2 * r}" preserveAspectRatio="xMidYMid slice" clip-path="url(#compareDotClip)"/>
        <circle class="compare-marker-ring" cx="${r}" cy="${r}" r="${r}"/></g>`;
    }
    if (marker.number == null && p.id in (state.markers[areaType] || {})) {
      // plain dot (e.g. chis): no number, just a point — the title still identifies it.
      return `<g class="compare-marker" transform="translate(${p.cx.toFixed(1)} ${p.cy.toFixed(1)})">${title}
        <circle class="compare-marker-dot" r="4"/></g>`;
    }
    // Neighborhood numbers aren't familiar to most people, so (lacking a photo) label a
    // neighborhood marker with the initial of its name instead of its community-area number.
    const glyph = areaType === "community_area"
      ? (String(p.name || "?").trim().charAt(0).toUpperCase() || "?")
      : (marker.number ?? p.id);
    return `<g class="compare-marker" transform="translate(${p.cx.toFixed(1)} ${p.cy.toFixed(1)})">${title}
      <circle class="compare-marker-num-bg" r="${r}"/>
      <text class="compare-marker-num" text-anchor="middle" dy="3.2">${esc(glyph)}</text></g>`;
  }

  function scatterSvg(pts, xLabel, yLabel, areaType, r) {
    const W = 900, H = 620, m = { l: 66, r: 26, t: 22, b: 56 };
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const px = (x) => m.l + ((x - xMin) / (xMax - xMin || 1)) * (W - m.l - m.r);
    const py = (y) => H - m.b - ((y - yMin) / (yMax - yMin || 1)) * (H - m.t - m.b);
    // Only draw the trend line when there's at least a weak relationship — a fitted line over a
    // random cloud invites the eye to see structure that the correlation says isn't there.
    const reg = Math.abs(r ?? 0) >= P.NEGLIGIBLE_R ? P.regression(pts.map((p) => [p.x, p.y])) : null;
    const regLine = reg
      ? `<line class="compare-regline" x1="${px(xMin).toFixed(1)}" y1="${py(reg.slope * xMin + reg.intercept).toFixed(1)}" x2="${px(xMax).toFixed(1)}" y2="${py(reg.slope * xMax + reg.intercept).toFixed(1)}"/>`
      : "";
    const markers = pts
      .map((p) => markerSvg({ ...p, cx: px(p.x), cy: py(p.y), xLabel, yLabel }, areaType))
      .join("");
    return `
      <svg class="compare-scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter of ${esc(yLabel)} versus ${esc(xLabel)}">
        <defs><clipPath id="compareDotClip"><circle cx="9" cy="9" r="9"/></clipPath></defs>
        <line class="compare-axis" x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}"/>
        <line class="compare-axis" x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}"/>
        <text class="compare-tick" x="${m.l}" y="${H - m.b + 16}" text-anchor="middle">${fmt(xMin)}</text>
        <text class="compare-tick" x="${W - m.r}" y="${H - m.b + 16}" text-anchor="end">${fmt(xMax)}</text>
        <text class="compare-tick" x="${m.l - 7}" y="${H - m.b}" text-anchor="end">${fmt(yMin)}</text>
        <text class="compare-tick" x="${m.l - 7}" y="${m.t + 8}" text-anchor="end">${fmt(yMax)}</text>
        ${regLine}
        ${markers}
        <text class="compare-axis-label" x="${m.l + (W - m.l - m.r) / 2}" y="${H - 8}" text-anchor="middle">${esc(xLabel)}</text>
        <text class="compare-axis-label" transform="translate(15 ${m.t + (H - m.t - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>
      </svg>
    `;
  }

  // The same pairs as a table, for readers who can't use the scatter (and for copying out).
  function dataTable(pts, xLabel, yLabel, areaType) {
    const rows = pts
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((p) => `<tr><th scope="row">${esc(p.name)}</th><td>${fmt(p.x)}</td><td>${fmt(p.y)}</td></tr>`)
      .join("");
    return `<details class="compare-table">
      <summary>Show the ${pts.length} ${esc(P.areaWord(areaType))} as a table</summary>
      <table><caption class="visually-hidden">${esc(xLabel)} and ${esc(yLabel)} by ${esc(P.areaWord(areaType))}</caption>
        <thead><tr><th scope="col">Area</th><th scope="col">${esc(xLabel)}</th><th scope="col">${esc(yLabel)}</th></tr></thead>
        <tbody>${rows}</tbody></table>
    </details>`;
  }

  async function render() {
    const node = document.getElementById("comparison-content");
    const xId = xSelect().value;
    const yId = ySelect().value;
    if (!xId || !yId) return;
    if (xId === yId) {
      node.innerHTML = `<p class="metric-tool-hint">Pick two different metrics.</p>`;
      return;
    }
    syncUrl();
    document.title = `${label(yId)} vs ${label(xId)} — Metric comparison — Ward Wise Penlight`;
    node.innerHTML = `<p>Loading…</p>`;
    let data;
    try {
      data = await api.fetchComparison([xId, yId], state.area);
    } catch (e) {
      node.innerHTML = `<p class="about-error">Couldn't load comparison.</p>`;
      return;
    }
    const pts = [];
    for (const row of data.rows || []) {
      const x = row.values?.[xId];
      const y = row.values?.[yId];
      if (x == null || y == null) continue;
      pts.push({ x, y, name: row.display_name || row.area_id, id: String(row.area_id) });
    }
    if (pts.length < 2) {
      node.innerHTML = `<p class="metric-tool-hint">Not enough ${P.areaWord(state.area)} have both metrics to compare.</p>`;
      return;
    }
    const r = P.pearson(pts.map((p) => [p.x, p.y]));
    const rho = P.spearman(pts.map((p) => [p.x, p.y]));
    const badge = r == null
      ? ""
      : `<strong>r = ${r.toFixed(2)}</strong>${rho == null ? "" : ` · <strong>ρ = ${rho.toFixed(2)}</strong>`}`;
    node.innerHTML = `
      ${r == null ? "" : `<p class="metric-corr">${badge} — ${P.correlationSentence(r, rho, label(yId), label(xId), pts.length, state.area)}</p>`}
      ${scatterSvg(pts, label(xId), label(yId), state.area, r)}
      <div class="compare-links">
        <a href="${esc(P.deepDiveUrl(xId, state.area))}">Deep dive: ${esc(label(xId))}</a>
        <a href="${esc(P.deepDiveUrl(yId, state.area))}">Deep dive: ${esc(label(yId))}</a>
        <button type="button" class="deepdive-share" id="compare-share">Copy share link</button>
      </div>
      ${dataTable(pts, label(xId), label(yId), state.area)}
      ${P.methodologyBlock([xId, yId], state.byId)}
    `;
    document.getElementById("compare-share")?.addEventListener("click", (e) => P.copyShareLink(e.currentTarget));
  }

  async function init() {
    let loaded;
    try {
      loaded = await P.loadCatalog();
    } catch (e) {
      document.getElementById("comparison-content").innerHTML = `<p class="about-error">Couldn't load the metric catalog.</p>`;
      return;
    }
    Object.assign(state, loaded);
    state.markers = await P.loadMarkers();
    const q = new URLSearchParams(location.search);
    state.area = P.areaParam(q.get("area"));
    P.setToggle("compare-area-toggle", state.area);
    const ids = state.allIds;
    const x = state.byId[q.get("x")] ? q.get("x") : ids[0];
    const y = state.byId[q.get("y")] ? q.get("y") : (ids.find((id) => id !== x) || ids[0]);
    P.fillSelect(xSelect(), state.catalog, x);
    P.fillSelect(ySelect(), state.catalog, y);
    xSelect().addEventListener("change", render);
    ySelect().addEventListener("change", render);
    P.wireToggle("compare-area-toggle", (t) => { state.area = t; render(); });
    await render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
