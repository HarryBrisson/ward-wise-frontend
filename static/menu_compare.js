// Menu money · Compare: two to five wards side by side, category by category, for one year —
// plus every ward's value for one category, so a "4% vs 24%" can be seen against all fifty.
// URL is state: /menu/compare?wards=40,50&year=2023&metric=share|cost&category=
(function () {
  "use strict";
  const M = window.WardWiseMenu;
  const root = document.getElementById("mh-compare");
  if (!root) return;
  const esc = M.esc;
  const MAX_WARDS = 5;
  const state = { data: null, wards: [], year: null, metric: "share", category: null };

  function readUrl() {
    const params = new URLSearchParams(window.location.search);
    state.wards = (params.get("wards") || "").split(",").map(Number).filter((w) => w >= 1 && w <= 50);
    state.wards = [...new Set(state.wards)].slice(0, MAX_WARDS);
    state.year = Number(params.get("year")) || null;
    state.metric = params.get("metric") === "cost" ? "cost" : "share";
    state.category = params.get("category") || null;
  }

  function writeUrl() {
    M.setUrl("/menu/compare", { wards: state.wards.join(","), year: state.year,
      metric: state.metric === "share" ? null : "cost", category: state.category });
  }

  function value(ward, category) {
    const cell = (((state.data.cells || {})[String(state.year)] || {})[String(ward)] || {})[category];
    if (!cell) return 0;
    return state.metric === "share" ? cell[1] : cell[0];
  }
  const fmt = (v) => (state.metric === "share" ? M.pct(v) : M.money(v));

  function render() {
    const data = state.data;
    const average = M.averageShares(data, state.year);
    const yearCells = (data.cells || {})[String(state.year)] || {};
    const categories = (data.categories || []).filter((cat) => Object.values(yearCells).some((cells) => cells[cat]));
    // Order rows by the selected wards' combined spending, so the comparison leads with what matters.
    categories.sort((a, b) => state.wards.reduce((s, w) => s + value(w, b), 0) - state.wards.reduce((s, w) => s + value(w, a), 0));
    if (!state.category || !categories.includes(state.category)) state.category = categories[0] || null;
    const neighbors = state.wards.length === 1
      ? ((window.K3_NEIGHBORS || {})[String(state.wards[0]).padStart(2, "0")] || []).map(Number) : [];

    const chips = state.wards.map((w) => `<span class="mh-ward-chip">Ward ${w}<button type="button" data-remove="${w}" aria-label="Remove ward ${w}">×</button></span>`).join("");
    const controls = `
      <div class="ed-controls">
        <div class="mh-ward-chips">${chips}${state.wards.length < MAX_WARDS ? `<label class="report-select">Add <select id="mh-add"><option value="">ward…</option>${M.wardOptions(null)}</select></label>` : ""}</div>
        <label class="report-select">Year <select id="mh-year">${M.yearOptions(data, state.year)}</select></label>
        <div class="mh-toggle" role="group" aria-label="Show">
          <button type="button" data-metric="share" aria-pressed="${state.metric === "share"}">Share</button>
          <button type="button" data-metric="cost" aria-pressed="${state.metric === "cost"}">Dollars</button>
        </div>
      </div>
      ${neighbors.length ? `<p class="mh-note">Add its neighbors: ${neighbors.map((n) => `<button type="button" class="ww-linkbtn" data-add="${n}">Ward ${n}</button>`).join(" ")}</p>` : ""}
      ${M.isPartial(data, state.year) ? `<p class="mh-note">${state.year} is a partial year (year-to-date).</p>` : ""}`;

    if (!state.wards.length) {
      root.innerHTML = `${controls}<p class="report-empty">Pick two or more wards to compare.</p><div id="mh-cite"></div>`;
      bind();
      return;
    }

    const head = `<tr><th>Category</th>${state.wards.map((w) => `<th class="num"><a href="/menu/ward?ward=${w}&year=${state.year}">Ward ${w}</a></th>`).join("")}${state.metric === "share" ? '<th class="num mh-avg">Average ward</th>' : ""}</tr>`;
    const totals = `<tr class="mh-total"><th>Total spent</th>${state.wards.map((w) => `<td class="num">${M.money((M.wardTotal(data, w, state.year) || {}).total)}</td>`).join("")}${state.metric === "share" ? "<td></td>" : ""}</tr>`;
    const body = categories.map((cat) => {
      const values = state.wards.map((w) => value(w, cat));
      const hi = Math.max(...values);
      return `<tr class="${cat === state.category ? "is-active" : ""}">
        <th><button type="button" class="mh-rowbtn" data-category="${esc(cat)}"><span class="mh-chip tone-${M.tone(cat)}">${esc(M.shortName(cat))}</span> ${esc(cat)}</button></th>
        ${values.map((v) => `<td class="num${v === hi && hi > 0 && values.length > 1 ? " mh-hi" : ""}"><span class="mh-cellbar tone-${M.tone(cat)}" style="--w:${state.metric === "share" ? v : (100 * v) / Math.max(1, ...categories.flatMap((c) => state.wards.map((w) => value(w, c))))}%"></span>${fmt(v)}</td>`).join("")}
        ${state.metric === "share" ? `<td class="num mh-avg">${M.pct(average[cat])}</td>` : ""}
      </tr>`;
    }).join("");

    root.innerHTML = `${controls}
      <div class="mh-table-wrap"><table class="mh-table mh-compare-table"><thead>${head}</thead><tbody>${totals}${body}</tbody></table></div>
      <section class="mh-strip-section" aria-label="Every ward">
        <p class="ed-section-label">Every ward, ${esc(state.category || "")} ${state.metric === "share" ? "share" : "dollars"}, ${state.year}</p>
        ${strip()}
        <p class="mh-note">Click a category row above to change this strip. Highlighted bars are the wards you picked.</p>
      </section>
      <div id="mh-cite"></div>`;
    bind();
  }

  function strip() {
    if (!state.category) return "";
    const rows = [];
    for (let w = 1; w <= 50; w += 1) rows.push({ ward: w, v: value(w, state.category) });
    rows.sort((a, b) => b.v - a.v);
    const max = Math.max(1e-9, ...rows.map((r) => r.v));
    const picked = new Set(state.wards);
    return `<ol class="mh-strip tone-${M.tone(state.category)}">${rows.map((r, i) => `
      <li class="${picked.has(r.ward) ? "is-picked" : ""}" title="Ward ${r.ward}: ${fmt(r.v)} (#${i + 1} of 50)">
        <span class="mh-strip-bar" style="height:${Math.max(1, (100 * r.v) / max)}%"></span>
        ${picked.has(r.ward) ? `<span class="mh-strip-label">${r.ward}<br>${fmt(r.v)}</span>` : ""}
      </li>`).join("")}</ol>`;
  }

  function bind() {
    const add = root.querySelector("#mh-add");
    if (add) add.addEventListener("change", (e) => addWard(Number(e.target.value)));
    root.querySelector("#mh-year").addEventListener("change", (e) => { state.year = Number(e.target.value); writeUrl(); render(); });
    root.querySelectorAll("[data-metric]").forEach((b) => b.addEventListener("click", () => { state.metric = b.dataset.metric; writeUrl(); render(); }));
    root.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
      state.wards = state.wards.filter((w) => w !== Number(b.dataset.remove)); writeUrl(); render();
    }));
    root.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => addWard(Number(b.dataset.add))));
    root.querySelectorAll("[data-category]").forEach((b) => b.addEventListener("click", () => { state.category = b.dataset.category; writeUrl(); render(); }));
    const label = state.wards.length ? `Wards ${state.wards.join(", ")}, ${state.year}, ${state.metric === "share" ? "share of spending" : "dollars"} by category` : "Compare wards";
    M.renderCite(root.querySelector("#mh-cite"), state.data.release, label);
  }

  function addWard(ward) {
    if (ward && !state.wards.includes(ward) && state.wards.length < MAX_WARDS) state.wards.push(ward);
    writeUrl();
    render();
  }

  readUrl();
  M.summary().then((data) => {
    state.data = data;
    if (!M.years(data).includes(state.year)) state.year = M.defaultYear(data);
    writeUrl();
    render();
  }).catch((error) => M.unavailable(root, error));
})();
