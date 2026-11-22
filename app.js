// City Pulse: time, weather and currency for any city, and the same for where you are.
// Data (no keys needed): Open-Meteo for city search and weather, ExchangeRate-API for
// exchange rates, BigDataCloud for the name and country of your location.
// Lookup tables (COUNTRY_CURRENCY, COUNTRY_ALIASES, REGION_CODES) are in data.js,
// weather pictures (weatherVisual) in icons.js.

const API = {
  search: "https://geocoding-api.open-meteo.com/v1/search",
  weather: "https://api.open-meteo.com/v1/forecast",
  rates: "https://open.er-api.com/v6/latest",
  place: "https://api.bigdatacloud.net/data/reverse-geocode-client"
};
const TIMEOUT_MS = 10 * 1000;
const RATES_TTL_MS = 60 * 60 * 1000;   // rates change once a day; keep them an hour
const REFRESH_MS = 15 * 60 * 1000;     // refresh weather while the page is open
const FALLBACK_CURRENCY = "CHF";
const LAST_CITY_KEY = "cityPulse.lastCity";

const $ = (id) => document.getElementById(id);

const state = {
  dest: null,          // the city on screen: { place, timezone, currency }
  here: {              // you
    coords: null,      // { lat, lon }, rounded to about 1 km
    timezone: null,    // null until known: the device's own zone is used
    currency: currencyFromDeviceRegion() || FALLBACK_CURRENCY
  },
  searchId: 0,         // only the newest search may update the screen
  lastRefresh: Date.now()
};

// ---- Fetching ---------------------------------------------------------------

// JSON with a time limit, and errors that say what to do.
async function fetchJSON(url, service) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${service} is not available right now (error ${res.status}). Please try again later.`);
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`${service} took too long to answer. Please try again.`);
    if (err instanceof TypeError) throw new Error(`Couldn't reach ${service}. Check your internet connection and try again.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const fold = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Does a search result match what was typed after the comma ("UK", "TX", "Texas", "ile")?
function matchesQualifier(place, q) {
  const country = (place.country_code || "").toLowerCase();
  if (COUNTRY_ALIASES[q] === country) return true;
  if (q.length === 2) return q === country || REGION_CODES[country]?.[q] === fold(place.admin1);
  return [place.country, place.admin1, place.admin2, place.admin3]
    .some((field) => field && fold(field).startsWith(q));
}

// "City" or "City, Country/Region" -> the best matching place.
async function findCity(text) {
  const [name, ...rest] = text.split(",").map((part) => part.trim());
  const qualifiers = rest.filter(Boolean);
  const qualifierText = qualifiers.join(", ");
  if (!name) throw new Error("Please type a city name.");
  const url = `${API.search}?name=${encodeURIComponent(name)}&count=20&language=en&format=json`;
  const places = (await fetchJSON(url, "The city search service")).results || [];
  if (!places.length) throw new Error(`No city called "${name}" was found.`);
  if (!qualifierText) return places[0];
  const match = places.find((p) => qualifiers.every((q) => matchesQualifier(p, fold(q))));
  if (!match) throw new Error(`No "${name}" was found in "${qualifierText}". Try just "${name}", or a different country or region.`);
  return match;
}

async function getWeather(lat, lon) {
  const url = `${API.weather}?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,relative_humidity_2m,weather_code,is_day&timezone=auto";
  const data = await fetchJSON(url, "The weather service");
  const now = data.current || {};
  return {
    tempC: now.temperature_2m,
    humidity: now.relative_humidity_2m,
    code: now.weather_code,
    isDay: now.is_day,
    timezone: data.timezone || null
  };
}

// One request per base currency returns all its rates; share it for an hour.
const ratesCache = new Map();
function getRates(base) {
  const hit = ratesCache.get(base);
  if (hit && Date.now() - hit.at < RATES_TTL_MS) return hit.promise;
  const promise = fetchJSON(`${API.rates}/${encodeURIComponent(base)}`, "The exchange-rate service")
    .then((data) => {
      if (data.result !== "success" || !data.rates) throw new Error(`No exchange rates for ${base}.`);
      return data.rates;
    });
  promise.catch(() => ratesCache.delete(base)); // don't keep failures
  ratesCache.set(base, { at: Date.now(), promise });
  return promise;
}

// { from, to, rate } where rate is how many `to` one `from` buys (null if unavailable).
async function conversion(from) {
  const to = state.here.currency;
  if (!from) return null;
  if (from === to) return { from, to, rate: 1 };
  try {
    const rate = (await getRates(from))[to];
    return { from, to, rate: rate > 0 ? rate : null };
  } catch {
    return { from, to, rate: null };
  }
}

async function getPlaceName(lat, lon) {
  const url = `${API.place}?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  const data = await fetchJSON(url, "The area-name service");
  return {
    name: [data.city || data.locality || data.principalSubdivision, data.countryName].filter(Boolean).join(", "),
    countryCode: (data.countryCode || "").toUpperCase()
  };
}

