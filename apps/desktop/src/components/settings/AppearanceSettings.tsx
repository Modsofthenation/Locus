import { useLayoutEffect, useMemo, useState } from "react";
import {
  DEFAULT_THEME,
  MAX_CUSTOM_THEMES,
  THEME_FAMILY_ORDER,
  THEME_OPTIONS,
  THEME_STYLES,
  FEATURED_THEME_IDS,
  customThemeFromInput,
  customThemeSwatches,
  defaultCustomThemeColors,
  editorFontSize,
  filterThemeOptions,
  findCustomTheme,
  isExtendableTheme,
  materializeTheme,
  newCustomThemeId,
  relinkTheme,
  remixTheme,
  parseChatDensity,
  parseProductMode,
  resolveThemeRef,
  supportsOneShotCompletion,
  supportsPromptCompletion,
  themeFamily,
  themeFamilyLabel,
  type AiProvider,
  type ChatDensity,
  type CustomTheme,
  type ProductMode,
  type ThemeFamily,
  type ThemeFilter,
  type ThemeOption,
  type ThemePack,
  type ThemePreferences as ThemePreferencesValue,
  type ThemeRef,
} from "@locus/shared";
import { ThemePreview } from "./ThemePreview";
import type { RenderedContrastIssue } from "@/lib/themeAudit";
import { SettingsToggleRow } from "./SettingsBits";
import { CustomThemeEditor, readThemeColors } from "./CustomThemeEditor";
import { ThemePackSettings } from "./ThemePackSettings";
import { ThemePreferences, type ThemeWorkspace } from "./ThemePreferences";
import { ThemeComposer } from "./ThemeComposer";
import { ModelPicker } from "./ModelPicker";
import { PRODUCT_MODE_LABELS } from "@/lib/productMode";
import { api } from "@/lib/api";
import { setDraftThemeCss, themeSurfaceAttrs } from "@/lib/theme";

const CHAT_DENSITY_OPTIONS: { id: ChatDensity; label: string; hint: string }[] = [
  {
    id: "comfortable",
    label: "Comfortable",
    hint: "Roomier spacing and slightly larger text across the app.",
  },
  { id: "compact", label: "Compact", hint: "The default. Fits more on screen." },
  { id: "dense", label: "Dense", hint: "The tightest spacing everywhere." },
];

const PRODUCT_MODE_OPTIONS: { id: ProductMode; label: string; hint: string }[] = [
  {
    id: "developer",
    label: PRODUCT_MODE_LABELS.developer,
    hint: "Agents, Design, IDE, Codebase, Jobs, guests, and forge tools.",
  },
  {
    id: "swarm",
    label: PRODUCT_MODE_LABELS.swarm,
    hint: "Teammates and teams only. Developer chats stay in Developer.",
  },
];

/** Colour filters: what the palette is. */
const COLOUR_FILTERS: { id: ThemeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "contrast", label: "High contrast" },
  { id: "gradient", label: "Gradient" },
];

/** Style filters: groups that change the UI's structure. */
const STYLE_FILTERS: { id: ThemeFilter; label: string }[] = [
  { id: "crafted", label: "Crafted" },
  { id: "terminal", label: "Terminal" },
  ...THEME_STYLES.map((style) => ({ id: style, label: themeFamilyLabel(style) })),
];

const THEME_RECENTS_KEY = "locus.themeRecents";
const THEME_MODEL_KEY = "locus.themeModel";

