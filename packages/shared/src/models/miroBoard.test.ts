import { describe, expect, it } from "vitest";
import {
  importMiroItems,
  locusConnectorToMiroBody,
  locusObjectToMiroCreate,
  miroHtmlToText,
} from "./miroBoard.js";
import type { BoardObject } from "./board.js";

describe("miro board mapping", () => {
  it("strips Miro HTML and repairs mojibake", () => {
    expect(miroHtmlToText("<p>Agents — code</p>")).toBe("Agents — code");
    expect(miroHtmlToText("Runtime: Docker Â· VM")).toBe("Runtime: Docker · VM");
  });

  it("imports stickies, shapes, frames, and connectors", () => {
    const objects = importMiroItems(
      [
        {
          id: "m-s",
          type: "sticky_note",
          data: { content: "<p>Hello</p>" },
          position: { x: 100, y: 80, origin: "center" },
          geometry: { width: 160, height: 140 },
          style: { fillColor: "light_green" },
        },
        {
          id: "m-b",
          type: "shape",
          data: { content: "API", shape: "hexagon" },
          position: { x: 400, y: 80, origin: "center" },
          geometry: { width: 180, height: 80 },
        },
        {
          id: "m-f",
          type: "frame",
          data: { title: "Surfaces" },
          position: { x: 200, y: 200, origin: "center" },
          geometry: { width: 400, height: 240 },
        },
      ],
      [{ id: "m-c", startItem: { id: "m-s" }, endItem: { id: "m-b" } }],
    );
    expect(objects.map((row) => row.type)).toEqual(["sticky", "shape", "frame", "connector"]);
    expect(objects[0]).toMatchObject({ type: "sticky", text: "Hello", color: "mint" });
    expect(objects[1]).toMatchObject({ type: "shape", shape: "hexagon", text: "API" });
    const wire = objects.find((row) => row.type === "connector");
    expect(wire?.fromId).toBe(objects[0]?.id);
    expect(wire?.toId).toBe(objects[1]?.id);
  });

  it("exports Locus objects to Miro create bodies", () => {
    const sticky: BoardObject = {
      id: "s1",
      type: "sticky",
      x: 0,
      y: 0,
      w: 160,
      h: 140,
      text: "Hello",
      color: "amber",
    };
    const created = locusObjectToMiroCreate(sticky);
    expect(created?.kind).toBe("sticky_notes");
    expect(created?.body).toMatchObject({
      data: { content: "Hello" },
      style: { fillColor: "light_yellow" },
    });
    const hex = locusObjectToMiroCreate({
      id: "h1",
      type: "shape",
      x: 0,
      y: 0,
      w: 80,
      h: 80,
      text: "API",
      shape: "hexagon",
    });
    expect(hex?.kind).toBe("shapes");
    expect(hex?.body).toMatchObject({ data: { shape: "hexagon" } });
    const ids = new Map([
      ["s1", "miro-s"],
      ["h1", "miro-h"],
    ]);
    expect(
      locusConnectorToMiroBody(
        { id: "c1", type: "connector", x: 0, y: 0, w: 0, h: 0, fromId: "s1", toId: "h1" },
        ids,
      ),
    ).toEqual({ startItem: { id: "miro-s" }, endItem: { id: "miro-h" } });
  });
});
