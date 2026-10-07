function initMetricSuggestionForm() {
  const form = document.getElementById("metric-recommendation-form");
  if (!form) return;
  populateMetricSuggestionLocationOptions(form);
  form.addEventListener("submit", handleMetricSuggestionSubmit);
}

async function handleMetricSuggestionSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  setMetricSuggestionStatus("");
  if (submitButton) submitButton.disabled = true;

  try {
    await WardWiseExplorer.submitMetricRecommendation(metricSuggestionPayload(form));
    form.reset();
    setMetricSuggestionStatus("Thanks. We received your suggestion and will review it.", "success");
  } catch (error) {
    setMetricSuggestionStatus(error.message || "Unable to send your suggestion.", "error");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function metricSuggestionPayload(form) {
  const formData = new FormData(form);
  const wardSelect = form.querySelector("[data-ward-select]");
  const communityAreaSelect = form.querySelector("[data-community-area-select]");
  return {
    name: formData.get("name"),
    email: formData.get("email"),
    ward_id: formData.get("ward_id"),
    ward: selectedOptionLabel(wardSelect),
    community_area_id: formData.get("community_area_id"),
    community_area: selectedOptionLabel(communityAreaSelect),
    address_or_intersection: formData.get("address_or_intersection"),
    metric: formData.get("metric"),
    wellbeing_rationale: formData.get("wellbeing_rationale"),
    can_list_nominator: formData.has("can_list_nominator"),
    source: new URLSearchParams(window.location.search).get("source") || "",
    organization_affiliation: "",
  };
}

async function populateMetricSuggestionLocationOptions(form) {
  const wardSelect = form.querySelector("[data-ward-select]");
  const communityAreaSelect = form.querySelector("[data-community-area-select]");
  try {
    const [wardsData, communityAreaData] = await Promise.all([
      WardWiseExplorer.fetchExplorerWards(),
      WardWiseExplorer.fetchCommunityAreas(),
    ]);
    if (wardSelect) {
      wardSelect.insertAdjacentHTML(
        "beforeend",
        (wardsData.wards || []).map((ward) => `
          <option value="${WardWiseExplorer.escapeHtml(ward.ward_id || "")}">
            ${WardWiseExplorer.escapeHtml(ward.display_name || `Ward ${ward.ward_number || ward.ward_id}`)}
          </option>
        `).join(""),
      );
    }
    if (communityAreaSelect) {
      communityAreaSelect.insertAdjacentHTML(
        "beforeend",
        (communityAreaData.community_areas || []).map((area) => `
          <option value="${WardWiseExplorer.escapeHtml(area.community_area_id || "")}">
            ${WardWiseExplorer.escapeHtml(area.name || area.display_name || `Community area ${area.community_area_number || area.community_area_id}`)}
          </option>
        `).join(""),
      );
    }
  } catch (_error) {
    // The address field remains available if location option loading fails.
  }
}

function selectedOptionLabel(select) {
  if (!select || !select.value) return "";
  return select.options[select.selectedIndex]?.textContent.trim() || "";
}

function setMetricSuggestionStatus(message, status = "") {
  const statusEl = document.getElementById("metric-recommendation-status");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.hidden = !message;
  statusEl.classList.toggle("is-error", status === "error");
  statusEl.classList.toggle("is-success", status === "success");
}

initMetricSuggestionForm();
