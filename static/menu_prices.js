// Menu money · Price list: what each menu item costs a ward, with every price's source shown.
// The release keeps one row per (item, year, source); a card shows the latest well-sourced price
// and the item's price history, and ?item=<slug> opens every row with its document and page.
(function () {
  "use strict";
  const M = window.WardWiseMenu;
  const root = document.getElementById("mh-prices");
  if (!root) return;
  const esc = M.esc;

  // Strongest first. The label is what a reader sees; the blurb says what the label means.
  const SOURCES = {
    primary_document: { rank: 0, label: "City price list", blurb: "A price sheet issued by CDOT or OBM." },
    official_secondary: { rank: 1, label: "City audit (quoting CDOT)", blurb: "CDOT's prices as reproduced in an official city document, the 2017 Inspector General audit." },
    ward_wise_2023_unverified: { rank: 2, label: "CDOT 2023 packet (unverified copy)", blurb: "CDOT's 2023 Aldermanic Menu packet, known from a copy kept by Ward Wise volunteers; no city-hosted copy found." },
    derived: { rank: 3, label: "Derived from spending records", blurb: "The fixed price that recurs across the city's own spending postings that year (the most common line-item cost)." },
    ward_office_secondary: { rank: 4, label: "Ward office posting", blurb: "A price table a ward office posted for participatory budgeting; rounded, year approximate." },
  };
  const sourceOf = (row) => SOURCES[row.verification] || { rank: 9, label: row.verification || "unknown", blurb: "" };

  function group(rows) {
    const items = {};
    rows.forEach((row) => { (items[row.item_slug] = items[row.item_slug] || []).push(row); });
    return Object.entries(items).map(([slug, list]) => {
      list.sort((a, b) => (a.menu_year || 0) - (b.menu_year || 0) || sourceOf(a).rank - sourceOf(b).rank);
      // Headline: newest year among the three strongest source types; else newest anything.
      const strong = list.filter((r) => sourceOf(r).rank <= 2);
      const headline = (strong.length ? strong : list).reduce((best, r) => (
        !best || r.menu_year > best.menu_year || (r.menu_year === best.menu_year && sourceOf(r).rank < sourceOf(best).rank) ? r : best), null);
      const name = (list.find((r) => r.verification === "ward_wise_2023_unverified") || headline).item;
      return { slug, name, list, headline, visionZero: list.some((r) => r.vision_zero) };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  const priceText = (row) => `${M.moneyExact(row.display_unit_cost ?? row.unit_cost)} per ${esc(row.display_unit || row.unit)}`;

  // One point per year (strongest source that year), as a tiny SVG.
  function history(list) {
    const byYear = {};
    list.forEach((r) => {
      if (r.menu_year == null || r.unit_cost == null) return;
      const cur = byYear[r.menu_year];
      if (!cur || sourceOf(r).rank < sourceOf(cur).rank) byYear[r.menu_year] = r;
    });
    const pts = Object.values(byYear).sort((a, b) => a.menu_year - b.menu_year);
    // Only plot rows in one unit, the headline's, so a per-pole price never sits beside a per-block one.
    const unit = pts.length ? pts[pts.length - 1].unit : null;
    const same = pts.filter((p) => p.unit === unit);
    if (same.length < 2) return "";
    const w = 160, h = 40, pad = 4;
    const x0 = same[0].menu_year, x1 = same[same.length - 1].menu_year;
    const ys = same.map((p) => p.unit_cost);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const sx = (x) => pad + ((w - 2 * pad) * (x - x0)) / Math.max(1, x1 - x0);
    const sy = (y) => h - pad - ((h - 2 * pad) * (y - lo)) / Math.max(1, hi - lo);
    const path = same.map((p, i) => `${i ? "L" : "M"}${sx(p.menu_year).toFixed(1)},${sy(p.unit_cost).toFixed(1)}`).join("");
    const change = ((ys[ys.length - 1] / ys[0]) - 1) * 100;
    return `<figure class="mp-history">
      <svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5"/>
        ${same.map((p) => `<circle cx="${sx(p.menu_year).toFixed(1)}" cy="${sy(p.unit_cost).toFixed(1)}" r="2.2" class="mp-dot mp-${esc(p.verification)}"/>`).join("")}</svg>
      <figcaption>${x0}–${x1}: ${change >= 0 ? "+" : ""}${change.toFixed(0)}% per ${esc(unit)} (${same.length} years)</figcaption>
    </figure>`;
  }

  function card(item) {
    const src = sourceOf(item.headline);
    return `<li class="mp-card">
      <a href="/menu/prices?item=${encodeURIComponent(item.slug)}">
        <h3>${esc(item.name)}</h3>
        <p class="mp-price">${priceText(item.headline)}</p>
        <p class="mp-meta">${item.headline.menu_year} · <span class="mp-src mp-${esc(item.headline.verification)}">${esc(src.label)}</span>${item.visionZero ? ' · <span class="mp-vz">Vision Zero</span>' : ""}</p>
        ${item.headline.conversion_note ? `<p class="mp-conv">${esc(item.headline.conversion_note)}</p>` : ""}
        ${history(item.list)}
      </a>
    </li>`;
  }

  function detail(item, release) {
    const latest = item.list.filter((r) => r.description).pop();
    root.innerHTML = `
      <p><a href="/menu/prices">← All menu items</a></p>
      <h2 class="mp-title">${esc(item.name)}${item.visionZero ? ' <span class="mp-vz">Vision Zero</span>' : ""}</h2>
      <p class="mp-price">${priceText(item.headline)} <span class="mp-meta">(${item.headline.menu_year}, ${esc(sourceOf(item.headline).label)})</span></p>
      ${latest ? `<p class="mp-desc">${esc(latest.description)}</p>` : ""}
      ${history(item.list)}
      <p><a href="/menu/costs?type=${encodeURIComponent(item.slug)}">What wards actually paid for this →</a> <span class="mp-meta">(every project, cheapest to most expensive)</span></p>
      <p class="ed-section-label">Every price we have, with its source</p>
      <div class="mh-table-wrap"><table class="mh-table">
        <thead><tr><th>Year</th><th class="num">Price</th><th>Unit</th><th>Source</th><th>Where in it</th><th>Notes</th></tr></thead>
        <tbody>${item.list.slice().reverse().map((r) => `<tr>
          <td>${r.menu_year ?? "—"}</td>
          <td class="num">${M.moneyExact(r.unit_cost)}${r.display_unit_cost != null && r.display_unit_cost !== r.unit_cost ? `<br><span class="mp-meta">${M.moneyExact(r.display_unit_cost)}/${esc(r.display_unit)}</span>` : ""}</td>
          <td>${esc(r.unit)}</td>
          <td><span class="mp-src mp-${esc(r.verification)}">${esc(sourceOf(r).label)}</span><br>${r.source_url ? `<a href="${esc(r.source_url)}" rel="noopener">${esc(r.source_document || "document")}</a>` : esc(r.source_document || "")}</td>
          <td>${esc(r.source_page || "")}</td>
          <td>${esc([r.conversion_note, r.notes].filter(Boolean).join(" "))}</td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div id="mh-cite"></div>`;
    M.renderCite(root.querySelector("#mh-cite"), release, `price history, ${item.name}`);
  }

  function legend() {
    return `<details class="mp-legend"><summary>Where these prices come from</summary><dl>${Object.entries(SOURCES).map(([key, s]) =>
      `<dt><span class="mp-src mp-${key}">${esc(s.label)}</span></dt><dd>${esc(s.blurb)}</dd>`).join("")}</dl>
      <p>The city does not publish the menu's price sheet. Each price above is labeled with the strongest source we found. Full sourcing notes are in the
      <a href="${M.DATA_REPO}/blob/main/data/infrastructure_menu_SOURCES.md">data repository</a>.</p></details>`;
  }

  function list(items, release) {
    root.innerHTML = `${legend()}
      <ul class="mp-grid">${items.map(card).join("")}</ul>
      <div id="mh-cite"></div>`;
    M.renderCite(root.querySelector("#mh-cite"), release, "infrastructure menu price list");
  }

  M.prices().then((payload) => {
    const items = group(payload.price_list || []);
    if (!items.length) {
      root.innerHTML = `<p class="report-empty">The price list isn't in this data release yet.</p>`;
      return;
    }
    const slug = new URLSearchParams(window.location.search).get("item");
    const item = slug && items.find((i) => i.slug === slug);
    if (item) detail(item, payload.release); else list(items, payload.release);
  }).catch((error) => M.unavailable(root, error));
})();
