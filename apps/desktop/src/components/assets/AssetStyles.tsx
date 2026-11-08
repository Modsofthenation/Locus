import {
  assetStyleFileName,
  describeAssetStudioStyle,
  exportAssetStyle,
  isAssetSession,
  lastAssetLookPrompt,
  type AssetStyle,
} from "@locus/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";
import { Modal } from "@/components/layout/Modal";
import { askConfirm } from "@/lib/dialog";
import { IconClose, IconPlus } from "@/components/layout/Icons";

interface EditorState {
  id: string;
  name: string;
  summary: string;
  guidelines: string;
}

function emptyDraft(): EditorState {
  return { id: "", name: "", summary: "", guidelines: "" };
}

function toEditor(style: AssetStyle): EditorState {
  return {
    id: style.id,
    name: style.name,
    summary: style.summary,
    guidelines: style.guidelines,
  };
}

export function AssetStylesModal() {
  const { state, dispatch } = useStore();
  const [draft, setDraft] = useState<EditorState>(emptyDraft());
  const [origin, setOrigin] = useState<EditorState>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = state.sessions.find((s) => s.id === state.selectedId);
  const defaultId = state.config?.defaultAssetStyleId;
  const dirty = JSON.stringify(draft) !== JSON.stringify(origin);
  const saved = state.assetStyles;

  function load(next: EditorState) {
    setDraft(next);
    setOrigin(next);
    setError(null);
  }

  const close = useCallback(() => {
    dispatch({ type: "assetStyles", open: false });
  }, [dispatch]);

  useEffect(() => {
    if (!state.assetStylesOpen) return;
    setError(null);
    const boundId = isAssetSession(session ?? {}) ? session?.assetStyleId : undefined;
    const bound = boundId ? state.assetStyles.find((row) => row.id === boundId) : undefined;
    if (bound) {
      load(toEditor(bound));
      return;
    }
    if (isAssetSession(session ?? {})) {
      load(emptyDraft());
      void fillFromStudio();
      return;
    }
    const first = state.assetStyles[0];
    if (first) load(toEditor(first));
    else load(emptyDraft());
  }, [state.assetStylesOpen]);

  async function refresh() {
    const catalog = await api.assetStyles();
    dispatch({ type: "assetStyleList", styles: catalog.styles });
    if (state.config && catalog.defaultId !== state.config.defaultAssetStyleId) {
      dispatch({
        type: "config",
        config: { ...state.config, defaultAssetStyleId: catalog.defaultId },
      });
    }
    return catalog;
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: draft.name.trim() || "Untitled style",
        summary: draft.summary.trim(),
        guidelines: draft.guidelines.trim(),
      };
      const savedRow = draft.id
        ? await api.patchAssetStyle(draft.id, body)
        : await api.createAssetStyle(body);
      const catalog = await refresh();
      const next = catalog.styles.find((row) => row.id === savedRow.id) ?? savedRow;
      load(toEditor(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the style");
    } finally {
      setBusy(false);
    }
  }

  async function saveFromStudio() {
    if (!session || !isAssetSession(session)) return;
    setBusy(true);
    setError(null);
    try {
      const savedRow = await api.saveAssetStyleFromSession(session.id, {
        name: !draft.id && draft.name.trim() ? draft.name.trim() : undefined,
      });
      const catalog = await refresh();
      const next = catalog.styles.find((row) => row.id === savedRow.id) ?? savedRow;
      load(toEditor(next));
      const updated = await api.session(session.id);
      dispatch({ type: "session", session: updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save a style from this studio");
    } finally {
      setBusy(false);
    }
  }

  async function fillFromStudio() {
    if (!session || !isAssetSession(session)) return;
    setBusy(true);
    setError(null);
    try {
      const [file, canvas] = await Promise.all([
        api.workspaceFile(session.id, "ASSET.md").catch(() => undefined),
        api.canvas(session.id).catch(() => undefined),
      ]);
      const extracted = describeAssetStudioStyle({
        brief: file?.content ?? "",
        html: canvas?.html,
        title: session.title,
        prompt: lastAssetLookPrompt(session.messages ?? []),
        palette: session.palette,
        build: session.assetBuild,
      });
      load({
        id: "",
        name: extracted.name ?? "",
        summary: extracted.summary ?? "",
        guidelines: extracted.guidelines ?? "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read ASSET.md");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft.id) return;
    if (
      !(await askConfirm({
        title: `Delete “${draft.name || "this style"}”?`,
        body: "This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const catalog = await api.deleteAssetStyle(draft.id);
      dispatch({ type: "assetStyleList", styles: catalog.styles });
      if (state.config) {
        dispatch({
          type: "config",
          config: { ...state.config, defaultAssetStyleId: catalog.defaultId },
        });
      }
      const first = catalog.styles[0];
      load(first ? toEditor(first) : emptyDraft());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the style");
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(id: string) {
    setBusy(true);
    setError(null);
    try {
      const catalog = await api.setDefaultAssetStyle(id);
      dispatch({ type: "assetStyleList", styles: catalog.styles });
      if (state.config) {
        dispatch({
          type: "config",
          config: { ...state.config, defaultAssetStyleId: catalog.defaultId },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the default style");
    } finally {
      setBusy(false);
    }
  }

  async function applyToSession() {
    if (!session || !draft.id) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patchSession(session.id, { assetStyleId: draft.id });
      dispatch({ type: "session", session: updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply the style");
    } finally {
      setBusy(false);
    }
  }

  function exportCurrent() {
    const payload = exportAssetStyle({
      id: draft.id || "draft",
      name: draft.name.trim() || "Untitled style",
      summary: draft.summary.trim(),
      guidelines: draft.guidelines.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = assetStyleFileName(payload.style as { name: string });
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!state.assetStylesOpen) return null;

  return (
    <Modal
      titleId="asset-styles-title"
      className="design-systems-modal"
      closeGuardMs={250}
      onClose={close}
    >
      <header className="ds-head">
        <div>
          <h2 id="asset-styles-title">Asset styles</h2>
          <p className="modal-lead">
            Reusable art direction for Assets. Save a look from a studio, then apply it to later
            generations.
          </p>
        </div>
        <div className="ds-head-actions">
          <button type="button" className="btn ghost small" onClick={exportCurrent} disabled={busy}>
            Export
          </button>
          <button type="button" className="btn icon ghost small" aria-label="Close" onClick={close}>
            <IconClose />
          </button>
        </div>
      </header>

      <div className="ds-body">
        <nav className="ds-nav" aria-label="Saved styles">
          <button
            type="button"
            className={`ds-new ${!draft.id ? "active" : ""}`}
            onClick={() => load(emptyDraft())}
          >
            <IconPlus /> New style
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
                  <span className="ds-nav-name">
                    {row.name}
                    {defaultId === row.id ? (
                      <span className="design-system-default">default</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </>
          ) : (
            <p className="hint">No saved styles yet.</p>
          )}
        </nav>

        <div className="ds-editor">
          <div className="ds-fields">
            <div className="field">
              <label>Name</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Clay hero"
              />
            </div>
            <div className="field">
              <label>Summary</label>
              <input
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                placeholder="Chunky terracotta, cream grout"
              />
            </div>
          </div>
          <div className="field">
            <label>Guidelines</label>
            <textarea
              rows={10}
              value={draft.guidelines}
              onChange={(e) => setDraft({ ...draft, guidelines: e.target.value })}
              placeholder="Silhouette, materials, poly budget, color language…"
            />
          </div>
          {error ? (
            <p className="hint" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <footer className="ds-foot">
        <div className="ds-foot-left">
          <span className="hint">
            {dirty
              ? `Unsaved changes${draft.name.trim() ? ` to ${draft.name.trim()}` : ""}`
              : "No unsaved changes"}
          </span>
          {draft.id ? (
            <button
              type="button"
              className="btn ghost small"
              disabled={busy}
              onClick={() => void setDefault(defaultId === draft.id ? "none" : draft.id)}
            >
              {defaultId === draft.id ? "Clear default" : "Use for new assets"}
            </button>
          ) : null}
          {isAssetSession(session ?? {}) && draft.id ? (
            <button
              type="button"
              className="btn ghost small"
              disabled={busy}
              onClick={() => void applyToSession()}
            >
              Apply to studio
            </button>
          ) : null}
          {isAssetSession(session ?? {}) ? (
            <>
              <button
                type="button"
                className="btn ghost small"
                disabled={busy}
                onClick={() => void fillFromStudio()}
              >
                Load from studio
              </button>
              <button
                type="button"
                className="btn ghost small"
                disabled={busy}
                onClick={() => void saveFromStudio()}
              >
                Save from this studio
              </button>
            </>
          ) : null}
          {draft.id ? (
            <button
              type="button"
              className="btn ghost small danger"
              disabled={busy}
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
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : draft.id ? "Save" : "Save copy"}
          </button>
        </div>
      </footer>
    </Modal>
  );
}
