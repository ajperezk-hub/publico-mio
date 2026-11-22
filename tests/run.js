// Browser tests for City Pulse with made-up API answers (no network needed).
// Run from the repository root:  node tests/run.js
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).

const path = require("path");
const { chromium } = require("playwright");

const PAGE = "file://" + path.resolve(__dirname, "..", "index.html");
const SHOTS = process.env.SHOTS_DIR || null; // set to save screenshots

const place = (name, cc, country, admin1, lat, tz) =>
  ({ name, latitude: lat, longitude: 1, country_code: cc, country, admin1, timezone: tz });
const PLACES = {
  Tokyo: [place("Tokyo", "JP", "Japan", "Tokyo", 35.68, "Asia/Tokyo")],
  Zurich: [place("Zurich", "CH", "Switzerland", "Zurich", 47.37, "Europe/Zurich")],
  London: [place("London", "GB", "United Kingdom", "England", 51.51, "Europe/London"),
           place("London", "CA", "Canada", "Ontario", 42.98, "America/Toronto")],
  Paris: [place("Paris", "FR", "France", "Île-de-France", 48.85, "Europe/Paris"),
          place("Paris", "US", "United States", "Texas", 33.66, "America/Chicago")],
  Portland: [place("Portland", "US", "United States", "Oregon", 45.52, "America/Los_Angeles"),
             place("Portland", "US", "United States", "Maine", 43.66, "America/New_York")],
  Dubai: [place("Dubai", "AE", "United Arab Emirates", "Dubai", 25.2, "Asia/Dubai")],
  Hanoi: [place("Hanoi", "VN", "Vietnam", "Hanoi", 21.03, "Asia/Bangkok")],
  Oslo: [place("Oslo", "NO", "Norway", "Oslo", 59.91, "Europe/Oslo")],
  Boston: [place("Boston", "US", "United States", "Massachusetts", 42.36, "America/New_York")],
  Sofia: [place("Sofia", "BG", "Bulgaria", "Sofia-Capital", 42.69, "Europe/Sofia")]
};
// Weather by latitude: [temperature, weather code, is_day, time zone]
const WEATHER = {
  "35.68": [20, 61, 1, "Asia/Tokyo"], "47.37": [4.5, 3, 1, "Europe/Zurich"], "47.38": [4.5, 3, 1, "Europe/Zurich"],
  "51.51": [9, 45, 1, "Europe/London"], "48.85": [2, 0, 0, "Europe/Paris"], "59.91": [-0.04, 71, 1, "Europe/Oslo"],
  "42.36": [12, 95, 1, "America/New_York"], "40.71": [12, 2, 1, "America/New_York"]
};
const USD_RATES = { USD: 1, JPY: 150, CHF: 0.8, EUR: 0.9, GBP: 0.75, VND: 25000, AED: 3.67, CAD: 1.36, NOK: 10.5 };

let failures = 0;
function check(name, actual, expected) {
  const ok = String(actual).includes(String(expected));
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — expected "${expected}", got ${JSON.stringify(actual)}`}`);
}

