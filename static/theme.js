// Theme: classic (the warm palette) or dark (ink and violet). Stored as a preference —
// "classic", "dark" or "system" — and resolved to a data-theme attribute on <html> that the
// stylesheet's token overrides key off. "system" follows prefers-color-scheme and keeps
// following it if the device flips mid-session.
//
// base.html applies the stored preference in an inline script before the stylesheet loads, so
// there is no flash; this module owns everything after that.
window.WardWiseTheme = (function () {
  const KEY = "wardWiseTheme";
  const THEMES = ["classic", "dark"];
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const THEME_COLORS = { classic: "#ffffff", dark: "#111216" };

  function preference() {
    try {
      const stored = window.localStorage.getItem(KEY);
      return stored === "classic" || stored === "dark" ? stored : "system";
    } catch (_error) {
      return "system";
    }
  }

  function resolve(pref) {
    if (pref === "classic" || pref === "dark") return pref;
    return media && media.matches ? "dark" : "classic";
  }

  function current() {
    return document.documentElement.dataset.theme || resolve(preference());
  }

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = THEME_COLORS[theme] || THEME_COLORS.classic;
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const next = theme === "dark" ? "classic" : "dark";
      button.setAttribute("aria-label", `Switch to ${next} theme`);
      button.title = `Switch to ${next} theme`;
    });
    document.dispatchEvent(new CustomEvent("wardwise:themechange", { detail: { theme } }));
  }

  // pref: "classic" | "dark" | "system"
  function set(pref) {
    const value = pref === "classic" || pref === "dark" ? pref : "system";
    try {
      if (value === "system") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, value);
    } catch (_error) {
      // storage unavailable: the choice still applies for this page
    }
    apply(resolve(value));
    return value;
  }

  function toggle() {
    return set(current() === "dark" ? "classic" : "dark");
  }

  if (media && typeof media.addEventListener === "function") {
    media.addEventListener("change", () => {
      if (preference() === "system") apply(resolve("system"));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    apply(resolve(preference()));
    document.querySelectorAll("[data-theme-toggle]").forEach((button) =>
      button.addEventListener("click", () => {
        toggle();
        if (window.WardWiseExplorer && WardWiseExplorer.track) {
          WardWiseExplorer.track("theme_toggle", { theme: current() });
        }
      }),
    );
  });

  return { THEMES, KEY, preference, current, set, toggle };
})();
