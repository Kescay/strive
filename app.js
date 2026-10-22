/* global maplibregl */
(() => {
  'use strict';

  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
  const ESRI_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';
  const STREETS_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const EARTH_CIRCUMFERENCE = 40075016.686; // metres at the equator
  const MAX_ZOOM = 20; // ~ a few metres per pixel: closer than a city block
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isPhone = () => window.innerWidth <= 640;

  const ZONES = window.STRIVE_ZONES || [];
  const DONATION_AMOUNTS = [1, 10, 20];
  const SEVERITY = {
    critical: { label: 'Critical', color: '#ff5a5f', rank: 0 },
    severe: { label: 'Severe', color: '#ff9f43', rank: 1 },
    elevated: { label: 'Elevated', color: '#ffd166', rank: 2 },
  };

  // Blue haze around the globe that fades out as you get close to the ground.
  const SKY = {
    'sky-color': '#0b1a33',
    'horizon-color': '#6fa8dc',
    'fog-color': '#b7d3f0',
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
  };

  function rasterSource(path, maxzoom, attribution) {
    return {
      type: 'raster',
      tiles: [`${ESRI}/${path}/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom,
      attribution,
    };
  }

  function satelliteStyle(withLabels) {
    const style = {
      version: 8,
      projection: { type: 'globe' },
      sky: SKY,
      sources: { imagery: rasterSource('World_Imagery', 19, ESRI_ATTRIBUTION) },
      layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
    };
    if (withLabels) {
      style.sources.roads = rasterSource('Reference/World_Transportation', 19, '');
      style.sources.places = rasterSource('Reference/World_Boundaries_and_Places', 19, '');
      style.layers.push(
        { id: 'roads', type: 'raster', source: 'roads', paint: { 'raster-opacity': 0.8 } },
        { id: 'places', type: 'raster', source: 'places' },
      );
    }
    return style;
  }

  // Zoom at which the globe fills ~80% of the shorter screen side.
  // At zoom z the globe is 512 * 2^z / π pixels across.
  function globeZoom() {
    const side = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(0, Math.log2((0.8 * side * Math.PI) / 512));
  }

  const map = new maplibregl.Map({
    container: 'map',
    style: satelliteStyle(false),
    center: [30, 12],
    zoom: globeZoom(),
    maxZoom: MAX_ZOOM,
    maxPitch: 70,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    fitBoundsOptions: { maxZoom: 17 },
  }), 'top-right');

  // ---- Crisis zones on the map ----
  const KM_PER_DEG = 111.32;

  function zoneRing(zone, steps = 72) {
    const [lng, lat] = zone.center;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const ring = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      ring.push([
        lng + (zone.radiusKm * Math.cos(a)) / (KM_PER_DEG * cosLat),
        lat + (zone.radiusKm * Math.sin(a)) / KM_PER_DEG,
      ]);
    }
    return ring;
  }

  function zoneBounds(zone) {
    const [lng, lat] = zone.center;
    const dLat = zone.radiusKm / KM_PER_DEG;
    const dLng = zone.radiusKm / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180));
    return [[lng - dLng, lat - dLat], [lng + dLng, lat + dLat]];
  }

  const zoneProps = (z) => ({ id: z.id, color: SEVERITY[z.severity].color });
  const zoneAreas = {
    type: 'FeatureCollection',
    features: ZONES.map((z) => ({ type: 'Feature', properties: zoneProps(z), geometry: { type: 'Polygon', coordinates: [zoneRing(z)] } })),
  };
  const ZONE_LAYERS = ['zones-fill'];
  let selectedId = null;

  // Zone centres are HTML markers: they pulse with plain CSS (no per-frame map
  // redraws), are keyboard-focusable, and survive map style switches.
  const markers = new Map();
  ZONES.forEach((z) => {
    const s = SEVERITY[z.severity];
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'zone-marker';
    el.style.setProperty('--sev', s.color);
    el.title = z.name;
    el.setAttribute('aria-label', `${z.name}, ${z.region}: ${s.label}, ${z.issue}`);
    el.addEventListener('click', () => selectZone(z.id));
    new maplibregl.Marker({ element: el, opacityWhenCovered: '0' }).setLngLat(z.center).addTo(map);
    markers.set(z.id, el);
  });

  // Map styles get swapped by the style switcher, which drops custom layers,
  // so the zones are (re)added every time a style finishes loading.
  function addZoneLayers() {
    if (map.getSource('zones-area')) return;
    map.addSource('zones-area', { type: 'geojson', data: zoneAreas });
    map.addLayer({
      id: 'zones-fill',
      type: 'fill',
      source: 'zones-area',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.12, 8, 0.2, 12, 0.08] },
    });
    map.addLayer({
      id: 'zones-outline',
      type: 'line',
      source: 'zones-area',
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.8, 'line-dasharray': [3, 2] },
    });
    map.addLayer({
      id: 'zones-selected',
      type: 'line',
      source: 'zones-area',
      filter: ['==', ['get', 'id'], selectedId || ''],
      paint: { 'line-color': '#ffffff', 'line-width': 3 },
    });
  }

  map.on('style.load', addZoneLayers);

  // Touch-friendly hit testing: look a few pixels around the tap.
  function zoneAt(point) {
    const layers = ZONE_LAYERS.filter((id) => map.getLayer(id));
    if (!layers.length) return null;
    const pad = 10;
    const hits = map.queryRenderedFeatures([[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]], { layers });
    return hits.length ? hits[0].properties.id : null;
  }

  map.on('click', (e) => {
    const id = zoneAt(e.point);
    if (id) selectZone(id);
  });

  map.on('mousemove', (e) => {
    map.getCanvas().style.cursor = zoneAt(e.point) ? 'pointer' : '';
  });

  // ---- Map style switcher ----
  const styleButtons = document.querySelectorAll('.layers button');
  let currentStyle = 'satellite';

  function setMapStyle(name) {
    if (name === currentStyle) return;
    currentStyle = name;
    styleButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.style === name)));
    if (name === 'streets') {
      map.setStyle(STREETS_STYLE, {
        transformStyle: (_prev, next) => ({ ...next, projection: { type: 'globe' }, sky: SKY }),
      });
    } else {
      map.setStyle(satelliteStyle(name === 'hybrid'));
    }
  }

  styleButtons.forEach((b) => b.addEventListener('click', () => setMapStyle(b.dataset.style)));

  // ---- Slow spin while looking at the whole planet ----
  let spinning = !reducedMotion;

  function spin() {
    if (!spinning || map.isMoving() || map.getZoom() > 3) return;
    const center = map.getCenter();
    center.lng -= 4;
    map.easeTo({ center, duration: 1000, easing: (t) => t });
  }

  const stopSpin = () => { spinning = false; };
  ['mousedown', 'touchstart', 'wheel', 'dragstart'].forEach((e) => map.on(e, stopSpin));
  map.on('moveend', spin);
  map.on('load', spin);

  document.getElementById('btn-globe').addEventListener('click', () => {
    closePanel();
    map.flyTo({ center: [map.getCenter().lng, 20], zoom: globeZoom(), pitch: 0, bearing: 0, speed: 1.6, essential: true });
    spinning = !reducedMotion;
  });

  document.getElementById('btn-zones').addEventListener('click', () => {
    if (!panel.hidden && panelView === 'list') closePanel();
    else showList();
  });

  // ---- Donations (demo: stored only in this browser) ----
  const STORAGE_KEY = 'strive.donations';

  function loadDonations() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  const donations = loadDonations();

  function recordDonation(zoneId, amount) {
    donations[zoneId] = (donations[zoneId] || 0) + amount;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(donations));
    } catch {
      // Storage unavailable (private mode etc.): totals last for this visit only.
    }
  }

  const totalGiven = () => Object.values(donations).reduce((a, b) => a + b, 0);
  const euro = new Intl.NumberFormat(navigator.language || 'en', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

  // ---- Zone panel ----
  const panel = document.getElementById('panel');
  const panelBody = document.getElementById('panel-body');
  const hint = document.getElementById('hint');
  let panelView = null; // 'list' | 'zone'
  let donateState = { step: 'choose', amount: 0 };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const zoneById = (id) => ZONES.find((z) => z.id === id);

  function setSelected(id) {
    selectedId = id;
    markers.forEach((el, zoneId) => el.classList.toggle('is-selected', zoneId === id));
    if (map.getLayer('zones-selected')) map.setFilter('zones-selected', ['==', ['get', 'id'], id || '']);
  }

  function openPanel() {
    panel.hidden = false;
    hint.hidden = true;
    document.body.classList.add('panel-open');
  }

  function closePanel() {
    panel.hidden = true;
    panelView = null;
    setSelected(null);
    document.body.classList.remove('panel-open');
  }

  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) closePanel(); });

  function sevChip(zone) {
    const s = SEVERITY[zone.severity];
    return `<span class="sev" style="--sev:${s.color}">${s.label}</span>`;
  }

  function showList() {
    panelView = 'list';
    setSelected(null);
    const sorted = [...ZONES].sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank);
    const given = totalGiven();
    panelBody.innerHTML = `
      <h2>Zones needing help</h2>
      <p class="muted">${ZONES.length} zones. Tap one to see what's happening and donate.</p>
      ${given ? `<p class="given">You've given ${euro.format(given)} in total.</p>` : ''}
      <ul class="zone-list">
        ${sorted.map((z) => `
          <li><button type="button" data-zone="${esc(z.id)}">
            <span class="zone-dot" style="--sev:${SEVERITY[z.severity].color}"></span>
            <span class="zone-name">${esc(z.name)}<small>${esc(z.region)} · ${esc(z.issue)}</small></span>
            ${donations[z.id] ? `<span class="zone-given">${euro.format(donations[z.id])}</span>` : ''}
          </button></li>`).join('')}
      </ul>`;
    panelBody.querySelectorAll('[data-zone]').forEach((b) => b.addEventListener('click', () => selectZone(b.dataset.zone)));
    openPanel();
    panelBody.scrollTop = 0;
  }

  function selectZone(id) {
    const zone = zoneById(id);
    if (!zone) return;
    stopSpin();
    setSelected(id);
    donateState = { step: 'choose', amount: 0 };
    panelView = 'zone';
    renderZone(zone);
    openPanel();
    panelBody.scrollTop = 0;

    const phone = isPhone();
    const padding = phone
      ? { top: 80, bottom: Math.round(window.innerHeight * 0.6) + 20, left: 30, right: 30 }
      : { top: 90, bottom: 130, left: 420, right: 80 };
    map.fitBounds(zoneBounds(zone), { padding, maxZoom: 11, pitch: 0, bearing: 0, essential: true });
  }

  function donateSection(zone) {
    const { step, amount } = donateState;
    if (step === 'confirm') {
      return `
        <p class="confirm-text">Donate <strong>${euro.format(amount)}</strong> to ${esc(zone.name)}?</p>
        <div class="confirm-row">
          <button type="button" class="btn-primary" data-act="pay">Donate ${euro.format(amount)}</button>
          <button type="button" class="btn-ghost" data-act="cancel">Cancel</button>
        </div>`;
    }
    if (step === 'processing') {
      return '<p class="confirm-text">Processing your donation…</p>';
    }
    if (step === 'thanks') {
      return `
        <div class="thanks" role="status">
          <strong>Thank you!</strong>
          <span>${euro.format(amount)} for ${esc(zone.name)}.</span>
        </div>
        <button type="button" class="btn-ghost" data-act="again">Donate again</button>`;
    }
    return `
      <div class="amounts">
        ${DONATION_AMOUNTS.map((a) => `<button type="button" class="amount" data-amount="${a}">${euro.format(a)}</button>`).join('')}
      </div>`;
  }

  function renderZone(zone) {
    const given = donations[zone.id] || 0;
    panelBody.innerHTML = `
      <button type="button" class="back" data-act="list">← All zones</button>
      <div class="zone-meta">${sevChip(zone)}<span class="issue">${esc(zone.issue)}</span></div>
      <h2>${esc(zone.name)}</h2>
      <p class="region">${esc(zone.region)}</p>
      <p class="summary">${esc(zone.summary)}</p>
      <h3>Your donation helps provide</h3>
      <ul class="needs">${zone.needs.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      <section class="donate" aria-label="Donate">
        <h3>Donate</h3>
        ${donateSection(zone)}
        <p class="demo-note">Demo mode: no money is charged.</p>
      </section>
      ${given ? `<p class="given">You've given ${euro.format(given)} to ${esc(zone.name)}.</p>` : ''}`;

    panelBody.querySelectorAll('[data-amount]').forEach((b) => b.addEventListener('click', () => {
      donateState = { step: 'confirm', amount: Number(b.dataset.amount) };
      renderZone(zone);
      panelBody.querySelector('[data-act="pay"]').focus();
    }));
    panelBody.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'list') { showList(); return; }
      if (act === 'cancel' || act === 'again') {
        donateState = { step: 'choose', amount: 0 };
        renderZone(zone);
        return;
      }
      if (act === 'pay') {
        // Placeholder for a real payment provider (e.g. a Stripe Checkout session).
        donateState.step = 'processing';
        renderZone(zone);
        setTimeout(() => {
          recordDonation(zone.id, donateState.amount);
          donateState.step = 'thanks';
          if (panelView === 'zone' && selectedId === zone.id) renderZone(zone);
        }, 700);
      }
    }));
  }

  // ---- Search (OpenStreetMap Nominatim) ----
  const searchForm = document.getElementById('search');
  const searchInput = document.getElementById('search-input');
  const resultsList = document.getElementById('results');

  function showResults(items) {
    resultsList.replaceChildren(...items);
    resultsList.hidden = items.length === 0;
  }

  function messageItem(text) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = text;
    return li;
  }

  function goToResult(r) {
    stopSpin();
    showResults([]);
    searchInput.value = r.display_name;
    const [south, north, west, east] = r.boundingbox.map(Number);
    map.fitBounds([[west, south], [east, north]], { maxZoom: 18, padding: 60, pitch: 0, essential: true });
  }

  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (!q) return;
    showResults([messageItem('Searching…')]);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.length) {
        showResults([messageItem(`No places found for “${q}”. Try a city or a full street address.`)]);
        return;
      }
      if (data.length === 1) { goToResult(data[0]); return; }
      showResults(data.map((r) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = r.display_name;
        btn.addEventListener('click', () => goToResult(r));
        li.append(btn);
        return li;
      }));
    } catch (err) {
      showResults([messageItem('Search is unavailable right now. Check your connection and try again.')]);
    }
  });

  document.addEventListener('click', (e) => {
    if (!searchForm.contains(e.target)) showResults([]);
  });

  // ---- HUD ----
  const hud = {
    scale: document.getElementById('hud-scale'),
    width: document.getElementById('hud-width'),
    zoom: document.getElementById('hud-zoom'),
    center: document.getElementById('hud-center'),
  };

  const SCALES = [
    [5e6, 'Planet'], [1.5e6, 'Continent'], [3e5, 'Country'], [6e4, 'Region'],
    [1.5e4, 'City'], [3e3, 'District'], [700, 'Neighborhood'], [150, 'City block'], [0, 'Street'],
  ];

  function formatDistance(m) {
    if (m >= 10000) return `${Math.round(m / 1000).toLocaleString()} km`;
    if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
    return `${Math.round(m)} m`;
  }

  function updateHud() {
    const { lng, lat } = map.getCenter();
    const zoom = map.getZoom();
    const metresPerPixel = (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
    const viewWidth = metresPerPixel * map.getCanvas().clientWidth;
    const zoomedOut = viewWidth > EARTH_CIRCUMFERENCE / Math.PI; // wider than the planet itself
    hud.scale.textContent = SCALES.find(([min]) => viewWidth >= min)[1];
    hud.width.textContent = zoomedOut ? 'Whole globe' : `${formatDistance(viewWidth)} across`;
    hud.zoom.textContent = zoom.toFixed(1);
    hud.center.textContent = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
  }

  map.on('move', updateHud);
  map.on('load', updateHud);

  window.strive = { map, selectZone, showList }; // handy for poking at the app from the browser console
})();
