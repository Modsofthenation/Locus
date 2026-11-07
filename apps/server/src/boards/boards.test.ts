import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { BoardService } from "./boards.js";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "../session/sessions.js";

const dirs: string[] = [];

afterEach(async () => {
  dirs.length = 0;
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "locus-boards-"));
  dirs.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const hub = new Hub();
  const sessions = new SessionService(store, new MockHypervisor(dir), hub);
  const boards = new BoardService(store, hub, sessions);
  sessions.plane.boards = boards;
  return { dir, store, hub, sessions, boards };
}

describe("BoardService", () => {
  it("creates, lists, patches, and deletes a board under the data dir", async () => {
    const { boards, dir } = await setup();
    const created = await boards.create({ starter: "sprint", title: "Week 12" });
    expect(created.title).toBe("Week 12");
    expect(created.objects.some((row) => row.type === "frame" && row.text === "Now")).toBe(true);
    const listed = await boards.list();
    expect(listed.map((row) => row.id)).toEqual([created.id]);
    const raw = await readFile(join(dir, "boards", created.id, "board.json"), "utf8");
    expect(raw).toContain("Week 12");
    const renamed = await boards.patch(created.id, { title: "Week 12 retro" });
    expect(renamed.title).toBe("Week 12 retro");
    await boards.remove(created.id);
    expect(await boards.list()).toEqual([]);
  });

  it("refuses path traversal ids", async () => {
    const { boards } = await setup();
    expect(await boards.get("../secrets")).toBeUndefined();
    expect(await boards.get("a/b")).toBeUndefined();
  });

  it("round-trips stickies and comments via board tools", async () => {
    const { boards } = await setup();
    const board = await boards.create({ starter: "blank" });
    const frame = board.objects.find((row) => row.type === "frame")!;
    const upsert = await boards.executeTool(board.id, "board_upsert", {
      objects: [
        {
          id: "sticky-1",
          type: "sticky",
          x: 40,
          y: 80,
          w: 160,
          h: 140,
          text: "Cluster me",
          color: "amber",
          frameId: frame.id,
        },
      ],
    });
    expect(upsert.ok).toBe(true);
    const got = await boards.executeTool(board.id, "board_get", { frame_id: frame.id });
    expect(got.output).toMatch(/Cluster me/);
    const commented = await boards.executeTool(board.id, "board_comment", {
      object_id: "sticky-1",
      body: "Need a second note",
    });
    expect(commented.ok).toBe(true);
    const listed = await boards.executeTool(undefined, "board_list", {});
    expect(listed.output).toMatch(board.id);
    const alone = await boards.executeTool(board.id, "board_cluster", { ids: ["sticky-1"] });
    expect(alone.ok).toBe(false);
    const second = await boards.executeTool(board.id, "board_upsert", {
      objects: [
        {
          id: "sticky-2",
          type: "sticky",
          x: 240,
          y: 80,
          w: 160,
          h: 140,
          text: "Cluster me later",
          color: "amber",
        },
      ],
    });
    expect(second.ok).toBe(true);
    const clustered = await boards.executeTool(board.id, "board_cluster", {
      ids: ["sticky-1", "sticky-2"],
    });
    expect(clustered.ok).toBe(true);
    expect(clustered.output).toMatch(/frame/);
    const after = await boards.get(board.id);
    expect(after?.objects.some((row) => row.type === "frame" && row.text)).toBe(true);
    expect(after?.objects.find((row) => row.id === "sticky-1")?.frameId).toBeTruthy();
  });

  it("formats a frame brief for Run this frame", async () => {
    const { boards } = await setup();
    const board = await boards.create({ starter: "architecture" });
    const questions = board.objects.find((row) => row.text === "Open questions")!;
    const brief = (await import("@locus/shared")).formatFrameBrief(board, questions.id);
    expect(brief).toMatch(/Open questions/);
    expect(brief).toMatch(/Sticky:/);
  });

  it("opens board chat on the host without a guest", async () => {
    const { boards, sessions } = await setup();
    const board = await boards.create({ starter: "blank" });
    const { sessionId, board: next } = await boards.ensureChat(board.id);
    expect(next.chatSessionId).toBe(sessionId);
    const session = await sessions.get(sessionId);
    expect(session?.kind).toBe("board");
    expect(session?.runtime).toBe("host");
    expect(session?.boardId).toBe(board.id);
    expect(session?.vmId).toBeUndefined();
  });

  it("deletes dangling connectors with an object", async () => {
    const { boards } = await setup();
    const board = await boards.create({ starter: "blank" });
    const a = { id: "shape-a", type: "shape", x: 40, y: 80, w: 80, h: 40, text: "A" };
    const b = { id: "shape-b", type: "shape", x: 200, y: 80, w: 80, h: 40, text: "B" };
    const line = {
      id: "wire-1",
      type: "connector",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      fromId: "shape-a",
      toId: "shape-b",
    };
    await boards.upsertObjects(board.id, [a, b, line]);
    const next = await boards.deleteObjects(board.id, ["shape-a"]);
    expect(next.objects.some((row) => row.id === "wire-1")).toBe(false);
    expect(next.objects.some((row) => row.id === "shape-b")).toBe(true);
  });

  it("upserts tables and repairs mojibake on stickies", async () => {
    const { boards } = await setup();
    const board = await boards.create({ starter: "blank" });
    const bytes = new TextEncoder().encode("Agents — own the guest");
    const garbled = [...bytes]
      .map((b) => (b === 0x80 ? "\u20ac" : b === 0x94 ? "\u201d" : String.fromCharCode(b)))
      .join("");
    const result = await boards.executeTool(board.id, "board_upsert", {
      objects: [
        {
          id: "sticky-moj",
          type: "sticky",
          x: 40,
          y: 80,
          w: 160,
          h: 140,
          text: garbled,
        },
        {
          id: "tbl-1",
          type: "table",
          x: 40,
          y: 240,
          w: 480,
          h: 200,
          text: "Backlog",
          table: {
            columns: [{ id: "title", name: "Title", kind: "text" }],
            rows: [{ id: "r1", cells: { title: "Write the RFC" } }],
          },
        },
        {
          id: "tl-1",
          type: "timeline",
          x: 40,
          y: 480,
          w: 480,
          h: 200,
          text: "Ship",
          timeline: {
            scale: "weeks",
            items: [{ id: "i1", title: "RFC", start: "2026-09-07", end: "2026-09-21" }],
          },
        },
        {
          id: "ink-1",
          type: "ink",
          x: 40,
          y: 700,
          w: 80,
          h: 40,
          ink: {
            points: [
              { x: 0, y: 0 },
              { x: 40, y: 20 },
            ],
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
    const next = await boards.require(board.id);
    expect(next.objects.find((row) => row.id === "sticky-moj")?.text).toBe(
      "Agents — own the guest",
    );
    expect(next.objects.find((row) => row.id === "tbl-1")?.table?.rows[0]?.cells.title).toBe(
      "Write the RFC",
    );
    expect(next.objects.find((row) => row.id === "ink-1")?.ink?.points).toHaveLength(2);
    const got = await boards.executeTool(board.id, "board_get", {});
    expect(got.output).toMatch(/Write the RFC/);
    expect(got.output).toMatch(/RFC/);
  });

  it("pins a session plan onto a frame as stickies", async () => {
    const { boards, sessions, store } = await setup();
    const board = await boards.create({ starter: "kanban", title: "Board" });
    const frame = board.objects.find((row) => row.type === "frame" && row.text === "To do");
    expect(frame).toBeTruthy();
    const config = await store.loadConfig();
    const session = await sessions.create({
      title: "Plan agent",
      kind: "agent",
      runtime: "host",
      startVm: false,
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
    });
    await sessions.patchMeta(session.id, {
      plan: {
        phase: "accepted",
        items: [
          { id: "p1", text: "Write tests", status: "pending" },
          { id: "p2", text: "Ship it", status: "pending" },
        ],
      },
    });
    const next = await boards.pinPlan(board.id, {
      frameId: frame!.id,
      sessionId: session.id,
    });
    expect(
      next.objects.some((row) => row.text === "1. Write tests" && row.frameId === frame!.id),
    ).toBe(true);
    expect(next.objects.some((row) => row.text === "2. Ship it")).toBe(true);
  });
});

describe("Retro board template", () => {
  it("creates a board with Retro template including 4 frames", async () => {
    const { boards } = await setup();
    const created = await boards.create({ starter: "retro", title: "Team Retro" });
    expect(created.title).toBe("Team Retro");
    expect(created.starter).toBe("retro");
    expect(created.objects.length).toBeGreaterThan(4);
    expect(created.objects.some((row) => row.type === "frame" && row.text === "Went well")).toBe(
      true,
    );
    expect(created.objects.some((row) => row.type === "frame" && row.text === "To improve")).toBe(
      true,
    );
    expect(created.objects.some((row) => row.type === "frame" && row.text === "Ideas")).toBe(true);
    expect(created.objects.some((row) => row.type === "frame" && row.text === "Actions")).toBe(
      true,
    );
  });
});

describe("Board assets and inbox", () => {
  it("stores an image under the board assets dir and lists pending comments", async () => {
    const { boards, dir } = await setup();
    const created = await boards.create({ starter: "blank" });
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const asset = await boards.putAsset(created.id, {
      bytes: png,
      mime: "image/png",
      name: "dot.png",
    });
    expect(asset.assetId).toMatch(/\.png$/);
    const got = await boards.getAsset(created.id, asset.assetId);
    expect(got.mime).toBe("image/png");
    expect(got.bytes.byteLength).toBe(png.byteLength);
    expect(
      await boards.getAsset(created.id, "../secret.png").catch((err: Error) => err.message),
    ).toBe("Not found");
    await boards.addComment(created.id, {
      objectId: created.objects[0]!.id,
      body: "Need a second note",
      author: "agent",
    });
    const listed = await boards.list();
    expect(listed[0]?.pendingComments?.[0]?.body).toBe("Need a second note");
    const copy = await boards.duplicate(created.id);
    const copied = await readFile(join(dir, "boards", copy.id, "assets", asset.assetId));
    expect(copied.byteLength).toBe(png.byteLength);
  });
});