function loadThemeRecents(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function rememberThemeRecent(id: string) {
  const next = [id, ...loadThemeRecents().filter((row) => row !== id)].slice(0, 4);
  try {
    globalThis.localStorage?.setItem(THEME_RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

interface ModelChoice {
  providerId: string;
  model: string;
}

function loadModelChoice(): ModelChoice | null {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_MODEL_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ModelChoice>) : null;
    return parsed && typeof parsed.providerId === "string" && typeof parsed.model === "string"
      ? { providerId: parsed.providerId, model: parsed.model }
      : null;
  } catch {
    return null;
  }
}

function rememberModelChoice(choice: ModelChoice) {
  try {
    globalThis.localStorage?.setItem(THEME_MODEL_KEY, JSON.stringify(choice));
  } catch {
    /* quota / private mode */
  }
}

/** Enabled providers that can answer a theme request, CLI agents included (not Cursor Cloud). */
export function themeCapableProviders(providers: readonly AiProvider[] | undefined): AiProvider[] {
  return (providers ?? []).filter((p) => p.enabled && supportsPromptCompletion(p));
}

/** One card in the theme grid: a built-in option or a generated theme. */
interface ThemeCardItem {
  id: ThemeRef;
  name: string;
  family: ThemeFamily;
  summary: string;
  custom?: CustomTheme;
}

function builtinItem(opt: ThemeOption): ThemeCardItem {
  return { id: opt.id, name: opt.name, family: themeFamily(opt), summary: opt.summary };
}

function customItem(theme: CustomTheme): ThemeCardItem {
  return {
    id: theme.id,
    name: theme.name,
    family: "generated",
    summary: theme.summary,
    custom: theme,
  };
}

function matchesQuery(item: ThemeCardItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.name, item.id, item.summary, themeFamilyLabel(item.family)]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

interface EditingTheme {
  theme: CustomTheme;
  isNew: boolean;
}

export function AppearanceSettings(props: {
  theme: string;
  /** The theme in saved config. Settings shows its own save status, so this is informational. */
  savedTheme: string;
  customThemes?: CustomTheme[];
  /** Providers for the theme composer's model picker. */
  providers?: AiProvider[];
  themePreferences?: ThemePreferencesValue;
  workspaces?: ThemeWorkspace[];
  onThemePreferences?: (preferences: ThemePreferencesValue) => void;
  productMode?: ProductMode;
  chatDensity?: ChatDensity;
  editorFontSize: number;
  formatOnSave: boolean;
  showMinimap: boolean;
  onSelect: (id: ThemeRef) => void;
  /** Replace the generated themes; `select` also switches to one. */
  onCustomThemes?: (themes: CustomTheme[], select?: ThemeRef) => void;
  onEditor: (patch: {
    productMode?: ProductMode;
    chatDensity?: ChatDensity;
    editorFontSize?: number;
    formatOnSave?: boolean;
    showMinimap?: boolean;
  }) => void;
}) {
  const customThemes = props.customThemes ?? [];
  const selected = resolveThemeRef(props.theme, customThemes);
  const density = parseChatDensity(props.chatDensity);
  const productMode = parseProductMode(props.productMode);
  const [filter, setFilter] = useState<ThemeFilter>("all");
  const [seeAll, setSeeAll] = useState(false);
  const [query, setQuery] = useState("");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingTheme | null>(null);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [pack, setPack] = useState<ThemePack | null>(null);
  const [variant, setVariant] = useState(0);
  const [renderedIssues, setRenderedIssues] = useState<RenderedContrastIssue[]>([]);

  // Model for Generate / Refine: remembered per machine, falls back to the first usable provider.
  const capable = useMemo(() => themeCapableProviders(props.providers), [props.providers]);
  const [choice, setChoice] = useState<ModelChoice | null>(() => loadModelChoice());
  const activeProvider =
    capable.find((p) => p.id === choice?.providerId) ??
    // With no saved choice, a fast API provider beats spawning a CLI agent.
    capable.find((p) => supportsOneShotCompletion(p)) ??
    capable[0] ??
    undefined;
  const activeModel =
    activeProvider && choice?.providerId === activeProvider.id && choice.model
      ? choice.model
      : (activeProvider?.defaultModel ?? activeProvider?.models[0] ?? "");
  const generateWith = activeProvider
    ? { providerId: activeProvider.id, model: activeModel }
    : undefined;
  const noProviderReason = capable.length
    ? undefined
    : "Add or turn on a provider in Settings → Providers to generate themes. You can still build your own.";
  const modelPicker = activeProvider ? (
    <ModelPicker
      compact
      providers={capable}
      providerId={activeProvider.id}
      model={activeModel}
      onChange={(next) => {
        setChoice(next);
        rememberModelChoice(next);
      }}
    />
  ) : null;

  const draft = editing?.theme ?? pack?.variants[variant] ?? null;
  const pageThemes = draft
    ? [...customThemes.filter((row) => row.id !== draft.id), draft]
    : customThemes;
  useLayoutEffect(() => {
    setDraftThemeCss(draft);
    return () => setDraftThemeCss(null);
  }, [draft]);

  const previewId = draft?.id ?? hoverId ?? selected;
  const searching = query.trim().length > 0;
  const builtins = filter === "generated" ? [] : filterThemeOptions(filter);
  const generatedItems =
    filter === "all" || filter === "generated"
      ? (editing ? pageThemes : customThemes).map(customItem)
      : [];
  const items = [...builtins.map(builtinItem), ...generatedItems].filter((row) =>
    matchesQuery(row, query),
  );
  const totalThemes = THEME_OPTIONS.length + customThemes.length + Number(Boolean(editing?.isNew));
  const recents = loadThemeRecents()
    .filter((id) => id !== selected)
    .slice(0, 3);
  const itemFor = (id: string): ThemeCardItem | undefined => {
    const custom = findCustomTheme(id, pageThemes);
    if (custom) return customItem(custom);
    const opt = THEME_OPTIONS.find((row) => row.id === id);
    return opt ? builtinItem(opt) : undefined;
  };
  const featuredIds = [
    selected,
    ...FEATURED_THEME_IDS.filter((id) => id !== selected),
    ...recents.filter((id) => id !== selected && !(FEATURED_THEME_IDS as string[]).includes(id)),
  ];
  const featuredMode = filter === "all" && !seeAll && !searching;
  const shown = featuredMode
    ? featuredIds
        .map(itemFor)
        .filter((row): row is ThemeCardItem => Boolean(row))
        .filter((row, index, rows) => rows.findIndex((r) => r.id === row.id) === index)
    : items;
  const grouped = filter === "all" && !featuredMode;

  function selectTheme(id: ThemeRef) {
    rememberThemeRecent(selected);
    props.onSelect(id);
  }

  /** Apply a random theme from what the current filter and search show, never the current one. */
  function shuffleTheme() {
    const pool = items.filter((row) => row.id !== selected);
    if (!pool.length) return;
    selectTheme(pool[Math.floor(Math.random() * pool.length)].id);
  }

  function pickFilter(id: ThemeFilter) {
    setFilter(id);
    if (id !== "all") setSeeAll(false);
  }

  function takenIds(): string[] {
    return customThemes.map((row) => row.id);
  }

  /** Opens a crafted built-in's full engine spec as an editable generated theme. */
  function remixSelected() {
    const theme = remixTheme(selected, customThemes);
    if (!theme) return;
    setPack(null);
    setEditing({ theme, isNew: true });
    setFilter("generated");
  }

  function startNew() {
    if (isExtendableTheme(selected, [])) {
      remixSelected();
      return;
    }
    setPack(null);
    const current = findCustomTheme(selected, customThemes);
    const builtin = THEME_OPTIONS.find((row) => row.id === selected);
    const scheme = current?.scheme ?? builtin?.scheme ?? "dark";
    const theme = customThemeFromInput(
      {
        name: "My theme",
        scheme,
        base: current?.base ?? builtin?.style,
        colors: {
          ...defaultCustomThemeColors(scheme),
          ...(current?.colors ?? readThemeColors(selected, customThemes)),
        },
        layout: current?.layout,
        type: current?.type,
        effects: current?.effects,
        extraColors: current?.extraColors,
        motion: current?.motion,
        quietEffects: current?.quietEffects,
        backdrop: current?.backdrop,
      },
      { taken: takenIds(), origin: "user", fixContrast: false },
    );
    setEditing({ theme, isNew: true });
    setFilter("generated");
  }

  function edit(theme: CustomTheme) {
    setPack(null);
    setEditing({ theme, isNew: false });
    setFilter("generated");
  }

  function saveEditing() {
    if (!editing || !props.onCustomThemes) return;
    const theme = { ...editing.theme, name: editing.theme.name.trim() || "Untitled theme" };
    theme.updatedAt = new Date().toISOString();
    const exists = !editing.isNew && customThemes.some((row) => row.id === theme.id);
    if (!exists && customThemes.length >= MAX_CUSTOM_THEMES) return;
    if (!exists && customThemes.some((row) => row.id === theme.id)) {
      theme.id = newCustomThemeId(theme.name, takenIds());
    }
    const linked = relinkTheme(theme, customThemes);
    const saved = exists
      ? customThemes.map((row) => (row.id === linked.id ? linked : row))
      : [...customThemes, linked];
    // Themes built on this one pick up the change straight away.
    const next = saved.map((row) => materializeTheme(row, saved));
    props.onCustomThemes(next, editing.isNew ? linked.id : undefined);
    setEditing(null);
  }

  function deleteTheme(id: string) {
    if (!props.onCustomThemes) return;
    const next = customThemes.filter((row) => row.id !== id);
    props.onCustomThemes(
      next,
      selected === id && !props.themePreferences?.followSystem ? DEFAULT_THEME : undefined,
    );
    setEditing(null);
  }

  function duplicate(theme: CustomTheme) {
    setPack(null);
    const id = newCustomThemeId(`${theme.name} copy`, takenIds());
    const now = new Date().toISOString();
    setEditing({
      theme: {
        ...theme,
        id,
        name: `${theme.name} copy`.slice(0, 40),
        createdAt: now,
        updatedAt: now,
      },
      isNew: true,
    });
  }

  async function generate() {
    if (!prompt.trim() || !generateWith) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const { theme } = await api.generateTheme(prompt.trim(), generateWith);
      const id = newCustomThemeId(theme.name, takenIds());
      setPack(null);
      setEditing({ theme: { ...theme, id }, isNew: true });
      setFilter("generated");
      setPrompt("");
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Could not generate a theme");
    } finally {
      setGenerating(false);
    }
  }

  function installPack() {
    if (
      !pack ||
      !props.onCustomThemes ||
      customThemes.length + pack.variants.length > MAX_CUSTOM_THEMES
    )
      return;
    const used = new Set(takenIds());
    const variants = pack.variants.map((theme) => {
      const id = used.has(theme.id) ? newCustomThemeId(theme.name, used) : theme.id;
      used.add(id);
      return { ...theme, id };
    });
    props.onCustomThemes([...customThemes, ...variants]);
    setPack(null);
  }

  const card = (row: ThemeCardItem) => (
    <ThemeCard
      key={row.id}
      item={row}
      customThemes={pageThemes}
      draft={editing?.theme.id === row.id}
      selected={selected === row.id}
      onSelect={() => selectTheme(row.id)}
      onPreview={() => setHoverId(row.id)}
      onPreviewEnd={() => setHoverId((id) => (id === row.id ? null : id))}
      onEdit={row.custom && props.onCustomThemes ? () => edit(row.custom!) : undefined}
    />
  );

  const filterButton = (row: { id: ThemeFilter; label: string }) => (
    <button
      type="button"
      key={row.id}
      role="radio"
      aria-checked={filter === row.id}
      className={filter === row.id ? "on" : ""}
      data-testid={`theme-filter-${row.id}`}
      onClick={() => pickFilter(row.id)}
    >
      {row.label}
    </button>
  );

  const resultsTitle = searching
    ? `Results for “${query.trim()}”`
    : featuredMode
      ? "Featured"
      : filter === "all"
        ? "All themes"
        : themeFamilyLabel(filter);

  return (
    <div className={`appearance-layout${editing ? " is-editing" : ""}`}>
      <div className="appearance-main">
        <section className="appearance-product-mode" aria-labelledby="product-mode-label">
          <h3 id="product-mode-label">Product mode</h3>
          <div
            className="appearance-mode-cards"
            role="radiogroup"
            aria-labelledby="product-mode-label"
          >
            {PRODUCT_MODE_OPTIONS.map((row) => (
              <button
                type="button"
                key={row.id}
                role="radio"
                aria-checked={productMode === row.id}
                className={`appearance-mode-card${productMode === row.id ? " on" : ""}`}
                data-testid={`appearance-product-mode-${row.id}`}
                onClick={() => props.onEditor({ productMode: row.id })}
              >
                <strong>{row.label}</strong>
                <span>{row.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="appearance-section appearance-themes" aria-labelledby="theme-label">
          <header className="appearance-section-head">
            <div>
              <h3 id="theme-label">Theme</h3>
              <p>Hover or focus a theme to preview it. Click to apply.</p>
            </div>
            <div className="theme-search-row">
              <input
                type="search"
                className="theme-search"
                data-testid="theme-search"
                placeholder={`Search ${totalThemes} themes`}
                aria-label="Search themes"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                className="btn chip theme-shuffle"
                data-testid="theme-shuffle"
                title="Apply a random theme from the current filter"
                disabled={!items.some((row) => row.id !== selected) || Boolean(editing)}
                onClick={shuffleTheme}
              >
                ⤨ Shuffle
              </button>
            </div>
          </header>
          <div className="theme-filters" role="radiogroup" aria-label="Theme filters">
            <div className="theme-filter-row">
              <span className="theme-filter-row-label" aria-hidden="true">
                Colour
              </span>
              <div className="theme-filter-pills">{COLOUR_FILTERS.map(filterButton)}</div>
            </div>
            <div className="theme-filter-row">
              <span className="theme-filter-row-label" aria-hidden="true">
                Style
              </span>
              <div className="theme-filter-pills theme-style-pills">
                {STYLE_FILTERS.map(filterButton)}
              </div>
            </div>
            <div className="theme-filter-row">
              <span className="theme-filter-row-label" aria-hidden="true">
                Yours
              </span>
              <div className="theme-filter-pills">
                <button
                  type="button"
                  role="radio"
                  aria-checked={filter === "generated"}
                  className={`theme-filter-generated${filter === "generated" ? " on" : ""}`}
                  data-testid="theme-filter-generated"
                  onClick={() => pickFilter("generated")}
                >
                  ✦ Generated
                  <span className="theme-filter-count-badge">{customThemes.length}</span>
                </button>
              </div>
            </div>
          </div>

          {props.onThemePreferences ? (
            <ThemePreferences
              preferences={props.themePreferences}
              themes={customThemes}
              workspaces={props.workspaces ?? []}
              onChange={props.onThemePreferences}
            />
          ) : null}

          {/* The describe / build composer belongs to the Generated tab only. */}
          {props.onCustomThemes && filter === "generated" ? (
            <section className="theme-generate" aria-labelledby="theme-generate-label">
              <label id="theme-generate-label" htmlFor="theme-generate-input">
                Describe a theme and Locus will build it
              </label>
              <ThemeComposer
                id="theme-generate-input"
                testId="theme-generate-input"
                value={prompt}
                placeholder="e.g. a 1970s mission-control console: amber on black, chunky type, scanlines"
                busy={generating}
                sendLabel="Generate"
                busyLabel="Generating…"
                disabledReason={noProviderReason}
                onChange={setPrompt}
                onSend={() => void generate()}
                toolbarEnd={modelPicker}
              >
                <button
                  type="button"
                  className="btn chip"
                  onClick={startNew}
                  data-testid="theme-new"
                >
                  Build your own
                </button>
                {isExtendableTheme(selected, customThemes) ? (
                  <button
                    type="button"
                    className="btn chip"
                    onClick={remixSelected}
                    data-testid="theme-remix"
                  >
                    Remix{" "}
                    {findCustomTheme(selected, customThemes)?.name ??
                      THEME_OPTIONS.find((row) => row.id === selected)?.name}
                  </button>
                ) : null}
              </ThemeComposer>
              {noProviderReason ? (
                <p className="theme-composer-note" data-testid="theme-no-provider">
                  {noProviderReason}
                </p>
              ) : null}
              {generateError ? (
                <p className="theme-editor-error" role="alert">
                  {generateError}
                </p>
              ) : null}
              <ThemePackSettings
                themes={customThemes}
                onPreview={(next) => {
                  setEditing(null);
                  setVariant(0);
                  setPack(next);
                }}
              />
            </section>
          ) : null}
          {pack ? (
            <section className="theme-editor" aria-label="Review theme pack">
              <h3>{pack.name}</h3>
              <div className="field">
                <label htmlFor="theme-pack-variant">Preview variant</label>
                <select
                  id="theme-pack-variant"
                  value={variant}
                  onChange={(event) => setVariant(Number(event.target.value))}
                >
                  {pack.variants.map((theme, index) => (
                    <option value={index} key={theme.id}>
                      {theme.name} ({theme.adaptive ? "light & dark" : theme.scheme})
                    </option>
                  ))}
                </select>
              </div>
              <div className="theme-editor-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={customThemes.length + pack.variants.length > MAX_CUSTOM_THEMES}
                  onClick={installPack}
                >
                  Install{" "}
                  {pack.variants.length === 1 ? "theme" : `${pack.variants.length} variants`}
                </button>
                <button type="button" className="btn ghost" onClick={() => setPack(null)}>
                  Cancel import
                </button>
              </div>
            </section>
          ) : null}
          {editing ? (
            <CustomThemeEditor
              key={editing.theme.id}
              theme={editing.theme}
              customThemes={customThemes}
              isNew={editing.isNew}
              atCapacity={editing.isNew && customThemes.length >= MAX_CUSTOM_THEMES}
              renderedIssues={renderedIssues}
              generateWith={generateWith}
              modelPicker={modelPicker}
              onChange={(next) =>
                setEditing((prev) =>
                  prev?.theme.id === editing.theme.id
                    ? { ...prev, theme: typeof next === "function" ? next(prev.theme) : next }
                    : prev,
                )
              }
              onSave={saveEditing}
              onCancel={() => setEditing(null)}
              onDelete={editing.isNew ? undefined : () => deleteTheme(editing.theme.id)}
              onDuplicate={editing.isNew ? undefined : () => duplicate(editing.theme)}
            />
          ) : null}

          <div className="theme-results-head">
            <p>
              <strong>{resultsTitle}</strong>
              <span className="theme-filter-count">
                {featuredMode
                  ? "Ember, Midnight, Paper, Contrast and your recent picks"
                  : `${items.length} ${items.length === 1 ? "theme" : "themes"}`}
              </span>
            </p>
            {filter === "all" && !searching ? (
              <button
                type="button"
                className="btn small ghost"
                onClick={() => setSeeAll((open) => !open)}
                aria-expanded={seeAll}
              >
                {seeAll ? "Show featured" : `See all ${items.length} themes`}
              </button>
            ) : null}
            {searching ? (
              <button type="button" className="btn small ghost" onClick={() => setQuery("")}>
                Clear search
              </button>
            ) : null}
          </div>

          {filter === "generated" && !pageThemes.length && !editing ? (
            <p className="theme-generated-empty" data-testid="theme-generated-empty">
              No generated themes yet. Describe one above, build your own, or ask Locus in chat
              (“make me a theme that feels like a rainy Tokyo night”).
            </p>
          ) : null}
          {searching && !items.length ? (
            <p className="theme-generated-empty" data-testid="theme-search-empty">
              No themes match “{query.trim()}”.
              {filter !== "all" ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => pickFilter("all")}
                  >
                    Search all themes
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          {grouped ? (
            groupedThemeFamilies(items).map((row) => (
              <section
                key={row.family}
                className="theme-family"
                data-testid={`theme-family-${row.family}`}
              >
                <h3 className="theme-family-label">{themeFamilyLabel(row.family)}</h3>
                <div className="theme-grid">{row.items.map(card)}</div>
              </section>
            ))
          ) : (
            <div className="theme-grid">{shown.map(card)}</div>
          )}
        </section>

        <section
          className="appearance-section appearance-editor-prefs"
          aria-labelledby="chat-editor-label"
        >
          <header className="appearance-section-head">
            <div>
              <h3 id="chat-editor-label">Density &amp; editor</h3>
            </div>
          </header>
          <div className="appearance-prefs-grid">
            <div className="field appearance-chat-density">
              <span id="chat-density-label">Density</span>
              <div
                className="theme-filter-pills"
                role="radiogroup"
                aria-labelledby="chat-density-label"
              >
                {CHAT_DENSITY_OPTIONS.map((row) => (
                  <button
                    type="button"
                    key={row.id}
                    role="radio"
                    aria-checked={density === row.id}
                    className={density === row.id ? "on" : ""}
                    data-testid={`chat-density-${row.id}`}
                    title={row.hint}
                    onClick={() => props.onEditor({ chatDensity: row.id })}
                  >
                    {row.label}
                  </button>
                ))}
              </div>
              <p className="appearance-density-hint">
                {CHAT_DENSITY_OPTIONS.find((row) => row.id === density)?.hint}
              </p>
            </div>
            <div className="field appearance-font-size">
              <label htmlFor="editor-font-size">Editor font size</label>
              <div className="appearance-number">
                <input
                  id="editor-font-size"
                  type="number"
                  min={10}
                  max={20}
                  value={props.editorFontSize}
                  onChange={(event) =>
                    props.onEditor({ editorFontSize: editorFontSize(Number(event.target.value)) })
                  }
                />
                <span>px</span>
              </div>
            </div>
            <div className="appearance-toggles">
              <SettingsToggleRow
                label="Format on save"
                on={props.formatOnSave}
                testId="appearance-format-on-save"
                onChange={(next) => props.onEditor({ formatOnSave: next })}
              />
              <SettingsToggleRow
                label="Editor minimap"
                on={props.showMinimap}
                testId="appearance-minimap"
                onChange={(next) => props.onEditor({ showMinimap: next })}
              />
            </div>
          </div>
        </section>
      </div>
      <aside className="appearance-preview">
        <ThemePreview
          theme={previewId}
          customThemes={pageThemes}
          selected={previewId === selected}
          hovering={!draft && hoverId != null && hoverId !== selected}
          draft={draft ?? undefined}
          label={editing ? "editing" : pack ? "import preview" : undefined}
          onContrast={editing ? setRenderedIssues : undefined}
        />
        <ThemeDetails id={previewId} customThemes={pageThemes} />
      </aside>
    </div>
  );
}

function detailsKind(
  family: ThemeFamily,
  custom: CustomTheme | undefined,
  opt: ThemeOption | undefined,
): string {
  const kind = custom?.origin === "ai" ? "Made by Locus" : themeFamilyLabel(family);
  const adaptive = custom?.adaptive ?? opt?.adaptive;
  const scheme = adaptive ? "light & dark" : (custom?.scheme ?? opt?.scheme ?? "");
  // "Dark · dark" says nothing twice; only add the scheme when the family hides it.
  return (family === "dark" || family === "light") && !adaptive ? kind : `${kind} · ${scheme}`;
}

/** What each of a theme's four swatches shows (see customThemeSwatches). */
const THEME_SWATCH_ROLES = ["Background", "Surface", "Accent", "Second accent"] as const;

/** Name, family, summary and swatches for the theme in the preview. */
function ThemeDetails(props: { id: string; customThemes: readonly CustomTheme[] }) {
  const custom = findCustomTheme(props.id, props.customThemes);
  const opt = custom ? undefined : THEME_OPTIONS.find((row) => row.id === props.id);
  if (!custom && !opt) return null;
  const family = custom ? "generated" : themeFamily(opt!);
  const summary = custom?.summary || opt?.summary || "";
  const swatches = custom ? customThemeSwatches(custom) : opt!.swatches;
  return (
    <div className="theme-details" data-testid="theme-details">
      <div className="theme-details-swatches" role="group" aria-label="Theme colours">
        {swatches.map((color, index) => {
          const label = `${THEME_SWATCH_ROLES[index] ?? `Colour ${index + 1}`} · ${color}`;
          return (
            <span
              key={`${color}-${index}`}
              role="img"
              aria-label={label}
              title={label}
              style={{ background: color }}
            />
          );
        })}
      </div>
      <p>
        <span className="theme-details-kind">{detailsKind(family, custom, opt)}</span>
        {summary ? <span>{summary}</span> : null}
        {opt?.chatScene ? <span>Puts a space photo behind the chat thread.</span> : null}
      </p>
    </div>
  );
}

function groupedThemeFamilies(
  items: ThemeCardItem[],
): { family: ThemeFamily; items: ThemeCardItem[] }[] {
  return THEME_FAMILY_ORDER.map((family) => ({
    family,
    items: items.filter((row) => row.family === family),
  })).filter((row) => row.items.length);
}

function ThemeCard(props: {
  item: ThemeCardItem;
  customThemes: readonly CustomTheme[];
  draft?: boolean;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onPreviewEnd: () => void;
  onEdit?: () => void;
}) {
  const kind =
    props.item.custom?.origin === "ai" ? "Made by Locus" : themeFamilyLabel(props.item.family);
  return (
    <div className={`theme-card-wrap${props.onEdit ? " editable" : ""}`}>
      <button
        type="button"
        className={`theme-card${props.selected ? " active" : ""}`}
        aria-pressed={props.selected}
        title={props.item.summary || undefined}
        onClick={props.onSelect}
        onMouseEnter={props.onPreview}
        onMouseLeave={props.onPreviewEnd}
        onFocus={props.onPreview}
        onBlur={props.onPreviewEnd}
      >
        <div
          className="theme-thumb"
          {...themeSurfaceAttrs(props.item.id, props.customThemes)}
          data-theme-draft={props.draft ? "" : undefined}
          aria-hidden="true"
        >
          <div className="theme-thumb-chrome">
            <span />
            <span />
            <span />
          </div>
          <div className="theme-thumb-stage">
            <em />
            <em />
            <strong />
          </div>
        </div>
        <div className="theme-card-meta">
          <h3 title={props.item.name}>{props.item.name}</h3>
          <span className="theme-card-kind">{props.selected ? "Selected" : kind}</span>
        </div>
      </button>
      {props.onEdit ? (
        <button
          type="button"
          className="btn small ghost theme-card-edit"
          onClick={props.onEdit}
          aria-label={`Edit ${props.item.name}`}
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}
