/**
 * Theme inheritance: a generated theme can extend a crafted built-in, a token
 * built-in, or another generated theme. It stores only its `overrides`; the
 * full theme is the base merged with them, recomputed on every load so a
 * change to the base flows through to everything built on it.
 */
import { craftedTheme } from "./craftedThemes.js";
import {
  applyThemeManageActionRows,
  customThemeFromInput,
  isCustomThemeId,
  mergeDeep,
  normalizeCustomThemeRows,
  parseCustomThemeJson,
  type CustomTheme,
  type ThemeManageResult,
} from "./customTheme.js";
import { isCraftedThemeId, themeOption, isThemeId } from "./theme.js";
import { isTokenThemeId, tokenThemeSpec } from "./tokenThemes.js";

/** Bookkeeping fields that never take part in a merge or a diff. */
const META = new Set(["id", "createdAt", "updatedAt", "origin", "extends", "overrides"]);
const MAX_DEPTH = 6;

function isPlain(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** A theme as a spec with no bookkeeping, ready to merge or diff. */
export function themeAsSpec(theme: CustomTheme): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(JSON.parse(JSON.stringify(theme)) as Record<string, unknown>).filter(
      ([key]) => !META.has(key),
    ),
  );
}

/** Whether `ref` names something a theme can extend. */
export function isExtendableTheme(ref: unknown, themes: readonly CustomTheme[]): boolean {
  if (isCraftedThemeId(ref) || isTokenThemeId(ref)) return true;
  return isCustomThemeId(ref) && themes.some((t) => t.id === ref);
}

/** The full spec of an extendable theme, resolved through its own bases. */
export function themeBaseSpec(
  ref: unknown,
  themes: readonly CustomTheme[],
  seen: ReadonlySet<string> = new Set(),
): Record<string, unknown> | undefined {
  if (typeof ref !== "string" || seen.has(ref) || seen.size >= MAX_DEPTH) return undefined;
  if (isCraftedThemeId(ref)) return themeAsSpec(craftedTheme(ref)!);
  if (isTokenThemeId(ref)) return tokenThemeSpec(ref);
  const found = isCustomThemeId(ref) ? themes.find((t) => t.id === ref) : undefined;
  if (!found) return undefined;
  return themeAsSpec(materializeTheme(found, themes, new Set([...seen, ref])));
}

/**
 * What a spec changes relative to its base: leaves that differ, nested
 * objects recursed, and `null` for values the base has and the spec dropped.
 * Name and summary are always kept.
 */
export function diffThemeSpec(
  spec: Record<string, unknown>,
  base: Record<string, unknown>,
  top = true,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(spec)) {
    if (META.has(key) && top) continue;
    const prev = base[key];
    if (isPlain(value) && (isPlain(prev) || prev === undefined)) {
      const nested = diffThemeSpec(value, isPlain(prev) ? prev : {}, false);
      if (Object.keys(nested).length) out[key] = nested;
    } else if (JSON.stringify(value) !== JSON.stringify(prev)) {
      out[key] = value;
    }
  }
  for (const key of Object.keys(base)) {
    if (!(key in spec) && !(top && META.has(key)) && base[key] !== undefined) out[key] = null;
  }
  if (top) {
    if (typeof spec.name === "string") out.name = spec.name;
    if (typeof spec.summary === "string") out.summary = spec.summary;
  }
  return out;
}

/**
 * The theme with its base re-applied. A theme whose base is gone keeps its
 * last merged fields and loses the link.
 */
export function materializeTheme(
  theme: CustomTheme,
  themes: readonly CustomTheme[],
  seen: ReadonlySet<string> = new Set([theme.id]),
): CustomTheme {
  if (!theme.extends) return theme;
  const base = themeBaseSpec(theme.extends, themes, seen);
  if (!base) {
    const { extends: _e, overrides: _o, ...rest } = theme;
    return rest;
  }
  const overrides = theme.overrides ?? diffThemeSpec(themeAsSpec(theme), base);
  const merged = customThemeFromInput(
    {
      ...mergeDeep(base, overrides),
      extends: theme.extends,
      overrides,
      origin: theme.origin,
      createdAt: theme.createdAt,
      updatedAt: theme.updatedAt,
    },
    { id: theme.id, fixContrast: false },
  );
  return merged;
}

/** Links an edited theme to its base by recording only what differs from it. */
export function relinkTheme(theme: CustomTheme, themes: readonly CustomTheme[]): CustomTheme {
  if (!theme.extends) return theme;
  const base = themeBaseSpec(theme.extends, themes, new Set([theme.id]));
  if (!base) {
    const { extends: _e, overrides: _o, ...rest } = theme;
    return rest;
  }
  return { ...theme, overrides: diffThemeSpec(themeAsSpec(theme), base) };
}

/** A new editable theme that extends a built-in or generated theme ("Remix"). */
export function remixTheme(
  ref: unknown,
  themes: readonly CustomTheme[],
  now = new Date().toISOString(),
): CustomTheme | undefined {
  const base = themeBaseSpec(ref, themes);
  if (!base || typeof ref !== "string") return undefined;
  const baseName =
    typeof base.name === "string" ? base.name : isThemeId(ref) ? themeOption(ref).name : ref;
  const overrides = { name: `${baseName} remix`, summary: base.summary ?? "" };
  return materializeTheme(
    customThemeFromInput(
      { ...base, ...overrides, extends: ref, overrides },
      { taken: themes.map((t) => t.id), origin: "user", now, fixContrast: false },
    ),
    themes,
  );
}

/** Load-side normalizer for config.customThemes, with inheritance re-applied. */
export function normalizeCustomThemes(raw: unknown): CustomTheme[] {
  const rows = normalizeCustomThemeRows(raw);
  return rows.map((theme) => materializeTheme(theme, rows));
}

/** The manage_theme reducer, with `extends` on create and override-aware updates. */
export function applyThemeManageAction(
  themes: readonly CustomTheme[],
  args: Record<string, unknown>,
  now = new Date().toISOString(),
): ThemeManageResult {
  const spec = (() => {
    const raw = args.theme;
    if (isPlain(raw)) return raw;
    if (typeof raw !== "string") return undefined;
    try {
      const parsed = parseCustomThemeJson(raw);
      return isPlain(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  })();
  const action = args.action;
  if (action === "create" && spec && typeof spec.extends === "string") {
    const base = themeBaseSpec(spec.extends, themes);
    if (!base) {
      return {
        ok: false,
        output: `Cannot extend ${spec.extends}: no such theme.`,
        themes: [...themes],
      };
    }
    const { extends: ref, ...overrides } = spec;
    const result = applyThemeManageActionRows(
      themes,
      { ...args, theme: { ...mergeDeep(base, overrides), extends: ref, overrides } },
      now,
    );
    return { ...result, themes: result.themes.map((t) => materializeTheme(t, result.themes)) };
  }
  if (action === "update" && spec) {
    const current = themes.find((t) => t.id === args.id || t.name === args.id);
    if (current?.extends) {
      const overrides = mergeDeep(current.overrides ?? {}, spec);
      const result = applyThemeManageActionRows(
        themes,
        { ...args, theme: { ...spec, overrides } },
        now,
      );
      return { ...result, themes: result.themes.map((t) => materializeTheme(t, result.themes)) };
    }
  }
  const result = applyThemeManageActionRows(themes, args, now);
  // Themes built on a changed or deleted theme are re-merged (or unlinked).
  return { ...result, themes: result.themes.map((t) => materializeTheme(t, result.themes)) };
}
