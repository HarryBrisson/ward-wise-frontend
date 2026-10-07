// Shared by the metric pages (comparison, deep dive): the catalog load, area markers, the
// "what is this metric?" block, the correlation statistics and their plain-English reading.
// Each page is its own template and script now; this is the part they had in common.
window.WardWiseMetricPages = (function () {
  "use strict";

  const api = window.WardWiseExplorer || {};
  const esc = api.escapeHtml || ((v) => String(v));
  const fmt = api.formatNumber || ((v) => (v == null ? "—" : String(Math.round(v * 100) / 100)));

  const AREA_TYPES = ["ward", "community_area", "chi"];

  function areaWord(t) {
    return t === "ward" ? "wards" : t === "chi" ? "χGRIDs" : "neighborhoods";
  }

  function areaParam(value) {
    return AREA_TYPES.includes(value) ? value : "ward";
  }

  // --- catalog + markers --------------------------------------------------------------------
  async function loadCatalog() {
    const payload = await api.fetchMetrics();
    const catalog = (payload.metrics || []).slice().sort((a, b) => (a.label || "").localeCompare(b.label || ""));
    return {
      catalog,
      labels: Object.fromEntries(catalog.map((m) => [m.metric_id, m.label || m.metric_id])),
      byId: Object.fromEntries(catalog.map((m) => [m.metric_id, m])),
      allIds: catalog.map((m) => m.metric_id),
    };
  }

  async function loadMarkers() {
    const markers = { ward: {}, community_area: {}, chi: {} };
    try {
      const resp = (await api.fetchExplorerWards?.()) ?? (await api.fetchJson("/api/explorer/wards", ""));
      const wards = Array.isArray(resp) ? resp : resp?.wards || [];
      for (const w of wards) {
        markers.ward[String(w.ward_id)] = {
          number: w.ward_number ?? w.ward_id,
          image: w.visual_signifier?.image_url || null,
        };
      }
    } catch (e) { /* numbers-only fallback */ }
    try {
      const resp = (await api.fetchCommunityAreas?.()) ?? (await api.fetchJson("/api/community-areas", ""));
      const list = Array.isArray(resp) ? resp : resp?.community_areas || [];
      for (const c of list) {
        markers.community_area[String(c.community_area_id)] = {
          number: c.community_area_number ?? c.community_area_id,
          image: c.visual_signifier?.image_url || null,
        };
      }
    } catch (e) { /* numbers-only fallback */ }
    try {
      const resp = await api.fetchJson("/api/chis", "");
      const list = Array.isArray(resp) ? resp : resp?.chis || [];
      // chis are plain dots on the scatter (no number/photo) — the title still names them.
      for (const c of list) markers.chi[String(c.chi_id)] = { number: null, image: null };
    } catch (e) { /* plain dots */ }
    return markers;
  }

  function fillSelect(select, catalog, defaultId) {
    if (!select) return;
    select.innerHTML = catalog
      .map((m) => `<option value="${esc(m.metric_id)}">${esc(m.label || m.metric_id)}</option>`)
      .join("");
    if (defaultId) select.value = defaultId;
  }

  // Geography toggle: three buttons, one active; the callback gets the area type.
  function wireToggle(id, onChange) {
    const group = document.getElementById(id);
    if (!group) return;
    group.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-area-type]");
      if (!button) return;
      group.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b === button));
      onChange(button.dataset.areaType);
    });
  }

  function setToggle(id, areaType) {
    document.querySelectorAll(`#${id} button`).forEach((b) =>
      b.classList.toggle("is-active", b.dataset.areaType === areaType),
    );
  }

  // The page's state lives in the query string, so every view is a shareable link.
  function writeQuery(params) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) q.set(key, value);
    history.replaceState(null, "", `${location.pathname}${q.toString() ? `?${q}` : ""}`);
  }

  async function copyShareLink(button) {
    try {
      await navigator.clipboard.writeText(location.href);
      button.textContent = "Link copied ✓";
    } catch (e) {
      button.textContent = location.href;
    }
    setTimeout(() => { button.textContent = "Copy share link"; }, 2000);
  }

  // --- metric metadata, humanized for the "what is this metric?" section --------------------
  function humanizeCategory(c) {
    if (!c) return "";
    return c.replace(/_/g, " ").replace(/^\w/, (ch) => ch.toUpperCase());
  }

  function unitLabel(u) {
    return ({
      percent: "Percent",
      currency: "Dollars",
      count: "Count",
      rate: "Rate",
      ratio: "Ratio",
      miles: "Miles",
      score: "Score",
      days: "Days",
      acres_per_10000: "Acres per 10,000 residents",
    })[u] || (u ? humanizeCategory(u) : "");
  }

  function directionLabel(d) {
    if (d === "higher") return "Higher is better";
    if (d === "lower") return "Lower is better";
    return "";
  }

  function chip(text) {
    return text ? `<span class="deepdive-chip">${esc(text)}</span>` : "";
  }

  function metricAbout(m) {
    const lead = m.description || m.methodology || "";
    const showMethod = m.methodology && m.methodology !== m.description;
    return `
      <p class="deepdive-about">${esc(lead)}</p>
      ${showMethod ? `<p class="deepdive-line"><span class="deepdive-line-label">How it's measured</span> ${esc(m.methodology)}</p>` : ""}
      ${m.calculation ? `<p class="deepdive-line"><span class="deepdive-line-label">How it's computed</span> ${esc(m.calculation)}</p>` : ""}
      <div class="deepdive-chips">
        ${chip(unitLabel(m.unit))}
        ${chip(directionLabel(m.direction))}
        ${chip(humanizeCategory(m.category))}
        ${m.source ? chip(`Source: ${m.source}`) : ""}
      </div>`;
  }

  function methodologyBlock(ids, byId) {
    const cards = ids
      .map((id) => {
        const m = byId[id] || {};
        const src = m.source_url
          ? `<a href="${esc(m.source_url)}" rel="noopener">${esc(m.source || "source")}</a>`
          : esc(m.source || "");
        // "Explore" is a partner site showing the underlying records, not where the number
        // came from — kept on its own line so the credit lands on the right project.
        const explore = m.explore?.url
          ? `<a href="${esc(m.explore.url)}" target="_blank" rel="noopener noreferrer">${esc(m.explore.label || "more detail")}</a>`
          : "";
        return `<div class="metric-method-card">
          <p class="metric-method-name">${esc(m.label || id)}</p>
          <p class="metric-method-text">${esc(m.methodology || m.description || "")}</p>
          ${src ? `<p class="metric-method-src">Source: ${src}</p>` : ""}
          ${explore ? `<p class="metric-method-src">Explore further: ${explore}</p>` : ""}
        </div>`;
      })
      .join("");
    return `<div class="metric-methodology"><p class="metric-method-head">How these are measured</p>${cards}</div>`;
  }

  // --- stats ----------------------------------------------------------------------------------
  function pearson(points) {
    const n = points.length;
    if (n < 2) return null;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of points) {
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    const cov = n * sxy - sx * sy;
    const dx = Math.sqrt(n * sxx - sx * sx);
    const dy = Math.sqrt(n * syy - sy * sy);
    if (dx === 0 || dy === 0) return null;
    return cov / (dx * dy);
  }

  // Spearman's ρ = Pearson on the ranks. Catches any monotonic relationship — including curved/log
  // ones a straight-line Pearson r understates — so a big ρ-vs-r gap flags a non-linear tie.
  function rank(values) {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(values.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j < order.length && order[j][0] === order[i][0]) j += 1;
      const avg = (i + j + 1) / 2; // average rank for ties (1-based)
      for (let k = i; k < j; k += 1) ranks[order[k][1]] = avg;
      i = j;
    }
    return ranks;
  }

  function spearman(points) {
    if (points.length < 2) return null;
    const rx = rank(points.map((p) => p[0]));
    const ry = rank(points.map((p) => p[1]));
    return pearson(rx.map((r, i) => [r, ry[i]]));
  }

  function regression(points) {
    const n = points.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of points) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const denom = n * sxx - sx * sx;
    if (denom === 0) return null;
    const slope = (n * sxy - sx * sy) / denom;
    return { slope, intercept: (sy - slope * sx) / n };
  }

  // Below this |r| we call it "no relationship" and hide the trend line — a line through an
  // essentially random cloud reads as a pattern that isn't there. Set at 0.05 so |r| = 0.10 still
  // reads as a (weak) relationship while true noise reads as none.
  const NEGLIGIBLE_R = 0.05;

  function strengthBand(a) {
    return a < NEGLIGIBLE_R ? 0 : a < 0.3 ? 1 : a < 0.5 ? 2 : a < 0.7 ? 3 : 4;
  }

  function bareStrength(a) {
    return ["no", "a weak", "a moderate", "a strong", "a very strong"][strengthBand(a)];
  }

  function correlationWord(r) {
    const a = Math.abs(r);
    // "no relationship" carries no direction — "no negative relationship" is self-contradictory.
    if (a < NEGLIGIBLE_R) return "no relationship";
    return `${bareStrength(a)} ${r >= 0 ? "positive" : "negative"} relationship`;
  }

  // Pearson describes the linear tie; Spearman (ρ) the monotonic one. When ρ is materially
  // stronger, the relationship is real but curved — say so rather than let the weak linear r
  // read as "barely related."
  function correlationSentence(r, rho, yLabel, xLabel, n, areaType) {
    const areas = `${n} ${areaWord(areaType)}`;
    const monotonic =
      rho != null && strengthBand(Math.abs(rho)) > strengthBand(Math.abs(r)) && Math.abs(rho) - Math.abs(r) >= 0.1;
    if (!monotonic) {
      return `${esc(yLabel)} shows ${correlationWord(r)} with ${esc(xLabel)} across ${areas}.`;
    }
    const linear = Math.abs(r) < NEGLIGIBLE_R ? "no linear relationship" : `${bareStrength(Math.abs(r))} linear relationship`;
    return `${esc(yLabel)} shows ${linear} with ${esc(xLabel)}, but the stronger rank correlation (ρ) points to a non-linear one, across ${areas}.`;
  }

  function comparisonUrl(xId, yId, areaType) {
    const q = new URLSearchParams({ x: xId, y: yId });
    if (areaType && areaType !== "ward") q.set("area", areaType);
    return `/reports/comparison?${q}`;
  }

  function deepDiveUrl(metricId, areaType) {
    const q = new URLSearchParams({ metric: metricId });
    if (areaType && areaType !== "ward") q.set("area", areaType);
    return `/reports/deep-dive?${q}`;
  }

  return {
    esc, fmt, areaWord, areaParam, loadCatalog, loadMarkers, fillSelect, wireToggle, setToggle,
    writeQuery, copyShareLink, metricAbout, methodologyBlock,
    pearson, spearman, regression, NEGLIGIBLE_R, correlationSentence, comparisonUrl, deepDiveUrl,
  };
})();
