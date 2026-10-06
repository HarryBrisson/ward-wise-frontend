// Metric deep dive: one measure ranked across every area of one geography, and which other
// measures move with it (each link opens the comparison page on that pair).
// URL is state: /reports/deep-dive?metric=<id>&area=<ward|community_area|chi>.
(function () {
  "use strict";
  if (!document.getElementById("deepdive-view")) return;

  const P = window.WardWiseMetricPages;
  const api = window.WardWiseExplorer || {};
  const { esc, fmt } = P;

  const state = { catalog: [], labels: {}, byId: {}, allIds: [], area: "ward" };

  const select = () => document.getElementById("deepdive-metric");
  const label = (id) => state.labels[id] || id;

  function syncUrl() {
    P.writeQuery({ metric: select().value, area: state.area === "ward" ? "" : state.area });
    api.track?.("metric_deepdive", { metric_id: select().value, area_type: state.area });
  }

  function correlationsFor(id, allRows) {
    const corrs = [];
    for (const other of state.allIds) {
      if (other === id) continue;
      const pairs = [];
      for (const row of allRows) {
        const a = row.values?.[id];
        const b = row.values?.[other];
        if (a != null && b != null) pairs.push([a, b]);
      }
      if (pairs.length < 5) continue;
      const r = P.pearson(pairs);
      if (r != null) corrs.push({ id: other, r, n: pairs.length });
    }
    return corrs;
  }

  function corrRow(id, c) {
    const pct = Math.min(100, Math.abs(c.r) * 100);
    const dir = c.r >= 0 ? "pos" : "neg";
    return `<a class="corr-row" href="${esc(P.comparisonUrl(id, c.id, state.area))}" title="View ${esc(label(c.id))} vs ${esc(label(id))}">
      <span class="corr-name">${esc(label(c.id))}</span>
      <span class="corr-track"><span class="corr-fill corr-${dir}" style="width:${pct.toFixed(0)}%"></span></span>
      <span class="corr-r">${c.r >= 0 ? "+" : ""}${c.r.toFixed(2)}</span>
    </a>`;
  }

  async function render() {
    const node = document.getElementById("deepdive-content");
    const id = select().value;
    if (!id) return;
    syncUrl();
    document.title = `${label(id)} — Metric deep dive — Ward Wise Penlight`;
    node.innerHTML = `<p>Loading…</p>`;
    let data;
    try {
      data = await api.fetchComparison(state.allIds, state.area);
    } catch (e) {
      node.innerHTML = `<p class="about-error">Couldn't load metric.</p>`;
      return;
    }
    const allRows = data.rows || [];
    const rows = allRows
      .map((r) => ({ name: r.display_name || r.area_id, value: r.values?.[id] }))
      .filter((r) => r.value != null)
      .sort((a, b) => b.value - a.value);
    if (!rows.length) {
      node.innerHTML = `<p class="metric-tool-hint">No ${P.areaWord(state.area)} data for this metric.</p>`;
      return;
    }
    const vals = rows.map((r) => r.value);
    const max = vals[0], min = vals[vals.length - 1];
    const mid = vals[Math.floor(vals.length / 2)];
    const span = max - min || 1;
    const bars = rows
      .map((r, i) =>
        `<div class="deepdive-row" role="row"><span class="deepdive-name" role="cell">${esc(r.name)}</span><span class="deepdive-bar" role="cell" aria-label="Rank ${i + 1} of ${rows.length}"><span style="width:${(((r.value - min) / span) * 100).toFixed(1)}%"></span></span><span class="deepdive-val" role="cell">${fmt(r.value)}</span></div>`)
      .join("");

    const corrs = correlationsFor(id, allRows);
    const pos = corrs.filter((c) => c.r > 0).sort((a, b) => b.r - a.r).slice(0, 5);
    const neg = corrs.filter((c) => c.r < 0).sort((a, b) => a.r - b.r).slice(0, 5);
    const areaLabel = P.areaWord(state.area);
    const corrSection = corrs.length
      ? `<section class="deepdive-section">
           <h3 class="deepdive-h">What is it related to?</h3>
           <p class="deepdive-corr-sub">Across ${rows.length} ${areaLabel} — open any metric to plot the relationship.</p>
           <div class="corr-cols">
             <div><p class="corr-col-label">Moves together (positive)</p>${pos.map((c) => corrRow(id, c)).join("") || `<p class="metric-tool-hint">none</p>`}</div>
             <div><p class="corr-col-label">Moves opposite (negative)</p>${neg.map((c) => corrRow(id, c)).join("") || `<p class="metric-tool-hint">none</p>`}</div>
           </div>
         </section>`
      : "";

    const m = state.byId[id] || {};
    node.innerHTML = `
      <div class="deepdive-header">
        <h2 class="deepdive-title">${esc(m.label || label(id))}</h2>
        <button class="deepdive-share" id="deepdive-share" type="button">Copy share link</button>
      </div>
      <section class="deepdive-section">
        <h3 class="deepdive-h">What is this metric?</h3>
        ${P.metricAbout(m)}
        <p class="deepdive-line"><a href="/dictionary?metric=${encodeURIComponent(id)}">Dictionary entry</a></p>
      </section>
      <section class="deepdive-section">
        <h3 class="deepdive-h">How does it vary?</h3>
        <div class="deepdive-stats">
          <div><span class="deepdive-stat-label">High</span><span class="deepdive-stat-num">${fmt(max)}</span><span class="deepdive-stat-sub">${esc(rows[0].name)}</span></div>
          <div><span class="deepdive-stat-label">Median</span><span class="deepdive-stat-num">${fmt(mid)}</span></div>
          <div><span class="deepdive-stat-label">Low</span><span class="deepdive-stat-num">${fmt(min)}</span><span class="deepdive-stat-sub">${esc(rows[rows.length - 1].name)}</span></div>
          <div><span class="deepdive-stat-label">Areas</span><span class="deepdive-stat-num">${rows.length}</span></div>
        </div>
        <p class="deepdive-list-head" id="deepdive-list-head">Ranked across ${rows.length} ${areaLabel}</p>
        <div class="deepdive-list" role="table" aria-labelledby="deepdive-list-head">${bars}</div>
      </section>
      ${corrSection}
    `;
    document.getElementById("deepdive-share")?.addEventListener("click", (e) => P.copyShareLink(e.currentTarget));
  }

  async function init() {
    let loaded;
    try {
      loaded = await P.loadCatalog();
    } catch (e) {
      document.getElementById("deepdive-content").innerHTML = `<p class="about-error">Couldn't load the metric catalog.</p>`;
      return;
    }
    Object.assign(state, loaded);
    const q = new URLSearchParams(location.search);
    state.area = P.areaParam(q.get("area"));
    P.setToggle("deepdive-area-toggle", state.area);
    const wanted = state.byId[q.get("metric")] ? q.get("metric") : state.allIds[0];
    P.fillSelect(select(), state.catalog, wanted);
    select().addEventListener("change", render);
    P.wireToggle("deepdive-area-toggle", (t) => { state.area = t; render(); });
    await render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
