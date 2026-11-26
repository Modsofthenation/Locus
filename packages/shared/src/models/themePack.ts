import {
  customThemeFromInput,
  MAX_CUSTOM_THEMES,
  normalizeThemeBackdrop,
  type CustomTheme,
} from "./customTheme.js";

const FORMAT = "locus-theme-pack";
const VERSION = 1;
export const MAX_THEME_PACK_BYTES = 10 * 1024 * 1024;

export interface ThemePack {
  name: string;
  variants: CustomTheme[];
}

export function exportThemePack(name: string, themes: readonly CustomTheme[]): string {
  if (!themes.length || themes.length > MAX_CUSTOM_THEMES) {
    throw new Error(`Select between 1 and ${MAX_CUSTOM_THEMES} variants`);
  }
  return JSON.stringify(
    {
      format: FORMAT,
      version: VERSION,
      name: name.trim().slice(0, 60) || "Locus themes",
      variants: themes.map(
        ({ id: _id, createdAt: _created, updatedAt: _updated, ...variant }) => variant,
      ),
    },
    null,
    2,
  );
}

export function importThemePack(text: string, taken: Iterable<string>): ThemePack {
  if (text.length > MAX_THEME_PACK_BYTES) throw new Error("The theme pack is too large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Theme JSON must be an object");
  }
  const row = raw as Record<string, unknown>;
  const isPack = "format" in row || "variants" in row || "version" in row;
  if (isPack && (row.format !== FORMAT || row.version !== VERSION)) {
    throw new Error("Unsupported theme pack format or version");
  }
  const variants = isPack ? row.variants : [row];
  if (!Array.isArray(variants) || !variants.length || variants.length > MAX_CUSTOM_THEMES) {
    throw new Error(`Use between 1 and ${MAX_CUSTOM_THEMES} theme variants`);
  }

  const used = new Set(taken);
  if (used.size + variants.length > MAX_CUSTOM_THEMES) {
    throw new Error(
      `Only ${MAX_CUSTOM_THEMES} custom themes can be saved. Free space before importing this pack.`,
    );
  }
  const themes = variants.map((variant: unknown) => {
    if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
      throw new Error("Each theme variant must be an object");
    }
    const spec = variant as Record<string, unknown>;
    if (spec.backdrop !== undefined && !normalizeThemeBackdrop(spec.backdrop)) {
      throw new Error("A backdrop is invalid or exceeds the size limit");
    }
    const theme = customThemeFromInput(
      { ...spec, id: undefined, createdAt: undefined, updatedAt: undefined },
      { taken: used, origin: "user", fixContrast: false },
    );
    used.add(theme.id);
    return theme;
  });
  return {
    name: (typeof row.name === "string" ? row.name.trim().slice(0, 60) : "") || themes[0]!.name,
    variants: themes,
  };
}
