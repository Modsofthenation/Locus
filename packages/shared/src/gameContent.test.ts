import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_DECK,
  DEFAULT_GAME_ROOMS,
  DEFAULT_GAME_WAVES,
  GAME_CONTENT_DEFAULTS,
  GAME_CONTENT_FILES,
  formatGameContentPrompt,
  parseGameDeckFile,
  parseGameRoomsFile,
  parseGameWavesFile,
  upsertGameContentSection,
} from "./models/gameContent.js";

describe("game content files", () => {
  it("parses the default rooms, waves, and deck", () => {
    expect(parseGameRoomsFile(DEFAULT_GAME_ROOMS)?.rooms.map((row) => row.id)).toEqual([
      "start",
      "hall",
    ]);
    expect(parseGameWavesFile(DEFAULT_GAME_WAVES)?.waves).toHaveLength(3);
    expect(parseGameDeckFile(DEFAULT_GAME_DECK)?.cards[0]?.id).toBe("strike");
    expect(GAME_CONTENT_DEFAULTS[GAME_CONTENT_FILES.rooms]).toContain('"start"');
  });

  it("rejects empty or junk payloads", () => {
    expect(parseGameRoomsFile({ rooms: [] })).toBeUndefined();
    expect(parseGameWavesFile({ waves: [{ id: "w1" }] })).toBeUndefined();
    expect(parseGameDeckFile({ cards: [{ id: "x" }] })).toBeUndefined();
  });

  it("upserts a Content section before Persistence", () => {
    const next = upsertGameContentSection("# Game\n\n## Persistence\n\nlocalStorage.\n");
    expect(next).toContain("## Content");
    expect(next).toContain(GAME_CONTENT_FILES.rooms);
    expect(formatGameContentPrompt()).toContain(GAME_CONTENT_FILES.waves);
    expect(next.indexOf("## Content")).toBeLessThan(next.indexOf("## Persistence"));
  });
});
