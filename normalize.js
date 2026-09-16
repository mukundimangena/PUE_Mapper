/* ==========================================================================
   PUE ROADSHOW ATLAS — Data Normalization Layer
   ==========================================================================
   Transforms the raw field-collected dataset (window.PUE_DATA — an array of
   roadshow entries, each with a cluster + villages + pue customers + leads)
   into the normalized entity model described in the product spec:

       provinces -> clusters -> sites -> customers -> machines

   IMPORTANT — READ BEFORE TRUSTING A NUMBER:
   The source dataset was collected as a lead-generation roadshow log, not as
   a formal GIS/asset register. It does NOT contain: administrative district
   boundaries, verified provincial boundaries, minigrid nameplate capacity,
   meter numbers, true daily energy readings (kWh/day), or confirmed machine
   delivery/connection status. Every one of those fields below is therefore a
   clearly-labeled DERIVED / APPROXIMATE value, produced by a documented
   heuristic (see the `methodology` block at the bottom of this file, which
   the UI surfaces via info icons). None of this should be presented to a
   funder or government stakeholder as verified/audited data — it is a
   planning aid to help a roadshow team prioritise where to go next.

   This file does not mutate window.PUE_DATA. It only reads it and produces
   a new global: window.PUE_ATLAS_DATA.
   ========================================================================== */

