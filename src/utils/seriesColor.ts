// A business's brand color, stepped so it works as a chart mark on the current surface.
//
// Brand colors are picked for logos, not charts: several are dark and low-chroma, so on a
// dark card they disappear (under 3:1) and on a light one some read as gray. Each money chart
// plots one business, so the brand hue is kept and only its lightness and chroma move, into
// the dataviz band for the mode (OKLCH L 0.43–0.77 light, 0.48–0.67 dark; chroma ≥ 0.10)
// and to ≥ 3:1 WCAG contrast against the card. Dark mode gets its own step of the same hue,
// not an inverted color. Checked, not eyeballed: every brand color in the registry, on every
// theme's light and dark card, passes the dataviz validator's band, chroma and contrast checks.

type Rgb = [number, number, number];

const BAND = { light: [0.43, 0.77], dark: [0.48, 0.67] } as const;
const CHROMA_FLOOR = 0.1;
const CONTRAST_MIN = 3;

function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as Rgb;
}

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklch([r, g, b]: Rgb): [number, number, number] {
  const [lr, lg, lb] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), Math.atan2(bb, a)];
}

// OKLCH -> sRGB (0..1), or null when outside the sRGB gamut.
function oklchToRgb(L: number, C: number, h: number): Rgb | null {
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (lin.some((v) => v < -1e-4 || v > 1 + 1e-4)) return null;
  return lin.map((v) => Math.min(1, Math.max(0, fromLin(v)))) as Rgb;
}

const rgbToHex = (rgb: Rgb) => '#' + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

export function contrastRatio(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return 1;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

// The most chroma (up to the floor or the brand's own, whichever is higher) that fits sRGB at L.
function fitChroma(L: number, want: number, h: number): Rgb | null {
  let c = want;
  for (; c >= 0; c -= 0.005) {
    const rgb = oklchToRgb(L, c, h);
    if (rgb) return rgb;
  }
  return null;
}

const cache = new Map<string, string>();

// `fallback` (the theme's chart color) is used when there is no usable brand color.
export function seriesColor(brand: string | null | undefined, surface: string, mode: 'light' | 'dark', fallback: string): string {
  const key = `${brand}|${surface}|${mode}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rgb = brand ? hexToRgb(brand) : null;
  if (!rgb || !hexToRgb(surface)) return fallback;
  const [L0, C0, h] = rgbToOklch(rgb);
  const want = Math.max(C0, CHROMA_FLOOR);
  const [lo, hi] = BAND[mode];
  // Light surfaces push darker for contrast, dark ones lighter; start from the brand's own L.
  const dir = mode === 'dark' ? 1 : -1;
  let best: string | null = null;
  for (let L = Math.min(hi, Math.max(lo, L0)); L >= lo - 1e-9 && L <= hi + 1e-9; L += 0.01 * dir) {
    const out = fitChroma(L, want, h);
    if (!out) continue;
    const hex = rgbToHex(out);
    best = hex;
    if (contrastRatio(hex, surface) >= CONTRAST_MIN) break;
  }
  const result = best && contrastRatio(best, surface) >= CONTRAST_MIN ? best : fallback;
  cache.set(key, result);
  return result;
}
