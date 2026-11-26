/**
 * Token built-ins: colour-only built-in themes kept as data (tokenThemeData.ts)
 * instead of CSS. They compile to the same `[data-theme]` blocks they used to
 * be, and convert to a spec so they can be remixed or extended.
 */
import { TOKEN_THEME_DATA } from "./tokenThemeData.js";
import { THEME_OPTIONS, type ThemeId } from "./theme.js";

const TOKEN_NAME_RE = /^(--[a-z0-9-]+|color-scheme)$/;
/** Declaration values: no braces, semicolons or angle brackets, so nothing can escape the block. */
const TOKEN_VALUE_RE = /^[A-Za-z0-9#(),.%\s"'*+/-]+$/;

export function isTokenThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && Object.hasOwn(TOKEN_THEME_DATA, value);
}

export const TOKEN_THEME_IDS = Object.keys(TOKEN_THEME_DATA) as ThemeId[];

/** CSS for every token built-in, in their original order. */
export function tokenThemesCss(): string {
  const out: string[] = [];
  for (const id of TOKEN_THEME_IDS) {
    const tokens = TOKEN_THEME_DATA[id]!;
    const decls = Object.entries(tokens)
      .filter(([name, value]) => TOKEN_NAME_RE.test(name) && TOKEN_VALUE_RE.test(value))
      .map(([name, value]) => `  ${name}: ${value};`);
    out.push(`[data-theme="${id}"] {\n${decls.join("\n")}\n}`);
  }
  return out.join("\n");
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const COLOR_TOKENS: Record<string, string> = {
  bg: "--bg",
  surface: "--bg-1",
  raised: "--bg-2",
  overlay: "--bg-3",
  text: "--text",
  muted: "--muted",
  faint: "--faint",
  accent: "--accent",
  accent2: "--accent-2",
  accentInk: "--accent-ink",
  danger: "--danger",
  ok: "--ok",
  warn: "--warn",
};

/** A token built-in as a loose spec (for Remix and `extends`). */
export function tokenThemeSpec(id: unknown): Record<string, unknown> | undefined {
  if (!isTokenThemeId(id)) return undefined;
  const tokens = TOKEN_THEME_DATA[id]!;
  const opt = THEME_OPTIONS.find((row) => row.id === id);
  const hex = (name: string) => (HEX.test(tokens[name] ?? "") ? tokens[name] : undefined);
  const colors = Object.fromEntries(
    Object.entries(COLOR_TOKENS)
      .map(([key, name]) => [key, hex(name)])
      .filter(([, value]) => value),
  );
  const extraColors = Object.fromEntries(
    [
      ["terminal", hex("--term")],
      ["terminalText", hex("--term-fg")],
      ["terminalCursor", hex("--terminal-cursor")],
    ].filter(([, value]) => value),
  );
  return {
    name: opt?.name ?? id,
    summary: opt?.summary ?? "",
    scheme: tokens["color-scheme"] === "light" ? "light" : "dark",
    colors,
    ...(Object.keys(extraColors).length ? { extraColors } : {}),
  };
}
