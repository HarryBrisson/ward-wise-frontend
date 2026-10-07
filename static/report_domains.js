// The ward report's own sections, lifted out of report_ward.js so the public full report can
// show them for any geography: the domain bloom, the per-domain accordions with every measure
// against the average area, "how this neighborhood is changing" (long-run business mix) and
// "this area's best light". Nothing here fetches on its own: the caller supplies a ctx with the
// manifest, the score-matrix slices it has loaded, and the area — see create(ctx) below.
//
// ctx contract (read live, so a page can mutate areaId and re-render):
//   manifest, metrics (catalog rows for this geography), slices {yearKey: slice}, areaType,
//   areaId, areas, idOf(area), label ("Ward 12"), shortLabel ("W12"), noun, plural,
//   remapYears, dictionaryBase ("/dictionary"), root() -> element,
//   character (mutable holder, start {status: "idle"}), metricById (null; filled lazily)
window.WardWiseReportDomains = (function () {
  "use strict";

  const CHANGE_FLOOR_YEAR = 2015; // don't chase vintages older than this for the trend column
  const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  function create(ctx) {
  function manifestCtx() {
    const m = ctx.manifest;
    return {
      metricDataYears: m.metric_data_years || {},
      forwardCarryYears: m.forward_carry_years ?? 3,
      timeInvariantMetrics: new Set(m.time_invariant_metrics || []),
      metricValidFrom: m.metric_valid_from || {},
    };
  }

  // Last two measured vintages (floored) — the honest trend window for one metric, or null.
  function trendWindow(metricId) {
    const years = (manifestCtx().metricDataYears[metricId] || []).map(Number).sort((a, b) => a - b);
    if (years.length < 2) return null;
    const to = years[years.length - 1];
    const from = years[years.length - 2];
    if (from < CHANGE_FLOOR_YEAR) return null;
    return { from, to };
  }

  function cell(yearKey, wardId, metricId) {
    return ctx.slices[yearKey]?.[wardId]?.[metricId] ?? null;
  }

  function wardValues(yearKey, metricId) {
    const slice = ctx.slices[yearKey] || {};
    const values = [];
    for (const wardId of Object.keys(slice)) {
      const c = slice[wardId]?.[metricId];
      if (c && Number.isFinite(c.v)) values.push(c.v);
    }
    return values;
  }

  function mean(values) {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }

  // One metric's report row facts, or null when the ward has no value.
  function rowFacts(metric) {
    const id = metric.metric_id;
    const latest = cell("latest", ctx.areaId, id);
    if (!latest || !Number.isFinite(latest.v)) return null;
    const peers = wardValues("latest", id);
    const average = mean(peers);
    const window_ = trendWindow(id);
    let trend = null;
    let exclusion = null;
    if (window_) {
      const reason = WardWiseExplorer.yearMath.deltaExclusionReason(manifestCtx(), id, window_.from, window_.to);
      if (reason) {
        exclusion = reason;
      } else {
        const from = cell(String(window_.from), ctx.areaId, id);
        const to = cell(String(window_.to), ctx.areaId, id);
        if (from && to && Number.isFinite(from.v) && Number.isFinite(to.v)) {
          const fromSlice = ctx.slices[String(window_.from)] || {};
          const deltas = [];
          for (const wardId of Object.keys(fromSlice)) {
            const a = fromSlice[wardId]?.[id];
            const b = ctx.slices[String(window_.to)]?.[wardId]?.[id];
            if (a && b && Number.isFinite(a.v) && Number.isFinite(b.v)) deltas.push(b.v - a.v);
          }
          trend = {
            ...window_,
            fromValue: from.v,
            toValue: to.v,
            delta: to.v - from.v,
            averageDelta: mean(deltas),
            peerDeltas: deltas,
          };
        }
      }
    } else if (manifestCtx().timeInvariantMetrics.has(id)) {
      exclusion = "constant by definition";
    } else if ((manifestCtx().metricDataYears[id] || []).length < 2) {
      exclusion = "not remeasured yet";
    }
    return { metric, value: latest.v, score: latest.s, average, peers, trend, exclusion };
  }

  function humanizeDomain(category) {
    return (category || "other").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function domainSummaryHtml(rows) {
    // At-a-glance tallies: leading/lagging vs the average ${ctx.noun} (levels), improving/declining
    // (the ward's own movement, direction-aware). Ties/rank-only cases count in neither.
    let leading = 0, lagging = 0, improving = 0, declining = 0;
    for (const facts of rows) {
      const level = advantage(facts.metric, facts.value, facts.average);
      if (level != null && Math.abs(level) > 1e-9) (level > 0 ? leading++ : lagging++);
      if (facts.trend) {
        const move = advantage(facts.metric, facts.trend.delta, 0);
        if (move != null && Math.abs(move) > 1e-9) (move > 0 ? improving++ : declining++);
      }
    }
    // Two compact glyphs instead of a sentence: a stacked lead/lag bar (position vs the average
    // ward) and paired trend arrows (the ward's own movement). Numbers survive in the title.
    // Both cells always render (empty when there's nothing to show) so the grid columns stay
    // occupied and every row's bar and arrows sit at the same x.
    const bar = leading + lagging
      ? `<span class="tally-bar" title="${leading} leading · ${lagging} lagging vs the average ${ctx.noun}">
           <span class="tally-lead" style="flex:${leading}"></span>
           <span class="tally-lag" style="flex:${lagging}"></span>
         </span>`
      : `<span class="tally-bar is-empty"></span>`;
    const trendGlyph = improving + declining
      ? `<span class="tally-trend" title="${improving} improving · ${declining} declining">
           <span class="t-up">▲${improving}</span><span class="t-down">▼${declining}</span>
         </span>`
      : `<span class="tally-trend"></span>`;
    return `<span class="wardreport-domain-summary">${bar}${trendGlyph}</span>`;
  }

  // Equal-weight domain index --------------------------------------------------
  // Mean of the direction-adjusted 0-100 scores (the explorer's own normalization) across the
  // domain's measured metrics — every metric weighted equally, NOT the reader's map weights.
  // Rank compares the same equal-weight mean computed for every ward (each over its own measured
  // values, the same tolerance computeScores uses).
  function domainIndexFacts(domain, rows) {
    const ids = rows.map((f) => f.metric.metric_id);
    const slice = ctx.slices.latest || {};
    const perWard = [];
    for (const wardId of Object.keys(slice)) {
      const scores = ids.map((id) => slice[wardId]?.[id]?.s).filter(Number.isFinite);
      if (scores.length) perWard.push({ wardId, index: mean(scores) });
    }
    const mine = perWard.find((p) => p.wardId === ctx.areaId);
    if (!mine) return null;
    const rank = 1 + perWard.filter((p) => p.index > mine.index + 1e-9).length;
    const total = (ctx.metrics)
      .filter((m) => (m.category || "other") === domain).length;
    return { index: mine.index, rank, of: perWard.length,
             measured: rows.length, total, muted: rows.length < 3 };
  }

  function tercileClass(idx) {
    return WardWiseScoring.tercile(idx);
  }

  // The snapshot: one radial bloom, a petal per domain, radius = equal-weight index. Drawn by the
  // shared chart kit so the index page's fingerprints are the same shape as this bloom.
  function toplineHtml(domains, wardNumber) {
    const rows = domains.filter((d) => d.idx).map((d) => ({ domain: d.domain, ...d.idx }));
    return WardWiseCharts.bloom(rows, { label: wardNumber });
  }

  // Signed comparison helpers -------------------------------------------------
  // Colour, not prose, carries good/bad: green = better than the average ${ctx.noun} for this metric's
  // direction, red = worse. Text stays numeric so the eye reads figures, not sentences.
  // Two different questions were sharing one symbol, which is why a faster-falling crime rate
  // read as "−21%" in green. Each symbol now carries exactly one meaning:
  //   ▲ ▼  movement of the metric itself (arithmetic — crime fell)
  //   + −  ADVANTAGE over the comparison (quality — this ward did better)
  //   colour reinforces advantage
  // advantage() is the whole rule: flip the arithmetic difference for lower-is-better metrics, so
  // positive always means better regardless of the metric's direction or the sign of the values.
  function advantage(metric, value, reference) {
    if (!Number.isFinite(value) || !Number.isFinite(reference)) return null;
    const diff = value - reference;
    return metric.direction === "lower" ? -diff : diff;
  }

  function toneClass(metric, value, reference) {
    const good = advantage(metric, value, reference);
    if (good == null || Math.abs(good) < 1e-9) return "is-flat";
    return good > 0 ? "is-good" : "is-bad";
  }

  function formatPercent(pct) {
    return `${pct >= 100 ? Math.round(pct) : pct.toFixed(pct < 10 ? 1 : 0)}%`;
  }

  // Where this ward sits among its peers on a quantity, counting from the good end. Rank is
  // defined no matter the signs or scale, which is why it can rescue a ratio that can't be.
  function rankAmong(metric, value, peers) {
    const values = peers.filter(Number.isFinite);
    if (values.length < 2) return null;
    const better = metric.direction === "lower"
      ? values.filter((v) => v < value).length
      : values.filter((v) => v > value).length;
    return { position: better + 1, total: values.length };
  }

  // A ratio only means something when both quantities sit on the same side of zero and the
  // reference isn't a rounding artefact. When the city moved one way and the ward the other
  // ("+267% better" than a worsening average), percentage is noise — rank still answers the
  // question the column asks, so the cell falls back to it rather than printing nonsense.
  function ratioIsMeaningful(value, reference) {
    if (!Number.isFinite(value) || !Number.isFinite(reference)) return false;
    if (Math.abs(reference) < 1e-9) return false;
    if (value !== 0 && Math.sign(value) !== Math.sign(reference)) return false;
    return Math.abs((value - reference) / reference) * 100 <= 200;
  }

  // One comparison cell: value against a reference (the average ${ctx.noun}'s level, or the average
  // ward's change), signed by advantage.
  function comparisonHtml(metric, value, reference, fmt, peers, words) {
    const noun = words?.noun || ctx.noun;
    const plural = words?.plural || ctx.plural;
    const good = advantage(metric, value, reference);
    if (good == null) return `<span class="wardreport-na">—</span>`;
    const diff = value - reference;
    const flat = Math.abs(diff) < 1e-9;
    const rank = peers ? rankAmong(metric, value, peers) : null;
    const usable = !flat && ratioIsMeaningful(value, reference);
    const showRank = !flat && !usable && rank != null;
    // A rank already reads directionally (#1 is best), so it takes no +/- prefix — colour alone
    // carries better-or-worse there.
    const sign = flat || showRank ? "" : good > 0 ? "+" : "−";
    const magnitude = flat ? "0%"
      : usable ? formatPercent(Math.abs(diff / reference) * 100)
        : showRank ? `#${rank.position}`
          : fmt(Math.abs(diff));
    // The tooltip carries the plain arithmetic, so the sign convention never hides the facts.
    const higher = diff > 0 ? "higher" : diff < 0 ? "lower" : "even";
    const title = `${fmt(value)} vs ${fmt(reference)} — ${higher}`
      + (flat ? "" : `, which is ${good > 0 ? "better" : "worse"} here`)
      + (rank ? ` · ${rank.position} of ${rank.total} ${plural}` : "")
      + (usable || flat ? "" : " · percentages don't apply across a sign change, so the rank is shown");
    const cls = usable || flat ? "wardreport-rel" : "wardreport-rel wardreport-rank";
    return `<span class="${cls} ${toneClass(metric, value, reference)}" title="${esc(title)}">${sign}${magnitude}</span>`;
  }

  // Level formatting rounds a small change to "0" (a +0.05 per-10k move reads as zero while the
  // comparison column says +40%). Deltas keep 2 significant digits: format zero with the metric's
  // own formatter to learn its unit template, then swap the precise number into it.
  function formatDelta(v, metric) {
    const abs = Math.abs(v);
    if (abs >= 1 || abs === 0) return WardWiseExplorer.formatMetricValue(v, metric);
    const digits = abs >= 0.1 ? 2 : abs >= 0.01 ? 3 : 4;
    const compact = String(Number(abs.toFixed(digits)));
    return WardWiseExplorer.formatMetricValue(0, metric).replace(/0(?![\d.])/, compact);
  }

  // Some metrics point at a partner site that shows the underlying records for THIS ward — the
  // only per-ward outbound link in the report, so it hangs off the metric label rather than
  // claiming a column of its own.
  function exploreLinkHtml(metric) {
    const explore = metric?.explore;
    const template = explore?.ward_url_template;
    if (!template || !ctx.areaId || ctx.areaType !== "ward") return "";
    const ward = ctx.areas.find((w) => ctx.idOf(w) === ctx.areaId);
    const wardNumber = Number(ward?.ward_number || ctx.areaId);
    if (!Number.isFinite(wardNumber)) return "";
    const url = template.replaceAll("{ward_number}", String(wardNumber));
    const label = explore.label || "partner site";
    return ` <a class="wardreport-explore" href="${esc(url)}" target="_blank" rel="noopener noreferrer"
      title="Ward ${wardNumber} on ${esc(label)}${explore.note ? ` — ${esc(explore.note)}` : ""}">${esc(label)} ↗</a>`;
  }

  function rowHtml(facts) {
    const { metric, value, average, trend, exclusion } = facts;
    const fmt = (v) => WardWiseExplorer.formatMetricValue(v, metric);
    const fmtD = (v) => formatDelta(v, metric);
    const icon = window.WardWiseIcons ? window.WardWiseIcons.svg(metric) : "";
    const vsAvg = average == null
      ? `<span class="wardreport-na">—</span>`
      : comparisonHtml(metric, value, average, fmt, facts.peers);

    let changeCell = `<span class="wardreport-na">n/a<sup>*</sup></span>`;
    let changeAvgCell = `<span class="wardreport-na">—</span>`;
    let changeRelCell = `<span class="wardreport-na">—</span>`;
    if (trend) {
      const arrow = trend.delta > 0 ? "▲" : trend.delta < 0 ? "▼" : "―";
      // The measurement window lives in the tooltip — printing it under every row was the
      // single biggest source of visual noise in the table.
      // The arrow is the metric's movement; the colour is whether that movement was good.
      changeCell = `<span class="wardreport-trend ${toneClass(metric, trend.delta, 0)}"
        title="${esc(metric.label)} ${trend.from}→${trend.to}: ${fmt(trend.fromValue)} → ${fmt(trend.toValue)}">${arrow} ${fmtD(Math.abs(trend.delta))}</span>`;
      if (trend.averageDelta != null) {
        const avgArrow = trend.averageDelta > 0 ? "▲" : trend.averageDelta < 0 ? "▼" : "―";
        changeAvgCell = `<span class="wardreport-avg" title="average ${ctx.noun}, ${trend.from}→${trend.to}">${avgArrow} ${fmtD(Math.abs(trend.averageDelta))}</span>`;
        changeRelCell = comparisonHtml(metric, trend.delta, trend.averageDelta, fmtD, trend.peerDeltas);
      }
    } else if (exclusion === "constant by definition") {
      changeCell = `<span class="wardreport-na">fixed</span>`;
    }

    return `
      <div class="wardreport-row">
        <span class="wardreport-label">${icon}<a href="${ctx.dictionaryBase || "/dictionary"}?metric=${esc(metric.metric_id)}"
          title="${esc(metric.label)} — open its dictionary entry">${esc(metric.label)}</a>${exploreLinkHtml(metric)}</span>
        <span class="wardreport-num"><strong>${fmt(value)}</strong></span>
        <span class="wardreport-num wardreport-avg">${average == null ? "—" : fmt(average)}</span>
        <span class="wardreport-num">${vsAvg}</span>
        <span class="wardreport-num">${changeCell}</span>
        <span class="wardreport-num">${changeAvgCell}</span>
        <span class="wardreport-num">${changeRelCell}</span>
      </div>`;
  }

  function headerHtml() {
    return `
      <div class="wardreport-row wardreport-head">
        <span></span>
        <span class="wardreport-num">This ${ctx.noun}</span>
        <span class="wardreport-num">Avg ${ctx.noun}</span>
        <span class="wardreport-num" title="+ means better than the average ${ctx.noun}">vs avg</span>
        <span class="wardreport-num">Change</span>
        <span class="wardreport-num">Avg change</span>
        <span class="wardreport-num" title="+ means this ${ctx.noun}'s change beat the average ${ctx.noun}'s">vs avg</span>
      </div>`;
  }

  // --- "best light" greedy index (B3) ---------------------------------------
  function bestLight() {
    const slice = ctx.slices.latest || {};
    const wardIds = Object.keys(slice);
    const eligible = (ctx.metrics).filter((m) => {
      const own = slice[ctx.areaId]?.[m.metric_id];
      if (!own || !Number.isFinite(own.s)) return false;
      let populated = 0;
      for (const wardId of wardIds) if (Number.isFinite(slice[wardId]?.[m.metric_id]?.s)) populated += 1;
      return populated >= Math.ceil(0.8 * wardIds.length);
    });
    const scoreFor = (wardId, picked) => {
      const scores = picked
        .map((m) => slice[wardId]?.[m.metric_id]?.s)
        .filter((s) => Number.isFinite(s));
      return scores.length === picked.length ? mean(scores) : null;
    };
    const rankFor = (picked) => {
      const own = scoreFor(ctx.areaId, picked);
      if (own == null) return { rank: wardIds.length, margin: -Infinity };
      let rank = 1;
      let bestOther = -Infinity;
      for (const wardId of wardIds) {
        if (wardId === ctx.areaId) continue;
        const other = scoreFor(wardId, picked);
        if (other != null) {
          if (other > own) rank += 1;
          if (other > bestOther) bestOther = other;
        }
      }
      return { rank, margin: own - bestOther };
    };
    const picked = [];
    while (picked.length < 5 && eligible.length) {
      let best = null;
      for (const candidate of eligible) {
        if (picked.includes(candidate)) continue;
        const result = rankFor([...picked, candidate]);
        if (!best
          || result.rank < best.result.rank
          || (result.rank === best.result.rank && result.margin > best.result.margin)
          || (result.rank === best.result.rank && result.margin === best.result.margin
              && candidate.metric_id < best.candidate.metric_id)) {
          best = { candidate, result };
        }
      }
      if (!best) break;
      picked.push(best.candidate);
    }
    return { picked, result: rankFor(picked) };
  }

  function bestLightHtml(wardLabel) {
    const { picked, result } = bestLight();
    if (picked.length < 5) return "";
    const slice = ctx.slices.latest || {};
    const items = picked
      .map((m) => {
        const s = slice[ctx.areaId]?.[m.metric_id]?.s ?? 0;
        return `<li>${esc(m.label)} <span class="wardreport-vs">(${s.toFixed(0)}/100)</span></li>`;
      })
      .join("");
    const standing = result.rank === 1 ? `#1 of ${Object.keys(slice).length} ${ctx.plural}`
      : `#${result.rank} of ${Object.keys(slice).length} — its ceiling`;
    return `
      <h3 class="wardreport-domain">This ${ctx.noun}'s best light</h3>
      <p class="wardreport-bestlight-note">The five measures that flatter ${esc(wardLabel)} most — every
        ${ctx.noun} gets to cherry-pick here. Weighted equally, they make it <strong>${standing}</strong>.</p>
      <ol class="wardreport-bestlight">${items}</ol>`;
  }

  // --- "How this neighborhood is changing" (long-run business mix) -----------
  // Licences (city records by ward, 2002→today), County Business Patterns (federal ZIP data
  // apportioned onto wards — trust the shape, not the level) and the Google Maps sweep (a
  // current-day storefront count) drawn side by side, one line per source, deliberately never
  // merged — the same rule measure_families.py enforces in the catalog. Ids listed here that the
  // catalog doesn't publish yet (planned pipeline additions) simply don't render until they land.
  const CHARACTER_GROUPS = [
    { key: "total_businesses", headline: true,
      licenses: "licensed_businesses_total_per_10000_residents",
      cbp: "total_establishments_per_10000_residents" },
    // Both lines are licence data (openings: first-ever licence per business unit; closings:
    // last expiration with no later transaction, lagged two years) — the source-slot machinery
    // is reused for the two flows, with variant labels overriding the source names.
    { key: "business_churn", headline: true, label: "Openings vs closings",
      licenses: "business_openings_per_10000_residents", licensesVariant: "openings",
      cbp: "business_closures_per_10000_residents", cbpVariant: "closings" },
    { key: "bars", licenses: "licensed_bars_per_10000_residents",
      cbp: "bars_per_10000_residents", sweep: "dedicated_bars_count", sweepCount: true },
    { key: "coffee_shops", licenses: "licensed_coffee_shops_per_10000_residents",
      cbp: "coffee_snack_per_10000_residents", sweep: "coffee_shops_count", sweepCount: true },
    { key: "grocery_stores", licenses: "licensed_grocery_stores_per_10000_residents",
      cbp: "grocery_stores_per_10000_residents" },
    { key: "gyms", licenses: "licensed_gyms_per_10000_residents",
      cbp: "gyms_per_10000_residents", sweep: "fitness_places_per_10000_residents" },
    { key: "food_businesses", licenses: "licensed_food_businesses_per_10000_residents" },
    { key: "restaurants_liquor", licenses: "licensed_restaurants_liquor_per_10000_residents" },
    { key: "restaurants", cbp: "restaurants_per_10000_residents" },
    { key: "packaged_liquor", licenses: "licensed_packaged_liquor_per_10000_residents",
      cbp: "liquor_stores_per_10000_residents" },
    { key: "child_care", licenses: "licensed_child_care_per_10000_residents",
      cbp: "childcare_per_10000_residents" },
    { key: "amusement_venues", licenses: "licensed_amusement_venues_per_10000_residents" },
    { key: "music_dance", licenses: "licensed_music_dance_per_10000_residents" },
    { key: "outdoor_patios", licenses: "licensed_outdoor_patios_per_10000_residents" },
    { key: "tobacco_retail", licenses: "licensed_tobacco_retail_per_10000_residents" },
    { key: "pawnbrokers", licenses: "licensed_pawnbrokers_per_10000_residents" },
    { key: "secondhand_dealers", licenses: "licensed_secondhand_dealers_per_10000_residents" },
    { key: "auto_services", licenses: "licensed_auto_services_per_10000_residents" },
    { key: "congregations", cbp: "congregations_per_10000_residents" },
    { key: "bank_branches", cbp: "bank_branches_per_10000_residents" },
    { key: "laundromats", cbp: "laundromats_per_10000_residents" },
    { key: "hair_beauty", cbp: "hair_and_beauty_per_10000_residents" },
    { key: "pharmacies", cbp: "pharmacies_per_10000_residents" },
    { key: "hotels", cbp: "hotels_per_10000_residents" },
    { key: "chain_share", pct: true,
      licenses: "licensed_chain_restaurant_share_pct", sweep: "chain_restaurant_share_pct" },
  ];
  const CC_SOURCE_SHORT = { licenses: "licences", cbp: "CBP", sweep: "sweep" };
    // The licence dataset begins in 2002, so its 2002 reference date misses every licence issued
  // earlier that was still active — citywide counts sit at ~30% of 2003 across all categories.
  // The left-censored vintage is clipped here (and FIRST_YEAR in the pipeline starts at 2003).
  const CC_LICENSE_FLOOR_YEAR = 2003;

  function metricInfo(metricId) {
    if (!ctx.metricById) {
      ctx.metricById = new Map((ctx.metrics).map((m) => [m.metric_id, m]));
    }
    return metricId ? ctx.metricById.get(metricId) : null;
  }

  function ccGroupLabel(group) {
    if (group.label) return group.label;
    for (const src of ["licenses", "cbp", "sweep"]) {
      const met = metricInfo(group[src]);
      if (met?.measure_family_label) return met.measure_family_label;
    }
    // fall back to the first member's label, shorn of its "(source)" suffix
    for (const src of ["licenses", "cbp", "sweep"]) {
      const met = metricInfo(group[src]);
      if (met?.label) return met.label.replace(/\s*\((licensed|business licences?)\)\s*$/i, "");
    }
    return group.key.replaceAll("_", " ");
  }

  // The catalog spells the per-10k unit two ways ("rate_per_10000" for CBP, "per 10k residents"
  // for licences); formatMetricValue only knows the first, so normalise before formatting.
  function ccMet(met) {
    if (met && met.unit !== "rate_per_10000" && /per 10k/i.test(met.unit || "")) {
      return { ...met, unit: "rate_per_10000" };
    }
    return met;
  }

  function ccVariant(group, src) {
    if (group[`${src}Variant`]) return group[`${src}Variant`];
    const met = metricInfo(group[src]);
    if (met?.source_variant) return met.source_variant;
    return { licenses: "business licences", cbp: "County Business Patterns", sweep: "Google Maps sweep" }[src];
  }

  function characterMetricIds() {
    const ids = [];
    for (const group of CHARACTER_GROUPS) {
      for (const src of ["licenses", "cbp", "sweep"]) {
        if (group[src] && metricInfo(group[src])) ids.push(group[src]);
      }
    }
    return ids;
  }

  // Reshape the timeline payload into per-metric {wards: {wardId: {year: value}}, years, avg}.
  // Licence rate metrics are ZERO-FILLED for measured years: the pipeline only emits an
  // observation where at least one licensed business exists, so a missing ward-year means
  // "none licensed here" (a real zero), not "not measured". Percent metrics are never filled —
  // there a gap means suppression (fewer than 10 restaurants) and must stay a gap. CBP already
  // emits every ward every year.
  function reshapeCharacterTimeline(data) {
    const sweepIds = new Set(CHARACTER_GROUPS.map((g) => g.sweep).filter(Boolean));
    const snapshots = data.snapshots || [];
    const yearOf = (snap, isSweep) => {
      if (!snap) return null;
      const stamp = snap.period_end || (isSweep ? snap.collected_at : null);
      const year = Number(String(stamp || "").slice(0, 4));
      return Number.isFinite(year) && year > 1900 ? year : null;
    };
    const byMetric = {};
    for (const series of data.series || []) {
      const isSweep = sweepIds.has(series.metric_id);
      const isLicense = series.metric_id.startsWith("licensed_");
      const entry = (byMetric[series.metric_id] ||= { wards: {}, years: new Set() });
      (series.values || []).forEach((value, i) => {
        const v = Number(value);
        if (value == null || !Number.isFinite(v)) return;
        const year = yearOf(snapshots[i], isSweep);
        if (year == null) return;
        if (isLicense && year < CC_LICENSE_FLOOR_YEAR) return;
        (entry.wards[series.area_id] ||= {})[year] = v;
        entry.years.add(year);
      });
    }
    for (const group of CHARACTER_GROUPS) {
      const entry = !group.pct && byMetric[group.licenses];
      if (!entry) continue;
      for (const ward of ctx.areas) {
        const record = (entry.wards[ctx.idOf(ward)] ||= {});
        for (const year of entry.years) if (!(year in record)) record[year] = 0;
      }
    }
    let xMin = Infinity, xMax = -Infinity;
    for (const entry of Object.values(byMetric)) {
      entry.years = [...entry.years].sort((a, b) => a - b);
      entry.avg = {};
      for (const year of entry.years) {
        const values = Object.values(entry.wards).map((r) => r[year]).filter(Number.isFinite);
        if (values.length) entry.avg[year] = mean(values);
      }
      if (entry.years.length) {
        xMin = Math.min(xMin, entry.years[0]);
        xMax = Math.max(xMax, entry.years[entry.years.length - 1]);
      }
    }
    return { byMetric, xDomain: xMax >= xMin ? [xMin, xMax] : null };
  }

  async function loadCharacterTimeline() {
    if (ctx.character.status !== "idle") return;
    ctx.character = { status: "loading" };
    try {
      const metricIds = characterMetricIds();
      if (!metricIds.length) {
        ctx.character = { status: "ready", byMetric: {}, xDomain: null };
      } else {
        const data = await WardWiseExplorer.fetchTimeline({ metricIds, areaType: ctx.areaType });
        ctx.character = { status: "ready", ...reshapeCharacterTimeline(data) };
      }
    } catch (_error) {
      ctx.character = { status: "error" };
    }
    renderCharacterSection();
  }

  // Decade trend for one metric's record: mean of the last 3 measured years vs the mean of the
  // 3 measured years nearest (lastYear − 10). Multi-year means so a single odd vintage (a COVID
  // year, a data glitch) can't own the headline.
  function ccTrendWindows(entry) {
    if (!entry || entry.years.length < 2) return null;
    const last = entry.years[entry.years.length - 1];
    if (entry.years[0] > last - 8) return { tooNew: true, firstYear: entry.years[0] };
    const recent = entry.years.slice(-3);
    const target = last - 10;
    const baseline = [...entry.years]
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)
      .slice(0, 3)
      .sort((a, b) => a - b);
    return { recent, baseline };
  }

  function ccWindowMean(record, years) {
    const values = years.map((y) => record?.[y]).filter(Number.isFinite);
    return values.length === years.length ? mean(values) : null;
  }

  function ccTrend(metricId) {
    const entry = ctx.character.byMetric?.[metricId];
    const windows = ccTrendWindows(entry);
    if (!windows || windows.tooNew) return windows;
    const facts = (record) => {
      const recent = ccWindowMean(record, windows.recent);
      const baseline = ccWindowMean(record, windows.baseline);
      if (recent == null || baseline == null) return null;
      return { recent, baseline, change: recent - baseline };
    };
    const ward = facts(entry.wards[ctx.areaId]);
    const avg = facts(entry.avg);
    if (!ward) return null;
    return { ...windows, ward, avg };
  }

  // The one-number answer to "how much is this ward's character changing": the share of the
  // licensed business mix (across the categorised licence series) that turned over between the
  // baseline and recent windows — 0.5 · Σ|Δshare|. Derived at render from the same fetched
  // series (granular-first: no pipeline metric), and single-source, so it never splices.
  function ccMixTurnover(wardId) {
    const shares = { recent: [], baseline: [] };
    for (const group of CHARACTER_GROUPS) {
      if (group.pct || group.headline || !group.licenses) continue;
      const entry = ctx.character.byMetric?.[group.licenses];
      const windows = ccTrendWindows(entry);
      if (!windows || windows.tooNew) continue;
      const record = wardId === "__avg__" ? entry.avg : entry.wards[wardId];
      const recent = ccWindowMean(record, windows.recent);
      const baseline = ccWindowMean(record, windows.baseline);
      if (recent == null || baseline == null) return null;
      shares.recent.push(recent);
      shares.baseline.push(baseline);
    }
    const sumRecent = shares.recent.reduce((a, b) => a + b, 0);
    const sumBaseline = shares.baseline.reduce((a, b) => a + b, 0);
    if (shares.recent.length < 4 || sumRecent <= 0 || sumBaseline <= 0) return null;
    let turnover = 0;
    for (let i = 0; i < shares.recent.length; i += 1) {
      turnover += Math.abs(shares.recent[i] / sumRecent - shares.baseline[i] / sumBaseline);
    }
    return turnover / 2;
  }

  function wardPopulationById() {
    const map = new Map();
    for (const ward of ctx.areas) {
      const pop = Number(ward.population);
      if (Number.isFinite(pop) && pop > 0) map.set(ctx.idOf(ward), pop);
    }
    return map;
  }

  // One margin-box chart per group. The x-domain is SHARED across every chart in the section so
  // shorter series visibly stop short of the frame (CBP ending in 2023, gyms starting in 2020)
  // instead of being stretched to fit.
  function ccChartHtml(group) {
    const c = ctx.character;
    const [x0, x1] = c.xDomain;
    const W = 460, H = 220, M = { l: 46, r: 76, t: 14, b: 26 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const px = (year) => M.l + ((year - x0) / Math.max(1, x1 - x0)) * iw;
    const groupLabel = ccGroupLabel(group);
    const populations = wardPopulationById();
    const fmt = (v, met) => WardWiseExplorer.formatMetricValue(v, met);

    const lines = [];   // {pts, src, who, met, label}
    for (const src of ["licenses", "cbp"]) {
      const met = ccMet(metricInfo(group[src]));
      const entry = c.byMetric[group[src]];
      if (!met || !entry || !entry.years.length) continue;
      const variant = ccVariant(group, src);
      for (const who of ["avg", "ward"]) {  // avg first so the ward line draws on top
        const record = who === "ward" ? entry.wards[ctx.areaId] || {} : entry.avg;
        const pts = entry.years.map((year) => ({
          year, value: Number.isFinite(record[year]) ? record[year] : null,
        }));
        if (!pts.some((p) => p.value != null)) continue;
        lines.push({ pts, src, who, met, variant,
          label: `${groupLabel} (${variant}) — ${who === "ward" ? ctx.label : "average ${ctx.noun}"}` });
      }
    }
    const markers = [];  // sweep: one diamond per (year, who) — a line once more quarters exist
    const sweepMet = metricInfo(group.sweep);
    const sweepEntry = c.byMetric[group.sweep];
    if (sweepMet && sweepEntry && (!group.sweepCount || populations.size)) {
      const variant = ccVariant(group, "sweep");
      const convert = (wardId, value) => {
        if (!group.sweepCount) return value;
        const pop = populations.get(wardId);
        return pop ? (value / pop) * 10000 : null;
      };
      for (const year of sweepEntry.years) {
        const own = sweepEntry.wards[ctx.areaId]?.[year];
        if (Number.isFinite(own)) {
          const v = convert(ctx.areaId, own);
          if (v != null) markers.push({ year, value: v, who: "ward", raw: own,
            label: `${groupLabel} (${variant}) — ${ctx.label}` });
        }
        const converted = Object.entries(sweepEntry.wards)
          .map(([wardId, record]) => Number.isFinite(record[year]) ? convert(wardId, record[year]) : null)
          .filter(Number.isFinite);
        if (converted.length) markers.push({ year, value: mean(converted), who: "avg",
          label: `${groupLabel} (${variant}) — average ${ctx.noun}` });
      }
    }
    if (!lines.length && !markers.length) return "";

    const everyValue = [
      ...lines.flatMap((l) => l.pts.map((p) => p.value).filter(Number.isFinite)),
      ...markers.map((mk) => mk.value),
    ];
    const yMax = Math.max(...everyValue, 0) * 1.08 || 1;
    const py = (v) => M.t + ih - (Math.max(0, v) / yMax) * ih;
    const anyMet = lines[0]?.met || sweepMet;
    const fmtAxis = (v) => group.pct ? `${Math.round(v)}%`
      : v >= 100 ? String(Math.round(v)) : String(Number(v.toFixed(1)));

    let svg = "";
    // gridlines + y labels at 0 / half / max
    for (const v of [0, yMax / 2, yMax]) {
      const y = py(v).toFixed(1);
      svg += `<line class="cc-grid" x1="${M.l}" y1="${y}" x2="${W - M.r}" y2="${y}"/>
        <text class="cc-axis" x="${M.l - 5}" y="${y}" text-anchor="end" dominant-baseline="middle">${fmtAxis(v)}</text>`;
    }
    // x ticks: spaced round steps from the shared domain
    const step = Math.max(4, Math.ceil((x1 - x0) / 4));
    for (let year = x0; year <= x1; year += step) {
      svg += `<text class="cc-axis" x="${px(year).toFixed(1)}" y="${H - M.b + 14}" text-anchor="middle">${year}</text>`;
    }
    if ((x1 - x0) % step !== 0) {
      svg += `<text class="cc-axis" x="${px(x1).toFixed(1)}" y="${H - M.b + 14}" text-anchor="middle">${x1}</text>`;
    }
    for (const year of ctx.remapYears || []) {
      if (year <= x0 || year >= x1) continue;
      svg += `<line class="cc-remap" x1="${px(year).toFixed(1)}" y1="${M.t}" x2="${px(year).toFixed(1)}" y2="${H - M.b}">
        <title>Ward boundaries changed in ${year}; all years are drawn on today's map</title></line>`;
    }

    for (const line of lines) {
      // split at nulls so a suppressed year stays a visible gap, never a bridge
      const segments = [];
      let current = [];
      for (const p of line.pts) {
        if (p.value == null) { if (current.length) segments.push(current); current = []; }
        else current.push(p);
      }
      if (current.length) segments.push(current);
      const cls = `cc-${line.src} cc-${line.who}`;
      let g = "";
      for (const segment of segments) {
        const coords = segment.map((p) => `${px(p.year).toFixed(1)},${py(p.value).toFixed(1)}`).join(" ");
        if (segment.length > 1) {
          g += `<polyline class="cc-hit" points="${coords}" fill="none" stroke="transparent" stroke-width="10" pointer-events="stroke"></polyline>
            <polyline class="cc-line ${cls}" points="${coords}" fill="none"></polyline>`;
        }
        for (const p of segment) {
          g += `<circle class="cc-point ${cls}" cx="${px(p.year).toFixed(1)}" cy="${py(p.value).toFixed(1)}" r="2.4"
            data-label="${esc(line.label)}" data-value="${esc(fmt(p.value, line.met))}" data-year="${p.year}"></circle>`;
        }
      }
      const lastPoint = [...line.pts].reverse().find((p) => p.value != null);
      if (lastPoint && line.who === "ward") {
        const endText = lastPoint.year < x1 - 1
          ? `${CC_SOURCE_SHORT[line.src]} · ${lastPoint.year}`
          : fmt(lastPoint.value, line.met);
        svg += g + `<text class="cc-endlabel cc-${line.src}" x="${(px(lastPoint.year) + 5).toFixed(1)}"
          y="${py(lastPoint.value).toFixed(1)}" dominant-baseline="middle">${esc(endText)}</text>`;
      } else {
        svg += g;
      }
    }
    for (const mk of markers) {
      const x = px(mk.year), y = py(mk.value);
      svg += `<path class="cc-marker cc-sweep cc-${mk.who}"
        d="M${x.toFixed(1)} ${(y - 4.5).toFixed(1)} L${(x + 4.5).toFixed(1)} ${y.toFixed(1)} L${x.toFixed(1)} ${(y + 4.5).toFixed(1)} L${(x - 4.5).toFixed(1)} ${y.toFixed(1)} Z"
        data-label="${esc(mk.label)}" data-value="${esc(fmt(mk.value, group.sweepCount ? { unit: "rate_per_10000" } : ccMet(sweepMet)))}"
        data-year="${mk.year}"></path>`;
    }
    svg += `<line class="cc-baseline" x1="${M.l}" y1="${py(0).toFixed(1)}" x2="${W - M.r}" y2="${py(0).toFixed(1)}"/>`;
    const unitNote = group.pct ? "%" : (anyMet?.unit === "rate_per_10000" ? "per 10k residents" : "");
    return `<figure class="charchange-chart${group.headline ? " is-headline" : ""}">
      <figcaption>${esc(groupLabel)}${unitNote ? ` <small>${esc(unitNote)}</small>` : ""}</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(groupLabel)} over time">${svg}</svg>
    </figure>`;
  }

  function ccChangeCellHtml(facts, met) {
    const { change, baseline } = facts;
    const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "―";
    const usable = ratioIsMeaningful(facts.recent, baseline);
    const text = usable
      ? formatPercent(Math.abs(change / baseline) * 100)
      : formatDelta(Math.abs(change), met);
    return `${arrow} ${change === 0 ? "" : change > 0 ? "+" : "−"}${text}`;
  }

  function ccTrendsHtml() {
    const rows = [];
    const tooNew = [];
    for (const group of CHARACTER_GROUPS) {
      if (group.pct || group.headline || !group.licenses) continue;
      const met = ccMet(metricInfo(group.licenses));
      if (!met) continue;
      const trend = ccTrend(group.licenses);
      if (!trend) continue;
      if (trend.tooNew) { tooNew.push(ccGroupLabel(group)); continue; }
      const magnitude = Math.abs(trend.ward.change) / Math.max(trend.ward.baseline, 0.25);
      rows.push({ group, met, trend, magnitude });
    }
    if (!rows.length) return { html: "", movers: [] };
    const EPS = 0.05;  // per-10k; below this the decade was flat
    const growing = rows.filter((r) => r.trend.ward.change > EPS)
      .sort((a, b) => b.magnitude - a.magnitude);
    const shrinking = rows.filter((r) => r.trend.ward.change < -EPS)
      .sort((a, b) => b.magnitude - a.magnitude);
    const steady = rows.filter((r) => Math.abs(r.trend.ward.change) <= EPS);
    const sample = rows[0].trend;
    const windowNote = `${sample.baseline[0]}–${sample.baseline[sample.baseline.length - 1]} vs ` +
      `${sample.recent[0]}–${sample.recent[sample.recent.length - 1]} averages, licence series`;
    const item = (r) => {
      const t = r.trend;
      const avgCell = t.avg ? ccChangeCellHtml(t.avg, r.met) : "—";
      const title = `${ctx.label}: ${formatDelta(t.ward.baseline, r.met)} → ` +
        `${formatDelta(t.ward.recent, r.met)}` + (t.avg
          ? ` · average ${ctx.noun}: ${formatDelta(t.avg.baseline, r.met)} → ${formatDelta(t.avg.recent, r.met)}` : "");
      return `<li title="${esc(title)}">
        <span class="cc-cat">${esc(ccGroupLabel(r.group))}</span>
        <span class="cc-delta">${ccChangeCellHtml(t.ward, r.met)}</span>
        <small class="cc-avg-note">avg ward ${avgCell}</small>
      </li>`;
    };
    const column = (title, list) => `<div class="charchange-col">
      <h4>${title}</h4>
      ${list.length ? `<ul>${list.map(item).join("")}</ul>` : "<p class=\"cc-none\">nothing here</p>"}
    </div>`;
    const extras = [];
    if (steady.length) extras.push(`Little changed: ${steady.map((r) => ccGroupLabel(r.group)).join(", ")}.`);
    if (tooNew.length) extras.push(`Too new to rank (first measured after ${(ctx.character.xDomain?.[1] ?? 0) - 8}): ${tooNew.join(", ")}.`);
    const html = `<div class="charchange-trends">
      ${column("Growing", growing)}
      ${column("Shrinking", shrinking)}
    </div>
    <p class="charchange-window">${esc(windowNote)}${extras.length ? ` · ${esc(extras.join(" "))}` : ""}</p>`;
    const movers = [...rows].sort((a, b) => b.magnitude - a.magnitude).map((r) => r.group);
    return { html, movers };
  }

  function ccTurnoverHtml() {
    const own = ccMixTurnover(ctx.areaId);
    if (own == null) return "";
    const perWard = ctx.areas
      .map((w) => ccMixTurnover(ctx.idOf(w)))
      .filter((v) => v != null);
    const avg = perWard.length ? mean(perWard) : null;
    const pct = (v) => `${Math.round(v * 100)}%`;
    return `<p class="charchange-turnover" title="0.5 × Σ|Δ share| across the categorised licence
      series between the decade-apart windows — the share of the licensed business mix that
      changed hands between categories.">
      <strong>${pct(own)}</strong> of this ${ctx.noun}'s licensed business mix turned over in the last
      decade${avg != null ? ` <span>(average ${ctx.noun}: ${pct(avg)})</span>` : ""}.</p>`;
  }

  function ccLegendHtml() {
    return `<div class="charchange-legend">
      <span><i class="cc-swatch cc-licenses cc-ward"></i>business licences</span>
      <span><i class="cc-swatch cc-cbp cc-ward"></i>County Business Patterns</span>
      <span><i class="cc-swatch cc-sweep-swatch"></i>Google Maps sweep</span>
      <span><i class="cc-swatch cc-licenses cc-avg"></i>average ${ctx.noun} (grey)</span>
    </div>`;
  }

  function characterSectionShellHtml() {
    return `<details class="wardreport-accordion wardreport-character" data-domain="character" open>
      <summary>
        <span class="wardreport-domain">How this neighborhood is changing</span>
        <span class="accordion-index"></span><span class="accordion-rank"></span>
        <span class="wardreport-domain-summary charchange-sub">business mix over time</span>
      </summary>
      <div id="wardreport-character-body"><p class="charchange-loading">Loading long-run business history…</p></div>
    </details>`;
  }

  function renderCharacterSection() {
    const host = ctx.root().querySelector("#wardreport-character-body");
    if (!host) return;
    const c = ctx.character;
    if (c.status === "loading" || c.status === "idle") return;
    if (c.status === "error") {
      host.innerHTML = "<p>Couldn't load the long-run business history — try reloading.</p>";
      return;
    }
    if (!c.xDomain) {
      host.innerHTML = "<p>No long-run business data is published yet.</p>";
      return;
    }
    const chartFor = (group) => ccChartHtml(group);
    const hasData = (group) => Boolean(chartFor(group));
    const headlines = CHARACTER_GROUPS.filter((g) => g.headline && hasData(g));
    const { html: trendsHtml, movers } = ccTrendsHtml();
    const moverGroups = movers.slice(0, 4).filter(hasData);
    const shown = new Set([...headlines.map((g) => g.key), ...moverGroups.map((g) => g.key)]);
    const rest = CHARACTER_GROUPS.filter((g) => !shown.has(g.key) && hasData(g));
    let html = "";
    if (headlines.length) {
      html += `<div class="charchange-headline">${headlines.map(chartFor).join("")}</div>`;
    }
    html += ccTurnoverHtml();
    html += trendsHtml;
    if (moverGroups.length) {
      html += `<h4 class="charchange-h">Biggest movers</h4>
        <div class="charchange-grid">${moverGroups.map(chartFor).join("")}</div>`;
    }
    if (rest.length) {
      html += `<details class="wardreport-accordion charchange-more">
        <summary><span class="wardreport-domain">All categories (${rest.length} more)</span>
          <span class="accordion-index"></span><span class="accordion-rank"></span><span></span></summary>
        <div class="charchange-grid">${rest.map(chartFor).join("")}</div>
      </details>`;
    }
    html += ccLegendHtml();
    html += `<p class="wardreport-footnote">Sources are shown side by side and deliberately never
      merged: <strong>business licences</strong> are city records tied to each licence's ward;
      <strong>County Business Patterns</strong> is federal ZIP-area data apportioned onto wards —
      approximate levels, trust the shape; the <strong>Google Maps sweep</strong> is a current-day
      storefront count (a single point until more quarterly sweeps land). All years are computed on
      today's ward boundaries — faint vertical rules mark the 2015 and 2023 remaps. Licence counts
      are as of March 12 each year, chosen to match County Business Patterns' reference date. Gaps
      in the chain-share line mean fewer than 10 licensed restaurants that year, too few to publish
      a share.</p>`;
    html += `<div class="timeline-tooltip" role="status" hidden></div>`;
    host.innerHTML = html;
    attachCcHoverHandlers(host);
  }

  function attachCcHoverHandlers(container) {
    const tooltip = container.querySelector(".timeline-tooltip");
    if (!tooltip) return;
    const show = (target) => {
      if (!target.dataset.label) return;
      tooltip.hidden = false;
      tooltip.innerHTML = `<strong>${esc(target.dataset.label)}</strong>
        <span>${esc(target.dataset.value)}</span><small>${esc(target.dataset.year)}</small>`;
    };
    container.querySelectorAll(".cc-point, .cc-marker").forEach((target) => {
      target.addEventListener("pointerenter", () => show(target));
      target.addEventListener("pointermove", (event) =>
        WardWiseExplorer.positionTimelineTooltip(event, tooltip, container));
      target.addEventListener("pointerleave", () => { tooltip.hidden = true; });
    });
  }


  // Every domain with its rows sorted strongest first, then the domains themselves.
  function domainFacts() {
    const byDomain = new Map();
    for (const metric of ctx.metrics) {
      const facts = rowFacts(metric);
      if (!facts) continue;
      const key = metric.category || "other";
      if (!byDomain.has(key)) byDomain.set(key, []);
      byDomain.get(key).push(facts);
    }
    // Strongest first, in both directions: domains by their index, metrics by their own score.
    // A reader scanning down sees where the ward wins before where it struggles.
    const domains = [...byDomain.keys()].map((domain) => {
      const rows = byDomain.get(domain).sort((a, b) => {
        const aScore = Number.isFinite(a.score) ? a.score : -1;
        const bScore = Number.isFinite(b.score) ? b.score : -1;
        return bScore - aScore || a.metric.label.localeCompare(b.metric.label);
      });
      return { domain, rows, idx: domainIndexFacts(domain, rows) };
    }).sort((a, b) => {
      const aIdx = a.idx ? a.idx.index : -1;
      const bIdx = b.idx ? b.idx.index : -1;
      return bIdx - aIdx || a.domain.localeCompare(b.domain);
    });
    return domains;
  }

  // Everything below the page's own header: bloom, accordions, footnote, character shell, best light.
  function bodyHtml(domains) {
    let html = toplineHtml(domains, ctx.shortLabel);
    for (const { domain, rows, idx } of domains) {
      // index and rank are separate cells so both columns line up down the page
      const tone = `${tercileClass(idx || {})}${idx && idx.muted ? " is-muted" : ""}`;
      const indexChip = idx
        ? `<span class="accordion-index ${tone}">${idx.index.toFixed(1)}</span>
           <span class="accordion-rank ${tone}">#${idx.rank} of ${idx.of}</span>`
        : `<span class="accordion-index"></span><span class="accordion-rank"></span>`;
      html += `<details class="wardreport-accordion" data-domain="${domain}">
        <summary>
          <span class="wardreport-domain">${humanizeDomain(domain)}</span>
          ${indexChip}
          ${domainSummaryHtml(rows)}
        </summary>
        ${headerHtml()}
        ${rows.map(rowHtml).join("")}
      </details>`;
    }
    html += `<p class="wardreport-footnote"><sup>*</sup> n/a = measured once so far, so there's no change
      yet. "fixed" = constant by definition. Change columns compare each metric's two most recent
      measurement years (hover for the years and values). In the <em>vs avg</em> columns <strong>+ means
      better</strong> and − means worse, whichever direction is good for that metric — so a crime rate
      below the average, or falling faster than the average, both read as +. Arrows (▲▼) show which way
      the metric itself moved. Where a percentage can't apply — the average moved one way and this ${ctx.noun}
      the other — the cell shows this ${ctx.noun}'s <strong>rank</strong> (#1 = best) instead. Metric names link
      to their dictionary entry.</p>`;
    html += characterSectionShellHtml();
    html += bestLightHtml(ctx.label);
    return html;
  }

  // After the body is in the DOM: load or redraw the long-run section and wire the bloom petals.
  function afterMount(el, domains) {
    // The long-run section fetches once (all wards in one request) and re-renders synchronously
    // on ward switches; the first load is deliberately AFTER first paint so it never delays the
    // metric table.
    if (ctx.character.status === "idle") loadCharacterTimeline();
    else renderCharacterSection();
    el.querySelectorAll("[data-domain-target]").forEach((petal) =>
      petal.addEventListener("click", () => {
        const target = el.querySelector(`.wardreport-accordion[data-domain="${petal.dataset.domainTarget}"]`);
        if (target) {
          target.open = true;
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }));
  }

  function mount(el, opts) {
    const domains = domainFacts();
    el.innerHTML = bodyHtml(domains) || `<p>No data for this ${ctx.noun} yet.</p>`;
    afterMount(el, domains);
    return domains;
  }

  return { domainFacts, bodyHtml, afterMount, mount, humanizeDomain, bestLight, trendWindow,
    math: { advantage, toneClass, formatPercent, ratioIsMeaningful, formatDelta, rankAmong, comparisonHtml } };
  }

  // Print: accordions must be open on paper. Cover both the button and Cmd/Ctrl-P via the
  // beforeprint/afterprint events, restoring the reader's open/closed state afterwards.
  let printInstalled = false;
  function installPrintHandlers() {
    if (printInstalled) return;
    printInstalled = true;
  // beforeprint/afterprint events, restoring the reader's open/closed state afterwards.
  let printRestore = null;
  window.addEventListener("beforeprint", () => {
    const accordions = [...document.querySelectorAll(".wardreport-accordion")];
    printRestore = accordions.map((a) => a.open);
    accordions.forEach((a) => { a.open = true; });
  });
  window.addEventListener("afterprint", () => {
    if (!printRestore) return;
    [...document.querySelectorAll(".wardreport-accordion")]
      .forEach((a, i) => { a.open = printRestore[i] ?? a.open; });
    printRestore = null;
  });
  }

  // Pure helpers, usable without a report (the change section formats deltas with them).
  const math = create({ manifest: {}, metrics: [], slices: {}, areaId: null, areas: [], idOf: () => "",
    areaType: "ward", noun: "ward", plural: "wards", label: "", shortLabel: "", remapYears: [],
    dictionaryBase: "", root: () => null, character: { status: "idle" }, metricById: null }).math;

  return { create, installPrintHandlers, CHANGE_FLOOR_YEAR, math };
})();
