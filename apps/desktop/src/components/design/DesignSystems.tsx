import {
  DEFAULT_DESIGN_PALETTE,
  DEFAULT_DESIGN_RADIUS_PX,
  DEFAULT_DESIGN_SPACE_PX,
  DEFAULT_DESIGN_TYPOGRAPHY,
  MAX_DESIGN_IMPORT_BYTES,
  PALETTE_PRESETS,
  PALETTE_ROLE_LABELS,
  PALETTE_ROLES,
  designSystemFileName,
  exportDesignSystem,
  formatDesignImportBytes,
  isBuiltinDesignSystemId,
  isDesignSession,
  normalizeHex,
  type DesignPalette,
  type DesignSystem,
  type DesignTypography,
  type PaletteRole,
} from "@locus/shared";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { IconClose, IconPlus } from "@/components/layout/Icons";

function emptyDraft(palette: DesignPalette = { ...DEFAULT_DESIGN_PALETTE }): EditorState {
  return {
    id: "",
    name: "",
    summary: "",
    palette,
    typography: { ...DEFAULT_DESIGN_TYPOGRAPHY },
    radiusPx: DEFAULT_DESIGN_RADIUS_PX,
    spacePx: DEFAULT_DESIGN_SPACE_PX,
    guidelines: "",
  };
}

interface EditorState {
  id: string;
  name: string;
  summary: string;
  palette: DesignPalette;
  typography: DesignTypography;
  radiusPx: number;
  spacePx: number;
  guidelines: string;
}

function toEditor(system: DesignSystem): EditorState {
  return {
    id: system.id,
    name: system.name,
    summary: system.summary,
    palette: { ...system.palette },
    typography: { ...system.typography },
    radiusPx: system.radiusPx,
    spacePx: system.spacePx,
    guidelines: system.guidelines ?? "",
  };
}

