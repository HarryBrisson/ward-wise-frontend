(function () {
  "use strict";

  const WARD_COUNT = 50;
  const api = window.WardWiseExplorer || {};
  const esc = api.escapeHtml || ((value) => String(value));
  const fmtNum = api.formatNumber || ((value) => String(value));

  async function getJson(url) {
    if (api.fetchJson) return api.fetchJson(url, "Unable to load.");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Request failed: ${url}`);
    return response.json();
  }

  // One light request serves the whole page (the old per-section endpoints loaded the
  // multi-snapshot history store and died as it grew).
  let summaryPromise = null;
  function getSummary() {
    if (!summaryPromise) summaryPromise = getJson("/api/support-summary");
    return summaryPromise;
  }

  function seriesFrom(payload) {
    if (Array.isArray(payload)) return payload;
    return payload.series || payload.timeseries || [];
  }

  function seriesValue(entry) {
    if (entry.latest_value !== undefined && entry.latest_value !== null) return entry.latest_value;
    const obs = entry.observations || [];
    return obs.length ? obs[obs.length - 1].value : null;
  }

  // --- Nominations: a metric nominated from every ward -----------------------
  async function renderNominations() {
    const node = document.getElementById("about-nominations");
    if (!node) return;
    let nominated = {};
    try {
      const data = await getSummary();
      for (const [wardId, value] of Object.entries(data.submissions_by_ward || {})) {
        if (value && value > 0) nominated[wardId] = value;
      }
    } catch (error) {
      node.innerHTML = `<p class="about-error">Couldn't load nominations right now.</p>`;
      return;
    }

    const covered = Object.keys(nominated).length;
    const pct = Math.round((covered / WARD_COUNT) * 100);
    const cells = [];
    for (let n = 1; n <= WARD_COUNT; n += 1) {
      const id = String(n).padStart(2, "0");
      const count = nominated[id] || 0;
      const isOn = count > 0;
      const label = isOn ? `Ward ${n}: ${fmtNum(count)} nomination${count === 1 ? "" : "s"}` : `Ward ${n}: none yet`;
      cells.push(
        `<div class="ward-cell${isOn ? " is-nominated" : ""}" title="${esc(label)}" aria-label="${esc(label)}">${n}</div>`
      );
    }

    node.innerHTML = `
      <div class="about-progress">
        <div class="about-progress-stat">
          <span class="about-progress-count">${covered}</span>
          <span class="about-progress-of">of ${WARD_COUNT} wards</span>
        </div>
        <div class="about-progress-bar" role="progressbar" aria-valuenow="${covered}" aria-valuemin="0" aria-valuemax="${WARD_COUNT}">
          <span style="width:${pct}%"></span>
        </div>
        <p class="about-progress-note">${pct}% of wards have nominated a metric. ${covered < WARD_COUNT ? "Yours could be next." : "Every ward is represented — thank you, Chicago."}</p>
      </div>
      <div class="ward-grid" aria-label="Ward nomination coverage grid">${cells.join("")}</div>
    `;
  }

  // --- Metric growth over time (inline SVG sparkline) ------------------------
  function sparkDate(p) {
    return api.formatDate ? api.formatDate(p.collected_at) : String(p.collected_at).slice(0, 10);
  }

  // Tooltip content for a day: how many metrics were added (the light runs index carries
  // counts, not per-metric labels).
  function sparkTipHtml(p) {
    const head = `<div class="spark-tip-date">${esc(sparkDate(p))}</div>`;
    if (p.snapshot_id === "project-start") {
      return `${head}<div class="spark-tip-head">Launched with ${esc(p.metric_count)} metrics</div>`;
    }
    if (!p.added_count) {
      return `${head}<div class="spark-tip-empty">No new metrics · ${esc(p.metric_count)} tracked</div>`;
    }
    const headline = p.added_count === 1 ? "1 metric added" : `${p.added_count} metrics added`;
    return `${head}<div class="spark-tip-head">${esc(headline)} · ${esc(p.metric_count)} tracked</div>`;
  }

  function buildSparkline(points) {
    const W = 100;
    const H = 100;
    const padX = 4;
    const padY = 8;
    const times = points.map((p) => new Date(p.collected_at).getTime());
    const counts = points.map((p) => p.metric_count);
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const cMax = Math.max(...counts, 1);
    const x = (t) => (tMax === tMin ? padX : padX + ((t - tMin) / (tMax - tMin)) * (W - 2 * padX));
    const y = (c) => H - padY - (c / cMax) * (H - 2 * padY);

    const xs = points.map((p) => x(new Date(p.collected_at).getTime()));
    const coords = points.map((p, i) => `${xs[i].toFixed(2)},${y(p.metric_count).toFixed(2)}`);
    const isAddDay = (p) => p.snapshot_id !== "project-start" && p.added_count > 0;
    const circles = points
      .map((p, i) => {
        const [cx, cy] = coords[i].split(",");
        const add = isAddDay(p);
        return `<circle class="spark-dot${add ? " is-add" : ""}" data-i="${i}" cx="${cx}" cy="${cy}" r="${add ? 2.4 : 1.8}"></circle>`;
      })
      .join("");
    // Full-height transparent bands so "hover over a day" is easy despite the tiny dots.
    const bands = points
      .map((p, i) => {
        const half = points.length > 1 ? (W - 2 * padX) / (points.length - 1) / 2 : W / 2;
        const x0 = Math.max(0, xs[i] - half);
        const w = Math.min(W, xs[i] + half) - x0;
        return `<rect class="spark-band" data-i="${i}" x="${x0.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${H}"></rect>`;
      })
      .join("");

    return `
      <svg class="sparkline about-sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Number of metrics tracked over time">
        <polyline points="${coords.join(" ")}" fill="none" stroke="currentColor" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"></polyline>
        ${circles}
        ${bands}
      </svg>
    `;
  }

  // Custom hover tooltip for the growth sparkline (richer than a native <title>).
  function wireSparkTip(node, points) {
    const plot = node.querySelector(".about-growth-plot");
    const svg = plot && plot.querySelector("svg.about-sparkline");
    const tip = plot && plot.querySelector(".spark-tip");
    if (!plot || !svg || !tip) return;
    let activeI = -1;
    const show = (i) => {
      if (i === activeI || !points[i]) return;
      activeI = i;
      tip.innerHTML = sparkTipHtml(points[i]);
      tip.hidden = false;
      const dot = svg.querySelector(`circle.spark-dot[data-i="${i}"]`);
      if (!dot) return;
      const pr = plot.getBoundingClientRect();
      const dr = dot.getBoundingClientRect();
      const cx = dr.left - pr.left + dr.width / 2;
      const cy = dr.top - pr.top;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.max(tw / 2 + 4, Math.min(pr.width - tw / 2 - 4, cx))}px`;
      tip.style.top = `${cy}px`;
      tip.classList.toggle("below", cy < tip.offsetHeight + 12); // flip under the dot near the top
    };
    const hide = () => { activeI = -1; tip.hidden = true; };
    svg.addEventListener("mousemove", (event) => {
      const band = event.target.closest(".spark-band");
      if (band) show(Number(band.dataset.i));
    });
    svg.addEventListener("mouseleave", hide);
  }

  async function renderGrowth() {
    const node = document.getElementById("about-metric-growth");
    if (!node) return;
    let payload;
    try {
      payload = await getSummary();
    } catch (error) {
      node.innerHTML = `<p class="about-error">Couldn't load metric history right now.</p>`;
      return;
    }

    // Runs index -> one point per day (several pipeline runs can share a day; keep the max).
    const byDay = new Map();
    for (const run of payload.catalog_growth || []) {
      if (!run.date) continue;
      byDay.set(run.date, Math.max(byDay.get(run.date) || 0, run.metric_catalog));
    }
    let points = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ collected_at: date, metric_count: count }));
    payload.project_start = "2026-05-15";
    // Anchor at the launch: 20 metrics for the Bean's 20th birthday (2026-05-15).
    const LAUNCH_COUNT = 20;
    if (payload.project_start) {
      const startTime = new Date(payload.project_start).getTime();
      const firstTime = points.length ? new Date(points[0].collected_at).getTime() : Infinity;
      if (startTime < firstTime) {
        points.unshift({ collected_at: payload.project_start, metric_count: LAUNCH_COUNT, snapshot_id: "project-start" });
      }
    }
    // The catalog only grows — show the high-water mark so early partial pipeline
    // runs (a handful of metrics on bring-up day) don't dip the line.
    let runningMax = 0;
    let previous = null;
    points = points.map((p) => {
      runningMax = Math.max(runningMax, p.metric_count);
      const point = { ...p, metric_count: runningMax,
                      added_count: previous === null ? 0 : Math.max(0, runningMax - previous) };
      previous = runningMax;
      return point;
    });
    if (points.length < 2) {
      const current = points.length ? points[points.length - 1].metric_count : 0;
      node.innerHTML = `<p class="about-metric-now"><span class="about-progress-count">${current}</span> metrics tracked today.</p>`;
      return;
    }

    const first = points[0];
    const last = points[points.length - 1];
    const startLabel = api.formatDate ? api.formatDate(first.collected_at) : first.collected_at.slice(0, 10);
    const endLabel = api.formatDate ? api.formatDate(last.collected_at) : last.collected_at.slice(0, 10);
    node.innerHTML = `
      <div class="about-growth-head">
        <div class="about-progress-stat">
          <span class="about-progress-count">${last.metric_count}</span>
          <span class="about-progress-of">metrics today</span>
        </div>
        <p class="about-progress-note">From ${esc(first.metric_count)} on ${esc(startLabel)} to ${esc(last.metric_count)} now.</p>
      </div>
      <div class="about-growth-plot">
        ${buildSparkline(points)}
        <div class="spark-tip" role="status" hidden></div>
      </div>
      <div class="about-growth-axis"><span>${esc(startLabel)}</span><span>${esc(endLabel)}</span></div>
    `;
    wireSparkTip(node, points);
  }

  // --- Visual signifiers: a small rotating sample -----------------------------
  // Upstream picked these server-side, which meant rendering the Support page read the
  // civic-data repo (S3, in prod) inline. The same photos are already on the area
  // endpoints, so the page can choose its own — same daily rotation, so returning
  // visitors still see different corners of the city.
  //
  // Wards + neighborhoods only: χGRID labels are grid coordinates, meaningless as a
  // photo caption here.
  const SIGNIFIER_COUNT = 4;

  function signifierEntries(areas, label) {
    return areas
      .map((area) => ({ area: label(area), signifier: area.visual_signifier || {} }))
      .filter((entry) => entry.signifier.image_url)
      .map((entry) => ({
        area: entry.area,
        subject: entry.signifier.name || entry.area,
        image: entry.signifier.image_url,
        alt: entry.signifier.alt || entry.signifier.name || entry.area,
      }));
  }

  async function renderSignifiers() {
    const node = document.getElementById("signifier-examples");
    if (!node) return;
    let entries = [];
    try {
      const [wards, areas] = await Promise.all([
        getJson("/api/explorer/wards"),
        getJson("/api/community-areas"),
      ]);
      entries = [
        ...signifierEntries(wards.wards || [], (w) => `Ward ${w.ward_number || w.ward_id}`),
        ...signifierEntries(areas.community_areas || [], (a) => a.display_name || a.name),
      ];
    } catch (error) {
      return;  // the section reads fine without photos; no error state needed
    }
    if (!entries.length) return;

    const offset = Math.floor(Date.now() / 86400000);  // rotate once a day
    const step = Math.max(1, Math.floor(entries.length / SIGNIFIER_COUNT));
    const picks = [];
    for (let i = 0; i < Math.min(SIGNIFIER_COUNT, entries.length); i += 1) {
      picks.push(entries[(offset + i * step) % entries.length]);
    }

    node.innerHTML = picks
      .map(
        (pick) => `
      <figure class="signifier-example">
        <img src="${esc(pick.image)}" alt="${esc(pick.alt)}" loading="lazy" referrerpolicy="no-referrer">
        <figcaption>
          <strong>${esc(pick.area)}</strong>
          <span>${esc(pick.subject)}</span>
        </figcaption>
      </figure>`
      )
      .join("");
    node.hidden = false;
  }

  function init() {
    renderNominations();
    renderGrowth();
    renderSignifiers();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
