// Chart builders shared by the mini report, the full report and the comparison page.
//
// Every chart is a string of raw SVG/HTML (no library): a viewBox with preserveAspectRatio="none"
// so it stretches to its container, vector-effect="non-scaling-stroke" so lines keep their weight,
// and zero-length round-capped lines where a circle would otherwise squash into an ellipse.
//
// Colors are never written as literals. Each builder reads the theme's chart tokens at render time
// through palette(), so a page that re-renders after a theme switch picks up the new values, and
// anything static uses `class` names styled in report_ui.css.
window.WardWiseCharts = (function () {
  const esc = (value) => window.WardWiseExplorer.escapeHtml(value == null ? "" : String(value));
  const scoring = () => window.WardWiseScoring;

  function token(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function palette() {
    return {
      ahead: token("--chart-ahead", "#4c1d95"),
      behind: token("--chart-behind", "#c2410c"),
      neutral: token("--chart-neutral", "#babac4"),
      you: token("--chart-you", "#4c1d95"),
      median: token("--chart-median", "#6f7683"),
      b: token("--chart-b", "#ea580c"),
      surface: token("--surface-raised", "#ffffff"),
      hair: token("--hair", "#e9ebef"),
      tick: token("--chart-tick", "#d5d8df"),
      gold: token("--gold-ink", "#a8801a"),
      silver: token("--silver-ink", "#7b8494"),
      bronze: token("--bronze-ink", "#a0602c"),
      up: token("--delta-up", "#15803d"),
      down: token("--delta-down", "#b91c1c"),
    };
  }

  // ---- domains ----
  const DOMAIN_SHORT = {
    community_vitality: "VITALITY", culture: "CULTURE", good_governance: "GOVERN",
    health: "HEALTH", lifelong_learning: "LEARNING", material_wellbeing: "MATERIAL",
    physical_environment: "ENVIRON", psychological_wellbeing: "PSYCH",
    religion_spiritual: "SPIRIT", social_connectedness: "SOCIAL", time_balance: "TIME",
  };

  function humanizeDomain(category) {
    return (category || "other").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ---- the bloom: one radial petal per domain, radius = equal-weight index ----
  // domains: [{domain, index, rank, of, measured, total, muted}] in FIXED alphabetical order, so
  // shapes compare across areas. Full mode is the report's snapshot (rings, labels, a title per
  // petal, petals clickable via data-domain-target). `mini` is the fingerprint on an index card:
  // same geometry, no furniture, one title for the whole thing, and an optional `lens` domain lit.
  function bloom(domains, opts = {}) {
    const rows = (domains || []).filter((d) => d && Number.isFinite(d.index));
    if (!rows.length) return "";
    const mini = Boolean(opts.mini);
    const C = 170, R0 = 26, RMAX = 118, LABEL_R = RMAX + 14;
    const polar = (r, a) => [C + r * Math.cos(a), C + r * Math.sin(a)];
    const fmt = (n) => (mini ? n.toFixed(0) : n.toFixed(1));
    const step = (Math.PI * 2) / rows.length;
    const gap = 0.055;  // radians of breathing room between petals
    let petals = "";
    const summary = [];
    rows.forEach((d, i) => {
      const a0 = -Math.PI / 2 + i * step + gap / 2;
      const a1 = a0 + step - gap;
      const r = R0 + ((RMAX - R0) * Math.max(0, Math.min(100, d.index))) / 100;
      const [x0i, y0i] = polar(R0, a0); const [x0o, y0o] = polar(r, a0);
      const [x1o, y1o] = polar(r, a1); const [x1i, y1i] = polar(R0, a1);
      const tone = `${scoring().tercile(d)}${d.muted ? " is-muted" : ""}`;
      const lens = mini && opts.lens === d.domain ? " is-lens" : "";
      const path = `M${fmt(x0i)} ${fmt(y0i)} L${fmt(x0o)} ${fmt(y0o)} A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x1o)} ${fmt(y1o)} L${fmt(x1i)} ${fmt(y1i)} A${R0} ${R0} 0 0 0 ${fmt(x0i)} ${fmt(y0i)} Z`;
      if (mini) {
        petals += `<path class="bloom-petal ${tone}${lens}" data-domain="${esc(d.domain)}" d="${path}"/>`;
        summary.push(`${DOMAIN_SHORT[d.domain] || humanizeDomain(d.domain)} ${d.index.toFixed(0)}`);
        return;
      }
      const mid = (a0 + a1) / 2;
      const [lx, ly] = polar(LABEL_R, mid);
      const anchor = Math.abs(Math.cos(mid)) < 0.35 ? "middle" : (Math.cos(mid) > 0 ? "start" : "end");
      petals += `<path class="bloom-petal ${tone}" data-domain-target="${esc(d.domain)}"
          d="${path}">
          <title>${esc(humanizeDomain(d.domain))} — ${d.index.toFixed(1)}, #${d.rank} of ${d.of} (${d.measured} of ${d.total} metrics${d.muted ? "; too few for an index" : ""})</title>
        </path>
        <text class="bloom-label" x="${fmt(lx)}" y="${fmt(ly)}" text-anchor="${anchor}" dominant-baseline="middle">${DOMAIN_SHORT[d.domain] || humanizeDomain(d.domain).slice(0, 7).toUpperCase()}</text>`;
    });
    if (mini) {
      return `<svg class="wardreport-bloom ww-bloom-mini${opts.className ? ` ${esc(opts.className)}` : ""}" viewBox="0 0 ${C * 2} ${C * 2}" role="img" aria-label="Domain fingerprint">` +
        `<title>${esc(summary.join(" · "))}</title>${petals}` +
        (opts.label ? `<text class="bloom-center" x="${C}" y="${C}" text-anchor="middle" dominant-baseline="central">${esc(opts.label)}</text>` : "") +
        `</svg>`;
    }
    const rings = [25, 50, 75].map((p) =>
      `<circle class="bloom-ring" cx="${C}" cy="${C}" r="${R0 + ((RMAX - R0) * p) / 100}"/>`).join("");
    // extra horizontal room in the viewBox: the side labels are anchored outward and were
    // clipping at the edges ("LEARNING" rendered as "ARNING")
    const PAD = 52;
    return `<svg class="wardreport-bloom" viewBox="${-PAD} 0 ${C * 2 + PAD * 2} ${C * 2}" role="img"
        aria-label="Domain strength bloom — tap a petal for that domain's detail">
        ${rings}${petals}
        <text class="bloom-center" x="${C}" y="${C}" text-anchor="middle" dominant-baseline="central">${esc(opts.label == null ? "" : opts.label)}</text>
      </svg>
`;
  }

  // "#rrggbb", "#rgb" or "rgb(r g b)" / "rgb(r, g, b)" -> [r, g, b]
  function toRgb(color) {
    const text = String(color || "").trim();
    if (text.startsWith("#")) {
      const hex = text.length === 4 ? text.slice(1).split("").map((c) => c + c).join("") : text.slice(1, 7);
      return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
    }
    const match = text.match(/rgba?\(([^)]+)\)/);
    if (match) return match[1].split(/[\s,\/]+/).slice(0, 3).map((n) => Number(n) || 0);
    return [128, 128, 128];
  }

  function mix(a, b, t) {
    const [r1, g1, b1] = toRgb(a);
    const [r2, g2, b2] = toRgb(b);
    const k = Math.max(0, Math.min(1, t));
    return `rgb(${Math.round(r1 + (r2 - r1) * k)},${Math.round(g1 + (g2 - g1) * k)},${Math.round(b1 + (b2 - b1) * k)})`;
  }

  // warm -> gray -> violet across the observed range, so "behind" and "ahead" read at a glance
  function rampColor(t, colors) {
    return t < 0.5 ? mix(colors.behind, colors.neutral, t * 2) : mix(colors.neutral, colors.ahead, (t - 0.5) * 2);
  }

  function medalInk(rank, colors) {
    const name = scoring().medal(rank);
    return name ? colors[name] : colors.you;
  }

  function tip({ name, rank, of, detail, sub }) {
    const line1 = `<b>${esc(name)}</b>${rank ? ` · ${scoring().ordinal(rank)}${of ? ` of ${of}` : ""}` : ""}`;
    const line2 = detail ? `<span>${esc(detail)}</span>` : "";
    const line3 = sub ? `<span>${esc(sub)}</span>` : "";
    return esc(`${line1}${line2}${line3}`);
  }

  // ---- the big ordinal ----
  function heroRank({ rank, of, plural }) {
    const ord = rank ? scoring().ordinal(rank) : "?";
    return (
      `<div class="ww-hero-big num${scoring().medalClass(rank, "m-")}">${ord}` +
      `<small>of ${of} ${esc(plural)}</small></div>`
    );
  }

  // ---- density hill of every area on the composite, with the area pinned ----
  function densityField({ rows, areaId, nameFor, noun, plural, listName }) {
    const ranked = (rows || []).filter((row) => row.score != null);
    if (!ranked.length) return "";
    const dist = scoring().distribution(ranked);
    const colors = palette();
    const pct = dist.pct;

    const bins = new Array(12).fill(0);
    ranked.forEach((row) => {
      bins[Math.min(11, Math.floor(pct(row.score) / (100 / 12)))] += 1;
    });
    const smooth = bins.map((v, i) => ((bins[i - 1] || 0) + 2 * v + (bins[i + 1] || 0)) / 4);
    const peak = Math.max(...smooth, 1e-9);
    let hill = "0,34 ";
    smooth.forEach((v, i) => {
      hill += `${((i + 0.5) * (100 / 12)).toFixed(1)},${(34 - (v / peak) * 26).toFixed(1)} `;
    });
    hill += "100,34";

    const me = String(areaId);
    let ticks = "";
    ranked.forEach((row) => {
      const x = pct(row.score).toFixed(1);
      const mine = String(row.area_id) === me;
      const name = nameFor ? nameFor(row.area_id) : String(row.area_id);
      ticks +=
        `<line x1="${x}" y1="${mine ? 8 : 22}" x2="${x}" y2="34" ` +
        `stroke="${mine ? colors.you : rampColor(pct(row.score) / 100, colors)}" ` +
        `stroke-width="${mine ? 3 : 1.6}" vector-effect="non-scaling-stroke"` +
        ` data-wardtick data-tip="${tip({ name, rank: row.rank, of: ranked.length, detail: listName ? `on ${listName}` : "" })}"` +
        `${mine ? "" : ' opacity="0.85"'}/>`;
    });

    const you = ranked.find((row) => String(row.area_id) === me);
    const youName = you && nameFor ? nameFor(you.area_id) : "";
    const gradientId = `wwfg${Math.floor(Math.random() * 1e6)}`;
    return (
      `<div class="ww-field"><div class="ww-fieldviz" role="img" ` +
      `aria-label="All ${ranked.length} ${esc(plural)} by score${youName ? `, ${esc(youName)} pinned` : ""}">` +
      (you
        ? `<span class="ww-youpin" style="left:${pct(you.score).toFixed(1)}%">You · ${scoring().ordinal(you.rank)}</span>`
        : "") +
      `<span class="ww-medflag" style="left:${pct(dist.median).toFixed(1)}%">middle of the pack</span>` +
      `<svg viewBox="0 0 100 36" preserveAspectRatio="none">` +
      `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0%" stop-color="${colors.behind}"/><stop offset="50%" stop-color="${colors.neutral}"/>` +
      `<stop offset="100%" stop-color="${colors.ahead}"/></linearGradient></defs>` +
      `<polygon points="${hill}" fill="url(#${gradientId})" opacity="0.16"/>` +
      `<polyline points="${hill}" fill="none" stroke="url(#${gradientId})" stroke-width="1.5" opacity="0.5" vector-effect="non-scaling-stroke"/>` +
      ticks +
      `<line x1="${pct(dist.median).toFixed(1)}" y1="6" x2="${pct(dist.median).toFixed(1)}" y2="34" ` +
      `stroke="${colors.median}" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` +
      `</svg></div>` +
      `<div class="ww-fieldlabels"><span class="lo">behind</span>` +
      `<span>every line is one ${esc(noun)}</span><span class="hi">ahead</span></div>` +
      (youName
        ? `<div class="ww-fieldcap">The hill shows where ${esc(plural)} bunch up. ` +
          `<b>${esc(youName)} is the pinned line.</b> Hover any line to see which one it is.</div>`
        : "") +
      `</div>`
    );
  }

  // ---- one measure as a box: the ordinal is the display ----
  function rankBox({ metricId, label, rank, of, weak, open }) {
    return (
      `<button type="button" class="ww-rankbox${weak ? " weak" : ""}${scoring().medalClass(rank, "m-")}` +
      `${open ? " open" : ""}" data-act="rankbox" data-metricbox="${esc(metricId)}" ` +
      `title="${esc(label)}: ${scoring().ordinal(rank)} of ${of}">` +
      `<span class="ord num">${scoring().ordinal(rank)}</span>` +
      `<span class="lbl">${esc(label)}</span></button>`
    );
  }

  // ---- one measure, every area on its REAL value scale, so closeness is visible ----
  function relativeStrip({ metric, entries, areaId, nameFor, fmt }) {
    const list = (entries || []).filter((e) => Number.isFinite(Number(e.v)));
    const mine = list.find((e) => String(e.area_id) === String(areaId));
    if (!metric || !mine || list.length < 2) return "";
    const colors = palette();
    const values = list.map((e) => Number(e.v));
    const vmin = Math.min(...values);
    const vmax = Math.max(...values);
    const span = Math.max(1e-9, vmax - vmin);
    const X = (v) => ((Number(v) - vmin) / span) * 96 + 2;
    const top = list.reduce((best, e) => (Number(e.s) > Number(best.s) ? e : best), list[0]);
    const format = fmt || ((v) => window.WardWiseExplorer.formatMetricValue(v, metric));
    let ticks = "";
    list.forEach((e) => {
      if (e === mine || e === top) return;
      ticks += `<line x1="${X(e.v).toFixed(1)}" y1="14" x2="${X(e.v).toFixed(1)}" y2="40" stroke="${colors.tick}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
    });
    ticks += `<line x1="${X(top.v).toFixed(1)}" y1="8" x2="${X(top.v).toFixed(1)}" y2="40" stroke="${colors.median}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`;
    ticks += `<line x1="${X(mine.v).toFixed(1)}" y1="8" x2="${X(mine.v).toFixed(1)}" y2="40" stroke="${colors.you}" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
    const myName = nameFor ? nameFor(mine.area_id) : "You";
    const gapWords =
      mine === top
        ? `${esc(myName)} sets the pace on this one.`
        : `The leader has <b>${esc(format(top.v))}</b>, ${esc(myName)} has <b>${esc(format(mine.v))}</b>, ` +
          `so ${scoring().ordinal(mine.rank)} place sits exactly that far back.`;
    return (
      `<div class="ww-relative"><h6>${esc(metric.label)} · everyone on the real scale</h6>` +
      `<div class="relviz">` +
      `<span class="youtag" style="left:${X(mine.v).toFixed(1)}%">You · ${esc(format(mine.v))}</span>` +
      (mine !== top ? `<span class="toptag" style="left:${X(top.v).toFixed(1)}%">Top · ${esc(format(top.v))}</span>` : "") +
      `<svg viewBox="0 0 100 40" preserveAspectRatio="none">${ticks}</svg></div>` +
      `<div class="relcap">${gapWords}` +
      (metric.direction === "lower" ? " Lower is better here; the ranking already accounts for it." : "") +
      `</div></div>`
    );
  }

  // ---- everyone on the composite with two areas pinned (the comparison headline) ----
  function overallStrip({ rows, aId, bId, nameFor, noun, listName }) {
    const ranked = (rows || []).filter((row) => row.score != null);
    if (!ranked.length) return "";
    const dist = scoring().distribution(ranked);
    const pct = (score) => dist.pct(score) * 0.96 + 2;
    const a = ranked.find((row) => String(row.area_id) === String(aId));
    const b = ranked.find((row) => String(row.area_id) === String(bId));
    const xa = a ? pct(a.score) : 0;
    const xb = b ? pct(b.score) : 0;
    const name = (id) => (nameFor ? nameFor(id) : String(id));
    const ticks = ranked
      .map(
        (row) =>
          `<span class="ww-stick" style="left:${pct(row.score).toFixed(2)}%" data-wardtick ` +
          `data-tip="${tip({ name: name(row.area_id), rank: row.rank, of: ranked.length, detail: listName ? `on ${listName}` : "" })}"></span>`,
      )
      .join("");
    const crowded = Math.abs(xa - xb) < 13;
    const push = crowded ? 7 : 0;
    const aFirst = xa <= xb;
    const clamp = (x) => Math.min(94, Math.max(6, x));
    // two pins within a hair of each other would hide one another: stagger them vertically
    const stacked = a && b && Math.abs(xa - xb) < 1.6;
    return (
      `<div class="ww-mainchart"><div class="ww-mainhead">Overall` +
      `<span>every mark is one ${esc(noun)}, placed by how it scores on your list</span></div>` +
      `<div class="ww-stripviz">` +
      (a ? `<span class="ww-stag a num" style="left:${clamp(xa + (aFirst ? -push : push)).toFixed(2)}%">${scoring().ordinal(a.rank)}</span>` : "") +
      (b ? `<span class="ww-stag b num" style="left:${clamp(xb + (aFirst ? push : -push)).toFixed(2)}%">${scoring().ordinal(b.rank)}</span>` : "") +
      `<span class="ww-sbase"></span>${ticks}` +
      (a ? `<span class="ww-spin a${stacked ? " up" : ""}" style="left:${xa.toFixed(2)}%" data-wardtick data-tip="${tip({ name: name(aId), rank: a.rank, of: ranked.length })}"></span>` : "") +
      (b ? `<span class="ww-spin b${stacked ? " down" : ""}" style="left:${xb.toFixed(2)}%" data-wardtick data-tip="${tip({ name: name(bId), rank: b.rank, of: ranked.length })}"></span>` : "") +
      `</div>` +
      `<div class="ww-stripends"><span>furthest behind</span><span>best in the city</span></div>` +
      `<div class="ww-pairkey"><span class="ka">▎ ${esc(name(aId))}</span>` +
      `<span class="kb">▎ ${esc(name(bId))}</span>` +
      `<span>hover any mark for that ${esc(noun)}</span></div></div>`
    );
  }

  // ---- one measure, both areas pinned on the real scale (the comparison duel) ----
  // duel: {metric, entries:[{area_id, s, v, rank}], sa:{value, rank}, sb:{value, rank}, aId, bId}
  function fieldStrip(duel, { nameFor } = {}) {
    const { metric, sa, sb, entries, aId, bId } = duel;
    const values = entries.map((e) => Number(e.v));
    const vmin = Math.min(...values);
    const vmax = Math.max(...values);
    const span = Math.max(1e-9, vmax - vmin);
    const X = (value) => ((Number(value) - vmin) / span) * 96 + 2;
    const format = (value) => window.WardWiseExplorer.formatMetricValue(value, metric);
    const name = (id) => (nameFor ? nameFor(id) : String(id));
    const xa = X(sa.value);
    const xb = X(sb.value);
    const tied = Math.abs(xa - xb) < 1;
    const tipA = tip({ name: name(aId), rank: sa.rank, of: entries.length, detail: format(sa.value) });
    const tipB = tip({ name: name(bId), rank: sb.rank, of: entries.length, detail: format(sb.value) });
    const pins = tied
      ? `<span class="ww-spin tie" style="left:${((xa + xb) / 2).toFixed(2)}%" data-wardtick data-tip="${tipA}"></span>`
      : `<span class="ww-spin a" style="left:${xa.toFixed(2)}%" data-wardtick data-tip="${tipA}"></span>` +
        `<span class="ww-spin b" style="left:${xb.toFixed(2)}%" data-wardtick data-tip="${tipB}"></span>`;
    const ticks = entries
      .map(
        (e) =>
          `<span class="ww-stick" style="left:${X(e.v).toFixed(2)}%" data-wardtick ` +
          `data-tip="${tip({ name: name(e.area_id), rank: e.rank, of: entries.length, detail: format(e.v) })}"></span>`,
      )
      .join("");
    const close = Math.abs(xa - xb) < 2.5;
    const leader = sa.rank < sb.rank ? name(aId) : name(bId);
    const best = Math.max(...values.map((v) => (metric.direction === "lower" ? -v : v)));
    const bestValue = metric.direction === "lower" ? -best : best;
    const caption = close
      ? `<b>Effectively tied.</b> ${esc(leader)} is ahead on paper, but the two sit almost on top of each other.`
      : `<b>${esc(leader)} leads</b>, and the space between the two pins is the whole of it.`;
    const bestWords =
      bestValue !== Number(sa.value) && bestValue !== Number(sb.value)
        ? ` The city&rsquo;s best is ${esc(format(bestValue))}.`
        : "";
    const crowded = Math.abs(xa - xb) < 13;
    const push = crowded ? 7 : 0;
    const aFirst = xa <= xb;
    const la = Math.min(94, Math.max(6, xa + (aFirst ? -push : push)));
    const lb = Math.min(94, Math.max(6, xb + (aFirst ? push : -push)));
    return (
      `<div class="ww-strip"><div class="ww-striphead">` +
      `<span class="nm">${esc(metric.label)}</span>` +
      `<span class="dir">${metric.direction === "lower" ? "lower is better" : "higher is better"}</span>` +
      `</div><div class="ww-stripviz">` +
      `<span class="ww-stag a num" style="left:${la.toFixed(2)}%">${esc(format(sa.value))}</span>` +
      `<span class="ww-stag b num" style="left:${lb.toFixed(2)}%">${esc(format(sb.value))}</span>` +
      `<span class="ww-sbase"></span>${ticks}${pins}</div>` +
      `<div class="ww-stripends"><span class="num">${esc(format(vmin))}</span>` +
      `<span class="num">${esc(format(vmax))}</span></div>` +
      `<div class="ww-stripcap">${caption}${bestWords}</div></div>`
    );
  }

  // ---- rank over time ----
  // points: [{year, rank?, used, of, empty?, pending?}] ; n = how many areas ; currentYear = the
  // year being read (or "latest") ; bands: optional [{from, to, label}] drawn behind the line
  function trajectory({ points, n, currentYear, bands }) {
    const wanted = points.map((p) => p.year);
    if (!wanted.length) return "";
    const colors = palette();
    const real = points.filter((p) => p.rank);
    const first = wanted[0];
    const last = wanted[wanted.length - 1];
    const X = (year) => 8 + ((year - first) / Math.max(1, last - first)) * 90;
    const Y = (rank) => 7 + ((rank - 1) / Math.max(1, n - 1)) * 25;
    const mid = Math.ceil(n / 2);

    let svg = `<svg viewBox="0 0 100 38" preserveAspectRatio="none">`;
    (bands || []).forEach((band, index) => {
      const x0 = X(Math.max(first, band.from));
      const x1 = X(Math.min(last, band.to));
      if (x1 <= x0) return;
      svg += `<rect x="${x0.toFixed(1)}" y="2" width="${(x1 - x0).toFixed(1)}" height="34" fill="${index % 2 ? colors.hair : "transparent"}" opacity="0.5"/>`;
    });
    [1, mid, n].forEach((rank) => {
      svg += `<line x1="7" y1="${Y(rank).toFixed(1)}" x2="99" y2="${Y(rank).toFixed(1)}" stroke="${colors.hair}" stroke-width="0.6" vector-effect="non-scaling-stroke"/>`;
    });
    wanted.forEach((year) => {
      svg += `<line x1="${X(year).toFixed(1)}" y1="4" x2="${X(year).toFixed(1)}" y2="34" stroke="${colors.hair}" stroke-width="0.4" vector-effect="non-scaling-stroke"/>`;
    });
    if (real.length > 1) {
      const path = real.map((p) => `${X(p.year).toFixed(1)},${Y(p.rank).toFixed(1)}`).join(" ");
      svg += `<polyline points="${path}" fill="none" stroke="${colors.you}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    }
    real.forEach((p) => {
      const cx = X(p.year).toFixed(1);
      const cy = Y(p.rank).toFixed(1);
      const isNow = p.year === currentYear || (currentYear === "latest" && p.year === last);
      svg +=
        `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy}" stroke="${colors.surface}" stroke-width="${isNow ? 11 : 8}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
        `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy}" stroke="${medalInk(p.rank, colors)}" stroke-width="${isNow ? 7.5 : 5}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    });
    svg += `</svg>`;
    return (
      `<div class="ww-rankrec">${svg}` +
      `<span class="ww-rr-ylab" style="top:8%">1st</span>` +
      `<span class="ww-rr-ylab" style="top:44%">${scoring().ordinal(mid)}</span>` +
      `<span class="ww-rr-ylab" style="top:80%">${scoring().ordinal(n)}</span></div>`
    );
  }

  // ---- a small area chart: [[year, value], ...], optionally against a reference series ----
  // opts.reference: [[year, value], ...] drawn first as a dashed median-coloured line on the same
  // scale (a ward against the citywide median, say). opts.ymax pins the top of the scale.
  function miniChart(points, opts = {}) {
    if (!points || !points.length) return "";
    const colors = palette();
    const reference = (opts.reference || []).filter((p) => Number.isFinite(p[1]));
    const all = points.concat(reference);
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const ymax = Math.max(opts.ymax || 0, ...ys, 1e-9);
    const X = (x) => ((x - x0) / Math.max(1, x1 - x0)) * 94 + 3;
    const Y = (y) => 26 - (y / (ymax * 1.08)) * 22;
    const path = (list) => list.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
    const pts = path(points);
    const last = points[points.length - 1];
    const ex = X(last[0]).toFixed(1);
    const ey = Y(last[1]).toFixed(1);
    return (
      `<svg viewBox="0 0 100 28" preserveAspectRatio="none">` +
      `<polygon points="${X(points[0][0]).toFixed(1)},26 ${pts} ${ex},26" fill="${colors.you}" opacity="0.08"/>` +
      (reference.length > 1
        ? `<polyline points="${path(reference)}" fill="none" stroke="${colors.median}" stroke-width="1.4" stroke-dasharray="3 3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`
        : "") +
      `<polyline points="${pts}" fill="none" stroke="${colors.you}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
      `<line x1="${ex}" y1="${ey}" x2="${ex}" y2="${ey}" stroke="${colors.surface}" stroke-width="9" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
      `<line x1="${ex}" y1="${ey}" x2="${ex}" y2="${ey}" stroke="${colors.you}" stroke-width="5.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
      `</svg>`
    );
  }

  // ---- a sparkline for a table row: [{year, value}, ...] ----
  // The y-domain has a floor (12% of the largest magnitude) so a wobble of a few percent draws
  // nearly flat instead of stretching to fill the box like a real swing. tone: up | down | neutral.
  function sparkline(points, opts = {}) {
    const list = (points || []).filter((p) => Number.isFinite(p.value));
    if (list.length < 2) return "";
    const W = opts.width || 68;
    const H = opts.height || 22;
    const PAD = 2;
    const colors = palette();
    const values = list.map((p) => p.value);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    const minSpan = 0.12 * Math.max(Math.abs(hi), Math.abs(lo));
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
    }
    const span = hi - lo || 1;
    const firstYear = list[0].year;
    const yearSpan = list[list.length - 1].year - firstYear || 1;
    const coords = list.map((p) => [
      PAD + ((p.year - firstYear) / yearSpan) * (W - PAD * 2),
      H - PAD - ((p.value - lo) / span) * (H - PAD * 2),
    ]);
    const d = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c[0].toFixed(1)} ${c[1].toFixed(1)}`).join(" ");
    const [ex, ey] = coords[coords.length - 1];
    const stroke = opts.tone === "up" ? colors.up : opts.tone === "down" ? colors.down : colors.median;
    return (
      `<svg class="ww-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">` +
      `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>` +
      `<line x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>` +
      `</svg>`
    );
  }

  // ---- one delegated tooltip for every mark on every chart ----
  // Any element carrying data-wardtick + data-tip gets a fixed-position tooltip on hover, focus,
  // or tap. Installed once per container; safe to call again.
  // ---- scatter: one marker per area, drawn at the container's real pixel size ----
  // Unlike the viewBox charts above, this one measures its container and draws in pixels, so a
  // photo marker is 32px on a laptop and 24px on a phone instead of shrinking with the chart.
  // points: [{id, name, x, y, image?, glyph?, href?}]. Returns a disposer.
  function niceTicks(lo, hi, count = 5) {
    if (!(hi > lo)) return [lo];
    const raw = (hi - lo) / count;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || raw;
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }

  function median(values) {
    const v = values.slice().sort((a, b) => a - b);
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  function scatter(el, opts) {
    const { points = [], xLabel = "", yLabel = "", fmt = (v) => String(v), trend = null, dots = false } = opts;
    let highlightId = opts.highlightId || null;
    if (!el || !points.length) return () => {};
    el.classList.add("wwc-scatter-wrap");
    const card = document.createElement("div");
    card.className = "wwc-scatter-card";
    card.hidden = true;

    function draw() {
      const width = Math.max(300, Math.round(el.clientWidth || 600));
      const phone = width < 480;
      const height = Math.round(phone ? width * 1.15 : Math.min(600, Math.max(380, width * 0.6)));
      const size = dots ? 9 : phone ? 24 : 32;
      const m = { l: phone ? 52 : 68, r: size / 2 + 8, t: size / 2 + 8, b: phone ? 52 : 58 };
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
      const pad = (lo, hi) => { const span = hi - lo || Math.abs(hi) || 1; return [lo - span * 0.06, hi + span * 0.06]; };
      const [x0, x1] = pad(Math.min(...xs), Math.max(...xs));
      const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
      const px = (x) => m.l + ((x - x0) / (x1 - x0)) * (width - m.l - m.r);
      const py = (y) => height - m.b - ((y - y0) / (y1 - y0)) * (height - m.t - m.b);
      const xt = niceTicks(x0, x1, phone ? 4 : 5), yt = niceTicks(y0, y1, phone ? 4 : 5);
      const grid = [
        ...xt.map((t) => `<line class="wwc-grid" x1="${px(t)}" x2="${px(t)}" y1="${m.t}" y2="${height - m.b}"/>
          <text class="wwc-tick" x="${px(t)}" y="${height - m.b + 18}" text-anchor="middle">${esc(fmt(t))}</text>`),
        ...yt.map((t) => `<line class="wwc-grid" x1="${m.l}" x2="${width - m.r}" y1="${py(t)}" y2="${py(t)}"/>
          <text class="wwc-tick" x="${m.l - 8}" y="${py(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`),
      ].join("");
      // Median guides split the cloud into four quadrants: "above the typical area on both", etc.
      const mx = median(xs), my = median(ys);
      const medians = `<line class="wwc-median" x1="${px(mx)}" x2="${px(mx)}" y1="${m.t}" y2="${height - m.b}"/>
        <line class="wwc-median" x1="${m.l}" x2="${width - m.r}" y1="${py(my)}" y2="${py(my)}"/>`;
      const line = trend
        ? `<line class="wwc-trend" x1="${px(x0)}" y1="${py(trend.slope * x0 + trend.intercept)}" x2="${px(x1)}" y2="${py(trend.slope * x1 + trend.intercept)}"/>`
        : "";
      const order = points.slice().sort((a, b) => (a.id === highlightId) - (b.id === highlightId));
      const marks = order.map((p, i) => {
        const cx = px(p.x), cy = py(p.y), r = size / 2;
        const mine = p.id === highlightId;
        const showPhoto = p.image && !phone && !dots;
        const body = showPhoto
          ? `<image href="${esc(p.image)}" x="${cx - r}" y="${cy - r}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#wwcClip)"/>
             <circle class="wwc-ring" cx="${cx}" cy="${cy}" r="${r}"/>`
          : dots
            ? `<circle class="wwc-dot" cx="${cx}" cy="${cy}" r="${r / 2 + 0.5}"/>`
            : `<circle class="wwc-num-bg" cx="${cx}" cy="${cy}" r="${r}"/>
               <text class="wwc-num" x="${cx}" y="${cy}" dy="0.35em" text-anchor="middle" style="font-size:${phone ? 10 : 12}px">${esc(p.glyph ?? "")}</text>`;
        const halo = mine ? `<circle class="wwc-mine" cx="${cx}" cy="${cy}" r="${r + 4}"/>
          <text class="wwc-mine-label" x="${cx}" y="${cy - r - 9}" text-anchor="middle">${esc(p.name)}</text>` : "";
        return `<a class="wwc-mark${mine ? " is-mine" : ""}" href="${esc(p.href || "#")}" data-i="${points.indexOf(p)}" aria-label="${esc(`${p.name}: ${xLabel} ${fmt(p.x)}, ${yLabel} ${fmt(p.y)}`)}">${body}${halo}</a>`;
      }).join("");
      el.innerHTML = `
        <svg class="wwc-scatter" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${yLabel} against ${xLabel}`)}">
          <defs><clipPath id="wwcClip" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5"/></clipPath></defs>
          ${grid}${medians}
          <line class="wwc-axis" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${height - m.b}"/>
          <line class="wwc-axis" x1="${m.l}" x2="${width - m.r}" y1="${height - m.b}" y2="${height - m.b}"/>
          ${line}${marks}
          <text class="wwc-axis-label" x="${m.l + (width - m.l - m.r) / 2}" y="${height - 10}" text-anchor="middle">${esc(xLabel)} →</text>
          <text class="wwc-axis-label" transform="translate(16 ${m.t + (height - m.t - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)} →</text>
        </svg>`;
      el.appendChild(card);
    }

    function showCard(target) {
      const a = target?.closest?.(".wwc-mark");
      if (!a) { card.hidden = true; return; }
      const p = points[Number(a.dataset.i)];
      const box = el.getBoundingClientRect(), mb = a.getBoundingClientRect();
      card.innerHTML = `<strong>${esc(p.name)}</strong><span>${esc(xLabel)}: ${esc(fmt(p.x))}</span><span>${esc(yLabel)}: ${esc(fmt(p.y))}</span>${p.href ? `<em>Open its full report →</em>` : ""}`;
      card.hidden = false;
      const left = Math.min(Math.max(8, mb.left - box.left + mb.width / 2 - card.offsetWidth / 2), box.width - card.offsetWidth - 8);
      const top = mb.top - box.top - card.offsetHeight - 10;
      card.style.left = `${left}px`;
      card.style.top = `${top < 0 ? mb.bottom - box.top + 10 : top}px`;
    }
    const over = (e) => showCard(e.target);
    const out = (e) => { if (!el.contains(e.relatedTarget)) card.hidden = true; };
    el.addEventListener("pointerover", over);
    el.addEventListener("focusin", over);
    el.addEventListener("pointerleave", out);

    draw();
    let last = el.clientWidth;
    const ro = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => { if (Math.abs(el.clientWidth - last) > 4) { last = el.clientWidth; draw(); } })
      : null;
    ro?.observe(el);
    const onWard = (e) => { if (opts.highlightFrom) { highlightId = opts.highlightFrom(e.detail?.ward); draw(); } };
    document.addEventListener("fd:myward", onWard);
    return () => { ro?.disconnect(); document.removeEventListener("fd:myward", onWard); el.removeEventListener("pointerover", over); el.removeEventListener("focusin", over); el.removeEventListener("pointerleave", out); };
  }

  // ---- small multiples for the over-time evidence ----
  // Lag profile: change correlations with Y shifted -3..+3 years; bars above/below a zero line.
  function lagBars(profile, { leadK = null } = {}) {
    const rows = (profile || []).filter((d) => Number.isFinite(d.r));
    if (!rows.length) return "";
    const W = 280, H = 120, mid = 58, half = 46, bw = 26, gap = (W - 7 * bw) / 8;
    const bars = rows.map((d) => {
      const i = d.k + 3, x = gap + i * (bw + gap), h = Math.min(1, Math.abs(d.r)) * half;
      const y = d.r >= 0 ? mid - h : mid;
      return `<rect class="wwc-lag${d.k === leadK ? " is-lead" : ""}${d.k > 0 ? " is-later" : d.k < 0 ? " is-earlier" : ""}" x="${x}" y="${y}" width="${bw}" height="${Math.max(1, h)}" rx="3"><title>${d.k > 0 ? `Y ${d.k} yr later` : d.k < 0 ? `Y ${-d.k} yr earlier` : "same year"}: r = ${d.r.toFixed(2)}</title></rect>
        <text class="wwc-lag-k" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${d.k > 0 ? `+${d.k}` : d.k}</text>`;
    }).join("");
    return `<svg class="wwc-lagbars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Correlation of changes at each lag">
      <line class="wwc-axis" x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>${bars}</svg>`;
  }

  // Event path: average Y movement in the years around X's sharpest jumps, against places that
  // hadn't jumped yet. t = 0 is the jump year. band = [lo[], hi[]]: the middle 95% of the same path
  // when each jump is paired with another, randomly drawn place's Y (the area-shuffle null).
  function eventPath(path, control, band = null) {
    const pts = (path || []).map((v, i) => [i - 3, v]).filter(([, v]) => Number.isFinite(v));
    if (pts.length < 3) return "";
    const ctl = (control || []).map((v, i) => [i - 3, v]).filter(([, v]) => Number.isFinite(v));
    const bandPts = band && band[0] && band[1]
      ? band[0].map((lo, i) => [i - 3, lo, band[1][i]]).filter(([, lo, hi]) => Number.isFinite(lo) && Number.isFinite(hi))
      : [];
    const all = [...pts, ...ctl].map(([, v]) => v).concat([0], ...bandPts.map(([, lo, hi]) => [lo, hi]));
    const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
    const W = 280, H = 120, l = 10, r = 10, t = 12, b = 22;
    const px = (k) => l + ((k + 3) / 6) * (W - l - r);
    const py = (v) => t + (1 - (v - lo) / span) * (H - t - b);
    const poly = (arr, cls) => `<polyline class="${cls}" points="${arr.map(([k, v]) => `${px(k)},${py(v)}`).join(" ")}"/>`;
    const area = bandPts.length >= 2
      ? `<polygon class="wwc-event-band" points="${[...bandPts.map(([k, , h]) => `${px(k)},${py(h)}`), ...bandPts.slice().reverse().map(([k, l2]) => `${px(k)},${py(l2)}`)].join(" ")}"><title>Where the line falls when each jump is paired with a randomly drawn other place (middle 95% of shuffles)</title></polygon>`
      : "";
    return `<svg class="wwc-event" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average change in the outcome around the driver's jumps">
      ${area}
      <line class="wwc-axis" x1="${l}" x2="${W - r}" y1="${py(0)}" y2="${py(0)}"/>
      <line class="wwc-median" x1="${px(0)}" x2="${px(0)}" y1="${t}" y2="${H - b}"/>
      ${ctl.length ? poly(ctl, "wwc-event-control") : ""}${poly(pts, "wwc-event-line")}
      ${[-3, 0, 3].map((k) => `<text class="wwc-lag-k" x="${px(k)}" y="${H - 6}" text-anchor="middle">${k === 0 ? "jump" : k > 0 ? `+${k} yr` : `${k} yr`}</text>`).join("")}
    </svg>`;
  }

  // Every sharp jump behind the event study, one dot per place (rows) and year (columns): blue up,
  // orange down. Clusters in one column are one shock seen many times, not many experiments.
  function jumpDots(jumps, { areas = [], years = [] } = {}) {
    if (!jumps?.length || !years.length) return "";
    const y0 = years[0], y1 = years[years.length - 1], nY = y1 - y0 + 1;
    const rowOf = new Map(areas.map((a, i) => [a, i]));
    const nA = Math.max(1, areas.length);
    const W = 280, l = 6, r = 6, t = 6, b = 18;
    const H = Math.min(200, Math.max(70, nA * 2 + t + b));
    const px = (yr) => l + ((yr - y0 + 0.5) / nY) * (W - l - r);
    const py = (i) => t + ((i + 0.5) / nA) * (H - t - b);
    const ups = [], downs = [];
    for (const [area, yr, sign] of jumps) {
      const i = rowOf.get(String(area));
      if (i == null) continue;
      (sign > 0 ? ups : downs).push(`M${px(yr).toFixed(1)} ${py(i).toFixed(1)}h0`);
    }
    const perYear = {};
    for (const [, yr] of jumps) perYear[yr] = (perYear[yr] || 0) + 1;
    const ticks = [y0, Math.round((y0 + y1) / 2), y1].filter((v, i, a) => a.indexOf(v) === i);
    return `<svg class="wwc-jumps" viewBox="0 0 ${W} ${H}" role="img" aria-label="${jumps.length} sharp jumps across ${Object.keys(perYear).length} years">
      ${Object.entries(perYear).map(([yr, n]) => `<rect class="wwc-jump-col" x="${px(+yr) - (W - l - r) / nY / 2}" y="${t}" width="${(W - l - r) / nY}" height="${H - t - b}"><title>${yr}: ${n} jump${n === 1 ? "" : "s"}</title></rect>`).join("")}
      <path class="wwc-jump is-up" d="${ups.join("")}"/><path class="wwc-jump is-down" d="${downs.join("")}"/>
      ${ticks.map((yr) => `<text class="wwc-lag-k" x="${px(yr)}" y="${H - 5}" text-anchor="middle">${yr}</text>`).join("")}
    </svg>`;
  }

  // One correlation per year (the within-year r of the two measures' changes): a single year far
  // from the rest is a shared shock carrying the pooled number.
  function yearRStrip(rows) {
    const pts = (rows || []).filter(([, r]) => Number.isFinite(r));
    if (pts.length < 2) return "";
    const y0 = pts[0][0], y1 = pts[pts.length - 1][0], nY = Math.max(1, y1 - y0);
    const W = 280, H = 90, l = 22, r = 8, t = 8, b = 18;
    const px = (yr) => l + ((yr - y0) / nY) * (W - l - r);
    const py = (v) => t + (1 - (v + 1) / 2) * (H - t - b);
    return `<svg class="wwc-rstrip" viewBox="0 0 ${W} ${H}" role="img" aria-label="Correlation of changes, year by year">
      <line class="wwc-axis" x1="${l}" x2="${W - r}" y1="${py(0)}" y2="${py(0)}"/>
      <text class="wwc-lag-k" x="${l - 4}" y="${py(1) + 4}" text-anchor="end">+1</text>
      <text class="wwc-lag-k" x="${l - 4}" y="${py(0) + 4}" text-anchor="end">0</text>
      <text class="wwc-lag-k" x="${l - 4}" y="${py(-1) + 4}" text-anchor="end">−1</text>
      ${pts.map(([yr, v]) => `<line class="wwc-rstrip-stem" x1="${px(yr)}" x2="${px(yr)}" y1="${py(0)}" y2="${py(v)}"/><line class="wwc-rstrip-dot" x1="${px(yr)}" x2="${px(yr)}" y1="${py(v)}" y2="${py(v)}"><title>${yr}: r = ${v.toFixed(2)}</title></line>`).join("")}
      <text class="wwc-lag-k" x="${l}" y="${H - 4}">${y0}</text><text class="wwc-lag-k" x="${W - r}" y="${H - 4}" text-anchor="end">${y1}</text>
    </svg>`;
  }

  // ---- the lag grid: every area-year at gaps of −5..+5 years (relationship page) ----
  // panels from WardWiseMetricPages.lagPanels. Each panel is one scatter: across = X in year t,
  // up = Y in year t + k, split at (cx, cy) — zero for changes, the medians for levels. Dots are
  // zero-length round-capped segments gathered into one path per class (a χGRID pair is thousands
  // of area-years). Changes are heavy-tailed, so each axis is on a signed-log (asinh) scale around
  // the split, in units of the typical distance from it: the quadrants are what the reader reads
  // (there are no tick values to distort), and a handful of outliers no longer squash everything
  // into the middle. The last 1% are pinned to the edge.
  // k > 0: the second measure (Y) read k years after the first; k < 0: the first (X) is the later one.
  const LAG_GAP_LABEL = (k) => (k === 0 ? "Same year"
    : `${k > 0 ? "Y" : "X"} ${Math.abs(k)} yr${Math.abs(k) === 1 ? "" : "s"} later`);
  const pText = (p) => (p == null ? "" : p < 0.001 ? "p < 0.001" : p < 0.01 ? `p = ${p.toFixed(3)}` : `p = ${p.toFixed(2)}`);

  // Layout: "Same year" as one big panel, beside two rows of five lined up by distance, so each
  // column compares the same gap both ways: the top row reads the second measure (Y) 1–5 years
  // AFTER the first (X), the bottom row 1–5 years BEFORE it (X later). xLabel/yLabel name the rows.
  function lagGrid(panels, { mode = "changes", highlightId = null, xLabel = "the first measure", yLabel = "the second" } = {}) {
    const W = 200, H = 200, pad = 10;
    const pct = (v) => (v == null ? "–" : `${Math.round(v * 100)}%`);
    // signed-log position of v relative to the split c, and the 99th-percentile reach of those
    const axis = (values, c) => {
      const dev = values.map((v) => Math.abs(v - c)).filter((d) => d > 0).sort((a, b) => a - b);
      const unit = dev[Math.floor(dev.length / 2)] || 1;
      const t = (v) => Math.asinh((v - c) / unit);
      const spread = values.map((v) => Math.abs(t(v))).sort((a, b) => a - b);
      const lim = spread[Math.floor(0.99 * (spread.length - 1))] || 1;
      return (v) => Math.max(-1, Math.min(1, t(v) / lim));
    };
    const sameWord = mode === "levels" ? "same side of the middle" : "moved the same way";
    // The big panel keeps the full caption; the small ones say just the gap and the share with its p,
    // and carry the rest (r, area-years, what shuffled places give) in a hover tooltip.
    const cell = (p) => {
      const main = p.k === 0;
      const name = main ? "Same year" : `${Math.abs(p.k)} yr${Math.abs(p.k) === 1 ? "" : "s"}`;
      const title = `<figcaption><strong>${name}</strong>`;
      if (p.n < 10) return `<figure class="wwc-lg-cell is-empty${main ? " is-main" : ""}">${title}<span>Too few overlapping years</span></figcaption></figure>`;
      const ax = axis(p.pts.map((d) => d.x), p.cx), ay = axis(p.pts.map((d) => d.y), p.cy);
      const px = (v) => pad + ((ax(v) + 1) / 2) * (W - 2 * pad);
      const py = (v) => pad + (1 - (ay(v) + 1) / 2) * (H - 2 * pad);
      const paths = { same: "", opp: "", tie: "", you: "" };
      for (const d of p.pts) {
        const sx = Math.sign(d.x - p.cx), sy = Math.sign(d.y - p.cy);
        const m = `M${px(d.x).toFixed(1)} ${py(d.y).toFixed(1)}h0`;
        paths[!sx || !sy ? "tie" : sx === sy ? "same" : "opp"] += m;
        if (highlightId && d.area === highlightId) paths.you += m;
      }
      const mid = W / 2;
      const tip = `${LAG_GAP_LABEL(p.k)}: ${pct(p.same)} ${sameWord}${p.r == null ? "" : `, r ${p.r.toFixed(2)}`}, ${p.n.toLocaleString()} area-years`
        + (p.null_mean != null ? `; shuffled places ${pct(p.null_mean)}, ${pText(p.p)}${p.sig ? " (beyond chance after the correction for 11 gaps)" : ""}` : "");
      // Against shuffled places, not 50%: "+4 pts" is how far the share sits from what random
      // pairings of places give. Panels inside the shuffled band are faded: nothing to see there.
      const tested = p.null_mean != null && p.same != null;
      const pts = tested ? Math.round((p.same - p.null_mean) * 100) : null;
      const ptsText = pts == null ? "" : `${pts > 0 ? "+" : pts < 0 ? "−" : "±"}${Math.abs(pts)} pts`;
      const inBand = tested && p.null_band && p.same >= p.null_band[0] && p.same <= p.null_band[1];
      const caption = main
        ? `${title}${tested
            ? `<span><b>${ptsText}</b> vs shuffled places (${pct(p.same)} moved the same way; shuffled ${pct(p.null_mean)}) · ${pText(p.p)}${p.sig ? " ✓" : ""}</span>`
            : `<span><b>${pct(p.same)}</b> ${sameWord}</span>`}
          <span class="wwc-lg-sub">${p.r == null ? "" : `r ${p.r.toFixed(2)} · `}${p.n.toLocaleString()} area-years</span></figcaption>`
        : `${title} <span class="wwc-lg-p${p.sig ? " is-sig" : ""}"><b>${tested ? ptsText : pct(p.same)}</b>${p.p != null ? ` · ${pText(p.p).replace(" = ", " ")}${p.sig ? " ✓" : ""}` : ""}</span></figcaption>`;
      return `<figure class="wwc-lg-cell${p.sig ? " is-sig" : ""}${inBand ? " is-inband" : ""}${main ? " is-main" : ""}" title="${esc(tip)}">
        <svg class="wwc-lg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(LAG_GAP_LABEL(p.k))}: ${p.n} area-years, ${pct(p.same)} ${sameWord}">
          <rect class="wwc-lg-quad" x="${mid}" y="0" width="${mid}" height="${mid}"/>
          <rect class="wwc-lg-quad" x="0" y="${mid}" width="${mid}" height="${mid}"/>
          <line class="wwc-axis" x1="${mid}" x2="${mid}" y1="0" y2="${H}"/>
          <line class="wwc-axis" x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>
          ${paths.you ? `<path class="wwc-lg-you" d="${paths.you}"/>` : ""}
          <path class="wwc-lg-dot is-tie" d="${paths.tie}"/>
          <path class="wwc-lg-dot is-opp" d="${paths.opp}"/>
          <path class="wwc-lg-dot is-same" d="${paths.same}"/>
          <text class="wwc-lg-corner" x="${W - 6}" y="18" text-anchor="end">${mode === "levels" ? "both high" : "both up"}</text>
          <text class="wwc-lg-corner" x="6" y="${H - 7}">${mode === "levels" ? "both low" : "both down"}</text>
        </svg>
        ${caption}
      </figure>`;
    };
    const byK = Object.fromEntries(panels.map((p) => [p.k, p]));
    const row = (sign) => [1, 2, 3, 4, 5].map((d) => byK[sign * d]).filter(Boolean).map(cell).join("");
    // Desktop: one grid, the big panel spanning both rows (so it stretches to their height), a slim
    // tag, then five panels per row; columns line up by gap. Phones: big panel, then each row swipes.
    const tested = panels.some((p) => p.null_mean != null);
    return `<p class="wwc-lg-legend">X = ${esc(xLabel)}, Y = ${esc(yLabel)}. Big panel: the same year.
        <b>Top row</b>: Y 1–5 years after X, where it shows if X moves first.
        <b>Bottom row</b>: Y 1–5 years before X, the other way round.${tested
          ? ` Each panel says how many points more (or fewer) place-years moved the same way than when places are paired at random; faded panels sit inside what random pairings give.`
          : ""} Hover a panel for its numbers.</p>
      <div class="wwc-lg-layout">
        ${byK[0] ? `<div class="wwc-lg-main">${cell(byK[0])}</div>` : ""}
        <div class="wwc-lg-row"><span class="wwc-lg-tag">Y later</span>${row(1)}</div>
        <div class="wwc-lg-row"><span class="wwc-lg-tag">X later</span>${row(-1)}</div>
      </div>`;
  }

  // Share of area-years on the same side at each gap. Changes: a dot for the observed share, its
  // year-bootstrap 95% range as a whisker, and a grey band for what pairing each place's X with a
  // randomly drawn OTHER place's Y gives (the area-shuffle null, which keeps shared shock years);
  // dots that clear the band after the correction for eleven gaps are filled. Levels: plain bars
  // against 50%. The interesting differences are a few points, invisible on a 0–100% scale.
  function lagShareStrip(panels, { mode = "changes" } = {}) {
    const rows = panels.filter((p) => p.same != null && p.n >= 10);
    if (!rows.length) return "";
    const ks = panels.map((p) => p.k), kMin = Math.min(...ks), nK = Math.max(...ks) - kMin + 1;
    const W = 420, H = 150, plotW = 360, mid = 66, half = 50, slot = plotW / nK;
    const vals = rows.flatMap((p) => [p.same, ...(p.ci || []), ...(p.null_band || [])]).filter(Number.isFinite);
    const reach = Math.max(0.05, ...vals.map((v) => Math.abs(v - 0.5)));
    const y = (v) => mid - ((v - 0.5) / reach) * half;
    const cx = (k) => (k - kMin + 0.5) * slot;
    const marks = rows.map((p) => {
      const x = cx(p.k);
      const tip = `${LAG_GAP_LABEL(p.k)}: ${Math.round(p.same * 100)}% ${mode === "levels" ? "on the same side" : "moved the same way"} (${p.n} area-years`
        + (p.n_years ? `, ${p.n_years} distinct years` : "") + ")"
        + (p.null_mean != null ? `; shuffled places give ${Math.round(p.null_mean * 100)}%, ${pText(p.p)}` : "")
        + (p.ci ? `; 95% range resampling years ${Math.round(p.ci[0] * 100)}–${Math.round(p.ci[1] * 100)}%` : "");
      const band = p.null_band ? `<rect class="wwc-lg-null" x="${x - slot * 0.32}" y="${y(p.null_band[1])}" width="${slot * 0.64}" height="${Math.max(1, y(p.null_band[0]) - y(p.null_band[1]))}" rx="3"/>` : "";
      const whisk = p.ci ? `<line class="wwc-lg-ci" x1="${x}" x2="${x}" y1="${y(p.ci[0])}" y2="${y(p.ci[1])}"/>` : "";
      const mark = mode === "levels" || p.null_band == null
        ? `<rect class="wwc-lg-share" x="${x - slot * 0.3}" y="${Math.min(mid, y(p.same))}" width="${slot * 0.6}" height="${Math.max(1, Math.abs(y(p.same) - mid))}" rx="3"/>`
        : `<line class="wwc-lg-obs${p.sig ? " is-sig" : ""}" x1="${x}" x2="${x}" y1="${y(p.same)}" y2="${y(p.same)}"/>`;
      return `<g><title>${esc(tip)}</title>${band}${whisk}${mark}</g>
        <text class="wwc-lag-k" x="${x}" y="${H - 22}" text-anchor="middle">${p.k > 0 ? `+${p.k}` : p.k}</text>`;
    }).join("");
    const zeroX = cx(0);
    return `<svg class="wwc-lg-strip" viewBox="0 0 ${W} ${H}" role="img" aria-label="Share moving the same way at each gap, against what shuffled places give">
      <line class="wwc-median" x1="0" x2="${plotW}" y1="${mid}" y2="${mid}"/>
      <text class="wwc-lag-k" x="${plotW + 6}" y="${mid + 4}">50%</text>${marks}
      ${kMin < 0 ? `<text class="wwc-lag-k" x="${zeroX - slot}" y="${H - 6}" text-anchor="end">← X later</text>` : ""}
      <text class="wwc-lag-k" x="${zeroX + slot}" y="${H - 6}">Y later →</text></svg>`;
  }

  // Each year's contribution to the share at one gap: area-years that moved the same way above the
  // line, opposite ways below. A single tall year is a shared shock doing the work.
  function yearContribBars(byYear) {
    const rows = byYear || [];
    if (!rows.length) return "";
    const W = 600, H = 150, l = 4, r = 4, mid = 66, half = 50;
    const top = Math.max(1, ...rows.map(([, s, o]) => Math.max(s, o)));
    const slot = (W - l - r) / rows.length, bw = Math.max(2, slot * 0.7);
    const bars = rows.map(([yr, same, opp], i) => {
      const x = l + i * slot + (slot - bw) / 2, hs = (same / top) * half, ho = (opp / top) * half;
      const share = same + opp ? Math.round((same / (same + opp)) * 100) : 0;
      return `<g><title>${yr}: ${same} same way, ${opp} opposite (${share}% same)</title>
        <rect class="wwc-yc is-same" x="${x}" y="${mid - hs}" width="${bw}" height="${Math.max(0.5, hs)}" rx="1.5"/>
        <rect class="wwc-yc is-opp" x="${x}" y="${mid}" width="${bw}" height="${Math.max(0.5, ho)}" rx="1.5"/></g>`;
    }).join("");
    const labelAt = (i) => `<text class="wwc-lag-k" x="${l + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${rows[i][0]}</text>`;
    const idx = [0, Math.floor((rows.length - 1) / 2), rows.length - 1].filter((v, i, a) => a.indexOf(v) === i);
    return `<svg class="wwc-yc-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Each year's same-way and opposite-way counts">
      <line class="wwc-axis" x1="${l}" x2="${W - r}" y1="${mid}" y2="${mid}"/>${bars}${idx.map(labelAt).join("")}</svg>`;
  }

  function attachTips(container) {
    if (!container || container.dataset.wwTips) return;
    container.dataset.wwTips = "1";
    let tipEl = document.getElementById("ww-tip");
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.id = "ww-tip";
      tipEl.className = "ww-tip";
      tipEl.setAttribute("role", "status");
      tipEl.setAttribute("aria-live", "polite");
      tipEl.hidden = true;
      document.body.appendChild(tipEl);
    }
    let held = null;

    function place(x, y) {
      const box = tipEl.getBoundingClientRect();
      const left = Math.min(window.innerWidth - box.width - 8, Math.max(8, x - box.width / 2));
      const above = y - box.height - 14;
      tipEl.style.left = `${left}px`;
      tipEl.style.top = `${above > 8 ? above : y + 18}px`;
    }

    function open(mark, x, y) {
      if (held === mark) {
        place(x, y);
        return;
      }
      if (held) held.classList.remove("hot");
      held = mark;
      mark.classList.add("hot");
      tipEl.innerHTML = mark.dataset.tip;
      tipEl.hidden = false;
      place(x, y);
    }

    function close() {
      if (held) held.classList.remove("hot");
      held = null;
      tipEl.hidden = true;
    }

    container.addEventListener("pointerover", (event) => {
      const mark = event.target.closest("[data-wardtick]");
      if (mark) open(mark, event.clientX, event.clientY);
    });
    container.addEventListener("pointermove", (event) => {
      if (!tipEl.hidden) place(event.clientX, event.clientY);
    });
    container.addEventListener("pointerout", (event) => {
      if (event.target.closest("[data-wardtick]")) close();
    });
    container.addEventListener("pointerdown", (event) => {
      const mark = event.target.closest("[data-wardtick]");
      if (mark) open(mark, event.clientX, event.clientY);
      else close();
    });
    container.addEventListener("focusin", (event) => {
      const mark = event.target.closest("[data-wardtick]");
      if (mark) {
        const box = mark.getBoundingClientRect();
        open(mark, box.left + box.width / 2, box.top);
      }
    });
    container.addEventListener("focusout", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    window.addEventListener("scroll", close, { passive: true });
  }

  return {
    palette,
    tip,
    heroRank,
    densityField,
    rankBox,
    relativeStrip,
    overallStrip,
    fieldStrip,
    trajectory,
    miniChart,
    sparkline,
    bloom,
    humanizeDomain,
    DOMAIN_SHORT,
    attachTips, scatter, lagBars, eventPath, jumpDots, yearRStrip, lagGrid, lagShareStrip, yearContribBars,
    LAG_GAP_LABEL, pText, niceTicks };
})();
