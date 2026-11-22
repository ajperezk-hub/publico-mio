// City Pulse — local time, weather and currency (always with CHF) for a city.
// Data: Open-Meteo (geocoding + weather, no key) and open.er-api.com (exchange rates, no key).

const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const RATES_URL = "https://open.er-api.com/v6/latest";
const REVERSE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";

const $ = (id) => document.getElementById(id);

let clockTimer = null;
let hereClockTimer = null;
let latestSearch = 0; // increases with every search; older answers are ignored
let currentPlace = null; // the destination on screen, for refreshing its weather
let destTimezone = null;
const REFRESH_MS = 15 * 60 * 1000; // weather is refreshed every 15 minutes

const LAST_CITY_KEY = "cityPulse.lastCity";
function saveLastCity(text) { try { localStorage.setItem(LAST_CITY_KEY, text); } catch { /* storage off */ } }
function loadLastCity() { try { return localStorage.getItem(LAST_CITY_KEY) || ""; } catch { return ""; } }

function setStatus(message, isError = false) {
  const el = $("status");
  el.textContent = message;
  el.classList.toggle("error", isError);
}

// Fetches JSON with a time limit and a message people can act on.
async function getJSON(url, what = "the data service", timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new Error(err.name === "AbortError"
      ? `${what} took too long to answer. Please try again.`
      : `Couldn't reach ${what}. Check your internet connection and try again.`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`${what} is not available right now (error ${res.status}). Please try again later.`);
  return res.json();
}

const fold = (text) => String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// Common ways people write a country that differ from its official name.
const COUNTRY_ALIASES = {
  uk: "gb", "great britain": "gb", britain: "gb", england: "gb", scotland: "gb", wales: "gb",
  usa: "us", "u.s.": "us", "u.s.a.": "us", america: "us", "united states of america": "us",
  uae: "ae", emirates: "ae", holland: "nl", "the netherlands": "nl",
  "south korea": "kr", korea: "kr", "north korea": "kp", russia: "ru", "czech republic": "cz",
  czechia: "cz", "ivory coast": "ci", turkey: "tr", turkiye: "tr", vietnam: "vn",
  schweiz: "ch", suisse: "ch", svizzera: "ch", deutschland: "de", espana: "es", italia: "it"
};

// Accepts "City" or "City, Country/Region" (e.g. "Paris, Texas" or "Paris, FR").
function parseQuery(text) {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  return { name: parts[0] || "", qualifierText: parts.slice(1).join(", "), qualifier: fold(parts.slice(1).join(" ")) };
}

// US state and Canadian province abbreviations ("Paris, TX", "London, ON").
const REGION_CODES = {
  us: { al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado",
    ct: "connecticut", de: "delaware", dc: "district of columbia", fl: "florida", ga: "georgia", hi: "hawaii",
    id: "idaho", il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana",
    me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
    mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey",
    nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma",
    or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina", sd: "south dakota",
    tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
    wv: "west virginia", wi: "wisconsin", wy: "wyoming" },
  ca: { ab: "alberta", bc: "british columbia", mb: "manitoba", nb: "new brunswick",
    nl: "newfoundland and labrador", ns: "nova scotia", nt: "northwest territories", nu: "nunavut",
    on: "ontario", pe: "prince edward island", qc: "quebec", sk: "saskatchewan", yt: "yukon" }
};

function matchesQualifier(place, q) {
  const code = (place.country_code || "").toLowerCase();
  if (COUNTRY_ALIASES[q] && COUNTRY_ALIASES[q] === code) return true;
  if (q.length === 2) {
    const region = REGION_CODES[code] && REGION_CODES[code][q];
    return code === q || (region && fold(place.admin1 || "") === region);
  }
  const fields = [place.country, place.admin1, place.admin2, place.admin3].filter(Boolean).map(fold);
  return fields.some((f) => f === q || f.startsWith(q));
}

