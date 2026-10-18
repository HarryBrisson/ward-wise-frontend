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

  const state = { catalog: [], labels: {}, byId: {}, area: null, areaChosen: false, markers: {}, dispose: null,
    lagMode: "changes", lagSeries: null, lagFor: "", lagPanels: null };
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

  const pct = (v) => `${Math.round(v * 100)}%`;
  const lagWords = (k) => (k ? `with the second ${k} yr later` : "in the same year");

  // One direction's verdict: grade and the checklist (each check's detail carries its test).
  // Rendered twice, side by side: X → Y and Y → X.
  function directionHtml(pair, fromL, toL) {
    if (!pair) {
      return `<div class="rel-dir"><h3>Does ${esc(fromL)} move before ${esc(toL)}?</h3>
        <p class="rel-muted">Not enough overlapping data in this direction.</p></div>`;
    }
    return `<div class="rel-dir">
      <h3>Does ${esc(fromL)} move before ${esc(toL)}?</h3>
      <p>${P.gradeChip(pair.grade)}</p>
      ${P.checklist(pair.checklist, label)}
    </div>`;
  }

  function effectiveN(pair, rel) {
    if (!pair.n_change_years) return "";
    return `effective N ≈ <b>${pair.n_change_years} distinct years</b> (${pair.n_obs.toLocaleString()} area-years in ${pair.n_areas} ${esc(P.areaWord(rel.area_type))}): a shock year counts once however many places it hit`;
  }

  function gapEntry(k) {
    return (state.lagSeries?.agreement?.gaps || []).find((g) => g.k === k) || null;
  }

  function evidenceHtml(rel) {
    const xL = label(rel.x), yL = label(rel.y);
    const pair = rel.pair;
    if (!pair) {
      return `<div class="rel-evidence-head"><h2>Over time</h2></div>
        <p class="rel-muted">${esc(rel.reason || "There isn't enough over-time data for both measures in these areas to look at how they move together.")}</p>`;
    }
    const pp = pair.perm_p || {};
    const k = pair.link_k || 0;
    const gap = gapEntry(k);

    // 1. Do they move together? The correlation, its tests, and a per-year r strip under it.
    const comove = Number.isFinite(pair.link_r)
      ? `<p class="rel-big">r = ${pair.link_r.toFixed(2)}</p>
        <p>${Math.abs(pair.link_r) < 0.2
          ? "When one changes faster than the city in a place, the other barely follows."
          : `When ${esc(xL)} rises faster than the city in a place, ${esc(yL)} tends to ${pair.link_r > 0 ? "rise" : "fall"} too${k ? `, ${k} year${k === 1 ? "" : "s"} later` : ""}.`}</p>
        <ul class="rel-stat-list">
          ${pp.link != null ? `<li>Area shuffle: ${C.pText(pp.link)}${pair.link_fdr ? " (passes the correction for every pair tested)" : " (not significant once every pair tested is counted)"}</li>` : ""}
          ${pair.link_ci ? `<li>95% range resampling whole years: ${pair.link_ci[0].toFixed(2)} to ${pair.link_ci[1].toFixed(2)}</li>` : ""}
          ${k && Number.isFinite(pair.comove_r) ? `<li>Same-year r = ${pair.comove_r.toFixed(2)}${pp.comove != null ? ` (${C.pText(pp.comove)})` : ""}</li>` : ""}
          ${effectiveN(pair, rel) ? `<li>${effectiveN(pair, rel)}</li>` : ""}
        </ul>
        ${pair.rests_on_year ? `<p class="rel-caveat">Rests mostly on <b>${pair.rests_on_year[0]}</b>: without that year, r = ${pair.rests_on_year[1].toFixed(2)}. A shock that hit the same places in both measures that year can do this. It's a caveat, not a reason to drop the grade: see <a href="/reports/methodology#lose-grade">why a pair can lose a grade</a>.</p>` : ""}
        ${gap?.r_by_year?.length ? `<p class="rel-viz-label">Year by year (r ${lagWords(k)})</p>${C.yearRStrip(gap.r_by_year)}` : ""}`
      : `<p class="rel-muted">Not enough overlapping years.</p>`;

    // 2. Which moves first? Lag bars, Granger both ways.
    const g = pair.granger, gr = pair.granger_rev;
    const lag = `${C.lagBars(pair.lag_profile, { leadK: pair.lead_k })}<p>${leadWords(pair, xL, yL)}</p>
      <ul class="rel-stat-list">
        ${g?.p != null ? `<li>${esc(xL)}'s past changes predict ${esc(yL)}'s: Granger ${C.pText(g.p)}${pair.granger_fdr ? " (passes the correction for every pair tested)" : ""}</li>` : ""}
        ${gr?.p != null ? `<li>The other way round: Granger ${C.pText(gr.p)}</li>` : ""}
      </ul>`;

    // 3. Natural experiment: the event path with the shuffled band, and every jump as a dot.
    const ev = pair.event || {};
    const jumps = state.lagSeries?.agreement?.x_jumps || [];
    const jumpYears = new Set(jumps.map((j) => j[1])).size;
    const natural = `${ev.path ? C.eventPath(ev.path, ev.control, ev.band) : ""}
      ${ev.path ? `<p class="rel-viz-key"><i><span class="key-line"></span>${esc(yL)} after a jump</i> <i><span class="key-dash"></span>places without one</i>${ev.band ? ` <i><span class="key-band"></span>jumps given to random other places</i>` : ""}</p>` : ""}
      <p>${ev.n_shocks
        ? `${esc(xL)} jumped sharply ${ev.n_shocks} time${ev.n_shocks === 1 ? "" : "s"} across <b>${ev.n_shock_years || "several"} distinct year${ev.n_shock_years === 1 ? "" : "s"}</b>. ${ev.pretrend ? `${esc(yL)} was already moving before those jumps, which weakens the comparison.` : `${esc(yL)} wasn't already moving beforehand.`}`
        : `${esc(xL)} has no sharp jumps to compare against.`}
      ${Number.isFinite(ev.effect) ? ` Afterwards ${esc(yL)} moved ${ev.effect >= 0 ? "+" : ""}${ev.effect.toFixed(2)} SD${pp.event != null ? ` (area shuffle ${C.pText(pp.event)})` : ""}.` : ""}
      ${Number.isFinite(rel.x_facts?.within_share) ? `${Math.round(rel.x_facts.within_share * 100)}% of its variation is change within places over time rather than differences between places.` : ""}</p>
      ${jumps.length ? `<p class="rel-viz-label">Every jump: one dot per place and year (${jumps.length} jumps, ${jumpYears} years)</p>
        ${C.jumpDots(jumps, { areas: state.lagSeries.areas, years: rel.y_facts && rel.x_facts ? [rel.x_facts.years[0], rel.x_facts.years[1]] : [] })}` : ""}`;

    // 4. Common factor: the table, the formula, what was tried.
    const conf = pair.confounders || [];
    const kWord = k ? `${k} yr later` : "same year";
    const untried = pair.untried || [];
    const untriedHtml = untried.length
      ? `<p class="rel-card-foot">Not tried, for too few years measured alongside these two (5 needed): ${untried.map(([id, ny]) => `${esc(label(id))} (${ny} yr)`).join(", ")}.</p>`
      : "";
    const confHtml = conf.length
      ? `<table class="rel-conf-table"><thead><tr><th scope="col">Measure Z</th><th scope="col" title="r with ${esc(xL)}">r<sub>XZ</sub></th><th scope="col" title="r with ${esc(yL)} (${kWord})">r<sub>YZ</sub></th><th scope="col">partial</th></tr></thead>
          <tbody>${conf.map((z) => `<tr class="${z.survives ? "is-hold" : "is-fade"}"><th scope="row"><a href="${esc(P.relationshipUrl(z.metric_id, rel.y, rel.area_type))}">${esc(label(z.metric_id))}</a>${z.n_years ? `<span>${z.n_years} shared years; r<sub>XY</sub> ${z.r_xy.toFixed(2)} on them</span>` : ""}</th>
            <td>${z.r_xz.toFixed(2)}</td><td>${z.r_yz.toFixed(2)}</td><td>${z.partial_r.toFixed(2)} <span>${z.survives ? "holds" : "fades"}</span></td></tr>`).join("")}</tbody></table>
        <p class="rel-formula">X = ${esc(xL)}, Y = ${esc(yL)}. partial r = (r<sub>XY</sub> − r<sub>XZ</sub>·r<sub>YZ</sub>) / √((1 − r<sub>XZ</sub>²)(1 − r<sub>YZ</sub>²)). All three are taken on the place-years where ${esc(xL)}, ${esc(yL)} and Z are all measured, with Z read alongside ${esc(xL)} and ${esc(yL)} ${kWord}. The link holds if the partial r keeps its sign and at least half the size of r<sub>XY</sub> on those years.</p>
        <p class="rel-card-foot">Tried: the measures (other than relatives of these two) with at least 5 years alongside them whose changes move with both at |r| ≥ 0.3${pair.n_checked ? `, out of ${pair.n_checked} checked` : ""}; the top three are shown.</p>${untriedHtml}`
      : `<p>No other measure moves strongly with both (|r| ≥ 0.3 with each${pair.n_checked ? `, ${pair.n_checked} checked` : ""}).</p>${untriedHtml}`;
    const flags = (pair.flags || []).filter((f) => FLAG_WORDS[f]);
    const flagHtml = flags.length ? `<ul class="rel-flags">${flags.map((f) => `<li>${esc(FLAG_WORDS[f])}</li>`).join("")}</ul>` : "";
    const confTitle = conf.length ? `Survives controlling for ${conf.map((z) => label(z.metric_id)).join(", ")}?` : "What else could explain it?";

    return `
      <div class="rel-evidence-head">
        <h2>Over time</h2>
        <p>${P.gradeChip(pair.grade)} ${P.gradeSentence(pair.grade)}</p>
      </div>
      <h3 class="rel-sub">Both directions</h3>
      <div class="rel-dirs">
        ${directionHtml(pair, xL, yL)}
        ${directionHtml(rel.reverse, yL, xL)}
      </div>
      <h3 class="rel-sub">The evidence behind ${esc(xL)} → ${esc(yL)}</h3>
      <div class="rel-cards">
        ${card("Do they move together?", comove, `${pair.n_areas} ${P.areaWord(rel.area_type)}, ${pair.years?.[0]}–${pair.years?.[1]}`)}
        ${card("Which moves first?", lag, "Bars: how changes line up when the second measure is shifted earlier (−) or later (+).")}
        ${card("Is there a natural experiment?", natural)}
        ${card(confTitle, confHtml + flagHtml)}
      </div>
      <p class="rel-muted">Swap the two measures (⇄) to see these cards for ${esc(yL)} → ${esc(xL)}. This is observational data: evidence, not proof. A strong grade means the timing and the checks line up with ${esc(xL)} affecting ${esc(yL)}; it doesn't prove it. <a href="/reports/methodology">How every check works</a>.</p>`;
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

  // "Every place, every year": the area-years behind the over-time statistics, one small scatter
  // per gap. Fetched once per pair and geography; the Changes/Levels toggle only redraws.
  function lagCountsTable(panels, xL, yL) {
    const levels = state.lagMode === "levels";
    const heads = levels
      ? ["Both high", `${xL} high, ${yL} low`, `${xL} low, ${yL} high`, "Both low"]
      : ["Both up", `${xL} up, ${yL} down`, `${xL} down, ${yL} up`, "Both down"];
    const stats = !levels && panels.some((p) => p.null_mean != null);
    const rows = panels.filter((p) => p.n).map((p) => `<tr><th scope="row">${esc(C.LAG_GAP_LABEL(p.k))}</th>
      ${["both_up", "x_up_y_down", "x_down_y_up", "both_down"].map((q) => `<td>${p.quads[q].toLocaleString()}</td>`).join("")}
      <td>${p.same == null ? "–" : pct(p.same)}</td><td>${p.quads.tie.toLocaleString()}</td>
      ${stats ? `<td>${p.null_mean == null ? "–" : pct(p.null_mean)}</td><td>${p.p == null ? "–" : C.pText(p.p).replace("p ", "")}${p.sig ? " ✓" : ""}</td>
        <td>${p.ci ? `${pct(p.ci[0])}–${pct(p.ci[1])}` : "–"}</td><td>${p.n_years ?? "–"}</td>` : ""}</tr>`).join("");
    return `<details class="compare-table rel-table">
      <summary>Show the counts and tests behind each panel</summary>
      <table><thead><tr><th scope="col">Gap</th>${heads.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}
        <th scope="col">Same ${levels ? "side" : "way"}</th><th scope="col">${levels ? "On a middle line" : "No change"}</th>
        ${stats ? `<th scope="col">Shuffled places</th><th scope="col">p</th><th scope="col">95% range (years resampled)</th><th scope="col">Distinct years</th>` : ""}</tr></thead>
      <tbody>${rows}</tbody></table></details>`;
  }

  // The gap whose share sits furthest from what shuffled places give (smallest p), else gap 0.
  function focusGap(panels) {
    const tested = panels.filter((p) => p.p != null);
    if (!tested.length) return 0;
    return tested.reduce((a, b) => (b.p < a.p ? b : a)).k;
  }

  function drawContrib(k) {
    const panel = (state.lagPanels || []).find((p) => p.k === k);
    const box = $("rel-contrib");
    if (!box || !panel) return;
    const top = (panel.by_year || []).reduce((a, b) => (b[1] + b[2] > a[1] + a[2] ? b : a), [null, 0, 0]);
    const total = (panel.by_year || []).reduce((n, r) => n + r[1] + r[2], 0);
    box.innerHTML = panel.by_year?.length
      ? `${C.yearContribBars(panel.by_year)}
        <p class="rel-viz-key"><i><span class="key-same"></span>moved the same way</i> <i><span class="key-opp"></span>opposite ways</i>
          <i>· busiest year ${top[0]} (${Math.round(((top[1] + top[2]) / (total || 1)) * 100)}% of the area-years)</i></p>
        ${panel.drop ? `<p class="rel-contrib-note">${panel.rests_on_year ? "<b>Rests mostly on one year.</b> " : ""}Without ${panel.drop[0]}, the year that matters most here, the share would be ${pct(panel.drop[1])} (shuffled places: ${pct(panel.null_mean)}).</p>` : ""}`
      : `<p class="rel-muted">No year-by-year counts at this gap.</p>`;
  }

  function drawLag(xId, yId) {
    const xL = label(xId), yL = label(yId);
    const levels = state.lagMode === "levels";
    $("rel-lag-intro").textContent = levels
      ? `Each dot is one place in one year: ${xL} that year across, ${yL} up to five years before or after going up. The lines mark the middle of each.`
      : `Each dot is one place in one year. Across: how much ${xL} changed that year compared with the city. Up: how much ${yL} changed, also compared with the city, in the same year or up to five years before or after. Blue dots moved the same way; orange moved opposite ways.`;
    const panels = P.lagPanels(state.lagSeries, state.lagMode);
    state.lagPanels = panels;
    if (!panels || !panels.some((p) => p.n >= 10)) {
      $("rel-lag-body").innerHTML = `<p class="rel-muted">These two don't share enough measured years in these ${esc(P.areaWord(state.area))} to plot.</p>`;
      return;
    }
    const highlightId = P.myAreaId(state.area);
    const tested = !levels && panels.some((p) => p.null_mean != null);
    const sig = panels.filter((p) => p.sig);
    const k0 = focusGap(panels);
    const g0 = panels.find((p) => p.k === 0);
    $("rel-lag-body").innerHTML = `
      ${tested ? `<p class="rel-lag-verdict">${sig.length
        ? `Beyond what shuffled places give, after correcting for eleven gaps: <b>${sig.map((p) => esc(C.LAG_GAP_LABEL(p.k)) + (p.rests_on_year ? ` (mostly ${p.drop[0]})` : "")).join(", ")}</b>.`
        : "<b>No gap stands out</b> from what shuffled places give, once eleven gaps are accounted for."}
        ${g0?.n_years ? ` Effective N ≈ <b>${g0.n_years} distinct years</b>, not ${g0.n.toLocaleString()} area-years: one shock year is one observation however many places it hits.` : ""}</p>` : ""}
      ${C.lagGrid(panels, { mode: state.lagMode, highlightId, xLabel: xL, yLabel: yL })}
      <div class="rel-lag-summary">
        ${C.lagShareStrip(panels, { mode: state.lagMode })}
        <div>
        <p>${levels
          ? "Share of place-years where both measures sit on the same side of the middle, at each gap. Levels mostly show which places are high or low on both, a fact about places that barely changes with the gap. No test is run on levels."
          : tested
            ? `Dots: the share of place-years where both moved the same way at each gap; whiskers: its 95% range when whole years are resampled. Grey bands: what you get by pairing each place's ${esc(xL)} with a randomly drawn <em>other</em> place's ${esc(yL)}, ${(state.lagSeries.agreement.draws || 1000).toLocaleString()} times. That keeps every shared shock year (a citywide shock moves every place at once) and breaks only the place-to-place link, so a share is only notable when it leaves the band, not when it leaves 50%.`
            : "Share of place-years where both moved the same way, at each gap. Half is what two unrelated measures would show. If one measure leads the other, the share should be furthest from half at a gap above zero."}
          ${highlightId ? " Your ward's dots are ringed." : ""}</p>
        </div>
      </div>
      ${tested ? `<div class="rel-contrib-wrap">
        <div class="rel-contrib-head"><h3>Which years carry it?</h3>
          <label>Gap <select id="rel-contrib-k">${panels.filter((p) => p.by_year?.length).map((p) => `<option value="${p.k}"${p.k === k0 ? " selected" : ""}>${esc(C.LAG_GAP_LABEL(p.k))}</option>`).join("")}</select></label></div>
        <div id="rel-contrib"></div></div>` : ""}
      ${lagCountsTable(panels, xL, yL)}
      <p class="rel-chart-note">This is the raw material behind "Which moves first?" below. Only measured years count: carried-forward values and the year in progress are left out, as in the statistics. Census 5-year estimates overlap from one year to the next, so their year-to-year changes are smoothed. <a href="/reports/methodology#agreement">How the share is tested</a>.</p>`;
    if (tested) {
      drawContrib(k0);
      $("rel-contrib-k")?.addEventListener("change", (e) => drawContrib(Number(e.target.value)));
    }
  }

  async function loadSeries(xId, yId) {
    const key = `${xId}|${yId}|${state.area}`;
    if (state.lagFor !== key) {
      const q = new URLSearchParams({ x: xId, y: yId, area_type: state.area });
      state.lagSeries = await P.fetchJsonOrNull(`/api/metrics/pair-series?${q}`);
      state.lagFor = key;
    }
    return state.lagSeries;
  }

  function renderLag(xId, yId) {
    if (!state.lagSeries) {
      $("rel-lag-intro").textContent = "";
      $("rel-lag-body").innerHTML = `<p class="rel-muted">The year-by-year rows for these two measures aren't available in these ${esc(P.areaWord(state.area))}: at least one has fewer than five measured years here.</p>`;
      return;
    }
    drawLag(xId, yId);
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

    const seriesReady = loadSeries(xId, yId);
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

    // The year-by-year rows (and the agreement statistics) feed both the grid and the cards' visuals.
    $("rel-lag-body").innerHTML = `<p class="fd-loading">Loading…</p>`;
    await seriesReady;
    if ($("rel-x").value !== xId || $("rel-y").value !== yId) return;  // the reader moved on
    renderLag(xId, yId);

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
    P.wireSeg("rel-lag-mode", (value) => {
      state.lagMode = value;
      if (state.lagSeries) drawLag($("rel-x").value, $("rel-y").value);
    });
    await render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
