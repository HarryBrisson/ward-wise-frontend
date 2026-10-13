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
      return {
        card,
        panel: card.closest(".metric-domain-panel"),
        text: `${card.querySelector(".metric-definition-summary").textContent} ${source ? source.textContent : ""}`.toLowerCase(),
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
      countNode.textContent = terms.length ? `${shown} of ${total}` : `${total} measures`;
      noneNode.hidden = shown > 0;
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