function channelLin(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function hexLuminance(hex: string): number {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  if (!Number.isFinite(n)) return 0;
  return (
    0.2126 * channelLin((n >> 16) & 255) +
    0.7152 * channelLin((n >> 8) & 255) +
    0.0722 * channelLin(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const l1 = hexLuminance(a);
  const l2 = hexLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function inkOn(bg: string): string {
  return contrastRatio(bg, "#111111") >= contrastRatio(bg, "#f4f1ea") ? "#111111" : "#f4f1ea";
}

async function waitForPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function MiniSwatches({ palette }: { palette: DesignPalette }) {
  return (
    <span className="ds-mini-swatches" aria-hidden>
      {PALETTE_ROLES.slice(0, 4).map((role) => (
        <span key={role} style={{ background: palette[role] }} />
      ))}
    </span>
  );
}

const TYPE_ROWS = [
  { key: "sans" as const, label: "UI font", sample: "Aa — Interface and body" },
  { key: "display" as const, label: "Display font", sample: "Aa — Headlines and titles" },
  { key: "mono" as const, label: "Mono font", sample: "Aa — Code and tokens" },
];

export function DesignSystemsModal() {
  const { state, dispatch } = useStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<EditorState>(emptyDraft());
  const [origin, setOrigin] = useState<EditorState>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openedAt = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const session = state.sessions.find((s) => s.id === state.selectedId);
  const defaultId = state.config?.defaultDesignSystemId;
  const builtin = isBuiltinDesignSystemId(draft.id);
  const saved = state.designSystems.filter((row) => !isBuiltinDesignSystemId(row.id));
  const dirty = JSON.stringify(draft) !== JSON.stringify(origin);
  const blocked = busy || Boolean(importing);
  const ratio = contrastRatio(draft.palette.text, draft.palette.bg);
  const contrastLabel = `${ratio.toFixed(2)}:1 ${ratio >= 4.5 ? "AA" : "Fail"}`;

  function applyEditor(next: EditorState) {
    setDraft(next);
    setOrigin(next);
    setError(null);
  }

  function confirmDiscard(): boolean {
    if (JSON.stringify(draft) === JSON.stringify(origin)) return true;
    return window.confirm("Discard unsaved changes to this design system?");
  }

  function load(next: EditorState) {
    if (!confirmDiscard()) return;
    applyEditor(next);
  }

  useEffect(() => {
    if (!state.designSystemsOpen) return;
    openedAt.current = Date.now();
    setError(null);
    const first = state.designSystems[0];
    if (first) {
      applyEditor(toEditor(first));
      return;
    }
    const preset = PALETTE_PRESETS[0];
    if (preset) {
      applyEditor({
        ...emptyDraft(preset.colors),
        id: `preset:${preset.id}`,
        name: preset.name,
        summary: preset.summary,
      });
      return;
    }
    applyEditor(emptyDraft(session?.palette ?? DEFAULT_DESIGN_PALETTE));
  }, [state.designSystemsOpen]);

  const close = useCallback(() => {
    if (
      JSON.stringify(draft) !== JSON.stringify(origin) &&
      !window.confirm("Discard unsaved changes to this design system?")
    ) {
      return;
    }
    dispatch({ type: "designSystems", open: false });
  }, [dispatch, draft, origin]);
  useDialogFocus(state.designSystemsOpen, close, dialogRef);

  function onBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (Date.now() - openedAt.current < 250) return;
    close();
  }

  function setRole(role: PaletteRole, raw: string) {
    const hex = normalizeHex(raw);
    if (!hex) return;
    setDraft({ ...draft, palette: { ...draft.palette, [role]: hex } });
  }

  async function refresh() {
    const catalog = await api.designSystems();
    dispatch({ type: "designSystemList", systems: catalog.systems });
    if (state.config && catalog.defaultId !== state.config.defaultDesignSystemId) {
      dispatch({
        type: "config",
        config: { ...state.config, defaultDesignSystemId: catalog.defaultId },
      });
    }
    return catalog;
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: draft.name.trim() || "Untitled system",
        summary: draft.summary.trim(),
        palette: draft.palette,
        typography: draft.typography,
        radiusPx: draft.radiusPx,
        spacePx: draft.spacePx,
        guidelines: draft.guidelines.trim() || undefined,
      };
      const savedRow =
        draft.id && !builtin
          ? await api.patchDesignSystem(draft.id, body)
          : await api.createDesignSystem(body);
      const catalog = await refresh();
      const next = catalog.systems.find((row) => row.id === savedRow.id) ?? savedRow;
      applyEditor(toEditor(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save design system");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft.id || builtin) return;
    if (
      !window.confirm(
        `Delete “${draft.name.trim() || "this design system"}”? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const catalog = await api.deleteDesignSystem(draft.id);
      dispatch({ type: "designSystemList", systems: catalog.systems });
      if (state.config) {
        dispatch({
          type: "config",
          config: { ...state.config, defaultDesignSystemId: catalog.defaultId },
        });
      }
      if (catalog.systems[0]) applyEditor(toEditor(catalog.systems[0]));
      else if (PALETTE_PRESETS[0]) {
        const preset = PALETTE_PRESETS[0];
        applyEditor({
          ...emptyDraft(preset.colors),
          id: `preset:${preset.id}`,
          name: preset.name,
          summary: preset.summary,
        });
      } else applyEditor(emptyDraft());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete design system");
    } finally {
      setBusy(false);
    }
  }

  function exportCurrent() {
    const payload = exportDesignSystem({
      id: draft.id || "draft",
      name: draft.name.trim() || "Untitled system",
      summary: draft.summary.trim(),
      palette: draft.palette,
      typography: draft.typography,
      radiusPx: draft.radiusPx,
      spacePx: draft.spacePx,
      guidelines: draft.guidelines.trim() || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = designSystemFileName(payload.system as { name: string });
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File) {
    if (file.size > MAX_DESIGN_IMPORT_BYTES) {
      setError(
        `Zip is too large (${formatDesignImportBytes(file.size)}; max ${formatDesignImportBytes(MAX_DESIGN_IMPORT_BYTES)}). Remove source uploads or nested archives and try again.`,
      );
      return;
    }
    setImporting({ name: file.name, size: file.size });
    setError(null);
    await waitForPaint();
    try {
      const savedRow = await api.importDesignSystem({ file, filename: file.name });
      const catalog = await refresh();
      const next = catalog.systems.find((row) => row.id === savedRow.id) ?? savedRow;
      applyEditor(toEditor(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import that file");
    } finally {
      setImporting(null);
    }
  }

  async function setDefault(id: string) {
    setBusy(true);
    setError(null);
    try {
      const catalog = await api.setDefaultDesignSystem(id);
      dispatch({ type: "designSystemList", systems: catalog.systems });
      if (state.config) {
        dispatch({
          type: "config",
          config: { ...state.config, defaultDesignSystemId: catalog.defaultId },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the default system");
    } finally {
      setBusy(false);
    }
  }

  async function applyToSession() {
    if (!session || !draft.id) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patchSession(session.id, {
        designSystemId: draft.id,
        palette: draft.palette,
      });
      dispatch({ type: "session", session: updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply the design system");
    } finally {
      setBusy(false);
    }
  }

  const primaryInk = inkOn(draft.palette.primary);

  if (!state.designSystemsOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onBackdrop}>
      <div
        className="modal design-systems-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-systems-title"
        aria-busy={blocked || undefined}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ds-head">
          <div>
            <h2 id="design-systems-title">Design systems</h2>
            <p className="modal-lead">
              Reusable brand tokens for Design. Create one, import a Locus JSON file or a Claude
              Design zip/HTML export, or export to share. New designs can start from the default.
            </p>
          </div>
          <div className="ds-head-actions">
            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".json,.html,.css,.md,.zip,.locus-design.json,application/json,text/html,text/css,application/zip"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importFile(file);
              }}
            />
            <button
              type="button"
              className="btn ghost small"
              onClick={() => fileInput.current?.click()}
              disabled={blocked}
            >
              {importing ? "Importing…" : "Import"}
            </button>
            <button
              type="button"
              className="btn ghost small"
              onClick={exportCurrent}
              disabled={blocked}
            >
              Export
            </button>
            <button
              type="button"
              className="btn icon ghost small"
              aria-label="Close"
              onClick={close}
            >
              <IconClose />
            </button>
          </div>
        </header>

        <div className="ds-body">
          {importing ? (
            <div
              className="ds-import-overlay"
              data-testid="ds-import-overlay"
              role="status"
              aria-live="polite"
            >
              <div className="ds-import-spinner" aria-hidden />
              <p className="ds-import-title">Importing {importing.name}</p>
              <p className="hint">
                {importing.size >= 8 * 1024 * 1024
                  ? `${formatDesignImportBytes(importing.size)} · reading token files. Source uploads and nested zips stay in the archive.`
                  : `${formatDesignImportBytes(importing.size)} · reading design tokens…`}
              </p>
            </div>
          ) : null}
          <nav className="ds-nav" aria-label="Saved systems">
            <button
              type="button"
              className={`ds-new ${!draft.id ? "active" : ""}`}
              onClick={() => load(emptyDraft(session?.palette))}
            >
              <IconPlus /> New system
            </button>
            {saved.length ? (
              <>
                <div className="ds-nav-group">Saved</div>
                {saved.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`ds-nav-item ${draft.id === row.id ? "active" : ""}`}
                    onClick={() => load(toEditor(row))}
                  >
                    <MiniSwatches palette={row.palette} />
                    <span className="ds-nav-name">
                      {row.name}
                      {defaultId === row.id ? (
                        <span className="design-system-default">default</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </>
            ) : null}
            <div className="ds-nav-group">Starters</div>
            {PALETTE_PRESETS.map((preset) => {
              const id = `preset:${preset.id}`;
              return (
                <button
                  key={id}
                  type="button"
                  className={`ds-nav-item ${draft.id === id ? "active" : ""}`}
                  onClick={() =>
                    load({
                      ...emptyDraft(preset.colors),
                      id,
                      name: preset.name,
                      summary: preset.summary,
                    })
                  }
                >
                  <MiniSwatches palette={preset.colors} />
                  <span className="ds-nav-name">{preset.name}</span>
                </button>
              );
            })}
          </nav>

          <div className="ds-editor">
            <div className="ds-fields">
              <div className="field">
                <label>Name</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Acme brand"
                />
              </div>
              <div className="field">
                <label>Summary</label>
                <input
                  value={draft.summary}
                  onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                  placeholder="Warm editorial, copper CTAs"
                />
              </div>
            </div>

            <div className="ds-section-label">Colors</div>
            <div className="ds-tokens">
              {PALETTE_ROLES.map((role) => (
                <label key={role} className="ds-token">
                  <input
                    type="color"
                    aria-label={PALETTE_ROLE_LABELS[role]}
                    value={draft.palette[role]}
                    onChange={(e) => setRole(role, e.target.value)}
                  />
                  <span>
                    <span className="ds-token-name">{PALETTE_ROLE_LABELS[role]}</span>
                    <input
                      type="text"
                      spellCheck={false}
                      value={draft.palette[role]}
                      onChange={(e) => setRole(role, e.target.value)}
                    />
                  </span>
                </label>
              ))}
            </div>

            <div className="ds-section-label">Type</div>
            <div className="ds-type-list">
              {TYPE_ROWS.map((row) => (
                <label key={row.key} className="ds-type-row">
                  <span
                    className="ds-type-sample"
                    style={{ fontFamily: draft.typography[row.key] }}
                  >
                    {row.sample}
                  </span>
                  <span className="ds-type-meta">
                    <span>{row.label}</span>
                    <input
                      value={draft.typography[row.key]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          typography: { ...draft.typography, [row.key]: e.target.value },
                        })
                      }
                    />
                  </span>
                </label>
              ))}
            </div>

            <div className="design-system-metrics">
              <label>
                Size
                <input
                  type="number"
                  min={10}
                  max={28}
                  value={draft.typography.basePx}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      typography: { ...draft.typography, basePx: Number(e.target.value) || 16 },
                    })
                  }
                />
              </label>
              <label>
                Radius
                <input
                  type="number"
                  min={0}
                  max={48}
                  value={draft.radiusPx}
                  onChange={(e) => setDraft({ ...draft, radiusPx: Number(e.target.value) || 0 })}
                />
              </label>
              <label>
                Grid
                <input
                  type="number"
                  min={4}
                  max={32}
                  value={draft.spacePx}
                  onChange={(e) => setDraft({ ...draft, spacePx: Number(e.target.value) || 8 })}
                />
              </label>
            </div>

            <div className="field">
              <label>Guidelines (optional)</label>
              <textarea
                value={draft.guidelines}
                onChange={(e) => setDraft({ ...draft, guidelines: e.target.value })}
                placeholder="Tone, layout habits, what to avoid…"
              />
            </div>
            {builtin ? (
              <p className="hint">
                Starter palettes are built in. Save a copy to edit or set as default.
              </p>
            ) : null}
            {error ? (
              <p className="scrim-note" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            ) : null}
          </div>

          <aside className="ds-preview" aria-label="System preview">
            <div
              className="ds-specimen"
              style={{
                background: draft.palette.bg,
                color: draft.palette.text,
                borderColor: `color-mix(in srgb, ${draft.palette.text} 14%, ${draft.palette.bg})`,
                fontFamily: draft.typography.sans,
                fontSize: draft.typography.basePx,
                ["--ds-radius" as string]: `${draft.radiusPx}px`,
              }}
            >
              <div className="ds-specimen-head">
                <div>
                  <h3 style={{ fontFamily: draft.typography.display }}>A specimen of the system</h3>
                  <p style={{ color: draft.palette.muted }}>
                    {draft.summary.trim() || "Title, muted subtitle, primary CTA top-right."}
                  </p>
                </div>
                <span
                  className="ds-specimen-primary"
                  style={{ background: draft.palette.primary, color: primaryInk }}
                >
                  New task
                </span>
              </div>
              <div className="ds-specimen-kicker" style={{ color: draft.palette.muted }}>
                Your scheduled tasks
                <span
                  className="ds-specimen-count"
                  style={{ background: draft.palette.surface, color: draft.palette.muted }}
                >
                  1
                </span>
              </div>
              <div
                className="ds-specimen-row"
                style={{
                  background: draft.palette.bg,
                  borderColor: `color-mix(in srgb, ${draft.palette.text} 14%, ${draft.palette.bg})`,
                }}
              >
                <div className="ds-specimen-row-copy">
                  <strong>Morning print queue</strong>
                  <span style={{ color: draft.palette.muted }}>Weekdays at 8:00am</span>
                </div>
                <div className="ds-specimen-actions">
                  <span
                    className="ds-specimen-primary"
                    style={{ background: draft.palette.primary, color: primaryInk }}
                  >
                    Run
                  </span>
                  <span
                    className="ds-specimen-secondary"
                    style={{ borderColor: draft.palette.primary, color: draft.palette.primary }}
                  >
                    Pause
                  </span>
                </div>
              </div>
              <div
                className="ds-specimen-starter"
                style={{
                  borderColor: `color-mix(in srgb, ${draft.palette.text} 14%, ${draft.palette.bg})`,
                }}
              >
                <span className="ds-specimen-tile" style={{ background: draft.palette.surface }} />
                <span className="ds-specimen-row-copy">
                  <strong>Open tickets</strong>
                  <span style={{ color: draft.palette.muted }}>Weekdays at 8:30am</span>
                </span>
                <span style={{ color: draft.palette.muted }}>+</span>
              </div>
            </div>
            <p className={`ds-contrast ${ratio >= 4.5 ? "ok" : "fail"}`}>
              Contrast text on background: {contrastLabel}
            </p>
          </aside>
        </div>

        <footer className="ds-foot">
          <div className="ds-foot-left">
            <span className="hint">
              {dirty
                ? `Unsaved changes${draft.name.trim() ? ` to ${draft.name.trim()}` : ""}`
                : "No unsaved changes"}
            </span>
            {draft.id && !builtin ? (
              <button
                type="button"
                className="btn ghost small"
                disabled={blocked}
                onClick={() => void setDefault(defaultId === draft.id ? "none" : draft.id)}
              >
                {defaultId === draft.id ? "Clear default" : "Use for new designs"}
              </button>
            ) : null}
            {isDesignSession(session ?? {}) && draft.id ? (
              <button
                type="button"
                className="btn ghost small"
                disabled={blocked}
                onClick={() => void applyToSession()}
              >
                Apply to canvas
              </button>
            ) : null}
            {draft.id && !builtin ? (
              <button
                type="button"
                className="btn ghost small danger"
                disabled={blocked}
                onClick={() => void remove()}
              >
                Delete
              </button>
            ) : null}
          </div>
          <div className="ds-foot-right">
            <button type="button" className="btn ghost" onClick={close}>
              Close
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={blocked}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : builtin || !draft.id ? "Save copy" : "Save"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
