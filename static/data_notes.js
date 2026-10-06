// Data notes: render the build-maintained completeness artifact.
(function () {
  const root = document.getElementById("notes-root");
  if (!root) return;
  const money = (v) => Math.abs(v) >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M"
    : "$" + Math.round(v).toLocaleString();
  const pct = (v) => v == null ? "—" : (v * 100).toFixed(1) + "%";

  function placementHtml(pl) {
    if (!pl) return "";
    const row = (label, entry, extra) =>
      `<tr><td>${label}</td><td>${entry.keys != null ? entry.keys.toLocaleString() : (entry.rows || "").toLocaleString()}</td>` +
      `<td>${money(entry.usd)}</td><td>${entry.share != null ? pct(entry.share) : ""}</td><td>${extra || ""}</td></tr>`;
    const DERIV = { exact: "exact street math (1–20 m median vs Google)",
      repaired_verified: "repaired + ward-verified (edit-distance fixes)",
      llm_verified: "LLM-proposed, doubly verified", other: "other" };
    const DOT = { point: "a specific spot (address or crossing)",
      extent_midpoint: "midpoint of a block-spanning project",
      multi_site_mean: "mean of several sites — least precise for small circles",
      unplaced_by_upstream: "no geometry upstream (now covered by our fill)" };
    const d = Object.entries(pl.derivation_2005_2018 || {}).map(([k, v]) => row(DERIV[k] || k, v)).join("");
    const s2 = Object.entries(pl.dot_semantics_2005_2018 || {}).map(([k, v]) => row(DOT[k] || k, v)).join("");
    const u = Object.entries(pl.upstream_2019_2022_by_geometry || {}).map(([k, v]) => row(DOT[k] || k, v)).join("");
    return `<h2>How confidently were the dots placed?</h2>
      <p class="near-change-note">${pl.note || ""}</p>
      <div class="notes-cols">
        <div><h3>2005–2018: how the text was resolved</h3>
          <table class="notes-table"><thead><tr><th>tier</th><th>rows</th><th>dollars</th><th>share</th><th></th></tr></thead><tbody>${d}</tbody></table></div>
        <div><h3>2005–2018: what a dot stands for</h3>
          <table class="notes-table"><thead><tr><th>meaning</th><th></th><th>dollars</th><th>share</th><th></th></tr></thead><tbody>${s2}</tbody></table>
          <h3>2019–2022 (upstream), by geometry</h3>
          <table class="notes-table"><thead><tr><th>meaning</th><th>rows</th><th>dollars</th><th></th><th></th></tr></thead><tbody>${u}</tbody></table>
          <p class="near-change-note">${pl.fill_2019_2023 || ""}</p></div>
      </div>`;
  }

  fetch("/api/data-notes").then((r) => r.json()).then((notes) => {
    const menu = notes.menu_money || {};
    const yearRows = (menu.by_year || []).map((r) =>
      `<tr><td>${r.year}</td><td>${money(r.placed_usd)}</td><td>${money(r.source_usd)}</td>` +
      `<td>${pct(r.coverage)}</td></tr>`).join("");
    const wardRows = (menu.by_ward || []).slice().sort((a, b) =>
      (a.coverage_2005_2018 ?? 1) - (b.coverage_2005_2018 ?? 1)).map((r) =>
      `<tr><td>W${r.ward}</td><td>${money(r.source_usd_2005_2018)}</td>` +
      `<td>${money(r.missing_usd_2005_2018)}</td><td>${pct(r.coverage_2005_2018)}</td></tr>`).join("");
    const famRows = Object.entries(notes.families || {}).map(([key, f]) => {
      const window = f.years ? `${f.years[0]}–${f.years[1]}` : "—";
      const flags = [f.partial_first_year && "partial first year",
                     f.partial_last_year && "partial current year",
                     (f.excluded_years || []).length && `withheld: ${f.excluded_years.join(", ")}`]
        .filter(Boolean).join("; ");
      const audit = f.external_audit ? `<br><em>Audit: ${f.external_audit}</em>` : "";
      return `<tr><td>${f.label || key}</td><td>${window}</td><td>${flags || "—"}</td>` +
             `<td>${f.caveat || ""}${audit}</td></tr>`;
    }).join("");
    root.innerHTML = `
      <h2>Menu-money dollars</h2>
      <ul class="notes-list">${(menu.sources || []).map((s) => `<li>${s}</li>`).join("")}</ul>
      <div class="notes-cols">
        <div><h3>By year — placed vs source</h3>
          <table class="notes-table"><thead><tr><th>year</th><th>placed</th><th>source</th>
          <th>coverage</th></tr></thead><tbody>${yearRows}</tbody></table></div>
        <div><h3>By ward — 2005–2018 (FOIA era), least complete first</h3>
          <table class="notes-table"><thead><tr><th>ward</th><th>source</th><th>missing</th>
          <th>coverage</th></tr></thead><tbody>${wardRows}</tbody></table>
          <p class="near-change-note">${menu.note || ""}</p></div>
      </div>
      ${placementHtml(menu.placement)}
      <h2>Every dataset</h2>
      <p class="near-change-note">External audit as of ${(notes.audit || {}).as_of || "—"}:
        ${(notes.audit || {}).method || ""}</p>
      <table class="notes-table notes-families"><thead><tr><th>dataset</th><th>window</th>
        <th>flags</th><th>what to know</th></tr></thead><tbody>${famRows}</tbody></table>`;
  }).catch(() => { root.textContent = "Could not load the notes."; });
})();