(function () {
  'use strict';

  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // --------------------------------------------------------------------
  // PROVINCE INFERENCE (approximate — nearest-centroid heuristic)
  // Zambia has 10 provinces. We do not have verified province polygons for
  // this dataset, so we assign each cluster to the province whose rough
  // geographic centroid is closest. Sanity-checked against real place names
  // that appear inside the dataset (e.g. "Kalomo Boma" -> Southern,
  // "Chama South Village" -> Muchinga, "Katete Scheme" -> Eastern), which
  // is why the centroids below are placed where they are.
  // --------------------------------------------------------------------
  var PROVINCE_CENTROIDS = [
    { name: 'Central', lat: -14.5, lon: 28.5 },
    { name: 'Copperbelt', lat: -12.8, lon: 28.2 },
    { name: 'Eastern', lat: -13.6, lon: 32.4 },
    { name: 'Luapula', lat: -10.5, lon: 29.5 },
    { name: 'Lusaka', lat: -15.4, lon: 28.3 },
    { name: 'Muchinga', lat: -11.8, lon: 32.0 },
    { name: 'Northern', lat: -10.2, lon: 31.3 },
    { name: 'North-Western', lat: -13.0, lon: 25.0 },
    { name: 'Southern', lat: -16.5, lon: 27.0 },
    { name: 'Western', lat: -15.0, lon: 23.5 }
  ];

  function inferProvince(lat, lon) {
    var best = null, bestDist = Infinity;
    for (var i = 0; i < PROVINCE_CENTROIDS.length; i++) {
      var p = PROVINCE_CENTROIDS[i];
      var d = haversineKm(lat, lon, p.lat, p.lon);
      if (d < bestDist) { bestDist = d; best = p.name; }
    }
    return best;
  }

  // --------------------------------------------------------------------
  // MACHINE TYPE INFERENCE from free-text "technology" field.
  // Ordered by specificity — first match wins. Multi-appliance strings
  // ("Hammer Mill, Grinder, Welding machine") are tagged with the first
  // recognised keyword, since the data model gives one machine per
  // customer record (a future iteration could split into multiple).
  // --------------------------------------------------------------------
  var MACHINE_KEYWORDS = [
    { key: 'hammer_mill', label: 'Hammer Mill', patterns: ['hammer mill', 'hammer and mill', 'hammermill', 'mill'] },
    { key: 'dehuller', label: 'Dehuller', patterns: ['dehuller'] },
    { key: 'oil_expeller', label: 'Oil Expeller', patterns: ['oil expeller'] },
    { key: 'sheller', label: 'Sheller', patterns: ['sheller', 'shelling'] },
    { key: 'irrigation', label: 'Irrigation Pump', patterns: ['irrigat', 'pump', 'filter'] },
    { key: 'welding', label: 'Welding Machine', patterns: ['welding'] },
    { key: 'grinder', label: 'Grinder', patterns: ['grinder', 'grinding'] },
    { key: 'refrigeration', label: 'Refrigeration Unit', patterns: ['fridge', 'freezer', 'freezit', 'cold', 'chest freezer'] },
    { key: 'sewing', label: 'Sewing Machine', patterns: ['sewing'] },
    { key: 'carpentry', label: 'Carpentry Tools', patterns: ['planer', 'planner', 'plainer', 'saw', 'sander', 'carpentry', 'power tool'] },
    { key: 'popcorn', label: 'Popcorn Machine', patterns: ['popcorn', 'pop corn'] },
    { key: 'peanut_butter', label: 'Peanut Butter / Oil Maker', patterns: ['peanut'] },
    { key: 'compressor', label: 'Compressor', patterns: ['compressor', 'blower'] },
    { key: 'barbing', label: 'Barbing / Salon Equipment', patterns: ['barb', 'hair', 'salon', 'shav', 'trim'] },
    { key: 'incubator', label: 'Egg Incubator', patterns: ['incubator'] },
    { key: 'ebike', label: 'E-Bike / E-Mobility', patterns: ['e-bike', 'e-bicycle', 'ebike'] },
    { key: 'cookstove', label: 'Cook Stove', patterns: ['cook stove', 'cookstove', 'induction stove'] },
    { key: 'pressure_cooker', label: 'Pressure Cooker', patterns: ['pressure cooker'] },
    { key: 'solar_home', label: 'Solar Home System', patterns: ['solar light', 'solar home', 'kapa', 'solar panel', 'home solar', 'energiser', 'energizer', 'battery'] },
    { key: 'printing', label: 'Printing / Office Equipment', patterns: ['printing', 'desktop', 'printer', 'laptop'] },
    { key: 'feed_processing', label: 'Feed Processing Equipment', patterns: ['feed mixer', 'feed making', 'feed processor'] },
    { key: 'food_processor', label: 'Food Processor', patterns: ['food processor'] },
    { key: 'motor_generator', label: 'Motor / Generator', patterns: ['motor', 'alternator', 'biogas'] }
  ];

  function inferMachineType(techRaw) {
    var tech = (techRaw || '').toLowerCase();
    for (var i = 0; i < MACHINE_KEYWORDS.length; i++) {
      var m = MACHINE_KEYWORDS[i];
      for (var j = 0; j < m.patterns.length; j++) {
        if (tech.indexOf(m.patterns[j]) !== -1) return m.label;
      }
    }
    return 'Other Equipment';
  }

  // --------------------------------------------------------------------
  // The dataset records an *appliance power rating* (estimated_load_kw),
  // not a metered daily energy reading. We approximate daily energy as
  // load_kw x an assumed average daily run-time. ASSUMED_DAILY_RUN_HOURS
  // is a placeholder until real consumption/meter data is available.
  // --------------------------------------------------------------------
  var ASSUMED_DAILY_RUN_HOURS = 2.5;

  // --------------------------------------------------------------------
  // MAIN BUILD
  // --------------------------------------------------------------------
  function build(raw) {
    var clusters = [];
    var sites = [];
    var customers = [];
    var machines = [];
    var provinceSet = {};

    var siteSeq = 0, custSeq = 0, machSeq = 0;

    raw.forEach(function (entry) {
      var c = entry.cluster;
      var clusterLat = c.center[0], clusterLon = c.center[1];
      var province = inferProvince(clusterLat, clusterLon);
      provinceSet[province] = true;

      var clusterId = c.id;
      var siteIdsForCluster = [];

      (entry.villages || []).forEach(function (village) {
        var siteId = 'site-' + (village.id || ('auto-' + (siteSeq++)));
        var vLat = village.location[0], vLon = village.location[1];

        var existingCustomers = [];
        var potentialCustomers = [];

        (village.pues || []).forEach(function (p) {
          existingCustomers.push(buildCustomer(p, siteId, clusterId, 'existing'));
        });
        (village.leads || []).forEach(function (l) {
          potentialCustomers.push(buildCustomer(l, siteId, clusterId, 'potential'));
        });

        var allSiteCustomers = existingCustomers.concat(potentialCustomers);
        allSiteCustomers.forEach(function (cust) {
          customers.push(cust);
          var mach = buildMachine(cust);
          machines.push(mach);
          cust.machineId = mach.id;
        });

        var existingCount = existingCustomers.length;
        var potentialCount = potentialCustomers.length;
        var totalLoadKw = allSiteCustomers.reduce(function (s, x) { return s + x.estimatedLoadKw; }, 0);

        var machinesForSite = machines.filter(function (m) { return m.siteId === siteId; });

        var score = computeOpportunityScore({
          existingCount: existingCount,
          potentialCount: potentialCount,
          totalLoadKw: totalLoadKw
        });

        // "Cooperative Day" pins are leads gathered at a central event, not
        // a distinct village the roadshow visited — every other roadshow
        // entry maps to a real village stop.
        var isVillage = entry.roadshow !== 'Cooperative Day';

        var site = {
          id: siteId,
          name: village.name,
          code: village.id,
          clusterId: clusterId,
          clusterName: c.name,
          roadshowName: entry.roadshow,
          province: province,
          latitude: vLat,
          longitude: vLon,
          minigridCapacity: null, // not present in source data
          roadshowCluster: clusterId,
          isVillage: isVillage,
          opportunityScore: score.total,
          opportunityBand: score.band,
          opportunityBreakdown: score.breakdown,
          existingCustomerCount: existingCount,
          potentialCustomerCount: potentialCount,
          totalCustomerCount: existingCount + potentialCount,
          totalEstimatedLoadKw: Math.round(totalLoadKw * 100) / 100,
          machineCount: machinesForSite.length,
          dominantCategory: c.summary ? c.summary.dominant_category : null
        };

        sites.push(site);
        siteIdsForCluster.push(siteId);
      });

      clusters.push({
        id: clusterId,
        name: c.name,
        roadshowName: entry.roadshow,
        province: province,
        center: [clusterLat, clusterLon],
        boundary: c.boundary || [],
        summary: c.summary || {},
        siteIds: siteIdsForCluster
      });
    });

    var provinces = Object.keys(provinceSet).sort();

    return {
      clusters: clusters,
      sites: sites,
      customers: customers,
      machines: machines,
      provinces: provinces,
      methodology: {
        province: 'Province is inferred by nearest geographic centroid (approximate — no verified administrative boundaries were available in the source dataset).',
        opportunityScore: 'PUE Opportunity Score is an illustrative 0-100 planning heuristic combining customer potential, load potential and existing traction. It is NOT a scientifically validated model.',
        isVillage: 'Every roadshow location is treated as a distinct village stop except "Cooperative Day" pins, which are leads gathered at a single central event rather than a village the roadshow actually visited.',
        minigridCapacity: 'Minigrid nameplate capacity was not present in the source dataset and is not currently displayed as a number.'
      }
    };

    // ---- helpers that close over siteSeq/custSeq/machSeq ----
    function buildCustomer(rec, siteId, clusterId, status) {
      var loadKw = typeof rec.estimated_load_kw === 'number' ? rec.estimated_load_kw : 0;
      var dailyKwh = Math.round(loadKw * ASSUMED_DAILY_RUN_HOURS * 100) / 100;
      var monthlyKwh = Math.round(dailyKwh * 30 * 100) / 100;
      return {
        id: 'cust-' + (rec.id || ('auto-' + (custSeq++))),
        siteId: siteId,
        clusterId: clusterId,
        name: rec.name || 'Unnamed',
        meterNumber: null, // not present in source data
        sector: rec.category || null, // raw business sector, e.g. 'agriculture', 'food_processing'
        status: status, // 'existing' | 'potential'
        technology: rec.technology || '',
        estimatedLoadKw: loadKw,
        dailyConsumption: dailyKwh,
        monthlyConsumption: monthlyKwh,
        contactNumber: rec.contact_number || null,
        latitude: rec.location ? rec.location[0] : null,
        longitude: rec.location ? rec.location[1] : null
      };
    }

    function buildMachine(cust) {
      var type = inferMachineType(cust.technology);
      var id = 'mach-' + cust.id;
      return {
        id: id,
        siteId: cust.siteId,
        customerId: cust.id,
        type: type,
        technology: cust.technology,
        capacityKw: cust.estimatedLoadKw,
        consumption: cust.monthlyConsumption
      };
    }
  }

  // --------------------------------------------------------------------
  // OPPORTUNITY SCORE (0-100) — see spec section 22.
  // Components (documented, not scientifically validated):
  //   customerPotential    up to 40 pts — scaled potential-customer count
  //   consumptionPotential up to 25 pts — scaled total estimated load (kW)
  //   existingTraction     up to 15 pts — proof-of-concept existing PUE base
  //   accessibility        flat 20 pts — placeholder (no road/travel-time data)
  // --------------------------------------------------------------------
  function computeOpportunityScore(input) {
    var customerPotential = Math.min(40, input.potentialCount * 3);
    var consumptionPotential = Math.min(25, input.totalLoadKw * 0.8);
    var existingTraction = Math.min(15, input.existingCount * 5);
    var accessibility = 20; // placeholder — no accessibility data source yet

    var total = Math.round(customerPotential + consumptionPotential + existingTraction + accessibility);
    total = Math.max(0, Math.min(100, total));

    var band;
    if (total >= 75) band = 'high';
    else if (total >= 50) band = 'medium';
    else band = 'low';

    return {
      total: total,
      band: band,
      breakdown: {
        customerPotential: Math.round(customerPotential),
        consumptionPotential: Math.round(consumptionPotential),
        existingTraction: Math.round(existingTraction),
        accessibility: accessibility
      }
    };
  }

  // --------------------------------------------------------------------
  // Boot: run once window.PUE_DATA is available.
  // --------------------------------------------------------------------
  function init() {
    if (!window.PUE_DATA || !Array.isArray(window.PUE_DATA)) {
      console.error('[normalize.js] window.PUE_DATA not found — cannot build PUE_ATLAS_DATA.');
      window.PUE_ATLAS_DATA = { clusters: [], sites: [], customers: [], machines: [], provinces: [], methodology: {} };
      return;
    }
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    window.PUE_ATLAS_DATA = build(window.PUE_DATA);
    var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
    console.log('[normalize.js] Built PUE_ATLAS_DATA in', Math.round(t1 - t0), 'ms —',
      window.PUE_ATLAS_DATA.sites.length, 'sites,',
      window.PUE_ATLAS_DATA.customers.length, 'customers,',
      window.PUE_ATLAS_DATA.machines.length, 'machines,',
      window.PUE_ATLAS_DATA.clusters.length, 'clusters,',
      window.PUE_ATLAS_DATA.provinces.length, 'provinces.');
  }

  init();
})();