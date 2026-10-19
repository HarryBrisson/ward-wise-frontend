// Menu money hub: what every /menu/* tab shares — the data calls, formatting, category tones, and
// the "cite this view" block. The data come from the public release
// (github.com/HarryBrisson/ward-wise-menu-data); every payload names the commit it came from, and
// the citation quotes it, so a number on the page can be traced to a row in a CSV.
window.WardWiseMenu = (function () {
  "use strict";

  const esc = (t) => WardWiseExplorer.escapeHtml(t == null ? "" : String(t));
  const DATA_REPO = "https://github.com/HarryBrisson/ward-wise-menu-data";

  // Category -> tone index into the --menu-cat-N tokens (same palette as the overview page).
  const TONES = {
    "Street Resurfacing": 1, "Lighting": 2, "Sidewalk Repair": 3, "Alleys": 4, "Parks": 5,
    "Cameras": 6, "Schools": 7, "Pedestrian Infrastructure": 8, "Bicycle Infrastructure": 8,
    "Street Redesign": 8,
  };
  const SHORT = {
    "Street Resurfacing": "Streets", "Sidewalk Repair": "Sidewalks", "Pedestrian Infrastructure": "Pedestrian",
    "Bicycle Infrastructure": "Bike", "Misc. CDOT": "Misc. CDOT", "Traffic Signals": "Signals",
  };
  const tone = (category) => TONES[category] || "other";
  const shortName = (category) => SHORT[category] || category;

  let summaryPromise = null;
  let pricePromise = null;

  function summary() {
    summaryPromise = summaryPromise || WardWiseExplorer.fetchJson("/api/menu/summary", "Unable to load menu data.");
    return summaryPromise;
  }

  function prices() {
    pricePromise = pricePromise || WardWiseExplorer.fetchJson("/api/menu/price-list", "Unable to load the price list.");
    return pricePromise;
  }

  function items({ ward, year, category } = {}) {
    const params = new URLSearchParams();
    if (ward) params.set("ward", String(Number(ward)));
    if (year) params.set("year", String(year));
    if (category) params.set("category", category);
    return WardWiseExplorer.fetchJson(`/api/menu/items?${params}`, "Unable to load line items.");
  }

  // Years with ward data, ascending; the newest COMPLETE year is the default view.
  function years(data) {
    return Object.keys(data.ward_year || {}).map(Number).sort((a, b) => a - b);
  }
  function isPartial(data, year) {
    const wards = (data.ward_year || {})[String(year)] || {};
    return Object.values(wards).some((row) => row[3]);
  }
  function defaultYear(data) {
    const all = years(data);
    const complete = all.filter((y) => !isPartial(data, y));
    return (complete.length ? complete : all).pop();
  }

  // {category: {cost, share, projects}} for one ward-year, largest first.
  function wardCells(data, ward, year) {
    const cells = ((data.cells || {})[String(year)] || {})[String(Number(ward))] || {};
    return Object.entries(cells)
      .map(([category, [cost, share, projects]]) => ({ category, cost, share, projects }))
      .sort((a, b) => b.cost - a.cost);
  }
  function wardTotal(data, ward, year) {
    const row = ((data.ward_year || {})[String(year)] || {})[String(Number(ward))];
    return row ? { total: row[0], projects: row[1], pctOfAllotment: row[2], partial: row[3] } : null;
  }
  // Unweighted mean share across wards with spending that year (what "the average ward" means here).
  function averageShares(data, year) {
    const wards = Object.values((data.cells || {})[String(year)] || {});
    const sums = {};
    wards.forEach((cells) => Object.entries(cells).forEach(([cat, [, share]]) => { sums[cat] = (sums[cat] || 0) + (share || 0); }));
    const n = wards.length || 1;
    return Object.fromEntries(Object.entries(sums).map(([cat, s]) => [cat, s / n]));
  }

  const money = (v) => (v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${Math.round(v / 1e3).toLocaleString()}k` : `$${Math.round(v).toLocaleString()}`);
  const moneyExact = (v) => (v == null ? "—" : `$${Math.round(v).toLocaleString()}`);
  const pct = (v, digits = 1) => (v == null ? "—" : `${Number(v).toFixed(digits)}%`);

  function yearOptions(data, selected) {
    return years(data).slice().reverse()
      .map((y) => `<option value="${y}"${y === selected ? " selected" : ""}>${y}${isPartial(data, y) ? " (partial)" : ""}</option>`)
      .join("");
  }
  function wardOptions(selected) {
    let html = "";
    for (let w = 1; w <= 50; w += 1) html += `<option value="${w}"${w === Number(selected) ? " selected" : ""}>Ward ${w}</option>`;
    return html;
  }

  function releaseLabel(release) {
    if (!release) return "";
    const ref = release.ref && release.ref !== "local" ? release.ref.slice(0, 7) : "local build";
    return release.version ? `release v${release.version} (${ref})` : ref;
  }
  function releaseUrl(release) {
    return (release && release.url) || DATA_REPO;
  }

  // The citation for exactly what's on screen: the view, its filters, the page URL, the release.
  function citation(release, viewLabel) {
    const url = window.location.href.replace(/^http:\/\/localhost:\d+/, "https://www.wardwise.org");
    const accessed = new Date().toISOString().slice(0, 10);
    return `Ward Wise, "Menu money: ${viewLabel}," ${url} (accessed ${accessed}). `
      + `Data: Chicago Aldermanic Menu spending, ${releaseLabel(release)}, ${releaseUrl(release)}. `
      + `Source: City of Chicago Office of Budget and Management menu postings.`;
  }

  function renderCite(container, release, viewLabel) {
    if (!container) return;
    const text = citation(release, viewLabel);
    container.innerHTML = `
      <details class="mh-cite">
        <summary>Cite this view</summary>
        <p class="mh-cite-text" id="mh-cite-text">${esc(text)}</p>
        <p class="mh-cite-actions">
          <button type="button" class="ww-linkbtn" data-copy-cite>Copy citation</button>
          <a href="${esc(releaseUrl(release))}" rel="noopener">Download the data (CSV) on GitHub</a>
          <a href="/menu/data">How to cite &amp; methods</a>
        </p>
      </details>`;
    const button = container.querySelector("[data-copy-cite]");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
      } catch (_error) {
        window.getSelection().selectAllChildren(container.querySelector(".mh-cite-text"));
      }
    });
  }

  function setUrl(path, params) {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString();
    window.history.replaceState(null, "", `${path}${query ? `?${query}` : ""}`);
  }

  function unavailable(container, error) {
    container.innerHTML = `<p class="report-empty">The menu data could not be loaded${error && error.message ? ` (${esc(error.message)})` : ""}.
      The full dataset is always available on <a href="${DATA_REPO}">GitHub</a>.</p>`;
  }

  // Horizontal share bars: rows [{category, value, label, sub}], max = 100 for shares.
  function bars(rows, { max = 100, onClickAttr = null, active = null } = {}) {
    return `<ol class="mh-bars">${rows.map((row) => `
      <li class="mh-bar tone-${tone(row.category)}${row.category === active ? " is-active" : ""}">
        ${onClickAttr ? `<button type="button" ${onClickAttr}="${esc(row.category)}" aria-expanded="${row.category === active}">` : "<div>"}
          <span class="mh-bar-label">${esc(row.label || row.category)}</span>
          <span class="mh-bar-track"><span class="mh-bar-fill" style="width:${Math.max(0.5, Math.min(100, (100 * (row.value || 0)) / max))}%"></span>${row.marker != null ? `<span class="mh-bar-marker" style="left:${Math.min(100, (100 * row.marker) / max)}%" title="Average ward"></span>` : ""}</span>
          <span class="mh-bar-value">${esc(row.valueLabel)}</span>
          ${row.sub ? `<span class="mh-bar-sub">${esc(row.sub)}</span>` : ""}
        ${onClickAttr ? "</button>" : "</div>"}
      </li>`).join("")}</ol>`;
  }

  // ---- year ranges + era ward maps (map and compare views) ----

  // The ward map in force for a menu year (new maps seated May 2015 and May 2023).
  const wardMap = (year) => (year >= 2023 ? 2023 : year >= 2015 ? 2015 : 2003);
  const eraCache = {};
  function eraWards(era) {
    eraCache[era] = eraCache[era] || WardWiseExplorer.fetchJson(`/static/wards/wards_${era}.geojson`, "Unable to load ward boundaries.");
    return eraCache[era];
  }

  // ?from=&to= (or the older ?year=) → an ordered pair of available years. Default: the newest
  // complete year on its own.
  function readRange(params, data) {
    const all = years(data);
    const clamp = (y) => (all.includes(y) ? y : null);
    let from = clamp(Number(params.get("from"))), to = clamp(Number(params.get("to")));
    const single = clamp(Number(params.get("year")));
    if (!from && !to && single) from = to = single;
    if (!to) to = from || defaultYear(data);
    if (!from) from = to;
    if (from > to) [from, to] = [to, from];
    return { from, to };
  }
  const rangeYears = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const rangeLabel = (from, to) => (from === to ? String(from) : `${from}–${to}`);
  const rangeParams = (from, to) => (from === to ? { year: from } : { from, to });
  const rangePartial = (data, from, to) => rangeYears(from, to).some((y) => isPartial(data, y));

  function rangeControls(data, from, to, idPrefix) {
    const opts = (sel) => years(data).slice().reverse()
      .map((y) => `<option value="${y}"${y === sel ? " selected" : ""}>${y}${isPartial(data, y) ? " (partial)" : ""}</option>`).join("");
    return `<label class="report-select">From <select id="${idPrefix}-from">${opts(from)}</select></label>
      <label class="report-select">Through <select id="${idPrefix}-to">${opts(to)}</select></label>`;
  }
  function bindRange(root, idPrefix, onChange) {
    const fromEl = root.querySelector(`#${idPrefix}-from`), toEl = root.querySelector(`#${idPrefix}-to`);
    const fire = (changed) => {
      let from = Number(fromEl.value), to = Number(toEl.value);
      if (from > to) { if (changed === "from") to = from; else from = to; }
      onChange(from, to);
    };
    fromEl.addEventListener("change", () => fire("from"));
    toEl.addEventListener("change", () => fire("to"));
  }

  // Cumulative spending over a range: {ward: {category: [cost, share_pct, projects]}}, shares of the
  // ward's total across the whole range (dollars summed first, then divided — not an average of shares).
  function rangeCells(data, from, to) {
    const out = {};
    rangeYears(from, to).forEach((y) => {
      Object.entries((data.cells || {})[String(y)] || {}).forEach(([ward, cats]) => {
        const w = (out[ward] = out[ward] || {});
        Object.entries(cats).forEach(([cat, [cost, , n]]) => {
          const c = (w[cat] = w[cat] || [0, 0, 0]);
          c[0] += cost || 0; c[2] += n || 0;
        });
      });
    });
    Object.values(out).forEach((cats) => {
      const total = Object.values(cats).reduce((s, c) => s + c[0], 0);
      Object.values(cats).forEach((c) => { c[1] = total > 0 ? (100 * c[0]) / total : 0; });
    });
    return out;
  }
  function rangeTotal(data, ward, from, to) {
    let total = 0, projects = 0, seen = false;
    rangeYears(from, to).forEach((y) => {
      const row = ((data.ward_year || {})[String(y)] || {})[String(Number(ward))];
      if (row) { total += row[0] || 0; projects += row[1] || 0; seen = true; }
    });
    return seen ? { total, projects } : null;
  }

  return {
    wardMap, eraWards, readRange, rangeYears, rangeLabel, rangeParams, rangePartial, rangeControls, bindRange,
    rangeCells, rangeTotal,
    esc, tone, shortName, summary, prices, items, years, isPartial, defaultYear, wardCells, wardTotal,
    averageShares, money, moneyExact, pct, yearOptions, wardOptions, releaseLabel, releaseUrl,
    renderCite, setUrl, unavailable, bars, DATA_REPO,
  };
})();
