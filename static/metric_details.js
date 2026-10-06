// Shared metric-definition rendering utilities.
// Exposed on window.WardWiseMetricDetails so both the Metrics page and
// Explorer page can use them without a module bundler.

(function () {
  const GNHUSA_DOMAINS = [
    {
      id: "psychological_wellbeing",
      title: "Psychological wellbeing",
      summary: "Measures that describe emotional and mental wellbeing.",
    },
    {
      id: "social_connectedness",
      title: "Social connectedness",
      summary: "Measures that describe isolation, support, and social connection.",
    },
    {
      id: "material_wellbeing",
      title: "Material wellbeing",
      summary: "Measures that describe income, housing costs, and basic economic security.",
    },
    {
      id: "health",
      title: "Health",
      summary: "Measures that describe physical health, insurance, and health-related behavior.",
    },
    {
      id: "time_balance",
      title: "Time balance",
      summary: "Measures that describe commute burden and daily mobility choices.",
    },
    {
      id: "religion_spiritual",
      title: "Religion/spirituality",
      summary: "Measures that describe access to faith and spiritual community places.",
    },
    {
      id: "lifelong_learning",
      title: "Lifelong learning",
      summary: "Measures that describe libraries, educational attainment, and learning access.",
    },
    {
      id: "good_governance",
      title: "Good governance",
      summary: "Measures that describe civic participation and local government activity.",
    },
    {
      id: "community_vitality",
      title: "Community vitality",
      summary: "Measures that describe public life, safety, and shared places.",
    },
    {
      id: "physical_environment",
      title: "Physical environment",
      summary: "Measures that describe parks, streets, tree canopy, and environmental conditions.",
    },
    {
      id: "culture",
      title: "Culture",
      summary: "Measures that describe cultural, landmark, arts, and museum resources.",
    },
  ];
  const GNHUSA_DOMAIN_BY_ID = new Map(GNHUSA_DOMAINS.map((domain) => [domain.id, domain]));
  const OTHER_DOMAIN = {
    id: "other_measurement_inputs",
    title: "Other measurement inputs",
    summary: "Additional transparent inputs that are useful context but are not one of the GNHUSA domains.",
  };
  const SOURCE_KEY_ALIASES = {
    architecture_landmarks: "wikidata_architecture_landmarks",
    cdc_places_frequent_mental_distress_pct: "cdc_places_wellbeing",
    cdc_places_adult_loneliness_pct: "cdc_places_wellbeing",
    cdc_places_physical_inactivity_pct: "cdc_places_wellbeing",
    cdc_places_poor_or_fair_health_pct: "cdc_places_wellbeing",
    cdc_places_social_emotional_support_pct: "cdc_places_wellbeing",
    cdc_places_social_isolation_pct: "cdc_places_wellbeing",
    chicago_health_atlas_hcscbp: "chicago_health_atlas_wellbeing",
    chicago_health_atlas_chavqos: "chicago_health_atlas_wellbeing",
    cps_cev_social_fabric_model: "cps_cev_social_fabric",
    places_of_interest: "overpass",
    violent_crime_population_denominator: "population_denominator",
  };
  const ACS_TABLE_BY_METRIC_ID = {
    active_transportation_pct: "B08301",
    broadband_access_pct: "B28002",
    educational_attainment_bachelors_plus_pct: "B15003",
    living_alone_households_pct: "B11001",
    long_commute_pct: "B08303",
    median_household_income: "B19013",
    poverty_pct: "B17001",
    public_transit_pct: "B08301",
    rent_burdened_households_pct: "B25070",
    uninsured_pct: "B27001",
  };
  const ACS_OVERVIEW_URL = "https://www.census.gov/programs-surveys/acs";

  function renderCalculationNote(latestSnapshot) {
    return `
      <section class="calculation-note">
        <p>
          The catalog is grouped by GNHUSA wellbeing domains so you can read the measures by topic.
          Every metric is shown, including measures that are still awaiting data or are kept for
          transparency outside the default score.
        </p>
        <p>
          When a metric is included in the composite, the latest ward value is normalized from
          0 to 100 across wards. Lower-is-better metrics are inverted before scoring.
        </p>
        <p class="transparency-meta">
          Latest metric snapshot: ${WardWiseExplorer.escapeHtml(WardWiseExplorer.formatDate(latestSnapshot?.collected_at))}.
        </p>
      </section>
    `;
  }

  function isInternalSource(source) {
    const value = String(source || "").trim();
    return (
      !value ||
      value.startsWith("pipelines.") ||
      value.startsWith("shared/") ||
      value.includes("/shared/")
    );
  }

  // Hover-length methodology: curated short if provided, else the first sentence (house style puts
  // the substantive what/how/vintage there), hard-capped so tooltips stay readable.
  function metricMethodologySummary(metric) {
    if (metric.methodology_short) return metric.methodology_short;
    const full = metricMethodology(metric) || "";
    if (full.length <= 170) return full;
    const sentence = full.split(/(?<=\.)\s+/)[0] || full;
    return sentence.length <= 220 ? sentence : sentence.slice(0, 200).replace(/\s+\S*$/, "") + "…";
  }

  function metricMethodology(metric) {
    return metric?.methodology || "";
  }

  function metricSource(metric, coverage) {
    const candidates = [metric?.source_label, metric?.source, coverage?.latest_source];
    return candidates.find((source) => source && !isInternalSource(source)) || "";
  }

  function renderMetricDefinitionGroups(metrics, coverage, snapshots, options = {}) {
    const groups = groupedMetrics(metrics);
    // the full list rides in options so a card can name its same-measure siblings, which live in
    // other domain groups (renderMetricDomainPanel only ever sees its own group)
    options = { ...options, allMetrics: metrics };
    if (!groups.length) {
      return "<p>No metric definitions are available yet.</p>";
    }
    return `
      <div class="metric-domain-layout">
        ${renderDomainTabs(groups)}
        <div class="metric-domain-panels">
          ${groups.map((group) => renderMetricDomainPanel(group, coverage, snapshots, options)).join("")}
        </div>
      </div>
    `;
  }


  // Sibling sources for the same measure. Seeing "also counted by: business licences, County
  // Business Patterns" is what tells a reader these rows aren't three different things.
  function measureFamilyNoteHtml(metric, allMetrics) {
    if (!metric.measure_family) return "";
    const siblings = (allMetrics || []).filter(
      (m) => m.measure_family === metric.measure_family && m.metric_id !== metric.metric_id);
    if (!siblings.length) return "";
    const links = siblings
      .map((m) => `<a href="?metric=${WardWiseExplorer.escapeHtml(m.metric_id)}" data-metric-link="${WardWiseExplorer.escapeHtml(m.metric_id)}">${
        WardWiseExplorer.escapeHtml(m.source_variant || m.label)}</a>`)
      .join(", ");
    return `<p class="metric-family-note">The same measure is also counted from ${links}. ` +
      `Sources disagree — that gap is information, not an error.</p>`;
  }

  function groupedMetrics(metrics) {
    const byDomain = new Map();
    metrics.forEach((metric) => {
      const category = metric.category || "uncategorized";
      const domain = GNHUSA_DOMAIN_BY_ID.get(category) || OTHER_DOMAIN;
      if (!byDomain.has(domain.id)) {
        byDomain.set(domain.id, { ...domain, metrics: [] });
      }
      byDomain.get(domain.id).metrics.push(metric);
    });
    const orderedGroups = GNHUSA_DOMAINS
      .map((domain) => byDomain.get(domain.id))
      .filter(Boolean);
    if (byDomain.has(OTHER_DOMAIN.id)) {
      orderedGroups.push(byDomain.get(OTHER_DOMAIN.id));
    }
    orderedGroups.forEach((group) => {
      group.metrics.sort((a, b) =>
        String(a.label || a.metric_id).localeCompare(String(b.label || b.metric_id)),
      );
    });
    return orderedGroups;
  }

  function renderDomainTabs(groups) {
    return `
      <nav class="metric-domain-toc" aria-label="Metric domains">
        <p class="eyebrow">Domains</p>
        ${groups.map((group) => `
          <a class="metric-domain-toc-link" href="#metric-domain-${WardWiseExplorer.escapeHtml(group.id)}">
            <span>${WardWiseExplorer.escapeHtml(group.title)}</span>
            <strong>${WardWiseExplorer.escapeHtml(group.metrics.length)}</strong>
          </a>
        `).join("")}
      </nav>
    `;
  }

  function renderMetricDomainPanel(group, coverage, snapshots, options) {
    return `
      <section id="metric-domain-${WardWiseExplorer.escapeHtml(group.id)}" class="metric-domain-panel">
        <div class="metric-domain-heading">
          <p class="eyebrow">${group.id === OTHER_DOMAIN.id ? "Additional inputs" : "GNHUSA domain"}</p>
          <h4>${WardWiseExplorer.escapeHtml(group.title)}</h4>
          <p>${WardWiseExplorer.escapeHtml(group.summary)}</p>
          <p class="transparency-meta">${WardWiseExplorer.escapeHtml(domainCoverageSummary(group.metrics, coverage))}</p>
        </div>
        <div class="metric-definition-list">
          ${group.metrics.map((metric) => renderMetricDefinition(metric, coverage, snapshots, options)).join("")}
        </div>
      </section>
    `;
  }

  function domainCoverageSummary(metrics, coverage) {
    const counts = metrics.reduce(
      (memo, metric) => {
        const metricCoverage = coverage?.[metric.metric_id] || {};
        if ((metricCoverage.populated_ward_count || 0) > 0) memo.withData += 1;
        if ((metric.default_weight ?? 0) <= 0) memo.notScored += 1;
        if ((metricCoverage.populated_ward_count || 0) <= 0) memo.awaitingData += 1;
        return memo;
      },
      { withData: 0, notScored: 0, awaitingData: 0 },
    );
    const parts = [
      `${metrics.length} ${metrics.length === 1 ? "metric" : "metrics"}`,
      `${counts.withData} with ward data`,
    ];
    if (counts.notScored) parts.push(`${counts.notScored} not in default scoring`);
    if (counts.awaitingData) parts.push(`${counts.awaitingData} awaiting data`);
    return parts.join(" / ");
  }

  function renderMetricDefinition(metric, coverage, snapshots, options = {}) {
    const metricCoverage = coverage?.[metric.metric_id] || null;
    const status = metricStatus(metricCoverage, metric);
    const methodology = metricMethodology(metric);
    const source = metricSource(metric, metricCoverage);
    const sourceUrl = metricSourceUrl(metric, metricCoverage, snapshots);
    const isAdmin = Boolean(options.isAdmin);
    const directionLabel =
      metric.direction === "lower"
        ? "Lower values score better"
        : metric.direction === "higher"
          ? "Higher values score better"
          : "Neutral direction";
    const defaultWeight = metric.default_weight ?? 0;
    const scoringLabel = defaultWeight > 0
      ? "Included in the default composite when ward data is available."
      : "Not currently included in the default composite.";
    return `
      <details class="metric-definition-card" id="metric-entry-${WardWiseExplorer.escapeHtml(metric.metric_id)}">
        <summary class="metric-definition-summary">
          <span class="metric-definition-heading">
            <span class="metric-definition-title">${WardWiseExplorer.escapeHtml(metric.label || metric.metric_id)}</span>
            ${renderMetricStatusBadge(status)}
          </span>
          <span>${WardWiseExplorer.escapeHtml(metric.description || "No definition is available yet.")}</span>
        </summary>
        <div class="metric-definition-body">
          ${measureFamilyNoteHtml(metric, options.allMetrics)}
          ${methodology ? `<p><strong>How to read it:</strong> ${WardWiseExplorer.escapeHtml(methodology)}</p>` : ""}
          ${metric.calculation ? `<p><strong>How it is calculated:</strong> ${WardWiseExplorer.escapeHtml(metric.calculation)}</p>` : ""}
          <dl class="metric-definition-meta">
            <div>
              <dt>Source</dt>
              <dd>${renderMetricSource(source, sourceUrl)}</dd>
            </div>
            ${renderMetricExplore(metric)}
            <div>
              <dt>Coverage</dt>
              <dd>${WardWiseExplorer.escapeHtml(metricCoverageLabel(metricCoverage))}</dd>
            </div>
            <div>
              <dt>Latest period</dt>
              <dd>${WardWiseExplorer.escapeHtml(metricCoveragePeriod(metricCoverage))}</dd>
            </div>
            <div>
              <dt>Scoring direction</dt>
              <dd>${WardWiseExplorer.escapeHtml(directionLabel)}</dd>
            </div>
            <div>
              <dt>Default score use</dt>
              <dd>${WardWiseExplorer.escapeHtml(scoringLabel)}</dd>
            </div>
            <div>
              <dt>Unit</dt>
              <dd>${WardWiseExplorer.escapeHtml(metric.unit || "number")}</dd>
            </div>
          </dl>
          ${renderMetricNominator(metric, isAdmin)}
          ${isAdmin ? renderAdminTechnicalDetails(metric, metricCoverage, status, source, defaultWeight) : ""}
        </div>
      </details>
    `;
  }

  function renderMetricNominator(metric, isAdmin) {
    const nominator = metric?.nominator;
    if (!nominator || (!isAdmin && !nominator.can_list)) return "";
    const name = nominator.name || "Nominator not recorded";
    const details = [
      nominator.organization_affiliation,
      nominator.ward || (nominator.ward_id ? `Ward ${displayNumber(nominator.ward_id)}` : ""),
      nominator.community_area,
      isAdmin && nominator.email ? nominator.email : "",
    ].filter(Boolean);
    const privacy = isAdmin && !nominator.can_list
      ? "<p class=\"transparency-meta\">This attribution is only visible to admins until listing is allowed.</p>"
      : "";
    return `
      <section class="metric-nominator-attribution">
        <p class="eyebrow">Nominator</p>
        <h5>${WardWiseExplorer.escapeHtml(name)}</h5>
        ${details.length ? `<p>${WardWiseExplorer.escapeHtml(details.join(" / "))}</p>` : ""}
        ${nominator.notes && isAdmin ? `<p>${WardWiseExplorer.escapeHtml(nominator.notes)}</p>` : ""}
        ${privacy}
      </section>
    `;
  }

  function renderMetricSource(source, sourceUrl) {
    if (!source) return "Not recorded";
    if (!sourceUrl) return WardWiseExplorer.escapeHtml(source);
    return `<a href="${WardWiseExplorer.escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${WardWiseExplorer.escapeHtml(source)}</a>`;
  }

  // A partner site that shows this metric's underlying records. Deliberately its own row rather
  // than folded into Source: the number came from the source, the deeper view comes from here.
  function renderMetricExplore(metric) {
    const explore = metric?.explore;
    if (!explore || !isHttpUrl(explore.url)) return "";
    const label = explore.label || "External site";
    const note = explore.note
      ? `<span class="metric-explore-note">${WardWiseExplorer.escapeHtml(explore.note)}</span>`
      : "";
    return `
      <div>
        <dt>Explore further</dt>
        <dd><a href="${WardWiseExplorer.escapeHtml(explore.url)}" target="_blank" rel="noopener noreferrer">${WardWiseExplorer.escapeHtml(label)}</a>${note}</dd>
      </div>
    `;
  }

  function renderAdminTechnicalDetails(metric, coverage, status, source, defaultWeight) {
    const sourceKeys = Array.isArray(coverage?.source_status_keys)
      ? coverage.source_status_keys.join(", ")
      : "";
    const metadata = coverage?.latest_metadata || {};
    return `
      <details class="metric-technical-details">
        <summary>Technical details</summary>
        <dl class="metric-definition-meta metric-definition-meta-admin">
          <div>
            <dt>Metric ID</dt>
            <dd><code>${WardWiseExplorer.escapeHtml(metric.metric_id)}</code></dd>
          </div>
          <div>
            <dt>Raw status</dt>
            <dd>${WardWiseExplorer.escapeHtml(rawMetricStatusLabel(coverage, status))}</dd>
          </div>
          <div>
            <dt>Status reason</dt>
            <dd>${WardWiseExplorer.escapeHtml(coverage?.status_reason || metricStatusNote(status, coverage) || "Not recorded")}</dd>
          </div>
          <div>
            <dt>Release</dt>
            <dd>${WardWiseExplorer.escapeHtml(metricCoverageRelease(coverage))}</dd>
          </div>
          <div>
            <dt>Allocation</dt>
            <dd>${WardWiseExplorer.escapeHtml(metricAllocationLabel(coverage))}</dd>
          </div>
          <div>
            <dt>Default weight</dt>
            <dd>${WardWiseExplorer.formatNumber(defaultWeight, { maximumFractionDigits: 1 })}</dd>
          </div>
          <div>
            <dt>Source keys</dt>
            <dd>${WardWiseExplorer.escapeHtml(sourceKeys || "Not recorded")}</dd>
          </div>
          <div>
            <dt>Latest source</dt>
            <dd>${WardWiseExplorer.escapeHtml(source || coverage?.latest_source || "Not recorded")}</dd>
          </div>
        </dl>
        ${Object.keys(metadata).length ? `<pre>${WardWiseExplorer.escapeHtml(JSON.stringify(metadata, null, 2))}</pre>` : ""}
      </details>
    `;
  }

  function metricStatus(coverage, metric) {
    const status = coverage?.status || "source_pending";
    if (status === "source_unavailable") {
      return { id: status, label: "Data not available yet" };
    }
    if (status === "ingestion_not_implemented") {
      return { id: status, label: "Data not available yet" };
    }
    if (status === "zero_records_observed") {
      return { id: status, label: "Data not available yet" };
    }
    if (status === "partially_populated") {
      const count = coverage?.populated_ward_count;
      return { id: status, label: count ? `Partly available (${count}/50 wards)` : "Partly available" };
    }
    // There is no default index anymore (everyone builds their own equation), so a populated
    // metric is simply Available regardless of its legacy default weight.
    if (status === "populated" || status === "available_unweighted" || status === "disabled_from_scoring"
        || coverage?.populated_ward_count > 0) {
      return { id: "populated", label: "Available" };
    }
    return { id: "source_pending", label: "Data not available yet" };
  }

  function metricStatusNote(status, coverage) {
    if (status.id === "source_pending") {
      return (
        coverage?.status_reason ||
        "No ward observations yet; this weight will not affect scores until source data is loaded."
      );
    }
    if (status.id === "source_unavailable") {
      return (
        coverage?.status_reason ||
        "The configured source did not have compatible data for this metric."
      );
    }
    if (status.id === "ingestion_not_implemented") {
      return (
        coverage?.status_reason ||
        "This catalog metric is not wired to an ingestion source yet."
      );
    }
    if (status.id === "zero_records_observed") {
      return (
        coverage?.status_reason ||
        "The source ran, but no source records were observed for this count metric."
      );
    }
    return "";
  }

  function renderMetricStatusBadge(status) {
    return `<span class="metric-status-badge is-${WardWiseExplorer.escapeHtml(status.id)}">${WardWiseExplorer.escapeHtml(status.label)}</span>`;
  }

  function metricCoverageLabel(coverage) {
    if (!coverage) return "0 of 0 wards populated";
    return `${coverage.populated_ward_count || 0} of ${coverage.ward_count || 0} wards populated`;
  }

  function metricCoveragePeriod(coverage) {
    if (!coverage?.latest_period_start && !coverage?.latest_period_end) {
      return "Not populated yet";
    }
    if (coverage.latest_period_start && coverage.latest_period_end) {
      return `${WardWiseExplorer.formatDate(coverage.latest_period_start)} to ${WardWiseExplorer.formatDate(coverage.latest_period_end)}`;
    }
    return WardWiseExplorer.formatDate(
      coverage.latest_period_end || coverage.latest_period_start,
    );
  }

  function metricCoverageRelease(coverage) {
    const metadata = coverage?.latest_metadata || {};
    if (metadata.release_year) return String(metadata.release_year);
    if (Array.isArray(metadata.release_years) && metadata.release_years.length) {
      return metadata.release_years.join(", ");
    }
    return "Not populated yet";
  }

  function metricAllocationLabel(coverage) {
    const metadata = coverage?.latest_metadata || {};
    const method = metadata.allocation_method;
    const confidence = metadata.confidence;
    const calculation = metadata.calculation_method;
    if (!method && !calculation) return "Not populated yet";
    return [method, calculation, confidence ? `${confidence} confidence` : ""]
      .filter(Boolean)
      .map((value) => String(value).replaceAll("_", " "))
      .join("; ");
  }

  function rawMetricStatusLabel(coverage, status) {
    return String(coverage?.status || status?.id || "source_pending").replaceAll("_", " ");
  }

  function metricSourceUrl(metric, coverage, snapshots) {
    if (metric?.source_url) return metric.source_url;
    const source = metricSource(metric, coverage);
    if (isHttpUrl(source)) return source;
    const publicAcsUrl = acsMetricSourceUrl(metric, coverage, source);
    if (publicAcsUrl) return publicAcsUrl;
    if (isAcsBackedMetric(coverage, source)) return ACS_OVERVIEW_URL;
    const latestSnapshot = latestMetricSnapshot(snapshots);
    const sourceUrls = latestSnapshot?.source_urls || {};
    const sourceKeys = Array.isArray(coverage?.source_status_keys)
      ? coverage.source_status_keys
      : [];
    return sourceUrlFromKeys(sourceKeys, sourceUrls) || sourceUrlFromText(source, sourceUrls);
  }

  function latestMetricSnapshot(snapshots) {
    return [...(snapshots || [])]
      .sort((a, b) =>
        String(a.collected_at || "").localeCompare(String(b.collected_at || "")),
      )
      .at(-1);
  }

  function sourceUrlFromKeys(sourceKeys, sourceUrls) {
    for (const key of sourceKeys) {
      if (sourceUrls[key]) return sourceUrls[key];
      const alias = SOURCE_KEY_ALIASES[key] || inferredSourceKeyAlias(key);
      if (alias && sourceUrls[alias]) return sourceUrls[alias];
    }
    return "";
  }

  function inferredSourceKeyAlias(key) {
    if (key.startsWith("cdc_places_")) return "cdc_places_wellbeing";
    if (key.startsWith("chicago_health_atlas_")) return "chicago_health_atlas_wellbeing";
    if (key.startsWith("acs_")) return "acs_wellbeing";
    return "";
  }

  function sourceUrlFromText(source, sourceUrls) {
    const value = String(source || "").toLowerCase();
    if (value.includes("american community survey")) return sourceUrls.acs_wellbeing || sourceUrls.population_denominator || "";
    if (value.includes("cdc places")) return sourceUrls.cdc_places_wellbeing || "";
    if (value.includes("chicago health atlas")) return sourceUrls.chicago_health_atlas_wellbeing || "";
    if (value.includes("councilmatic")) return sourceUrls.councilmatic_government_quality || "";
    if (value.includes("openstreetmap") || value.includes("overpass")) return sourceUrls.overpass || "";
    if (value.includes("voter") || value.includes("election")) return sourceUrls.voter_turnout || "";
    if (value.includes("park district")) return sourceUrls.park_access || "";
    if (value.includes("wikidata")) return sourceUrls.wikidata_architecture_landmarks || "";
    return "";
  }

  function acsMetricSourceUrl(metric, coverage, source) {
    const tableId = ACS_TABLE_BY_METRIC_ID[metric?.metric_id];
    if (!tableId || !isAcsBackedMetric(coverage, source)) return "";
    return `https://censusreporter.org/tables/${tableId}/`;
  }

  function isAcsBackedMetric(coverage, source) {
    const sourceKeys = Array.isArray(coverage?.source_status_keys)
      ? coverage.source_status_keys
      : [];
    if (sourceKeys.some((key) => key.startsWith("acs_"))) {
      return true;
    }
    return String(source || "").toLowerCase().includes("american community survey");
  }

  function isHttpUrl(value) {
    try {
      const parsed = new URL(String(value));
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_error) {
      return false;
    }
  }

  function displayNumber(value) {
    const numeric = Number.parseInt(value, 10);
    return Number.isFinite(numeric) ? numeric : value;
  }

  function formatMetricCategory(category) {
    if (GNHUSA_DOMAIN_BY_ID.has(category)) {
      return GNHUSA_DOMAIN_BY_ID.get(category).title;
    }
    if (category === "reviews") return "Other measurement inputs";
    return String(category || "uncategorized")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  window.WardWiseMetricDetails = {
    render({ metrics, coverage, snapshots, isAdmin = false }) {
      const latestSnapshot = latestMetricSnapshot(snapshots);
      return [
        renderCalculationNote(latestSnapshot),
        renderMetricDefinitionGroups(metrics, coverage || {}, snapshots || [], { isAdmin }),
      ].join("");
    },
    metricStatus,
    metricStatusNote,
    metricCoverageLabel,
    renderMetricStatusBadge,
    formatMetricCategory,
    metricMethodology,
    metricMethodologySummary,
    metricSource,
    metricSourceUrl,
  };

  // A metric link from a report (/dictionary?metric=X) opens the entry and scrolls to it.
  function revealEntry(metricId) {
    const entry = document.getElementById(`metric-entry-${metricId}`);
    if (!entry) return false;
    entry.open = true;  // domain panels all render — only the entry itself needs opening
    entry.scrollIntoView({ block: "center", behavior: "smooth" });
    entry.classList.add("is-highlighted");
    setTimeout(() => entry.classList.remove("is-highlighted"), 2400);
    return true;
  }

  // Auto-initialize the /dictionary page when its root element is present.
  const metricsRoot = document.getElementById("metrics-content");
  if (metricsRoot) {
    const isAdmin = metricsRoot.dataset.isAdmin === "true";
    WardWiseExplorer.fetchMetrics()
      .then((metricData) => {
        metricsRoot.innerHTML = WardWiseMetricDetails.render({
          metrics: metricData.metrics,
          coverage: metricData.coverage || {},
          snapshots: metricData.snapshots,
          weights: metricData.default_weights || {},
          isAdmin,
        });
        const wanted = new URLSearchParams(location.search).get("metric");
        if (wanted) revealEntry(wanted);
        // sibling-source links inside an entry: jump within the page instead of reloading it
        metricsRoot.addEventListener("click", (event) => {
          const link = event.target.closest("a[data-metric-link]");
          if (!link) return;
          event.preventDefault();
          const id = link.dataset.metricLink;
          history.replaceState(null, "", `${location.pathname}?metric=${encodeURIComponent(id)}`);
          revealEntry(id);
        });
      })
      .catch((error) => {
        metricsRoot.innerHTML = `<p>Unable to load metrics: ${WardWiseExplorer.escapeHtml(error.message)}</p>`;
      });
  }
})();
