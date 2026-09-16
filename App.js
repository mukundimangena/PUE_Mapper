/* ==========================================================================
   PUE ROADSHOW ATLAS — Application Logic
   Reads window.PUE_ATLAS_DATA (built by normalize.js) and drives:
   FilterEngine -> Map, KPI strip, Data table, Charts, Site panel
   ========================================================================== */

(function () {
  'use strict';

  /* ========================================================================
     CONFIG
     ==================================================================== */

  var CONFIG = {
    zambiaCenter: [-13.5, 27.9],
    zambiaZoom: 6,
    siteZoom: 13,
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',

    color: {
      existing: '#53A41C',
      potential: '#FF8900',
      village: '#0059A2',
      muted: '#7B8794'
    },

    bandColor: { high: '#53A41C', medium: '#FFBF2B', low: '#7B8794' },

    sectorMeta: {
      agriculture: { label: 'Agriculture', color: '#7CB342' },
      food_processing: { label: 'Food / Agri-Processing', color: '#53A41C' },
      manufacturing: { label: 'Manufacturing', color: '#0059A2' },
      micro_enterprise: { label: 'Micro-Enterprise', color: '#FF8900' },
      refrigeration: { label: 'Refrigeration', color: '#00B8D9' },
      services: { label: 'Services', color: '#9A35A5' },
      community: { label: 'Community', color: '#7B8794' },
      transport: { label: 'Transport', color: '#FFBF2B' }
    },
    sectorFallbackColor: '#FF8900',

    machineTypeOptions: [
      'Hammer Mill', 'Oil Expeller', 'Dehuller', 'Irrigation Pump', 'Welding Machine',
      'Grinder', 'Refrigeration Unit', 'Sewing Machine', 'Carpentry Tools', 'Popcorn Machine',
      'Peanut Butter / Oil Maker', 'Compressor', 'Barbing / Salon Equipment', 'Egg Incubator',
      'E-Bike / E-Mobility', 'Cook Stove', 'Solar Home System', 'Sheller', 'Printing / Office Equipment',
      'Pressure Cooker', 'Feed Processing Equipment', 'Food Processor', 'Motor / Generator', 'Other Equipment'
    ]
  };

  /* ========================================================================
     UTILS
     ==================================================================== */

  var Utils = (function () {
    function debounce(fn, ms) {
      var t;
      return function () {
        var args = arguments, ctx = this;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(ctx, args); }, ms);
      };
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
      var R = 6371;
      var dLat = (lat2 - lat1) * Math.PI / 180;
      var dLon = (lon2 - lon1) * Math.PI / 180;
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function el(tag, cls, html) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html !== undefined) e.innerHTML = html;
      return e;
    }

    function fmt(n) {
      if (n === null || n === undefined || isNaN(n)) return '—';
      return Math.round(n).toLocaleString();
    }

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function download(filename, content, mime) {
      var blob = new Blob([content], { type: mime || 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    return { debounce: debounce, haversineKm: haversineKm, el: el, fmt: fmt, esc: esc, download: download };
  })();

  /* ========================================================================
     DATA INDEX — cross-reference lookups built once from PUE_ATLAS_DATA
     ==================================================================== */

  var DataIndex = (function () {
    var data = null, siteById = {}, clusterById = {}, machineByCustomerId = {}, customersBySite = {};

    function init(atlasData) {
      data = atlasData;
      siteById = {}; clusterById = {}; machineByCustomerId = {}; customersBySite = {};
      data.sites.forEach(function (s) { siteById[s.id] = s; customersBySite[s.id] = []; });
      data.clusters.forEach(function (c) { clusterById[c.id] = c; });
      data.machines.forEach(function (m) { machineByCustomerId[m.customerId] = m; });
      data.customers.forEach(function (c) {
        c.site = siteById[c.siteId];
        c.machine = machineByCustomerId[c.id];
        if (customersBySite[c.siteId]) customersBySite[c.siteId].push(c);
      });
    }

    return {
      init: init,
      get data() { return data; },
      site: function (id) { return siteById[id]; },
      cluster: function (id) { return clusterById[id]; },
      customersOf: function (siteId) { return customersBySite[siteId] || []; }
    };
  })();

  /* ========================================================================
     FILTER STATE + ENGINE
     ==================================================================== */

  var FilterState = {
    province: [], cluster: [], site: [],
    machineType: [],
    search: ''
  };

  function filterIsEmpty() {
    var f = FilterState;
    return !f.province.length && !f.cluster.length && !f.site.length &&
      !f.machineType.length &&
      !f.search;
  }

  var FilterEngine = (function () {
    function inArr(arr, v) { return !arr.length || arr.indexOf(v) !== -1; }

    function compute() {
      var f = FilterState;
      var searchTerm = (f.search || '').trim().toLowerCase();

      var customers = DataIndex.data.customers.filter(function (c) {
        var site = c.site;
        if (!site) return false;
        if (!inArr(f.province, site.province)) return false;
        if (!inArr(f.cluster, site.clusterId)) return false;
        if (!inArr(f.site, site.id)) return false;
        if (c.machine) {
          if (!inArr(f.machineType, c.machine.type)) return false;
        } else if (f.machineType.length) {
          return false;
        }
        if (searchTerm) {
          var hay = (c.name + ' ' + site.name + ' ' + site.clusterName + ' ' + site.roadshowName + ' ' +
            (c.machine ? c.machine.type : '') + ' ' + c.technology + ' ' + site.province).toLowerCase();
          if (hay.indexOf(searchTerm) === -1) return false;
        }
        return true;
      });

      var siteIdSet = {};
      customers.forEach(function (c) { siteIdSet[c.siteId] = true; });
      var sites = DataIndex.data.sites.filter(function (s) { return siteIdSet[s.id]; });

      var custIdSet = {};
      customers.forEach(function (c) { custIdSet[c.id] = true; });
      var machines = DataIndex.data.machines.filter(function (m) { return custIdSet[m.customerId]; });

      var clusterIdSet = {};
      sites.forEach(function (s) { clusterIdSet[s.clusterId] = true; });
      var clusters = DataIndex.data.clusters.filter(function (c) { return clusterIdSet[c.id]; });

      return { customers: customers, sites: sites, machines: machines, clusters: clusters };
    }

    return { compute: compute };
  })();

  /* ========================================================================
     GLOBAL APP STATE
     ==================================================================== */

  var State = {
    filtered: { customers: [], sites: [], machines: [], clusters: [] },
    selectedClusterId: null,
    selectedSiteId: null,
    selectedRow: null,
    dataTableOpen: false,
    layers: {
      village: true, existing: true, potential: true, leads: false,
      roadshowSites: true, districtBoundaries: false
    }
  };

  /* ========================================================================
     MAP ENGINE
     ==================================================================== */

  var MapEngine = (function () {
    var map, roadshowGroup, clusterGroup, villageGroup, leadGroup, boundaryGroup;
    var markerBySite = {};

    function init() {
      map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 5, maxZoom: 17 })
        .setView(CONFIG.zambiaCenter, CONFIG.zambiaZoom);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.tileLayer(CONFIG.tileUrl, { attribution: CONFIG.tileAttribution, crossOrigin: true, maxZoom: 19 }).addTo(map);

      roadshowGroup = L.layerGroup();
      villageGroup = L.layerGroup();
      leadGroup = L.markerClusterGroup({ maxClusterRadius: 40, showCoverageOnHover: false, iconCreateFunction: makeLeadClusterIcon });
      clusterGroup = L.markerClusterGroup({
        maxClusterRadius: 46,
        iconCreateFunction: makeClusterClusterIcon,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false
      });
      boundaryGroup = L.layerGroup();

      // Add order (and per-marker zIndexOffset below) keeps sites visually
      // dominant over leads, which sit above the background village dots.
      map.addLayer(boundaryGroup);
      map.addLayer(villageGroup);
      map.addLayer(leadGroup);
      map.addLayer(clusterGroup);
      map.addLayer(roadshowGroup);

      return map;
    }

    function roadshowIcon(sites) {
      var existing = sites.reduce(function (n, s) { return n + s.existingCustomerCount; }, 0);
      var leads = sites.reduce(function (n, s) { return n + s.potentialCustomerCount; }, 0);
      var color = existing > 0 ? CONFIG.color.existing : CONFIG.color.potential;
      var size = sizeFor(leads, 36);
      return L.divIcon({
        html: '<div class="cluster-marker" style="width:' + size + 'px;height:' + size + 'px;background:' + color + '"><span class="n">' + leads + '</span><span class="lbl">leads</span></div>',
        className: '', iconSize: [size, size]
      });
    }

    function roadshowTooltipHtml(cluster, sites) {
      var leads = sites.reduce(function (n, s) { return n + s.potentialCustomerCount; }, 0);
      var existing = sites.reduce(function (n, s) { return n + s.existingCustomerCount; }, 0);
      return '<div><div class="tt-title">' + Utils.esc(cluster.roadshowName) + '</div>' +
        '<div class="tt-row">' + cluster.province + '</div>' +
        '<div class="tt-row">' + sites.length + ' villages &middot; ' + existing + ' existing &middot; ' + leads + ' leads</div>' +
        '<div class="tt-row text-muted">Click to view villages</div></div>';
    }

    function makeClusterClusterIcon(cluster) {
      var markers = cluster.getAllChildMarkers();
      var high = 0;
      markers.forEach(function (m) { if (m.options.opportunityBand === 'high') high++; });
      var color = high > markers.length / 3 ? CONFIG.color.existing : CONFIG.color.potential;
      var n = cluster.getChildCount();
      return L.divIcon({
        html: '<div class="cluster-marker" style="width:' + sizeFor(n) + 'px;height:' + sizeFor(n) + 'px;background:' + color + '"><span class="n">' + n + '</span><span class="lbl">villages</span></div>',
        className: '', iconSize: [sizeFor(n), sizeFor(n)]
      });
    }

    function makeLeadClusterIcon(cluster) {
      var n = cluster.getChildCount();
      var size = sizeFor(n, 26);
      return L.divIcon({
        html: '<div class="cluster-marker lead-cluster" style="width:' + size + 'px;height:' + size + 'px;background:' + CONFIG.color.potential + '"><span class="n">' + n + '</span><span class="lbl">leads</span></div>',
        className: '', iconSize: [size, size]
      });
    }

    function sizeFor(n, base) {
      base = base || 34;
      return Math.min(base + Math.round(Math.sqrt(n) * 4), base + 30);
    }

    function siteMarkerIcon(site) {
      var color = site.existingCustomerCount > 0 ? CONFIG.color.existing : CONFIG.color.potential;
      var size = 14 + Math.min(10, Math.round(site.totalCustomerCount / 4));
      var ring = site.opportunityBand === 'high' ? '<div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid ' + color + ';opacity:0.5;"></div>' : '';
      var html = '<div style="position:relative;width:' + size + 'px;height:' + size + 'px;">' + ring +
        '<div class="pue-marker" style="width:100%;height:100%;background:' + color + ';"></div></div>';
      return L.divIcon({ html: html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    }

    function villageIcon() {
      return L.divIcon({
        html: '<div class="pue-marker diamond" style="width:12px;height:12px;background:' + CONFIG.color.village + ';"></div>',
        className: '', iconSize: [12, 12], iconAnchor: [6, 6]
      });
    }

    function leadSize(c) {
      var kw = c.estimatedLoadKw || 0;
      return Math.max(12, Math.min(30, Math.round(12 + Math.sqrt(kw) * 4.5)));
    }

    function leadColor(c) {
      var meta = c.sector && CONFIG.sectorMeta[c.sector];
      return meta ? meta.color : CONFIG.sectorFallbackColor;
    }

    function leadIcon(c) {
      var size = leadSize(c);
      var color = leadColor(c);
      return L.divIcon({
        html: '<div class="pue-marker" style="width:' + size + 'px;height:' + size + 'px;background:' + color + ';opacity:0.88;"></div>',
        className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2]
      });
    }

    function leadTooltipHtml(c) {
      var sectorMeta = c.sector && CONFIG.sectorMeta[c.sector];
      var sectorLabel = sectorMeta ? sectorMeta.label : (c.sector || 'Unclassified');
      return '<div><div class="tt-title">' + Utils.esc(c.name) + '</div>' +
        '<div class="tt-row">' + Utils.esc(sectorLabel) + (c.machine ? ' &middot; ' + Utils.esc(c.machine.type) : '') + '</div>' +
        '<div class="tt-row">' + c.estimatedLoadKw + ' kW estimated load &middot; ' + Utils.fmt(c.monthlyConsumption) + ' kWh/mo</div>' +
        (c.contactNumber ? '<div class="tt-row">' + Utils.esc(c.contactNumber) + '</div>' : '') +
        '</div>';
    }

    function render(filtered) {
      roadshowGroup.clearLayers();
      clusterGroup.clearLayers();
      villageGroup.clearLayers();
      leadGroup.clearLayers();
      markerBySite = {};

      if (!State.selectedClusterId) {
        // Top level: one marker per roadshow, never merged by proximity —
        // drilling into a roadshow is what reveals its individual sites.
        filtered.clusters.forEach(function (c) {
          var sites = filtered.sites.filter(function (s) { return s.clusterId === c.id; });
          if (!sites.length) return;
          var marker = L.marker(c.center, { icon: roadshowIcon(sites), zIndexOffset: 100 });
          marker.bindTooltip(roadshowTooltipHtml(c, sites), { direction: 'top', offset: [0, -10], className: 'map-tooltip', sticky: false });
          marker.on('click', function () { App.selectCluster(c.id); });
          roadshowGroup.addLayer(marker);
        });
      } else {
        var clusterSites = filtered.sites.filter(function (s) { return s.clusterId === State.selectedClusterId; });

        if (State.layers.roadshowSites) {
          clusterSites.forEach(function (site) {
            var marker = L.marker([site.latitude, site.longitude], {
              icon: siteMarkerIcon(site), opportunityBand: site.opportunityBand, zIndexOffset: 100
            });
            marker.bindTooltip(tooltipHtml(site), { direction: 'top', offset: [0, -10], className: 'map-tooltip', sticky: false });
            marker.on('click', function () { App.selectSite(site.id, true); });
            clusterGroup.addLayer(marker);
            markerBySite[site.id] = marker;
          });
        }

        if (State.layers.village) {
          clusterSites.forEach(function (site) {
            if (!site.isVillage) return;
            var m = L.marker([site.latitude, site.longitude], { icon: villageIcon(), interactive: false, zIndexOffset: -100 });
            villageGroup.addLayer(m);
          });
        }
      }

      // Leads only clutter the initial view — show all of them if the layer
      // toggle is on, otherwise reveal just the leads for the selected site
      // (i.e. clicking into a roadshow site is what surfaces its leads).
      if (State.layers.leads || State.selectedSiteId) {
        filtered.customers.forEach(function (c) {
          if (c.status !== 'potential') return;
          if (!State.layers.leads && c.siteId !== State.selectedSiteId) return;
          var lat = c.latitude != null ? c.latitude : (c.site ? c.site.latitude : null);
          var lon = c.longitude != null ? c.longitude : (c.site ? c.site.longitude : null);
          if (lat == null) return;
          var mk = L.marker([lat, lon], { icon: leadIcon(c), zIndexOffset: -50 });
          mk.bindTooltip(leadTooltipHtml(c), { direction: 'top', offset: [0, -6], className: 'map-tooltip', sticky: false });
          mk.on('click', function () { App.selectSite(c.siteId, true); });
          leadGroup.addLayer(mk);
        });
      }

      renderBoundaries(filtered);
    }

    function renderBoundaries(filtered) {
      boundaryGroup.clearLayers();
      if (State.layers.districtBoundaries) {
        filtered.clusters.forEach(function (c) {
          if (!c.boundary || c.boundary.length < 3) return;
          L.polygon(c.boundary, { color: '#0059A2', weight: 1.4, fillOpacity: 0.03, dashArray: '4,4' }).addTo(boundaryGroup);
        });
      }
    }

    function tooltipHtml(site) {
      return '<div><div class="tt-title">' + Utils.esc(site.name) + '</div>' +
        '<div class="tt-row">' + site.province + ' &middot; ' + site.clusterName + '</div>' +
        '<div class="tt-row">' + site.existingCustomerCount + ' existing &middot; ' + site.potentialCustomerCount + ' potential</div>' +
        '<div class="tt-row">' + site.machineCount + ' machines</div>' +
        '<div class="tt-opp" style="color:' + CONFIG.bandColor[site.opportunityBand] + '">Opportunity: ' + site.opportunityBand.toUpperCase() + '</div></div>';
    }

    function flyToSite(site) { map.flyTo([site.latitude, site.longitude], Math.max(map.getZoom(), CONFIG.siteZoom), { duration: 0.6 }); }
    function flyToBounds(latlngs) { if (latlngs.length) map.flyToBounds(L.latLngBounds(latlngs), { padding: [60, 60], duration: 0.6 }); }
    function resetView() { map.flyTo(CONFIG.zambiaCenter, CONFIG.zambiaZoom, { duration: 0.6 }); }

    function pulseSite(siteId) {
      var m = markerBySite[siteId];
      if (!m) return;
      var icon = m.getElement();
      if (icon) { icon.style.transform += ' scale(1.35)'; setTimeout(function () { if (icon) icon.style.transform = icon.style.transform.replace(' scale(1.35)', ''); }, 500); }
    }

    return {
      init: init, render: render, flyToSite: flyToSite, flyToBounds: flyToBounds,
      resetView: resetView, pulseSite: pulseSite,
      get instance() { return map; }
    };
  })();

  /* ========================================================================
     KPI STRIP
     ==================================================================== */

  var KPI = (function () {
    var els = {};
    function init() {
      ['sites', 'customers', 'active', 'machines', 'leads', 'high'].forEach(function (k) {
        els[k] = document.getElementById('kpi-' + k);
      });
    }
    function update(filtered) {
      var vals = {
        sites: filtered.sites.filter(function (s) { return s.isVillage; }).length,
        customers: filtered.customers.length,
        active: filtered.customers.filter(function (c) { return c.status === 'existing'; }).length,
        machines: filtered.machines.length,
        leads: filtered.customers.filter(function (c) { return c.status === 'potential'; }).length,
        high: filtered.sites.filter(function (s) { return s.opportunityBand === 'high'; }).length
      };
      Object.keys(vals).forEach(function (k) {
        if (!els[k]) return;
        els[k].textContent = Utils.fmt(vals[k]);
        els[k].classList.add('updating');
        setTimeout(function () { els[k] && els[k].classList.remove('updating'); }, 250);
      });
    }
    return { init: init, update: update };
  })();

  /* ========================================================================
     FILTER PANEL UI
     ==================================================================== */

  var FilterPanel = (function () {
    function optionCounts(list, keyFn) {
      var counts = {};
      list.forEach(function (item) { var k = keyFn(item); counts[k] = (counts[k] || 0) + 1; });
      return counts;
    }

    function toggleValue(arrName, value, checked) {
      var arr = FilterState[arrName];
      var idx = arr.indexOf(value);
      if (checked && idx === -1) arr.push(value);
      if (!checked && idx !== -1) arr.splice(idx, 1);
      App.recompute();
    }

    function renderCheckList(containerId, options, arrName, swatchFn) {
      var el = document.getElementById(containerId);
      if (!el) return;
      el.innerHTML = '';
      options.forEach(function (opt) {
        var row = Utils.el('label', 'filter-checkbox');
        var checked = FilterState[arrName].indexOf(opt.value) !== -1;
        row.innerHTML = (swatchFn ? swatchFn(opt.value) : '') +
          '<span>' + Utils.esc(opt.label) + '</span><span class="count">' + (opt.count != null ? opt.count : '') + '</span>';
        var input = document.createElement('input');
        input.type = 'checkbox'; input.checked = checked;
        input.addEventListener('change', function () { toggleValue(arrName, opt.value, input.checked); });
        row.insertBefore(input, row.firstChild);
        el.appendChild(row);
      });
    }

    function refreshOptionLists() {
      var data = DataIndex.data;

      var provCounts = optionCounts(data.sites, function (s) { return s.province; });
      renderCheckList('opt-province', data.provinces.map(function (p) { return { value: p, label: p, count: provCounts[p] || 0 }; }), 'province');

      var clusterCounts = optionCounts(data.sites, function (s) { return s.clusterId; });
      renderCheckList('opt-cluster', data.clusters.map(function (c) { return { value: c.id, label: c.roadshowName, count: clusterCounts[c.id] || 0 }; }), 'cluster');

      var machCounts = optionCounts(data.machines, function (m) { return m.type; });
      var typesPresent = CONFIG.machineTypeOptions.filter(function (t) { return machCounts[t]; });
      renderCheckList('opt-machinetype', typesPresent.map(function (t) { return { value: t, label: t, count: machCounts[t] }; }), 'machineType');
    }

    function clearAll() {
      FilterState.province = []; FilterState.cluster = []; FilterState.site = [];
      FilterState.machineType = [];
      FilterState.search = '';
      var input = document.getElementById('topsearch-input');
      if (input) input.value = '';
      App.recompute();
      refreshOptionLists();
    }

    function init() {
      refreshOptionLists();
      var clearBtn = document.getElementById('filter-clear-all');
      if (clearBtn) clearBtn.addEventListener('click', clearAll);
    }

    return { init: init, refreshOptionLists: refreshOptionLists, clearAll: clearAll };
  })();

  /* ========================================================================
     FILTER CHIPS
     ==================================================================== */

  var Chips = (function () {
    var labelMaps = null;

    function build() {
      var chips = [];
      var f = FilterState;
      f.province.forEach(function (v) { chips.push({ group: 'province', value: v, label: v }); });
      f.cluster.forEach(function (v) { var c = DataIndex.cluster(v); chips.push({ group: 'cluster', value: v, label: c ? c.roadshowName : v }); });
      f.site.forEach(function (v) { var s = DataIndex.site(v); chips.push({ group: 'site', value: v, label: s ? s.name : v }); });
      f.machineType.forEach(function (v) { chips.push({ group: 'machineType', value: v, label: v }); });
      if (f.search) chips.push({ group: 'search', value: f.search, label: 'Search: "' + f.search + '"' });
      return chips;
    }

    function render() {
      var container = document.getElementById('filter-chips');
      var chips = build();
      container.innerHTML = '';

      var breadcrumb = null;
      if (State.selectedClusterId) {
        var c = DataIndex.cluster(State.selectedClusterId);
        breadcrumb = { label: 'Roadshow: ' + (c ? c.roadshowName : State.selectedClusterId) };
      }

      if (!chips.length && !breadcrumb) { container.classList.add('empty'); return; }
      container.classList.remove('empty');

      if (breadcrumb) {
        var bc = Utils.el('div', 'chip chip-breadcrumb');
        bc.innerHTML = '<span>&#8592; ' + Utils.esc(breadcrumb.label) + '</span><span class="x">&times;</span>';
        bc.querySelector('.x').addEventListener('click', function () { App.backToRoadshows(); });
        container.appendChild(bc);
      }

      chips.forEach(function (chip) {
        var el = Utils.el('div', 'chip');
        el.innerHTML = '<span>' + Utils.esc(chip.label) + '</span><span class="x">&times;</span>';
        el.querySelector('.x').addEventListener('click', function () {
          if (chip.group === 'search') { FilterState.search = ''; var inp = document.getElementById('topsearch-input'); if (inp) inp.value = ''; }
          else {
            var arr = FilterState[chip.group];
            var idx = arr.indexOf(chip.value);
            if (idx !== -1) arr.splice(idx, 1);
          }
          App.recompute();
          FilterPanel.refreshOptionLists();
        });
        container.appendChild(el);
      });
      var clearAll = Utils.el('button', 'chip-clear-all', 'Clear all');
      clearAll.addEventListener('click', function () { FilterPanel.clearAll(); App.backToRoadshows(); });
      container.appendChild(clearAll);
    }

    return { render: render };
  })();

  /* ========================================================================
     DATA TABLE
     ==================================================================== */

  var DataTable = (function () {
    var sortKey = 'opportunityScore', sortDir = -1;

    function rows(filtered) {
      return filtered.customers.map(function (c) {
        var s = c.site, m = c.machine;
        return {
          site: s.name, province: s.province, roadshow: s.roadshowName, customer: c.name,
          meter: c.meterNumber || '—', consumption: c.monthlyConsumption,
          machine: m ? m.type : '—', status: c.status,
          opportunityScore: s.opportunityBand === undefined ? 0 : s.opportunityScore,
          siteId: s.id, customerId: c.id
        };
      });
    }

    function render(filtered) {
      var body = document.getElementById('data-table-body');
      var count = document.getElementById('data-panel-count');
      var data = rows(filtered);
      data.sort(function (a, b) {
        var av = a[sortKey], bv = b[sortKey];
        if (typeof av === 'string') return av.localeCompare(bv) * sortDir;
        return ((av || 0) - (bv || 0)) * sortDir;
      });
      count.textContent = data.length + ' records';
      body.innerHTML = '';
      var frag = document.createDocumentFragment();
      data.slice(0, 500).forEach(function (r) {
        var tr = document.createElement('tr');
        if (r.siteId === State.selectedSiteId) tr.classList.add('row-selected');
        var statusColor = r.status === 'existing' ? CONFIG.color.existing : CONFIG.color.potential;
        var statusLabel = r.status === 'existing' ? 'Existing' : 'Lead';
        tr.innerHTML =
          '<td>' + Utils.esc(r.site) + '</td>' +
          '<td>' + Utils.esc(r.province) + '</td>' +
          '<td>' + Utils.esc(r.roadshow) + '</td>' +
          '<td>' + Utils.esc(r.customer) + '</td>' +
          '<td>' + Utils.esc(r.meter) + '</td>' +
          '<td>' + Utils.fmt(r.consumption) + ' kWh/mo</td>' +
          '<td>' + Utils.esc(r.machine) + '</td>' +
          '<td><span class="table-tag" style="background:' + statusColor + '22;color:' + statusColor + '">' + statusLabel + '</span></td>' +
          '<td>' + r.opportunityScore + '</td>';
        tr.addEventListener('click', function () { App.selectSite(r.siteId, true); });
        frag.appendChild(tr);
      });
      body.appendChild(frag);
    }

    function init() {
      document.querySelectorAll('#data-table thead th[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () {
          var key = th.getAttribute('data-sort');
          if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = -1; }
          DataTable.render(State.filtered);
        });
      });
    }

    return { init: init, render: render };
  })();

  /* ========================================================================
     CHARTS (contextual — reflect current filtered dataset)
     ==================================================================== */

  var Charts = (function () {
    function bar(container, rows, colorFn) {
      container.innerHTML = '';
      var max = Math.max.apply(null, rows.map(function (r) { return r.n; }).concat([1]));
      rows.forEach(function (r) {
        var row = Utils.el('div', 'bar-row');
        var pct = Math.round((r.n / max) * 100);
        row.innerHTML = '<div class="bl">' + Utils.esc(r.label) + '</div><div class="bt"><div class="fill" style="width:' + pct + '%;background:' + colorFn(r.key) + '"></div></div><div class="bn">' + r.n + '</div>';
        container.appendChild(row);
      });
    }

    function render(filtered) {
      var oppRows = ['high', 'medium', 'low'].map(function (k) {
        return { key: k, label: k.toUpperCase(), n: filtered.sites.filter(function (s) { return s.opportunityBand === k; }).length };
      });
      bar(document.getElementById('chart-opportunity'), oppRows, function (k) { return CONFIG.bandColor[k]; });
    }

    return { render: render };
  })();

  /* ========================================================================
     SITE PANEL (detail + profile)
     ==================================================================== */

  var SitePanel = (function () {
    var profileMode = false;

    function leadCardTitle(c) {
      return c.name + '\n' + (c.machine ? c.machine.type : c.technology) +
        '\n' + Utils.fmt(c.monthlyConsumption) + ' kWh/mo estimated' + (c.contactNumber ? '\n' + c.contactNumber : '');
    }

    function customerCardHtml(cust) {
      var m = cust.machine;
      var isLead = cust.status !== 'existing';
      var color = isLead ? CONFIG.color.potential : CONFIG.color.existing;
      var label = isLead ? 'Lead' : 'Existing';
      return '<div class="machine-card"' + (isLead ? ' title="' + Utils.esc(leadCardTitle(cust)) + '"' : '') + '>' +
        '<div class="machine-card-top"><span class="machine-card-title">' + Utils.esc(m ? m.type : cust.technology) + '</span><span class="machine-card-cap">' + (m ? m.capacityKw : cust.estimatedLoadKw) + ' kW</span></div>' +
        '<div class="status-tag" style="background:' + color + '22;color:' + color + '">' + label + '</div>' +
        '<div class="machine-card-meta"><span>' + Utils.esc(cust.name) + '</span><span>' + Utils.fmt(cust.monthlyConsumption) + ' kWh/mo</span></div>' +
        '</div>';
    }

    function render(site) {
      var panel = document.getElementById('site-panel');
      var customers = DataIndex.customersOf(site.id);
      var bandColor = CONFIG.bandColor[site.opportunityBand];
      var villageColor = site.isVillage ? CONFIG.color.village : CONFIG.color.muted;
      var villageLabel = site.isVillage ? 'Village' : 'Cooperative Day Lead (not a distinct village stop)';

      var basicsHtml =
        '<div class="panel-section">' +
        '<div class="stat-grid">' +
        '<div class="stat-card"><div class="v">' + site.existingCustomerCount + '</div><div class="l">PUE Customers</div></div>' +
        '<div class="stat-card"><div class="v">' + site.potentialCustomerCount + '</div><div class="l">Leads</div></div>' +
        '<div class="stat-card"><div class="v">' + site.machineCount + '</div><div class="l">Machines</div></div>' +
        '<div class="stat-card"><div class="v">' + (site.minigridCapacity || '—') + '</div><div class="l">Minigrid Capacity</div></div>' +
        '</div></div>' +
        '<div class="panel-section">' +
        '<div class="panel-section-label">PUE Opportunity Score</div>' +
        '<div class="opp-score-box">' +
        '<div class="opp-score-ring" style="background:' + bandColor + '">' + site.opportunityScore + '</div>' +
        '<div class="opp-score-meta"><div class="band" style="color:' + bandColor + '">' + site.opportunityBand.toUpperCase() + ' OPPORTUNITY</div>' +
        '<div class="info" title="Illustrative planning score (0-100): customer potential + load potential + existing traction + a flat accessibility placeholder. Not a scientifically validated model.">&#9432; How is this calculated?</div>' +
        '</div></div></div>' +
        '<div class="panel-actions">' +
        '<button class="btn primary" id="btn-view-site">' + (profileMode ? 'Hide Details' : 'View Village') + '</button>' +
        '</div>';

      var profileHtml = '';
      if (profileMode) {
        profileHtml =
          '<div class="panel-section"><div class="panel-section-label">Overview</div>' +
          '<div class="deploy-row"><span class="lbl">Village code</span><span class="n">' + Utils.esc(site.code) + '</span></div>' +
          '<div class="deploy-row"><span class="lbl">Coordinates</span><span class="n">' + site.latitude.toFixed(4) + ', ' + site.longitude.toFixed(4) + '</span></div>' +
          '<div class="deploy-row"><span class="lbl">Dominant category</span><span class="n">' + Utils.esc(site.dominantCategory || '—') + '</span></div>' +
          '</div>' +
          '<div class="panel-section"><div class="panel-section-label">PUE Customers &amp; Leads (' + customers.length + ')</div>' +
          customers.map(function (c) {
            var isLead = c.status !== 'existing';
            var color = isLead ? CONFIG.color.potential : CONFIG.color.existing;
            return '<div class="deploy-row"' + (isLead ? ' title="' + Utils.esc(leadCardTitle(c)) + '"' : '') + '>' +
              '<span class="lbl">' + Utils.esc(c.name) + '</span>' +
              '<span class="n" style="color:' + color + '">' + (isLead ? 'Lead' : 'Existing') + '</span></div>';
          }).join('') + '</div>' +
          '<div class="panel-section"><div class="panel-section-label">Machines</div>' +
          customers.map(customerCardHtml).join('') + '</div>' +
          '<div class="panel-section"><div class="panel-section-label">Roadshow</div>' +
          '<div class="deploy-row"><span class="lbl">Cluster</span><span class="n">' + Utils.esc(site.clusterName) + '</span></div>' +
          '<div class="deploy-row"><span class="lbl">Roadshow</span><span class="n">' + Utils.esc(site.roadshowName) + '</span></div>' +
          '</div>';
      }

      panel.innerHTML =
        '<button class="panel-close" id="btn-panel-close">&times;</button>' +
        '<div class="panel-header">' +
        '<div class="panel-title">' + Utils.esc(site.name) + '</div>' +
        '<div class="panel-subtitle">' + Utils.esc(site.province) + ' &middot; ' + Utils.esc(site.clusterName) + '</div>' +
        '<div class="panel-badge" style="background:' + villageColor + '22;color:' + villageColor + '">&#9679; ' + villageLabel + '</div>' +
        '</div>' +
        '<div class="panel-body">' + basicsHtml + profileHtml + '</div>';

      panel.classList.add('open');

      document.getElementById('btn-panel-close').addEventListener('click', close);
      document.getElementById('btn-view-site').addEventListener('click', function () { profileMode = !profileMode; render(site); });
    }

    function open(siteId) {
      var site = DataIndex.site(siteId);
      if (!site) return;
      profileMode = false;
      render(site);
    }

    function close() {
      document.getElementById('site-panel').classList.remove('open');
      State.selectedSiteId = null;
      MapEngine.render(State.filtered);
      DataTable.render(State.filtered);
    }

    return { open: open, close: close };
  })();

  /* ========================================================================
     SEARCH
     ==================================================================== */

  var Search = (function () {
    function query(term) {
      term = term.toLowerCase();
      var data = DataIndex.data;
      var sites = data.sites.filter(function (s) { return s.name.toLowerCase().indexOf(term) !== -1; }).slice(0, 6);
      var customers = data.customers.filter(function (c) { return c.name.toLowerCase().indexOf(term) !== -1; }).slice(0, 6);
      var machines = data.machines.filter(function (m) { return m.type.toLowerCase().indexOf(term) !== -1 || (m.technology || '').toLowerCase().indexOf(term) !== -1; }).slice(0, 6);
      var clusters = data.clusters.filter(function (c) { return c.roadshowName.toLowerCase().indexOf(term) !== -1; }).slice(0, 4);
      return { sites: sites, customers: customers, machines: machines, clusters: clusters };
    }

    function render(term) {
      var box = document.getElementById('search-results');
      if (!term) { box.classList.remove('open'); box.innerHTML = ''; return; }
      var r = query(term);
      var total = r.sites.length + r.customers.length + r.machines.length + r.clusters.length;
      box.innerHTML = '';
      if (!total) { box.innerHTML = '<div class="search-empty">No matches for "' + Utils.esc(term) + '"</div>'; box.classList.add('open'); return; }

      function group(label, items, onClick, metaFn, colorFn) {
        if (!items.length) return;
        box.appendChild(Utils.el('div', 'search-group-label', label));
        items.forEach(function (item) {
          var row = Utils.el('div', 'search-result-item');
          row.innerHTML = '<span class="swatch" style="background:' + colorFn(item) + '"></span><span>' + Utils.esc(item.name || item.type || item.roadshowName) + '</span><span class="meta">' + metaFn(item) + '</span>';
          row.addEventListener('click', function () { onClick(item); box.classList.remove('open'); document.getElementById('topsearch-input').blur(); });
          box.appendChild(row);
        });
      }

      group('Villages', r.sites, function (s) { App.selectSite(s.id, true); }, function (s) { return s.province; }, function () { return CONFIG.color.existing; });
      group('Customers', r.customers, function (c) { App.selectSite(c.siteId, true); }, function (c) { return c.status === 'existing' ? 'Existing' : 'Lead'; }, function (c) { return c.status === 'existing' ? CONFIG.color.existing : CONFIG.color.potential; });
      group('Machines', r.machines, function (m) { App.selectSite(m.siteId, true); }, function (m) { return m.capacityKw + ' kW'; }, function () { return CONFIG.color.muted; });
      group('Clusters', r.clusters, function (c) { App.selectCluster(c.id); }, function () { return 'roadshow'; }, function () { return CONFIG.color.village; });

      box.classList.add('open');
    }

    function init() {
      var input = document.getElementById('topsearch-input');
      input.addEventListener('input', Utils.debounce(function () {
        FilterState.search = input.value.trim();
        render(input.value.trim());
        App.recompute(true);
      }, 180));
      document.addEventListener('click', function (e) {
        if (!e.target.closest('.topnav-search')) document.getElementById('search-results').classList.remove('open');
      });
    }

    return { init: init };
  })();

  /* ========================================================================
     EXPORT
     ==================================================================== */

  var Export = (function () {
    function csv() {
      var rows = State.filtered.customers.map(function (c) {
        var s = c.site, m = c.machine;
        return [s.name, s.province, s.roadshowName, c.name, c.meterNumber || '', c.monthlyConsumption,
        m ? m.type : '', c.status === 'existing' ? 'Existing' : 'Lead', s.opportunityScore];
      });
      var header = ['Village', 'Province', 'Roadshow', 'Customer', 'Meter', 'Consumption (kWh/mo)', 'Machine', 'Status', 'Opportunity Score'];
      var lines = [header].concat(rows).map(function (r) {
        return r.map(function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',');
      });
      Utils.download('pue-roadshow-atlas-export.csv', lines.join('\n'), 'text/csv');
    }

    function mapPng() {
      if (typeof html2canvas === 'undefined') { alert('Map export library not available offline.'); return; }
      var mapEl = document.getElementById('map-area');
      html2canvas(mapEl, { useCORS: true, logging: false }).then(function (canvas) {
        canvas.toBlob(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a'); a.href = url; a.download = 'pue-roadshow-atlas-map.png';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        });
      }).catch(function () { alert('Map export failed — this can happen if map tiles blocked cross-origin capture.'); });
    }

    function init() {
      document.getElementById('btn-export-csv').addEventListener('click', function () { csv(); Menu.close(); });
      document.getElementById('btn-export-png').addEventListener('click', function () { mapPng(); Menu.close(); });
    }

    return { init: init, csv: csv, mapPng: mapPng };
  })();

  var Menu = (function () {
    function open() { document.getElementById('export-menu').classList.add('open'); }
    function close() { document.getElementById('export-menu').classList.remove('open'); }
    function toggle() { document.getElementById('export-menu').classList.toggle('open'); }
    function init() {
      document.getElementById('nav-export').addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
      document.addEventListener('click', function (e) { if (!e.target.closest('#export-menu') && !e.target.closest('#nav-export')) close(); });
    }
    return { open: open, close: close, toggle: toggle, init: init };
  })();

  /* ========================================================================
     LAYER CONTROL
     ==================================================================== */

  var LayerControl = (function () {
    function init() {
      Object.keys(State.layers).forEach(function (key) {
        var input = document.getElementById('layer-' + key);
        if (!input) return;
        input.checked = State.layers[key];
        input.addEventListener('change', function () {
          State.layers[key] = input.checked;
          MapEngine.render(State.filtered);
        });
      });
    }
    return { init: init };
  })();

  /* ========================================================================
     URL STATE
     ==================================================================== */

  var URLState = (function () {
    var keys = ['province', 'cluster', 'site', 'machineType'];
    function write() {
      var params = new URLSearchParams();
      keys.forEach(function (k) { if (FilterState[k].length) params.set(k, FilterState[k].join('|')); });
      if (FilterState.search) params.set('q', FilterState.search);
      var qs = params.toString();
      history.replaceState(null, '', qs ? ('?' + qs) : location.pathname);
    }
    function read() {
      var params = new URLSearchParams(location.search);
      keys.forEach(function (k) { var v = params.get(k); if (v) FilterState[k] = v.split('|'); });
      var q = params.get('q');
      if (q) { FilterState.search = q; document.getElementById('topsearch-input').value = q; }
    }
    return { write: Utils.debounce(write, 200), read: read };
  })();

  /* ========================================================================
     LOADING / EMPTY STATES
     ==================================================================== */

  var UIState = (function () {
    var loadingTimer;
    function flashLoading() {
      var el = document.getElementById('loading-indicator');
      el.classList.add('show');
      clearTimeout(loadingTimer);
      loadingTimer = setTimeout(function () { el.classList.remove('show'); }, 420);
    }
    function updateEmpty(filtered) {
      var el = document.getElementById('empty-state');
      el.classList.toggle('hidden', filtered.sites.length !== 0);
    }
    return { flashLoading: flashLoading, updateEmpty: updateEmpty };
  })();

  /* ========================================================================
     APP BOOTSTRAP
     ==================================================================== */

  var App = (function () {
    function recompute(skipUrl) {
      UIState.flashLoading();
      State.filtered = FilterEngine.compute();
      MapEngine.render(State.filtered);
      KPI.update(State.filtered);
      Chips.render();
      DataTable.render(State.filtered);
      Charts.render(State.filtered);
      UIState.updateEmpty(State.filtered);
      if (!skipUrl) URLState.write();
    }

    function selectSite(siteId, flyAndOpen) {
      var site = DataIndex.site(siteId);
      if (!site) return;
      State.selectedSiteId = siteId;
      State.selectedClusterId = site.clusterId; // drill into its roadshow so the pin is visible
      MapEngine.render(State.filtered);
      Chips.render();
      if (flyAndOpen) {
        MapEngine.flyToSite(site);
        MapEngine.pulseSite(siteId);
        SitePanel.open(siteId);
      }
      DataTable.render(State.filtered);
    }

    function selectCluster(clusterId) {
      var cluster = DataIndex.cluster(clusterId);
      if (!cluster) return;
      State.selectedClusterId = clusterId;
      State.selectedSiteId = null;
      document.getElementById('site-panel').classList.remove('open');
      var sites = State.filtered.sites.filter(function (s) { return s.clusterId === clusterId; });
      MapEngine.render(State.filtered);
      MapEngine.flyToBounds(sites.map(function (s) { return [s.latitude, s.longitude]; }));
      Chips.render();
      DataTable.render(State.filtered);
    }

    function backToRoadshows() {
      State.selectedClusterId = null;
      State.selectedSiteId = null;
      document.getElementById('site-panel').classList.remove('open');
      MapEngine.render(State.filtered);
      MapEngine.resetView();
      Chips.render();
      DataTable.render(State.filtered);
    }

    function bindTopNav() {
      document.getElementById('nav-data').addEventListener('click', function () {
        var panel = document.getElementById('data-panel');
        State.dataTableOpen = !State.dataTableOpen;
        panel.classList.toggle('open', State.dataTableOpen);
        document.getElementById('nav-data').classList.toggle('active', State.dataTableOpen);
      });
      document.getElementById('btn-data-close').addEventListener('click', function () {
        State.dataTableOpen = false;
        document.getElementById('data-panel').classList.remove('open');
        document.getElementById('nav-data').classList.remove('active');
      });
      document.getElementById('nav-reset').addEventListener('click', function () {
        FilterPanel.clearAll();
        backToRoadshows();
      });
      document.getElementById('nav-filters').addEventListener('click', function () {
        document.getElementById('filter-panel').classList.toggle('open');
      });
      document.getElementById('empty-clear-btn').addEventListener('click', FilterPanel.clearAll);
      document.querySelectorAll('.map-panel-header').forEach(function (h) {
        h.addEventListener('click', function () {
          var body = document.getElementById(h.getAttribute('data-target'));
          body.classList.toggle('collapsed');
        });
      });
    }

    function renderSectorLegend() {
      var el = document.getElementById('legend-sectors');
      if (!el) return;
      el.innerHTML = Object.keys(CONFIG.sectorMeta).map(function (key) {
        var meta = CONFIG.sectorMeta[key];
        return '<div class="legend-row"><span class="legend-swatch" style="background:' + meta.color + '"></span> ' + Utils.esc(meta.label) + '</div>';
      }).join('');
    }

    function boot() {
      if (!window.PUE_ATLAS_DATA) { console.error('PUE_ATLAS_DATA missing — normalize.js must load before app.js'); return; }
      DataIndex.init(window.PUE_ATLAS_DATA);
      URLState.read();

      MapEngine.init();
      KPI.init();
      FilterPanel.init();
      DataTable.init();
      Search.init();
      Export.init();
      Menu.init();
      LayerControl.init();
      renderSectorLegend();
      bindTopNav();

      recompute(true);

      var loader = document.getElementById('boot-loader');
      setTimeout(function () { loader.classList.add('hide'); setTimeout(function () { loader.style.display = 'none'; }, 300); }, 250);
    }

    return { recompute: recompute, selectSite: selectSite, selectCluster: selectCluster, backToRoadshows: backToRoadshows, boot: boot };
  })();

  document.addEventListener('DOMContentLoaded', App.boot);
  window.PUEAtlasApp = App;
})();