// Opens the app with mocked services. `api` lets a test break or slow a service.
async function open(browser, { location = null, homeCountry = null, locale = "de-CH", api = {} } = {}) {
  const context = await browser.newContext({
    locale, timezoneId: "Europe/Zurich",
    ...(location ? { geolocation: location, permissions: ["geolocation"] } : {})
  });
  const page = await context.newPage();
  const calls = { rates: 0, weather: [], place: [] };
  await page.route("**/geocoding-api.open-meteo.com/**", (r) => {
    if (api.offline) return r.abort();
    const name = new URL(r.request().url()).searchParams.get("name");
    r.fulfill({ json: { results: PLACES[name] } });
  });
  await page.route("**/api.open-meteo.com/**", async (r) => {
    const lat = new URL(r.request().url()).searchParams.get("latitude");
    calls.weather.push(lat);
    if (api.slowWeather) { await new Promise((x) => setTimeout(x, 12000)); return r.abort().catch(() => {}); }
    const [t, code, isDay, tz] = WEATHER[lat] || [15, 2, 1, "Europe/Zurich"];
    r.fulfill({ json: { timezone: tz, current: { temperature_2m: t, relative_humidity_2m: 70, weather_code: code, is_day: isDay } } });
  });
  await page.route("**/api.bigdatacloud.net/**", async (r) => {
    calls.place.push(r.request().url());
    if (api.holdPlace) await api.holdPlace;
    r.fulfill({ json: { city: "Hometown", countryName: "Homeland", countryCode: homeCountry || "" } });
  });
  await page.route("**/open.er-api.com/**", (r) => {
    calls.rates++;
    if (api.ratesDown) return r.fulfill({ status: 500, body: "" });
    const base = r.request().url().split("/").pop();
    const rates = Object.fromEntries(Object.entries(USD_RATES).map(([k, v]) => [k, v / USD_RATES[base]]));
    r.fulfill({ json: { result: "success", rates } });
  });
  await page.goto(PAGE);
  const text = (id) => page.textContent("#" + id);
  const search = async (q) => {
    await page.fill("#city", q);
    await page.click("#go");
    await page.waitForFunction(() => !document.getElementById("go").disabled, null, { timeout: 20000 });
  };
  return { page, context, calls, text, search };
}

