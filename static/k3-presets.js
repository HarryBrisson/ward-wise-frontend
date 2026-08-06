// Nine starting points. Seven aim at questions people argue about at ward
// nights (housing cost, safety, aldermanic performance, kids, getting around,
// local business, environment) and two are broader lanes anyone cares about
// whatever their politics (health, and what there is to do). Drafted through
// nine single-lens passes over the full catalog, every metric id validated
// against the live catalog, and no two lists share more than one measure.
// Names stay to two words, taglines under twelve.
window.K3_PRESETS = [
  {
    name: "Housing Squeeze",
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
    name: "Safe Streets",
    tagline: "Crime, street repairs, and whether neighbors look out for each other",
    metric_ids: [
      "violent_crime_rate_per_10000",
      "modeled_fear_walking_pct",
      "c311_street_light_days",
      "c311_graffiti_days",
      "neighbor_collective_action_pct",
      "community_belonging_pct",
      "neighbor_contact_monthly_pct",
    ],
  },
  {
    name: "Report Card",
    tagline: "Whether your alder shows up and spends the ward money",
    metric_ids: [
      "voter_turnout_pct",
      "council_attendance_pct",
      "nonroutine_bills_sponsored_current_session",
      "c311_response_days",
      "menu_budget_utilization",
      "participatory_budgeting",
      "menu_project_diversity",
    ],
  },
  {
    name: "Raising Kids",
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
    name: "Getting Around",
    tagline: "Transit, biking, and how fast streets get fixed",
    metric_ids: [
      "public_transit_pct",
      "cta_l_station_entries",
      "active_transportation_pct",
      "divvy_rides_started",
      "c311_pothole_days",
      "c311_street_light_days",
      "menu_active_transport_share",
    ],
  },
  {
    name: "Main Street",
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
    name: "Clean Air",
    tagline: "Pollution burden, parks, and gardens across your ward",
    metric_ids: [
      "environmental_justice_index",
      "ej_impact_rate_pct",
      "air_pm25_annual",
      "air_ozone_annual",
      "park_acres_per_10000_residents",
      "garden_count",
      "c311_tree_debris_days",
    ],
  },
  {
    name: "Staying Healthy",
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
    name: "Things To Do",
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
];
