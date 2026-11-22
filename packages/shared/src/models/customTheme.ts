/**
 * Generated themes: user-built or AI-built theme specs stored in config.
 *
 * A spec is data, never CSS. Every field is an enum, a clamped number, or a
 * validated hex colour, and customThemeCss() is the only place that turns a
 * spec into CSS. That keeps model output from injecting arbitrary rules.
 */
import type { ExtraToolDef } from "./mcp.js";
import { THEME_STYLES, isThemeId, type ThemeId, type ThemeStyle } from "./theme.js";

export const CUSTOM_THEME_PREFIX = "custom-";
export type CustomThemeId = `custom-${string}`;
/** A built-in theme id or a generated theme id. */
export type ThemeRef = ThemeId | CustomThemeId;

export const MAX_CUSTOM_THEMES = 48;
const CUSTOM_ID_RE = /^custom-[a-z0-9][a-z0-9-]{0,47}$/;
const HEX_RE = /^#[0-9a-f]{6}$/;

export const CUSTOM_THEME_FONTS = [
  "system",
  "outfit",
  "grotesk",
  "geometric",
  "rounded",
  "serif",
  "didone",
  "mono",
  "tech",
  "hand",
  "comic",
  "poster",
  "pixel",
  "humanist",
  "slab",
  "condensed",
  "elegant",
  "typewriter",
  "script",
  "blackletter",
] as const;
export type CustomThemeFont = (typeof CUSTOM_THEME_FONTS)[number];

export const CUSTOM_THEME_FONT_LABELS: Record<CustomThemeFont, string> = {
  system: "System UI",
  outfit: "Outfit",
  grotesk: "Grotesk",
  geometric: "Geometric",
  rounded: "Rounded",
  serif: "Book serif",
  didone: "Didone display",
  mono: "Monospace",
  tech: "Tech / HUD",
  hand: "Handwritten",
  comic: "Comic",
  poster: "Poster",
  pixel: "Pixel",
  humanist: "Humanist sans",
  slab: "Slab serif",
  condensed: "Condensed",
  elegant: "Elegant serif",
  typewriter: "Typewriter",
  script: "Script",
  blackletter: "Blackletter",
};

const FONT_STACKS: Record<CustomThemeFont, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  outfit: '"Outfit", "Segoe UI", system-ui, sans-serif',
  grotesk: '"Helvetica Neue", "Inter", Arial, "Liberation Sans", sans-serif',
  geometric: 'Futura, "Century Gothic", "Jost", "Avenir Next", sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Outfit", sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  didone: 'Didot, "Bodoni 72", "Playfair Display", "Times New Roman", serif',
  mono: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  tech: '"Rajdhani", "Eurostile", "Bahnschrift", "Arial Narrow", sans-serif',
  hand: '"Patrick Hand", "Segoe Print", "Bradley Hand", "Comic Neue", cursive',
  comic: '"Comic Neue", "Comic Sans MS", "Chalkboard SE", sans-serif',
  poster: '"Bangers", Impact, "Arial Black", sans-serif',
  pixel: '"Silkscreen", "Lucida Console", ui-monospace, monospace',
  humanist: '"Source Sans 3", "Gill Sans", Optima, "Segoe UI", sans-serif',
  slab: '"Zilla Slab", Rockwell, "Roboto Slab", Georgia, serif',
  condensed: '"Oswald", "Bebas Neue", "Arial Narrow", sans-serif-condensed, sans-serif',
  elegant: '"Cormorant Garamond", Garamond, "Times New Roman", serif',
  typewriter: '"Courier Prime", "American Typewriter", "Courier New", monospace',
  script: '"Pacifico", "Brush Script MT", cursive',
  blackletter: '"UnifrakturMaguntia", "Old English Text MT", serif',
};

/** Web fonts some presets need that index.html does not already load. */
const PRESET_WEB_FONTS: Partial<Record<CustomThemeFont, string>> = {
  humanist: "Source Sans 3",
  slab: "Zilla Slab",
  condensed: "Oswald",
  elegant: "Cormorant Garamond",
  typewriter: "Courier Prime",
  script: "Pacifico",
  blackletter: "UnifrakturMaguntia",
};

/**
 * A named web font (Google Fonts family) such as "Space Grotesk". Letters,
 * digits and single spaces only, so a name can never close a CSS string or a URL.
 */
const FONT_FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,47}$/;