(async () => {
  const browser = await chromium.launch();

  // --- Search basics, currency conversion (location off, Swiss phone -> CHF) ---
  {
    const { page, text, search, calls, context } = await open(browser);
    await page.waitForFunction(() => !document.getElementById("locate").hidden);
    check("location off message", await text("herePlace"), "Showing your device time only");
    check("device time shown", await text("hereTime"), ":");

    await search("Tokyo");
    check("country", await text("country"), "Japan");
    check("°C", await text("destTempC"), "20.0");
    check("°F", await text("destTempF"), "68.0");
    check("humidity", await text("destHum"), "70");
    check("weather label", await text("destCond"), "Rain");
    check("weather picture", await page.$eval("#destIcon", (e) => !!e.querySelector("svg")), true);
    check("currency", await text("currency"), "JPY");
    check("currency name", await text("currencyName"), "Japanese Yen");
    check("conversion label", await text("convLabel"), "In your currency (CHF)");
    check("conversion", await text("conv"), "1 JPY = 0.005333 CHF");
    check("conversion back", await text("conv"), "1 CHF = 187.50 JPY");
    check("time difference", await text("tzDiff"), "8 h ahead of you");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop.png`, fullPage: true });

    await search("Zurich");
    check("same currency", await text("conv"), "Same currency as you");
    check("same time", await text("tzDiff"), "Same time as you");
    await search("Sofia");
    check("Bulgaria uses EUR", await text("currency"), "EUR");
    await search("Hanoi");
    check("tiny rate keeps 4 digits", await text("conv"), "1 VND = 0.000032 CHF");
    await search("Oslo");
    check("no -0.0", await text("destTempC"), "0.0");
    check("no -0.0 (sign)", (await text("destTempC")).startsWith("-"), false);
    check("snow", await text("destCond"), "Snow");
    await search("Paris");
    check("night picture", await text("destCond"), "Clear night");

    const before = calls.rates;
    await search("Tokyo");
    check("rates reused for an hour", calls.rates === before, true);

    // Typing a country or region after a comma
    for (const [q, want] of [["London, UK", "United Kingdom"], ["London, ON", "Ontario, Canada"],
      ["Paris, USA", "Texas"], ["Paris, TX", "Texas"], ["Paris, Texas, USA", "Texas"], ["Paris, ile", "France"],
      ["Portland, ME", "Maine"], ["Dubai, UAE", "United Arab Emirates"]]) {
      await search(q);
      check(`"${q}"`, await text("country"), want);
    }
    await search("Paris, Narnia");
    check("helpful not found", await text("status"), 'Try just "Paris"');
    await search("Atlantis");
    check("unknown city", await text("status"), 'No city called "Atlantis"');

    // Remembers the last successful city
    await search("Dubai");
    await page.reload();
    await page.waitForFunction(() => document.getElementById("cityName").textContent === "Dubai", null, { timeout: 10000 });
    check("remembers last city", await text("cityName"), "Dubai");

    await page.setViewportSize({ width: 390, height: 844 });
    check("no sideways scrolling on phones", await page.evaluate(() => document.documentElement.scrollWidth <= 390), true);
    await context.close();
  }

  // --- Your location: weather, privacy rounding, your currency ---
  {
    const { page, text, search, calls, context } = await open(browser,
      { location: { latitude: 47.37691, longitude: 8.54169 }, homeCountry: "us", locale: "de-CH" });
    await page.waitForFunction(() => document.getElementById("hereTempC").textContent !== "—");
    check("your place", await text("herePlace"), "Hometown, Homeland");
    check("your °C", await text("hereTempC"), "4.5");
    check("your °F", await text("hereTempF"), "40.1");
    check("your weather", await text("hereCond"), "Overcast");
    check("location rounded (weather)", calls.weather[0], "47.38");
    check("location rounded (place name)", calls.place[0].includes("latitude=47.38&"), true);
    await search("Tokyo");
    check("converts to your location's currency", await text("convLabel"), "USD");
    check("rate in USD", await text("conv"), "1 JPY = 0.006667 USD");
    await search("Boston");
    check("same currency (USD)", await text("conv"), "Same currency as you");
    check("thunderstorm", await text("destCond"), "Thunderstorm");
    if (SHOTS) {
      await search("Tokyo");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${SHOTS}/phone.png`, fullPage: true });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({ path: `${SHOTS}/phone-dark.png`, fullPage: true });
    }
    await context.close();
  }

  // --- Phone region decides the currency when location is off ---
  {
    const { search, text, context } = await open(browser, { locale: "en-GB" });
    await search("Paris");
    check("UK phone -> GBP", await text("conv"), "1 EUR = 0.8333 GBP");
    await context.close();
  }

  // --- Location arrives after a city is shown: conversion switches ---
  {
    let release;
    const holdPlace = new Promise((r) => { release = r; });
    const { page, search, text, context } = await open(browser,
      { location: { latitude: 52.52, longitude: 13.4 }, homeCountry: "de", locale: "en-US", api: { holdPlace } });
    await search("Tokyo");
    check("before location: phone region (USD)", await text("convLabel"), "USD");
    release();
    await page.waitForFunction(() => document.getElementById("convLabel").textContent.includes("EUR"));
    check("after location: EUR", await text("conv"), "1 JPY = 0.006 EUR");
    check("card still shows Tokyo", await text("cityName"), "Tokyo");
    await context.close();
  }

  // --- Problems with the services ---
  {
    const { search, text, context } = await open(browser, { api: { ratesDown: true } });
    await search("Tokyo");
    check("rates down: weather still shown", await text("destTempC"), "20.0");
    check("rates down: says what's missing", await text("status"), "exchange rate");
    check("rates down: box says unavailable", await text("conv"), "unavailable");
    await context.close();
  }
  {
    const { search, text, context } = await open(browser, { api: { offline: true } });
    await search("Tokyo");
    check("offline message", await text("status"), "Check your internet connection");
    await context.close();
  }
  {
    const { search, text, context } = await open(browser, { api: { slowWeather: true } });
    const started = Date.now();
    await search("Tokyo");
    check("slow weather gives up after ~10 s", Date.now() - started < 13000, true);
    check("slow weather: rest still shown", await text("currency"), "JPY");
    await context.close();
  }

  // --- Every weather code has a picture and a label ---
  {
    const { page, context } = await open(browser);
    const missing = await page.evaluate(() =>
      [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]
        .filter((c) => !weatherVisual(c, 1).svg || !weatherVisual(c, 1).label));
    check("all weather codes have pictures", JSON.stringify(missing), "[]");
    await context.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})();
