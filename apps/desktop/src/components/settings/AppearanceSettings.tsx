import { useState } from "react";
import {
  THEME_OPTIONS,
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
  type ThemeFilter,
  type ThemeId,
  type ThemeOption,
} from "@locus/shared";
import { ThemePreview } from "./ThemePreview";
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
    hint: "Full control plane — Agents, Design, IDE, guests, and forge tools.",
  },
  {
    id: "swarm",
    label: PRODUCT_MODE_LABELS.swarm,
    hint: "Teammate-first shell — chats stay in Swarm; Developer chats stay in Developer.",
  },
];

const FILTERS: { id: ThemeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "contrast", label: "High contrast" },
  { id: "gradient", label: "Gradient" },
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
  const pinnedIds = [selected, ...recents];
  const shown =
    filter === "all" && !seeAll
      ? pinnedIds
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
        <header className="appearance-head">
          <p>Hover a theme to preview it live. Click to apply.</p>
        </header>
        <div className="appearance-editor-prefs">
          <div className="field appearance-chat-density">
            <span id="product-mode-label">Product mode</span>
            <div
              className="theme-filter-pills"
              role="radiogroup"
              aria-labelledby="product-mode-label"
            >
              {PRODUCT_MODE_OPTIONS.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  role="radio"
                  aria-checked={productMode === row.id}
                  className={productMode === row.id ? "on" : ""}
                  data-testid={`appearance-product-mode-${row.id}`}
                  onClick={() => props.onEditor({ productMode: row.id })}
                >
                  {row.label}
                </button>
              ))}
            </div>
            <p className="appearance-density-hint">
              {PRODUCT_MODE_OPTIONS.find((row) => row.id === productMode)?.hint}
            </p>
          </div>
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
          <label className="check-row">
            <input
              type="checkbox"
              checked={props.formatOnSave}
              onChange={(event) => props.onEditor({ formatOnSave: event.target.checked })}
            />
            Format on save
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={props.showMinimap}
              onChange={(event) => props.onEditor({ showMinimap: event.target.checked })}
            />
            Editor minimap
          </label>
        </div>
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
            <button type="button" className="btn small ghost" onClick={() => setSeeAll(true)}>
              See all {themes.length} themes
            </button>
          </div>
        ) : null}
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
