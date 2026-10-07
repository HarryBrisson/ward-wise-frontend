// Curated lists: named starting points for the composite score.
//
// Each list is a flat set of metric ids that all count equally (weight 1). Nine of them follow
// Connor's redesign (questions people argue about at ward nights), one is the everyday starter
// set, and one is ours ("City Services", 311 service response times with duplicates grouped). Ids are validated
// against the live catalog at apply time, so a measure that is missing for a geography (many
// ward-only measures have no neighborhood version) degrades to "n of m available" rather than
// breaking the list. `short` is the phone-strip label: keep it to ~10 characters. `icon_metric` names
// the measure whose glyph fronts the chip (see metric_icons.js).
//
// To add a list, append an entry here. tests/test_ward_wise_explorer_routes.py checks that every
// id exists in the catalog, ids are unique within a list, and `short` stays short.
window.WardWisePresets = [
  {
    id: "starter",
    icon_metric: "landmark_count",
    name: "Basics",
    short: "Basics",
    tagline: "Five everyday measures: parks, libraries, landmarks, belonging, and mental distress",
    metric_ids: [
      "park_count",
      "library_count",
      "community_belonging_pct",
      "frequent_mental_distress_pct",
      "landmark_count",
    ],
  },
  {
    id: "housing",
    icon_metric: "median_gross_rent",
    name: "Housing Squeeze",
    short: "Housing",
    tagline: "What it costs to stay and who is getting pushed out",
    metric_ids: [
      "median_gross_rent",
      "observed_asking_rent_usd",
      "rent_burdened_households_pct",
      "poverty_pct",
      "demolition_permits_count",
      "absentee_owner_share_pct",
    ],
  },
  {
    id: "safety",
    icon_metric: "violent_crime_rate_per_10000",
    name: "Safe Streets",
    short: "Safety",
    tagline: "Crime, street repairs, and whether neighbors look out for each other",
    metric_ids: [
      "violent_crime_rate_per_10000",
      "modeled_fear_walking_pct",
      "c311_service_street_light_days",
      "c311_service_graffiti_days",
      "neighbor_collective_action_pct",
      "community_belonging_pct",
      "neighbor_contact_monthly_pct",
    ],
  },
  {
    id: "alder",
    icon_metric: "voter_turnout_pct",
    name: "Report Card",
    short: "Report Card",
    tagline: "Whether your alder shows up and spends the ward money",
    metric_ids: [
      "voter_turnout_pct",
      "council_attendance_pct",
      "nonroutine_bills_sponsored_current_session",
      "c311_service_response_days",
      "menu_budget_utilization",
      "participatory_budgeting",
      "menu_project_diversity",
    ],
  },
  {
    id: "kids",
    icon_metric: "school_proficiency_pct",
    name: "Raising Kids",
    short: "Kids",
    tagline: "Schools, child care, parks, and safety for families with kids",
    metric_ids: [
      "school_proficiency_pct",
      "chronic_absenteeism_pct",
      "licensed_child_care_per_10000_residents",
      "park_acres_per_10000_residents",
      "violent_crime_rate_per_10000",
      "poverty_pct",
    ],
  },
  {
    id: "transit",
    icon_metric: "cta_l_station_entries",
    name: "Getting Around",
    short: "Transit",
    tagline: "Transit, biking, and how fast streets get fixed",
    metric_ids: [
      "public_transit_pct",
      "cta_l_station_entries",
      "active_transportation_pct",
      "divvy_rides_count",
      "c311_service_pothole_days",
      "c311_service_street_light_days",
      "menu_active_transport_share",
    ],
  },
  {
    id: "mainst",
    icon_metric: "licensed_food_businesses_per_10000_residents",
    name: "Main Street",
    short: "Main St",
    tagline: "Local shops, bars, groceries, permits, and household income",
    metric_ids: [
      "licensed_food_businesses_per_10000_residents",
      "licensed_bars_per_10000_residents",
      "licensed_outdoor_patios_per_10000_residents",
      "licensed_chain_restaurant_share_pct",
      "licensed_grocery_stores_per_10000_residents",
      "building_permit_processing_days",
      "median_household_income",
    ],
  },
  {
    id: "air",
    icon_metric: "air_pm25_annual",
    name: "Clean Air",
    short: "Clean Air",
    tagline: "Pollution burden, parks, and gardens",
    metric_ids: [
      "environmental_justice_index",
      "ej_impact_rate_pct",
      "air_pm25_annual",
      "air_ozone_annual",
      "park_acres_per_10000_residents",
      "garden_count",
      "c311_service_tree_debris_days",
    ],
  },
  {
    id: "health",
    icon_metric: "poor_or_fair_health_pct",
    name: "Staying Healthy",
    short: "Health",
    tagline: "How healthy people are and what is nearby to keep them that way",
    metric_ids: [
      "poor_or_fair_health_pct",
      "uninsured_pct",
      "physical_inactivity_pct",
      "mental_health_providers_per_10000_residents",
      "fitness_places_per_10000_residents",
      "licensed_grocery_stores_per_10000_residents",
      "park_fountain_lead_flagged_pct",
    ],
  },
  {
    id: "fun",
    icon_metric: "arts_culture_count",
    name: "Things To Do",
    short: "To Do",
    tagline: "Museums, music, late nights, and places worth walking to",
    metric_ids: [
      "arts_culture_count",
      "museum_count",
      "licensed_amusement_venues_per_10000_residents",
      "licensed_music_dance_per_10000_residents",
      "third_places_per_10000_residents",
      "open_late_per_10000_residents",
      "places_of_interest_count",
    ],
  },
  {
    id: "services",
    icon_metric: "c311_service_pothole_days",
    name: "City Services",
    short: "Services",
    tagline: "How fast 311 requests get closed: potholes, lights, graffiti, rats, trees, carts",
    metric_ids: [
      "c311_service_pothole_days",
      "c311_service_street_light_days",
      "c311_service_graffiti_days",
      "c311_service_rodent_days",
      "c311_service_tree_debris_days",
      "c311_service_garbage_cart_days",
    ],
  },
  {
    id: "nightlife",
    icon_metric: "dedicated_bars_count",
    name: "Night Out",
    short: "Night Out",
    tagline: "Bars, late hours, music, and places that serve after dark",
    metric_ids: [
      "dedicated_bars_count",
      "licensed_restaurants_liquor_per_10000_residents",
      "licensed_music_dance_per_10000_residents",
      "licensed_amusement_venues_per_10000_residents",
      "open_late_per_10000_residents",
      "dedicated_bars_median_rating",
    ],
  },
  {
    id: "local",
    icon_metric: "coffee_shops_count",
    name: "Local Flavor",
    short: "Local",
    tagline: "Independent shops over chains, coffee, third places, murals",
    metric_ids: [
      "licensed_chain_restaurant_share_pct",
      "licensed_chain_store_share_pct",
      "chain_restaurant_share_pct",
      "coffee_shops_count",
      "third_places_per_10000_residents",
      "murals_registered_count",
    ],
  },
  {
    id: "older",
    icon_metric: "living_alone_households_pct",
    name: "Growing Older",
    short: "Older",
    tagline: "Pharmacies, groceries, transit, support, and not being alone",
    metric_ids: [
      "pharmacies_per_10000_residents",
      "licensed_grocery_stores_per_10000_residents",
      "public_transit_pct",
      "living_alone_households_pct",
      "social_emotional_support_pct",
      "poor_or_fair_health_pct",
    ],
  },
  {
    id: "money",
    icon_metric: "median_household_income",
    name: "Money & Work",
    short: "Money",
    tagline: "Incomes, poverty, broadband, banks, and the absence of pawnshops",
    metric_ids: [
      "median_household_income",
      "avg_agi_per_return_usd",
      "poverty_pct",
      "broadband_access_pct",
      "bank_branches_per_10000_residents",
      "licensed_pawnbrokers_per_10000_residents",
    ],
  },
  {
    id: "faith",
    icon_metric: "worship_places_per_10000_residents",
    name: "Faith & Belonging",
    short: "Belonging",
    tagline: "Congregations, faith diversity, neighbors who know each other",
    metric_ids: [
      "worship_places_per_10000_residents",
      "congregations_per_10000_residents",
      "worship_denominational_diversity",
      "community_belonging_pct",
      "neighbor_contact_monthly_pct",
      "social_capital_cohesion_index",
    ],
  },
  {
    id: "building",
    icon_metric: "new_residential_construction_permits_count",
    name: "Building Boom",
    short: "Building",
    tagline: "New homes, renovation, and how fast the city says yes",
    metric_ids: [
      "new_residential_construction_permits_count",
      "new_residential_construction_investment_usd",
      "residential_renovation_permits_count",
      "residential_renovation_investment_usd",
      "demolition_permits_count",
      "building_permit_processing_days",
    ],
  },
  {
    id: "rest",
    icon_metric: "short_sleep_pct",
    name: "Time & Rest",
    short: "Rest",
    tagline: "Short commutes, enough sleep, leisure, and easy parking",
    metric_ids: [
      "long_commute_pct",
      "short_sleep_pct",
      "modeled_leisure_minutes",
      "modeled_time_poverty_pct",
      "active_transportation_pct",
      "parking_311_share_of_local_complaints_pct",
    ],
  },
  {
    id: "energy",
    icon_metric: "ej_diesel_pm",
    name: "Climate & Energy",
    short: "Energy",
    tagline: "Building emissions, energy ratings, ozone and diesel",
    metric_ids: [
      "building_ghg_intensity_median",
      "building_energy_rating_median",
      "building_benchmarking_compliance_pct",
      "building_ghg_emissions_tons",
      "air_ozone_annual",
      "ej_diesel_pm",
    ],
  },
  {
    id: "heritage",
    icon_metric: "designated_landmarks_count",
    name: "History & Heritage",
    short: "Heritage",
    tagline: "Landmarks, the National Register, museums, murals",
    metric_ids: [
      "designated_landmarks_count",
      "nrhp_listings_count",
      "chrs_historic_buildings_count",
      "museum_count",
      "arts_culture_count",
      "murals_registered_count",
    ],
  },
  {
    id: "green",
    icon_metric: "park_count",
    name: "Green & Quiet",
    short: "Green",
    tagline: "Parks, gardens, sun, and distance from traffic and smoke",
    metric_ids: [
      "park_count",
      "park_acres_per_10000_residents",
      "garden_count",
      "annual_sun_access_pct",
      "ej_traffic_proximity",
      "air_pm25_annual",
      "lakefront_distance_miles",
    ],
  },
];

