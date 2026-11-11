import { useState } from "react";
import {
  THEME_OPTIONS,
  FEATURED_THEME_IDS,
  editorFontSize,
  filterThemeOptions,
  parseChatDensity,
  parseProductMode,
  resolveTheme,
  themeFamily,
  themeFamilyLabel,
  themeOption,
  type ChatDensity,
  type ProductMode,
  type ThemeFamily,
  type ThemeFilter,
  type ThemeId,
  type ThemeOption,
} from "@locus/shared";
import { ThemePreview } from "./ThemePreview";
import { SettingsToggleRow } from "./SettingsBits";
import { PRODUCT_MODE_LABELS } from "@/lib/productMode";

const CHAT_SCENE_NAMES = THEME_OPTIONS.filter((t) => t.chatScene).map((t) => t.name);

const CHAT_DENSITY_OPTIONS: { id: ChatDensity; label: string }[] = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" },
  { id: "dense", label: "Dense" },
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

const FILTERS: { id: ThemeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "contrast", label: "High contrast" },
  { id: "gradient", label: "Gradient" },
  { id: "terminal", label: "Terminal" },
];

const THEME_RECENTS_KEY = "locus.themeRecents";

function loadThemeRecents(): ThemeId[] {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is ThemeId => typeof id === "string");
  } catch {
    return [];
  }
}

