// Menu money · Data & methods: fills the release identity and the ready-to-paste citation.
(function () {
  "use strict";
  const M = window.WardWiseMenu;
  const slot = document.getElementById("mh-release");
  if (!slot) return;
  M.summary().then((data) => {
    const release = data.release || {};
    const s = data.summary || {};
    const years = s.years || [];
    const cite = `Ward Wise. Chicago Aldermanic Menu spending, ${years[0]}–${years[1]} (${M.releaseLabel(release)}). ${M.releaseUrl(release)}. `
      + "Source: City of Chicago Office of Budget and Management, Aldermanic Menu postings.";
    slot.innerHTML = `
      <p>This site currently shows <strong>${M.esc(M.releaseLabel(release))}</strong>: ${(s.rows || 0).toLocaleString()} project lines,
        ${years[0]}–${years[1]}, ${s.geocoded_pct}% placed on the map.
        <a href="${M.esc(M.releaseUrl(release))}">Browse or download this exact release</a>.</p>
      <p class="ed-section-label">Suggested citation</p>
      <p class="mh-cite-text">${M.esc(cite)}</p>
      <p><button type="button" class="ww-linkbtn" id="mh-copy">Copy citation</button></p>`;
    slot.querySelector("#mh-copy").addEventListener("click", async (event) => {
      try { await navigator.clipboard.writeText(cite); event.target.textContent = "Copied"; } catch (_error) { /* select manually */ }
    });
  }).catch(() => {
    slot.innerHTML = `<p>The data live at <a href="${M.DATA_REPO}">${M.DATA_REPO}</a>.</p>`;
  });
})();
