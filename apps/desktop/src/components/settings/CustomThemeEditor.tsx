import { useEffect, useState, type ReactNode } from "react";
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
  CUSTOM_THEME_FOCUS_RINGS,
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
  THEME_OPTIONS,
  THEME_STYLES,
  customThemeContrastIssues,
  customThemeFromInput,
  fixCustomThemeContrast,
  fixExtraColorContrast,
  normalizeFontFamily,
  normalizeThemeHex,
  themeFamilyLabel,
  type CustomTheme,
  type CustomThemeColorKey,
  type CustomThemeColors,
  type CustomThemeEffects,
  type CustomThemeExtraColorKey,
  type CustomThemeLayout,
  type CustomThemeMotion,
  type CustomThemeType,
} from "@locus/shared";
import { api } from "@/lib/api";
import { themeSurfaceAttrs } from "@/lib/theme";
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
  /** Provider and model for Refine, chosen in the composer's picker. */
  generateWith?: { providerId: string; model: string };
  modelPicker?: ReactNode;
  onChange: (theme: CustomTheme) => void;
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
  const issues = customThemeContrastIssues(t.colors);

  const patch = (next: Partial<CustomTheme>) => props.onChange({ ...t, ...next });
  const patchLayout = (next: Partial<CustomThemeLayout>) =>
    patch({ layout: dropUndefined({ ...t.layout, ...next }) });
  const patchType = (next: Partial<CustomThemeType>) =>
    patch({ type: dropUndefined({ ...t.type, ...next }) });
  const patchEffects = (next: Partial<CustomThemeEffects>) =>
    patch({ effects: dropUndefined({ ...t.effects, ...next }) });
  const patchMotion = (next: Partial<CustomThemeMotion>) => {
    const motion = dropUndefined({ ...t.motion, ...next });
    patch({ motion: Object.keys(motion).length ? motion : undefined });
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
    if (hex) patch({ colors: { ...t.colors, [key]: hex } });
  };

  function startFrom(id: string) {
    if (!id) return;
    const opt = THEME_OPTIONS.find((row) => row.id === id);
    const custom = props.customThemes.find((row) => row.id === id);
    const colors = { ...t.colors, ...readThemeColors(id, props.customThemes) };
    if (custom) {
      patch({
        colors: custom.colors,
        scheme: custom.scheme,
        base: custom.base,
        layout: custom.layout,
        type: custom.type,
        effects: custom.effects,
        extraColors: custom.extraColors,
        motion: custom.motion,
      });
      return;
    }
    patch({ colors, scheme: opt?.scheme ?? t.scheme, base: opt?.style });
  }

  async function refineWithAi() {
    if (!refine.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { theme } = await api.generateTheme(refine, { current: t, ...props.generateWith });
      props.onChange({ ...theme, id: t.id, createdAt: t.createdAt, origin: "ai" });
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
          <label htmlFor="theme-editor-start">Start from</label>
          <select
            id="theme-editor-start"
            value=""
            onChange={(event) => startFrom(event.target.value)}
          >
            <option value="">Copy colours from…</option>
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
        <EnumField
          id="theme-editor-base"
          label="Build on style"
          value={t.base}
          options={THEME_STYLES}
          names={Object.fromEntries(THEME_STYLES.map((s) => [s, themeFamilyLabel(s)]))}
          onChange={(base) => patch({ base })}
        />
      </div>

      <h4 className="theme-editor-section">Colours</h4>
      <div className="theme-editor-colors">
        {CUSTOM_THEME_COLOR_KEYS.map((key) => (
          <label key={key} className="theme-editor-color" htmlFor={`theme-color-${key}`}>
            <input
              id={`theme-color-${key}`}
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
              .map((row) => `${row.pair} ${row.ratio.toFixed(1)}:1`)
              .join(", ")}
            {issues.length > 4 ? "…" : ""}
          </p>
          <button
            type="button"
            className="btn small"
            onClick={() => patch({ colors: fixCustomThemeContrast(t.colors) })}
          >
            Fix contrast
          </button>
        </div>
      ) : (
        <p className="theme-editor-ok">All text and accent pairs pass contrast checks.</p>
      )}

      <h4 className="theme-editor-section">Surface colours</h4>
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
          names={{ quote: "Pull quote", accent: "Accent fill" }}
          onChange={(bubble) => patchLayout({ bubble })}
        />
        <EnumField
          id="theme-editor-button"
          label="Primary button"
          value={t.layout.button}
          options={CUSTOM_THEME_BUTTONS}
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
          names={{ gradient: "Gradient fill", highlight: "Marker highlight" }}
          onChange={(headingStyle) => patchType({ headingStyle })}
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
          names={{ none: "Appear instantly", rise: "Rise up", slide: "Slide in", pop: "Pop" }}
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

      <footer className="theme-editor-actions">
        <button
          type="button"
          className="btn primary"
          onClick={props.onSave}
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

/** Turns pasted JSON into a theme, or throws a readable error. */
export function importThemeJson(text: string, taken: Iterable<string>): CustomTheme {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON");
  }
  if (!raw || typeof raw !== "object") throw new Error("Theme JSON must be an object");
  return customThemeFromInput({ ...(raw as object), id: undefined }, { taken, origin: "user" });
}
