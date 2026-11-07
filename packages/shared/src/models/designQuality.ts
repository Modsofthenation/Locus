import {
  canvasHtmlUnchanged,
  looksLikeStudioChangeRequest,
  stripHostStudioChrome,
} from "./gameCanvas.js";
import { looksHostFallbackCanvas } from "./hostFallback.js";

/** Host-side fingerprints of generic AI landing pages the design loop should reject. */

export const MAX_DESIGN_QUALITY_NUDGES = 2;

export const DESIGN_QUALITY_NUDGE =
  "The canvas still looks like a generic AI template. Patch /workspace/index.html: distinctive type and color on :root (--bg, --text, --primary, --line), no purple/indigo/violet or default-blue utilities, hex, rgb, hsl, hwb, lab, lch, oklch, color(), named CSS colors, or gradients, no Inter/Poppins/Montserrat/Geist/Outfit/Instrument/Sora/Urbanist/Syne/Fraunces/Clash Display/Reckless/Canela/Editorial New/Favorit/Neue Haas/PP Neue Montreal/PP Right Grotesk/Graphik/Circular/Lato/Didot/Caslon/Bebas Neue/Comfortaa/Sentinel/Verlag/Idlewild/Calibre/Styrene/Gill Sans/Trajan/Menlo/Warnock/Cascadia/Input Mono/Clash Grotesk/Charter/Miller/Mona/Everett/Spectral/Yeseva/Vulf/Degular/Orbitron/Young Serif/Copperplate/Heebo/Assistant/Oxygen/Alegreya/Electrolize/Indie Flower/Kalam/Staatliches/Cairo/Nanum/Tangerine/K2D/Reenie/Scheherazade/Playfair/Georgia/Arial/system-ui stack (font-family, font: shorthand, --font-sans, or Tailwind font-sans / font-[Inter]), no boilerplate unlock/empower/supercharge copy, no Google Fonts/Tailwind/CDNs, no mouse-tracking/parallax. Keep headlines in document flow. Do not rewrite the whole page if a small patch will do.";

const PURPLE_GRADIENT =
  /(?:linear|radial|conic)-gradient\([^)]*(#(?:667eea|764ba2|6366f1|8b5cf6|a78bfa|a855f7|7c3aed|4f46e5|818cf8)(?:[0-9a-f]{2})?|(?:\bindigo\b|\bviolet\b|\bpurple\b))/i;

const PURPLE_SOLID =
  /#(?:667eea|764ba2|6366f1|8b5cf6|a78bfa|a855f7|7c3aed|4f46e5|818cf8|9333ea|7e22ce)(?:[0-9a-f]{2})?\b/i;

const TAILWIND_PURPLE =
  /(?:bg|text|border|ring|from|to|via|outline|fill|stroke|divide|accent)-(?:indigo|violet|purple|fuchsia)(?:-|\/|\b)/i;

const TAILWIND_BLUE =
  /(?:bg|text|border|ring|from|to|via|outline|fill|stroke|divide|accent)-(?:blue|sky|cyan)(?:-|\/|\b)/i;

const BLUE_SOLID = /#(?:3b82f6|2563eb|0ea5e9|06b6d4|38bdf8|1d4ed8)(?:[0-9a-f]{2})?\b/i;

const CANDY_NAME_GROUP =
  "indigo|rebeccapurple|blueviolet|mediumpurple|slateblue|mediumslateblue|purple|violet|fuchsia|magenta|darkviolet|darkmagenta|darkorchid|darkslateblue|mediumblue|royalblue|dodgerblue|blue";

/** CSS keyword navy/darkblue, not kit tokens (`--navy-600`, `var(--navy-600)`). */
const NAVY_KEYWORD_GROUP = "navy|darkblue|midnightblue";

const NAMED_CANDY_GROUP = `${CANDY_NAME_GROUP}|${NAVY_KEYWORD_GROUP}`;

const COLOR_PROPERTY =
  "(?:--[a-z0-9-]+|(?:background|border|outline|fill|stroke|accent|caret|text-decoration|column-rule|stop|flood|lighting|box-shadow|text-shadow|filter|scrollbar|color)(?:-[a-z]+)*)";

/** Named candy in color-bearing CSS declarations, not prose (`Note: indigo`) or type (`font-family: "Indigo Antique"`). */
const CSS_CANDY_NAME = new RegExp(
  `${COLOR_PROPERTY}\\s*:[^;{}]*\\b(?:${CANDY_NAME_GROUP})\\b`,
  "i",
);

/** Keyword navy as a color value, not a hyphenated custom-property name. */
const CSS_NAVY_KEYWORD = new RegExp(
  `${COLOR_PROPERTY}\\s*:[^;{}]*(?<![-])\\b(?:${NAVY_KEYWORD_GROUP})\\b(?![-])`,
  "i",
);

/** Tailwind arbitrary named candy: bg-[indigo], text-[rebeccapurple], bg-[navy]. */
const TAILWIND_CANDY_NAME = new RegExp(
  `(?:bg|text|border|ring|from|to|via|outline|fill|stroke|divide|accent|shadow|decoration|caret)-\\[(?:${NAMED_CANDY_GROUP})\\]`,
  "i",
);

/** SVG/HTML presentational named candy: fill="indigo", fill="navy". */
const SVG_CANDY_NAME = new RegExp(
  `\\b(?:fill|stroke|flood-color|stop-color|lighting-color|color)\\s*=\\s*["']?(?:${NAMED_CANDY_GROUP})\\b`,
  "i",
);

/** Hex candy as [r,g,b] so rgb()/hsl() encodings of the same swatches still fail. */
const CANDY_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [0x66, 0x7e, 0xea],
  [0x76, 0x4b, 0xa2],
  [0x63, 0x66, 0xf1],
  [0x8b, 0x5c, 0xf6],
  [0xa7, 0x8b, 0xfa],
  [0xa8, 0x55, 0xf7],
  [0x7c, 0x3a, 0xed],
  [0x4f, 0x46, 0xe5],
  [0x81, 0x8c, 0xf8],
  [0x93, 0x33, 0xea],
  [0x7e, 0x22, 0xce],
  [0x3b, 0x82, 0xf6],
  [0x25, 0x63, 0xeb],
  [0x0e, 0xa5, 0xe9],
  [0x06, 0xb6, 0xd4],
  [0x38, 0xbd, 0xf8],
  [0x1d, 0x4e, 0xd8],
];

