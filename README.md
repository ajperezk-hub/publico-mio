# City Pulse

A simple, warm web app.

**Your location** (top panel): your local time, temperature in °C and °F, humidity and a weather picture. It asks your browser for your location. If you say no, it still shows your device's time, and the **Use my location** button lets you try again.

Type a city and see

- **City and country** (plus state/region when there is one)
- **Local time**: a live clock with the date and time zone
- **Temperature** in °C and °F, with a picture of the weather (sun, moon, clouds, fog, drizzle, rain, showers, snow, thunderstorm)
- **Humidity** with a fill bar
- **Currency** with its name, always converted to **Swiss francs (CHF)** in both directions

The colours follow an Optimus Prime palette: Autobot red, deep blue, chrome silver and headlight yellow, on a warm cream background (it also has a dark mode).

## Use it

No installation and no API keys. Open `index.html` in a browser, or publish the repo with GitHub Pages (Settings → Pages → deploy from a branch).

Tips:
- To pick between cities with the same name, add the country or region: `Paris, Texas`, `Paris, TX`, `Paris, FR`, `London, UK`, `London, ON`, `Dubai, UAE`.
- The destination's time card says how far ahead or behind you it is.
- The app remembers the last city you searched and shows it again next time.
- Weather refreshes every 15 minutes while the page is open. Exchange rates are kept for an hour, since they change once a day.
- Your location is rounded to about 1 km before it is sent to the weather and area-name services.
- To add it to your iPhone home screen: open it in Safari, tap **Share → Add to Home Screen**.
- If one data source is down, the app still shows what it has and says what is missing.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page layout |
| `style.css` | Look and feel |
| `app.js` | Search, weather, clock and currency logic |
| `icon.svg`, `apple-touch-icon.png` | App icon for the browser tab and home screen |
| `icons.js` | Weather pictures for each weather type |
| `currencies.js` | Country → currency table (reviewed Nov 2026) |

## Data sources

- [Open-Meteo](https://open-meteo.com/): city search and current weather
- [BigDataCloud](https://www.bigdatacloud.com/): the name of the area you're in (reverse geocoding, no key)
- [ExchangeRate-API (open access)](https://www.exchangerate-api.com/docs/free): exchange rates, updated daily