function rememberThemeRecent(id: ThemeId) {
  const next = [id, ...loadThemeRecents().filter((row) => row !== id)].slice(0, 4);
  try {
    globalThis.localStorage?.setItem(THEME_RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

export function AppearanceSettings(props: {
  theme: string;
  savedTheme: string;
  productMode?: ProductMode;
  chatDensity?: ChatDensity;
  editorFontSize: number;
  formatOnSave: boolean;
  showMinimap: boolean;
  onSelect: (id: ThemeId) => void;
  onEditor: (patch: {
    productMode?: ProductMode;
    chatDensity?: ChatDensity;
    editorFontSize?: number;
    formatOnSave?: boolean;
    showMinimap?: boolean;
  }) => void;
}) {
  const selected = resolveTheme(props.theme);
  const saved = resolveTheme(props.savedTheme);
  const savedOpt = themeOption(saved);
  const density = parseChatDensity(props.chatDensity);
  const productMode = parseProductMode(props.productMode);
  const [filter, setFilter] = useState<ThemeFilter>("all");
  const [seeAll, setSeeAll] = useState(false);
  const [hoverId, setHoverId] = useState<ThemeId | null>(null);
  const previewId = hoverId ?? selected;
  const themes = filterThemeOptions(filter);
  const recents = loadThemeRecents()
    .filter((id) => id !== selected)
    .slice(0, 3);
  const featuredIds = [
    selected,
    ...FEATURED_THEME_IDS.filter((id) => id !== selected),
    ...recents.filter((id) => id !== selected && !FEATURED_THEME_IDS.includes(id)),
  ];
  const shown =
    filter === "all" && !seeAll
      ? featuredIds
          .map((id) => themes.find((opt) => opt.id === id) ?? themeOption(id))
          .filter((opt, index, rows) => rows.findIndex((row) => row.id === opt.id) === index)
      : themes;

  function selectTheme(id: ThemeId) {
    rememberThemeRecent(selected);
    props.onSelect(id);
  }

  return (
    <div className="appearance-layout">
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
        <div className="appearance-editor-prefs">
          <div className="field appearance-chat-density">
            <span id="chat-density-label">Chat density</span>
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
                  onClick={() => props.onEditor({ chatDensity: row.id })}
                >
                  {row.label}
                </button>
              ))}
            </div>
            <p className="appearance-density-hint">
              Comfortable is the original spacing. Compact fits more transcript. Dense is the
              tightest.
            </p>
          </div>
          <div className="field">
            <label htmlFor="editor-font-size">Editor font size</label>
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
        <header className="appearance-head">
          <p>Hover a theme to preview it live. Click to apply.</p>
        </header>
        <div className="theme-filters">
          <div className="theme-filter-pills" role="radiogroup" aria-label="Theme filters">
            {FILTERS.map((row) => (
              <button
                type="button"
                key={row.id}
                role="radio"
                aria-checked={filter === row.id}
                className={filter === row.id ? "on" : ""}
                data-testid={`theme-filter-${row.id}`}
                onClick={() => setFilter(row.id)}
              >
                {row.label}
              </button>
            ))}
          </div>
          <p className="theme-filter-count">
            {themes.length} {themes.length === 1 ? "theme" : "themes"}
          </p>
        </div>
        {CHAT_SCENE_NAMES.length ? (
          <p className="scrim-note appearance-scene-note">
            {CHAT_SCENE_NAMES.join(", ")} put a space photo behind the chat thread.
          </p>
        ) : null}
        {filter === "all" && !seeAll ? (
          <div className="theme-recents">
            <p className="theme-featured-note">
              Featured: Ember, Midnight, Paper, and Contrast. Hover to preview.
            </p>
            <button type="button" className="btn small ghost" onClick={() => setSeeAll(true)}>
              See all {themes.length} themes
            </button>
          </div>
        ) : null}
        {filter === "all" && seeAll ? (
          groupedThemeFamilies(themes).map((row) => (
            <section
              key={row.family}
              className="theme-family"
              data-testid={`theme-family-${row.family}`}
            >
              <h3 className="theme-family-label">{themeFamilyLabel(row.family)}</h3>
              <div className="theme-grid">
                {row.items.map((opt) => (
                  <ThemeCard
                    key={opt.id}
                    opt={opt}
                    selected={selected === opt.id}
                    onSelect={() => selectTheme(opt.id)}
                    onPreview={() => setHoverId(opt.id)}
                    onPreviewEnd={() => setHoverId((id) => (id === opt.id ? null : id))}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="theme-grid">
            {shown.map((opt) => (
              <ThemeCard
                key={opt.id}
                opt={opt}
                selected={selected === opt.id}
                onSelect={() => selectTheme(opt.id)}
                onPreview={() => setHoverId(opt.id)}
                onPreviewEnd={() => setHoverId((id) => (id === opt.id ? null : id))}
              />
            ))}
          </div>
        )}
      </div>
      <aside className="appearance-preview">
        <ThemePreview
          theme={previewId}
          selected={previewId === selected}
          hovering={hoverId != null && hoverId !== selected}
        />
        <p className="appearance-applied">Applied theme: {savedOpt.name}</p>
      </aside>
    </div>
  );
}

const THEME_FAMILY_ORDER: ThemeFamily[] = ["dark", "light", "contrast", "gradient", "terminal"];

function groupedThemeFamilies(
  themes: ThemeOption[],
): { family: ThemeFamily; items: ThemeOption[] }[] {
  return THEME_FAMILY_ORDER.map((family) => ({
    family,
    items: themes.filter((opt) => themeFamily(opt) === family),
  })).filter((row) => row.items.length);
}

function ThemeCard(props: {
  opt: ThemeOption;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onPreviewEnd: () => void;
}) {
  const family = themeFamily(props.opt);
  return (
    <button
      type="button"
      className={`theme-card${props.selected ? " active" : ""}`}
      aria-pressed={props.selected}
      onClick={props.onSelect}
      onMouseEnter={props.onPreview}
      onMouseLeave={props.onPreviewEnd}
      onFocus={props.onPreview}
      onBlur={props.onPreviewEnd}
    >
      <div
        className="theme-thumb"
        data-theme={props.opt.id}
        {...(props.opt.gradient ? { "data-theme-gradient": "" } : {})}
        {...(props.opt.terminal ? { "data-theme-terminal": "" } : {})}
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
        <h3>{props.opt.name}</h3>
        <span className="theme-card-kind">
          {props.selected ? "Selected" : themeFamilyLabel(family)}
        </span>
      </div>
    </button>
  );
}