export function normalizeFontFamily(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.replace(/["']/g, "").replace(/\s+/g, " ").trim();
  return FONT_FAMILY_RE.test(name) ? name : undefined;
}

/** Stylesheet URL that loads one Google Fonts family (regular weight; bold is synthesized). */
export function webFontHref(family: string): string | undefined {
  const name = normalizeFontFamily(family);
  if (!name) return undefined;
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}&display=swap`;
}

function fontStack(family: string | undefined, preset: CustomThemeFont | undefined): string {
  const fallback = FONT_STACKS[preset ?? "system"];
  return family ? `"${family}", ${fallback}` : fallback;
}

export const CUSTOM_THEME_BACKGROUNDS = [
  "solid",
  "gradient",
  "mesh",
  "dots",
  "grid",
  "lines",
  "diagonal",
  "grain",
  "aurora",
  "spotlight",
  "checker",
  "stripes",
  "crosshatch",
  "rings",
] as const;
export type CustomThemeBackground = (typeof CUSTOM_THEME_BACKGROUNDS)[number];

export const CUSTOM_THEME_PANES = ["solid", "glass", "outline", "raised", "flat"] as const;
export type CustomThemePane = (typeof CUSTOM_THEME_PANES)[number];

export const CUSTOM_THEME_SHADOWS = ["none", "soft", "lifted", "hard", "glow"] as const;
export type CustomThemeShadow = (typeof CUSTOM_THEME_SHADOWS)[number];

export const CUSTOM_THEME_BORDER_STYLES = ["solid", "dashed", "double"] as const;
export type CustomThemeBorderStyle = (typeof CUSTOM_THEME_BORDER_STYLES)[number];

export const CUSTOM_THEME_CONTROL_SHAPES = ["match", "pill", "square"] as const;
export type CustomThemeControlShape = (typeof CUSTOM_THEME_CONTROL_SHAPES)[number];

export const CUSTOM_THEME_CASES = ["none", "upper", "lower"] as const;
export type CustomThemeCase = (typeof CUSTOM_THEME_CASES)[number];

export const CUSTOM_THEME_SIDEBARS = ["surface", "tinted", "accent", "inverted"] as const;
export type CustomThemeSidebar = (typeof CUSTOM_THEME_SIDEBARS)[number];

export const CUSTOM_THEME_BUBBLES = ["filled", "outline", "accent", "quote", "plain"] as const;
export type CustomThemeBubble = (typeof CUSTOM_THEME_BUBBLES)[number];

export const CUSTOM_THEME_BUTTONS = ["filled", "outline", "gradient", "glow"] as const;
export type CustomThemeButton = (typeof CUSTOM_THEME_BUTTONS)[number];

export const CUSTOM_THEME_DENSITIES = ["compact", "cozy", "spacious"] as const;
export type CustomThemeDensity = (typeof CUSTOM_THEME_DENSITIES)[number];

export const CUSTOM_THEME_TOPBARS = ["surface", "transparent", "glass", "accent"] as const;
export type CustomThemeTopbar = (typeof CUSTOM_THEME_TOPBARS)[number];

export const CUSTOM_THEME_BORDER_COLORS = ["line", "text", "accent", "accent2"] as const;
export type CustomThemeBorderColor = (typeof CUSTOM_THEME_BORDER_COLORS)[number];

export const CUSTOM_THEME_FOCUS_RINGS = ["accent", "thick", "glow", "dashed"] as const;
export type CustomThemeFocusRing = (typeof CUSTOM_THEME_FOCUS_RINGS)[number];

export const CUSTOM_THEME_SCROLLBARS = ["default", "thin", "accent"] as const;
export type CustomThemeScrollbar = (typeof CUSTOM_THEME_SCROLLBARS)[number];

export const CUSTOM_THEME_HEADING_STYLES = [
  "plain",
  "gradient",
  "underline",
  "highlight",
  "outline",
] as const;
export type CustomThemeHeadingStyle = (typeof CUSTOM_THEME_HEADING_STYLES)[number];

export const CUSTOM_THEME_LINK_STYLES = ["underline", "plain", "dotted", "highlight"] as const;
export type CustomThemeLinkStyle = (typeof CUSTOM_THEME_LINK_STYLES)[number];

export const CUSTOM_THEME_SPEEDS = ["instant", "fast", "normal", "relaxed", "slow"] as const;
export type CustomThemeSpeed = (typeof CUSTOM_THEME_SPEEDS)[number];

export const CUSTOM_THEME_EASINGS = ["standard", "smooth", "snappy", "bouncy", "linear"] as const;
export type CustomThemeEasing = (typeof CUSTOM_THEME_EASINGS)[number];

/** How a new chat message arrives. */
export const CUSTOM_THEME_ENTRANCES = ["none", "fade", "rise", "slide", "pop", "blur"] as const;
export type CustomThemeEntrance = (typeof CUSTOM_THEME_ENTRANCES)[number];

export const CUSTOM_THEME_HOVERS = ["none", "lift", "grow", "glow", "press", "shine"] as const;
export type CustomThemeHover = (typeof CUSTOM_THEME_HOVERS)[number];

/** Slow ambient motion on the backdrop pattern. */
export const CUSTOM_THEME_BACKDROP_MOTIONS = ["none", "drift", "pulse", "hue", "pan"] as const;
export type CustomThemeBackdropMotion = (typeof CUSTOM_THEME_BACKDROP_MOTIONS)[number];

export const CUSTOM_THEME_COLOR_KEYS = [
  "bg",
  "surface",
  "raised",
  "overlay",
  "text",
  "muted",
  "faint",
  "accent",
  "accent2",
  "accentInk",
  "danger",
  "ok",
  "warn",
] as const;
export type CustomThemeColorKey = (typeof CUSTOM_THEME_COLOR_KEYS)[number];
export type CustomThemeColors = Record<CustomThemeColorKey, string>;

export const CUSTOM_THEME_COLOR_LABELS: Record<CustomThemeColorKey, string> = {
  bg: "Page",
  surface: "Panes",
  raised: "Raised",
  overlay: "Overlay",
  text: "Text",
  muted: "Muted text",
  faint: "Faint text",
  accent: "Accent",
  accent2: "Second accent",
  accentInk: "Text on accent",
  danger: "Danger",
  ok: "Success",
  warn: "Warning",
};

/**
 * Optional colours for individual surfaces. Anything left out is derived from
 * the core palette; ink on filled surfaces is picked for contrast automatically.
 */
export const CUSTOM_THEME_EXTRA_COLOR_KEYS = [
  "border",
  "link",
  "heading",
  "selection",
  "focus",
  "rail",
  "sidebar",
  "topbar",
  "userBubble",
] as const;
export type CustomThemeExtraColorKey = (typeof CUSTOM_THEME_EXTRA_COLOR_KEYS)[number];
export type CustomThemeExtraColors = Partial<Record<CustomThemeExtraColorKey, string>>;

export const CUSTOM_THEME_EXTRA_COLOR_LABELS: Record<CustomThemeExtraColorKey, string> = {
  border: "Borders",
  link: "Links",
  heading: "Headings",
  selection: "Text selection",
  focus: "Focus ring",
  rail: "Icon rail",
  sidebar: "Sidebar",
  topbar: "Top bar",
  userBubble: "Your messages",
};

export interface CustomThemeLayout {
  /** Corner radius for panes, in px (0–32). */
  radius?: number;
  controls?: CustomThemeControlShape;
  /** Pane and control border width, in px (0–4). */
  borderWidth?: number;
  borderStyle?: CustomThemeBorderStyle;
  shadow?: CustomThemeShadow;
  pane?: CustomThemePane;
  background?: CustomThemeBackground;
  sidebar?: CustomThemeSidebar;
  bubble?: CustomThemeBubble;
  button?: CustomThemeButton;
  /** Spacing scale for padding and gaps. */
  density?: CustomThemeDensity;
  topbar?: CustomThemeTopbar;
  /** Which colour pane and control borders use. */
  borderColor?: CustomThemeBorderColor;
  focusRing?: CustomThemeFocusRing;
  scrollbar?: CustomThemeScrollbar;
  /** Frosted-glass blur in px (0–40) for glass panes and top bars. */
  blur?: number;
  /** Max width of chat messages, in px (560–1200). */
  messageWidth?: number;
  /** Backdrop colours (1–4 hex) for gradient, mesh and aurora; default accent + accent2. */
  backgroundColors?: string[];
  /** Backdrop direction in degrees (0–360) for gradient, stripes and diagonal. */
  backgroundAngle?: number;
  /** Backdrop strength (0–1). Default 0.5. */
  backgroundIntensity?: number;
  /** Pattern size multiplier (0.5–4). Default 1. */
  patternScale?: number;
}

export interface CustomThemeType {
  font?: CustomThemeFont;
  headingFont?: CustomThemeFont;
  headingCase?: CustomThemeCase;
  /** 300–900 in steps of 100. */
  headingWeight?: number;
  /** Heading letter spacing in em (-0.05–0.3). */
  headingTracking?: number;
  headingItalic?: boolean;
  /** Any Google Fonts family by name ("Space Grotesk"); overrides `font`. */
  fontFamily?: string;
  /** Any Google Fonts family by name; overrides `headingFont`. */
  headingFontFamily?: string;
  /** Code and terminal font preset. */
  monoFont?: CustomThemeFont;
  /** Any Google Fonts family by name; overrides `monoFont`. */
  monoFontFamily?: string;
  /** Type scale multiplier (0.85–1.3). */
  scale?: number;
  /** Body weight, 300–700 in steps of 100. */
  bodyWeight?: number;
  /** Body letter spacing in em (-0.03–0.1). */
  bodyTracking?: number;
  /** Chat line height (1.2–2). */
  lineHeight?: number;
  headingStyle?: CustomThemeHeadingStyle;
  links?: CustomThemeLinkStyle;
}

export interface CustomThemeMotion {
  /** Overall UI animation speed. */
  speed?: CustomThemeSpeed;
  easing?: CustomThemeEasing;
  /** How new chat messages appear. */
  enter?: CustomThemeEntrance;
  /** Button hover effect. */
  hover?: CustomThemeHover;
  /** Ambient backdrop animation (needs a patterned backdrop). */
  backdrop?: CustomThemeBackdropMotion;
}

export interface CustomThemeEffects {
  scanlines?: boolean;
  vignette?: boolean;
  /** Buttons lift slightly on hover. Off under reduced motion. Same as motion.hover "lift". */
  lift?: boolean;
  /** Film-grain noise over the whole app. */
  noise?: boolean;
  /** Neon glow on headings and the primary button. */
  glow?: boolean;
}

export interface CustomTheme {
  id: CustomThemeId;
  name: string;
  summary: string;
  scheme: "light" | "dark";
  /** Optional structural group to build on (Brutalist, Comic, …). */
  base?: ThemeStyle;
  colors: CustomThemeColors;
  /** Optional per-surface colours. */
  extraColors?: CustomThemeExtraColors;
  layout: CustomThemeLayout;
  type: CustomThemeType;
  effects: CustomThemeEffects;
  motion?: CustomThemeMotion;
  /** Who made it: built in the editor, or generated by Locus. */
  origin: "user" | "ai";
  createdAt: string;
  updatedAt: string;
}

export function isCustomThemeId(value: unknown): value is CustomThemeId {
  return typeof value === "string" && CUSTOM_ID_RE.test(value);
}

export function customThemeSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "theme";
}

/** Picks a fresh id from a name, avoiding ids already taken. */
export function newCustomThemeId(name: string, taken: Iterable<string>): CustomThemeId {
  const used = new Set(taken);
  const base = `${CUSTOM_THEME_PREFIX}${customThemeSlug(name)}`;
  if (!used.has(base)) return base as CustomThemeId;
  for (let n = 2; n < 1000; n += 1) {
    const id = `${base}-${n}`;
    if (!used.has(id)) return id as CustomThemeId;
  }
  return `${base}-${Date.now().toString(36)}` as CustomThemeId;
}

/** A built-in id, or a generated id that exists in `customThemes`; else the fallback. */
export function resolveThemeRef(
  value: unknown,
  customThemes: readonly CustomTheme[] | undefined,
  fallback: ThemeId = "ember",
): ThemeRef {
  if (typeof value === "string" && isThemeId(value)) return value;
  if (isCustomThemeId(value) && customThemes?.some((t) => t.id === value)) return value;
  return fallback;
}

export function findCustomTheme(
  id: unknown,
  customThemes: readonly CustomTheme[] | undefined,
): CustomTheme | undefined {
  return isCustomThemeId(id) ? customThemes?.find((t) => t.id === id) : undefined;
}

// ─────────────────────────── Colour helpers ───────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function normalizeThemeHex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let raw = value.trim().toLowerCase();
  if (!raw.startsWith("#")) raw = `#${raw}`;
  if (/^#[0-9a-f]{3}$/.test(raw)) raw = `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  return HEX_RE.test(raw) ? raw : undefined;
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function hexContrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function mixHex(a: string, b: string, weightOfB: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(
    [0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * weightOfB) as [number, number, number],
  );
}

function rgbList(hex: string): string {
  return hexToRgb(hex).join(", ");
}

/** Moves `fg` toward black or white (whichever helps) until it clears `min` on `bg`. */
function pushContrast(fg: string, bg: string, min: number): string {
  if (hexContrast(fg, bg) >= min) return fg;
  const target = luminance(bg) > 0.5 ? "#000000" : "#ffffff";
  for (let step = 1; step <= 20; step += 1) {
    const next = mixHex(fg, target, step / 20);
    if (hexContrast(next, bg) >= min) return next;
  }
  return target;
}

export interface CustomThemeContrastIssue {
  pair: string;
  ratio: number;
  minimum: number;
}

const CONTRAST_PAIRS: Array<[CustomThemeColorKey, CustomThemeColorKey, number]> = [
  ["text", "bg", 4.5],
  ["text", "surface", 4.5],
  ["muted", "bg", 4.5],
  ["muted", "surface", 4.5],
  // Faint is small print (hints, counts, group labels), so it needs body-text AA too.
  ["faint", "bg", 4.5],
  ["faint", "surface", 4.5],
  ["accentInk", "accent", 4.5],
  ["accent", "bg", 3],
  ["accent2", "bg", 3],
  ["danger", "bg", 4.5],
  ["ok", "bg", 3],
  ["warn", "bg", 3],
];

export function customThemeContrastIssues(colors: CustomThemeColors): CustomThemeContrastIssue[] {
  const issues: CustomThemeContrastIssue[] = [];
  for (const [fg, bg, minimum] of CONTRAST_PAIRS) {
    const ratio = hexContrast(colors[fg], colors[bg]);
    if (ratio + 1e-6 < minimum) issues.push({ pair: `${fg} / ${bg}`, ratio, minimum });
  }
  return issues;
}

/** Nudges failing colours until every pair the built-in themes promise is readable. */
export function fixCustomThemeContrast(colors: CustomThemeColors): CustomThemeColors {
  const next = { ...colors };
  const darkest = (a: string, b: string) => (luminance(a) < luminance(b) ? a : b);
  const lightest = (a: string, b: string) => (luminance(a) > luminance(b) ? a : b);
  const lightPage = luminance(next.bg) > 0.4;
  // Text has to clear both the page and panes; check against the harder of the two.
  const hardest = lightPage ? darkest(next.bg, next.surface) : lightest(next.bg, next.surface);
  next.text = pushContrast(next.text, hardest, 4.5);
  next.muted = pushContrast(next.muted, hardest, 4.5);
  next.faint = pushContrast(next.faint, hardest, 4.5);
  // Danger labels destructive buttons and error lines, so it is held to body-text AA.
  next.danger = pushContrast(next.danger, next.bg, 4.5);
  for (const key of ["accent", "accent2", "ok", "warn"] as const) {
    next[key] = pushContrast(next[key], next.bg, 3);
  }
  if (hexContrast(next.accentInk, next.accent) < 4.5) {
    const white = hexContrast("#ffffff", next.accent);
    const black = hexContrast("#111111", next.accent);
    next.accentInk = white >= black ? "#ffffff" : "#111111";
    if (Math.max(white, black) < 4.5) {
      next.accent = pushContrast(next.accent, next.accentInk, 4.5);
    }
  }
  return next;
}

/** Keeps links and headings readable on the page and panes. Fills pick their own ink. */
export function fixExtraColorContrast(
  extra: CustomThemeExtraColors,
  colors: CustomThemeColors,
): CustomThemeExtraColors {
  const next = { ...extra };
  const lightPage = luminance(colors.bg) > 0.4;
  const hardest = lightPage
    ? luminance(colors.bg) < luminance(colors.surface)
      ? colors.bg
      : colors.surface
    : luminance(colors.bg) > luminance(colors.surface)
      ? colors.bg
      : colors.surface;
  if (next.link) next.link = pushContrast(next.link, hardest, 4.5);
  if (next.heading) next.heading = pushContrast(next.heading, hardest, 4.5);
  if (next.focus) next.focus = pushContrast(next.focus, colors.bg, 3);
  return next;
}

/** Readable ink for text on a filled surface: `preferred` if it clears 4.5:1, else black or white. */
export function inkOn(fill: string, preferred: string): string {
  if (hexContrast(preferred, fill) >= 4.5) return preferred;
  return hexContrast("#ffffff", fill) >= hexContrast("#111111", fill) ? "#ffffff" : "#111111";
}

/**
 * `--accent-text` for a generated theme: the accent pulled 30% toward text (the
 * built-in default mix), deepened further toward text until it clears 4.5:1 on
 * both the page and panes. Small accent labels and links use it; fills keep --accent.
 */
export function customAccentText(colors: CustomThemeColors): string {
  const clears = (hex: string) =>
    hexContrast(hex, colors.bg) >= 4.5 && hexContrast(hex, colors.surface) >= 4.5;
  for (let step = 6; step <= 20; step += 1) {
    const next = mixHex(colors.accent, colors.text, step / 20);
    if (clears(next)) return next;
  }
  const lightPage = luminance(colors.bg) > 0.4;
  const hardest = lightPage
    ? luminance(colors.bg) < luminance(colors.surface)
      ? colors.bg
      : colors.surface
    : luminance(colors.bg) > luminance(colors.surface)
      ? colors.bg
      : colors.surface;
  return pushContrast(colors.text, hardest, 4.5);
}

// ─────────────────────────── Normalizing ───────────────────────────

const LIGHT_DEFAULTS: CustomThemeColors = {
  bg: "#f6f4ef",
  surface: "#fbfaf7",
  raised: "#ece9e1",
  overlay: "#ffffff",
  text: "#1c1b19",
  muted: "#4a4740",
  faint: "#6e6a61",
  accent: "#c2410c",
  accent2: "#1d4ed8",
  accentInk: "#ffffff",
  danger: "#c0262d",
  ok: "#2f7a45",
  warn: "#8a5d06",
};

const DARK_DEFAULTS: CustomThemeColors = {
  bg: "#111214",
  surface: "#17181b",
  raised: "#1f2024",
  overlay: "#282a2f",
  text: "#eceae4",
  muted: "#b9b5ab",
  faint: "#8d897f",
  accent: "#f59e0b",
  accent2: "#60a5fa",
  accentInk: "#111111",
  danger: "#ff6e6e",
  ok: "#6ee7a0",
  warn: "#f5c26b",
};

export function defaultCustomThemeColors(scheme: "light" | "dark"): CustomThemeColors {
  return { ...(scheme === "light" ? LIGHT_DEFAULTS : DARK_DEFAULTS) };
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function clampNum(value: unknown, min: number, max: number, step?: number): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  const clamped = Math.min(max, Math.max(min, n));
  return step ? Math.round(clamped / step) * step : clamped;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Drop control characters and angle brackets: names render in cards and tool output.
  const kept = [...value].filter((ch) => ch.charCodeAt(0) >= 0x20 && ch !== "<" && ch !== ">");
  return kept.join("").trim().slice(0, max);
}

function hexList(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map(normalizeThemeHex)
    .filter((hex): hex is string => !!hex)
    .slice(0, max);
  return out.length ? out : undefined;
}

function definedOnly<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export interface CustomThemeInputOptions {
  /** Id to keep (update) — otherwise a fresh id is picked from the name. */
  id?: string;
  taken?: Iterable<string>;
  origin?: "user" | "ai";
  now?: string;
  /** Repair unreadable colour pairs. Default true. */
  fixContrast?: boolean;
}

/**
 * Builds a valid theme from loose input (editor state, model JSON, imports).
 * Accepts camelCase or snake_case keys and a flat or nested shape.
 */
export function customThemeFromInput(
  raw: unknown,
  options: CustomThemeInputOptions = {},
): CustomTheme {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const get = (obj: Record<string, unknown> | undefined, key: string): unknown => {
    if (!obj) return undefined;
    if (key in obj) return obj[key];
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    return obj[snake];
  };
  const sub = (key: string): Record<string, unknown> => {
    const v = get(row, key);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  };
  const colorsIn = sub("colors");
  const layoutIn = { ...row, ...sub("layout") };
  const typeIn = { ...row, ...sub("type"), ...sub("typography") };
  const effectsIn = { ...row, ...sub("effects") };
  const motionIn = { ...sub("motion"), ...sub("animation") };
  const extraIn = { ...colorsIn, ...sub("extraColors") };

  const schemeRaw = get(row, "scheme");
  let scheme: "light" | "dark" = schemeRaw === "light" || schemeRaw === "dark" ? schemeRaw : "dark";
  const bgIn = normalizeThemeHex(get(colorsIn, "bg") ?? get(colorsIn, "background"));
  if (schemeRaw !== "light" && schemeRaw !== "dark" && bgIn) {
    scheme = luminance(bgIn) > 0.4 ? "light" : "dark";
  }
  const defaults = defaultCustomThemeColors(scheme);
  const aliases: Partial<Record<CustomThemeColorKey, string[]>> = {
    bg: ["background", "page"],
    surface: ["bg1", "pane", "panel"],
    raised: ["bg2"],
    overlay: ["bg3"],
    accent2: ["secondary", "accentSecondary"],
    accentInk: ["onAccent"],
    ok: ["success"],
    warn: ["warning"],
  };
  const colors = {} as CustomThemeColors;
  const given = new Set<CustomThemeColorKey>();
  for (const key of CUSTOM_THEME_COLOR_KEYS) {
    const candidates = [key, ...(aliases[key] ?? [])];
    let value: string | undefined;
    for (const name of candidates) {
      value = normalizeThemeHex(get(colorsIn, name));
      if (value) break;
    }
    if (value) given.add(key);
    colors[key] = value ?? defaults[key];
  }
  // Derive missing surfaces and text tones from what was given, so a
  // three-colour spec still looks deliberate.
  const away = scheme === "light" ? "#000000" : "#ffffff";
  if (!given.has("surface")) colors.surface = mixHex(colors.bg, "#ffffff", 0.04);
  if (!given.has("raised")) colors.raised = mixHex(colors.bg, away, 0.06);
  if (!given.has("overlay")) colors.overlay = mixHex(colors.bg, away, 0.12);
  if (!given.has("muted")) colors.muted = mixHex(colors.text, colors.bg, 0.25);
  if (!given.has("faint")) colors.faint = mixHex(colors.text, colors.bg, 0.42);

  const baseRaw = get(row, "base") ?? get(row, "style");
  const base = pick(baseRaw, THEME_STYLES);

  const layout: CustomThemeLayout = definedOnly({
    radius: clampNum(get(layoutIn, "radius"), 0, 32, 1),
    controls: pick(get(layoutIn, "controls"), CUSTOM_THEME_CONTROL_SHAPES),
    borderWidth: clampNum(get(layoutIn, "borderWidth"), 0, 4, 1),
    borderStyle: pick(get(layoutIn, "borderStyle"), CUSTOM_THEME_BORDER_STYLES),
    shadow: pick(get(layoutIn, "shadow"), CUSTOM_THEME_SHADOWS),
    pane: pick(get(layoutIn, "pane"), CUSTOM_THEME_PANES),
    background: pick(get(layoutIn, "background"), CUSTOM_THEME_BACKGROUNDS),
    sidebar: pick(get(layoutIn, "sidebar"), CUSTOM_THEME_SIDEBARS),
    bubble: pick(get(layoutIn, "bubble"), CUSTOM_THEME_BUBBLES),
    button: pick(get(layoutIn, "button"), CUSTOM_THEME_BUTTONS),
    density: pick(get(layoutIn, "density"), CUSTOM_THEME_DENSITIES),
    topbar: pick(get(layoutIn, "topbar"), CUSTOM_THEME_TOPBARS),
    borderColor: pick(get(layoutIn, "borderColor"), CUSTOM_THEME_BORDER_COLORS),
    focusRing: pick(get(layoutIn, "focusRing"), CUSTOM_THEME_FOCUS_RINGS),
    scrollbar: pick(get(layoutIn, "scrollbar"), CUSTOM_THEME_SCROLLBARS),
    blur: clampNum(get(layoutIn, "blur"), 0, 40, 1),
    messageWidth: clampNum(get(layoutIn, "messageWidth"), 560, 1200, 10),
    backgroundColors: hexList(get(layoutIn, "backgroundColors"), 4),
    backgroundAngle: clampNum(get(layoutIn, "backgroundAngle"), 0, 360, 1),
    backgroundIntensity: clampNum(get(layoutIn, "backgroundIntensity"), 0, 1, 0.05),
    patternScale: clampNum(get(layoutIn, "patternScale"), 0.5, 4, 0.25),
  });
  const type: CustomThemeType = definedOnly({
    font: pick(get(typeIn, "font"), CUSTOM_THEME_FONTS),
    headingFont: pick(get(typeIn, "headingFont"), CUSTOM_THEME_FONTS),
    headingCase: pick(get(typeIn, "headingCase"), CUSTOM_THEME_CASES),
    headingWeight: clampNum(get(typeIn, "headingWeight"), 300, 900, 100),
    headingTracking: clampNum(get(typeIn, "headingTracking"), -0.05, 0.3, 0.01),
    headingItalic: bool(get(typeIn, "headingItalic")),
    fontFamily: normalizeFontFamily(get(typeIn, "fontFamily")),
    headingFontFamily: normalizeFontFamily(get(typeIn, "headingFontFamily")),
    monoFont: pick(get(typeIn, "monoFont"), CUSTOM_THEME_FONTS),
    monoFontFamily: normalizeFontFamily(get(typeIn, "monoFontFamily")),
    scale: clampNum(get(typeIn, "scale"), 0.85, 1.3, 0.05),
    bodyWeight: clampNum(get(typeIn, "bodyWeight"), 300, 700, 100),
    bodyTracking: clampNum(get(typeIn, "bodyTracking"), -0.03, 0.1, 0.005),
    lineHeight: clampNum(get(typeIn, "lineHeight"), 1.2, 2, 0.05),
    headingStyle: pick(get(typeIn, "headingStyle"), CUSTOM_THEME_HEADING_STYLES),
    links: pick(get(typeIn, "links"), CUSTOM_THEME_LINK_STYLES),
  });
  const effects: CustomThemeEffects = definedOnly({
    scanlines: bool(get(effectsIn, "scanlines")),
    vignette: bool(get(effectsIn, "vignette")),
    lift: bool(get(effectsIn, "lift")),
    noise: bool(get(effectsIn, "noise")),
    glow: bool(get(effectsIn, "glow")),
  });
  const motion: CustomThemeMotion = definedOnly({
    speed: pick(get(motionIn, "speed"), CUSTOM_THEME_SPEEDS),
    easing: pick(get(motionIn, "easing"), CUSTOM_THEME_EASINGS),
    enter: pick(get(motionIn, "enter"), CUSTOM_THEME_ENTRANCES),
    hover: pick(get(motionIn, "hover"), CUSTOM_THEME_HOVERS),
    backdrop: pick(get(motionIn, "backdrop"), CUSTOM_THEME_BACKDROP_MOTIONS),
  });
  const extraRaw: CustomThemeExtraColors = definedOnly(
    Object.fromEntries(
      CUSTOM_THEME_EXTRA_COLOR_KEYS.map((key) => [key, normalizeThemeHex(get(extraIn, key))]),
    ) as CustomThemeExtraColors,
  );

  const fixed = options.fixContrast === false ? colors : fixCustomThemeContrast(colors);
  const extraColors =
    options.fixContrast === false ? extraRaw : fixExtraColorContrast(extraRaw, fixed);

  const name = cleanText(get(row, "name"), 40) || "Untitled theme";
  const now = options.now ?? new Date().toISOString();
  const keepId = options.id ?? get(row, "id");
  const id = isCustomThemeId(keepId) ? keepId : newCustomThemeId(name, options.taken ?? []);
  const originRaw = get(row, "origin");
  const createdAt = typeof get(row, "createdAt") === "string" ? String(get(row, "createdAt")) : now;
  return {
    id,
    name,
    summary: cleanText(get(row, "summary") ?? get(row, "description"), 160),
    scheme,
    ...(base ? { base } : {}),
    colors: fixed,
    ...(Object.keys(extraColors).length ? { extraColors } : {}),
    layout,
    type,
    effects,
    ...(Object.keys(motion).length ? { motion } : {}),
    origin: options.origin ?? (originRaw === "ai" ? "ai" : "user"),
    createdAt,
    updatedAt:
      options.now ??
      (typeof get(row, "updatedAt") === "string" ? String(get(row, "updatedAt")) : now),
  };
}

/** Load-side normalizer for config.customThemes. Drops junk, de-dupes ids, caps the count. */
export function normalizeCustomThemes(raw: unknown): CustomTheme[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomTheme[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    if (!isCustomThemeId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(customThemeFromInput(row, { id, fixContrast: false }));
    if (out.length >= MAX_CUSTOM_THEMES) break;
  }
  return out;
}

/** The four swatches shown on a theme card. */
export function customThemeSwatches(theme: CustomTheme): [string, string, string, string] {
  return [theme.colors.bg, theme.colors.raised, theme.colors.accent, theme.colors.accent2];
}

// ─────────────────────────── CSS ───────────────────────────

const SHADOWS: Record<CustomThemeShadow, (c: CustomThemeColors) => [string, string]> = {
  none: () => ["none", "none"],
  soft: (c) => [
    `0 1px 2px rgba(${rgbList(c.text)}, 0.08)`,
    `0 10px 30px rgba(${rgbList(c.text)}, 0.12)`,
  ],
  lifted: (c) => [
    `0 2px 4px rgba(${rgbList(c.text)}, 0.12)`,
    `0 22px 50px -12px rgba(0, 0, 0, 0.45)`,
  ],
  hard: (c) => [`2px 2px 0 ${c.text}`, `5px 5px 0 ${c.text}`],
  glow: (c) => [
    `0 0 8px rgba(${rgbList(c.accent)}, 0.35)`,
    `0 0 0 1px rgba(${rgbList(c.accent)}, 0.5), 0 0 22px rgba(${rgbList(c.accent)}, 0.35)`,
  ],
};

function round(n: number, places = 2): string {
  return String(Number(n.toFixed(places)));
}

function backgroundLayers(
  kind: CustomThemeBackground,
  c: CustomThemeColors,
  l: CustomThemeLayout,
): string | undefined {
  const strength = (l.backgroundIntensity ?? 0.5) * 2;
  const k = l.patternScale ?? 1;
  const px = (n: number) => `${round(n * k, 1)}px`;
  const angle = l.backgroundAngle;
  const line = `rgba(${rgbList(c.text)}, ${round(0.07 * strength, 3)})`;
  const stops = l.backgroundColors?.length ? l.backgroundColors : [c.accent, c.accent2];
  const tint = (i: number, alpha = 0.16) =>
    `rgba(${rgbList(stops[i % stops.length]!)}, ${round(alpha * strength, 3)})`;
  const a = tint(0);
  const b = tint(1);
  switch (kind) {
    case "solid":
      return undefined;
    case "gradient": {
      const mids =
        stops.length > 2 ? stops.slice(1, -1).map((_, i) => tint(i + 1)) : ["transparent 45%"];
      return `linear-gradient(${angle ?? 160}deg, ${a}, ${mids.join(", ")}, ${tint(stops.length > 2 ? stops.length - 1 : 1)})`;
    }
    case "mesh":
      return `radial-gradient(60% 50% at 0% 0%, ${a}, transparent 70%), radial-gradient(55% 50% at 100% 15%, ${b}, transparent 70%), radial-gradient(60% 60% at 50% 110%, ${tint(2)}, transparent 70%)`;
    case "aurora":
      return `radial-gradient(70% 40% at 20% 0%, ${tint(0, 0.26)}, transparent 70%), radial-gradient(60% 45% at 80% 5%, ${tint(1, 0.24)}, transparent 70%), radial-gradient(50% 35% at 50% 25%, ${tint(2, 0.18)}, transparent 75%), linear-gradient(to bottom, ${tint(3, 0.08)}, transparent 60%)`;
    case "spotlight":
      return `radial-gradient(80% 65% at 50% 30%, ${tint(0, 0.2)}, transparent 70%)`;
    case "dots":
      return `radial-gradient(${line} 1.2px, transparent 1.6px) 0 0 / ${px(16)} ${px(16)}`;
    case "grid":
      return `linear-gradient(${line} 1px, transparent 1px) 0 0 / ${px(24)} ${px(24)}, linear-gradient(90deg, ${line} 1px, transparent 1px) 0 0 / ${px(24)} ${px(24)}`;
    case "lines":
      return `repeating-linear-gradient(to bottom, transparent 0 ${px(27)}, ${line} ${px(27)} ${px(28)})`;
    case "diagonal":
      return `repeating-linear-gradient(${angle ?? 135}deg, transparent 0 ${px(10)}, ${line} ${px(10)} ${px(11)})`;
    case "crosshatch":
      return `repeating-linear-gradient(45deg, transparent 0 ${px(12)}, ${line} ${px(12)} ${px(13)}), repeating-linear-gradient(-45deg, transparent 0 ${px(12)}, ${line} ${px(12)} ${px(13)})`;
    case "stripes":
      return `repeating-linear-gradient(${angle ?? 90}deg, ${tint(0, 0.06)} 0 ${px(28)}, transparent ${px(28)} ${px(56)})`;
    case "checker":
      return `conic-gradient(${line} 25%, transparent 0 50%, ${line} 0 75%, transparent 0) 0 0 / ${px(32)} ${px(32)}`;
    case "rings":
      return `repeating-radial-gradient(circle at 50% 40%, transparent 0 ${px(22)}, ${line} ${px(22)} ${px(23)})`;
    case "grain":
      return `radial-gradient(rgba(${rgbList(c.text)}, ${round(0.05 * strength, 3)}) 0.7px, transparent 1px) 0 0 / ${px(5)} ${px(5)}, radial-gradient(rgba(${rgbList(c.text)}, ${round(0.04 * strength, 3)}) 0.7px, transparent 1px) 2px 3px / ${px(7)} ${px(7)}`;
  }
}

const SPACE_TOKENS: Array<[string, number]> = [
  ["--space-0-5", 2],
  ["--space-1", 4],
  ["--space-1-5", 6],
  ["--space-2", 8],
  ["--space-2-5", 10],
  ["--space-3", 12],
  ["--space-3-5", 14],
  ["--space-4", 16],
  ["--space-5", 20],
  ["--space-6", 24],
  ["--space-7", 28],
  ["--space-8", 32],
  ["--space-10", 40],
  ["--space-12", 48],
];

const TYPE_TOKENS: Array<[string, number]> = [
  ["--type-2xs", 12],
  ["--type-xs", 12],
  ["--type-sm", 13],
  ["--type-md", 14],
  ["--type-body", 14],
  ["--type-lg", 16],
  ["--type-xl", 18],
  ["--type-2xl", 22],
  ["--type-3xl", 28],
];

const DENSITY_SCALE: Record<CustomThemeDensity, number> = {
  compact: 0.8,
  cozy: 1,
  spacious: 1.25,
};

const SPEED_SCALE: Record<CustomThemeSpeed, number> = {
  instant: 0,
  fast: 0.6,
  normal: 1,
  relaxed: 1.5,
  slow: 2.2,
};

const EASINGS: Record<CustomThemeEasing, [string, string]> = {
  standard: ["cubic-bezier(0.2, 0, 0, 1)", "cubic-bezier(0.4, 0, 0.2, 1)"],
  smooth: ["cubic-bezier(0.45, 0, 0.55, 1)", "cubic-bezier(0.65, 0, 0.35, 1)"],
  snappy: ["cubic-bezier(0.2, 0.9, 0.1, 1)", "cubic-bezier(0.3, 1, 0.2, 1)"],
  bouncy: ["cubic-bezier(0.34, 1.56, 0.64, 1)", "cubic-bezier(0.68, -0.4, 0.27, 1.4)"],
  linear: ["linear", "linear"],
};

const ENTRANCE_FRAMES: Record<Exclude<CustomThemeEntrance, "none">, string> = {
  fade: "from { opacity: 0; }",
  rise: "from { opacity: 0; transform: translateY(10px); }",
  slide: "from { opacity: 0; transform: translateX(-14px); }",
  pop: "from { opacity: 0; transform: scale(0.94); }",
  blur: "from { opacity: 0; filter: blur(6px); }",
};

/** Turbulence noise as a data URI (constant; no spec data in it). */
const NOISE_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** Web fonts one theme needs loaded (named families plus preset fonts not bundled). */
export function customThemeWebFonts(theme: CustomTheme): string[] {
  const t = theme.type;
  const out = new Set<string>();
  for (const family of [t.fontFamily, t.headingFontFamily, t.monoFontFamily]) {
    const name = normalizeFontFamily(family);
    if (name) out.add(name);
  }
  for (const preset of [t.font, t.headingFont, t.monoFont]) {
    const name = preset ? PRESET_WEB_FONTS[preset] : undefined;
    if (name) out.add(name);
  }
  return [...out];
}

/**
 * CSS for one generated theme. Tokens go on [data-theme="<id>"]; component
 * rules sit in @scope so they only touch that theme's surface (the app, its
 * card, or its preview), like the built-in style groups.
 */
export function customThemeCss(theme: CustomTheme): string {
  if (!isCustomThemeId(theme.id)) return "";
  const c = theme.colors;
  const x = theme.extraColors ?? {};
  const m = theme.motion ?? {};
  const sel = `[data-theme="${theme.id}"]`;
  const scope = `@scope (${sel}) to ([data-theme]:not(${sel}))`;
  const light = theme.scheme === "light";
  const ink = rgbList(c.text);
  const { layout: l, type: t, effects: e } = theme;
  const lineColor = x.border ?? undefined;
  const vars: Array<[string, string]> = [
    ["color-scheme", theme.scheme],
    ["--bg", c.bg],
    ["--bg-1", c.surface],
    ["--bg-2", c.raised],
    ["--bg-3", c.overlay],
    [
      "--line",
      lineColor ? `rgba(${rgbList(lineColor)}, 0.45)` : `rgba(${ink}, ${light ? 0.12 : 0.1})`,
    ],
    ["--line-strong", lineColor ? lineColor : `rgba(${ink}, ${light ? 0.22 : 0.18})`],
    ["--text", c.text],
    ["--muted", c.muted],
    ["--faint", c.faint],
    ["--accent", c.accent],
    ["--accent-2", c.accent2],
    ["--accent-ink", c.accentInk],
    ["--accent-text", x.link ?? customAccentText(c)],
    ["--accent-deep", mixHex(c.accent, "#000000", 0.14)],
    ["--danger", c.danger],
    ["--ok", c.ok],
    ["--warn", c.warn],
    ["--hover", `rgba(${ink}, ${light ? 0.05 : 0.04})`],
    ["--pill", `rgba(${ink}, ${light ? 0.04 : 0.03})`],
    ["--brand-hi", mixHex(c.accent, "#ffffff", 0.45)],
    ["--brand-mid", c.accent],
    ["--brand-lo", c.accent2],
    ["--desktop", mixHex(c.bg, "#000000", 0.08)],
    ["--term", light ? "#1d1f22" : mixHex(c.bg, "#000000", 0.3)],
    ["--term-fg", light ? "#e6e6e2" : c.text],
    ["--chrome", `rgba(${rgbList(x.topbar ?? c.surface)}, 0.86)`],
  ];
  if (t.font || t.fontFamily) vars.push(["--font", fontStack(t.fontFamily, t.font)]);
  if (t.monoFont || t.monoFontFamily) {
    vars.push(["--mono", fontStack(t.monoFontFamily, t.monoFont ?? "mono")]);
  }
  if (l.radius !== undefined) {
    const r = l.radius;
    vars.push(
      ["--radius-xs", `${Math.round(r * 0.35)}px`],
      ["--radius-sm", `${Math.round(r * 0.55)}px`],
      ["--radius-md", `${Math.round(r * 0.75)}px`],
      ["--radius", `${r}px`],
      ["--radius-lg", `${Math.round(r * 1.2)}px`],
      ["--radius-xl", `${Math.round(r * 1.5)}px`],
      ["--radius-pane", `${r}px`],
    );
  }
  if (l.controls === "pill") vars.push(["--radius-control", "999px"], ["--radius-pill", "999px"]);
  else if (l.controls === "square")
    vars.push(["--radius-control", "0px"], ["--radius-pill", "0px"]);
  else if (l.radius !== undefined)
    vars.push(["--radius-control", `${Math.round(l.radius * 0.55)}px`]);
  if (l.shadow) {
    const [e1, e2] = SHADOWS[l.shadow](c);
    vars.push(["--elev-1", e1], ["--elev-2", e2], ["--shadow", e2]);
  }
  if (l.density && l.density !== "cozy") {
    const k = DENSITY_SCALE[l.density];
    for (const [name, px] of SPACE_TOKENS) vars.push([name, `${round(px * k, 1)}px`]);
  }
  if (t.scale !== undefined && t.scale !== 1) {
    for (const [name, px] of TYPE_TOKENS) vars.push([name, `${round(px * t.scale, 1)}px`]);
  }
  if (m.speed) {
    const k = SPEED_SCALE[m.speed];
    vars.push(
      ["--dur-fast", `${Math.round(120 * k)}ms`],
      ["--dur-base", `${Math.round(200 * k)}ms`],
      ["--dur-slow", `${Math.round(400 * k)}ms`],
    );
  }
  if (m.easing) {
    const [std, emph] = EASINGS[m.easing];
    vars.push(["--ease-standard", std], ["--ease-emphasized", emph]);
  }
  const focus = x.focus ?? c.accent;
  switch (l.focusRing) {
    case "thick":
      vars.push(["--focus-ring", `3px solid ${focus}`], ["--focus-offset", "3px"]);
      break;
    case "dashed":
      vars.push(["--focus-ring", `2px dashed ${focus}`]);
      break;
    case "glow":
    case "accent":
      vars.push(["--focus-ring", `2px solid ${focus}`]);
      break;
    default:
      if (x.focus) vars.push(["--focus-ring", `2px solid ${focus}`]);
      break;
  }
  const bw = l.borderWidth;
  const bs = l.borderStyle ?? "solid";
  const edge = bw !== undefined ? `${bs === "double" ? Math.max(3, bw) : bw}px ${bs}` : undefined;
  const borderPaint =
    l.borderColor === "text"
      ? c.text
      : l.borderColor === "accent"
        ? c.accent
        : l.borderColor === "accent2"
          ? c.accent2
          : "var(--line-strong)";

  const rootDecls = vars.map(([k, v]) => `  ${k}: ${v};`);
  rootDecls.push("  font-family: var(--font);");
  if (t.bodyWeight) rootDecls.push(`  font-weight: ${t.bodyWeight};`);
  const out: string[] = [];
  out.push(`${sel} {\n${rootDecls.join("\n")}\n}`);

  const bg = l.background ? backgroundLayers(l.background, c, l) : undefined;
  const reduce: string[] = [];
  const backdropMotion = bg && m.backdrop && m.backdrop !== "none" ? m.backdrop : undefined;
  if (bg && !backdropMotion) {
    out.push(
      `html${sel},\nhtml${sel} body {\n  background: ${bg}, ${c.bg};\n  background-attachment: fixed;\n}`,
    );
  }
  if (bg && backdropMotion) {
    // The pattern lives on its own fixed layer so it can move on the compositor.
    const anim = `locus-${theme.id}-backdrop`;
    const frames: Record<Exclude<CustomThemeBackdropMotion, "none">, [string, string]> = {
      drift: [
        "0% { transform: translate3d(0, 0, 0) rotate(0deg); } 50% { transform: translate3d(-3%, 2%, 0) rotate(2deg); } 100% { transform: translate3d(0, 0, 0) rotate(0deg); }",
        "38s ease-in-out infinite",
      ],
      pulse: ["0%, 100% { opacity: 0.55; } 50% { opacity: 1; }", "9s ease-in-out infinite"],
      hue: [
        "from { filter: hue-rotate(0deg); } to { filter: hue-rotate(360deg); }",
        "48s linear infinite",
      ],
      pan: [
        "from { transform: translate3d(0, 0, 0); } to { transform: translate3d(-12%, -12%, 0); }",
        "60s linear infinite alternate",
      ],
    };
    const [kf, timing] = frames[backdropMotion];
    out.push(
      `html${sel} {\n  background: ${c.bg};\n}\nhtml${sel} body {\n  background: transparent;\n}`,
    );
    out.push(
      `html${sel}::before {\n  content: "";\n  position: fixed;\n  inset: -25%;\n  z-index: -1;\n  pointer-events: none;\n  background: ${bg};\n  will-change: transform, opacity;\n  animation: ${anim} ${timing};\n}`,
    );
    out.push(`@keyframes ${anim} {\n  ${kf}\n}`);
    reduce.push(`html${sel}::before {\n    animation: none;\n  }`);
  }
  if (e.vignette) {
    out.push(
      `html${sel} body::before {\n  content: "";\n  position: fixed;\n  inset: 0;\n  z-index: var(--z-chrome);\n  pointer-events: none;\n  background: radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(0, 0, 0, ${light ? 0.18 : 0.5}));\n}`,
    );
  }
  if (e.scanlines || e.noise) {
    const layers: string[] = [];
    if (e.scanlines)
      layers.push(
        `repeating-linear-gradient(to bottom, rgba(0, 0, 0, ${light ? 0.04 : 0.14}) 0 1px, transparent 1px 3px)`,
      );
    if (e.noise) layers.push(`${NOISE_SVG} 0 0 / 160px 160px`);
    out.push(
      `html${sel} body::after {\n  content: "";\n  position: fixed;\n  inset: 0;\n  z-index: var(--z-chrome);\n  pointer-events: none;\n  background: ${layers.join(", ")};${e.noise ? `\n  opacity: ${light ? 0.35 : 0.22};\n  mix-blend-mode: ${light ? "multiply" : "screen"};` : ""}\n}`,
    );
  }

  const rules: string[] = [];
  const rule = (selector: string, decls: string[]) => {
    if (decls.length)
      rules.push(`  ${selector} {\n${decls.map((d) => `    ${d};`).join("\n")}\n  }`);
  };
  if (bg)
    rule(".empty,\n  .chat,\n  .settings-page,\n  .workspace-stage,\n  .theme-preview-stage", [
      "background: transparent",
    ]);

  const blur = l.blur ?? 16;
  const panes = ".composer,\n  .empty-composer,\n  .modal,\n  .menu-pop";
  const paneDecls: string[] = [];
  if (edge) paneDecls.push(`border: ${edge} ${bw === 0 ? "transparent" : borderPaint}`);
  else if (l.borderColor && l.borderColor !== "line")
    paneDecls.push(`border-color: ${borderPaint}`);
  switch (l.pane) {
    case "glass":
      paneDecls.push(
        `background: rgba(${rgbList(c.surface)}, ${light ? 0.62 : 0.55})`,
        `backdrop-filter: blur(${blur}px) saturate(1.4)`,
      );
      break;
    case "outline":
      paneDecls.push("background: transparent");
      if (!edge) paneDecls.push(`border: 1px solid ${borderPaint}`);
      break;
    case "raised":
      paneDecls.push("background: var(--bg-1)", "box-shadow: var(--elev-2)");
      break;
    case "flat":
      paneDecls.push("background: var(--bg-2)", "box-shadow: none");
      if (!edge) paneDecls.push("border-color: transparent");
      break;
    case "solid":
      paneDecls.push("background: var(--bg-1)");
      break;
    default:
      break;
  }
  if (l.shadow && l.pane !== "flat" && l.pane !== "raised")
    paneDecls.push("box-shadow: var(--elev-2)");
  rule(panes, paneDecls);
  if (l.shadow === "hard" || l.shadow === "glow") {
    rule(".composer:has(textarea:focus-visible),\n  .empty-composer:has(textarea:focus-visible)", [
      l.shadow === "hard"
        ? `box-shadow: 5px 5px 0 ${c.accent}`
        : `box-shadow: 0 0 0 1px ${c.accent}, 0 0 26px rgba(${rgbList(c.accent)}, 0.45)`,
    ]);
  }

  if (edge) {
    const divider = `${edge} ${bw === 0 ? "transparent" : borderPaint}`;
    rule(".sidebar,\n  .side-rail,\n  .chat", [`border-right: ${divider}`]);
    rule(".topbar", [`border-bottom: ${divider}`]);
  }

  /** Scoped text tokens for a filled surface, so labels inside stay readable. */
  const surfaceInk = (fill: string): string[] => {
    const fg = inkOn(fill, c.text);
    return [
      `background: ${fill}`,
      `--text: ${fg}`,
      `--muted: ${pushContrast(mixHex(fg, fill, 0.25), fill, 4.5)}`,
      `--faint: ${pushContrast(mixHex(fg, fill, 0.4), fill, 4.5)}`,
      `color: ${fg}`,
    ];
  };

  switch (l.sidebar) {
    case "tinted":
      rule(".sidebar,\n  .side-rail", [
        `background: ${mixHex(c.surface, c.accent, light ? 0.08 : 0.1)}`,
      ]);
      break;
    case "accent": {
      const railInk =
        hexContrast("#ffffff", c.accent) >= hexContrast("#111111", c.accent)
          ? "#ffffff"
          : "#111111";
      rule(".side-rail", [`background: ${c.accent}`, `color: ${railInk}`]);
      rule(".side-rail button", [`color: ${railInk}`]);
      rule('.side-rail button.on,\n  .side-rail button[aria-current="page"]', [
        `background: rgba(${rgbList(railInk)}, 0.18)`,
        `color: ${railInk}`,
      ]);
      rule(".sidebar", [`background: ${mixHex(c.surface, c.accent, 0.06)}`]);
      break;
    }
    case "inverted": {
      const inv = c.text;
      const invInk = c.bg;
      rule(".side-rail", [`background: ${inv}`, `color: ${invInk}`]);
      rule(".side-rail button", [`color: ${invInk}`]);
      rule('.side-rail button.on,\n  .side-rail button[aria-current="page"]', [
        `background: ${c.accent}`,
        `color: ${c.accentInk}`,
      ]);
      break;
    }
    default:
      break;
  }
  if (x.sidebar) rule(".sidebar", surfaceInk(x.sidebar));
  if (x.rail) {
    const railInk = inkOn(x.rail, c.text);
    rule(".side-rail", [`background: ${x.rail}`, `color: ${railInk}`]);
    rule(".side-rail button", [`color: ${railInk}`]);
  }

  const topbarFill = x.topbar ?? (l.topbar === "accent" ? c.accent : undefined);
  switch (l.topbar) {
    case "transparent":
      rule(".topbar", ["background: transparent", "box-shadow: none"]);
      break;
    case "glass":
      rule(".topbar", [
        `background: rgba(${rgbList(x.topbar ?? c.surface)}, ${light ? 0.6 : 0.5})`,
        `backdrop-filter: blur(${blur}px) saturate(1.4)`,
      ]);
      break;
    default:
      if (topbarFill) rule(".topbar", surfaceInk(topbarFill));
      break;
  }

  const bubbleWidth = l.messageWidth;
  if (bubbleWidth) rule(".msg,\n  .chat-new-divider", [`max-width: ${bubbleWidth}px`]);

  switch (l.bubble) {
    case "outline":
      rule(".msg.user .bubble", [
        "background: transparent",
        "border: 1px solid var(--line-strong)",
      ]);
      break;
    case "accent":
      rule(".msg.user .bubble", [
        `background: ${c.accent}`,
        `color: ${c.accentInk}`,
        "border-color: transparent",
      ]);
      break;
    case "quote":
      rule(".msg.user .bubble", [
        "background: transparent",
        "border: 0",
        `border-left: 3px solid ${c.accent}`,
        "border-radius: 0",
        "font-style: italic",
      ]);
      break;
    case "plain":
      rule(".msg.user .bubble", ["background: transparent", "border-color: transparent"]);
      break;
    case "filled":
      rule(".msg.user .bubble", ["background: var(--bg-2)"]);
      break;
    default:
      break;
  }
  if (x.userBubble && l.bubble !== "accent" && l.bubble !== "plain") {
    rule(".msg.user .bubble", surfaceInk(x.userBubble));
  }
  if (edge && l.bubble !== "quote" && l.bubble !== "plain") {
    rule(".msg.user .bubble", [`border: ${edge} ${borderPaint}`]);
  }

  const bubbleType: string[] = [];
  if (t.lineHeight) bubbleType.push(`line-height: ${t.lineHeight}`);
  if (t.scale !== undefined && t.scale !== 1)
    bubbleType.push(`font-size: calc(var(--chat-font) * ${t.scale})`);
  rule(".msg .bubble", bubbleType);
  if (t.bodyTracking !== undefined)
    rule(":scope,\n  body", [`letter-spacing: ${t.bodyTracking}em`]);

  switch (t.links) {
    case "underline":
      rule(".bubble a", ["text-decoration: underline", "text-underline-offset: 0.18em"]);
      break;
    case "dotted":
      rule(".bubble a", [
        "text-decoration: underline dotted",
        "text-decoration-thickness: 2px",
        "text-underline-offset: 0.2em",
      ]);
      break;
    case "plain":
      rule(".bubble a", ["text-decoration: none"]);
      rule(".bubble a:hover", ["text-decoration: underline"]);
      break;
    case "highlight":
      rule(".bubble a", [
        "text-decoration: none",
        `background: linear-gradient(transparent 60%, rgba(${rgbList(c.accent)}, 0.35) 0)`,
        "color: var(--text)",
      ]);
      break;
    default:
      break;
  }
  if (x.link) rule(".bubble a", [`color: ${x.link}`]);
  if (x.selection) {
    rule("::selection", [`background: ${x.selection}`, `color: ${inkOn(x.selection, c.text)}`]);
  }

  // Buttons: border, shape and hover/press feel.
  const hover: CustomThemeHover | undefined = m.hover ?? (e.lift ? "lift" : undefined);
  const btn: string[] = [];
  if (edge) btn.push(`border: ${edge} ${borderPaint}`);
  if (hover && hover !== "none")
    btn.push(
      "transition: transform var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard), background var(--dur-fast), border-color var(--dur-fast), filter var(--dur-fast)",
    );
  if (l.shadow === "hard") btn.push(`box-shadow: 2px 2px 0 ${c.text}`);
  rule(".btn", btn);
  switch (hover) {
    case "lift":
      rule(".btn:hover", ["transform: translateY(-1px)"]);
      reduce.push(`.btn:hover {\n      transform: none;\n    }`);
      break;
    case "grow":
      rule(".btn:hover", ["transform: scale(1.04)"]);
      reduce.push(`.btn:hover {\n      transform: none;\n    }`);
      break;
    case "press":
      rule(".btn:hover", ["transform: translateY(1px)"]);
      rule(".btn:active", ["transform: translateY(2px) scale(0.98)"]);
      reduce.push(`.btn:hover,\n    .btn:active {\n      transform: none;\n    }`);
      break;
    case "glow":
      rule(".btn:hover", [
        `box-shadow: 0 0 0 1px ${c.accent}, 0 0 14px rgba(${rgbList(c.accent)}, 0.45)`,
      ]);
      break;
    case "shine":
      rule(".btn.primary", [
        `background-image: linear-gradient(110deg, transparent 35%, rgba(255, 255, 255, 0.35) 50%, transparent 65%)`,
        "background-size: 250% 100%",
        "background-position: 120% 0",
        "background-repeat: no-repeat",
        "transition: background-position var(--dur-slow) var(--ease-standard)",
      ]);
      rule(".btn.primary:hover", ["background-position: -20% 0"]);
      break;
    default:
      break;
  }
  switch (l.button) {
    case "outline":
      rule(".btn.primary", [
        "background-color: transparent",
        `color: ${c.accent}`,
        `border: ${bw && bw > 1 ? bw : 1.5}px solid ${c.accent}`,
      ]);
      rule(".btn.primary:hover", [`background-color: rgba(${rgbList(c.accent)}, 0.12)`]);
      break;
    case "gradient":
      rule(".btn.primary", [
        `background: linear-gradient(135deg, ${c.accent}, ${mixHex(c.accent, c.accent2, 0.55)})`,
        `color: ${c.accentInk}`,
        "border-color: transparent",
      ]);
      break;
    case "glow":
      rule(".btn.primary", [
        `background: ${c.accent}`,
        `color: ${c.accentInk}`,
        `box-shadow: 0 0 16px rgba(${rgbList(c.accent)}, 0.55)`,
      ]);
      break;
    default:
      break;
  }
  rule(
    ".btn.icon,\n  .btn.chip,\n  .side-rail button",
    edge || l.shadow === "hard" ? ["border-color: transparent", "box-shadow: none"] : [],
  );

  if (l.focusRing === "glow") {
    rule(":focus-visible", [`box-shadow: 0 0 0 4px rgba(${rgbList(focus)}, 0.35)`]);
  }
  switch (l.scrollbar) {
    case "thin":
      rule("*", ["scrollbar-width: thin", "scrollbar-color: var(--line-strong) transparent"]);
      break;
    case "accent":
      rule("*", ["scrollbar-color: var(--accent) transparent"]);
      break;
    default:
      break;
  }

  const heading: string[] = [];
  if (t.headingFont || t.headingFontFamily)
    heading.push(`font-family: ${fontStack(t.headingFontFamily, t.headingFont)}`);
  if (t.headingWeight) heading.push(`font-weight: ${t.headingWeight}`);
  if (t.headingTracking !== undefined) heading.push(`letter-spacing: ${t.headingTracking}em`);
  if (t.headingCase === "upper") heading.push("text-transform: uppercase");
  if (t.headingCase === "lower") heading.push("text-transform: lowercase");
  if (t.headingItalic) heading.push("font-style: italic");
  if (x.heading) heading.push(`color: ${x.heading}`);
  switch (t.headingStyle) {
    case "gradient":
      heading.push(
        `background: linear-gradient(90deg, ${c.accent}, ${c.accent2})`,
        // Size the box to the text so short headings show the whole gradient.
        "width: fit-content",
        "max-width: 100%",
        "-webkit-background-clip: text",
        "background-clip: text",
        "-webkit-text-fill-color: transparent",
      );
      break;
    case "underline":
      heading.push(
        "text-decoration: underline",
        `text-decoration-color: ${c.accent}`,
        "text-decoration-thickness: 0.12em",
        "text-underline-offset: 0.22em",
      );
      break;
    case "highlight":
      heading.push(
        `background: linear-gradient(transparent 58%, rgba(${rgbList(c.accent)}, 0.4) 0)`,
        "box-decoration-break: clone",
        "-webkit-box-decoration-break: clone",
      );
      break;
    case "outline":
      heading.push(
        `-webkit-text-stroke: 1px ${x.heading ?? c.text}`,
        "-webkit-text-fill-color: transparent",
      );
      break;
    default:
      break;
  }
  if (e.glow) {
    // text-shadow paints over clipped or stroked text, so those styles glow with a filter.
    const clipped = t.headingStyle === "gradient" || t.headingStyle === "outline";
    heading.push(
      clipped
        ? `filter: drop-shadow(0 0 6px rgba(${rgbList(c.accent)}, 0.55))`
        : `text-shadow: 0 0 10px rgba(${rgbList(c.accent)}, 0.65)`,
    );
  }
  rule("h1,\n  h2,\n  h3", heading);
  if (e.glow && l.button !== "glow") {
    rule(".btn.primary", [`box-shadow: 0 0 14px rgba(${rgbList(c.accent)}, 0.5)`]);
  }

  // Messages animate once when they mount; streaming updates keep the same node.
  if (m.enter && m.enter !== "none") {
    const anim = `locus-${theme.id}-enter`;
    out.push(`@keyframes ${anim} {\n  ${ENTRANCE_FRAMES[m.enter]}\n}`);
    rule(".msg", [`animation: ${anim} var(--dur-slow) var(--ease-emphasized) backwards`]);
    reduce.push(`.msg {\n      animation: none;\n    }`);
  }

  if (rules.length) out.push(`${scope} {\n${rules.join("\n")}\n}`);
  if (reduce.length) {
    const scoped = reduce.filter((r) => !r.startsWith("html"));
    const global = reduce.filter((r) => r.startsWith("html"));
    const parts: string[] = [];
    if (scoped.length) parts.push(`  ${scope} {\n    ${scoped.join("\n    ")}\n  }`);
    if (global.length) parts.push(`  ${global.join("\n  ")}`);
    out.push(`@media (prefers-reduced-motion: reduce) {\n${parts.join("\n")}\n}`);
  }
  // Cards and previews: show the backdrop and the corner shape.
  const thumb = [
    `.theme-thumb${sel},\n.theme-preview${sel} {`,
    `  background: ${bg ? `${bg}, ` : ""}${c.bg};`,
  ];
  if (edge) thumb.push(`  border: ${edge} ${borderPaint};`);
  if (l.radius !== undefined) thumb.push(`  border-radius: ${Math.min(16, l.radius)}px;`);
  thumb.push("}");
  out.push(thumb.join("\n"));
  out.push(`.theme-thumb${sel} .theme-thumb-stage {\n  background: transparent;\n}`);
  return out.join("\n");
}

export function customThemesCss(themes: readonly CustomTheme[] | undefined): string {
  return (themes ?? []).map(customThemeCss).filter(Boolean).join("\n\n");
}

// ─────────────────────────── Generation prompt ───────────────────────────

const q = (list: readonly string[]) => list.map((s) => `"${s}"`).join("|");

/** JSON shape the model is asked for, shared by the Generate button and the agent tool. */
export const CUSTOM_THEME_SPEC_GUIDE = `Theme JSON fields (all optional except name and colors.bg/text/accent):
{
  "name": "2-3 words",
  "summary": "one short sentence",
  "scheme": "light" | "dark",
  "base": null | ${THEME_STYLES.map((s) => `"${s}"`).join(" | ")}   // optional structural group to build on
  "colors": { ${CUSTOM_THEME_COLOR_KEYS.map((k) => `"${k}"`).join(", ")} },   // 6-digit hex only
  "extraColors": { ${CUSTOM_THEME_EXTRA_COLOR_KEYS.map((k) => `"${k}"`).join(", ")} },   // optional per-surface hex; text on rail/sidebar/topbar/userBubble is picked for contrast
  "layout": {
    "radius": 0-32, "controls": "match"|"pill"|"square",
    "borderWidth": 0-4, "borderStyle": ${q(CUSTOM_THEME_BORDER_STYLES)}, "borderColor": ${q(CUSTOM_THEME_BORDER_COLORS)},
    "shadow": ${q(CUSTOM_THEME_SHADOWS)},
    "pane": ${q(CUSTOM_THEME_PANES)}, "blur": 0-40,
    "background": ${q(CUSTOM_THEME_BACKGROUNDS)},
    "backgroundColors": ["#hex", …up to 4], "backgroundAngle": 0-360, "backgroundIntensity": 0-1, "patternScale": 0.5-4,
    "sidebar": ${q(CUSTOM_THEME_SIDEBARS)}, "topbar": ${q(CUSTOM_THEME_TOPBARS)},
    "bubble": ${q(CUSTOM_THEME_BUBBLES)}, "messageWidth": 560-1200,
    "button": ${q(CUSTOM_THEME_BUTTONS)},
    "density": ${q(CUSTOM_THEME_DENSITIES)}, "focusRing": ${q(CUSTOM_THEME_FOCUS_RINGS)}, "scrollbar": ${q(CUSTOM_THEME_SCROLLBARS)}
  },
  "type": {
    "font": ${q(CUSTOM_THEME_FONTS)},
    "headingFont": (same list), "monoFont": (same list),
    "fontFamily": "any Google Fonts family name, e.g. Space Grotesk", "headingFontFamily": "…", "monoFontFamily": "…",   // overrides the preset; the preset stays as fallback
    "scale": 0.85-1.3, "bodyWeight": 300-700, "bodyTracking": -0.03-0.1, "lineHeight": 1.2-2,
    "headingCase": ${q(CUSTOM_THEME_CASES)}, "headingWeight": 300-900, "headingTracking": -0.05-0.3, "headingItalic": boolean,
    "headingStyle": ${q(CUSTOM_THEME_HEADING_STYLES)}, "links": ${q(CUSTOM_THEME_LINK_STYLES)}
  },
  "motion": {
    "speed": ${q(CUSTOM_THEME_SPEEDS)}, "easing": ${q(CUSTOM_THEME_EASINGS)},
    "enter": ${q(CUSTOM_THEME_ENTRANCES)},   // how new chat messages appear
    "hover": ${q(CUSTOM_THEME_HOVERS)},   // button hover feel
    "backdrop": ${q(CUSTOM_THEME_BACKDROP_MOTIONS)}   // slow ambient animation of a patterned background
  },
  "effects": { "scanlines": boolean, "vignette": boolean, "noise": boolean, "glow": boolean, "lift": boolean }
}
All motion turns off for people who ask for reduced motion.
Body text must stay readable: text and muted on bg and surface need 4.5:1 contrast, accentInk on accent 4.5:1. Unreadable pairs are corrected automatically.`;

export const CUSTOM_THEME_SYSTEM_PROMPT = `You design visual themes for Locus, a desktop app with a left icon rail, a sidebar list, a top bar, a chat thread with user bubbles, a composer box, buttons, and modals.
Reply with ONE JSON object and nothing else — no prose, no code fences.
Make bold, cohesive choices that match the request: pick colours, structure, type, motion and effects together so the result feels distinct, not a recolour. Use the full vocabulary — per-surface extraColors, backdrop colours and angle, a fitting Google font by name, density, heading style, and motion that suits the mood (calm themes move slowly and smoothly; playful ones can bounce). Leave a field out rather than guess when the request gives no reason for it. Use "base" only when one of those groups clearly fits the request.
${CUSTOM_THEME_SPEC_GUIDE}`;

/** Pulls the first JSON object out of model text (tolerates fences and chatter). */
export function parseCustomThemeJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return a theme");
  return JSON.parse(body.slice(start, end + 1));
}

// ─────────────────────────── Agent tool ───────────────────────────

export const MANAGE_THEME_NAME = "manage_theme";

export const MANAGE_THEME_TOOL: ExtraToolDef = {
  name: MANAGE_THEME_NAME,
  description: `Create, update, apply, list, or delete the operator's generated app themes (Settings → Appearance → Generated). Host-side; changes the Locus UI itself, not a project. Use when the operator asks to make, tweak, or switch the app's look. Prefer action "create" with apply true unless they say otherwise.\n${CUSTOM_THEME_SPEC_GUIDE}`,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "apply", "delete", "list"],
        description: "create / update / apply / delete / list",
      },
      id: {
        type: "string",
        description:
          "Theme id for update/apply/delete (custom-…). apply also accepts a built-in theme id such as ember or nord.",
      },
      theme: {
        type: "string",
        description:
          "create/update: theme JSON as described above. update merges these fields into the existing theme.",
      },
      apply: {
        type: "string",
        enum: ["true", "false"],
        description: "create/update: switch the app to this theme (default true).",
      },
    },
    required: ["action"],
  },
};

