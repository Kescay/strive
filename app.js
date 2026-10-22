/* global maplibregl */
(() => {
  'use strict';

  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
  const ESRI_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';
  const STREETS_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const EARTH_CIRCUMFERENCE = 40075016.686; // metres at the equator
  const MAX_ZOOM = 20; // ~ a few metres per pixel: closer than a city block
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Blue haze around the globe that fades out as you get close to the ground.
  const SKY = {
    'sky-color': '#0b1a33',
    'horizon-color': '#6fa8dc',
    'fog-color': '#b7d3f0',
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
  };

  const PLACES = [
    { name: 'Times Square, New York', center: [-73.9855, 40.7580] },
    { name: 'Shibuya Crossing, Tokyo', center: [139.7005, 35.6595] },
    { name: 'Eiffel Tower, Paris', center: [2.2945, 48.8584] },
    { name: 'Colosseum, Rome', center: [12.4922, 41.8902] },
    { name: 'Sydney Opera House', center: [151.2153, -33.8568] },
    { name: 'Piccadilly Circus, London', center: [-0.1340, 51.5101] },
    { name: 'Pyramids of Giza', center: [31.1342, 29.9792] },
    { name: 'Marina Bay Sands, Singapore', center: [103.8607, 1.2834] },
    { name: 'Golden Gate Bridge, San Francisco', center: [-122.4783, 37.8199] },
    { name: 'Burj Khalifa, Dubai', center: [55.2744, 25.1972] },
    { name: 'Sagrada Família, Barcelona', center: [2.1744, 41.4036] },
    { name: 'Plaza de Mayo, Buenos Aires', center: [-58.3712, -34.6083] },
  ];

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
    center: [-30, 25],
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

  // ---- Navigation helpers ----
  function flyToBlock(center, name) {
    stopSpin();
    map.flyTo({ center, zoom: 17.5, pitch: 45, bearing: 0, speed: 1.4, essential: true });
    if (name) searchInput.value = name;
  }

  document.getElementById('btn-globe').addEventListener('click', () => {
    map.flyTo({ center: [map.getCenter().lng, 20], zoom: globeZoom(), pitch: 0, bearing: 0, speed: 1.6, essential: true });
    spinning = !reducedMotion;
  });

  let lastPlace = -1;
  document.getElementById('btn-random').addEventListener('click', () => {
    let i;
    do { i = Math.floor(Math.random() * PLACES.length); } while (i === lastPlace);
    lastPlace = i;
    flyToBlock(PLACES[i].center, PLACES[i].name);
  });

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

  window.strive = { map }; // handy for poking at the map from the browser console
})();
