# City Pulse

A simple, warm web app.

**Your location** (top panel): your local time, temperature in °C and °F, humidity and a weather picture. It asks your browser for your location. If you say no, it still shows your device's time, and the **Use my location** button lets you try again.

Type a city and see

- **City and country** (plus state/region when there is one)
- **Local time**: a live clock with the date and time zone
- **Temperature** in °C and °F, with a picture of the weather (sun, moon, clouds, fog, drizzle, rain, showers, snow, thunderstorm)
- **Humidity** with a fill bar
- **Currency** with its name, converted to **your own currency** in both directions. Your currency comes from your location's country. If you don't share your location, it comes from your phone's region setting (e.g. English (US) → USD), and Swiss francs (CHF) are used if neither is known

The colours follow an Optimus Prime palette: Autobot red, deep blue, chrome silver and headlight yellow, on a warm cream background (it also has a dark mode).

## Use it

No installation and no API keys. Open `index.html` in a browser, or publish the repo with GitHub Pages (Settings → Pages → deploy from a branch).

Tips:
- As you type, a list suggests matching places with their region, country and flag. Tap one (or use the arrow keys and Enter).
- After a search, **Also called London:** buttons list other places with the same name. One tap switches.
- The app remembers the exact place you last looked at (e.g. London, Ontario) and shows it again next time.
- You can also type the country or region after a comma: `Paris, Texas`, `Paris, TX`, `Paris, FR`, `London, UK`, `London, ON`, `Dubai, UAE`.
- The destination's time card says how far ahead or behind you it is.
- Weather refreshes every 15 minutes while the page is open. Exchange rates are kept for an hour, since they change once a day.
- Your location is rounded to about 1 km before it is sent to the weather and area-name services.
- To add it to your iPhone home screen: open it in Safari, tap **Share → Add to Home Screen**.
- If one data source is down, the app still shows what it has and says what is missing.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page layout |
| `style.css` | Look and feel (light and dark) |
| `app.js` | The app: search, weather, clocks, currency, your location |
| `data.js` | Lookup tables: country → currency (reviewed Nov 2026), country nicknames (UK, USA, UAE…), US state and Canadian province codes |
| `icons.js` | Weather pictures for each weather type |
| `icon.svg`, `apple-touch-icon.png` | App icon for the browser tab and home screen |
| `tests/run.js` | Automated browser tests with made-up data |

## Tests

The tests use made-up answers from the data services, so they need no internet connection:

```
npm i -D playwright && npx playwright install chromium   # once
node tests/run.js
```

## Data sources

- [Open-Meteo](https://open-meteo.com/): city search and current weather
- [BigDataCloud](https://www.bigdatacloud.com/): the name of the area you're in (reverse geocoding, no key)
- [ExchangeRate-API (open access)](https://www.exchangerate-api.com/docs/free): exchange rates, updated daily
