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
})();
