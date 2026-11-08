import { isGameSession, type GameStyle } from "@locus/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";
import { Modal } from "@/components/layout/Modal";
import { IconClose, IconPlus } from "@/components/layout/Icons";
import { Select } from "@/components/layout/Select";

interface EditorState {
  id: string;
  name: string;
  summary: string;
  guidelines: string;
  tilePx: string;
  hud: string;
  juice: string;
}

function emptyDraft(): EditorState {
  return {
    id: "",
    name: "",
    summary: "",
    guidelines: "",
    tilePx: "16",
    hud: "normal",
    juice: "crunchy",
  };
}

function toEditor(style: GameStyle): EditorState {
  return {
    id: style.id,
    name: style.name,
    summary: style.summary,
    guidelines: style.guidelines,
    tilePx: String(style.tilePx),
    hud: style.hud,
    juice: style.juice,
  };
}

export function GameStylesModal() {
  const { state, dispatch } = useStore();
  const [draft, setDraft] = useState<EditorState>(emptyDraft());
  const [origin, setOrigin] = useState<EditorState>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = state.sessions.find((s) => s.id === state.selectedId);
  const defaultId = state.config?.defaultGameStyleId;
  const dirty = JSON.stringify(draft) !== JSON.stringify(origin);
  const saved = state.gameStyles;

  function load(next: EditorState) {
    setDraft(next);
    setOrigin(next);
    setError(null);
  }

  const close = useCallback(() => {
    dispatch({ type: "gameStyles", open: false });
  }, [dispatch]);

  useEffect(() => {
    if (!state.gameStylesOpen) return;
    setError(null);
    const boundId = isGameSession(session ?? {}) ? session?.gameStyleId : undefined;
    const bound = boundId ? state.gameStyles.find((row) => row.id === boundId) : undefined;
    if (bound) {
      load(toEditor(bound));
      return;
    }
    const first = state.gameStyles[0];
    if (first) load(toEditor(first));
    else load(emptyDraft());
  }, [state.gameStylesOpen]);

  async function refresh() {
    const catalog = await api.gameStyles();
    dispatch({ type: "gameStyleList", styles: catalog.styles });
    if (state.config && catalog.defaultId !== state.config.defaultGameStyleId) {
      dispatch({
        type: "config",
        config: { ...state.config, defaultGameStyleId: catalog.defaultId },
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
        tilePx: Number(draft.tilePx),
        hud: draft.hud,
        juice: draft.juice,
      };
      const savedRow = draft.id
        ? await api.patchGameStyle(draft.id, body)
        : await api.createGameStyle(body);
      const catalog = await refresh();
      const next = catalog.styles.find((row) => row.id === savedRow.id) ?? savedRow;
      load(toEditor(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the style");
    } finally {
      setBusy(false);
    }
  }

  async function saveFromGame() {
    if (!session || !isGameSession(session)) return;
    setBusy(true);
    setError(null);
    try {
      const savedRow = await api.saveGameStyleFromSession(session.id, {
        name: draft.name.trim() || undefined,
        summary: draft.summary.trim() || undefined,
        guidelines: draft.guidelines.trim() || undefined,
      });
      const catalog = await refresh();
      const next = catalog.styles.find((row) => row.id === savedRow.id) ?? savedRow;
      load(toEditor(next));
      const updated = await api.session(session.id);
      dispatch({ type: "session", session: updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save from this game");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft.id) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteGameStyle(draft.id);
      const catalog = await refresh();
      const first = catalog.styles[0];
      load(first ? toEditor(first) : emptyDraft());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the style");
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault() {
    if (!draft.id) return;
    setBusy(true);
    setError(null);
    try {
      const catalog = await api.setDefaultGameStyle(draft.id);
      dispatch({ type: "gameStyleList", styles: catalog.styles });
      if (state.config) {
        dispatch({
          type: "config",
          config: { ...state.config, defaultGameStyleId: catalog.defaultId },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the default");
    } finally {
      setBusy(false);
    }
  }

  if (!state.gameStylesOpen) return null;

  return (
    <Modal titleId="game-styles-title" closeGuardMs={250} onClose={close}>
      <div className="modal-head">
        <h2 id="game-styles-title">Game styles</h2>
        <button type="button" className="btn icon ghost" aria-label="Close" onClick={close}>
          <IconClose />
        </button>
      </div>
      <div className="modal-body design-systems-body">
        <aside className="design-systems-list">
          <button type="button" className="btn small ghost" onClick={() => load(emptyDraft())}>
            <IconPlus /> New
          </button>
          {saved.map((row) => (
            <button
              key={row.id}
              type="button"
              className={`btn small ghost${row.id === draft.id ? " on" : ""}`}
              onClick={() => load(toEditor(row))}
            >
              {row.name}
              {row.id === defaultId ? " · default" : ""}
            </button>
          ))}
        </aside>
        <div className="design-systems-editor">
          <label>
            Name
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            Summary
            <input
              value={draft.summary}
              onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
            />
          </label>
          <div className="design-system-picker-row">
            <label>
              Tile
              <Select
                ariaLabel="Tile size"
                value={draft.tilePx}
                options={[
                  { value: "8", label: "8px" },
                  { value: "16", label: "16px" },
                  { value: "32", label: "32px" },
                  { value: "48", label: "48px" },
                ]}
                onChange={(value) => setDraft({ ...draft, tilePx: value })}
              />
            </label>
            <label>
              HUD
              <Select
                ariaLabel="HUD"
                value={draft.hud}
                options={[
                  { value: "normal", label: "Normal" },
                  { value: "minimal", label: "Minimal" },
                  { value: "arcade", label: "Arcade" },
                ]}
                onChange={(value) => setDraft({ ...draft, hud: value })}
              />
            </label>
            <label>
              Juice
              <Select
                ariaLabel="Juice"
                value={draft.juice}
                options={[
                  { value: "floaty", label: "Floaty" },
                  { value: "crunchy", label: "Crunchy" },
                  { value: "heavy", label: "Heavy" },
                ]}
                onChange={(value) => setDraft({ ...draft, juice: value })}
              />
            </label>
          </div>
          <label>
            Guidelines
            <textarea
              rows={6}
              value={draft.guidelines}
              onChange={(event) => setDraft({ ...draft, guidelines: event.target.value })}
            />
          </label>
          {error ? <p className="scrim-note">{error}</p> : null}
        </div>
      </div>
      <div className="modal-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={busy || !draft.id}
          onClick={() => void remove()}
        >
          Delete
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={busy || !draft.id}
          onClick={() => void makeDefault()}
        >
          Default
        </button>
        {session && isGameSession(session) ? (
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => void saveFromGame()}
          >
            Save from this game
          </button>
        ) : null}
        <button
          type="button"
          className="btn primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : draft.id ? "Save" : "Create"}
        </button>
      </div>
    </Modal>
  );
}
