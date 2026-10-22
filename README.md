# Strive Earth

A donation app built on a 3D map of the real Earth. Glowing zones mark places
where people need help. Tap a zone to read what's happening there and donate
meals: 1, 5 or 25 at a time.

> **Prototype.** The zones in `zones.js` are sample data, and donations are
> simulated: no money is charged. Totals are kept only in your own browser.

The map itself is a spinning globe when zoomed out and a street-level map when
zoomed in, down to a single city block (zoom 17–20, a few metres per pixel).

Built with [MapLibre GL JS](https://maplibre.org/) (globe projection). No build
step, no API keys.

## Features

- **Crisis zones** on the globe, coloured by severity (critical, severe,
  elevated). Tap a marker or area, or open the **Zones** list.
- **Zone details:** what the problem is and what donations pay for.
- **Donate meals** (1 meal €0.80, 5 meals €4.00, 25 meals €20.00) with a
  confirm step and a thank-you, plus a running total of meals and euros given
  (demo mode).
- **Demo notifications** after each donation: a delivery update after 10 s and
  a "Company X has given you €50" reward after 20 s. With notifications
  allowed they are real system notifications; otherwise in-app banners.
- **Installable app** (Add to Home Screen) with its own icon.
- **Globe → block zoom.** Scroll, pinch or use the +/− buttons. Right-drag (or
  two-finger drag) tilts the camera.
- **Three map styles:** Satellite (Esri World Imagery), Hybrid (satellite with
  roads and place names) and Streets (OpenStreetMap data via OpenFreeMap, with
  3D buildings when zoomed in).
- **Search** for any city, address or landmark (OpenStreetMap Nominatim).
- **Globe** zooms back out to the whole planet.
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

## Editing zones

Each zone in `zones.js` has a name, region, centre (longitude, latitude),
radius in km, severity, a short issue label, a summary and a list of needs. Add,
remove or edit entries and the map and list update automatically.

## Meal price

The example price is €0.80 per meal, based on WFP's ShareTheMeal app, which
uses US$0.80 to feed a child for a day. Change `DEFAULT_MEAL_COST_CENTS` and
`MEAL_OPTIONS` at the top of `app.js`, or give a zone its own price with
`mealCostCents` in `zones.js`. The real figure should come from the partner
organisation.

## Demo notifications

There is no server: the page schedules the notifications itself and the service
worker (`sw.js`) shows them, so they also appear if you switch apps or lock the
phone within the delay. Tapping one opens the app at that zone.

- **Android / desktop:** tap "Notify me when it's delivered" after a donation
  and allow notifications.
- **iPhone:** add the app to the Home Screen (Share → Add to Home Screen), open
  it from there, then allow notifications. In a normal Safari tab you get the
  in-app banners instead.

Delays, the reward company and the amount are set at the top of the
"Demo notifications" section in `app.js`. Real notifications would be sent from
a server with Web Push (for example PHP on a web hotel).

## Going from demo to real donations

1. **Partner and legal setup.** Taking money "for" a cause usually requires
   being a registered charity, or sending donations straight to a partner
   charity's own account. A partner such as the UN World Food Programme would
   also supply (or approve) the zone information.
2. **Payments.** Replace the placeholder in `app.js` (search for "payment
   provider") with a real checkout, for example Stripe Checkout created by a
   small serverless function, paying out to the charity's account.
3. **Live zone data.** Load zones from the partner or a public feed such as
   ReliefWeb instead of the static `zones.js` file.

## Data sources and limits

- Satellite tiles: Esri World Imagery (free to use for development and
  non-commercial demos, with attribution).
- Street tiles: [OpenFreeMap](https://openfreemap.org/), free with no key.
- Search: Nominatim's public server, limited to about 1 request per second.
  Fine for testing; a real product should use a paid geocoder or self-host.
