import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CUSTOM_THEME_BACKDROP_MOTIONS,
  CUSTOM_THEME_BACKGROUNDS,
  CUSTOM_THEME_BORDER_COLORS,
  CUSTOM_THEME_BORDER_STYLES,
  CUSTOM_THEME_BUBBLES,
  CUSTOM_THEME_BUTTONS,
  CUSTOM_THEME_CASES,
  CUSTOM_THEME_COLOR_KEYS,
  CUSTOM_THEME_COLOR_LABELS,
  CUSTOM_THEME_CONTROL_SHAPES,
  CUSTOM_THEME_DENSITIES,
  CUSTOM_THEME_EASINGS,
  CUSTOM_THEME_ENTRANCES,
  CUSTOM_THEME_EXTRA_COLOR_KEYS,
  CUSTOM_THEME_EXTRA_COLOR_LABELS,
  CUSTOM_THEME_ANSI_KEYS,
  CUSTOM_THEME_COMPONENTS,
  CUSTOM_THEME_COMPONENT_LABELS,
  CUSTOM_THEME_SYNTAX_KEYS,
  CUSTOM_THEME_FOCUS_RINGS,
  CUSTOM_THEME_HARMONIES,
  CUSTOM_THEME_NUMERALS,
  CUSTOM_THEME_PANE_ACCENTS,
  CUSTOM_THEME_FONTS,
  CUSTOM_THEME_FONT_LABELS,
  CUSTOM_THEME_HEADING_STYLES,
  CUSTOM_THEME_HOVERS,
  CUSTOM_THEME_LINK_STYLES,
  CUSTOM_THEME_PANES,
  CUSTOM_THEME_SCROLLBARS,
  CUSTOM_THEME_SHADOWS,
  CUSTOM_THEME_SIDEBARS,
  CUSTOM_THEME_SPEEDS,
  CUSTOM_THEME_TOPBARS,
  MAX_THEME_BACKDROP_BYTES,
  THEME_OPTIONS,
  THEME_STYLES,
  deriveThemePalette,
  fixThemeReadability,
  paletteFromPixels,
  resolveCodeColors,
  themeReadabilityIssues,
  fixExtraColorContrast,
  normalizeFontFamily,
  normalizeThemeHex,
  normalizeThemeBackdrop,
  themeFamilyLabel,
  type CustomTheme,
  type CustomThemeColorKey,
  type CustomThemeColors,
  type CustomThemeEffects,
  type CustomThemeExtraColorKey,
  type CustomThemeHarmony,
  type CustomThemeAnsiKey,
  type CustomThemeCode,
  type CustomThemeComponentKey,
  type CustomThemeComponentStyle,
  type CustomThemeSyntaxKey,
  type CustomThemeLayout,
  type CustomThemeMotion,
  type CustomThemeType,
  type ThemeStyle,
} from "@locus/shared";
import { api } from "@/lib/api";
import { filesToAttachments } from "@/lib/attachments";
import type { RenderedContrastIssue } from "@/lib/themeAudit";
import { themeDisplayName, themeSurfaceAttrs } from "@/lib/theme";
import { ThemeComposer } from "./ThemeComposer";

