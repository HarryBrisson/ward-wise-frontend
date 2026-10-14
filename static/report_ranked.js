// Driver analysis and impact analysis: one measure, and the other measures that tend to move
// before it (drivers: candidate drivers) or after it (impact: candidate effects), ranked by how well
// the over-time record supports each link. Part of the planner/administrator analysis toolkit.
//
// URL is state: /reports/drivers?metric=<id>[&area=…] and /reports/impact?metric=<id>[&area=…]
// (/reports/causal redirects to /reports/drivers).
// The rankings are precomputed by the pipeline (shared/civic_data/dynamics.py in the API repo):
//   GET /api/metrics/drivers?y=<id>&area_type=…   (drivers)
//   GET /api/metrics/impacts?x=<id>&area_type=…   (impact)
//   GET /api/metrics/dynamics?metric=<id>&area_type=…   (the measure's own over-time facts)
// Each response names its area_type; with no area in the URL the API picks the geography that
// suits the measure (wards for ward-level measures, neighborhoods or χGRIDs for the rest).
(function () {
  "use strict";
  const root = document.getElementById("ranked-view");
  if (!root) return;

  const MODE = root.dataset.mode === "impact" ? "impact" : "drivers";
  const P = window.WardWiseMetricPages;
  const C = window.WardWiseCharts;
  const { esc } = P;

  const state = { catalog: [], labels: {}, byId: {}, area: null, areaChosen: false };
  const $ = (id) => document.getElementById(id);
  const label = (id) => state.labels[id] || id;

  function syncUrl() {
    P.writeQuery({ metric: $("ranked-metric").value, area: state.areaChosen ? state.area : "" });
  }

  // Which of the five checks this pair passed, in words: the grade chip says how strong, this says why.
  function why(item) {
    const r = Number(item.comove_r);
    if (!item.checks) return Number.isFinite(r) ? `r ${r.toFixed(2)}` : "";  // older API: no per-check results
    const passed = Object.fromEntries(item.checks.map((c) => [c.key, c.pass]));
    const bits = [];
    if (passed.comove) bits.push(`moves ${item.comove_r > 0 ? "with" : "against"} it (r ${Number(item.comove_r).toFixed(2)})`);
    else if (Number.isFinite(item.comove_r)) bits.push(`barely moves with it (r ${item.comove_r.toFixed(2)})`);
    if (passed.first) bits.push(MODE === "drivers" ? `moves first, ~${item.lead_k} yr ahead` : `follows ~${item.lead_k} yr later`);
    if (passed.natural) bits.push(MODE === "drivers" ? "it responds to this one's jumps" : "responds to its jumps");
    if (passed.confounders === false) bits.push("explained away by a common factor");
    if (passed.mechanical === false) bits.push("tied by how the data is built");
    return bits.join(" · ");
  }

  function rowHtml(item, metricId) {
    const other = MODE === "drivers" ? item.x : item.y;
    const [x, y] = MODE === "drivers" ? [other, metricId] : [metricId, other];
    return `<li><a href="${esc(P.relationshipUrl(x, y, state.areaChosen ? state.area : ""))}">
      <span class="rel-rank-name">${esc(label(other))}</span>
      ${P.gradeChip(item.grade)}
      ${item.event_path ? C.eventPath(item.event_path, item.event_control) : "<span></span>"}
      <span class="rel-rank-why">${esc(why(item))}</span>
    </a></li>`;
  }

  function factsHtml(facts) {
    if (!facts) return "";
    const f = [];
    if (facts.years?.length) f.push([`${facts.years[0]}–${facts.years[facts.years.length - 1]}`, "years measured"]);
    if (Number.isFinite(facts.n_areas)) f.push([facts.n_areas, P.areaWord(state.area)]);
    if (Number.isFinite(facts.within_share)) f.push([`${Math.round(facts.within_share * 100)}%`, "of its variation is change over time within places"]);
    if (facts.shocks) f.push([facts.shocks.n, `sharp jumps, in ${facts.shocks.n_years} different years`]);
    return `<div class="rel-facts">${f.map(([a, b]) => `<div class="rel-fact"><strong>${esc(a)}</strong><span>${esc(b)}</span></div>`).join("")}</div>`;
  }

  async function render() {
    const metricId = $("ranked-metric").value;
    if (!metricId) return;
    $("ranked-answer").innerHTML = `<p class="fd-loading">Loading…</p>`;
    $("ranked-list").innerHTML = "";
    const q = new URLSearchParams(MODE === "drivers" ? { y: metricId } : { x: metricId });
    if (state.areaChosen) q.set("area_type", state.area);
    const data = await P.fetchJsonOrNull(`/api/metrics/${MODE === "drivers" ? "drivers" : "impacts"}?${q}`);
    if (!state.areaChosen) state.area = data?.area_type || "community_area";
    P.setSeg("ranked-area", state.area);
    syncUrl();
    document.title = `${label(metricId)} · ${MODE === "drivers" ? "Driver" : "Impact"} analysis · Ward Wise`;

    const items = data?.items || [];
    const supported = items.filter((i) => i.grade === "suggestive" || i.grade === "moderate");
    const name = esc(label(metricId));
    if (!data) {
      $("ranked-answer").innerHTML = `<p class="rel-answer-text">${name}</p><p class="rel-muted">The over-time comparisons for this measure are still being computed.</p>`;
    } else if (!items.length) {
      $("ranked-answer").innerHTML = `<p class="rel-answer-text">${name}</p><p class="rel-muted">${esc(data.reason || "There aren't enough years of data for this measure in these areas to compare how it moves with others.")}</p>`;
    } else {
      $("ranked-answer").innerHTML = `<p class="rel-answer-text">${supported.length
        ? `${supported.length} measure${supported.length === 1 ? "" : "s"} tend${supported.length === 1 ? "s" : ""} to move ${MODE === "drivers" ? "before" : "after"} ${name}, with at least suggestive evidence.`
        : `Nothing yet moves ${MODE === "drivers" ? "before" : "after"} ${name} with more than weak evidence. We can't tell what ${MODE === "drivers" ? "drives it" : "it affects"}.`}</p>
        <p class="rel-stats">Across ${esc(P.areaWord(state.area))}. Each row opens the full relationship, with the checks behind its grade.</p>`;
    }
    $("ranked-facts").innerHTML = factsHtml(data?.facts);
    $("ranked-list").innerHTML = items.length
      ? `<h2 class="rel-sub">${MODE === "drivers" ? "Candidate drivers" : "Candidate effects"}</h2><ul class="rel-rank">${items.map((i) => rowHtml(i, metricId)).join("")}</ul>`
      : "";
    $("ranked-more").innerHTML = `<div class="rel-links">
        <a class="fd-more" href="${esc(MODE === "drivers" ? P.impactUrl(metricId, state.areaChosen ? state.area : "") : P.driversUrl(metricId, state.areaChosen ? state.area : ""))}">${MODE === "drivers" ? `What moves after ${name}` : `What moves before ${name}`}</a>
        <a class="fd-more" href="${esc(P.deepDiveUrl(metricId, state.area))}">Deep dive: ${name}</a>
        <button type="button" class="fd-btn fd-btn-ghost" id="ranked-share">Copy share link</button>
      </div>${P.methodologyBlock([metricId], state.byId)}`;
    $("ranked-share")?.addEventListener("click", (e) => P.copyShareLink(e.currentTarget));
    window.WardWiseExplorer?.track?.(`metric_${MODE}_analysis`, { metric_id: metricId, area_type: state.area });
  }

  async function init() {
    try {
      Object.assign(state, await P.loadCatalog());
    } catch (_e) {
      $("ranked-answer").innerHTML = `<p class="about-error">Couldn't load the list of measures.</p>`;
      return;
    }
    const q = new URLSearchParams(location.search);
    if (["ward", "community_area", "chi"].includes(q.get("area"))) {
      state.area = q.get("area");
      state.areaChosen = true;
    }
    const fallback = MODE === "drivers" ? "violent_crime_rate_per_10000" : "menu_total_usd";
    const metric = state.byId[q.get("metric")] ? q.get("metric") : (state.byId[fallback] ? fallback : state.allIds[0]);
    P.fillGroupedSelect($("ranked-metric"), state.catalog, metric);
    $("ranked-metric").addEventListener("change", render);
    P.wireSeg("ranked-area", (value) => { state.area = value; state.areaChosen = true; render(); });
    await render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
