import { BOARD_STARTER_META, type BoardStarter } from "@locus/shared";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { resolveAgentDefaults } from "@/lib/lastAgent";
import { useStore } from "@/state/store";
import { EmptyHero } from "@/components/layout/EmptyHero";
import { IconPlus } from "@/components/layout/Icons";

export function BoardEmpty() {
  const { state, dispatch } = useStore();
  const [prompt, setPrompt] = useState("");
  const [starter, setStarter] = useState<BoardStarter | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    resolveAgentDefaults(state.config, "ubuntu");
  }, [state.config]);

  async function create(nextStarter: BoardStarter, nextPrompt?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const board = await api.createBoard({
        starter: nextStarter,
        prompt: nextPrompt?.trim() || undefined,
      });
      dispatch({ type: "board", board });
      dispatch({ type: "selectBoard", id: board.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create board");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="empty design-start board-start">
      <div className="empty-card">
        <EmptyHero
          title="Board"
          lead="A local planning canvas. Stickies, frames, diagrams, live cards, and Locus on the canvas — no guest."
        />
        <div className="design-start-layout">
          <form
            className="design-start-prompt"
            onSubmit={(event) => {
              event.preventDefault();
              void create(starter ?? "blank", prompt);
            }}
          >
            <div className="empty-composer">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask Locus to map it, or start from a pill"
                rows={3}
              />
              <div className="empty-composer-bar">
                <button
                  className="btn primary small composer-send"
                  type="submit"
                  disabled={busy}
                  title="New board"
                  aria-label={busy ? "Creating…" : "New board"}
                >
                  <IconPlus />
                  <span>{busy ? "Creating…" : "New board"}</span>
                </button>
              </div>
            </div>
            {error ? <p className="error-text">{error}</p> : null}
          </form>
          <div className="design-start-from">
            <p className="design-start-from-label">Or start from</p>
            <div className="recipe-grid pills" role="group" aria-label="Board starters">
              {BOARD_STARTER_META.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`os-card ${starter === row.id ? "active" : ""}`}
                  title={row.blurb}
                  onClick={() => {
                    setStarter(row.id);
                    void create(row.id, prompt);
                  }}
                >
                  <h3>{row.title}</h3>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
