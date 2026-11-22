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

function setStatus(message, isError = false) {
  const el = $("status");
  el.textContent = message;
  el.classList.toggle("error", isError);
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

// Accepts "City" or "City, Country/Region" (e.g. "Paris, Texas" or "Paris, FR").
function parseQuery(text) {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  return { name: parts[0] || "", qualifier: parts.slice(1).join(" ").toLowerCase() };
}

function matchesQualifier(place, q) {
  const fields = [place.country, place.country_code, place.admin1, place.admin2]
    .filter(Boolean)
    .map((f) => f.toLowerCase());
  return fields.some((f) => f === q || f.startsWith(q));
}

async function findCity(text) {
  const { name, qualifier } = parseQuery(text);
  if (!name) throw new Error("Please type a city name.");
  const url = `${GEO_URL}?name=${encodeURIComponent(name)}&count=10&language=en&format=json`;
  const data = await getJSON(url);
  const places = data.results || [];
  if (!places.length) throw new Error(`No city called "${name}" was found.`);
  if (!qualifier) return places[0];
  const match = places.find((p) => matchesQualifier(p, qualifier));
  if (!match) throw new Error(`No "${name}" was found in "${text.split(",").slice(1).join(",").trim()}".`);
  return match;
}

async function getWeather(place) {
  const url = `${WEATHER_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code,is_day&timezone=auto`;
  const data = await getJSON(url);
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

const toF = (c) => (c * 9 / 5 + 32).toFixed(1);

async function getChfRate(currency) {
  if (currency === "CHF") return 1;
  const data = await getJSON(`${RATES_URL}/${encodeURIComponent(currency)}`);
  const rate = data && data.result === "success" && data.rates ? data.rates.CHF : undefined;
  if (typeof rate !== "number") throw new Error(`No CHF rate available for ${currency}.`);
  return rate;
}

function currencyName(code) {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) || code;
  } catch {
    return code;
  }
}

function formatRate(rate) {
  const digits = rate >= 10 ? 2 : rate >= 1 ? 4 : rate >= 0.01 ? 4 : 6;
  return rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
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

function startClock(timezone) {
  clearInterval(clockTimer);
  if (!timezone) {
    $("time").textContent = "—";
    $("date").textContent = "";
    $("tz").textContent = "Time zone unknown";
    return;
  }
  $("tz").textContent = timezone.replace(/_/g, " ");
  clockTimer = runClock($("time"), $("date"), timezone,
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function showWeather(w) {
  if (!w || w.tempC === null) {
    $("tempC").textContent = "—";
    $("tempF").textContent = "—";
  } else {
    $("tempC").textContent = w.tempC.toFixed(1);
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

  startClock((weather && weather.timezone) || place.timezone);
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
    const data = await getJSON(`${REVERSE_URL}?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    const city = data.city || data.locality || data.principalSubdivision || "";
    const country = data.countryName || "";
    return [city, country].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}

function showHereWeather(w) {
  const has = (v) => w && v !== null && v !== undefined;
  $("hereTempC").textContent = has(w && w.tempC) ? w.tempC.toFixed(1) : "—";
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

async function loadHere(lat, lon) {
  $("herePlace").textContent = "Loading your weather…";
  const [weatherRes, name] = await Promise.all([
    getWeather({ latitude: lat, longitude: lon }).then((w) => ({ ok: true, w }), () => ({ ok: false })),
    nameForCoords(lat, lon)
  ]);
  if (weatherRes.ok) {
    showHereWeather(weatherRes.w);
    if (weatherRes.w.timezone) startHereClock(weatherRes.w.timezone);
    $("herePlace").textContent = name || "Near you";
  } else {
    $("herePlace").textContent = (name ? name + " · " : "") + "Weather could not be loaded.";
  }
}

function locate() {
  if (!("geolocation" in navigator)) {
    $("herePlace").textContent = "This browser can't share your location. Showing your device time.";
    return;
  }
  $("locate").hidden = true;
  $("herePlace").textContent = "Finding where you are…";
  navigator.geolocation.getCurrentPosition(
    (pos) => loadHere(pos.coords.latitude.toFixed(4), pos.coords.longitude.toFixed(4)),
    (err) => {
      $("herePlace").textContent = err.code === err.PERMISSION_DENIED
        ? "Location is off. Showing your device time only."
        : "Couldn't find your location. Showing your device time only.";
      $("locate").hidden = false;
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 }
  );
}

$("locate").addEventListener("click", locate);
startHereClock(null); // device time right away, even before location is known
showHereWeather(null);
locate();
