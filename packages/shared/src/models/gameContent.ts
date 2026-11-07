export const GAME_CONTENT_FILES = {
  rooms: "rooms.json",
  waves: "waves.json",
  deck: "deck.json",
} as const;

export type GameContentKind = keyof typeof GAME_CONTENT_FILES;

export type GameRoom = {
  id: string;
  title?: string;
  tiles?: string[][];
  exits?: Partial<Record<"north" | "south" | "east" | "west", string>>;
  spawn?: [number, number];
  items?: string[];
  threat?: string;
};

export type GameWaveEnemy = {
  kind: string;
  count: number;
  hp?: number;
};

export type GameWave = {
  id: string;
  delayMs?: number;
  enemies: GameWaveEnemy[];
};

export type GameCard = {
  id: string;
  title: string;
  cost?: number;
  type?: string;
  text?: string;
};

export type GameRoomsFile = { version: 1; rooms: GameRoom[] };
export type GameWavesFile = { version: 1; waves: GameWave[] };
export type GameDeckFile = { version: 1; cards: GameCard[] };

export const DEFAULT_GAME_ROOMS: GameRoomsFile = {
  version: 1,
  rooms: [
    {
      id: "start",
      title: "Entrance",
      tiles: [
        ["#", "#", "#", "#", "#"],
        ["#", ".", ".", ".", "#"],
        ["#", ".", "@", ".", "#"],
        ["#", ".", ".", ".", "#"],
        ["#", "#", ".", "#", "#"],
      ],
      exits: { south: "hall" },
      spawn: [2, 2],
      items: ["key"],
    },
    {
      id: "hall",
      title: "Hall",
      tiles: [
        ["#", "#", ".", "#", "#"],
        ["#", ".", ".", ".", "#"],
        ["#", ".", "e", ".", "#"],
        ["#", ".", ".", ".", "#"],
        ["#", "#", "#", "#", "#"],
      ],
      exits: { north: "start" },
      spawn: [2, 0],
      threat: "guard",
    },
  ],
};

export const DEFAULT_GAME_WAVES: GameWavesFile = {
  version: 1,
  waves: [
    { id: "w1", delayMs: 0, enemies: [{ kind: "cone", count: 2 }] },
    {
      id: "w2",
      delayMs: 4000,
      enemies: [
        { kind: "cone", count: 3 },
        { kind: "blocker", count: 1 },
      ],
    },
    { id: "w3", delayMs: 8000, enemies: [{ kind: "blocker", count: 2, hp: 2 }] },
  ],
};

export const DEFAULT_GAME_DECK: GameDeckFile = {
  version: 1,
  cards: [
    { id: "strike", title: "Strike", cost: 1, type: "attack", text: "Deal 3." },
    { id: "guard", title: "Guard", cost: 1, type: "skill", text: "Block 4." },
    { id: "draw", title: "Focus", cost: 0, type: "skill", text: "Draw 1." },
  ],
};

export const GAME_CONTENT_DEFAULTS: Record<(typeof GAME_CONTENT_FILES)[GameContentKind], string> = {
  [GAME_CONTENT_FILES.rooms]: `${JSON.stringify(DEFAULT_GAME_ROOMS, null, 2)}\n`,
  [GAME_CONTENT_FILES.waves]: `${JSON.stringify(DEFAULT_GAME_WAVES, null, 2)}\n`,
  [GAME_CONTENT_FILES.deck]: `${JSON.stringify(DEFAULT_GAME_DECK, null, 2)}\n`,
};

function slug(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 48) : "";
}

function positiveInt(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

export function parseGameRoomsFile(raw: unknown): GameRoomsFile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.rooms)) return undefined;
  const rooms = row.rooms
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const room = item as Record<string, unknown>;
      const id = slug(room.id);
      if (!id) return undefined;
      const exits =
        room.exits && typeof room.exits === "object"
          ? Object.fromEntries(
              Object.entries(room.exits as Record<string, unknown>)
                .map(([dir, dest]) => [dir, slug(dest)] as const)
                .filter((entry) => entry[1]),
            )
          : undefined;
      const tiles = Array.isArray(room.tiles)
        ? room.tiles
            .filter((line): line is string[] => Array.isArray(line))
            .map((line) => line.filter((cell): cell is string => typeof cell === "string"))
        : undefined;
      const spawn = Array.isArray(room.spawn)
        ? ([Number(room.spawn[0]), Number(room.spawn[1])] as [number, number])
        : undefined;
      const parsed: GameRoom = { id };
      if (typeof room.title === "string" && room.title.trim()) parsed.title = room.title.trim();
      if (tiles?.length) parsed.tiles = tiles;
      if (exits && Object.keys(exits).length) parsed.exits = exits;
      if (spawn && spawn.every((n) => Number.isFinite(n))) parsed.spawn = spawn;
      if (Array.isArray(room.items)) {
        parsed.items = room.items.filter((item): item is string => typeof item === "string");
      }
      if (typeof room.threat === "string" && room.threat.trim()) parsed.threat = room.threat.trim();
      return parsed;
    })
    .filter((room): room is GameRoom => Boolean(room));
  if (!rooms.length) return undefined;
  return { version: 1, rooms };
}

