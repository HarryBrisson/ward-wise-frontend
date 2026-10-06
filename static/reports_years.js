// Data-years view: which years each metric actually covers — measured vintages, forward-carried
// coverage, constants, and gaps. The gap-filling lens for the catalog. Its own page:
// /reports/data-years.
(function () {
  "use strict";

  const container = () => document.getElementById("yearsgrid-content");
  if (!document.getElementById("years-view")) return;

  const state = { manifest: null, loading: false, rendered: false };

  function ctx() {
    const m = state.manifest;
    return {
      metricDataYears: m.metric_data_years || {},
      forwardCarryYears: m.forward_carry_years ?? 3,
      timeInvariantMetrics: new Set(m.time_invariant_metrics || []),
      metricValidFrom: m.metric_valid_from || {},
    };
  }

  function humanizeDomain(category) {
    return (category || "other")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function visibleYears() {
    const all = (state.manifest.data_years || []).map(Number).sort((a, b) => a - b);
    const showAll = document.getElementById("yearsgrid-show-all")?.checked;
    return showAll ? all : all.filter((y) => y >= 2009);
  }

  function rowFacts(metric, years) {
    const c = ctx();
    const measured = new Set((c.metricDataYears[metric.metric_id] || []).map(Number));
    const invariant = c.timeInvariantMetrics.has(metric.metric_id);
    const cells = years.map((year) => {
      if (invariant) {
        const from = c.metricValidFrom[metric.metric_id];
        return from == null || year >= from ? "constant" : "empty";
      }
      if (measured.has(year)) return "measured";
      if (WardWiseExplorer.yearMath.hasValueForYear(c, metric.metric_id, year)) return "carried";
      return "empty";
    });
    // Count only the years actually on screen — "measured 23 of 18" was the giveaway that the
    // numerator spanned all history while the denominator spanned the visible window.
    const visibleMeasured = years.filter((year) => measured.has(year)).length;
    return { measured, visibleMeasured, invariant, cells };
  }

  function legendHtml() {
    return `
      <div class="yearsgrid-legend">
        <span><i class="yearsgrid-cell is-measured"></i> measured</span>
        <span><i class="yearsgrid-cell is-carried"></i> carried forward</span>
        <span><i class="yearsgrid-cell is-constant"></i> constant</span>
        <span><i class="yearsgrid-cell is-empty"></i> gap</span>
      </div>
      <div class="yearsgrid-legend yearsgrid-legend-tiers">
        <span><span class="yearsgrid-tier tier-direct">${TIERS.direct.icon}</span> recorded by ward</span>
        <span><span class="yearsgrid-tier tier-point">${TIERS.point.icon}</span> located records</span>
        <span><span class="yearsgrid-tier tier-polygon">${TIERS.polygon.icon}</span> apportioned from source areas</span>
        <span><span class="yearsgrid-tier tier-modeled">${TIERS.modeled.icon}</span> statistical estimate</span>
        <span class="yearsgrid-legend-sep" aria-hidden="true"></span>
        <span><span class="yearsgrid-port port-chicago_only">${PORTABILITY.chicago_only.icon}</span> Chicago-specific</span>
        <span><span class="yearsgrid-port port-us_wide">${PORTABILITY.us_wide.icon}</span> any US city</span>
        <span><span class="yearsgrid-port port-anywhere">${PORTABILITY.anywhere.icon}</span> any city on earth</span>
        <span class="yearsgrid-legend-note">The first icon is how much allocation stands between the
          source and a ward — the further right, the more the number is an estimate. The second says
          how far the source travels. Hover either for the detail.</span>
      </div>`;
  }


  // The reliability tiers: how a number got from its source to a ward. Ordered best-to-worst for
  // the "tier" sort, because that ordering IS the reliability story.
  // Icons, not words: 182 rows x two text badges crowded the grid off the useful part (the year
  // cells). Silhouettes must differ at 16px — a filled ward outline, a map pin, tiled polygons, a
  // fitted curve — and the full wording lives in the tooltip. Spec matches explorer.js icons:
  // viewBox 0 0 20 20, stroke 1.5, round caps, currentColor.
  const svg = (body) =>
    `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor"` +
    ` stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

  const TIERS = {
    direct: {
      rank: 0, short: "direct", label: "Direct",
      blurb: "recorded by ward at the source — no allocation, nothing to get wrong",
      // a ward outline, filled: the source already speaks in wards
      icon: svg(`<path d="M4 5.5 9 3l7 2.5V14l-7 3-5-2.5Z" fill="currentColor" fill-opacity=".22"/>`),
    },
    point: {
      rank: 1, short: "point", label: "Point",
      blurb: "located records assigned by containment — exact at any geography",
      // a map pin
      icon: svg(`<path d="M10 17s5-4.6 5-8.4A5 5 0 0 0 5 8.6C5 12.4 10 17 10 17Z"/><circle cx="10" cy="8.4" r="1.6"/>`),
    },
    polygon: {
      rank: 2, short: "polygon", label: "Polygon",
      blurb: "apportioned from the source's own polygons — reliability depends on their size",
      // tiled cells with one straddling the seam: the apportionment problem in one mark
      icon: svg(`<path d="M3 4h6v6H3zM11 4h6v6h-6zM3 12h6v5H3zM11 12h6v5h-6z"/>`),
    },
    modeled: {
      rank: 3, short: "modeled", label: "Modeled",
      blurb: "a statistical estimate for the area, not a direct count",
      // a fitted curve through scattered observations
      icon: svg(`<path d="M3 15c3-1 4-8 7-8s4 5 7 3"/><circle cx="6" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="13" cy="8" r=".9" fill="currentColor" stroke="none"/>`),
    },
    unknown: {
      rank: 4, short: "?", label: "Unclassified",
      blurb: "not yet classified",
      icon: svg(`<circle cx="10" cy="10" r="6.5"/><path d="M10 13.5v-.01M8.3 8a1.8 1.8 0 1 1 2 2v1"/>`),
    },
  };

  // Nested, not exclusive: anything buildable anywhere on earth is also buildable in any US city.
  // The rank drives BOTH the badge and the "at least this portable" filter.
  const PORTABILITY = {
    chicago_only: {
      rank: 0, label: "Chicago-specific",
      blurb: "a Chicago-specific source — another city would need to find its own",
      icon: svg(`<path d="M3 17h14M5 17V9l3-2 3 2v8M13 17v-5l2-1 2 1v5"/>`),   // skyline
    },
    us_wide: {
      rank: 1, label: "Any US city",
      blurb: "a federal source — the same metric could be built for any US city",
      icon: svg(`<path d="M5 3v14M5 4h10l-2 3 2 3H5"/>`),                      // flag
    },
    anywhere: {
      rank: 2, label: "Any city on earth",
      blurb: "a global source — this could be built for any city on earth",
      icon: svg(`<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2.4 2 11.6 0 14M10 3c-2 2.4-2 11.6 0 14"/>`), // globe
    },
    unknown: { rank: -1, label: "Unclassified", blurb: "source not yet classified",
      icon: svg(`<circle cx="10" cy="10" r="6.5"/><path d="M10 13.5v-.01M8.3 8a1.8 1.8 0 1 1 2 2v1"/>`) },
  };
  const GEOGRAPHY_LABELS = {
    point: "points", census_tract: "census tract", zcta: "ZIP (ZCTA)", puma: "PUMA",
    community_area: "community area", ward: "ward", tif_district: "TIF district",
    school_attendance_boundary: "school attendance area", building_footprint: "building footprints",
    health_atlas_neighborhood: "Health Atlas neighborhood", unknown: "unknown",
  };

  function provenanceFor(metricId) {
    return (state.manifest?.metric_provenance || {})[metricId] || {};
  }

  function provenanceHtml(metric) {
    const p = provenanceFor(metric.metric_id);
    const tier = TIERS[p.measurement_tier] || TIERS.unknown;
    const port = PORTABILITY[p.portability] || PORTABILITY.unknown;
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    // The polygon tier means nothing without its source polygon — tract-sourced and ZIP-sourced are
    // very different claims about a ward — so the tooltip always names it.
    const geo = p.measurement_tier === "polygon"
      ? ` (source: ${GEOGRAPHY_LABELS[p.source_geography] || p.source_geography})` : "";
    const tierTitle = `${tier.label}: ${tier.blurb}${geo}`;
    return `<span class="yearsgrid-tier tier-${esc(p.measurement_tier || "unknown")}"
      title="${esc(tierTitle)}" role="img" aria-label="${esc(tierTitle)}">${tier.icon}</span>` +
      `<span class="yearsgrid-port port-${esc(p.portability || "unknown")}"
      title="${esc(port.label)}: ${esc(port.blurb)}" role="img"
      aria-label="${esc(port.label)}: ${esc(port.blurb)}">${port.icon}</span>`;
  }

  function rowHtml(metric, years) {
    const facts = rowFacts(metric, years);
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    let note;
    if (facts.invariant) {
      const from = ctx().metricValidFrom[metric.metric_id];
      note = from ? `constant since ${from}` : "constant";
    } else {
      note = `measured ${facts.visibleMeasured} of ${years.length}`;
    }
    const cells = facts.cells
      .map((kind, i) => `<i class="yearsgrid-cell is-${kind}" title="${esc(metric.label)} — ${years[i]}: ${kind}"></i>`)
      .join("");
    return `
      <div class="yearsgrid-row" data-tier="${esc(provenanceFor(metric.metric_id).measurement_tier || "unknown")}"
           data-portability="${esc(provenanceFor(metric.metric_id).portability || "unknown")}">
        <span class="yearsgrid-label" title="${esc(metric.label)}">${esc(metric.label)}</span>
        <span class="yearsgrid-prov">${provenanceHtml(metric)}</span>
        <span class="yearsgrid-cells">${cells}</span>
        <span class="yearsgrid-note">${note}</span>
      </div>`;
  }

  function headerHtml(years) {
    // Label only the decade/lustrum columns so 24 columns stay readable.
    const labels = years
      .map((y) => `<i class="yearsgrid-year">${y % 5 === 0 ? `'${String(y).slice(2)}` : ""}</i>`)
      .join("");
    return `<div class="yearsgrid-row yearsgrid-head"><span class="yearsgrid-label"></span><span class="yearsgrid-prov">how measured</span><span class="yearsgrid-cells">${labels}</span><span class="yearsgrid-note"></span></div>`;
  }

  function render() {
    const el = container();
    if (!el || !state.manifest) return;
    const years = visibleYears();
    let metrics = [...(state.manifest.metrics || [])];
    const sortMode = document.getElementById("yearsgrid-sort")?.value || "domain";
    const tierFilter = document.getElementById("yearsgrid-filter-tier")?.value || "";
    const portFilter = document.getElementById("yearsgrid-filter-portability")?.value || "";
    if (tierFilter) {
      metrics = metrics.filter((m) => provenanceFor(m.metric_id).measurement_tier === tierFilter);
    }
    if (portFilter === "chicago_only") {
      // the one exclusive case: "what is LOCKED to Chicago" — the limitation list
      metrics = metrics.filter((m) => provenanceFor(m.metric_id).portability === "chicago_only");
    } else if (portFilter) {
      // portability nests: a source that works anywhere on earth also works in any US city, so
      // "any US city" must include the global ones rather than excluding them
      const floor = (PORTABILITY[portFilter] || {}).rank ?? 0;
      metrics = metrics.filter((m) => {
        const p = PORTABILITY[provenanceFor(m.metric_id).portability];
        return p && p.rank >= floor;
      });
    }
    let html = legendHtml();
    if (sortMode === "tier") {
      // Most-reliable first: direct, then point, then polygon, then modeled.
      metrics.sort((a, b) => {
        const rank = (m) => (TIERS[provenanceFor(m.metric_id).measurement_tier] || TIERS.unknown).rank;
        return rank(a) - rank(b) || a.label.localeCompare(b.label);
      });
      html += headerHtml(years) + metrics.map((m) => rowHtml(m, years)).join("");
    } else if (sortMode === "gaps") {
      // Fewest measured years first — the gap-filling worklist. Constants sink to the bottom
      // (there is no annual series to extend).
      const c = ctx();
      metrics.sort((a, b) => {
        const rank = (m) => {
          if (c.timeInvariantMetrics.has(m.metric_id)) return 1000;
          const n = (c.metricDataYears[m.metric_id] || []).length;
          return n === 0 ? 999 : n;
        };
        return rank(a) - rank(b) || a.label.localeCompare(b.label);
      });
      html += headerHtml(years) + metrics.map((m) => rowHtml(m, years)).join("");
    } else {
      const byDomain = new Map();
      for (const metric of metrics) {
        const key = metric.category || "other";
        if (!byDomain.has(key)) byDomain.set(key, []);
        byDomain.get(key).push(metric);
      }
      for (const domain of [...byDomain.keys()].sort()) {
        const group = byDomain.get(domain).sort((a, b) => a.label.localeCompare(b.label));
        html += `<h3 class="yearsgrid-domain">${humanizeDomain(domain)}</h3>`;
        html += headerHtml(years) + group.map((m) => rowHtml(m, years)).join("");
      }
    }
    if (!metrics.length) {
      html += `<p class="yearsgrid-empty">No metrics match this filter.</p>`;
    } else if (tierFilter || portFilter) {
      html = `<p class="yearsgrid-count">${metrics.length} of ${
        (state.manifest.metrics || []).length} metrics match.</p>` + html;
    }
    el.innerHTML = html;
    state.rendered = true;
  }

  async function ensureLoaded() {
    if (state.manifest || state.loading) return;
    state.loading = true;
    try {
      state.manifest = await WardWiseExplorer.fetchExplorerManifest();
      render();
    } catch (error) {
      const el = container();
      if (el) el.innerHTML = "<p>Couldn't load metric coverage — try reloading.</p>";
    } finally {
      state.loading = false;
    }
  }

  document.getElementById("yearsgrid-sort")?.addEventListener("change", render);
  document.getElementById("yearsgrid-show-all")?.addEventListener("change", render);
  document.getElementById("yearsgrid-filter-tier")?.addEventListener("change", render);
  document.getElementById("yearsgrid-filter-portability")?.addEventListener("change", render);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureLoaded);
  else ensureLoaded();
})();
