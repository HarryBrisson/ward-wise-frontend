// WardWiseAnalytics: the one place a count leaves the page. Every count goes to Google Analytics
// and PostHog (each loaded in templates/_analytics_head.html only when its id is set), carries the
// visitor's ward once we know it, and never a home address, email or alert-settings token.
// Loaded in <head> on every page, before any page script, so track() is always there and the
// click listener below sees cards that render later.
(function () {
  const WARD_KEY = "wardwise:ward";

  function savedWard() {
    try {
      return localStorage.getItem(WARD_KEY);
    } catch (_error) {
      return null;
    }
  }

  function track(action, params = {}) {
    const page = document.body ? document.body.dataset.page : undefined;
    const props = { ward: savedWard() || undefined, page, ...params };
    Object.keys(props).forEach((key) => { if (props[key] === undefined || props[key] === null) delete props[key]; });
    try {
      if (typeof window.gtag === "function") window.gtag("event", action, props);
    } catch (_error) {
      /* analytics is best-effort */
    }
    try {
      if (window.posthog && typeof window.posthog.capture === "function") window.posthog.capture(action, props);
    } catch (_error) {
      /* analytics is best-effort */
    }
  }

  // Properties PostHog adds to every later event, survey answers included: the ward, and the
  // measure last opened, so a "rate your ward on this" answer knows which measure it rates.
  function remember(props) {
    try {
      if (window.posthog && typeof window.posthog.register === "function") window.posthog.register(props);
    } catch (_error) {
      /* analytics is best-effort */
    }
  }

  function measureOpened(measure, topic, extra = {}) {
    if (!measure) return;
    remember({ measure, topic: topic || null });
    track("measure_opened", { measure, topic: topic || undefined, ...extra });
  }

  // Civic steps: links that leave Ward Wise to act. Counted at tap time, so cards that load
  // after the page (the alderperson card, meeting feeds) are covered without extra wiring.
  function civicStep(href) {
    if (/^mailto:/i.test(href)) return "email";
    if (/^tel:/i.test(href)) return "call";
    let url;
    try {
      url = new URL(href, location.href);
    } catch (_error) {
      return null;
    }
    const host = url.hostname.replace(/^www\./, "");
    if (host === "311.chicago.gov") return "311";
    if (host === "chicityclerkelms.chicago.gov") return /^\/meeting/i.test(url.pathname) ? "hearing" : "legislation";
    if (host === "gisapps.chicago.gov" && /zoning/i.test(url.pathname)) return "zoning";
    if (host === "ova.elections.il.gov") return "register_to_vote";
    if (host === "documenters.org") return "documenters";
    return null;
  }

  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link) return;
    const step = civicStep(link.getAttribute("href"));
    // The type and the ward only: never the address on the other end of the link.
    if (step) track("civic_step", { step });
  }, true);

  // Topic sections on the ward report (report_domains.js) open as <details data-domain>. "toggle"
  // doesn't bubble, so listen while it travels down.
  document.addEventListener("toggle", (event) => {
    const section = event.target;
    if (!(section instanceof HTMLDetailsElement) || !section.open || !section.dataset.domain) return;
    const label = section.querySelector(".wardreport-domain");
    track("topic_opened", { topic: label ? label.textContent.trim() : section.dataset.domain });
  }, true);

  document.addEventListener("fd:myward", (event) => remember({ ward: (event.detail && event.detail.ward) || null }));

  window.WardWiseAnalytics = { track, measureOpened, civicStep };
})();
