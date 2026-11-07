import { describe, expect, it } from "vitest";
import {
  defaultHostSessionCopyDest,
  filterHostSessionMentions,
  formatHostSessionList,
  formatHostSessionMentionsNote,
  hostSessionMentionItems,
  hostSessionMentionToken,
  insertHostSessionMention,
  isHostSessionPeerKind,
  isHostSessionsToolName,
  parseHostSessionKindToken,
  parseHostSessionMentions,
  resolveHostSessionMention,
  sessionOffersHostSessions,
  HOST_SESSIONS_TOOL,
} from "./hostSessions.js";

describe("host_sessions", () => {
  it("is a host-only extra tool", () => {
    expect(isHostSessionsToolName("host_sessions")).toBe(true);
    expect(isHostSessionsToolName("repo_map")).toBe(false);
    expect(HOST_SESSIONS_TOOL.name).toBe("host_sessions");
    expect(sessionOffersHostSessions({ runtime: "host", kind: "agent" })).toBe(true);
    expect(sessionOffersHostSessions({ runtime: "host", kind: "game" })).toBe(true);
    expect(sessionOffersHostSessions({ runtime: "docker", kind: "agent" })).toBe(false);
    expect(sessionOffersHostSessions({ runtime: "host", kind: "board" })).toBe(false);
    expect(sessionOffersHostSessions({ runtime: "host", kind: "project" })).toBe(false);
    expect(isHostSessionPeerKind("game")).toBe(true);
    expect(isHostSessionPeerKind("board")).toBe(false);
    expect(parseHostSessionKindToken("assets")).toBe("assets");
    expect(parseHostSessionKindToken("asset")).toBe("assets");
    expect(parseHostSessionKindToken("games")).toBe("game");
  });

  it("parses @game/@asset/@agent mentions", () => {
    expect(parseHostSessionMentions("Use @game:arcade and @asset:knight plus @agent:hub")).toEqual([
      { kind: "game", slug: "arcade" },
      { kind: "assets", slug: "knight" },
      { kind: "agent", slug: "hub" },
    ]);
    expect(parseHostSessionMentions("ping a@b.com then @src/app.ts")).toEqual([]);
    expect(hostSessionMentionToken("assets", "knight")).toBe("asset:knight");
    expect(hostSessionMentionToken("game", "arcade")).toBe("game:arcade");
    expect(
      insertHostSessionMention("see @ga", 6, "game:arcade", { start: 4, query: "ga" }),
    ).toEqual({
      text: "see @game:arcade ",
      cursor: 17,
    });
  });

  it("lists other host peers for @ mentions and resolves them", () => {
    const items = hostSessionMentionItems({
      session: { id: "me", runtime: "host", kind: "agent" },
      sessions: [
        { id: "me", kind: "agent", title: "Hub", runtime: "host" },
        {
          id: "g1",
          kind: "game",
          title: "Arcade",
          runtime: "host",
        },
        {
          id: "a1",
          kind: "assets",
          title: "Knight",
          runtime: "docker",
          assetPack: { slug: "knight", kind: "sprite", files: ["source.png"] },
        },
        { id: "old", kind: "game", title: "Old", archived: true },
        { id: "b1", kind: "board", title: "Board" },
      ],
    });
    expect(items.map((row) => row.label)).toEqual(["@game:arcade", "@asset:knight"]);
    expect(filterHostSessionMentions(items, "game").map((row) => row.token)).toEqual([
      "game:arcade",
    ]);
    expect(filterHostSessionMentions(items, "knight")[0]?.id).toBe("a1");
    expect(
      resolveHostSessionMention({ kind: "game", slug: "arcade" }, [
        { id: "g1", kind: "game", title: "Arcade" },
      ]),
    ).toEqual({ id: "g1", slug: "arcade", kind: "game" });
    expect(
      hostSessionMentionItems({
        session: { id: "me", runtime: "docker", kind: "agent" },
        sessions: [{ id: "g1", kind: "game", title: "Arcade" }],
      }),
    ).toEqual([]);
  });

  it("formats list and mention notes and default copy dest", () => {
    const peers = [
      {
        id: "g1",
        kind: "game" as const,
        title: "Arcade",
        slug: "arcade",
        token: "game:arcade",
        runtime: "host",
        files: ["GAME.md", "index.html"],
        brief: "Dodge the rocks.",
      },
    ];
    expect(formatHostSessionList(peers)).toMatch(/@game:arcade/);
    expect(formatHostSessionList(peers)).toMatch(/GAME.md/);
    expect(formatHostSessionList([])).toMatch(/No other Locus chats/);
    expect(formatHostSessionMentionsNote(peers)).toMatch(/host_sessions/);
    expect(defaultHostSessionCopyDest("arcade", "index.html")).toBe("peers/arcade/index.html");
    expect(defaultHostSessionCopyDest("arcade", "")).toBe("peers/arcade");
  });
});