export function isManageThemeName(name: string): boolean {
  return name === MANAGE_THEME_NAME;
}

export interface ThemeManageResult {
  ok: boolean;
  output: string;
  themes: CustomTheme[];
  /** New config.theme when the action switches themes. */
  theme?: ThemeRef;
}

function mergeDeep(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const prev = out[key];
    out[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      prev &&
      typeof prev === "object"
        ? mergeDeep(prev as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return out;
}

function describeTheme(theme: CustomTheme): string {
  const bits = [theme.scheme, theme.base ? `on ${theme.base}` : "", theme.layout.background ?? ""]
    .filter(Boolean)
    .join(", ");
  return `${theme.name} (${theme.id}; ${bits})`;
}

/** Pure reducer behind the manage_theme tool. */
export function applyThemeManageAction(
  themes: readonly CustomTheme[],
  args: Record<string, unknown>,
  now = new Date().toISOString(),
): ThemeManageResult {
  const action = typeof args.action === "string" ? args.action : "";
  const list = [...themes];
  const applyFlag = args.apply !== "false" && args.apply !== false;
  const parseSpec = (): Record<string, unknown> | string => {
    const raw = args.theme;
    if (raw && typeof raw === "object") return raw as Record<string, unknown>;
    if (typeof raw !== "string" || !raw.trim()) return "Pass the theme as JSON in `theme`.";
    try {
      const parsed = parseCustomThemeJson(raw);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : "Theme JSON must be an object.";
    } catch {
      return "Theme JSON did not parse.";
    }
  };
  switch (action) {
    case "list": {
      if (!list.length) return { ok: true, output: "No generated themes yet.", themes: list };
      return {
        ok: true,
        output: list.map((t) => `- ${describeTheme(t)}`).join("\n"),
        themes: list,
      };
    }
    case "create": {
      if (list.length >= MAX_CUSTOM_THEMES) {
        return {
          ok: false,
          output: `Limit of ${MAX_CUSTOM_THEMES} generated themes reached; delete one first.`,
          themes: list,
        };
      }
      const spec = parseSpec();
      if (typeof spec === "string") return { ok: false, output: spec, themes: list };
      const theme = customThemeFromInput(
        { ...spec, id: undefined },
        { taken: list.map((t) => t.id), origin: "ai", now },
      );
      list.push(theme);
      const issues = customThemeContrastIssues(theme.colors).length;
      return {
        ok: true,
        output: `Created ${describeTheme(theme)}${applyFlag ? " and applied it" : ""}.${issues ? "" : " Contrast checks pass."}`,
        themes: list,
        ...(applyFlag ? { theme: theme.id } : {}),
      };
    }
    case "update": {
      const index = list.findIndex((t) => t.id === args.id || t.name === args.id);
      if (index < 0)
        return { ok: false, output: `No generated theme ${String(args.id ?? "")}.`, themes: list };
      const spec = parseSpec();
      if (typeof spec === "string") return { ok: false, output: spec, themes: list };
      const current = list[index]!;
      const merged = mergeDeep(current as unknown as Record<string, unknown>, spec);
      const theme = customThemeFromInput(merged, { id: current.id, origin: current.origin, now });
      theme.createdAt = current.createdAt;
      list[index] = theme;
      return {
        ok: true,
        output: `Updated ${describeTheme(theme)}${applyFlag ? " and applied it" : ""}.`,
        themes: list,
        ...(applyFlag ? { theme: theme.id } : {}),
      };
    }
    case "apply": {
      const id = args.id;
      if (typeof id === "string" && isThemeId(id))
        return { ok: true, output: `Applied ${id}.`, themes: list, theme: id };
      const found = list.find((t) => t.id === id || t.name === id);
      if (!found) return { ok: false, output: `No theme ${String(id ?? "")}.`, themes: list };
      return { ok: true, output: `Applied ${found.name}.`, themes: list, theme: found.id };
    }
    case "delete": {
      const index = list.findIndex((t) => t.id === args.id || t.name === args.id);
      if (index < 0)
        return { ok: false, output: `No generated theme ${String(args.id ?? "")}.`, themes: list };
      const [gone] = list.splice(index, 1);
      return { ok: true, output: `Deleted ${gone!.name}.`, themes: list };
    }
    default:
      return {
        ok: false,
        output: "action must be create, update, apply, delete, or list.",
        themes: list,
      };
  }
}