const CSS_VAR_FOR: Record<CustomThemeColorKey, string> = {
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

/** Reads a built-in or generated theme's colours from the live CSS. */
export function readThemeColors(
  id: string,
  customThemes: readonly CustomTheme[],
): Partial<CustomThemeColors> {
  const custom = customThemes.find((theme) => theme.id === id);
  if (custom) return custom.colors;
  const probe = document.createElement("div");
  for (const [key, value] of Object.entries(themeSurfaceAttrs(id, customThemes))) {
    probe.setAttribute(key, value);
  }
  probe.style.display = "none";
  document.body.appendChild(probe);
  const styles = getComputedStyle(probe);
  const out: Partial<CustomThemeColors> = {};
  for (const key of CUSTOM_THEME_COLOR_KEYS) {
    const hex = normalizeThemeHex(styles.getPropertyValue(CSS_VAR_FOR[key]));
    if (hex) out[key] = hex;
  }
  probe.remove();
  return out;
}

const NONE = "";

const TYPE_PRESETS = {
  system: { font: "system", headingFont: "system", monoFont: "mono" },
  editorial: { font: "humanist", headingFont: "serif", headingWeight: 600, lineHeight: 1.6 },
  terminal: { font: "mono", headingFont: "mono", monoFont: "mono" },
  rounded: { font: "rounded", headingFont: "rounded", headingWeight: 700 },
} satisfies Record<string, CustomThemeType>;

const EFFECT_PRESETS = {
  quiet: { quietEffects: true, effects: {}, motion: {} },
  style: { quietEffects: false, effects: {}, motion: {} },
  tactile: { quietEffects: false, effects: { lift: true }, motion: { enter: "fade" } },
  cinematic: {
    quietEffects: false,
    effects: { noise: true, vignette: true },
    motion: { backdrop: "drift" },
  },
} satisfies Record<string, Partial<CustomTheme>>;

const HARMONY_NAMES: Record<CustomThemeHarmony, string> = {
  mono: "Monochrome",
  analogous: "Analogous",
  complementary: "Complementary",
  split: "Split complementary",
  triadic: "Triadic",
};

function label(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function EnumField<T extends string>(props: {
  id: string;
  label: string;
  value: T | undefined;
  options: readonly T[];
  names?: Partial<Record<T, string>>;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <div className="field theme-editor-field">
      <label htmlFor={props.id}>{props.label}</label>
      <select
        id={props.id}
        value={props.value ?? NONE}
        onChange={(event) =>
          props.onChange(event.target.value === NONE ? undefined : (event.target.value as T))
        }
      >
        <option value={NONE}>Default</option>
        {props.options.map((opt) => (
          <option key={opt} value={opt}>
            {props.names?.[opt] ?? label(opt)}
          </option>
        ))}
      </select>
    </div>
  );
}

function RangeField(props: {
  id: string;
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  fallback: number;
  unit?: string;
  onChange: (value: number | undefined) => void;
}) {
  const shown = props.value ?? props.fallback;
  return (
    <div className="field theme-editor-field theme-editor-range">
      <label htmlFor={props.id}>
        {props.label}
        <span>
          {props.value === undefined ? "Default" : `${shown}${props.unit ?? ""}`}
          {props.value !== undefined ? (
            <button
              type="button"
              className="btn small ghost"
              onClick={() => props.onChange(undefined)}
              aria-label={`Reset ${props.label}`}
            >
              Reset
            </button>
          ) : null}
        </span>
      </label>
      <input
        id={props.id}
        aria-label={props.label}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={shown}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </div>
  );
}

function ToggleField(props: {
  id: string;
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="theme-editor-check" htmlFor={props.id}>
      <input
        id={props.id}
        type="checkbox"
        checked={props.on}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      {props.label}
    </label>
  );
}

/** Free-text font family; commits on blur or Enter so typing does not fetch every prefix. */
function FontNameField(props: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(props.value ?? "");
  useEffect(() => setDraft(props.value ?? ""), [props.value]);
  const commit = () => {
    const name = normalizeFontFamily(draft);
    if (!draft.trim()) props.onChange(undefined);
    else if (name) props.onChange(name);
    else setDraft(props.value ?? "");
  };
  return (
    <div className="field theme-editor-field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        value={draft}
        maxLength={48}
        placeholder="Any Google font, e.g. Space Grotesk"
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
    </div>
  );
}

export function CustomThemeEditor(props: {
  theme: CustomTheme;
  customThemes: readonly CustomTheme[];
  isNew: boolean;
  atCapacity?: boolean;
  renderedIssues?: RenderedContrastIssue[];
  /** Provider and model for Refine, chosen in the composer's picker. */
  generateWith?: { providerId: string; model: string };
  modelPicker?: ReactNode;
  onChange: (theme: CustomTheme | ((current: CustomTheme) => CustomTheme)) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}) {
  const t = props.theme;
  const [refine, setRefine] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [paletteId, setPaletteId] = useState("");
  const [typePreset, setTypePreset] = useState("");
  const [effectPreset, setEffectPreset] = useState("");
  const backdropRequest = useRef(0);
  const issues = themeReadabilityIssues(t);
  const [componentKey, setComponentKey] = useState<CustomThemeComponentKey>("modal");
  const codeColors = resolveCodeColors(t.colors, t.extraColors ?? {}, t.scheme, t.code);
  const patchCode = (next: Partial<CustomThemeCode>) =>
    patch({ code: dropUndefined({ ...t.code, ...next }) });
  const setSyntax = (key: CustomThemeSyntaxKey, value: string | undefined) => {
    const syntax = dropUndefined({ ...t.code?.syntax, [key]: value && normalizeThemeHex(value) });
    patchCode({ syntax: Object.keys(syntax).length ? syntax : undefined });
  };
  const setAnsi = (key: CustomThemeAnsiKey, value: string | undefined) => {
    const ansi = dropUndefined({ ...t.code?.ansi, [key]: value && normalizeThemeHex(value) });
    patchCode({ ansi: Object.keys(ansi).length ? ansi : undefined });
  };
  const component = t.components?.[componentKey] ?? {};
  const patchComponent = (next: Partial<CustomThemeComponentStyle>) => {
    const part = dropUndefined({ ...component, ...next });
    const components = dropUndefined({
      ...t.components,
      [componentKey]: Object.keys(part).length ? part : undefined,
    });
    patch({ components: Object.keys(components).length ? components : undefined });
  };

  const patch = (next: Partial<CustomTheme>) => props.onChange({ ...t, ...next });
  const patchLayout = (next: Partial<CustomThemeLayout>) =>
    patch({ layout: dropUndefined({ ...t.layout, ...next }) });
  const patchType = (next: Partial<CustomThemeType>) => {
    setTypePreset("");
    patch({ type: dropUndefined({ ...t.type, ...next }) });
  };
  const patchEffects = (next: Partial<CustomThemeEffects>) => {
    setEffectPreset("");
    patch({ quietEffects: undefined, effects: dropUndefined({ ...t.effects, ...next }) });
  };
  const patchMotion = (next: Partial<CustomThemeMotion>) => {
    const motion = dropUndefined({ ...t.motion, ...next });
    setEffectPreset("");
    patch({ quietEffects: undefined, motion: Object.keys(motion).length ? motion : undefined });
  };
  const setExtraColor = (key: CustomThemeExtraColorKey, value: string | undefined) => {
    const hex = value === undefined ? undefined : normalizeThemeHex(value);
    if (value !== undefined && !hex) return;
    const extra = dropUndefined({ ...t.extraColors, [key]: hex });
    patch({ extraColors: Object.keys(extra).length ? extra : undefined });
  };
  const backdropStops = t.layout.backgroundColors ?? [];
  const setBackdropStops = (stops: string[]) =>
    patchLayout({ backgroundColors: stops.length ? stops : undefined });
  const setColor = (key: CustomThemeColorKey, value: string) => {
    const hex = normalizeThemeHex(value);
    if (hex) {
      setPaletteId("");
      patch({ colors: { ...t.colors, [key]: hex } });
    }
  };
  const seed = t.palette?.seed ?? t.colors.accent;
  const harmony = t.palette?.harmony ?? "analogous";
  /** Re-grows every core colour from a seed and harmony (Colours → Seed). */
  const growPalette = (nextSeed: string, nextHarmony: CustomThemeHarmony) => {
    const hex = normalizeThemeHex(nextSeed);
    if (!hex) return;
    setPaletteId("");
    patch({
      palette: { seed: hex, harmony: nextHarmony },
      colors: deriveThemePalette(hex, t.scheme, nextHarmony),
    });
  };

  function applyPalette(id: string) {
    setPaletteId(id);
    if (!id) return;
    const source =
      props.customThemes.find((row) => row.id === id) ?? THEME_OPTIONS.find((row) => row.id === id);
    if (!source) return;
    patch({
      colors: { ...t.colors, ...readThemeColors(id, props.customThemes) },
      palette: undefined,
      scheme: source.scheme,
    });
  }

  function applyComponentStyle(base?: ThemeStyle) {
    const {
      background,
      backgroundColors,
      backgroundAngle,
      backgroundIntensity,
      patternScale,
      density,
      messageWidth,
    } = t.layout;
    patch({
      base,
      layout: dropUndefined({
        background,
        backgroundColors,
        backgroundAngle,
        backgroundIntensity,
        patternScale,
        density,
        messageWidth,
      }),
    });
  }

  /** Seeds the palette and backdrop colours from the backdrop image's own colours. */
  async function paletteFromBackdrop() {
    if (!t.backdrop) return;
    setError(null);
    try {
      const img = new Image();
      img.src = t.backdrop;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.drawImage(img, 0, 0, 64, 64);
      const found = paletteFromPixels(ctx.getImageData(0, 0, 64, 64).data);
      setPaletteId("");
      props.onChange((current) => ({
        ...current,
        scheme: found.scheme,
        palette: { seed: found.seed, harmony: current.palette?.harmony ?? "analogous" },
        colors: deriveThemePalette(
          found.seed,
          found.scheme,
          current.palette?.harmony ?? "analogous",
        ),
        layout: {
          ...current.layout,
          ...(found.colors.length ? { backgroundColors: found.colors } : {}),
        },
      }));
    } catch {
      setError("Could not read colours from the backdrop image");
    }
  }

  async function loadBackdrop(file: File) {
    setError(null);
    const request = ++backdropRequest.current;
    try {
      if (file.size > MAX_THEME_BACKDROP_BYTES)
        throw new Error("The backdrop must be 128 KB or smaller");
      const [asset] = await filesToAttachments([file]);
      const backdrop = normalizeThemeBackdrop(`data:${asset?.mime};base64,${asset?.contentBase64}`);
      if (!backdrop) throw new Error("Choose a PNG, JPEG, or WebP image");
      if (request === backdropRequest.current) {
        props.onChange((current) => ({ ...current, backdrop }));
      }
    } catch (err) {
      if (request === backdropRequest.current) {
        setError(err instanceof Error ? err.message : "Could not open the backdrop");
      }
    }
  }

  function fixRendered(issue: RenderedContrastIssue) {
    if (!issue.fix) return;
    const { group, key, color } = issue.fix;
    if (group === "colors") {
      setPaletteId("");
      patch({ colors: { ...t.colors, [key]: color } });
    } else patch({ extraColors: { ...t.extraColors, [key]: color } });
  }

  async function refineWithAi() {
    if (!refine.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { backdrop: _backdrop, ...current } = t;
      const { theme } = await api.generateTheme(refine, { current, ...props.generateWith });
      setPaletteId("");
      setTypePreset("");
      setEffectPreset("");
      props.onChange((current) => ({
        ...theme,
        backdrop: current.backdrop,
        id: t.id,
        createdAt: t.createdAt,
        origin: "ai",
      }));
      setRefine("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refine the theme");
    } finally {
      setBusy(false);
    }
  }

  async function copyJson() {
    const { id: _id, createdAt: _c, updatedAt: _u, ...spec } = t;
    try {
      await navigator.clipboard.writeText(JSON.stringify(spec, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Clipboard is unavailable");
    }
  }

  return (
    <section className="theme-editor" aria-label="Theme editor" data-testid="theme-editor">
      <header className="theme-editor-head">
        <h3>{props.isNew ? "New theme" : `Edit ${t.name}`}</h3>
        <span className="theme-editor-origin">
          {t.origin === "ai" ? "Made by Locus" : "Custom"}
        </span>
      </header>
      {t.extends ? (
        <p className="theme-editor-hint" data-testid="theme-editor-extends">
          Based on <strong>{themeDisplayName(t.extends, props.customThemes)}</strong>. Only your
          changes are saved, so updates to it carry through.{" "}
          <button
            type="button"
            className="btn small ghost"
            onClick={() => patch({ extends: undefined, overrides: undefined })}
          >
            Unlink
          </button>
        </p>
      ) : null}

      <div className="theme-editor-grid">
        <div className="field theme-editor-field">
          <label htmlFor="theme-editor-name">Name</label>
          <input
            id="theme-editor-name"
            value={t.name}
            maxLength={40}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </div>
        <div className="field theme-editor-field">
          <label htmlFor="theme-editor-summary">Summary</label>
          <input
            id="theme-editor-summary"
            value={t.summary}
            maxLength={160}
            onChange={(event) => patch({ summary: event.target.value })}
          />
        </div>
        <div className="field theme-editor-field">
          <label htmlFor="theme-editor-start">Palette</label>
          <select
            id="theme-editor-start"
            value={paletteId}
            onChange={(event) => applyPalette(event.target.value)}
          >
            <option value="">Custom colours</option>
            {props.customThemes
              .filter((row) => row.id !== t.id)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} (generated)
                </option>
              ))}
            {THEME_OPTIONS.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field theme-editor-field">
          <span id="theme-editor-scheme" className="theme-editor-label">
            Scheme
          </span>
          <div
            className="theme-filter-pills"
            role="radiogroup"
            aria-labelledby="theme-editor-scheme"
          >
            {(["light", "dark"] as const).map((scheme) => (
              <button
                type="button"
                key={scheme}
                role="radio"
                aria-checked={t.scheme === scheme}
                className={t.scheme === scheme ? "on" : ""}
                onClick={() => patch({ scheme })}
              >
                {label(scheme)}
              </button>
            ))}
          </div>
        </div>
        <div className="field theme-editor-field">
          <ToggleField
            id="theme-editor-adaptive"
            label="Follow system light/dark"
            on={t.adaptive === true}
            onChange={(on) => patch({ adaptive: on || undefined })}
          />
          <span className="theme-editor-hint">
            The other scheme is derived{t.palette ? " from the seed" : ""} and checked for contrast.
          </span>
        </div>
        <EnumField
          id="theme-editor-base"
          label="Component style"
          value={t.base}
          options={THEME_STYLES}
          names={Object.fromEntries(THEME_STYLES.map((s) => [s, themeFamilyLabel(s)]))}
          onChange={applyComponentStyle}
        />
        <div className="field theme-editor-field">
          <label htmlFor="theme-editor-typography-preset">Typography preset</label>
          <select
            id="theme-editor-typography-preset"
            value={typePreset}
            onChange={(event) => {
              const value = event.target.value;
              setTypePreset(value);
              if (value) patch({ type: { ...TYPE_PRESETS[value as keyof typeof TYPE_PRESETS] } });
            }}
          >
            <option value="">Custom typography</option>
            <option value="system">System UI</option>
            <option value="editorial">Editorial</option>
            <option value="terminal">Monospace</option>
            <option value="rounded">Rounded</option>
          </select>
        </div>
        <div className="field theme-editor-field">
          <label htmlFor="theme-editor-effects-preset">Effects preset</label>
          <select
            id="theme-editor-effects-preset"
            value={t.quietEffects ? "quiet" : effectPreset}
            onChange={(event) => {
              const value = event.target.value;
              setEffectPreset(value);
              if (value) patch(EFFECT_PRESETS[value as keyof typeof EFFECT_PRESETS]);
              else patch({ quietEffects: undefined });
            }}
          >
            <option value="">Custom effects</option>
            <option value="quiet">Off</option>
            <option value="style">Style defaults</option>
            <option value="tactile">Soft motion</option>
            <option value="cinematic">Cinematic</option>
          </select>
        </div>
      </div>

      <h4 className="theme-editor-section">Colours</h4>
      <div className="theme-editor-grid theme-editor-seed" data-testid="theme-editor-seed">
        <label className="theme-editor-color" htmlFor="theme-editor-seed-color">
          <input
            id="theme-editor-seed-color"
            aria-label="Seed colour"
            type="color"
            value={seed}
            onChange={(event) => growPalette(event.target.value, harmony)}
          />
          <span>
            Seed colour
            <code>{seed}</code>
          </span>
        </label>
        <div className="field theme-editor-field">
          <label htmlFor="theme-editor-harmony">Harmony</label>
          <select
            id="theme-editor-harmony"
            value={harmony}
            onChange={(event) => growPalette(seed, event.target.value as CustomThemeHarmony)}
          >
            {CUSTOM_THEME_HARMONIES.map((row) => (
              <option key={row} value={row}>
                {HARMONY_NAMES[row]}
              </option>
            ))}
          </select>
        </div>
        <p className="theme-editor-hint">
          Pick a seed to regrow every colour below as one readable family. Edit any swatch after.
        </p>
      </div>
      <div className="theme-editor-colors">
        {CUSTOM_THEME_COLOR_KEYS.map((key) => (
          <label key={key} className="theme-editor-color" htmlFor={`theme-color-${key}`}>
            <input
              id={`theme-color-${key}`}
              aria-label={CUSTOM_THEME_COLOR_LABELS[key]}
              type="color"
              value={t.colors[key]}
              onChange={(event) => setColor(key, event.target.value)}
            />
            <span>
              {CUSTOM_THEME_COLOR_LABELS[key]}
              <code>{t.colors[key]}</code>
            </span>
          </label>
        ))}
      </div>
      {issues.length ? (
        <div className="theme-editor-contrast" role="status" data-testid="theme-editor-contrast">
          <p>
            {issues.length} colour {issues.length === 1 ? "pair is" : "pairs are"} hard to read:{" "}
            {issues
              .slice(0, 4)
              .map((row) => `${row.where} ${row.ratio.toFixed(1)}:1`)
              .join(", ")}
            {issues.length > 4 ? "…" : ""}
          </p>
          <button
            type="button"
            className="btn small"
            onClick={() => props.onChange((current) => fixThemeReadability(current))}
          >
            Fix contrast
          </button>
        </div>
      ) : (
        <p className="theme-editor-ok">
          All text, accent, code and terminal pairs pass contrast checks
          {t.adaptive ? " in both light and dark" : ""}.
        </p>
      )}

      {props.renderedIssues?.length ? (
        <section
          className="theme-editor-contrast theme-contrast-results"
          aria-label="Rendered contrast results"
        >
          <h4>Preview contrast</h4>
          <ul>
            {props.renderedIssues.map((issue) => (
              <li key={issue.label}>
                <strong>{issue.label}</strong>{" "}
                <code>
                  {issue.foreground} / {issue.background}
                </code>{" "}
                <span>
                  {issue.ratio.toFixed(2)}:1 · needs {issue.minimum}:1
                </span>{" "}
                {issue.fix ? (
                  <button type="button" className="btn small" onClick={() => fixRendered(issue)}>
                    Use {issue.fix.color}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="theme-editor-ok">The preview samples pass contrast checks.</p>
      )}

      <h4 className="theme-editor-section">Component colours</h4>
      <p className="theme-editor-hint">
        Optional. Unset surfaces follow the palette; text on filled surfaces is picked for contrast.
      </p>
      <div className="theme-editor-colors">
        {CUSTOM_THEME_EXTRA_COLOR_KEYS.map((key) => {
          const value = t.extraColors?.[key];
          return (
            <div key={key} className="theme-editor-color" data-unset={value ? undefined : ""}>
              <input
                id={`theme-extra-${key}`}
                type="color"
                value={value ?? t.colors.accent}
                onChange={(event) => setExtraColor(key, event.target.value)}
                aria-label={CUSTOM_THEME_EXTRA_COLOR_LABELS[key]}
              />
              <span>
                {CUSTOM_THEME_EXTRA_COLOR_LABELS[key]}
                {value ? (
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => setExtraColor(key, undefined)}
                    aria-label={`Clear ${CUSTOM_THEME_EXTRA_COLOR_LABELS[key]}`}
                  >
                    <code>{value}</code> ×
                  </button>
                ) : (
                  <code>auto</code>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {t.extraColors && (t.extraColors.link || t.extraColors.heading || t.extraColors.focus) ? (
        <button
          type="button"
          className="btn small ghost"
          onClick={() =>
            patch({ extraColors: fixExtraColorContrast(t.extraColors ?? {}, t.colors) })
          }
        >
          Fix surface contrast
        </button>
      ) : null}

      <h4 className="theme-editor-section">Backdrop image</h4>
      <div className="field theme-editor-field">
        <label htmlFor="theme-editor-backdrop-image">Add a PNG, JPEG, or WebP up to 128 KB</label>
        <input
          type="file"
          id="theme-editor-backdrop-image"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadBackdrop(file);
            event.target.value = "";
          }}
        />
        {t.backdrop ? (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              backdropRequest.current++;
              patch({ backdrop: undefined });
            }}
          >
            Remove backdrop image
          </button>
        ) : null}
        {t.backdrop ? (
          <button
            type="button"
            className="btn small"
            data-testid="theme-editor-backdrop-palette"
            onClick={() => void paletteFromBackdrop()}
          >
            Use the image&rsquo;s colours
          </button>
        ) : null}
      </div>

      <h4 className="theme-editor-section">Shape &amp; surfaces</h4>
      <div className="theme-editor-grid">
        <RangeField
          id="theme-editor-radius"
          label="Corner radius"
          value={t.layout.radius}
          min={0}
          max={32}
          step={1}
          fallback={10}
          unit="px"
          onChange={(radius) => patchLayout({ radius })}
        />
        <RangeField
          id="theme-editor-border"
          label="Border width"
          value={t.layout.borderWidth}
          min={0}
          max={4}
          step={1}
          fallback={1}
          unit="px"
          onChange={(borderWidth) => patchLayout({ borderWidth })}
        />
        <EnumField
          id="theme-editor-border-style"
          label="Border style"
          value={t.layout.borderStyle}
          options={CUSTOM_THEME_BORDER_STYLES}
          onChange={(borderStyle) => patchLayout({ borderStyle })}
        />
        <EnumField
          id="theme-editor-controls"
          label="Button shape"
          value={t.layout.controls}
          options={CUSTOM_THEME_CONTROL_SHAPES}
          names={{ match: "Match panes" }}
          onChange={(controls) => patchLayout({ controls })}
        />
        <EnumField
          id="theme-editor-shadow"
          label="Shadows"
          value={t.layout.shadow}
          options={CUSTOM_THEME_SHADOWS}
          names={{ hard: "Hard offset" }}
          onChange={(shadow) => patchLayout({ shadow })}
        />
        <EnumField
          id="theme-editor-pane"
          label="Panes"
          value={t.layout.pane}
          options={CUSTOM_THEME_PANES}
          names={{ glass: "Frosted glass" }}
          onChange={(pane) => patchLayout({ pane })}
        />
        <EnumField
          id="theme-editor-background"
          label="Backdrop"
          value={t.layout.background}
          options={CUSTOM_THEME_BACKGROUNDS}
          names={{ mesh: "Colour mesh", lines: "Ruled lines", grain: "Fine grain" }}
          onChange={(background) => patchLayout({ background })}
        />
        <EnumField
          id="theme-editor-sidebar"
          label="Side rail"
          value={t.layout.sidebar}
          options={CUSTOM_THEME_SIDEBARS}
          names={{ surface: "Same as panes", accent: "Accent colour" }}
          onChange={(sidebar) => patchLayout({ sidebar })}
        />
        <EnumField
          id="theme-editor-bubble"
          label="Your messages"
          value={t.layout.bubble}
          options={CUSTOM_THEME_BUBBLES}
          names={{
            quote: "Pull quote",
            accent: "Accent fill",
            tail: "Speech tail",
            gradient: "Gradient fill",
            glass: "Frosted glass",
          }}
          onChange={(bubble) => patchLayout({ bubble })}
        />
        <EnumField
          id="theme-editor-pane-accent"
          label="Pane edge"
          value={t.layout.paneAccent}
          options={CUSTOM_THEME_PANE_ACCENTS}
          names={{ none: "None", top: "Accent top", left: "Accent left", gradient: "Gradient top" }}
          onChange={(paneAccent) => patchLayout({ paneAccent })}
        />
        <EnumField
          id="theme-editor-button"
          label="Primary button"
          value={t.layout.button}
          options={CUSTOM_THEME_BUTTONS}
          names={{ soft: "Soft tint", depth: "3D depth", brutal: "Brutal offset" }}
          onChange={(button) => patchLayout({ button })}
        />
        <EnumField
          id="theme-editor-border-color"
          label="Border colour"
          value={t.layout.borderColor}
          options={CUSTOM_THEME_BORDER_COLORS}
          names={{ line: "Subtle line", accent2: "Second accent" }}
          onChange={(borderColor) => patchLayout({ borderColor })}
        />
        <EnumField
          id="theme-editor-topbar"
          label="Top bar"
          value={t.layout.topbar}
          options={CUSTOM_THEME_TOPBARS}
          names={{ surface: "Same as panes", glass: "Frosted glass", accent: "Accent colour" }}
          onChange={(topbar) => patchLayout({ topbar })}
        />
        <EnumField
          id="theme-editor-density"
          label="Density"
          value={t.layout.density}
          options={CUSTOM_THEME_DENSITIES}
          onChange={(density) => patchLayout({ density })}
        />
        <EnumField
          id="theme-editor-focus"
          label="Focus ring"
          value={t.layout.focusRing}
          options={CUSTOM_THEME_FOCUS_RINGS}
          onChange={(focusRing) => patchLayout({ focusRing })}
        />
        <EnumField
          id="theme-editor-scrollbar"
          label="Scrollbars"
          value={t.layout.scrollbar}
          options={CUSTOM_THEME_SCROLLBARS}
          onChange={(scrollbar) => patchLayout({ scrollbar })}
        />
        <RangeField
          id="theme-editor-blur"
          label="Glass blur"
          value={t.layout.blur}
          min={0}
          max={40}
          step={1}
          fallback={16}
          unit="px"
          onChange={(blur) => patchLayout({ blur })}
        />
        <RangeField
          id="theme-editor-message-width"
          label="Message width"
          value={t.layout.messageWidth}
          min={560}
          max={1200}
          step={10}
          fallback={720}
          unit="px"
          onChange={(messageWidth) => patchLayout({ messageWidth })}
        />
      </div>

      <h4 className="theme-editor-section">Backdrop</h4>
      <div className="theme-editor-grid">
        <RangeField
          id="theme-editor-bg-angle"
          label="Direction"
          value={t.layout.backgroundAngle}
          min={0}
          max={360}
          step={1}
          fallback={160}
          unit="°"
          onChange={(backgroundAngle) => patchLayout({ backgroundAngle })}
        />
        <RangeField
          id="theme-editor-bg-intensity"
          label="Strength"
          value={t.layout.backgroundIntensity}
          min={0}
          max={1}
          step={0.05}
          fallback={0.5}
          onChange={(backgroundIntensity) => patchLayout({ backgroundIntensity })}
        />
        <RangeField
          id="theme-editor-bg-scale"
          label="Pattern size"
          value={t.layout.patternScale}
          min={0.5}
          max={4}
          step={0.25}
          fallback={1}
          unit="×"
          onChange={(patternScale) => patchLayout({ patternScale })}
        />
        <div className="field theme-editor-field">
          <span className="theme-editor-label">Backdrop colours</span>
          <div className="theme-editor-stops">
            {backdropStops.map((hex, index) => (
              <span key={index} className="theme-editor-stop">
                <input
                  type="color"
                  value={hex}
                  aria-label={`Backdrop colour ${index + 1}`}
                  onChange={(event) => {
                    const next = normalizeThemeHex(event.target.value);
                    if (!next) return;
                    setBackdropStops(backdropStops.map((h, i) => (i === index ? next : h)));
                  }}
                />
                <button
                  type="button"
                  className="btn small ghost"
                  aria-label={`Remove backdrop colour ${index + 1}`}
                  onClick={() => setBackdropStops(backdropStops.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </span>
            ))}
            {backdropStops.length < 4 ? (
              <button
                type="button"
                className="btn small ghost"
                onClick={() =>
                  setBackdropStops([
                    ...backdropStops,
                    backdropStops.length === 0 ? t.colors.accent : t.colors.accent2,
                  ])
                }
              >
                {backdropStops.length ? "Add colour" : "Pick colours (default: accents)"}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <h4 className="theme-editor-section">Type</h4>
      <div className="theme-editor-grid">
        <EnumField
          id="theme-editor-font"
          label="Body font"
          value={t.type.font}
          options={CUSTOM_THEME_FONTS}
          names={CUSTOM_THEME_FONT_LABELS}
          onChange={(font) => patchType({ font })}
        />
        <EnumField
          id="theme-editor-heading-font"
          label="Heading font"
          value={t.type.headingFont}
          options={CUSTOM_THEME_FONTS}
          names={CUSTOM_THEME_FONT_LABELS}
          onChange={(headingFont) => patchType({ headingFont })}
        />
        <EnumField
          id="theme-editor-heading-case"
          label="Heading case"
          value={t.type.headingCase}
          options={CUSTOM_THEME_CASES}
          names={{ none: "As written", upper: "UPPERCASE", lower: "lowercase" }}
          onChange={(headingCase) => patchType({ headingCase })}
        />
        <RangeField
          id="theme-editor-heading-weight"
          label="Heading weight"
          value={t.type.headingWeight}
          min={300}
          max={900}
          step={100}
          fallback={600}
          onChange={(headingWeight) => patchType({ headingWeight })}
        />
        <RangeField
          id="theme-editor-heading-tracking"
          label="Heading spacing"
          value={t.type.headingTracking}
          min={-0.05}
          max={0.3}
          step={0.01}
          fallback={0}
          unit="em"
          onChange={(headingTracking) => patchType({ headingTracking })}
        />
        <FontNameField
          id="theme-editor-font-family"
          label="Body web font"
          value={t.type.fontFamily}
          onChange={(fontFamily) => patchType({ fontFamily })}
        />
        <FontNameField
          id="theme-editor-heading-font-family"
          label="Heading web font"
          value={t.type.headingFontFamily}
          onChange={(headingFontFamily) => patchType({ headingFontFamily })}
        />
        <EnumField
          id="theme-editor-mono-font"
          label="Code font"
          value={t.type.monoFont}
          options={CUSTOM_THEME_FONTS}
          names={CUSTOM_THEME_FONT_LABELS}
          onChange={(monoFont) => patchType({ monoFont })}
        />
        <FontNameField
          id="theme-editor-mono-font-family"
          label="Code web font"
          value={t.type.monoFontFamily}
          onChange={(monoFontFamily) => patchType({ monoFontFamily })}
        />
        <EnumField
          id="theme-editor-heading-style"
          label="Heading style"
          value={t.type.headingStyle}
          options={CUSTOM_THEME_HEADING_STYLES}
          names={{
            gradient: "Gradient fill",
            highlight: "Marker highlight",
            shadow: "Offset shadow",
            boxed: "Accent box",
          }}
          onChange={(headingStyle) => patchType({ headingStyle })}
        />
        <EnumField
          id="theme-editor-numerals"
          label="Numerals"
          value={t.type.numerals}
          options={CUSTOM_THEME_NUMERALS}
          names={{
            tabular: "Tabular figures",
            oldstyle: "Oldstyle figures",
            slashed: "Slashed zero",
          }}
          onChange={(numerals) => patchType({ numerals })}
        />
        <EnumField
          id="theme-editor-links"
          label="Links"
          value={t.type.links}
          options={CUSTOM_THEME_LINK_STYLES}
          onChange={(links) => patchType({ links })}
        />
        <RangeField
          id="theme-editor-scale"
          label="Text size"
          value={t.type.scale}
          min={0.85}
          max={1.3}
          step={0.05}
          fallback={1}
          unit="×"
          onChange={(scale) => patchType({ scale })}
        />
        <RangeField
          id="theme-editor-body-weight"
          label="Body weight"
          value={t.type.bodyWeight}
          min={300}
          max={700}
          step={100}
          fallback={400}
          onChange={(bodyWeight) => patchType({ bodyWeight })}
        />
        <RangeField
          id="theme-editor-body-tracking"
          label="Body spacing"
          value={t.type.bodyTracking}
          min={-0.03}
          max={0.1}
          step={0.005}
          fallback={-0.01}
          unit="em"
          onChange={(bodyTracking) => patchType({ bodyTracking })}
        />
        <RangeField
          id="theme-editor-line-height"
          label="Chat line height"
          value={t.type.lineHeight}
          min={1.2}
          max={2}
          step={0.05}
          fallback={1.6}
          onChange={(lineHeight) => patchType({ lineHeight })}
        />
        <div className="theme-editor-checks">
          <ToggleField
            id="theme-editor-italic"
            label="Italic headings"
            on={t.type.headingItalic === true}
            onChange={(on) => patchType({ headingItalic: on || undefined })}
          />
        </div>
      </div>

      <h4 className="theme-editor-section">Code, terminal &amp; diffs</h4>
      <div className="theme-editor-checks">
        <ToggleField
          id="theme-editor-code"
          label="Theme syntax and diff colours"
          on={Boolean(t.code)}
          onChange={(on) => patch({ code: on ? {} : undefined })}
        />
      </div>
      <p className="theme-editor-hint">
        Terminals always get a matching 16-colour palette. Leave a colour unset to derive it from
        the palette; every colour is kept readable on its background.
      </p>
      {t.code ? (
        <div className="theme-editor-colors" data-testid="theme-editor-syntax">
          {CUSTOM_THEME_SYNTAX_KEYS.map((key) => (
            <label key={key} className="theme-editor-color" htmlFor={`theme-syntax-${key}`}>
              <input
                id={`theme-syntax-${key}`}
                aria-label={`Syntax ${key}`}
                type="color"
                value={codeColors.syntax[key]}
                onChange={(event) => setSyntax(key, event.target.value)}
              />
              <span>
                {label(key)}
                {t.code?.syntax?.[key] ? (
                  <button
                    type="button"
                    className="btn small ghost"
                    aria-label={`Reset syntax ${key}`}
                    onClick={() => setSyntax(key, undefined)}
                  >
                    Reset
                  </button>
                ) : (
                  <code>auto</code>
                )}
              </span>
            </label>
          ))}
          {(["diffAdd", "diffDel"] as const).map((key) => (
            <label key={key} className="theme-editor-color" htmlFor={`theme-${key}`}>
              <input
                id={`theme-${key}`}
                aria-label={key === "diffAdd" ? "Added lines" : "Removed lines"}
                type="color"
                value={codeColors[key]}
                onChange={(event) => patchCode({ [key]: normalizeThemeHex(event.target.value) })}
              />
              <span>{key === "diffAdd" ? "Added lines" : "Removed lines"}</span>
            </label>
          ))}
        </div>
      ) : null}
      <details className="theme-editor-ansi">
        <summary>Terminal colours</summary>
        <div className="theme-editor-colors" data-testid="theme-editor-ansi">
          {CUSTOM_THEME_ANSI_KEYS.map((key) => (
            <label key={key} className="theme-editor-color" htmlFor={`theme-ansi-${key}`}>
              <input
                id={`theme-ansi-${key}`}
                aria-label={`Terminal ${key}`}
                type="color"
                value={codeColors.ansi[key]}
                onChange={(event) => setAnsi(key, event.target.value)}
              />
              <span>
                {label(key)}
                {t.code?.ansi?.[key] ? (
                  <button
                    type="button"
                    className="btn small ghost"
                    aria-label={`Reset terminal ${key}`}
                    onClick={() => setAnsi(key, undefined)}
                  >
                    Reset
                  </button>
                ) : (
                  <code>auto</code>
                )}
              </span>
            </label>
          ))}
        </div>
      </details>

      <h4 className="theme-editor-section">Components</h4>
      <p className="theme-editor-hint">
        Give one kind of component its own shape. These win over the global settings above.
      </p>
      <div className="theme-editor-grid" data-testid="theme-editor-components">
        <div className="field theme-editor-field">
          <label htmlFor="theme-editor-component">Component</label>
          <select
            id="theme-editor-component"
            value={componentKey}
            onChange={(event) => setComponentKey(event.target.value as CustomThemeComponentKey)}
          >
            {CUSTOM_THEME_COMPONENTS.map((key) => (
              <option key={key} value={key}>
                {CUSTOM_THEME_COMPONENT_LABELS[key]}
                {t.components?.[key] ? " •" : ""}
              </option>
            ))}
          </select>
        </div>
        <RangeField
          id="theme-editor-component-radius"
          label="Corners"
          value={component.radius === 999 ? undefined : component.radius}
          min={0}
          max={40}
          step={1}
          fallback={t.layout.radius ?? 10}
          unit="px"
          onChange={(radius) => patchComponent({ radius })}
        />
        <ToggleField
          id="theme-editor-component-pill"
          label="Pill shape"
          on={component.radius === 999}
          onChange={(on) => patchComponent({ radius: on ? 999 : undefined })}
        />
        <RangeField
          id="theme-editor-component-border"
          label="Border"
          value={component.borderWidth}
          min={0}
          max={4}
          step={1}
          fallback={t.layout.borderWidth ?? 1}
          unit="px"
          onChange={(borderWidth) => patchComponent({ borderWidth })}
        />
        <EnumField
          id="theme-editor-component-shadow"
          label="Shadow"
          value={component.shadow}
          options={CUSTOM_THEME_SHADOWS}
          onChange={(shadow) => patchComponent({ shadow })}
        />
        <label className="theme-editor-color" htmlFor="theme-editor-component-fill">
          <input
            id="theme-editor-component-fill"
            aria-label="Component fill"
            type="color"
            value={component.fill ?? t.colors.surface}
            onChange={(event) => patchComponent({ fill: normalizeThemeHex(event.target.value) })}
          />
          <span>
            Fill
            {component.fill ? (
              <button
                type="button"
                className="btn small ghost"
                onClick={() => patchComponent({ fill: undefined })}
              >
                Reset
              </button>
            ) : (
              <code>default</code>
            )}
          </span>
        </label>
      </div>

      <h4 className="theme-editor-section">Motion</h4>
      <p className="theme-editor-hint">
        Motion is switched off when the system asks for reduced motion.
      </p>
      <div className="theme-editor-grid">
        <EnumField
          id="theme-editor-speed"
          label="Speed"
          value={t.motion?.speed}
          options={CUSTOM_THEME_SPEEDS}
          onChange={(speed) => patchMotion({ speed })}
        />
        <EnumField
          id="theme-editor-easing"
          label="Easing"
          value={t.motion?.easing}
          options={CUSTOM_THEME_EASINGS}
          onChange={(easing) => patchMotion({ easing })}
        />
        <EnumField
          id="theme-editor-enter"
          label="New messages"
          value={t.motion?.enter}
          options={CUSTOM_THEME_ENTRANCES}
          names={{
            none: "Appear instantly",
            rise: "Rise up",
            slide: "Slide in",
            pop: "Pop",
            drop: "Drop in",
            unfold: "Unfold",
            flip: "Flip down",
          }}
          onChange={(enter) => patchMotion({ enter })}
        />
        <EnumField
          id="theme-editor-hover"
          label="Button hover"
          value={t.motion?.hover}
          options={CUSTOM_THEME_HOVERS}
          names={{ shine: "Shine sweep" }}
          onChange={(hover) => patchMotion({ hover })}
        />
        <EnumField
          id="theme-editor-backdrop-motion"
          label="Backdrop motion"
          value={t.motion?.backdrop}
          options={CUSTOM_THEME_BACKDROP_MOTIONS}
          names={{ hue: "Colour cycle" }}
          onChange={(backdrop) => patchMotion({ backdrop })}
        />
      </div>

      <h4 className="theme-editor-section">Effects</h4>
      <div className="theme-editor-checks">
        <ToggleField
          id="theme-editor-vignette"
          label="Vignette"
          on={t.effects.vignette === true}
          onChange={(on) => patchEffects({ vignette: on || undefined })}
        />
        <ToggleField
          id="theme-editor-scanlines"
          label="Scanlines"
          on={t.effects.scanlines === true}
          onChange={(on) => patchEffects({ scanlines: on || undefined })}
        />
        <ToggleField
          id="theme-editor-noise"
          label="Film grain"
          on={t.effects.noise === true}
          onChange={(on) => patchEffects({ noise: on || undefined })}
        />
        <ToggleField
          id="theme-editor-glow"
          label="Neon glow"
          on={t.effects.glow === true}
          onChange={(on) => patchEffects({ glow: on || undefined })}
        />
        <ToggleField
          id="theme-editor-lift"
          label="Buttons lift on hover"
          on={t.effects.lift === true}
          onChange={(on) => patchEffects({ lift: on || undefined })}
        />
        <ToggleField
          id="theme-editor-chromatic"
          label="Chromatic headings"
          on={t.effects.chromatic === true}
          onChange={(on) => patchEffects({ chromatic: on || undefined })}
        />
        <ToggleField
          id="theme-editor-frame"
          label="Window frame"
          on={t.effects.frame === true}
          onChange={(on) => patchEffects({ frame: on || undefined })}
        />
        <ToggleField
          id="theme-editor-sheen"
          label="Pane sheen"
          on={t.effects.sheen === true}
          onChange={(on) => patchEffects({ sheen: on || undefined })}
        />
      </div>

      <div className="theme-editor-refine">
        <label htmlFor="theme-editor-refine">Refine with Locus</label>
        <ThemeComposer
          id="theme-editor-refine"
          value={refine}
          placeholder="e.g. warmer, serif headings, slow aurora backdrop, bouncy buttons"
          busy={busy}
          sendLabel="Refine"
          busyLabel="Refining…"
          rows={1}
          toolbarEnd={props.modelPicker}
          disabledReason={
            props.generateWith
              ? undefined
              : "Add or turn on a provider in Settings → Providers to refine"
          }
          onChange={setRefine}
          onSend={() => void refineWithAi()}
        />
      </div>
      {error ? (
        <p className="theme-editor-error" role="alert">
          {error}
        </p>
      ) : null}

      {props.atCapacity ? (
        <p className="theme-editor-error">Delete a custom theme to save another.</p>
      ) : null}
      <footer className="theme-editor-actions">
        <button
          type="button"
          className="btn primary"
          onClick={props.onSave}
          disabled={props.atCapacity}
          data-testid="theme-editor-save"
        >
          {props.isNew ? "Save & apply" : "Save"}
        </button>
        <button type="button" className="btn ghost" onClick={props.onCancel}>
          Cancel
        </button>
        <span className="theme-editor-spacer" />
        <button type="button" className="btn small ghost" onClick={() => void copyJson()}>
          {copied ? "Copied" : "Copy JSON"}
        </button>
        {props.onDuplicate ? (
          <button type="button" className="btn small ghost" onClick={props.onDuplicate}>
            Duplicate
          </button>
        ) : null}
        {props.onDelete ? (
          <button type="button" className="btn small ghost danger" onClick={props.onDelete}>
            Delete
          </button>
        ) : null}
      </footer>
    </section>
  );
}

function dropUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