async function findCity(text) {
  const { name, qualifier, qualifierText } = parseQuery(text);
  if (!name) throw new Error("Please type a city name.");
  const url = `${GEO_URL}?name=${encodeURIComponent(name)}&count=20&language=en&format=json`;
  const data = await getJSON(url, "the city search service");
  const places = data.results || [];
  if (!places.length) throw new Error(`No city called "${name}" was found.`);
  if (!qualifier) return places[0];
  const match = places.find((p) => matchesQualifier(p, qualifier));
  if (!match) throw new Error(`No "${name}" was found in "${qualifierText}". Try just "${name}", or a different country or region.`);
  return match;
}

async function getWeather(place) {
  const url = `${WEATHER_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code,is_day&timezone=auto`;
  const data = await getJSON(url, "the weather service");
  const cur = data.current || {};
  const num = (v) => (typeof v === "number" ? v : null);
  return {
    tempC: num(cur.temperature_2m),
    humidity: num(cur.relative_humidity_2m),
    code: num(cur.weather_code),
    isDay: num(cur.is_day),
    timezone: data.timezone || place.timezone || null
  };
}

// One decimal, without showing "-0.0".
const oneDecimal = (n) => { const t = n.toFixed(1); return t === "-0.0" ? "0.0" : t; };
const toF = (c) => oneDecimal(c * 9 / 5 + 32);

// Rates change once a day, so keep each one for an hour instead of asking every search.
const rateCache = new Map();
const RATE_TTL_MS = 60 * 60 * 1000;

async function getChfRate(currency) {
  if (currency === "CHF") return 1;
  const cached = rateCache.get(currency);
  if (cached && Date.now() - cached.at < RATE_TTL_MS) return cached.rate;
  const data = await getJSON(`${RATES_URL}/${encodeURIComponent(currency)}`, "the exchange-rate service");
  const rate = data && data.result === "success" && data.rates ? data.rates.CHF : undefined;
  if (typeof rate !== "number" || !(rate > 0)) throw new Error(`No CHF rate available for ${currency}.`);
  rateCache.set(currency, { rate, at: Date.now() });
  return rate;
}

function currencyName(code) {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) || code;
  } catch {
    return code;
  }
}

