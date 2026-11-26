import {
  findCustomTheme,
  normalizeThemeHex,
  resolveThemeRef,
  type CustomTheme,
  type ThemeRef,
} from "./customTheme.js";
import type { LocusConfig } from "./config.js";
import { isThemeId, themeOption } from "./theme.js";

const WORKSPACE_KEY = /^(project|repo):[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const MAX_WORKSPACE_ACCENTS = 256;
const MAX_SCHEDULE_SLOTS = 8;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** From `at` (HH:MM, local time) until the next slot, use `theme`. */
export interface ThemeScheduleSlot {
  at: string;
  theme: ThemeRef;
}

export interface ThemePreferences {
  followSystem?: boolean;
  light?: ThemeRef;
  dark?: ThemeRef;
  workspaceAccents?: Record<string, string>;
  /** Time-of-day switching; wins over followSystem while on. */
  scheduleOn?: boolean;
  schedule?: ThemeScheduleSlot[];
  /** A whole theme per project or repository; wins over everything else there. */
  workspaceThemes?: Record<string, ThemeRef>;
}

/** Whether a theme can stand in for `scheme` (its own scheme, or adaptive). */
export function themeFitsScheme(
  id: ThemeRef,
  scheme: "light" | "dark",
  themes?: readonly CustomTheme[],
): boolean {
  if (isThemeId(id)) {
    const opt = themeOption(id);
    return opt.scheme === scheme || opt.adaptive === true;
  }
  const custom = findCustomTheme(id, themes);
  return custom ? custom.scheme === scheme || custom.adaptive === true : false;
}

/** Minutes since local midnight. */
export function minuteOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** The scheduled theme for a time: the latest slot at or before it, wrapping past midnight. */
export function scheduledTheme(
  schedule: readonly ThemeScheduleSlot[] | undefined,
  minute: number,
): ThemeRef | undefined {
  if (!schedule?.length) return undefined;
  const toMin = (at: string) => Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5));
  const sorted = [...schedule].sort((a, b) => toMin(a.at) - toMin(b.at));
  let pick = sorted[sorted.length - 1]!;
  for (const slot of sorted) if (toMin(slot.at) <= minute) pick = slot;
  return pick.theme;
}

export function normalizeThemePreferences(
  raw: unknown,
  themes?: readonly CustomTheme[],
): ThemePreferences | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const input = raw as Record<string, unknown>;
  const out: ThemePreferences = {};
  if (typeof input.followSystem === "boolean") out.followSystem = input.followSystem;
  for (const scheme of ["light", "dark"] as const) {
    const id = input[scheme];
    const known = typeof id === "string" && (isThemeId(id) || findCustomTheme(id, themes));
    if (known && themeFitsScheme(id as ThemeRef, scheme, themes)) out[scheme] = id as ThemeRef;
  }
  const isKnown = (id: unknown): id is ThemeRef =>
    typeof id === "string" && (isThemeId(id) || Boolean(findCustomTheme(id, themes)));
  if (typeof input.scheduleOn === "boolean") out.scheduleOn = input.scheduleOn;
  if (Array.isArray(input.schedule)) {
    const seen = new Set<string>();
    const slots: ThemeScheduleSlot[] = [];
    for (const row of input.schedule) {
      const at = (row as { at?: unknown })?.at;
      const theme = (row as { theme?: unknown })?.theme;
      if (typeof at !== "string" || !TIME_RE.test(at) || seen.has(at) || !isKnown(theme)) continue;
      seen.add(at);
      slots.push({ at, theme });
      if (slots.length === MAX_SCHEDULE_SLOTS) break;
    }
    if (slots.length) out.schedule = slots;
  }
  if (input.workspaceThemes && typeof input.workspaceThemes === "object") {
    const entries: [string, ThemeRef][] = [];
    for (const [key, value] of Object.entries(input.workspaceThemes)) {
      if (WORKSPACE_KEY.test(key) && isKnown(value)) entries.push([key, value]);
      if (entries.length === MAX_WORKSPACE_ACCENTS) break;
    }
    if (entries.length) out.workspaceThemes = Object.fromEntries(entries);
  }
  if (input.workspaceAccents && typeof input.workspaceAccents === "object") {
    const entries: [string, string][] = [];
    for (const [key, value] of Object.entries(input.workspaceAccents)) {
      const hex = normalizeThemeHex(value);
      if (WORKSPACE_KEY.test(key) && hex) entries.push([key, hex]);
      if (entries.length === MAX_WORKSPACE_ACCENTS) break;
    }
    if (entries.length) out.workspaceAccents = Object.fromEntries(entries);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The theme to show. Precedence: the current workspace's own theme, then the
 * time-of-day schedule, then light/dark following the system, then the fixed pick.
 */
export function activeThemeRef(
  theme: unknown,
  preferences: ThemePreferences | undefined,
  dark: boolean,
  themes?: readonly CustomTheme[],
  context: { minute?: number; workspaceKey?: string } = {},
): ThemeRef {
  const workspace = context.workspaceKey
    ? preferences?.workspaceThemes?.[context.workspaceKey]
    : undefined;
  const valid = (id: ThemeRef | undefined): id is ThemeRef =>
    Boolean(id) && (isThemeId(id!) || Boolean(findCustomTheme(id, themes)));
  if (valid(workspace)) return workspace;
  if (preferences?.scheduleOn && preferences.schedule?.length && context.minute !== undefined) {
    const slot = scheduledTheme(preferences.schedule, context.minute);
    if (valid(slot)) return slot;
  }
  if (!preferences?.followSystem) return resolveThemeRef(theme, themes);
  const scheme = dark ? "dark" : "light";
  const id = resolveThemeRef(preferences[scheme], themes, dark ? "ember" : "paper");
  return themeFitsScheme(id, scheme, themes) ? id : dark ? "ember" : "paper";
}

/** An explicit selection overrides automatic switching but keeps the pair for later. */
export function selectFixedTheme(config: LocusConfig, theme: ThemeRef): LocusConfig {
  const prefs = config.themePreferences;
  return prefs?.followSystem || prefs?.scheduleOn
    ? { ...config, theme, themePreferences: { ...prefs, followSystem: false, scheduleOn: false } }
    : { ...config, theme };
}