window.WardWisePresetTools = (function () {
  const presets = window.WardWisePresets;

  function byId(id) {
    return presets.find((preset) => preset.id === id) || null;
  }

  // The chip's glyph: the list's representative measure, drawn by metric_icons.js when it is
  // loaded on the page; pages without it get a plain text chip.
  function iconHtml(preset, category) {
    if (!preset || !preset.icon_metric || !window.WardWiseIcons) return "";
    return `<span class="preset-chip-icon" aria-hidden="true">${window.WardWiseIcons.svg({ metric_id: preset.icon_metric, category: category || "" })}</span>`;
  }

  function random() {
    return presets[Math.floor(Math.random() * presets.length)];
  }

  // Zero for every known id, 1 for the list's ids that pass isAvailable. `used` and `missing`
  // let the caller say "4 of 7 available here" instead of silently scoring on fewer measures.
  function resolveWeights(preset, allMetricIds, isAvailable) {
    const known = new Set(allMetricIds || []);
    const ok = typeof isAvailable === "function" ? isAvailable : () => true;
    const weights = {};
    for (const id of known) weights[id] = 0;
    const used = [];
    const missing = [];
    for (const id of preset?.metric_ids || []) {
      if (known.has(id) && ok(id)) {
        weights[id] = 1;
        used.push(id);
      } else {
        missing.push(id);
      }
    }
    return { weights, used, missing };
  }

  // The list whose available ids are exactly the ids weighted > 0 (order-insensitive, all weights
  // equal), or null when the weights are a custom mix.
  function matchPreset(weights, isAvailable) {
    const ok = typeof isAvailable === "function" ? isAvailable : () => true;
    const active = Object.entries(weights || {})
      .filter(([, weight]) => Number(weight) > 0)
      .map(([id]) => id)
      .sort();
    if (!active.length) return null;
    const values = new Set(Object.values(weights).filter((weight) => Number(weight) > 0).map(Number));
    if (values.size !== 1) return null;
    const key = active.join(",");
    for (const preset of presets) {
      const usable = preset.metric_ids.filter((id) => ok(id)).sort().join(",");
      if (usable && usable === key) return preset;
    }
    return null;
  }

  return { byId, iconHtml, random, resolveWeights, matchPreset };
})();
