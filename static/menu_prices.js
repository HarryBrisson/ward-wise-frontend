// Menu money · Price list, set like a restaurant menu: sections of dishes, a name, a one-line
// description and a price. Everything else waits for interest — tap an item for the full CDOT
// description, how its price has moved, and what wards actually paid; sourcing sits one more
// tap down. ?item=<slug> opens that item.
(function () {
  "use strict";
  const M = window.WardWiseMenu;
  const root = document.getElementById("mh-prices");
  if (!root) return;
  const esc = M.esc;

  // The menu card: sections in reading order, each item a short name + one line. Prices and the
  // full descriptions come from the data; these words are ours.
  const SECTIONS = [
    { title: "Streets", items: [
      ["street_resurfacing", "Street resurfacing", "A smooth new surface, curb to curb, for one residential block."],
      ["curb_gutter", "Curb & gutter", "New curbs and gutters so water drains off the street, not across the sidewalk."],
      ["cul_de_sac", "Cul-de-sac", "Closes a street to through traffic."],
      ["diagonal_parking", "Diagonal parking", "Angled spaces that fit more cars on a wide street."],
    ] },
    { title: "Alleys", items: [
      ["alley_resurfacing", "Alley resurfacing", "Fresh asphalt for a residential alley."],
      ["green_alley", "Green alley", "Rebuilt with permeable paving so rain soaks in instead of flooding."],
      ["concrete_alley_apron", "Alley apron", "The concrete ramp where an alley meets the street."],
      ["alley_speed_hump", "Alley speed humps", "A pair of humps to slow cut-through drivers."],
    ] },
    { title: "Sidewalks & crossings", items: [
      ["sidewalk_replacement", "Sidewalk replacement", "New sidewalk squares along a block, with ramps at the corners."],
      ["residential_bump_outs", "Bump-outs", "Curb extensions that shorten the walk across a side street."],
      ["arterial_bump_out", "Arterial bump-out", "A curb extension at a busy corner."],
      ["pedestrian_refuge_island", "Refuge island", "A raised island mid-crossing, so you cross one direction at a time."],
    ] },
    { title: "Slower streets", items: [
      ["street_speed_hump", "Speed humps", "A pair of humps on one block."],
      ["traffic_circle", "Traffic circle", "A small planted circle that slows an intersection without a stop sign."],
    ] },
    { title: "Bikeways", items: [
      ["bike_lane", "Bike lane", "A painted lane or shared-lane markings."],
      ["buffered_bike_lane", "Buffered bike lane", "A bike lane with painted space between bikes and cars."],
      ["protected_bike_lane", "Protected bike lane", "Separated from traffic by posts, curbs or parked cars."],
      ["neighborhood_greenway", "Neighborhood greenway", "A calm side street shaped for biking and walking."],
    ] },
    { title: "Lighting & signals", items: [
      ["street_lighting", "Street lighting", "New residential lights along a block."],
      ["floodlight", "Floodlight", "A bright light for an alley or dark corner."],
      ["street_light_upgrade", "Street light upgrade", "Swaps in a newer fixture on an existing pole."],
      ["light_pole_painting", "Light pole painting", "A fresh coat on a street light pole."],
      ["signal_pole_painting", "Signal pole painting", "Repaints the signal poles at one intersection."],
      ["traffic_signal", "Traffic signal", "A new signal or left-turn arrow."],
    ] },
  ];

  const SOURCES = {
    primary_document: "A price sheet issued by CDOT or OBM.",
    official_secondary: "CDOT's prices as reproduced in the City's 2017 Inspector General audit.",
    ward_wise_2023_unverified: "CDOT's 2023 Aldermanic Menu packet, from a copy kept by Ward Wise volunteers (no city-hosted copy found).",
    derived: "The fixed price that recurs in the City's own spending postings that year.",
    ward_office_secondary: "A price table a ward office posted for participatory budgeting.",
  };
  const RANK = { primary_document: 0, official_secondary: 1, ward_wise_2023_unverified: 2, derived: 3, ward_office_secondary: 4 };
  const rank = (r) => RANK[r.verification] ?? 9;

  // The price on the menu: the 2023 packet when the item is in it (one menu year for the whole
  // card), else the newest best-sourced price.
  function headline(list) {
    const packet = list.find((r) => r.verification === "ward_wise_2023_unverified");
    if (packet) return packet;
    return list.filter((r) => r.unit_cost != null)
      .sort((a, b) => (b.menu_year - a.menu_year) || (rank(a) - rank(b)))[0] || list[0];
  }

  const shortUnit = (u) => String(u || "").replace(/\s*\(.*\)$/, "").replace(/^line item$/, "light");
  function price(row) {
    if (!row || row.unit_cost == null) return { amount: "varies", unit: "" };
    const v = row.display_unit_cost ?? row.unit_cost;
    const amount = `$${Math.round(v).toLocaleString()}`;
    return { amount, unit: shortUnit(row.display_unit || row.unit) };
  }

  // One line of history: the best-sourced price per year, in the headline's unit.
  function historyLine(list, head) {
    const byYear = {};
    // Ward-office tables are rounded and their year is approximate, so they'd read as fake
    // dips; they stay in the sources list but out of the history line.
    list.filter((r) => r.unit_cost != null && r.unit === head.unit && r.verification !== "ward_office_secondary").forEach((r) => {
      if (!byYear[r.menu_year] || rank(r) < rank(byYear[r.menu_year])) byYear[r.menu_year] = r;
    });
    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
    if (years.length < 2) return "";
    // Keep it short: first, the years the price changed, and the last.
    const keep = years.filter((y, i) => i === 0 || i === years.length - 1 || byYear[y].unit_cost !== byYear[years[i - 1]].unit_cost);
    return keep.map((y) => `<span><b>${y}</b> ${M.moneyExact(byYear[y].unit_cost)}</span>`).join('<span class="rm-sep">→</span>');
  }

  function itemHtml([slug, name, blurb], list, open) {
    const head = list.length ? headline(list) : null;
    const p = price(head);
    const vz = list.some((r) => r.vision_zero);
    const offYear = head && head.verification !== "ward_wise_2023_unverified";
    return `
      <li class="rm-item${open ? " is-open" : ""}" id="item-${esc(slug)}">
        <button type="button" class="rm-row" data-slug="${esc(slug)}" aria-expanded="${open}" aria-controls="detail-${esc(slug)}">
          <span class="rm-name">${esc(name)}${vz ? ' <span class="rm-vz" title="Vision Zero safety item">VZ</span>' : ""}</span>
          <span class="rm-leader" aria-hidden="true"></span>
          <span class="rm-price">${p.amount}${offYear ? "<sup>*</sup>" : ""}${p.unit ? `<span class="rm-unit"> / ${esc(p.unit)}</span>` : ""}</span>
          <span class="rm-blurb">${esc(blurb)}</span>
        </button>
        <div class="rm-detail" id="detail-${esc(slug)}"${open ? "" : " hidden"}>${open && head ? detailHtml(slug, list, head) : ""}</div>
      </li>`;
  }

  function detailHtml(slug, list, head) {
    const desc = (list.find((r) => r.description) || {}).description || "";
    const hist = historyLine(list, head);
    const rows = list.slice().sort((a, b) => (b.menu_year - a.menu_year) || (rank(a) - rank(b)));
    return `
      ${desc ? `<p class="rm-desc">${esc(desc)}</p>` : ""}
      ${head.conversion_note ? `<p class="rm-note">${esc(head.conversion_note)}</p>` : ""}
      ${hist ? `<p class="rm-history"><span class="rm-label">Price over time</span> ${hist}</p>` : ""}
      <p class="rm-links"><a href="/menu/costs?type=${encodeURIComponent(slug)}">What wards actually paid</a>
        · <a href="/menu/prices?item=${encodeURIComponent(slug)}" data-permalink>Link to this item</a></p>
      <details class="rm-sources">
        <summary>Where this price comes from</summary>
        <ul>${rows.map((r) => `<li><b>${r.menu_year ?? "—"}</b> ${r.unit_cost != null ? M.moneyExact(r.unit_cost) : "range"} per ${esc(r.unit)}.
          ${esc(SOURCES[r.verification] || r.verification)}
          ${r.source_url ? `<a href="${esc(r.source_url)}" rel="noopener">Source</a>` : ""}${r.source_page ? ` <span class="rm-page">(${esc(r.source_page)})</span>` : ""}
          ${r.notes ? `<br><span class="rm-page">${esc(r.notes)}</span>` : ""}</li>`).join("")}</ul>
      </details>`;
  }

  function render(bySlug, release, openSlug) {
    const listed = new Set(SECTIONS.flatMap((s) => s.items.map((i) => i[0])));
    const extras = Object.keys(bySlug).filter((slug) => !listed.has(slug))
      .map((slug) => [slug, headline(bySlug[slug]).item, ""]);
    const sections = extras.length ? SECTIONS.concat([{ title: "More", items: extras }]) : SECTIONS;
    root.innerHTML = `
      <article class="rm-menu">
        <header class="rm-head">
          <p class="rm-kicker">The Aldermanic Menu</p>
          <p class="rm-sub">What a ward can buy with its menu money, at CDOT's 2023 prices.<br>Tap any item for details.</p>
        </header>
        ${sections.map((s) => `
          <section class="rm-section">
            <h2>${esc(s.title)}</h2>
            <ul>${s.items.filter((i) => bySlug[i[0]]).map((i) => itemHtml(i, bySlug[i[0]], i[0] === openSlug)).join("")}</ul>
          </section>`).join("")}
        <footer class="rm-foot">
          <p><span class="rm-vz">VZ</span> Vision Zero safety item &nbsp;·&nbsp; <sup>*</sup> not on the 2023 menu; price from city spending records or a ward office</p>
          <p>Prices are CDOT's averages for planning. Each project is estimated on its own, so actual costs vary
            (<a href="/menu/costs">see what wards actually paid</a>). The city doesn't publish this price list;
            <a href="${M.DATA_REPO}/blob/main/data/infrastructure_menu_SOURCES.md">how we assembled it</a>.</p>
        </footer>
      </article>
      <div id="mh-cite"></div>`;
    M.renderCite(root.querySelector("#mh-cite"), release, openSlug ? `price list: ${openSlug}` : "infrastructure menu price list");
  }

  M.prices().then((payload) => {
    const bySlug = {};
    (payload.price_list || []).forEach((r) => { (bySlug[r.item_slug] = bySlug[r.item_slug] || []).push(r); });
    if (!Object.keys(bySlug).length) {
      root.innerHTML = `<p class="report-empty">The price list isn't in this data release yet.</p>`;
      return;
    }
    let open = new URLSearchParams(window.location.search).get("item");
    if (open && !bySlug[open]) open = null;
    render(bySlug, payload.release, open);
    if (open) document.getElementById(`item-${open}`)?.scrollIntoView({ block: "center" });

    // One item open at a time; the URL follows so an open item can be shared.
    root.addEventListener("click", (event) => {
      const row = event.target.closest(".rm-row");
      if (!row) return;
      const slug = row.dataset.slug;
      const next = slug === open ? null : slug;
      root.querySelectorAll(".rm-item.is-open").forEach((li) => {
        li.classList.remove("is-open");
        li.querySelector(".rm-row").setAttribute("aria-expanded", "false");
        li.querySelector(".rm-detail").hidden = true;
      });
      if (next) {
        const li = document.getElementById(`item-${next}`);
        const list = bySlug[next];
        li.classList.add("is-open");
        row.setAttribute("aria-expanded", "true");
        const detail = li.querySelector(".rm-detail");
        detail.innerHTML = detailHtml(next, list, headline(list));
        detail.hidden = false;
      }
      open = next;
      M.setUrl("/menu/prices", { item: open });
    });
  }).catch((error) => M.unavailable(root, error));
})();