// Big rates get 2 decimals (184.77); small ones keep 4 meaningful digits (0.005412, 0.00003126).
function formatRate(rate) {
  if (rate >= 10) return rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (rate >= 1) return rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return rate.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

// Starts a ticking clock in the given elements; returns the timer id.
function runClock(timeEl, dateEl, timezone, dateStyle) {
  const opts = timezone ? { timeZone: timezone } : {};
  const timeFmt = new Intl.DateTimeFormat("en-GB", { ...opts, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateFmt = new Intl.DateTimeFormat("en-GB", { ...opts, ...dateStyle });
  const tick = () => {
    const now = new Date();
    timeEl.textContent = timeFmt.format(now);
    if (dateEl) dateEl.textContent = dateFmt.format(now);
  };
  tick();
  return setInterval(tick, 1000);
}

// Minutes a time zone is ahead of UTC right now (handles daylight saving).
function utcOffsetMinutes(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(date).reduce((acc, p) => ({ ...acc, [p.type]: Number(p.value) }), {});
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

let hereTimezone = null; // set once your location is known; otherwise the device's zone

function timeDifferenceText(timezone) {
  const mine = hereTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const diff = utcOffsetMinutes(timezone) - utcOffsetMinutes(mine);
    if (diff === 0) return "Same time as you";
    const h = Math.floor(Math.abs(diff) / 60), m = Math.abs(diff) % 60;
    const amount = m ? `${h} h ${m} min` : `${h} h`;
    return `${amount} ${diff > 0 ? "ahead of" : "behind"} you`;
  } catch {
    return "";
  }
}

function startClock(timezone) {
  clearInterval(clockTimer);
  if (!timezone) {
    $("time").textContent = "—";
    $("date").textContent = "";
    $("tz").textContent = "Time zone unknown";
    $("tzDiff").textContent = "";
    return;
  }
  $("tz").textContent = timezone.replace(/_/g, " ");
  $("tzDiff").textContent = timeDifferenceText(timezone);
  clockTimer = runClock($("time"), $("date"), timezone,
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function showWeather(w) {
  if (!w || w.tempC === null) {
    $("tempC").textContent = "—";
    $("tempF").textContent = "—";
  } else {
    $("tempC").textContent = oneDecimal(w.tempC);
    $("tempF").textContent = toF(w.tempC);
  }
  const visual = w && w.code !== null ? weatherVisual(w.code, w.isDay) : { label: "", svg: "" };
  $("wxIcon").innerHTML = visual.svg;
  $("wxLabel").textContent = visual.label;
  if (!w || w.humidity === null) {
    $("humidity").textContent = "—";
    $("humBar").style.width = "0";
  } else {
    $("humidity").textContent = Math.round(w.humidity);
    $("humBar").style.width = `${Math.max(0, Math.min(100, w.humidity))}%`;
  }
}

function showCurrency(currency, chfRate) {
  if (!currency) {
    $("currency").textContent = "—";
    $("currencyName").textContent = "Currency unknown for this country";
    $("chf").textContent = "";
    return;
  }
  $("currency").textContent = currency;
  $("currencyName").textContent = currencyName(currency);
  if (currency === "CHF") {
    $("chf").textContent = "This city already uses Swiss francs\n1 CHF = 1 CHF";
  } else if (typeof chfRate === "number") {
    $("chf").textContent = `1 ${currency} = ${formatRate(chfRate)} CHF\n` +
      `1 CHF = ${formatRate(1 / chfRate)} ${currency}`;
  } else {
    $("chf").textContent = "CHF rate unavailable right now";
  }
}

async function search(text) {
  const id = ++latestSearch;
  setStatus("Searching…");

  const place = await findCity(text);
  if (id !== latestSearch) return;

  const currency = COUNTRY_CURRENCY[(place.country_code || "").toUpperCase()] || null;
  const [weatherRes, rateRes] = await Promise.allSettled([
    getWeather(place),
    currency ? getChfRate(currency) : Promise.resolve(null)
  ]);
  if (id !== latestSearch) return;

  const weather = weatherRes.status === "fulfilled" ? weatherRes.value : null;
  const rate = rateRes.status === "fulfilled" ? rateRes.value : null;

  $("cityName").textContent = place.name;
  const region = place.admin1 && place.admin1 !== place.name ? `${place.admin1}, ` : "";
  $("country").textContent = `${region}${place.country || place.country_code || "Unknown country"}`;

  currentPlace = place;
  destTimezone = (weather && weather.timezone) || place.timezone;
  saveLastCity(text);
  startClock(destTimezone);
  showWeather(weather);
  showCurrency(currency, rate);
  $("result").hidden = false;

  const problems = [];
  if (weatherRes.status === "rejected") problems.push("weather");
  if (rateRes.status === "rejected") problems.push("exchange rate");
  setStatus(problems.length ? `Some data could not be loaded: ${problems.join(" and ")}.` : "",
    problems.length > 0);
}

$("search").addEventListener("submit", async (event) => {
  event.preventDefault();
  const city = $("city").value.trim();
  if (!city) return;
  const button = $("go");
  button.disabled = true;
  const searchId = latestSearch + 1; // the id search() is about to take
  try {
    await search(city);
  } catch (err) {
    // Only report errors from the most recent search.
    if (searchId === latestSearch) {
      setStatus(err.message || "Something went wrong. Please try again.", true);
    }
  } finally {
    if (searchId === latestSearch) button.disabled = false;
  }
});

// ---- Your location -------------------------------------------------------

async function nameForCoords(lat, lon) {
  try {
    const data = await getJSON(`${REVERSE_URL}?latitude=${lat}&longitude=${lon}&localityLanguage=en`, "the area-name service");
    const city = data.city || data.locality || data.principalSubdivision || "";
    const country = data.countryName || "";
    return [city, country].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}

function showHereWeather(w) {
  const has = (v) => w && v !== null && v !== undefined;
  $("hereTempC").textContent = has(w && w.tempC) ? oneDecimal(w.tempC) : "—";
  $("hereTempF").textContent = has(w && w.tempC) ? toF(w.tempC) : "—";
  $("hereHum").textContent = has(w && w.humidity) ? Math.round(w.humidity) : "—";
  const visual = has(w && w.code) ? weatherVisual(w.code, w.isDay) : { label: "", svg: "" };
  $("hereIcon").innerHTML = visual.svg;
  $("hereCond").textContent = visual.label;
}

function startHereClock(timezone) {
  clearInterval(hereClockTimer);
  hereClockTimer = runClock($("hereTime"), $("hereDate"), timezone,
    { weekday: "short", day: "numeric", month: "short" });
}

let hereCoords = null;

async function loadHere(lat, lon) {
  hereCoords = { lat, lon };
  $("locate").hidden = true;
  $("herePlace").textContent = "Loading your weather…";
  const [weatherRes, name] = await Promise.all([
    getWeather({ latitude: lat, longitude: lon }).then((w) => ({ ok: true, w }), () => ({ ok: false })),
    nameForCoords(lat, lon)
  ]);
  if (weatherRes.ok) {
    showHereWeather(weatherRes.w);
    if (weatherRes.w.timezone) {
      hereTimezone = weatherRes.w.timezone;
      startHereClock(hereTimezone);
      if (destTimezone) $("tzDiff").textContent = timeDifferenceText(destTimezone);
    }
    $("herePlace").textContent = name || "Near you";
  } else {
    $("herePlace").textContent = (name ? name + " · " : "") + "Weather could not be loaded.";
    $("locate").textContent = "Try again";
    $("locate").hidden = false;
  }
}

// Quietly refresh both weather panels so a page left open stays current.
async function refreshWeather() {
  if (hereCoords) loadHere(hereCoords.lat, hereCoords.lon);
  if (currentPlace) {
    const place = currentPlace;
    try {
      const w = await getWeather(place);
      if (place === currentPlace) showWeather(w);
    } catch { /* keep what is on screen; the next refresh will try again */ }
  }
}
let lastRefresh = Date.now();
setInterval(() => { refreshWeather(); lastRefresh = Date.now(); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  // Phones pause timers in the background, so catch up when the page is shown again.
  if (document.visibilityState === "visible" && Date.now() - lastRefresh > REFRESH_MS) {
    lastRefresh = Date.now();
    refreshWeather();
  }
});

function locate() {
  if (!("geolocation" in navigator)) {
    $("herePlace").textContent = "This browser can't share your location. Showing your device time.";
    return;
  }
  $("locate").hidden = true;
  $("herePlace").textContent = "Finding where you are…";
  navigator.geolocation.getCurrentPosition(
    // Rounded to about 1 km: enough for weather, and more private.
    (pos) => loadHere(pos.coords.latitude.toFixed(2), pos.coords.longitude.toFixed(2)),
    (err) => {
      $("herePlace").textContent = err.code === err.PERMISSION_DENIED
        ? "Location is off. Showing your device time only."
        : "Couldn't find your location. Showing your device time only.";
      $("locate").textContent = "Use my location";
      $("locate").hidden = false;
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 }
  );
}

$("locate").addEventListener("click", locate);
startHereClock(null); // device time right away, even before location is known
showHereWeather(null);
locate();

// Show the last city searched, if there is one.
const lastCity = loadLastCity();
if (lastCity) {
  $("city").value = lastCity;
  $("search").requestSubmit();
}
