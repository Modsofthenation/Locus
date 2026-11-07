import { describe, expect, it } from "vitest";
import {
  alignBoardObjects,
  bindBoardCite,
  boardAiPrompt,
  boardAssetExt,
  boardCitePresentation,
  boardConnectorElbow,
  boardNeedsYouItems,
  boardStarterObjects,
  boardSummary,
  boardTitleFromStarter,
  clusterBoardStickies,
  connectBoardObjects,
  distributeBoardObjects,
  frameBoardSelection,
  cameraToFit,
  dropBoardObjects,
  duplicateBoardObjects,
  formatBoardSelection,
  formatFrameBrief,
  hitBoardConnector,
  hitBoardObject,
  pickBoardHit,
  isBoardAssetId,
  isBoardToolName,
  layerBoardObjects,
  objectsForClipboard,
  objectsInRect,
  parseBoardClipboard,
  parseBoardDocument,
  parseBoardObject,
  parseBoardPaste,
  rehomeBoardObjects,
  resizeBoardObject,
  scaleBoardSelection,
  selectionBounds,
  selectionMoveIds,
  selectionStickyStackIds,
  serializeBoardClipboard,
  spawnConnectedBoardObject,
  stackBoardStickies,
  maybeStackDroppedStickies,
  unstackBoardStickies,
  translateBoardObjects,
  boardObjectFromInkStroke,
  boardFramesInPresentationOrder,
  nextPresentFrameIndex,
  pinPlanObjectsToFrame,
  type BoardObject,
} from "./board.js";

