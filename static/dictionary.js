// Deep-linking for the metric dictionary.
//
// metric_details.js renders the entries asynchronously, so a `#metric-entry-<id>` anchor
// isn't in the document when the browser first tries to jump to it. Poll briefly, then
// open the <details> and flash it. Accepts either `#metric-entry-<id>` (the native anchor
// metric_details.js emits) or `#metric=<id>` (the form report links use upstream).
(function () {
  "use strict";

  const MAX_ATTEMPTS = 40;
  const INTERVAL_MS = 100;

  function requestedMetricId() {
    const hash = (location.hash || "").replace(/^#/, "");
    if (!hash) return null;
    if (hash.startsWith("metric-entry-")) return hash.slice("metric-entry-".length);
    return new URLSearchParams(hash).get("metric");
  }

  function reveal(metricId, attempt) {
    const entry = document.getElementById(`metric-entry-${metricId}`);
    if (!entry) {
      if (attempt < MAX_ATTEMPTS) setTimeout(() => reveal(metricId, attempt + 1), INTERVAL_MS);
      return;
    }
    entry.open = true;  // domain panels all render — only the entry itself needs opening
    entry.scrollIntoView({ block: "center", behavior: "smooth" });
    entry.classList.add("is-highlighted");
    setTimeout(() => entry.classList.remove("is-highlighted"), 2400);
  }

  function revealFromHash() {
    const metricId = requestedMetricId();
    if (metricId) reveal(metricId, 0);
  }

  revealFromHash();
  window.addEventListener("hashchange", revealFromHash);

  // --- Search and the domain list ---------------------------------------------------
  // Both wait for metric_details.js to draw the entries, then work on what it drew.

  const root = document.getElementById("metrics-content");
  const input = document.getElementById("fd-dict-search");
  const countNode = document.getElementById("fd-dict-count");
  const noneNode = document.getElementById("fd-dict-none");
  if (!root || !input) return;

  function whenDrawn(fn) {
    if (root.querySelector(".metric-domain-layout")) return fn();
    const observer = new MutationObserver(() => {
      if (!root.querySelector(".metric-domain-layout")) return;
      observer.disconnect();
      fn();
    });
    observer.observe(root, { childList: true });
  }

  whenDrawn(() => {
    root.classList.add("is-drawn");
    // Show "no matches" where the entries were, not below the long domain list.
    const panelsNode = root.querySelector(".metric-domain-panels");
    if (panelsNode) panelsNode.prepend(noneNode);
    const cards = [...root.querySelectorAll(".metric-definition-card")].map((card) => {
      const source = card.querySelector(".metric-definition-meta dd");
      // name + one-line definition + source; the dates line stays out of search
      const summary = card.querySelector(".metric-definition-summary");
      const title = summary.querySelector(".metric-definition-title");
      const description = summary.querySelector(":scope > span:last-child");
      return {
        card,
        panel: card.closest(".metric-domain-panel"),
        text: `${title ? title.textContent : ""} ${description ? description.textContent : ""} ${source ? source.textContent : ""}`.toLowerCase(),
      };
    });
    const panels = [...root.querySelectorAll(".metric-domain-panel")];
    const links = new Map(
      [...root.querySelectorAll(".metric-domain-toc-link")].map((link) => [link.getAttribute("href").slice(1), link]),
    );
    const total = cards.length;
    countNode.textContent = `${total} measures`;
    input.disabled = false;

    function filter() {
      const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      const perPanel = new Map(panels.map((panel) => [panel, 0]));
      cards.forEach((entry) => {
        const match = terms.every((term) => entry.text.includes(term));
        entry.card.hidden = !match;
        if (match) {
          shown += 1;
          perPanel.set(entry.panel, perPanel.get(entry.panel) + 1);
        }
      });
      perPanel.forEach((n, panel) => {
        panel.hidden = n === 0;
        const link = links.get(panel.id);
        if (link) {
          link.classList.toggle("is-empty", n === 0);
          link.querySelector("strong").textContent = n;
        }
      });
      if (ranked) ranked.hidden = shown === 0;
      countNode.textContent = terms.length ? `${shown} of ${total}` : `${total} measures`;
      noneNode.hidden = shown > 0;
    }

    // --- Ordering ------------------------------------------------------------------------
    // "By domain" is how metric_details.js draws the page. The date orders lift every card out
    // of its domain into one ranked list (a domain tag rides along on each card) and put them
    // back, in their drawn order, when the reader returns to "By domain".
    const sortSelect = document.getElementById("fd-dict-sort");
    const SORTS = {
      "added-new": { key: "added", dir: -1, title: "Newest added first", note: "When each measure first appeared on Ward Wise." },
      "added-old": { key: "added", dir: 1, title: "Oldest added first", note: "When each measure first appeared on Ward Wise." },
      "through-new": { key: "through", dir: -1, title: "Freshest data first", note: "The newest period each measure's data covers." },
      "through-old": { key: "through", dir: 1, title: "Stalest data first", note: "The newest period each measure's data covers." },
    };
    const homes = cards.map((entry) => ({ card: entry.card, list: entry.card.parentElement }));
    let ranked = null;

    function rankedPanel() {
      if (ranked) return ranked;
      ranked = document.createElement("section");
      ranked.className = "metric-domain-panel metric-ranked-panel";
      ranked.innerHTML = `
        <div class="metric-domain-heading">
          <p class="eyebrow">All measures</p>
          <h4></h4>
          <p class="transparency-meta"></p>
        </div>
        <div class="metric-definition-list"></div>`;
      panelsNode.prepend(ranked);
      panelsNode.prepend(noneNode);
      return ranked;
    }

    function applySort(value) {
      const sort = SORTS[value];
      if (!sort) {
        homes.forEach(({ card, list }) => list.append(card));
        root.classList.remove("is-ranked");
        return;
      }
      const panel = rankedPanel();
      panel.querySelector("h4").textContent = sort.title;
      panel.querySelector(".transparency-meta").textContent = sort.note;
      const list = panel.querySelector(".metric-definition-list");
      // undated measures sink to the bottom either way; ties keep the domain order
      const ordered = homes
        .map(({ card }, index) => ({ card, index, value: card.dataset[sort.key] || "" }))
        .sort((a, b) => {
          if (!a.value !== !b.value) return a.value ? -1 : 1;
          return (a.value < b.value ? -1 : a.value > b.value ? 1 : 0) * sort.dir || a.index - b.index;
        });
      ordered.forEach(({ card }) => list.append(card));
      root.classList.add("is-ranked");
    }

    function syncSortUrl(value) {
      const params = new URLSearchParams(location.search);
      if (SORTS[value]) params.set("sort", value);
      else params.delete("sort");
      const query = params.toString();
      history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
    }

    if (sortSelect) {
      const hasDates = cards.some((entry) => entry.card.dataset.added || entry.card.dataset.through);
      sortSelect.disabled = !hasDates;
      const wanted = new URLSearchParams(location.search).get("sort");
      if (hasDates && SORTS[wanted]) {
        sortSelect.value = wanted;
        applySort(wanted);
      }
      sortSelect.addEventListener("change", () => {
        applySort(sortSelect.value);
        syncSortUrl(sortSelect.value);
        filter();
      });
    }

    input.addEventListener("input", filter);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && input.value) {
        input.value = "";
        filter();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && document.activeElement !== input && !/input|textarea|select/i.test(document.activeElement.tagName)) {
        event.preventDefault();
        input.focus();
      }
    });

    // Mark the domain being read in the side list.
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link, id) => link.toggleAttribute("aria-current", id === entry.target.id));
        });
      }, { rootMargin: "-90px 0px -65% 0px" });
      panels.forEach((panel) => observer.observe(panel));
    }
  });
})();
