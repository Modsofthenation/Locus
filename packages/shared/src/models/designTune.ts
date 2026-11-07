export const DESIGN_TUNE_KEYS = ["space", "radius", "type"] as const;
export type DesignTuneKey = (typeof DESIGN_TUNE_KEYS)[number];

export interface DesignTuneRange {
  key: DesignTuneKey;
  min: number;
  max: number;
}

export interface DesignTune {
  radiusPx?: number;
  spacePx?: number;
  fontPx?: number;
  gravity?: number;
  jump?: number;
  fireRate?: number;
  shake?: number;
  hitStop?: number;
  volume?: number;
  seed?: number;
  head?: number;
  arms?: number;
  legs?: number;
  twist?: number;
}

const KEY_ALIASES: Record<string, DesignTuneKey> = {
  space: "space",
  spacing: "space",
  "--space": "space",
  radius: "radius",
  "--radius": "radius",
  type: "type",
  "type-scale": "type",
  font: "type",
  "--font-size": "type",
};

const DEFAULT_RANGE: Record<DesignTuneKey, { min: number; max: number }> = {
  space: { min: 4, max: 32 },
  radius: { min: 0, max: 48 },
  type: { min: 10, max: 28 },
};

export function parseDesignTune(value: unknown): DesignTune | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const radiusPx = clampTune(row.radiusPx, 0, 48);
  const spacePx = clampTune(row.spacePx, 4, 32);
  const fontPx = clampTune(row.fontPx, 10, 28);
  const gravity = clampTune(row.gravity, 20, 160);
  const jump = clampTune(row.jump, 4, 32);
  const fireRate = clampTune(row.fireRate, 2, 24);
  const shake = clampTune(row.shake, 0, 24);
  const hitStop = clampTune(row.hitStop, 0, 16);
  const volume = clampTune(row.volume, 0, 100);
  const seed = clampTune(row.seed, 0, 9999);
  const head = clampTune(row.head, -45, 45);
  const arms = clampTune(row.arms, -80, 80);
  const legs = clampTune(row.legs, -60, 60);
  const twist = clampTune(row.twist, -45, 45);
  const next: DesignTune = {};
  if (radiusPx != null) next.radiusPx = radiusPx;
  if (spacePx != null) next.spacePx = spacePx;
  if (fontPx != null) next.fontPx = fontPx;
  if (gravity != null) next.gravity = gravity;
  if (jump != null) next.jump = jump;
  if (fireRate != null) next.fireRate = fireRate;
  if (shake != null) next.shake = shake;
  if (hitStop != null) next.hitStop = hitStop;
  if (volume != null) next.volume = volume;
  if (seed != null) next.seed = seed;
  if (head != null) next.head = head;
  if (arms != null) next.arms = arms;
  if (legs != null) next.legs = legs;
  if (twist != null) next.twist = twist;
  return Object.keys(next).length ? next : undefined;
}

export function clampTune(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Read `data-tune="space:4-16,radius:0-24"` from the canvas. */
export function parseCanvasTuneAttrs(html: string): DesignTuneRange[] {
  const match = html.match(/\bdata-tune\s*=\s*["']([^"']+)["']/i);
  if (!match?.[1]) return defaultTuneRanges();
  const found = new Map<DesignTuneKey, DesignTuneRange>();
  for (const part of match[1].split(",")) {
    const item = part.trim().match(/^([a-z-]+)\s*:\s*(\d+)\s*-\s*(\d+)$/i);
    if (!item) continue;
    const key = KEY_ALIASES[item[1]!.toLowerCase()];
    if (!key) continue;
    const min = Number(item[2]);
    const max = Number(item[3]);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) continue;
    const bounds = DEFAULT_RANGE[key];
    found.set(key, {
      key,
      min: Math.max(bounds.min, Math.round(min)),
      max: Math.min(bounds.max, Math.round(max)),
    });
  }
  const out = DESIGN_TUNE_KEYS.map((key) => found.get(key) ?? { key, ...DEFAULT_RANGE[key] });
  return out;
}

export function defaultTuneRanges(): DesignTuneRange[] {
  return DESIGN_TUNE_KEYS.map((key) => ({ key, ...DEFAULT_RANGE[key] }));
}