// ---- Formatting -------------------------------------------------------------

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const oneDecimal = (n) => (Math.round(n * 10) / 10 || 0).toFixed(1); // "|| 0" turns -0 into 0
const toF = (c) => oneDecimal(c * 9 / 5 + 32);

// 184.77 · 1.2500 · 0.80 · 0.005412 · 0.00003126
function formatRate(rate) {
  if (rate >= 1) return rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: rate >= 10 ? 2 : 4 });
  const text = rate.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  const decimals = (text.split(".")[1] || "").length;
  return decimals >= 2 ? text : (decimals ? text + "0" : text + ".00");
}

function currencyName(code) {
  try { return new Intl.DisplayNames(["en"], { type: "currency" }).of(code); } catch { return code; }
}

function currencyFromDeviceRegion() {
  try {
    for (const tag of navigator.languages || [navigator.language]) {
      const currency = COUNTRY_CURRENCY[new Intl.Locale(tag).maximize().region];
      if (currency) return currency;
    }
  } catch { /* older browser */ }
  return null;
}

// Minutes the zone is ahead of UTC right now (daylight saving included).
function utcOffset(timezone, date = new Date()) {
  const p = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric"
  }).formatToParts(date).forEach(({ type, value }) => { p[type] = Number(value); });
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((local - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

function timeDifference(timezone) {
  try {
    const mine = state.here.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const diff = utcOffset(timezone) - utcOffset(mine);
    if (diff === 0) return "Same time as you";
    const h = Math.floor(Math.abs(diff) / 60), m = Math.abs(diff) % 60;
    return `${m ? `${h} h ${m} min` : `${h} h`} ${diff > 0 ? "ahead of" : "behind"} you`;
  } catch {
    return "";
  }
}

// ---- Showing things ---------------------------------------------------------

function setStatus(message, isError = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", isError);
}

// A ticking clock; `timezone` null means the device's own zone.
const clocks = {};
function startClock(name, timezone, dateOptions) {
  clearInterval(clocks[name]);
  const zone = timezone ? { timeZone: timezone } : {};
  const time = new Intl.DateTimeFormat("en-GB", { ...zone, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = new Intl.DateTimeFormat("en-GB", { ...zone, ...dateOptions });
  const tick = () => {
    const now = new Date();
    $(`${name}Time`).textContent = time.format(now);
    $(`${name}Date`).textContent = date.format(now);
  };
  tick();
  clocks[name] = setInterval(tick, 1000);
}

// Fills one weather panel. Element ids are `${name}TempC`, `${name}TempF`, `${name}Hum`,
// `${name}Icon`, `${name}Cond` and optionally `${name}HumBar`.
function showWeather(name, w) {
  const temp = isNum(w?.tempC), hum = isNum(w?.humidity);
  const visual = isNum(w?.code) ? weatherVisual(w.code, w.isDay) : { label: "", svg: "" };
  $(`${name}TempC`).textContent = temp ? oneDecimal(w.tempC) : "—";
  $(`${name}TempF`).textContent = temp ? toF(w.tempC) : "—";
  $(`${name}Hum`).textContent = hum ? Math.round(w.humidity) : "—";
  $(`${name}Icon`).innerHTML = visual.svg;
  $(`${name}Cond`).textContent = visual.label;
  const bar = $(`${name}HumBar`);
  if (bar) bar.style.width = hum ? `${Math.min(100, Math.max(0, w.humidity))}%` : "0";
}

function showConversion(conv) {
  $("convLabel").textContent = conv ? `In your currency (${conv.to})` : "";
  if (!conv) $("conv").textContent = "";
  else if (conv.from === conv.to) $("conv").textContent = `Same currency as you\n1 ${conv.from} = 1 ${conv.to}`;
  else if (conv.rate) $("conv").textContent =
    `1 ${conv.from} = ${formatRate(conv.rate)} ${conv.to}\n1 ${conv.to} = ${formatRate(1 / conv.rate)} ${conv.from}`;
  else $("conv").textContent = `${conv.to} rate unavailable right now`;
}

function showDestination({ place, timezone, currency }, weather, conv) {
  $("cityName").textContent = place.name;
  const region = place.admin1 && place.admin1 !== place.name ? `${place.admin1}, ` : "";
  $("country").textContent = region + (place.country || place.country_code || "Unknown country");

  if (timezone) {
    startClock("dest", timezone, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    $("tz").textContent = timezone.replace(/_/g, " ");
  } else {
    clearInterval(clocks.dest);
    $("destTime").textContent = "—";
    $("destDate").textContent = "";
    $("tz").textContent = "Time zone unknown";
  }
  $("tzDiff").textContent = timezone ? timeDifference(timezone) : "";

  showWeather("dest", weather);
  $("currency").textContent = currency || "—";
  $("currencyName").textContent = currency ? currencyName(currency) : "Currency unknown for this country";
  showConversion(conv);
  $("result").hidden = false;
}

// ---- Searching a city ---------------------------------------------------------

async function search(text) {
  const id = ++state.searchId;
  const isCurrent = () => id === state.searchId;
  $("go").disabled = true;
  setStatus("Searching…");
  try {
    const place = await findCity(text);
    if (!isCurrent()) return;
    const currency = COUNTRY_CURRENCY[(place.country_code || "").toUpperCase()] || null;
    const [weather, conv] = await Promise.all([
      getWeather(place.latitude, place.longitude).catch(() => null),
      conversion(currency)
    ]);
    if (!isCurrent()) return;

    state.dest = { place, currency, timezone: weather?.timezone || place.timezone || null };
    showDestination(state.dest, weather, conv);
    if (conv && conv.to !== state.here.currency) refreshConversion(); // your currency changed meanwhile
    try { localStorage.setItem(LAST_CITY_KEY, text); } catch { /* storage off */ }

    const missing = [!weather && "weather", conv && !conv.rate && "exchange rate"].filter(Boolean);
    setStatus(missing.length ? `Some data could not be loaded: ${missing.join(" and ")}.` : "", missing.length > 0);
  } catch (err) {
    if (isCurrent()) setStatus(err.message || "Something went wrong. Please try again.", true);
  } finally {
    if (isCurrent()) $("go").disabled = false;
  }
}

async function refreshConversion() {
  const dest = state.dest;
  if (!dest) return;
  const conv = await conversion(dest.currency);
  if (dest === state.dest && (!conv || conv.to === state.here.currency)) showConversion(conv);
}

$("search").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("city").value.trim();
  if (text) search(text);
});

// ---- Your location --------------------------------------------------------------

function locate() {
  $("locate").hidden = true;
  if (!navigator.geolocation) {
    $("herePlace").textContent = "This browser can't share your location. Showing your device time.";
    return;
  }
  $("herePlace").textContent = "Finding where you are…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      // Rounded to about 1 km: enough for weather, and more private.
      state.here.coords = { lat: pos.coords.latitude.toFixed(2), lon: pos.coords.longitude.toFixed(2) };
      loadHere();
    },
    (err) => {
      $("herePlace").textContent = err.code === err.PERMISSION_DENIED
        ? "Location is off. Showing your device time only."
        : "Couldn't find your location. Showing your device time only.";
      offerRetry("Use my location");
    },
    { timeout: 15000, maximumAge: 10 * 60 * 1000 }
  );
}

function offerRetry(label) {
  $("locate").textContent = label;
  $("locate").hidden = false;
}

// `quiet` (used by the regular refresh) keeps what's on screen if something fails.
async function loadHere(quiet = false) {
  const { lat, lon } = state.here.coords;
  if (!quiet) $("herePlace").textContent = "Loading your weather…";
  const [weather, where] = await Promise.all([
    getWeather(lat, lon).catch(() => null),
    getPlaceName(lat, lon).catch(() => ({}))
  ]);

  const currency = COUNTRY_CURRENCY[where.countryCode];
  if (currency && currency !== state.here.currency) {
    state.here.currency = currency;
    refreshConversion();
  }

  if (weather) {
    showWeather("here", weather);
    $("herePlace").textContent = where.name || "Near you";
    if (weather.timezone && weather.timezone !== state.here.timezone) {
      state.here.timezone = weather.timezone;
      startClock("here", weather.timezone, { weekday: "short", day: "numeric", month: "short" });
      if (state.dest?.timezone) $("tzDiff").textContent = timeDifference(state.dest.timezone);
    }
  } else if (!quiet) {
    $("herePlace").textContent = (where.name ? `${where.name} · ` : "") + "Weather could not be loaded.";
    offerRetry("Try again");
  }
}

$("locate").addEventListener("click", locate);

// ---- Keeping it fresh ---------------------------------------------------------

async function refresh() {
  state.lastRefresh = Date.now();
  if (state.here.coords) loadHere(true);
  const dest = state.dest;
  if (dest) {
    const weather = await getWeather(dest.place.latitude, dest.place.longitude).catch(() => null);
    if (weather && dest === state.dest) showWeather("dest", weather);
  }
}

setInterval(refresh, REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  // Phones pause timers in the background, so catch up when the page is shown again.
  if (document.visibilityState === "visible" && Date.now() - state.lastRefresh > REFRESH_MS) refresh();
});

// ---- Start ------------------------------------------------------------------------

startClock("here", null, { weekday: "short", day: "numeric", month: "short" }); // device time until located
showWeather("here", null);
locate();

let lastCity = "";
try { lastCity = localStorage.getItem(LAST_CITY_KEY) || ""; } catch { /* storage off */ }
if (lastCity) {
  $("city").value = lastCity;
  search(lastCity);
}
