// The metric dictionary, made sortable.
//
// The page used to render all 171 measures fully expanded in one column under
// eleven domain headings, which left ctrl-F as the only way to find anything.
// Same catalog, same anchors, same wording of the entries. What is new is the
// three things a dictionary needs: a search, more than one way to group, and
// groups that stay shut until you open one.
//
// metric_details.js still owns the per-metric facts (status, source, source
// URL) so the explorer at /classic and this page cannot drift apart. It only
// self-renders when it finds #metrics-content, and this page does not have one.
(function () {
  "use strict";

  const results = document.getElementById("dict-results");
  if (!results) return;

  const esc = (value) => WardWiseExplorer.escapeHtml(value == null ? "" : String(value));
  const shared = window.WardWiseMetricDetails;

  // ---------- the three ways to group ----------

  // Same eleven GNHUSA domains the catalog is filed under, same order and the
  // same ids so #metric-domain-* links from elsewhere still land. The blurbs
  // are rewritten in plain English, since every one of them used to open with
  // the words "Measures that describe".
  const DOMAINS = [
    { id: "psychological_wellbeing", title: "Psychological wellbeing",
      blurb: "How people say they are doing. Stress, loneliness, and mental health." },
    { id: "social_connectedness", title: "Social connectedness",
      blurb: "Whether neighbors know each other and have someone to lean on." },
    { id: "material_wellbeing", title: "Material wellbeing",
      blurb: "Income, rent, poverty, and what it costs to stay put." },
    { id: "health", title: "Health",
      blurb: "Physical health, insurance, and what is nearby to keep people well." },
    { id: "time_balance", title: "Time balance",
      blurb: "Commutes, and how much of the day the trip eats." },
    { id: "religion_spiritual", title: "Religion and spirituality",
      blurb: "Places of worship and the communities around them." },
    { id: "lifelong_learning", title: "Lifelong learning",
      blurb: "Schools, libraries, and how far people got in school." },
    { id: "good_governance", title: "Good governance",
      blurb: "Turnout, council attendance, ward money, and how fast 311 answers." },
    { id: "community_vitality", title: "Community vitality",
      blurb: "Public life, crime, and the places people gather." },
    { id: "physical_environment", title: "Physical environment",
      blurb: "Parks, trees, air, water, and the streets underfoot." },
    { id: "culture", title: "Culture",
      blurb: "Museums, landmarks, murals, music, and the arts." },
  ];
  const OTHER_DOMAIN = {
    id: "other_measurement_inputs",
    title: "Other inputs",
    blurb: "Kept for transparency, outside the eleven wellbeing domains.",
  };
  const DOMAIN_BY_ID = new Map(DOMAINS.map((domain) => [domain.id, domain]));

  // Who published the number. Order matters: the project's own modeled outputs
  // name their inputs ("microhappiness / GSS + ACS + CDC PLACES"), so they have
  // to be caught by their leading pipeline name before the input names match.
  const FAMILIES = [
    {
      id: "wardwise", title: "Ward Wise models",
      blurb: "Estimates this project builds from other data rather than reads off a table.",
      test: /^(microhappiness|rentrate|parkability|sunscore)\b|ward wise explorer/,
    },
    {
      id: "health-survey", title: "Public health surveys",
      blurb: "CDC PLACES and the Chicago Health Atlas, asked of residents.",
      test: /cdc places|chicago health atlas|healthy chicago/,
    },
    {
      id: "mapped", title: "Mapped places",
      blurb: "Counted off the map. OpenStreetMap, Google Maps sweeps, Wikidata.",
      test: /openstreetmap|overpass|google maps|apify|wikidata/,
    },
    {
      id: "city", title: "City of Chicago",
      blurb: "Published by city departments and agencies. 311, licenses, permits, parks, transit.",
      test: /chicago 311|business licenses|bacp|chicago data portal|chicago cip|park district|councilmatic|board of elections|datamade|residential permit zones|cdph|chicago municipal|city of chicago|chicago landmarks|chicago mural|chicago historic|transit authority|divvy/,
    },
    {
      id: "census", title: "U.S. Census",
      blurb: "American Community Survey, County Business Patterns, and the rest of the federal count.",
      test: /american community survey|census bureau|county business patterns|census tiger|census gazetteer|\bacs\b/,
    },
    {
      id: "other-data", title: "Other public data",
      blurb: "State, federal, and academic datasets that do not fit the groups above.",
      test: /.*/,
    },
  ];

  // Matching order and reading order are different jobs. Above, the pipelines
  // have to be tested first or they get claimed by their own inputs. On the
  // page it reads better from the official record outward to what is derived.
  const FAMILY_ORDER = ["city", "census", "health-survey", "mapped", "wardwise", "other-data"]
    .map((id) => FAMILIES.find((family) => family.id === id));

  const AZ_BUCKETS = [
    ["A", "C"], ["D", "F"], ["G", "I"], ["J", "L"],
    ["M", "O"], ["P", "R"], ["S", "U"], ["V", "Z"],
  ].map(([from, to]) => ({
    id: `az-${from.toLowerCase()}`,
    title: from === to ? from : `${from} to ${to}`,
    blurb: "",
    from,
    to,
  }));
  const AZ_OTHER = { id: "az-num", title: "Numbers and symbols", blurb: "" };

  // ---------- state ----------

  const state = {
    query: "",
    terms: [],
    group: "topic",
    show: "all",
    opened: new Set(),
  };

  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Words match at the start of a word, not anywhere in it. Plain substring
  // matching put all 34 street measures under a search for "tree".
  function setQuery(value) {
    state.query = value.trim().toLowerCase();
    state.terms = state.query
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => new RegExp(`\\b${escapeRegExp(word)}`, "i"));
  }

  let catalog = [];
  let searchTimer = null;

  // ---------- shaping the catalog ----------

  function familyFor(source) {
    const value = String(source || "").toLowerCase();
    return FAMILIES.find((family) => family.test.test(value)) || FAMILIES[FAMILIES.length - 1];
  }

  function azBucketFor(label) {
    const letter = String(label || "").trim().charAt(0).toUpperCase();
    if (!/[A-Z]/.test(letter)) return AZ_OTHER;
    return AZ_BUCKETS.find((bucket) => letter >= bucket.from && letter <= bucket.to) || AZ_OTHER;
  }

  function presetsFor(metricId) {
    return (window.K3_PRESETS || [])
      .filter((preset) => (preset.metric_ids || []).includes(metricId))
      .map((preset) => preset.name);
  }

  function unitLabel(unit) {
    const value = String(unit || "").toLowerCase();
    if (value === "percent") return "percent";
    if (value === "count" || value === "units") return "a count";
    if (value.includes("10000") || value.includes("10k")) return "per 10,000 people";
    if (value === "currency" || value === "usd") return "dollars";
    if (value === "days") return "days";
    if (value === "minutes") return "minutes";
    if (value === "miles") return "miles";
    if (value === "index" || value === "score" || value === "rating") return "an index";
    if (value === "rate" || value.startsWith("rate_")) return "a rate";
    return unit || "number";
  }

  // Only the exceptions get a badge. 160 of the 171 measures cover all 50
  // wards, so an "Available" chip on every row would be a chip that says
  // nothing. The eleven that fall short say by how much.
  function shortfall(coverage) {
    const total = coverage?.ward_count || 50;
    const have = coverage?.populated_ward_count || 0;
    return have > 0 && have < total ? `${have} of ${total} wards` : have > 0 ? "" : "no ward data yet";
  }

  function buildCatalog(metrics, coverage, snapshots) {
    return metrics
      .map((metric) => {
        const metricCoverage = coverage[metric.metric_id] || null;
        const source = shared.metricSource(metric, metricCoverage);
        const domain = DOMAIN_BY_ID.get(metric.category) || OTHER_DOMAIN;
        const family = familyFor(source);
        const presets = presetsFor(metric.metric_id);
        return {
          metric,
          coverage: metricCoverage,
          source,
          sourceUrl: shared.metricSourceUrl(metric, metricCoverage, snapshots),
          domain,
          family,
          presets,
          gap: shortfall(metricCoverage),
          label: metric.label || metric.metric_id,
          haystack: [
            metric.label, metric.metric_id, metric.description, metric.methodology,
            metric.calculation, source, domain.title, family.title, presets.join(" "),
          ].join(" ").toLowerCase(),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  // ---------- filtering and grouping ----------

  function passes(entry) {
    if (state.show === "lists" && !entry.presets.length) return false;
    if (state.show === "partial" && !entry.gap) return false;
    return state.terms.every((term) => term.test(entry.haystack));
  }

  function groupsFor(entries) {
    const buckets = new Map();
    const order = state.group === "topic"
      ? [...DOMAINS, OTHER_DOMAIN]
      : state.group === "source"
        ? FAMILY_ORDER
        : [...AZ_BUCKETS, AZ_OTHER];
    const keyOf = (entry) =>
      state.group === "topic" ? entry.domain
        : state.group === "source" ? entry.family
          : azBucketFor(entry.label);
    entries.forEach((entry) => {
      const bucket = keyOf(entry);
      if (!buckets.has(bucket.id)) buckets.set(bucket.id, { ...bucket, entries: [] });
      buckets.get(bucket.id).entries.push(entry);
    });
    return order.map((bucket) => buckets.get(bucket.id)).filter(Boolean);
  }

  // ---------- rendering ----------

  function mark(text) {
    const safe = esc(text);
    // Highlighting runs over already-escaped text, so a query that happens to
    // land inside an entity ("amp", "quot") would cut it in half. Rare, and not
    // worth a tokenizer: text carrying an entity just goes unhighlighted.
    if (!state.terms.length || safe.includes("&")) return safe;
    return state.query
      .split(/\s+/)
      .filter((word) => word.length > 1)
      .reduce((carried, word) => {
        const pattern = new RegExp(`\\b(${escapeRegExp(word)})`, "ig");
        return carried.replace(pattern, "<mark>$1</mark>");
      }, safe);
  }

  function renderRow(entry) {
    const { metric } = entry;
    // The right-hand caption answers whatever the grouping does not: browsing
    // by topic you want to know who published it, browsing by source you want
    // to know what it is about.
    const aside = state.group === "source" ? entry.domain.title : entry.family.title;
    return `
      <details class="dict-row" id="metric-entry-${esc(metric.metric_id)}">
        <summary>
          <span class="dict-rowmain">
            <span class="dict-rowname">${mark(entry.label)}</span>
            <span class="dict-rowdesc">${mark(metric.description || "No definition written yet.")}</span>
          </span>
          <span class="dict-rowside">
            ${entry.gap ? `<span class="dict-gap">${esc(entry.gap)}</span>` : ""}
            <span class="dict-rowfam">${esc(aside)}</span>
          </span>
        </summary>
        ${renderBody(entry)}
      </details>
    `;
  }

  function renderBody(entry) {
    const { metric, coverage } = entry;
    const methodology = shared.metricMethodology(metric);
    const direction = metric.direction === "lower"
      ? "Lower is better"
      : metric.direction === "higher"
        ? "Higher is better"
        : "Neither direction is better";
    const period = [coverage?.latest_period_start, coverage?.latest_period_end]
      .filter(Boolean)
      .map((value) => WardWiseExplorer.formatDate(value));
    const periodLabel = period.length === 2
      ? `${period[0]} to ${period[1]}`
      : period[0] || "Not recorded";
    return `
      <div class="dict-body">
        ${methodology ? `<p><b>How to read it.</b> ${esc(methodology)}</p>` : ""}
        ${metric.calculation ? `<p><b>How it is worked out.</b> ${esc(metric.calculation)}</p>` : ""}
        ${renderPresets(entry)}
        <dl class="dict-meta">
          <div><dt>Source</dt><dd>${renderSource(entry)}</dd></div>
          <div><dt>Wards covered</dt><dd>${esc(shared.metricCoverageLabel(coverage))}</dd></div>
          <div><dt>Latest period</dt><dd>${esc(periodLabel)}</dd></div>
          <div><dt>Measured in</dt><dd>${esc(unitLabel(metric.unit))}</dd></div>
          <div><dt>Scoring</dt><dd>${esc(direction)}</dd></div>
          <div><dt>Name in the data</dt><dd><code>${esc(metric.metric_id)}</code></dd></div>
        </dl>
        ${renderNominator(metric)}
        <p class="dict-jump">
          <a href="/?m=${encodeURIComponent(metric.metric_id)}">See where the 50 wards stand on this &rsaquo;</a>
        </p>
      </div>
    `;
  }

  function renderSource(entry) {
    if (!entry.source) return "Not recorded";
    if (!entry.sourceUrl) return esc(entry.source);
    return `<a href="${esc(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(entry.source)}</a>`;
  }

  function renderPresets(entry) {
    if (!entry.presets.length) return "";
    const chips = entry.presets
      .map((name) => {
        const preset = (window.K3_PRESETS || []).find((item) => item.name === name);
        const mix = (preset?.metric_ids || []).join(",");
        return `<a class="dict-chip" href="/?m=${encodeURIComponent(mix)}">${esc(name)}</a>`;
      })
      .join("");
    return `<p class="dict-inlists"><span>Part of</span>${chips}</p>`;
  }

  function renderNominator(metric) {
    const nominator = metric?.nominator;
    if (!nominator || !nominator.can_list) return "";
    const line = [
      nominator.organization_affiliation,
      nominator.ward || (nominator.ward_id ? `Ward ${Number(nominator.ward_id)}` : ""),
      nominator.community_area,
    ].filter(Boolean).join(" / ");
    return `
      <p class="dict-nom">
        Nominated by ${esc(nominator.name || "a resident")}${line ? `, ${esc(line)}` : ""}.
      </p>
    `;
  }

  function renderGroup(group, forceOpen) {
    const open = forceOpen || state.opened.has(group.id);
    const anchor = state.group === "topic" ? ` id="metric-domain-${esc(group.id)}"` : "";
    return `
      <details class="dict-group"${anchor} data-group="${esc(group.id)}"${open ? " open" : ""}>
        <summary>
          <span class="dict-groupmain">
            <span class="dict-grouptitle">${esc(group.title)}</span>
            ${group.blurb ? `<span class="dict-groupblurb">${esc(group.blurb)}</span>` : ""}
          </span>
          <span class="dict-groupcount">${group.entries.length}</span>
        </summary>
        <div class="dict-rows">${group.entries.map(renderRow).join("")}</div>
      </details>
    `;
  }

  function render() {
    const shown = catalog.filter(passes);
    const searching = Boolean(state.query) || state.show !== "all";
    const groups = groupsFor(shown);

    document.getElementById("dict-count").textContent = shown.length === catalog.length
      ? `${catalog.length} measures`
      : `${shown.length} of ${catalog.length} measures`;
    document.getElementById("dict-clear").hidden = !state.query;

    if (!shown.length) {
      results.innerHTML = `
        <p class="dict-empty">
          Nothing matches ${state.query ? `<b>${esc(state.query)}</b>` : "that filter"}.
          Try a shorter word, or <button type="button" class="dict-linkbtn" data-act="reset">show everything</button>.
        </p>
      `;
      document.getElementById("dict-expand").textContent = "expand all";
      return;
    }
    // A filtered view with the groups shut is a wall of closed doors, so a
    // search opens whatever it found.
    results.innerHTML = groups.map((group) => renderGroup(group, searching)).join("");
    updateExpandLabel();
  }

  function updateExpandLabel() {
    const groups = [...results.querySelectorAll(".dict-group")];
    const allOpen = groups.length > 0 && groups.every((group) => group.open);
    document.getElementById("dict-expand").textContent = allOpen ? "collapse all" : "expand all";
  }

  // ---------- wiring ----------

  function setGroup(mode) {
    if (state.group === mode) return;
    state.group = mode;
    state.opened.clear(); // group ids belong to one mode, so carrying them over means nothing
    document.querySelectorAll("[data-group-btn]").forEach((button) => {
      button.classList.toggle("is-on", button.dataset.groupBtn === mode);
      button.setAttribute("aria-pressed", String(button.dataset.groupBtn === mode));
    });
    render();
  }

  function syncShowButtons() {
    document.querySelectorAll("[data-show-btn]").forEach((button) => {
      const on = button.dataset.showBtn === state.show;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    });
  }

  function setShow(mode) {
    if (state.show === mode) return;
    state.show = mode;
    syncShowButtons();
    render();
  }

  function wire() {
    const search = document.getElementById("dict-search");
    search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        setQuery(search.value);
        render();
      }, 90);
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        search.value = "";
        setQuery("");
        render();
      }
    });

    document.getElementById("dict-clear").addEventListener("click", () => {
      search.value = "";
      setQuery("");
      render();
      search.focus();
    });

    document.querySelectorAll("[data-group-btn]").forEach((button) => {
      button.addEventListener("click", () => setGroup(button.dataset.groupBtn));
    });
    document.querySelectorAll("[data-show-btn]").forEach((button) => {
      button.addEventListener("click", () => setShow(button.dataset.showBtn));
    });

    document.getElementById("dict-expand").addEventListener("click", () => {
      const groups = [...results.querySelectorAll(".dict-group")];
      const opening = !groups.every((group) => group.open);
      groups.forEach((group) => {
        group.open = opening;
        if (opening) state.opened.add(group.dataset.group);
        else state.opened.delete(group.dataset.group);
      });
      updateExpandLabel();
    });

    results.addEventListener("click", (event) => {
      if (event.target.dataset?.act === "reset") {
        search.value = "";
        setQuery("");
        setShow("all");
        render();
      }
    });

    // `toggle` does not bubble, but it still runs the capture phase down to the
    // target, so one listener here sees every group opening and closing.
    results.addEventListener("toggle", (event) => {
      const group = event.target.closest?.(".dict-group");
      if (!group || group !== event.target) return;
      if (group.open) state.opened.add(group.dataset.group);
      else state.opened.delete(group.dataset.group);
      updateExpandLabel();
    }, true);

    // A slash focuses the search, the way every list of things does.
    document.addEventListener("keydown", (event) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      event.preventDefault();
      search.focus();
      search.select();
    });

    window.addEventListener("hashchange", revealFromHash);
  }

  // ---------- deep links ----------

  // Accepts #metric-entry-<id>, the anchor the entries carry, and #metric=<id>,
  // the form the report links use. Either one has to survive an active filter,
  // so the filter is cleared before the entry is opened.
  function requestedMetricId() {
    const hash = (location.hash || "").replace(/^#/, "");
    if (!hash) return "";
    if (hash.startsWith("metric-entry-")) return hash.slice("metric-entry-".length);
    return new URLSearchParams(hash).get("metric") || "";
  }

  function revealFromHash() {
    const metricId = requestedMetricId();
    if (!metricId || !catalog.some((entry) => entry.metric.metric_id === metricId)) return;
    const search = document.getElementById("dict-search");
    search.value = "";
    setQuery("");
    state.show = "all";
    syncShowButtons();
    const entry = catalog.find((item) => item.metric.metric_id === metricId);
    const bucket = state.group === "topic" ? entry.domain
      : state.group === "source" ? entry.family
        : azBucketFor(entry.label);
    state.opened.add(bucket.id);
    render();
    const node = document.getElementById(`metric-entry-${metricId}`);
    if (!node) return;
    node.open = true;
    node.classList.add("is-found");
    setTimeout(() => node.classList.remove("is-found"), 2400);
    // Jump rather than glide, and jump again once the document is done. The
    // catalog arrives long after the browser gave up on the fragment, and when
    // loading finishes the browser resets the scroll for a fragment it could
    // not resolve, undoing anything done before that point.
    const jump = () => node.scrollIntoView({ block: "center" });
    jump();
    if (document.readyState !== "complete") {
      window.addEventListener("load", () => setTimeout(jump, 0), { once: true });
    }
  }

  // ---------- boot ----------

  WardWiseExplorer.fetchMetrics()
    .then((payload) => {
      const metrics = payload.metrics || [];
      catalog = buildCatalog(metrics, payload.coverage || {}, payload.snapshots || []);
      document.getElementById("dict-search").placeholder =
        `Search ${catalog.length} measures by name, topic, or source…`;
      const note = document.getElementById("dict-note");
      const latest = [...(payload.snapshots || [])]
        .sort((a, b) => String(a.collected_at || "").localeCompare(String(b.collected_at || "")))
        .at(-1);
      note.innerHTML = `
        Every measure is rescaled 0 to 100 across the 50 wards before it counts toward a
        rank, and the lower-is-better ones are flipped first, so a rank always points the
        same way. Last refreshed ${esc(WardWiseExplorer.formatDate(latest?.collected_at))}.
      `;
      wire();
      render();
      revealFromHash();
    })
    .catch((error) => {
      results.innerHTML = `<p class="dict-empty">Unable to load the catalog. ${esc(error.message)}</p>`;
    });
})();
