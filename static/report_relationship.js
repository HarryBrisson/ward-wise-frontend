// Metric relationship: how two measures relate across places today, and whether the record of how
// they've moved over time says anything about one driving the other.
//
// URL is state: /reports/relationship?x=<id>&y=<id>&area=<ward|community_area|chi>. With no area
// the page opens on the geography that suits the pair (the API's default_area_type): wards for
// ward-level measures like legislation and menu money, neighborhoods or χGRIDs for the rest.
//
// The over-time statistics are precomputed by the pipeline (shared/civic_data/dynamics.py in the
// API repo) and served by GET /api/metrics/relationship. This page only renders them, and says so
// plainly when they aren't available yet for a pair.
(function () {
  "use strict";
  if (!document.getElementById("relationship-view")) return;

  const P = window.WardWiseMetricPages;
  const C = window.WardWiseCharts;
  const api = window.WardWiseExplorer || {};
  const { esc, fmt } = P;

  const state = { catalog: [], labels: {}, byId: {}, area: null, areaChosen: false, markers: {}, dispose: null };
  const $ = (id) => document.getElementById(id);
  const label = (id) => state.labels[id] || id;

  function syncUrl() {
    P.writeQuery({ x: $("rel-x").value, y: $("rel-y").value, area: state.areaChosen ? state.area : "" });
  }

  // --- the evidence cards ---------------------------------------------------------------------
  function card(title, body, foot = "") {
    return `<article class="rel-card"><h3>${esc(title)}</h3>${body}${foot ? `<p class="rel-card-foot">${foot}</p>` : ""}</article>`;
  }

  function leadWords(pair, xL, yL) {
    if (!pair.lag_profile?.length) return "Not enough years to compare timing.";
    if (pair.x_leads) return `Changes in ${esc(xL)} tend to come <strong>before</strong> changes in ${esc(yL)}${pair.lead_k > 0 ? `, by about ${pair.lead_k} year${pair.lead_k === 1 ? "" : "s"}` : ""}.`;
    if (pair.y_leads) return `Changes in ${esc(yL)} tend to come <strong>before</strong> changes in ${esc(xL)}, the opposite order.`;
    return "Neither measure clearly moves first.";
  }

  const FLAG_WORDS = {
    shared_allocation: "Both are estimated onto these areas from the same source boundaries, which makes them move together mechanically.",
    both_modeled: "Both are modeled estimates built from overlapping census inputs, not direct measurements.",
    same_source: "Both come from the same dataset, so a change in how it's collected moves both.",
    acs_overlap: "At least one is a 5-year census average, so year-to-year changes are smoothed and overlap.",
    fixed_denominator: "Rates use a fixed population, so changes track counts, not population shifts.",
    few_years: "Few overlapping years: timing evidence is thin.",
    few_areas: "Few areas have both measures.",
  };

  function evidenceHtml(rel) {
    const xL = label(rel.x), yL = label(rel.y);
    const pair = rel.pair;
    if (!pair) {
      return `<div class="rel-evidence-head"><h2>Over time</h2></div>
        <p class="rel-muted">${esc(rel.reason || "There isn't enough over-time data for both measures in these areas to look at how they move together.")}</p>`;
    }
    const comove = Number.isFinite(pair.comove_r)
      ? `<p class="rel-big">r = ${pair.comove_r.toFixed(2)}</p><p>${Math.abs(pair.comove_r) < 0.2
          ? "When one changes faster than the city in a place, the other barely follows."
          : `When ${esc(xL)} rises faster than the city in a place, ${esc(yL)} tends to ${pair.comove_r > 0 ? "rise" : "fall"} too.`}</p>`
      : `<p class="rel-muted">Not enough overlapping years.</p>`;
    const lag = `${C.lagBars(pair.lag_profile, { leadK: pair.lead_k })}<p>${leadWords(pair, xL, yL)}</p>`;
    const ev = pair.event || {};
    const natural = `${ev.path ? C.eventPath(ev.path, ev.control) : ""}
      <p>${ev.n_shocks
        ? `${esc(xL)} jumped sharply ${ev.n_shocks} time${ev.n_shocks === 1 ? "" : "s"} across ${ev.n_shock_years || "several"} different year${ev.n_shock_years === 1 ? "" : "s"}. ${ev.pretrend ? `${esc(yL)} was already moving before those jumps, which weakens the comparison.` : `${esc(yL)} wasn't already moving beforehand.`}`
        : `${esc(xL)} has no sharp jumps to compare against.`}
      ${Number.isFinite(rel.x_facts?.within_share) ? `${Math.round(rel.x_facts.within_share * 100)}% of its variation is change within places over time rather than differences between places.` : ""}</p>`;
    const conf = (pair.confounders || []).length
      ? `<ul class="rel-conf">${pair.confounders.map((z) => `<li><a href="${esc(P.relationshipUrl(z.metric_id, rel.y, rel.area_type))}">${esc(label(z.metric_id))}</a>
          <span>moves with both (r ${z.r_xz.toFixed(2)} / ${z.r_yz.toFixed(2)}); controlling for it, the link ${z.survives ? "holds" : "fades"} (r ${z.partial_r.toFixed(2)})</span></li>`).join("")}</ul>`
      : `<p>No other measure moves strongly with both.</p>`;
    const flags = (pair.flags || []).filter((f) => FLAG_WORDS[f]);
    const flagHtml = flags.length ? `<ul class="rel-flags">${flags.map((f) => `<li>${esc(FLAG_WORDS[f])}</li>`).join("")}</ul>` : "";
    return `
      <div class="rel-evidence-head">
        <h2>Over time</h2>
        <p>${P.gradeChip(pair.grade)} ${P.gradeSentence(pair.grade)}</p>
      </div>
      <div class="rel-cards">
        ${card("Do they move together?", comove, `${pair.n_areas} ${P.areaWord(rel.area_type)}, ${pair.years?.[0]}–${pair.years?.[1]}`)}
        ${card("Which moves first?", lag, "Bars: how changes line up when the second measure is shifted earlier (−) or later (+).")}
        ${card("Is there a natural experiment?", natural)}
        ${card("What else could explain it?", conf + flagHtml)}
      </div>
      <h3 class="rel-sub">The checks behind the grade</h3>
      ${P.checklist(pair.checklist)}
      <p class="rel-muted">This is observational data. A strong grade means the timing and the checks line up with ${esc(xL)} affecting ${esc(yL)}; it doesn't prove it.</p>`;
  }

  // --- the rest -------------------------------------------------------------------------------
  function dataTable(pts, xL, yL) {
    const rows = pts.slice().sort((a, b) => a.x - b.x)
      .map((p) => `<tr><th scope="row"><a href="${esc(p.href)}">${esc(p.name)}</a></th><td>${fmt(p.x)}</td><td>${fmt(p.y)}</td></tr>`).join("");
    return `<details class="compare-table rel-table">
      <summary>Show the ${pts.length} ${esc(P.areaWord(state.area))} as a table</summary>
      <table><thead><tr><th scope="col">Area</th><th scope="col">${esc(xL)}</th><th scope="col">${esc(yL)}</th></tr></thead>
      <tbody>${rows}</tbody></table></details>`;
  }

  async function render() {
    const xId = $("rel-x").value, yId = $("rel-y").value;
    if (!xId || !yId) return;
    if (xId === yId) {
      $("rel-answer").innerHTML = `<p class="rel-muted">Pick two different measures.</p>`;
      return;
    }
    $("rel-answer").innerHTML = `<p class="fd-loading">Loading…</p>`;
    $("rel-evidence").innerHTML = "";

    // The over-time statistics also tell us which geography suits the pair.
    const q = new URLSearchParams({ x: xId, y: yId });
    if (state.areaChosen) q.set("area_type", state.area);
    const rel = await P.fetchJsonOrNull(`/api/metrics/relationship?${q}`);
    if (!state.areaChosen) state.area = rel?.area_type || rel?.default_area_type || "ward";
    P.setSeg("rel-area", state.area);
    syncUrl();
    document.title = `${label(yId)} and ${label(xId)} · Metric relationship · Ward Wise`;

    let data;
    try {
      data = await api.fetchComparison([xId, yId], state.area);
    } catch (_e) {
      $("rel-answer").innerHTML = `<p class="about-error">Couldn't load the two measures.</p>`;
      return;
    }
    const pts = P.scatterPoints(data.rows, xId, yId, state.area, state.markers);
    const xy = pts.map((p) => [p.x, p.y]);
    const r = P.pearson(xy), rho = P.spearman(xy);
    $("rel-answer").innerHTML = `
      <p class="rel-answer-text">${P.answerSentence(r, rho, label(xId), label(yId), pts.length, state.area)}</p>
      <p class="rel-stats">${r == null ? "" : `Pearson r = ${r.toFixed(2)}${rho == null ? "" : ` · Spearman ρ = ${rho.toFixed(2)}`} · ${pts.length} ${esc(P.areaWord(state.area))}`}
        ${rel?.pair ? ` · Over time: ${P.gradeChip(rel.pair.grade)} <a href="#rel-evidence">see why</a>` : ""}</p>`;

    state.dispose?.();
    const trend = r != null && Math.abs(r) >= P.NEGLIGIBLE_R ? P.regression(xy) : null;
    state.dispose = C.scatter($("rel-chart"), {
      points: pts, xLabel: label(xId), yLabel: label(yId), fmt, trend,
      dots: state.area === "chi",
      highlightId: P.myAreaId(state.area),
      highlightFrom: (ward) => P.myAreaId(state.area, ward),
    });
    $("rel-chart-note").innerHTML = state.area === "ward"
      ? (P.myAreaId("ward") ? "Your ward is ringed." : "Pick your ward at the top of the page to ring it here.") + " Dashed lines mark the median area on each measure."
      : "Dashed lines mark the median area on each measure. Select a point to open that area's full report.";

    $("rel-evidence").innerHTML = rel ? evidenceHtml(rel) : `<div class="rel-evidence-head"><h2>Over time</h2></div>
      <p class="rel-muted">The over-time comparison for these measures is still being computed.</p>`;

    $("rel-more").innerHTML = `
      <div class="rel-links">
        <a class="fd-more" href="${esc(P.driversUrl(yId, state.areaChosen ? state.area : ""))}">What tends to move before ${esc(label(yId))}</a>
        <a class="fd-more" href="${esc(P.impactUrl(xId, state.areaChosen ? state.area : ""))}">What tends to move after ${esc(label(xId))}</a>
        <a class="fd-more" href="${esc(P.deepDiveUrl(yId, state.area))}">Deep dive: ${esc(label(yId))}</a>
        <button type="button" class="fd-btn fd-btn-ghost" id="rel-share">Copy share link</button>
      </div>
      ${dataTable(pts, label(xId), label(yId))}
      ${P.methodologyBlock([xId, yId], state.byId)}`;
    $("rel-share")?.addEventListener("click", (e) => P.copyShareLink(e.currentTarget));
    api.track?.("metric_relationship", { metric_x: xId, metric_y: yId, area_type: state.area });
  }

  async function init() {
    try {
      Object.assign(state, await P.loadCatalog());
    } catch (_e) {
      $("rel-answer").innerHTML = `<p class="about-error">Couldn't load the list of measures.</p>`;
      return;
    }
    state.markers = await P.loadMarkers();
    const q = new URLSearchParams(location.search);
    if (["ward", "community_area", "chi"].includes(q.get("area"))) {
      state.area = q.get("area");
      state.areaChosen = true;
    }
    const ids = state.allIds;
    const x = state.byId[q.get("x")] ? q.get("x") : (state.byId.poverty_pct ? "poverty_pct" : ids[0]);
    const y = state.byId[q.get("y")] ? q.get("y") : (state.byId.violent_crime_rate_per_10000 ? "violent_crime_rate_per_10000" : ids.find((id) => id !== x));
    P.fillGroupedSelect($("rel-x"), state.catalog, x);
    P.fillGroupedSelect($("rel-y"), state.catalog, y);
    $("rel-x").addEventListener("change", render);
    $("rel-y").addEventListener("change", render);
    $("rel-swap").addEventListener("click", () => {
      const a = $("rel-x").value;
      $("rel-x").value = $("rel-y").value;
      $("rel-y").value = a;
      render();
    });
    P.wireSeg("rel-area", (value) => { state.area = value; state.areaChosen = true; render(); });
    await render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