export function parseGameWavesFile(raw: unknown): GameWavesFile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.waves)) return undefined;
  const waves = row.waves
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const wave = item as Record<string, unknown>;
      const id = slug(wave.id);
      if (!id || !Array.isArray(wave.enemies)) return undefined;
      const enemies = wave.enemies
        .map((entry) => {
          if (!entry || typeof entry !== "object") return undefined;
          const enemy = entry as Record<string, unknown>;
          const kind = slug(enemy.kind);
          const count = positiveInt(enemy.count);
          if (!kind || !count) return undefined;
          const parsed: GameWaveEnemy = { kind, count };
          const hp = positiveInt(enemy.hp);
          if (hp) parsed.hp = hp;
          return parsed;
        })
        .filter((enemy): enemy is GameWaveEnemy => Boolean(enemy));
      if (!enemies.length) return undefined;
      const parsed: GameWave = { id, enemies };
      const delayMs = positiveInt(wave.delayMs);
      if (delayMs) parsed.delayMs = delayMs;
      return parsed;
    })
    .filter((wave): wave is GameWave => Boolean(wave));
  if (!waves.length) return undefined;
  return { version: 1, waves };
}

export function parseGameDeckFile(raw: unknown): GameDeckFile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.cards)) return undefined;
  const cards = row.cards
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const card = item as Record<string, unknown>;
      const id = slug(card.id);
      const title = typeof card.title === "string" ? card.title.trim() : "";
      if (!id || !title) return undefined;
      const parsed: GameCard = { id, title: title.slice(0, 48) };
      const cost = positiveInt(card.cost);
      if (cost) parsed.cost = cost;
      if (typeof card.type === "string" && card.type.trim()) parsed.type = card.type.trim();
      if (typeof card.text === "string" && card.text.trim()) parsed.text = card.text.trim();
      return parsed;
    })
    .filter((card): card is GameCard => Boolean(card));
  if (!cards.length) return undefined;
  return { version: 1, cards };
}

export function formatGameContentPrompt(): string {
  return [
    "Level, wave, and deck data live in workspace JSON — not hardcoded tables in index.html.",
    `- Rooms / floors: /workspace/${GAME_CONTENT_FILES.rooms} ({ version: 1, rooms: [{ id, title, tiles, exits, spawn, items, threat }] }).`,
    `- Waves / endless spawn: /workspace/${GAME_CONTENT_FILES.waves} ({ version: 1, waves: [{ id, delayMs, enemies: [{ kind, count, hp }] }] }).`,
    `- Cards / deck: /workspace/${GAME_CONTENT_FILES.deck} ({ version: 1, cards: [{ id, title, cost, type, text }] }).`,
    "Read those files at boot (fetch relative or inline). Adding a room, wave, or card is a JSON edit plus a small loop patch — never a whole-page rewrite.",
  ].join("\n");
}

export function upsertGameContentSection(brief: string): string {
  const block = ["## Content", "", formatGameContentPrompt(), ""].join("\n");
  const source = brief.replace(/^\uFEFF/, "");
  const match = source.match(/^## Content\s*$/m);
  if (match && match.index != null) {
    const start = match.index;
    const bodyStart = start + match[0].length;
    const next = source.slice(bodyStart).search(/^## /m);
    const end = next >= 0 ? bodyStart + next : source.length;
    const suffix = source.slice(end);
    return `${source.slice(0, start)}${block}${suffix && !suffix.startsWith("\n") ? "\n" : ""}${suffix}`;
  }
  if (/^## Persistence\s*$/m.test(source)) {
    return source.replace(/^## Persistence\s*$/m, `${block}\n## Persistence`);
  }
  const trimmed = source.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}` : block;
}
