# Strive Earth

A web map of the real Earth. Zoomed out it's a spinning 3D globe; zoom in and it
flattens into a street-level map you can take down to a single city block
(zoom 17–20, a few metres per pixel).

Built with [MapLibre GL JS](https://maplibre.org/) (globe projection). No build
step, no API keys.

## Features

- **Globe → block zoom.** Scroll, pinch or use the +/− buttons. Right-drag (or
  two-finger drag) tilts the camera.
- **Three map styles:** Satellite (Esri World Imagery), Hybrid (satellite with
  roads and place names) and Streets (OpenStreetMap data via OpenFreeMap, with
  3D buildings when zoomed in).
- **Search** for any city, address or landmark (OpenStreetMap Nominatim).
- **Surprise me** flies to a famous city block; **Globe** zooms back out.
- **Locate me** button (needs HTTPS and location permission).
- HUD showing scale (Planet → Street), how wide the view is, zoom and coordinates.

## Run it locally

Any static file server works:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from disk also works in most browsers.

## Test it online (GitHub Pages)

The workflow in `.github/workflows/pages.yml` publishes the site on every push.
One-time setup: in the repo go to **Settings → Pages → Build and deployment →
Source** and pick **GitHub Actions**, then re-run the workflow from the
**Actions** tab. The site appears at `https://<owner>.github.io/strive/`.

## Data sources and limits

- Satellite tiles: Esri World Imagery (free to use for development and
  non-commercial demos, with attribution).
- Street tiles: [OpenFreeMap](https://openfreemap.org/), free with no key.
- Search: Nominatim's public server, limited to about 1 request per second.
  Fine for testing; a real product should use a paid geocoder or self-host.
