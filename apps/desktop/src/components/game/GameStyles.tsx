import { isGameSession, type GameStyle } from "@locus/shared";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { IconClose, IconPlus } from "@/components/layout/Icons";

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
  const openedAt = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
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

  useDialogFocus(state.gameStylesOpen, close, dialogRef);

  useEffect(() => {
    if (!state.gameStylesOpen) return;
    openedAt.current = Date.now();
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

  function onBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (Date.now() - openedAt.current < 250) return;
    close();
  }

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
    <div className="modal-backdrop" onClick={onBackdrop}>
      <div className="modal" role="dialog" aria-labelledby="game-styles-title" ref={dialogRef}>
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
                <select
                  aria-label="Tile size"
                  value={draft.tilePx}
                  onChange={(event) => setDraft({ ...draft, tilePx: event.target.value })}
                >
                  <option value="8">8px</option>
                  <option value="16">16px</option>
                  <option value="32">32px</option>
                  <option value="48">48px</option>
                </select>
              </label>
              <label>
                HUD
                <select
                  aria-label="HUD"
                  value={draft.hud}
                  onChange={(event) => setDraft({ ...draft, hud: event.target.value })}
                >
                  <option value="normal">Normal</option>
                  <option value="minimal">Minimal</option>
                  <option value="arcade">Arcade</option>
                </select>
              </label>
              <label>
                Juice
                <select
                  aria-label="Juice"
                  value={draft.juice}
                  onChange={(event) => setDraft({ ...draft, juice: event.target.value })}
                >
                  <option value="floaty">Floaty</option>
                  <option value="crunchy">Crunchy</option>
                  <option value="heavy">Heavy</option>
                </select>
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
      </div>
    </div>
  );
}
