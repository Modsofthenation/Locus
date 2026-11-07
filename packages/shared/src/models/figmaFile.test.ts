import { describe, expect, it } from "vitest";
import {
  figmaApiNodeId,
  parseFigmaFileRef,
  parseFigmaTeamRef,
  summarizeFigmaDocument,
} from "./figmaFile.js";

describe("figma file helpers", () => {
  it("parses file keys, design URLs, and node ids", () => {
    expect(parseFigmaFileRef("AbCdEfGhIjKlMnOpQrStUv")).toEqual({
      fileKey: "AbCdEfGhIjKlMnOpQrStUv",
    });
    expect(
      parseFigmaFileRef("https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/Home?node-id=12-34"),
    ).toEqual({ fileKey: "AbCdEfGhIjKlMnOpQrStUv", nodeId: "12:34" });
    expect(
      parseFigmaFileRef("https://figma.com/file/AbCdEfGhIjKlMnOpQrStUv/Old?node-id=1%3A2"),
    ).toEqual({ fileKey: "AbCdEfGhIjKlMnOpQrStUv", nodeId: "1:2" });
    expect(figmaApiNodeId("12-34")).toBe("12:34");
    expect(parseFigmaFileRef("")).toBeUndefined();
    expect(parseFigmaFileRef("https://example.com/design/abc")).toBeUndefined();
  });

  it("parses team and project URLs", () => {
    expect(parseFigmaTeamRef("https://www.figma.com/files/team/123456789/project/987654")).toEqual({
      teamId: "123456789",
      projectId: "987654",
    });
    expect(parseFigmaTeamRef("https://www.figma.com/files/team/123456789")).toEqual({
      teamId: "123456789",
    });
    expect(parseFigmaTeamRef("not-a-url")).toBeUndefined();
  });

  it("summarizes pages, text, fills, and caps the tree", () => {
    const summary = summarizeFigmaDocument(
      {
        name: "Marketing",
        lastModified: "2026-01-01T00:00:00Z",
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            {
              id: "1:1",
              name: "Page 1",
              type: "CANVAS",
              children: [
                {
                  id: "1:2",
                  name: "Hero",
                  type: "FRAME",
                  layoutMode: "VERTICAL",
                  itemSpacing: 16,
                  absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
                  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
                  children: [
                    {
                      id: "1:3",
                      name: "Title",
                      type: "TEXT",
                      characters: "Ship locally",
                      style: { fontSize: 48, fontFamily: "Inter" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      { depth: 3 },
    );
    expect(summary.name).toBe("Marketing");
    expect(summary.pages?.[0]?.name).toBe("Page 1");
    const hero = summary.pages?.[0]?.children?.[0];
    expect(hero).toMatchObject({
      id: "1:2",
      name: "Hero",
      type: "FRAME",
      w: 1440,
      h: 900,
      layout: "vertical",
      gap: 16,
      fills: ["#ffffff"],
    });
    expect(hero?.children?.[0]).toMatchObject({
      name: "Title",
      text: "Ship locally",
      fontSize: 48,
      font: "Inter",
    });
  });

  it("summarizes the nodes endpoint and marks truncation", () => {
    const kids = Array.from({ length: 12 }, (_, i) => ({
      id: `2:${i}`,
      name: `Item ${i}`,
      type: "FRAME",
    }));
    const summary = summarizeFigmaDocument(
      {
        name: "App",
        nodes: {
          "1:2": {
            document: { id: "1:2", name: "Home", type: "FRAME", children: kids },
          },
        },
      },
      { maxNodes: 4, depth: 2 },
    );
    expect(summary.nodes?.[0]?.name).toBe("Home");
    expect(summary.truncated).toBe(true);
    expect((summary.nodes?.[0]?.children?.length ?? 0) + (summary.nodes?.[0]?.more ?? 0)).toBe(12);
  });
});