function nearCandyRgb(r: number, g: number, b: number): boolean {
  return CANDY_RGB.some(
    ([cr, cg, cb]) => Math.abs(r - cr) <= 3 && Math.abs(g - cg) <= 3 && Math.abs(b - cb) <= 3,
  );
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360;
  if (s <= 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, hh + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hh) * 255),
    Math.round(hue2rgb(p, q, hh - 1 / 3) * 255),
  ];
}

function cssHueDegrees(value: number, unit?: string): number {
  const u = (unit ?? "").toLowerCase();
  if (u === "turn") return value * 360;
  if (u === "rad") return (value * 180) / Math.PI;
  if (u === "grad") return value * 0.9;
  return value;
}

function hwbToRgb(h: number, w: number, b: number): [number, number, number] {
  if (w + b >= 1) {
    const gray = Math.round((w / (w + b)) * 255);
    return [gray, gray, gray];
  }
  const [r, g, bl] = hslToRgb(h, 1, 0.5);
  const factor = 1 - w - b;
  return [
    Math.round(r * factor + w * 255),
    Math.round(g * factor + w * 255),
    Math.round(bl * factor + w * 255),
  ];
}

function polarHue(a: number, b: number): { chroma: number; hue: number } {
  const chroma = Math.hypot(a, b);
  let hue = (Math.atan2(b, a) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { chroma, hue };
}

function looksCandyOklch(lightness: number, chroma: number, hue: number): boolean {
  let l = lightness;
  if (l > 1) l /= 100;
  return l >= 0.38 && l <= 0.78 && chroma >= 0.14 && hue >= 250 && hue <= 310;
}

function looksCandyCieLch(lightness: number, chroma: number, hue: number): boolean {
  let l = lightness;
  if (l <= 1) l *= 100;
  return l >= 38 && l <= 78 && chroma >= 40 && hue >= 250 && hue <= 310;
}

function cssColorChannel(value: number, percent: string): number {
  if (percent === "%") return value / 100;
  if (value > 1) return value / 255;
  return value;
}

/** `rgb()` numbers are 0–255; percentages are 0%–100%. */
function rgbCssChannel(value: number, percent: string): number {
  if (percent === "%") return Math.round((value / 100) * 255);
  return Math.round(value);
}

function srgbDecode(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function srgbEncode(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}

function toRgb8(r: number, g: number, b: number): [number, number, number] {
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Linear Display P3 → linear sRGB (D65). */
function p3LinearToSrgbLinear(r: number, g: number, b: number): [number, number, number] {
  return [
    1.224940176 * r - 0.224940176 * g,
    -0.042056955 * r + 1.042056955 * g,
    -0.019637555 * r - 0.078636046 * g + 1.0982736 * b,
  ];
}

function p3EncodedToSrgb8(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = p3LinearToSrgbLinear(srgbDecode(r), srgbDecode(g), srgbDecode(b));
  return toRgb8(srgbEncode(lr), srgbEncode(lg), srgbEncode(lb));
}

/** Rec.2020 encoded → linear (BT.2020 transfer). */
function rec2020Decode(c: number): number {
  const alpha = 1.09929682680944;
  const beta = 0.018053968810711;
  const abs = Math.abs(c);
  const lin = abs < 4.5 * beta ? abs / 4.5 : Math.pow((abs + (alpha - 1)) / alpha, 1 / 0.45);
  return c < 0 ? -lin : lin;
}

/** Linear Rec.2020 → linear sRGB (D65). */
function rec2020LinearToSrgbLinear(r: number, g: number, b: number): [number, number, number] {
  return [
    1.660491002 * r - 0.587641139 * g - 0.072849863 * b,
    -0.124550475 * r + 1.132899897 * g - 0.008349423 * b,
    -0.018150763 * r - 0.100578898 * g + 1.118729661 * b,
  ];
}

function rec2020EncodedToSrgb8(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = rec2020LinearToSrgbLinear(
    rec2020Decode(r),
    rec2020Decode(g),
    rec2020Decode(b),
  );
  return toRgb8(srgbEncode(lr), srgbEncode(lg), srgbEncode(lb));
}

/** Adobe RGB (1998) encoded → linear (gamma 563/256). */
function a98Decode(c: number): number {
  const abs = Math.abs(c);
  const lin = Math.pow(abs, 563 / 256);
  return c < 0 ? -lin : lin;
}

/** Linear a98-rgb → linear sRGB (D65). */
function a98LinearToSrgbLinear(r: number, g: number, b: number): [number, number, number] {
  return [1.398355744 * r - 0.398355744 * g, g, -0.042928989 * g + 1.042928989 * b];
}

function a98EncodedToSrgb8(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = a98LinearToSrgbLinear(a98Decode(r), a98Decode(g), a98Decode(b));
  return toRgb8(srgbEncode(lr), srgbEncode(lg), srgbEncode(lb));
}

/** CIE XYZ D65 → sRGB 8-bit. */
function xyzD65ToSrgb8(x: number, y: number, z: number): [number, number, number] {
  const r = 3.240969942 * x - 1.537383178 * y - 0.49861076 * z;
  const g = -0.969243636 * x + 1.875967502 * y + 0.041555057 * z;
  const b = 0.05563008 * x - 0.203976959 * y + 1.056971514 * z;
  return toRgb8(srgbEncode(r), srgbEncode(g), srgbEncode(b));
}

/** CIE XYZ D50 → sRGB 8-bit (Bradford chromatic adaptation to D65). */
function xyzD50ToSrgb8(x: number, y: number, z: number): [number, number, number] {
  return xyzD65ToSrgb8(
    0.955473453 * x - 0.023098537 * y + 0.063259309 * z,
    -0.028369707 * x + 1.009995543 * y + 0.021397608 * z,
    0.012314002 * x - 0.020507696 * y + 1.330365883 * z,
  );
}

/** ProPhoto RGB encoded → linear (gamma 1.8 with 16/512 linear toe). */
function prophotoDecode(c: number): number {
  const abs = Math.abs(c);
  const lin = abs >= 16 / 512 ? Math.pow(abs, 1.8) : abs / 16;
  return c < 0 ? -lin : lin;
}

/** Linear ProPhoto RGB → linear sRGB (Bradford D50→D65). */
function prophotoLinearToSrgbLinear(r: number, g: number, b: number): [number, number, number] {
  return [
    2.034380799 * r - 0.727636107 * g - 0.307260714 * b,
    -0.228825652 * r + 1.231742787 * g - 0.002361117 * b,
    -0.008558863 * r - 0.153266764 * g + 1.1619488 * b,
  ];
}

function prophotoEncodedToSrgb8(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = prophotoLinearToSrgbLinear(
    prophotoDecode(r),
    prophotoDecode(g),
    prophotoDecode(b),
  );
  return toRgb8(srgbEncode(lr), srgbEncode(lg), srgbEncode(lb));
}

/** rgb()/hsl()/hwb()/oklch()/color(oklch|oklab|lch|lab|hwb|srgb|…) of known candy hexes, or mid-chroma oklch/lch/lab in the indigo/violet band. */
function looksCandyChannel(text: string): boolean {
  for (const match of text.matchAll(
    /rgba?\(\s*([\d.]+)(%?)[\s,/]+([\d.]+)(%?)[\s,/]+([\d.]+)(%?)/gi,
  )) {
    if (
      nearCandyRgb(
        rgbCssChannel(Number(match[1]), match[2] ?? ""),
        rgbCssChannel(Number(match[3]), match[4] ?? ""),
        rgbCssChannel(Number(match[5]), match[6] ?? ""),
      )
    ) {
      return true;
    }
  }
  // Color-4 hsl/hwb S, L, W, B may be numbers 0–100, not only percentages.
  for (const match of text.matchAll(
    /hsla?\(\s*([\d.]+)(deg|turn|rad|grad)?[\s,/]+([\d.]+)(%?)[\s,/]+([\d.]+)(%?)/gi,
  )) {
    const rgb = hslToRgb(
      cssHueDegrees(Number(match[1]), match[2]),
      Number(match[3]) / 100,
      Number(match[5]) / 100,
    );
    if (nearCandyRgb(rgb[0], rgb[1], rgb[2])) return true;
  }
  for (const match of text.matchAll(
    /hwb\(\s*([\d.]+)(deg|turn|rad|grad)?[\s,/]+([\d.]+)(%?)[\s,/]+([\d.]+)(%?)/gi,
  )) {
    const rgb = hwbToRgb(
      cssHueDegrees(Number(match[1]), match[2]),
      Number(match[3]) / 100,
      Number(match[5]) / 100,
    );
    if (nearCandyRgb(rgb[0], rgb[1], rgb[2])) return true;
  }
  for (const match of text.matchAll(
    /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(deg|turn|rad|grad)?/gi,
  )) {
    let lightness = Number(match[1]);
    if (match[2] === "%" || lightness > 1) lightness /= 100;
    if (looksCandyOklch(lightness, Number(match[3]), cssHueDegrees(Number(match[4]), match[5]))) {
      return true;
    }
  }
  for (const match of text.matchAll(/oklab\(\s*([\d.]+)(%?)\s+(-?[\d.]+)\s+(-?[\d.]+)/gi)) {
    let lightness = Number(match[1]);
    if (match[2] === "%") lightness /= 100;
    const polar = polarHue(Number(match[3]), Number(match[4]));
    if (looksCandyOklch(lightness, polar.chroma, polar.hue)) return true;
  }
  for (const match of text.matchAll(
    /\blch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(deg|turn|rad|grad)?/gi,
  )) {
    if (
      looksCandyCieLch(
        Number(match[1]),
        Number(match[3]),
        cssHueDegrees(Number(match[4]), match[5]),
      )
    ) {
      return true;
    }
  }
  for (const match of text.matchAll(/\blab\(\s*([\d.]+)(%?)\s+(-?[\d.]+)\s+(-?[\d.]+)/gi)) {
    const polar = polarHue(Number(match[3]), Number(match[4]));
    if (looksCandyCieLch(Number(match[1]), polar.chroma, polar.hue)) return true;
  }
  for (const match of text.matchAll(
    /color\(\s*oklch[\s,/]+([\d.]+)(%?)[\s,/]+([\d.]+)[\s,/]+([\d.]+)(deg|turn|rad|grad)?/gi,
  )) {
    let lightness = Number(match[1]);
    if (match[2] === "%" || lightness > 1) lightness /= 100;
    if (looksCandyOklch(lightness, Number(match[3]), cssHueDegrees(Number(match[4]), match[5]))) {
      return true;
    }
  }
  for (const match of text.matchAll(
    /color\(\s*oklab[\s,/]+([\d.]+)(%?)[\s,/]+(-?[\d.]+)[\s,/]+(-?[\d.]+)/gi,
  )) {
    let lightness = Number(match[1]);
    if (match[2] === "%") lightness /= 100;
    const polar = polarHue(Number(match[3]), Number(match[4]));
    if (looksCandyOklch(lightness, polar.chroma, polar.hue)) return true;
  }
  for (const match of text.matchAll(
    /color\(\s*lch[\s,/]+([\d.]+)(%?)[\s,/]+([\d.]+)[\s,/]+([\d.]+)(deg|turn|rad|grad)?/gi,
  )) {
    if (
      looksCandyCieLch(
        Number(match[1]),
        Number(match[3]),
        cssHueDegrees(Number(match[4]), match[5]),
      )
    ) {
      return true;
    }
  }
  for (const match of text.matchAll(
    /color\(\s*lab[\s,/]+([\d.]+)(%?)[\s,/]+(-?[\d.]+)[\s,/]+(-?[\d.]+)/gi,
  )) {
    const polar = polarHue(Number(match[3]), Number(match[4]));
    if (looksCandyCieLch(Number(match[1]), polar.chroma, polar.hue)) return true;
  }
  for (const match of text.matchAll(
    /color\(\s*hwb[\s,/]+([\d.]+)(deg|turn|rad|grad)?[\s,/]+([\d.]+)(%?)[\s,/]+([\d.]+)(%?)/gi,
  )) {
    const rgb = hwbToRgb(
      cssHueDegrees(Number(match[1]), match[2]),
      Number(match[3]) / 100,
      Number(match[5]) / 100,
    );
    if (nearCandyRgb(rgb[0], rgb[1], rgb[2])) return true;
  }
  for (const match of text.matchAll(
    /color\(\s*(srgb-linear|srgb|display-p3-linear|display-p3|rec2020|a98-rgb|prophoto-rgb|xyz-d65|xyz-d50|xyz)\s+([\d.]+)(%?)[\s,/]+([\d.]+)(%?)[\s,/]+([\d.]+)(%?)/gi,
  )) {
    const space = match[1]?.toLowerCase();
    if (!space) continue;
    const r = cssColorChannel(Number(match[2]), match[3] ?? "");
    const g = cssColorChannel(Number(match[4]), match[5] ?? "");
    const b = cssColorChannel(Number(match[6]), match[7] ?? "");
    if (space === "srgb") {
      if (nearCandyRgb(...toRgb8(r, g, b))) return true;
    } else if (space === "srgb-linear") {
      if (nearCandyRgb(...toRgb8(srgbEncode(r), srgbEncode(g), srgbEncode(b)))) return true;
    } else if (space === "display-p3") {
      if (nearCandyRgb(...p3EncodedToSrgb8(r, g, b))) return true;
      if (nearCandyRgb(...toRgb8(r, g, b))) return true;
    } else if (space === "display-p3-linear") {
      const [lr, lg, lb] = p3LinearToSrgbLinear(r, g, b);
      if (nearCandyRgb(...toRgb8(srgbEncode(lr), srgbEncode(lg), srgbEncode(lb)))) return true;
    } else if (space === "rec2020") {
      if (nearCandyRgb(...rec2020EncodedToSrgb8(r, g, b))) return true;
      if (nearCandyRgb(...toRgb8(r, g, b))) return true;
    } else if (space === "a98-rgb") {
      if (nearCandyRgb(...a98EncodedToSrgb8(r, g, b))) return true;
      if (nearCandyRgb(...toRgb8(r, g, b))) return true;
    } else if (space === "prophoto-rgb") {
      if (nearCandyRgb(...prophotoEncodedToSrgb8(r, g, b))) return true;
      if (nearCandyRgb(...toRgb8(r, g, b))) return true;
    } else if (nearCandyRgb(...xyzD65ToSrgb8(r, g, b)) || nearCandyRgb(...xyzD50ToSrgb8(r, g, b))) {
      return true;
    }
  }
  return false;
}

const SLOP_FACE =
  "Inter|Poppins|Montserrat|Roboto|Geist|Outfit|Figtree|Satoshi|Nunito|Manrope|Plus Jakarta Sans|DM Sans|Space Grotesk|Instrument(?: Sans| Serif)?|Sora|Urbanist|Syne|Fraunces|Bricolage Grotesque|General Sans|Clash Display|Cabinet Grotesk|Switzer|Reckless|Boska|Zodiak|Melodrama|Canela|Tiempos(?: Text| Headline)?|GT (?:America|Alpina|Flexa|Super|Walsheim|Sectra|Pressura|Standard|Cinetype|Eesti|Zirkus|Maru|Planar|Haptik|Ultra|Fanon)|ABC (?:Diatype|Social|ROM|Ginto|Arizona|Gravity|Oracle|Synt)|Editorial New|Newsreader|Cormorant(?: Garamond)?|Favorit|Söhne|Sohne|Soehne|Array|Picture|Neue Haas Grotesk|(?:PP )?Neue Montreal|(?:PP )?Right Grotesk|PP Mori|PP Neue Machina|PP Agrandir|PP Neue World|PP Formula|PP Eiko|Suisse (?:Intl|International|Works)|Graphik|Founders Grotesk|Apercu|Aperçu|Gotham|Circular|Maison Neue|Aktiv Grotesk|Replica|Druk|Whyte|Basis Grotesque|Fakt|Akkurat|Proxima Nova|Avenir|Futura|Gilroy|SF (?:Pro(?: Display)?|Compact)|San Francisco|Monument Grotesk|Saol Display|Recoleta|TT Commons|National(?: 2)?|Onest|Work Sans|Rubik|Karla|Public Sans|IBM Plex (?:Sans|Serif|Mono)|Source (?:Sans(?: 3)?|Serif(?: 4)?|Code Pro)|Playfair(?: Display)?|Merriweather|Lora|Georgia|Times(?: New Roman)?|Arial|Helvetica(?: Neue)?|system-ui|ui-sans-serif|-apple-system|Segoe UI|Open Sans|Lato|Raleway|Barlow|Mulish|Archivo|Josefin Sans|Questrial|Jost|Red Hat (?:Display|Text|Mono)|Albert Sans|Schibsted Grotesk|Noto (?:Sans|Serif|Naskh|Kufi|Nastaliq)|Libre Franklin|Fira Sans|PT (?:Sans|Serif|Mono)|Calibri|Verdana|Tahoma|Trebuchet MS|Garamond|Ubuntu|Oswald|Didot|Bodoni(?: Moda)?|Baskerville|DIN(?: Next| Alternate| 2014)?|FF DIN|Lexend(?: Deca| Giga| Mega| Peta| Tera| Exa| Zetta)?|Atkinson Hyperlegible|Caslon|Goudy(?: Old Style)?|Sabon|Minion|Bembo|Bookman|Crimson(?: Text| Pro)?|Cardo|DM Serif Display|Cooper Black|Clarendon|Bebas Neue|Anton|Abril Fatface|Pacifico|Impact|Comfortaa|Quicksand|Exo(?: 2)?|Be Vietnam Pro|Bitter|Cabin|Sentinel|Freight(?: Text| Display| Sans| Macro)?|Chronicle|Mercury|Ideal Sans|Whitney|Archer|Tungsten|Verlag|Operator(?: Mono)?|Idlewild|Knockout|Surveyor|Vitesse|Forza|Decimal|Ringside|Hoefler(?: Text| Titling)?|Inkwell|Quarto|Landmark|Cyclone|Retina|Ziggurat|Calibre|Metric|Untitled(?: Sans| Serif)|Signifier|Pitch|Domaine(?: Display)?|Heldane|Featherfall|Epicene|Maelstrom|Styrene|Publico|Lyon|Duplicate(?: Sans)?|Feature|Austin|Portrait|Gill Sans|Myriad(?: Pro)?|Acumin|Optima|Interstate|Univers|Frutiger|Trade Gothic|News Gothic|Franklin Gothic|Trajan(?: Pro)?|Comic Sans(?: MS)?|Papyrus|Century Gothic|Cambria|Candara|Constantia|Corbel|Lucida(?: Grande| Sans)?|Book Antiqua|Menlo|Monaco|Consolas|Courier(?: New)?|Space Mono|JetBrains Mono|Inconsolata|Fira Code|(?:PP )?Object Sans|(?:PP )?Telegraf|Warnock(?: Pro)?|Kepler|Chaparral(?: Pro)?|SF Mono|Cascadia(?: Code| Mono)?|Andale Mono|Anonymous Pro|Input Mono|Dank Mono|Berkeley Mono|Commit Mono|Iosevka|Hack|Victor Mono|Comic Mono|DM Mono|Overpass Mono|Spline Sans Mono|Martian Mono|Azeret Mono|Fragment Mono|Clash Grotesk|Monaspace(?: Neon| Argon| Xenon| Radon| Krypton)?|Recursive|Intel One Mono|Charter|New York|(?:PP )?Hatton|(?:PP )?Kyoto|PP Neue Corp|Miller|Escrow|Mona Sans|Hubot Sans|Inclusive Sans|Product Sans|Aeonik|Familjen Grotesk|Darker Grotesque|TWK Everett|TWK Lausanne|Saans|Roobert|Spectral|Literata|Cinzel|Prata|Marcellus|Departure Mono|Benton Sans|PP Supply Sans|PP Fraktion|PP Woodland|PP Migra|PP Radio Grotesk|PP Neue Bit|Yeseva(?: One)?|Alfa Slab(?: One)?|Righteous|Fredoka(?: One)?|Unica77|Haas Unica|Obviously|Vulf (?:Sans|Mono)|Cheee|Hobeaux|Matter|Degular|Blazeface|Occidens|Perfectly Nineties|Mabry|Lobster|Dancing Script|Great Vibes|DM Serif Text|Orbitron|Teko|Audiowide|Bungee|Permanent Marker|Caveat|Sacramento|Josefin Slab|Young Serif|Gloock|Italiana|Vollkorn|Zilla Slab|Arvo|Titillium Web|Fortescue|Rajdhani|Sanomat|Dala Floda|Nichrome|Tartuffo|Copperplate|Rockwell|Antique Olive|Fjalla One|Francois One|Alata|Chivo|Heebo|Kanit|Prompt|Overpass|Asap|Catamaran|Skolar|Recife|Assistant|Mukta|Hind|Chakra Petch|VT323|Press Start(?: 2P)?|Oxygen|Dosis|Yanone Kaffeesatz|Varela Round|Signika(?: Negative)?|Maven Pro|League Spartan|Spline Sans|Hanken Grotesk|Alegreya|Akzidenz Grotesk|Theinhardt|Scto Grotesk|(?:PP )?Mondwest|(?:PP )?Neue Pixel|Arimo|Tinos|Cousine|Pathway Gothic One|FF Meta|Liberation Sans|Nimbus Sans|Electrolize|Michroma|Pixelify Sans|Silkscreen|Old Standard TT|News Cycle|Ropa Sans|Poiret One|Cuprum|Julius Sans One|Tenor Sans|Petrona|Indie Flower|Bangers|Amatic SC|Special Elite|Rokkitt|Crete Round|Kaushan Script|Patrick Hand|Shadows Into Light|Kalam|Lustria|Slabo 27px|Architects Daughter|Courgette|Luckiest Guy|Russo One|Volkhov|Neuton|Droid (?:Sans|Serif)|Staatliches|Black Ops One|Lilita One|Passion One|Fugaz One|Titan One|Bowlby One(?: SC)?|Squada One|Monoton|Homemade Apple|Allura|Yellowtail|Cairo|Readex Pro|Philosopher|Aleo|Alex Brush|El Messiri|Frank Ruhl Libre|Bellefair|Cutive(?: Mono)?|IM Fell English|Sarabun|Tajawal|Zen (?:Kaku Gothic(?: New| Antique)?|Maru Gothic|Antique|Old Mincho)|Nanum (?:Gothic|Myeongjo)|Gothic A1|Black Han Sans|Almarai|Changa|Reem Kufi|Amiri|Secular One|Sawarabi (?:Gothic|Mincho)|DotGothic16|Tangerine|Pinyon Script|Parisienne|Grand Hotel|Oleo Script(?: Swash Caps)?|Yesteryear|Niramit|Bai Jamjuree|Itim|Marck Script|Clicker Script|Arizonia|Kosugi(?: Maru)?|K2D|Kodchasan|Mitr|Pridi|Sriracha|Thasadith|Charm(?:onman)?|Pattaya|Taviraj|Trirong|Chonburi|Reenie Beanie|Coming Soon|Covered By Your Grace|Just Another Hand|Schoolbell|Creepster|Pirata One|RocknRoll One|Lalezar|Harmattan|Lemonada|Lateef|Scheherazade(?: New)?|Suez One|David Libre|Miriam Libre|Katibeh|Markazi Text|Aref Ruqaa(?: Ink)?|Jomhuria|Rakkas|Qahiri";

/** Tailwind arbitrary families use `_` for spaces (`font-['Instrument_Sans']`). */
const SLOP_FACE_TW = SLOP_FACE.replace(/ /g, "[ _]");

/**
 * Slop type via `font-family`, CSS `font:` shorthand, `--font-sans: Inter`,
 * or Tailwind `font-[Inter]`.
 */
const SLOP_FONT = new RegExp(
  `(?:font(?:-family)?|--font-[a-z]+)\\s*:[^;}{]*(?:${SLOP_FACE})\\b` +
    `|(?:class(?:Name)?\\s*=\\s*["'\`][^"'\`]*|@apply\\s+[^;{]*)\\bfont-\\[(?:["']?(?:${SLOP_FACE_TW})["']?)\\]`,
  "i",
);

/** Tailwind `font-sans` is the same generic stack as `font-family: sans-serif`. */
const TAILWIND_GENERIC_FONT =
  /(?:class(?:Name)?\s*=\s*["'`][^"'`]*|@apply\s+[^;{]*)\bfont-(?:sans|serif|mono)\b/i;

const SLOP_COPY =
  /\b(unlock (?:your|the)|empower(?:ing)? (?:your|teams)|seamless(?:ly)? |next-gen(?:eration)? |reimagine |elevate your |one platform |AI-powered |transform your (?:workflow|business)|all-in-one |supercharge |streamline your |revolutionize |cutting-edge |best-in-class |harness the power |10x your |work smarter )\b/i;

/** First family is a CSS generic family — no distinctive typeface. */
const GENERIC_FAMILY = "(?:sans-serif|serif|monospace|cursive|fantasy)";
const GENERIC_STACK = new RegExp(
  `font-family\\s*:\\s*(?:["']?)${GENERIC_FAMILY}\\b` +
    `|(?:^|[{;\\s])font\\s*:\\s*(?:(?:normal|italic|oblique|small-caps|bold(?:er)?|lighter|[1-9]00|(?:ultra-|extra-|semi-)?(?:condensed|expanded))\\s+)*[\\d.]+(?:px|em|rem|pt|%|vh|vw|ch)(?:\\s*/\\s*[\\d.]+(?:px|em|rem|pt|%|vh|vw|ch)?)?\\s*(?:["']?)${GENERIC_FAMILY}\\b`,
  "i",
);

const REMOTE_CDN =
  /fonts\.googleapis\.com|fonts\.gstatic\.com|fonts\.bunny\.net|use\.typekit\.net|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|ajax\.googleapis\.com|cdn\.tailwindcss\.com|esm\.sh\//i;

const MOUSE_MOVE = /addEventListener\s*\(\s*['"](?:mousemove|pointermove)['"]|onmousemove\s*=/i;

const PARALLAX = /parallax|translate3d|clientX|pageX|mouseX|--mouse/i;

export function looksGenericDesign(html?: string | null): boolean {
  const text = html?.trim() ?? "";
  if (!text) return false;
  if (REMOTE_CDN.test(text)) return true;
  if (MOUSE_MOVE.test(text) && PARALLAX.test(text)) return true;
  const purple =
    PURPLE_GRADIENT.test(text) || PURPLE_SOLID.test(text) || TAILWIND_PURPLE.test(text);
  if (purple) return true;
  if (
    TAILWIND_BLUE.test(text) ||
    BLUE_SOLID.test(text) ||
    CSS_CANDY_NAME.test(text) ||
    CSS_NAVY_KEYWORD.test(text) ||
    TAILWIND_CANDY_NAME.test(text) ||
    SVG_CANDY_NAME.test(text) ||
    looksCandyChannel(text)
  ) {
    return true;
  }
  const font = SLOP_FONT.test(text) || GENERIC_STACK.test(text) || TAILWIND_GENERIC_FONT.test(text);
  const copy = SLOP_COPY.test(text);
  if (/(?:linear|radial|conic)-gradient/i.test(text) && font) return true;
  return font && copy;
}

export const DESIGN_ITERATE_UNCHANGED_NEEDS_HUMAN =
  "Design canvas was not changed for this request. Needs a human.";

/** A change request that left the canvas identical to turn start cannot ship. Empty canvases skip. */
export function designIterateUnchangedNeedsHuman(input: {
  userText?: string | null;
  html?: string | null;
  turnStartHtml?: string | null;
}): string | undefined {
  if (!input.html?.trim()) return undefined;
  if (!looksLikeStudioChangeRequest(input.userText)) return undefined;
  if (
    !canvasHtmlUnchanged(
      stripHostStudioChrome(input.turnStartHtml ?? ""),
      stripHostStudioChrome(input.html),
    )
  ) {
    return undefined;
  }
  return DESIGN_ITERATE_UNCHANGED_NEEDS_HUMAN;
}

function clipSnapshotText(value: string, max = 72): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "none";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function designSnapshotHeadline(html: string): string {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return clipSnapshotText((h1 ?? title ?? "").replace(/<[^>]+>/g, ""));
}

function designSnapshotType(html: string): string {
  const fam = html.match(/font-family\s*:\s*([^;}{]+)/i)?.[1];
  return fam ? clipSnapshotText(fam.replace(/["']/g, ""), 60) : "none";
}

function designSnapshotTokens(html: string): string {
  const tokens = ["--bg", "--text", "--primary", "--line"].filter((token) => html.includes(token));
  return tokens.length ? tokens.join(" ") : "missing";
}

/** Short canvas facts so Design native/CLI turns patch in place instead of re-reading index.html. */
export function formatDesignCanvasSnapshot(html?: string | null): string {
  const text = html ?? "";
  const lines = [
    "Design canvas snapshot (do not re-read the whole file unless you need a specific range):",
    `- index.html ${text.length} bytes, </html> ${/<\/html>/i.test(text) ? "yes" : "NO"}`,
    `- headline: ${designSnapshotHeadline(text)}`,
    `- type: ${designSnapshotType(text)}`,
    `- tokens: ${designSnapshotTokens(text)}`,
    `- CDN: ${REMOTE_CDN.test(text) ? "yes" : "no"}`,
    `- generic template: ${looksGenericDesign(text) ? "yes" : "no"}`,
    `- host fallback: ${looksHostFallbackCanvas(text) ? "yes" : "no"}`,
  ];
  lines.push(
    text.trim()
      ? "Patch index.html in place. Call playwright after a write. Do not stop after the first paint. Do not rewrite the whole page if a small patch will do."
      : "Write a complete self-contained HTML document to index.html, then call playwright. Do not stop after the first paint.",
  );
  return lines.join("\n");
}