describe("board model", () => {
  it("seeds architecture with frames, boxes, connectors, and stickies", () => {
    const objects = boardStarterObjects("architecture");
    expect(objects.filter((row) => row.type === "frame").map((row) => row.text)).toEqual([
      "Context",
      "Container",
      "Component",
      "Open questions",
    ]);
    expect(objects.some((row) => row.type === "connector" && row.fromId && row.toId)).toBe(true);
    expect(objects.some((row) => row.type === "sticky")).toBe(true);
  });

  it("seeds sprint lanes and a blank frame", () => {
    expect(boardStarterObjects("sprint").filter((row) => row.type === "frame")).toHaveLength(3);
    expect(boardStarterObjects("kanban").filter((row) => row.type === "frame")).toHaveLength(3);
    expect(boardStarterObjects("kanban").some((row) => row.text === "Doing")).toBe(true);
    expect(boardStarterObjects("blank")).toEqual([
      expect.objectContaining({ type: "frame", text: "Untitled" }),
    ]);
    expect(boardTitleFromStarter("sprint")).toBe("Sprint");
    expect(boardTitleFromStarter("blank")).toBe("Untitled board");
    const retro = boardStarterObjects("retro");
    expect(retro.filter((row) => row.type === "frame").map((row) => row.text)).toEqual([
      "Went well",
      "To improve",
      "Ideas",
      "Actions",
    ]);
    expect(boardTitleFromStarter("retro")).toBe("Retro");
  });

  it("round-trips a document and summarizes it", () => {
    const objects = boardStarterObjects("rca");
    const parsed = parseBoardDocument({
      id: "b1",
      title: "RCA",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      objects,
      comments: [
        {
          id: "c1",
          objectId: objects[0]?.id,
          body: "Fill in the symptom",
          author: "operator",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      starter: "rca",
    });
    expect(parsed?.objects.length).toBe(objects.length);
    expect(boardSummary(parsed!).frameCount).toBe(4);
    expect(formatFrameBrief(parsed!, "f-hap")).toMatch(/What happened/);
    expect(formatFrameBrief(parsed!, "f-hap")).toMatch(/Symptom/);
    expect(formatBoardSelection(parsed!, ["f-hap"])).toMatch(/What happened/);
    expect(boardAiPrompt(parsed!, ["f-hap"], "cluster")).toMatch(/Cluster these stickies/);
    expect(boardAiPrompt(parsed!, ["f-hap"], "cluster")).toMatch(/What happened/);
  });

  it("keeps only http(s) cite URLs and known sticky colors", () => {
    const bad = parseBoardObject({
      id: "s1",
      type: "sticky",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      color: "amber;pwnd",
      cite: { kind: "jira", key: "OPS-1", url: "javascript:alert(1)" },
    });
    expect(bad?.color).toBeUndefined();
    expect(bad?.cite).toEqual({ kind: "jira", key: "OPS-1" });
    expect(
      parseBoardObject({
        id: "s2",
        type: "sticky",
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        color: "mint",
        cite: { kind: "jira", url: "https://acme.atlassian.net/browse/OPS-1" },
      }),
    ).toEqual(
      expect.objectContaining({
        color: "mint",
        cite: { kind: "jira", url: "https://acme.atlassian.net/browse/OPS-1" },
      }),
    );
  });

  it("rejects path-like ids on objects and parses paste cites", () => {
    expect(parseBoardObject({ id: "../x", type: "sticky", x: 0, y: 0, w: 10, h: 10 })).toEqual(
      expect.objectContaining({ id: "../x", type: "sticky" }),
    );
    expect(parseBoardPaste("https://github.com/acme/app/pull/12")?.kind).toBe("pull");
    expect(parseBoardPaste("OPS-12")?.kind).toBe("jira");
    expect(parseBoardPaste("https://linear.app/acme/issue/ENG-12/cart-500")).toEqual({
      kind: "linear",
      key: "ENG-12",
      url: "https://linear.app/acme/issue/ENG-12/cart-500",
      label: "ENG-12",
    });
    expect(parseBoardPaste("https://app.slack.com/archives/C123/p1")?.kind).toBe("slack");
    expect(isBoardToolName("board_upsert")).toBe(true);
    expect(isBoardToolName("file_write")).toBe(false);
  });

  it("drops connectors when an endpoint is deleted", () => {
    const board = parseBoardDocument({
      id: "b1",
      title: "Map",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      objects: [
        { id: "a", type: "shape", x: 0, y: 0, w: 80, h: 40, text: "A" },
        { id: "b", type: "shape", x: 200, y: 0, w: 80, h: 40, text: "B" },
        { id: "c", type: "connector", x: 0, y: 0, w: 0, h: 0, fromId: "a", toId: "b" },
      ],
      comments: [
        {
          id: "n1",
          objectId: "a",
          body: "note",
          author: "operator",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    })!;
    const next = dropBoardObjects(board, ["a"]);
    expect(next.objects.map((row) => row.id)).toEqual(["b"]);
    expect(next.comments).toEqual([]);
  });

  it("moves a frame with its children and rehomes on drop", () => {
    const objects: BoardObject[] = [
      { id: "f", type: "frame", x: 0, y: 0, w: 200, h: 200, text: "Lane" },
      { id: "s", type: "sticky", x: 20, y: 40, w: 80, h: 80, text: "In", frameId: "f" },
      { id: "out", type: "sticky", x: 400, y: 0, w: 80, h: 80, text: "Out" },
    ];
    const ids = selectionMoveIds(objects, ["f"]);
    expect([...ids].sort()).toEqual(["f", "s"]);
    const moved = translateBoardObjects(objects, ids, 40, 0);
    expect(moved.find((row) => row.id === "s")?.x).toBe(60);
    const out = translateBoardObjects(objects, new Set(["s"]), 400, 0);
    const homed = rehomeBoardObjects(out, new Set(["s"]));
    expect(homed.find((row) => row.id === "s")?.frameId).toBeUndefined();
  });

  it("marquee-selects, resizes, and round-trips a clipboard slice", () => {
    const objects: BoardObject[] = [
      { id: "s1", type: "sticky", x: 0, y: 0, w: 80, h: 80, text: "A" },
      { id: "s2", type: "sticky", x: 200, y: 200, w: 80, h: 80, text: "B" },
      { id: "c", type: "connector", x: 0, y: 0, w: 0, h: 0, fromId: "s1", toId: "s2" },
    ];
    expect(objectsInRect(objects, { x: -10, y: -10, w: 100, h: 100 })).toEqual(["s1"]);
    expect(resizeBoardObject(objects[0]!, "se", 40, 20).w).toBe(120);
    expect(resizeBoardObject(objects[0]!, "nw", -40, -20).x).toBe(-40);
    expect(hitBoardConnector(objects, 140, 140, 20)?.id).toBe("c");
    const cam = cameraToFit(objects, { w: 400, h: 300 });
    expect(cam.z).toBeGreaterThan(0);
    const payload = serializeBoardClipboard(objectsForClipboard(objects, ["s1", "s2"]));
    const parsed = parseBoardClipboard(payload);
    expect(parsed?.map((row) => row.type).sort()).toEqual(["connector", "sticky", "sticky"]);
    const dup = duplicateBoardObjects(objects, ["s1"]);
    expect(dup.ids).toHaveLength(1);
    expect(dup.objects).toHaveLength(4);
  });

  it("layers and scales a selection", () => {
    const objects: BoardObject[] = [
      { id: "a", type: "sticky", x: 0, y: 0, w: 80, h: 80, text: "A" },
      { id: "b", type: "sticky", x: 100, y: 0, w: 80, h: 80, text: "B" },
      { id: "c", type: "sticky", x: 200, y: 0, w: 80, h: 80, text: "C" },
    ];
    expect(layerBoardObjects(objects, ["a"], "front").map((row) => row.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(layerBoardObjects(objects, ["c"], "back").map((row) => row.id)).toEqual(["c", "a", "b"]);
    expect(layerBoardObjects(objects, ["a"], "forward").map((row) => row.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(layerBoardObjects(objects, ["c"], "backward").map((row) => row.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(selectionBounds(objects, ["a", "b"])).toEqual({ x: 0, y: 0, w: 180, h: 80 });
    const scaled = scaleBoardSelection(objects, ["a"], "se", 40, 40, true);
    expect(scaled[0]?.w).toBe(120);
    expect(scaled[0]?.h).toBe(120);
    expect(scaled[0]?.x).toBe(0);
    expect(scaled[0]?.y).toBe(0);
  });

  it("hits stickies over a covering frame", () => {
    const objects: BoardObject[] = [
      { id: "f1", type: "frame", x: 0, y: 0, w: 200, h: 200, z: 9, text: "Lane" },
      { id: "s1", type: "sticky", x: 20, y: 20, w: 80, h: 80, z: 0, text: "Note" },
    ];
    expect(hitBoardObject(objects, 40, 40)?.id).toBe("s1");
    expect(hitBoardObject(objects, 180, 180)?.id).toBe("f1");
  });

  it("picks a connector over a covering frame", () => {
    const objects: BoardObject[] = [
      { id: "f1", type: "frame", x: 0, y: 0, w: 400, h: 200, text: "Lane" },
      { id: "a", type: "sticky", x: 20, y: 40, w: 80, h: 80, text: "A" },
      { id: "b", type: "sticky", x: 280, y: 40, w: 80, h: 80, text: "B" },
      { id: "c", type: "connector", x: 0, y: 0, w: 0, h: 0, fromId: "a", toId: "b" },
    ];
    expect(hitBoardObject(objects, 190, 80)?.id).toBe("f1");
    expect(pickBoardHit(objects, 190, 80)?.id).toBe("c");
    expect(pickBoardHit(objects, 40, 80)?.id).toBe("a");
    expect(pickBoardHit(objects, 200, 180)?.id).toBe("f1");
  });

  it("aligns, distributes, frames, and connects a selection", () => {
    const objects: BoardObject[] = [
      { id: "a", type: "sticky", x: 0, y: 0, w: 80, h: 80, text: "A" },
      { id: "b", type: "sticky", x: 200, y: 40, w: 80, h: 80, text: "B" },
      { id: "c", type: "sticky", x: 400, y: 80, w: 80, h: 80, text: "C" },
    ];
    const left = alignBoardObjects(objects, ["a", "b", "c"], "left");
    expect(left.map((row) => row.x)).toEqual([0, 0, 0]);
    const spread = distributeBoardObjects(objects, ["a", "b", "c"], "horizontal");
    expect(spread[1]?.x).toBeGreaterThan(80);
    expect(spread[1]?.x).toBeLessThan(400);
    const framed = frameBoardSelection(objects, ["a", "b"]);
    expect(framed.objects[0]?.type).toBe("frame");
    expect(framed.objects.find((row) => row.id === "a")?.frameId).toBe(framed.frameId);
    const linked = connectBoardObjects(objects, "a", "b");
    expect(linked.some((row) => row.type === "connector" && row.fromId === "a")).toBe(true);
    const clustered = clusterBoardStickies(
      [
        { id: "a", type: "sticky", x: 10, y: 10, w: 80, h: 80, text: "billing gateway timeout" },
        { id: "b", type: "sticky", x: 200, y: 10, w: 80, h: 80, text: "billing gateway retry" },
        { id: "c", type: "sticky", x: 400, y: 10, w: 80, h: 80, text: "unrelated note" },
      ],
      ["a", "b", "c"],
    );
    expect(clustered.frameIds.length).toBeGreaterThan(1);
    const frames = clustered.objects.filter((row) => row.type === "frame");
    expect(frames.some((row) => /billing/i.test(row.text ?? ""))).toBe(true);
    const grouped = clustered.objects.find((row) => row.id === "a");
    expect(grouped?.frameId).toBeTruthy();
    expect(grouped?.stackId).toBeUndefined();
    expect((grouped?.x ?? -1) % 20).toBe(0);
    expect(clusterBoardStickies(objects, ["a"]).frameIds).toEqual([]);
    const spawned = spawnConnectedBoardObject(objects, "a", "e");
    expect(spawned.id).toBeTruthy();
    expect(spawned.objects.some((row) => row.id === spawned.id && row.x > 80)).toBe(true);
    expect(boardConnectorElbow({ x: 0, y: 0 }, { x: 80, y: 20 })).toHaveLength(4);
    expect(hitBoardConnector(linked, 140, 40, 8)?.type).toBe("connector");
  });

  it("picks ink along the stroke, not the bounding box", () => {
    const ink = boardObjectFromInkStroke("ink1", [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 40 },
    ]);
    expect(ink).toBeTruthy();
    const objects = [
      { id: "f1", type: "frame" as const, x: -20, y: -20, w: 200, h: 120, text: "Lane" },
      ink!,
    ];
    expect(pickBoardHit(objects, 40, 0)?.id).toBe("ink1");
    expect(pickBoardHit(objects, 20, 30)?.id).toBe("f1");
  });

  it("binds paste cites and flags stale cards", () => {
    const paste = parseBoardPaste("https://github.com/acme/app/pull/12");
    expect(paste).toMatchObject({ kind: "pull", number: 12, label: "acme/app#12" });
    const bound = bindBoardCite(paste!, {
      repos: [{ id: "r1", name: "app", checkout: { url: "https://github.com/acme/app.git" } }],
    });
    expect(bound.repoId).toBe("r1");
    expect(
      boardCitePresentation(
        { kind: "agent", sessionId: "gone", label: "Old" },
        { sessions: [{ id: "s1", title: "Live", status: "idle" }] },
      ).stale,
    ).toBe(true);
    expect(
      boardCitePresentation(
        { kind: "agent", sessionId: "s1" },
        { sessions: [{ id: "s1", title: "Live", status: "idle" }] },
      ),
    ).toEqual({ label: "Live", detail: "idle", stale: false });
    expect(
      boardCitePresentation(
        { kind: "brain", nodeId: "service:billing-gateway", label: "billing" },
        {
          brainNodes: [{ id: "service:billing-gateway", name: "billing-gateway", type: "Service" }],
        },
      ),
    ).toEqual({ label: "billing-gateway", detail: "Service", stale: false });
    expect(
      boardCitePresentation({ kind: "brain", nodeId: "service:gone" }, { brainNodes: [] }).stale,
    ).toBe(true);
    expect(isBoardAssetId("not-an-asset")).toBe(false);
    expect(boardAssetExt("image/png")).toBe("png");
    const slack = parseBoardPaste("https://app.slack.com/archives/C123ABC/p1740000000123456");
    expect(slack).toMatchObject({
      kind: "slack",
      channelId: "C123ABC",
      threadTs: "1740000000.123456",
    });
    expect(
      boardNeedsYouItems([
        {
          ...boardSummary({
            id: "b1",
            title: "Retro",
            createdAt: "t",
            updatedAt: "t",
            objects: [],
            comments: [
              { id: "c1", objectId: "s1", body: "Need owner", author: "agent", createdAt: "t" },
              {
                id: "c2",
                objectId: "s1",
                body: "done",
                author: "operator",
                resolved: true,
                createdAt: "t",
              },
            ],
          }),
          title: "Retro",
        },
      ]).map((row) => row.detail),
    ).toEqual(["Need owner"]);
  });

  it("repairs mojibake, font size, shapes, tables, and timelines", () => {
    const garbled = (text: string) => {
      const bytes = new TextEncoder().encode(text);
      const cp1252: Record<number, string> = {
        0x80: "\u20ac",
        0x89: "\u2030",
        0x88: "\u02c6",
        0x94: "\u201d",
      };
      return [...bytes].map((b) => cp1252[b] ?? String.fromCharCode(b)).join("");
    };
    expect(
      parseBoardObject({
        id: "s1",
        type: "sticky",
        x: 0,
        y: 0,
        w: 160,
        h: 140,
        text: garbled("Runtime: Docker · VM · host folder"),
      })?.text,
    ).toBe("Runtime: Docker · VM · host folder");
    expect(
      parseBoardObject({
        id: "s2",
        type: "sticky",
        x: 0,
        y: 0,
        w: 160,
        h: 140,
        text: garbled("Agents — code in a guest you own"),
      })?.text,
    ).toBe("Agents — code in a guest you own");
    expect(
      parseBoardObject({
        id: "s3",
        type: "sticky",
        x: 0,
        y: 0,
        w: 160,
        h: 140,
        text: garbled("Placement ≈ runtime"),
      })?.text,
    ).toBe("Placement ≈ runtime");
    expect(
      parseBoardObject({
        id: "t1",
        type: "text",
        x: 0,
        y: 0,
        w: 200,
        h: 40,
        text: "Heading",
        fontSize: 24,
        shape: "hexagon",
      }),
    ).toMatchObject({ fontSize: 24, text: "Heading" });
    const hex = parseBoardObject({
      id: "b1",
      type: "shape",
      x: 0,
      y: 0,
      w: 80,
      h: 80,
      shape: "hexagon",
      text: "API",
    });
    expect(hex?.shape).toBe("hexagon");
    const table = parseBoardObject({
      id: "tbl",
      type: "table",
      x: 0,
      y: 0,
      w: 400,
      h: 200,
      text: "Sprint",
      table: {
        columns: [{ id: "title", name: "Title", kind: "text" }],
        rows: [{ id: "r1", cells: { title: "Ship it" } }],
      },
    });
    expect(table?.table?.rows[0]?.cells.title).toBe("Ship it");
    const timeline = parseBoardObject({
      id: "tl",
      type: "timeline",
      x: 0,
      y: 0,
      w: 400,
      h: 200,
      text: "Roadmap",
      timeline: {
        scale: "weeks",
        items: [{ id: "i1", title: "First task", start: "2026-09-07", end: "2026-09-21" }],
      },
    });
    expect(timeline?.timeline?.items[0]).toMatchObject({
      title: "First task",
      start: "2026-09-07",
      end: "2026-09-21",
    });
    const brief = formatFrameBrief({
      id: "b1",
      title: "Plan",
      createdAt: "t",
      updatedAt: "t",
      objects: [table!, timeline!],
      comments: [],
    });
    expect(brief).toMatch(/Table: Sprint/);
    expect(brief).toMatch(/Ship it/);
    expect(brief).toMatch(/First task: 2026-09-07/);
    const ink = boardObjectFromInkStroke("ink1", [
      { x: 10, y: 10 },
      { x: 40, y: 40 },
      { x: 80, y: 20 },
    ]);
    expect(ink?.type).toBe("ink");
    expect(ink?.ink?.points.length).toBe(3);
    expect(
      parseBoardObject({
        id: "ink2",
        type: "ink",
        x: 0,
        y: 0,
        w: 80,
        h: 40,
        ink: {
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 10 },
          ],
        },
      })?.ink?.points,
    ).toHaveLength(2);
    const a = { id: "a", type: "sticky" as const, x: 0, y: 0, w: 80, h: 80, text: "A" };
    const b = { id: "b", type: "sticky" as const, x: 200, y: 0, w: 80, h: 80, text: "B" };
    const wire = {
      id: "w1",
      type: "connector" as const,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      fromId: "a",
      toId: "b",
    };
    const wireBox = selectionBounds([a, b, wire], ["w1"]);
    expect(wireBox).toBeTruthy();
    expect(wireBox!.w).toBeGreaterThan(32);
  });

  it("stacks, moves, drops, and unstacks stickies", () => {
    const objects: BoardObject[] = [
      { id: "s1", type: "sticky", x: 0, y: 0, w: 160, h: 140, text: "A" },
      { id: "s2", type: "sticky", x: 200, y: 0, w: 160, h: 140, text: "B" },
      { id: "s3", type: "sticky", x: 400, y: 0, w: 160, h: 140, text: "C" },
    ];
    expect(parseBoardObject({ ...objects[0], stackId: " pack " })?.stackId).toBe("pack");
    expect(
      parseBoardObject({
        id: "sh",
        type: "shape",
        x: 0,
        y: 0,
        w: 40,
        h: 40,
        stackId: "nope",
      })?.stackId,
    ).toBeUndefined();
    const stacked = stackBoardStickies(objects, ["s1", "s2"]);
    const a = stacked.find((row) => row.id === "s1");
    const b = stacked.find((row) => row.id === "s2");
    expect(a?.stackId).toBeTruthy();
    expect(b?.stackId).toBe(a?.stackId);
    expect(b?.x).toBe((a?.x ?? 0) + 8);
    expect(b?.y).toBe((a?.y ?? 0) + 8);
    expect([...selectionMoveIds(stacked, ["s1"])].sort()).toEqual(["s1", "s2"]);
    expect(selectionStickyStackIds(stacked, "s2").sort()).toEqual(["s1", "s2"]);
    const brief = formatFrameBrief({
      id: "b",
      title: "Pack",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      objects: stacked,
      comments: [],
    });
    expect(brief).toMatch(/Sticky stack \(2\): A · B/);
    const moved = translateBoardObjects(stacked, selectionMoveIds(stacked, ["s2"]), 20, 0);
    expect(moved.find((row) => row.id === "s1")?.x).toBe((a?.x ?? 0) + 20);
    expect(moved.find((row) => row.id === "s2")?.x).toBe((b?.x ?? 0) + 20);
    const dropped = maybeStackDroppedStickies(
      [
        { id: "s1", type: "sticky", x: 0, y: 0, w: 160, h: 140, text: "A" },
        { id: "s2", type: "sticky", x: 20, y: 10, w: 160, h: 140, text: "B" },
      ],
      new Set(["s2"]),
    );
    expect(dropped[0]?.stackId).toBeTruthy();
    expect(dropped[0]?.stackId).toBe(dropped[1]?.stackId);
    const spread = unstackBoardStickies(stacked, ["s1"]);
    expect(spread.find((row) => row.id === "s1")?.stackId).toBeUndefined();
    expect(spread.find((row) => row.id === "s2")?.stackId).toBeUndefined();
    expect(spread.find((row) => row.id === "s2")?.x).toBe((a?.x ?? 0) + 180);
    const droppedOne = dropBoardObjects(
      {
        id: "b",
        title: "Pack",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        objects: stacked,
        comments: [],
      },
      ["s1"],
    );
    expect(droppedOne.objects.find((row) => row.id === "s2")?.stackId).toBeUndefined();
    const dup = duplicateBoardObjects(stacked, ["s1", "s2"]);
    const copies = dup.objects.filter((row) => dup.ids.includes(row.id));
    expect(copies[0]?.stackId).toBeTruthy();
    expect(copies[0]?.stackId).not.toBe(a?.stackId);
    expect(copies[1]?.stackId).toBe(copies[0]?.stackId);
    expect(spread.find((row) => row.id === "s3")?.x).toBe(400);
  });

  it("orders frames for presentation and pins plan stickies into a frame", () => {
    const frames = boardFramesInPresentationOrder([
      { id: "b", type: "frame", x: 300, y: 0, w: 100, h: 100, text: "B" },
      { id: "a", type: "frame", x: 0, y: 0, w: 100, h: 100, text: "A" },
      { id: "c", type: "sticky", x: 0, y: 0, w: 40, h: 40, text: "note" },
    ]);
    expect(frames.map((row) => row.id)).toEqual(["a", "b"]);
    expect(nextPresentFrameIndex(3, null, -1, 1)).toBe(0);
    expect(nextPresentFrameIndex(3, null, -1, -1)).toBe(2);
    expect(nextPresentFrameIndex(3, null, 0, 1)).toBe(0);
    expect(nextPresentFrameIndex(3, 0, 0, 1)).toBe(1);
    const pinned = pinPlanObjectsToFrame(
      { id: "f1", type: "frame", x: 0, y: 0, w: 400, h: 600, text: "Plan" },
      [{ text: "Ship it" }, { text: "Test it" }],
      { files: ["src/app.ts"], risks: ["token leak"] },
    );
    expect(pinned.filter((row) => row.type === "sticky").map((row) => row.text)).toEqual([
      "1. Ship it",
      "2. Test it",
      "Risk: token leak",
    ]);
    expect(pinned.some((row) => row.type === "card" && row.cite?.path === "src/app.ts")).toBe(true);
    expect(
      parseBoardObject({
        id: "m1",
        type: "mermaid",
        x: 0,
        y: 0,
        w: 100,
        h: 80,
        text: "sequenceDiagram",
      })?.type,
    ).toBe("mermaid");
  });
});
