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
  // Donations are offered as meals. Example price: WFP's ShareTheMeal app uses
  // US$0.80 to feed a child for a day. Replace with the partner's real figure;
  // a zone can override it with `mealCostCents` (food costs differ by country).
  const MEAL_OPTIONS = [1, 5, 25];
  const DEFAULT_MEAL_COST_CENTS = 80;
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
  // Money is kept in whole cents so totals never pick up floating-point dust.
  const STORAGE_KEY = 'strive.donations.v2'; // { zoneId: { meals, cents } }

  function loadDonations() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  const donations = loadDonations();

  function recordDonation(zoneId, meals, cents) {
    const d = donations[zoneId] || { meals: 0, cents: 0 };
    donations[zoneId] = { meals: d.meals + meals, cents: d.cents + cents };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(donations));
    } catch {
      // Storage unavailable (private mode etc.): totals last for this visit only.
    }
  }

  const totalGiven = () => Object.values(donations).reduce(
    (t, d) => ({ meals: t.meals + d.meals, cents: t.cents + d.cents }), { meals: 0, cents: 0 });
  const mealCost = (zone) => zone.mealCostCents ?? DEFAULT_MEAL_COST_CENTS;
  const euroFormat = new Intl.NumberFormat(navigator.language || 'en', { style: 'currency', currency: 'EUR' });
  const euro = (cents) => euroFormat.format(cents / 100);
  const mealsText = (n) => `${n} ${n === 1 ? 'meal' : 'meals'}`;
  const givenText = (d) => `${mealsText(d.meals)} (${euro(d.cents)})`;

  // ---- Zone panel ----
  const panel = document.getElementById('panel');
  const panelBody = document.getElementById('panel-body');
  const hint = document.getElementById('hint');
  let panelView = null; // 'list' | 'zone'
  let donateState = { step: 'choose', meals: 0 };

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
      ${given.meals ? `<p class="given">You've given ${givenText(given)} in total.</p>` : ''}
      <ul class="zone-list">
        ${sorted.map((z) => `
          <li><button type="button" data-zone="${esc(z.id)}">
            <span class="zone-dot" style="--sev:${SEVERITY[z.severity].color}"></span>
            <span class="zone-name">${esc(z.name)}<small>${esc(z.region)} · ${esc(z.issue)}</small></span>
            ${donations[z.id] ? `<span class="zone-given">${mealsText(donations[z.id].meals)}</span>` : ''}
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
    donateState = { step: 'choose', meals: 0 };
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
    const { step, meals } = donateState;
    const price = euro(meals * mealCost(zone));
    if (step === 'confirm') {
      return `
        <p class="confirm-text">Give <strong>${mealsText(meals)}</strong> to ${esc(zone.name)} for <strong>${price}</strong>?</p>
        <div class="confirm-row">
          <button type="button" class="btn-primary" data-act="pay">Donate ${price}</button>
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
          <span>${mealsText(meals)} (${price}) for ${esc(zone.name)}.</span>
        </div>
        ${notifyOptIn()}
        <button type="button" class="btn-ghost" data-act="again">Donate again</button>`;
    }
    return `
      <div class="amounts">
        ${MEAL_OPTIONS.map((n) => `
          <button type="button" class="amount" data-meals="${n}">
            <span class="amount-meals">${mealsText(n)}</span>
            <span class="amount-price">${euro(n * mealCost(zone))}</span>
          </button>`).join('')}
      </div>`;
  }

  function renderZone(zone) {
    const given = donations[zone.id];
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
        <p class="demo-note">Demo mode: no money is charged. Example price of ${euro(mealCost(zone))} per meal.</p>
      </section>
      ${given ? `<p class="given">You've given ${givenText(given)} to ${esc(zone.name)}.</p>` : ''}`;

    panelBody.querySelectorAll('[data-meals]').forEach((b) => b.addEventListener('click', () => {
      donateState = { step: 'confirm', meals: Number(b.dataset.meals) };
      renderZone(zone);
      panelBody.querySelector('[data-act="pay"]').focus();
    }));
    panelBody.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'list') { showList(); return; }
      if (act === 'cancel' || act === 'again') {
        donateState = { step: 'choose', meals: 0 };
        renderZone(zone);
        return;
      }
      if (act === 'notify') {
        enableNotifications().then(() => {
          if (panelView === 'zone' && selectedId === zone.id) renderZone(zone);
        });
        return;
      }
      if (act === 'pay') {
        // Placeholder for a real payment provider (e.g. a Stripe Checkout session).
        const { meals } = donateState;
        donateState.step = 'processing';
        renderZone(zone);
        setTimeout(() => {
          recordDonation(zone.id, meals, meals * mealCost(zone));
          scheduleDonationUpdates(zone, meals);
          donateState.step = 'thanks';
          if (panelView === 'zone' && selectedId === zone.id) renderZone(zone);
        }, 700);
      }
    }));
  }

  // ---- Demo notifications (no server) ----
  // The page schedules the notifications itself. With permission they are real
  // system notifications shown by the service worker; otherwise they appear as
  // in-app banners. A real version would send them from a server via Web Push.
  const DEMO_DELAYS = { delivered: 10000, reward: 20000 };
  const REWARD = { company: 'Company X', amount: '€50' };
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let notifySupported = 'Notification' in window && 'serviceWorker' in navigator;
  let pending = []; // notifications still waiting on an in-page timer

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { notifySupported = false; });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'open-zone' && e.data.zone) selectZone(e.data.zone);
    });
  }

  const systemNotificationsOn = () => notifySupported && Notification.permission === 'granted';

  // Hand a notification to the service worker if allowed, else keep an in-page timer.
  function route(item) {
    clearTimeout(item.timer);
    const delay = Math.max(0, item.at - Date.now());
    if (systemNotificationsOn()) {
      pending = pending.filter((p) => p !== item);
      navigator.serviceWorker.ready.then((reg) => reg.active.postMessage({ type: 'schedule', delay, ...item.n }));
    } else {
      item.timer = setTimeout(() => {
        pending = pending.filter((p) => p !== item);
        showToast(item.n);
      }, delay);
    }
  }

  function scheduleNotification(n, delay) {
    const item = { at: Date.now() + delay, n };
    pending.push(item);
    route(item);
  }

  function scheduleDonationUpdates(zone, meals) {
    scheduleNotification({
      tag: `delivered-${zone.id}`,
      zone: zone.id,
      title: `Update from ${zone.name}`,
      body: `The food distribution you helped fund has reached families in ${zone.name}. Thank you for your ${mealsText(meals)}! (Demo)`,
    }, DEMO_DELAYS.delivered);
    scheduleNotification({
      tag: 'reward',
      zone: zone.id,
      title: `${REWARD.company} rewarded you`,
      body: `${REWARD.company} has given you ${REWARD.amount} for donating. (Demo)`,
    }, DEMO_DELAYS.reward);
  }

  async function enableNotifications() {
    let result = 'denied';
    try {
      result = await Notification.requestPermission();
    } catch {
      // Older Safari only supports the callback form; treat as not granted.
    }
    if (result === 'granted') [...pending].forEach(route);
    return result;
  }

  function notifyOptIn() {
    if (notifySupported && Notification.permission === 'default') {
      return '<button type="button" class="btn-ghost" data-act="notify">Notify me when it\'s delivered</button>';
    }
    if (systemNotificationsOn()) {
      return '<p class="notify-note">You\'ll get a notification when there\'s news about your donation.</p>';
    }
    if (isIos && !isStandalone) {
      return '<p class="notify-note">To get notifications on iPhone, add Strive to your Home Screen (Share → Add to Home Screen) and open it from there.</p>';
    }
    if (notifySupported && Notification.permission === 'denied') {
      return '<p class="notify-note">Notifications are blocked in your browser settings, so updates will appear here in the app.</p>';
    }
    return '<p class="notify-note">Updates about your donation will appear here in the app.</p>';
  }

  const toasts = document.getElementById('toasts');

  function showToast(n) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'toast';
    el.innerHTML = `
      <img src="icons/icon-192.png" alt="">
      <span class="toast-text">
        <span class="toast-app">Strive · now</span>
        <strong>${esc(n.title)}</strong>
        <span>${esc(n.body)}</span>
      </span>`;
    const timer = setTimeout(() => el.remove(), 9000);
    el.addEventListener('click', () => {
      clearTimeout(timer);
      el.remove();
      if (n.zone) selectZone(n.zone);
    });
    toasts.append(el);
  }

  // Tapping a notification while the app is closed opens it at ?zone=<id>.
  const startZone = new URLSearchParams(window.location.search).get('zone');
  if (startZone && zoneById(startZone)) map.once('load', () => selectZone(startZone));

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
