import {
  DEFAULT_GAME_DECK,
  DEFAULT_GAME_ROOMS,
  DEFAULT_GAME_WAVES,
  GAME_CONTENT_FILES,
  GAME_CURVE_SEEDS,
  GAME_EXTRA_FEEL_DEFAULTS,
  GAME_GDD_PATH,
  GAME_INPUT_CODES,
  GAME_RECIPES,
  createMomentPin,
  createSeedSample,
  extraFeelKeysForRecipe,
  gameReleaseChecklist,
  parseGameDeckFile,
  parseGameRoomsFile,
  parseGameWavesFile,
  withMoment,
  type GameDeckFile,
  type GameRoomsFile,
  type GameSeedSample,
  type AgentSession,
  type GameStudioState,
  type GameWavesFile,
} from "@locus/shared";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function GameStudioPanel(props: {
  session: AgentSession;
  html?: string | null;
  seed: number;
  tape: string[];
  stats?: { score?: number; deaths?: number; time?: number };
  studio: GameStudioState;
  onStudio: (next: GameStudioState) => void;
  postGame: (data: Record<string, unknown>) => void;
  onPinBuild: (name: string) => Promise<string | undefined>;
  onPlayBuild: (id: string) => Promise<void>;
  onPlaySeed: (seed: number) => void;
  onSplit: () => Promise<void>;
}) {
  const [buildName, setBuildName] = useState("Cruise");
  const [momentNote, setMomentNote] = useState("");
  const [sampling, setSampling] = useState(false);
  const [rooms, setRooms] = useState<GameRoomsFile>(DEFAULT_GAME_ROOMS);
  const [waves, setWaves] = useState<GameWavesFile>(DEFAULT_GAME_WAVES);
  const [deck, setDeck] = useState<GameDeckFile>(DEFAULT_GAME_DECK);
  const [gdd, setGdd] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const id = props.session.id;
    let cancelled = false;
    void Promise.all([
      api.workspaceFile(id, GAME_CONTENT_FILES.rooms).catch(() => undefined),
      api.workspaceFile(id, GAME_CONTENT_FILES.waves).catch(() => undefined),
      api.workspaceFile(id, GAME_CONTENT_FILES.deck).catch(() => undefined),
      api.workspaceFile(id, GAME_GDD_PATH).catch(() => undefined),
    ]).then(([roomsFile, wavesFile, deckFile, gddFile]) => {
      if (cancelled) return;
      try {
        const parsedRooms = roomsFile?.content
          ? parseGameRoomsFile(JSON.parse(roomsFile.content))
          : undefined;
        if (parsedRooms) setRooms(parsedRooms);
      } catch {
        /* keep the starter rooms */
      }
      try {
        const parsedWaves = wavesFile?.content
          ? parseGameWavesFile(JSON.parse(wavesFile.content))
          : undefined;
        if (parsedWaves) setWaves(parsedWaves);
      } catch {
        /* keep the starter waves */
      }
      try {
        const parsedDeck = deckFile?.content
          ? parseGameDeckFile(JSON.parse(deckFile.content))
          : undefined;
        if (parsedDeck) setDeck(parsedDeck);
      } catch {
        /* keep the starter deck */
      }
      setGdd(gddFile?.content ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [props.session.id]);

  function save(next: GameStudioState) {
    props.onStudio(next);
  }

  function pinMoment() {
    const pin = createMomentPin({
      seed: props.seed,
      time: props.stats?.time,
      score: props.stats?.score,
      deaths: props.stats?.deaths,
      tape: props.tape.slice(-32),
      note: momentNote,
    });
    save(withMoment(props.studio, pin));
    setMomentNote("");
  }

  function saveGhost() {
    if (!props.tape.length) return;
    save({
      ...props.studio,
      ghost: { seed: props.seed, tape: props.tape.slice(-32), savedAt: new Date().toISOString() },
    });
  }

  async function sampleCurve() {
    if (sampling) return;
    setSampling(true);
    const curve: GameSeedSample[] = [];
    try {
      for (const seed of GAME_CURVE_SEEDS) {
        props.postGame({ type: "locus-game-seed", seed });
        props.postGame({ type: "locus-game-reset" });
        for (const code of ["ArrowRight", "Space"]) {
          props.postGame({ type: "locus-game-input", code, down: true });
          props.postGame({ type: "locus-game-input", code, down: false });
        }
        props.postGame({ type: "locus-game-stats-request" });
        const stats = await waitForStats();
        const sample = createSeedSample({ seed, ...stats });
        curve.push(sample);
      }
      save({ ...props.studio, curve });
    } finally {
      setSampling(false);
    }
  }

  async function saveContent() {
    setBusy("content");
    try {
      await api.saveWorkspaceFile(
        props.session.id,
        GAME_CONTENT_FILES.rooms,
        `${JSON.stringify(rooms, null, 2)}\n`,
      );
      await api.saveWorkspaceFile(
        props.session.id,
        GAME_CONTENT_FILES.waves,
        `${JSON.stringify(waves, null, 2)}\n`,
      );
      await api.saveWorkspaceFile(
        props.session.id,
        GAME_CONTENT_FILES.deck,
        `${JSON.stringify(deck, null, 2)}\n`,
      );
    } finally {
      setBusy("");
    }
  }

  const checks = gameReleaseChecklist({ html: props.html, gdd });
  const extras = extraFeelKeysForRecipe(props.studio.recipeId);
  const builds = props.session.designVariants ?? [];

  return (
    <div className="game-studio" role="region" aria-label="Game studio">
      <div className="control-cluster" role="group" aria-label="Moment">
        <input
          aria-label="Moment note"
          value={momentNote}
          placeholder="What happened"
          onChange={(event) => setMomentNote(event.target.value)}
        />
        <button type="button" className="btn small" onClick={pinMoment}>
          Pin moment
        </button>
        <button
          type="button"
          className="btn small ghost"
          disabled={!props.tape.length}
          onClick={saveGhost}
        >
          Save ghost
        </button>
        <button
          type="button"
          className="btn small ghost"
          disabled={!props.studio.ghost?.tape.length}
          onClick={() =>
            props.postGame({ type: "locus-game-ghost", tape: props.studio.ghost?.tape ?? [] })
          }
        >
          Play ghost
        </button>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => props.postGame({ type: "locus-game-step", dir: -1 })}
        >
          Step back
        </button>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => props.postGame({ type: "locus-game-step", dir: 1 })}
        >
          Step
        </button>
      </div>
      {props.studio.moments.length ? (
        <p className="game-controls">
          Latest pin {props.studio.moments[props.studio.moments.length - 1]?.id} seed{" "}
          {props.studio.moments[props.studio.moments.length - 1]?.seed}
        </p>
      ) : null}

      <div className="control-cluster" role="group" aria-label="Playable builds">
        <input
          aria-label="Build name"
          value={buildName}
          onChange={(event) => setBuildName(event.target.value)}
        />
        <button
          type="button"
          className="btn small"
          disabled={!props.html?.trim()}
          onClick={() => {
            const name = buildName.trim() || "Build";
            void props.onPinBuild(name).then((id) => {
              if (!id) return;
              save({ ...props.studio, activeBuildId: id });
            });
          }}
        >
          Pin build
        </button>
        {builds.map((row) => (
          <button
            key={row.id}
            type="button"
            className={`btn small ghost ${props.studio.activeBuildId === row.id ? "on" : ""}`}
            onClick={() => {
              void props.onPlayBuild(row.id).then(() => {
                save({ ...props.studio, activeBuildId: row.id });
              });
            }}
          >
            Play {row.name}
          </button>
        ))}
      </div>

      <div className="control-cluster" role="group" aria-label="Seed curve">
        <button
          type="button"
          className="btn small"
          disabled={sampling}
          onClick={() => void sampleCurve()}
        >
          {sampling ? "Sampling…" : "Sample seeds"}
        </button>
        {props.studio.curve.map((row) => (
          <button
            key={row.seed}
            type="button"
            className="btn small ghost"
            onClick={() => props.onPlaySeed(row.seed)}
          >
            {row.seed} {row.verdict}
          </button>
        ))}
      </div>

      <div className="control-cluster" role="group" aria-label="Recipe feel">
        <label>
          Feel set
          <select
            aria-label="Feel set"
            value={props.studio.recipeId ?? ""}
            onChange={(event) =>
              save({ ...props.studio, recipeId: event.target.value || undefined })
            }
          >
            <option value="">All knobs</option>
            {GAME_RECIPES.map((recipe) => (
              <option key={recipe.id} value={recipe.id}>
                {recipe.title}
              </option>
            ))}
          </select>
        </label>
        {extras.map((key) => {
          const bounds = GAME_EXTRA_FEEL_DEFAULTS[key];
          const value = props.studio.extraFeel[key] ?? bounds.value;
          return (
            <label key={key}>
              {key} {value}
              <input
                type="range"
                min={bounds.min}
                max={bounds.max}
                value={value}
                aria-label={key}
                onChange={(event) => {
                  const n = Number(event.target.value);
                  const extraFeel = { ...props.studio.extraFeel, [key]: n };
                  save({ ...props.studio, extraFeel });
                  props.postGame({ type: "locus-game-recipe-feel", feel: { [key]: n } });
                }}
              />
            </label>
          );
        })}
      </div>

      <ContentDesk
        rooms={rooms}
        waves={waves}
        deck={deck}
        busy={busy === "content"}
        onRooms={setRooms}
        onWaves={setWaves}
        onDeck={setDeck}
        onSave={() => void saveContent()}
        onPlay={(kind, id) =>
          props.postGame({ type: "locus-game-start", kind, id, seed: props.seed })
        }
      />

      <div className="control-cluster" role="group" aria-label="Remap">
        {GAME_INPUT_CODES.map((code) => (
          <label key={code}>
            {code}
            <select
              aria-label={`Remap ${code}`}
              value={props.studio.inputMap[code] ?? code}
              onChange={(event) => {
                const inputMap = { ...props.studio.inputMap };
                if (event.target.value === code) delete inputMap[code];
                else inputMap[code] = event.target.value;
                save({ ...props.studio, inputMap });
                props.postGame({ type: "locus-game-remap", map: inputMap });
              }}
            >
              {GAME_INPUT_CODES.map((target) => (
                <option key={target} value={target}>
                  {target}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button
          type="button"
          className={`btn small ghost ${props.studio.hudLarge ? "on" : ""}`}
          aria-pressed={props.studio.hudLarge}
          onClick={() => {
            const hudLarge = !props.studio.hudLarge;
            save({ ...props.studio, hudLarge });
            props.postGame({ type: "locus-game-hud", large: hudLarge });
          }}
        >
          Large HUD
        </button>
        <button
          type="button"
          className="btn small ghost"
          disabled={!props.html?.trim() || busy === "split"}
          onClick={() => {
            setBusy("split");
            void props.onSplit().finally(() => setBusy(""));
          }}
        >
          {busy === "split" ? "Splitting…" : "Split live game"}
        </button>
      </div>

      <ul className="game-release" aria-label="Release check">
        {checks.map((row) => (
          <li key={row.id}>
            {row.ok ? "ok" : "miss"} {row.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContentDesk(props: {
  rooms: GameRoomsFile;
  waves: GameWavesFile;
  deck: GameDeckFile;
  busy: boolean;
  onRooms: (next: GameRoomsFile) => void;
  onWaves: (next: GameWavesFile) => void;
  onDeck: (next: GameDeckFile) => void;
  onSave: () => void;
  onPlay: (kind: "room" | "wave" | "card", id: string) => void;
}) {
  return (
    <div className="game-desk" role="group" aria-label="Content desk">
      {props.rooms.rooms.map((room, index) => (
        <div key={room.id} className="control-cluster">
          <span>{room.id}</span>
          <input
            aria-label={`Room ${room.id} title`}
            value={room.title ?? ""}
            onChange={(event) => {
              const rooms = props.rooms.rooms.map((row, i) =>
                i === index ? { ...row, title: event.target.value } : row,
              );
              props.onRooms({ ...props.rooms, rooms });
            }}
          />
          <input
            aria-label={`Room ${room.id} threat`}
            value={room.threat ?? ""}
            placeholder="threat"
            onChange={(event) => {
              const rooms = props.rooms.rooms.map((row, i) =>
                i === index ? { ...row, threat: event.target.value || undefined } : row,
              );
              props.onRooms({ ...props.rooms, rooms });
            }}
          />
          <button
            type="button"
            className="btn small ghost"
            onClick={() => props.onPlay("room", room.id)}
          >
            Play room
          </button>
        </div>
      ))}
      {props.waves.waves.map((wave, index) => (
        <div key={wave.id} className="control-cluster">
          <span>{wave.id}</span>
          <input
            aria-label={`Wave ${wave.id} count`}
            type="number"
            min={1}
            value={wave.enemies[0]?.count ?? 1}
            onChange={(event) => {
              const count = Math.max(1, Number(event.target.value) || 1);
              const waves = props.waves.waves.map((row, i) => {
                if (i !== index) return row;
                const enemies = row.enemies.map((enemy, enemyIndex) =>
                  enemyIndex === 0 ? { ...enemy, count } : enemy,
                );
                return { ...row, enemies };
              });
              props.onWaves({ ...props.waves, waves });
            }}
          />
          <button
            type="button"
            className="btn small ghost"
            onClick={() => props.onPlay("wave", wave.id)}
          >
            Play wave
          </button>
        </div>
      ))}
      {props.deck.cards.map((card, index) => (
        <div key={card.id} className="control-cluster">
          <input
            aria-label={`Card ${card.id} title`}
            value={card.title}
            onChange={(event) => {
              const cards = props.deck.cards.map((row, i) =>
                i === index ? { ...row, title: event.target.value } : row,
              );
              props.onDeck({ ...props.deck, cards });
            }}
          />
          <button
            type="button"
            className="btn small ghost"
            onClick={() => props.onPlay("card", card.id)}
          >
            Play card
          </button>
        </div>
      ))}
      <button type="button" className="btn small" disabled={props.busy} onClick={props.onSave}>
        {props.busy ? "Saving…" : "Save content"}
      </button>
    </div>
  );
}

function waitForStats(): Promise<{ score?: number; deaths?: number; time?: number }> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({});
    }, 450);
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; stats?: Record<string, unknown> } | null;
      if (!data || data.type !== "locus-game-stats" || !data.stats) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      const num = (value: unknown) =>
        value == null || value === "" || !Number.isFinite(Number(value))
          ? undefined
          : Number(value);
      resolve({
        score: num(data.stats.score),
        deaths: num(data.stats.deaths),
        time: num(data.stats.time),
      });
    }
    window.addEventListener("message", onMessage);
  });
}
