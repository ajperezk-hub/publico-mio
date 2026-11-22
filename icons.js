// Weather pictures (inline SVG) keyed by Open-Meteo / WMO weather codes.
// https://open-meteo.com/en/docs (see "WMO Weather interpretation codes")

const SUN = `<circle cx="32" cy="32" r="12" fill="#f2b632"/>
  <g stroke="#f2b632" stroke-width="4" stroke-linecap="round">
    <line x1="32" y1="6" x2="32" y2="13"/><line x1="32" y1="51" x2="32" y2="58"/>
    <line x1="6" y1="32" x2="13" y2="32"/><line x1="51" y1="32" x2="58" y2="32"/>
    <line x1="13.6" y1="13.6" x2="18.5" y2="18.5"/><line x1="45.5" y1="45.5" x2="50.4" y2="50.4"/>
    <line x1="13.6" y1="50.4" x2="18.5" y2="45.5"/><line x1="45.5" y1="18.5" x2="50.4" y2="13.6"/>
  </g>`;
const MOON = `<path d="M40 10a22 22 0 1 0 14 34A18 18 0 0 1 40 10z" fill="#c9ccd1"/>`;
const SMALL_SUN = `<g transform="translate(-3 -5) scale(.7)">${SUN}</g>`;
const SMALL_MOON = `<g transform="translate(-1 -3) scale(.65)">${MOON}</g>`;
const CLOUD = (y = 0, fill = "#c9ccd1", stroke = "#9aa0a8") =>
  `<path transform="translate(0 ${y})" d="M18 46h30a10 10 0 0 0 0-20 14 14 0 0 0-27-3A11 11 0 0 0 18 46z"
    fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`;
const DROPS = (n = 3) => {
  const xs = [22, 32, 42].slice(0, n);
  return `<g stroke="#2f6fd0" stroke-width="3.5" stroke-linecap="round">${xs
    .map((x) => `<line x1="${x}" y1="46" x2="${x - 3}" y2="56"/>`).join("")}</g>`;
};
const FLAKES = `<g fill="#2f6fd0">${[22, 32, 42]
  .map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 56 : 52}" r="2.8"/>`).join("")}</g>`;
const BOLT = `<path d="M34 42l-8 12h7l-3 9 10-14h-7l4-7z" fill="#f2b632" stroke="#c4161c" stroke-width="1.5" stroke-linejoin="round"/>`;
const FOG = `<g stroke="#9aa0a8" stroke-width="4" stroke-linecap="round">
    <line x1="12" y1="50" x2="52" y2="50"/><line x1="16" y1="57" x2="46" y2="57"/>
  </g>`;

const svg = (inner) =>
  `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">${inner}</svg>`;

// Returns { label, svg } for a WMO code. isDay = 1 (day) or 0 (night).
function weatherVisual(code, isDay = 1) {
  const day = isDay !== 0;
  const c = Number(code);
  if (c === 0) return { label: day ? "Clear sky" : "Clear night", svg: svg(day ? SUN : MOON) };
  if (c === 1) return { label: "Mainly clear", svg: svg(day ? SUN : MOON) };
  if (c === 2) return { label: "Partly cloudy", svg: svg((day ? SMALL_SUN : SMALL_MOON) + CLOUD(8)) };
  if (c === 3) return { label: "Overcast", svg: svg(CLOUD(-4)) };
  if (c === 45 || c === 48) return { label: c === 48 ? "Freezing fog" : "Fog", svg: svg(CLOUD(-10) + FOG) };
  if (c >= 51 && c <= 57) return { label: c >= 56 ? "Freezing drizzle" : "Drizzle", svg: svg(CLOUD(-8) + DROPS(2)) };
  if (c >= 61 && c <= 67) return { label: c >= 66 ? "Freezing rain" : c === 65 ? "Heavy rain" : "Rain", svg: svg(CLOUD(-8) + DROPS(3)) };
  if (c >= 80 && c <= 82) return { label: "Rain showers", svg: svg((day ? SMALL_SUN : SMALL_MOON) + CLOUD(0) + DROPS(2)) };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { label: c === 77 ? "Snow grains" : c >= 85 ? "Snow showers" : "Snow", svg: svg(CLOUD(-8) + FLAKES) };
  if (c >= 95 && c <= 99) return { label: c >= 96 ? "Thunderstorm with hail" : "Thunderstorm", svg: svg(CLOUD(-10, "#9aa0a8", "#6b7178") + BOLT) };
  return { label: "", svg: "" };
}
