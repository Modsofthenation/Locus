import { describe, expect, it } from "vitest";
import {
  assetMentionItems,
  assetMentionToken,
  assetPreviewRel,
  assetPreviewUrl,
  filterAssetMentions,
  formatLinkedAssetsPrompt,
  inferAssetPackKind,
  insertAssetMention,
  looksLikeUnusedLinkedAssets,
  parseAssetMentions,
  parseAssetPackManifest,
  parseLinkedAssetPrompt,
  parseSessionAssetRefs,
  resolveAssetMention,
  slugifyAssetTitle,
  uniqueAssetSlug,
  unusedLinkedAssetsNudge,
  MAX_UNUSED_LINKED_ASSET_NUDGES,
  upsertLinkedAssetsSection,
} from "./assetPack.js";

describe("asset pack helpers", () => {
  it("slugifies titles and keeps collisions unique", () => {
    expect(slugifyAssetTitle("Knight Hero")).toBe("knight-hero");
    expect(slugifyAssetTitle("Untitled asset")).toBe("asset");
    expect(uniqueAssetSlug("Knight", "abcd-1234", ["knight"])).toBe("knight-abcd");
  });

  it("parses @asset mentions and ignores emails / file paths", () => {
    expect(parseAssetMentions("Use @asset:knight and @asset:slime as enemies")).toEqual([
      "knight",
      "slime",
    ]);
    expect(parseAssetMentions("ping a@b.com then @src/app.ts")).toEqual([]);
    expect(insertAssetMention("Use @as", 7, "knight", { start: 4, query: "as" })).toEqual({
      text: "Use @asset:knight ",
      cursor: 18,
    });
    expect(assetMentionToken("knight")).toBe("asset:knight");
    expect(assetPreviewRel(["model.glb", "preview.png"])).toBe(".locus-asset/preview.png");
    expect(assetPreviewRel(["sheet.png"])).toBe(".locus-asset/sheet.png");
    expect(assetPreviewRel(["source.png"])).toBe(".locus-asset/source.png");
    expect(assetPreviewRel([])).toBe("source.png");
    expect(
      assetPreviewUrl("a1", { files: ["source.png"], updatedAt: "2020-01-01T00:00:00.000Z" }),
    ).toBe("/api/sessions/a1/canvas-files/.locus-asset/source.png?t=1577836800000");
    expect(assetPreviewUrl("as1")).toBe("/api/sessions/as1/canvas-files/source.png");
  });

  it("parses manifests and session refs", () => {
    const manifest = parseAssetPackManifest({
      version: 1,
      sessionId: "a1",
      title: "Knight",
      slug: "knight",
      kind: "sheet",
      clips: ["idle", "walk"],
      files: [{ name: "sheet.png", role: "sheet", mime: "image/png" }],
      columns: 4,
      rows: 2,
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(manifest?.slug).toBe("knight");
    expect(manifest?.files[0]?.role).toBe("sheet");
    expect(parseAssetPackManifest({ slug: "../x", kind: "sprite" })).toBeNull();
    expect(
      parseSessionAssetRefs([
        { sessionId: "a1", slug: "knight" },
        { sessionId: "a1", slug: "dup" },
        { slug: "no-id" },
      ]),
    ).toEqual([{ sessionId: "a1", slug: "knight" }]);
    const prompt = parseLinkedAssetPrompt({
      slug: "knight",
      title: "Knight",
      kind: "sheet",
      dir: "vendor/assets/knight",
      files: [{ name: "sheet.png", role: "sheet", mime: "image/png" }],
      clips: ["idle"],
      columns: 4,
      rows: 2,
    });
    expect(prompt?.kind).toBe("sheet");
    expect(prompt?.columns).toBe(4);
    expect(parseLinkedAssetPrompt({ slug: "x", kind: "nope" })?.kind).toBe("sprite");
    expect(parseLinkedAssetPrompt({ kind: "sprite" })).toBeNull();
  });

  it("infers pack kind from files and html", () => {
    expect(
      inferAssetPackKind({ files: [{ name: "model.glb", role: "model" }], clips: ["walk"] }),
    ).toBe("rigged");
    expect(inferAssetPackKind({ files: [{ name: "sheet.png", role: "sheet" }] })).toBe("sheet");
    expect(inferAssetPackKind({ files: [{ name: "source.png", role: "source" }] })).toBe("sprite");
  });

  it("formats a load contract the game model can follow", () => {
    const prompt = formatLinkedAssetsPrompt([
      {
        slug: "knight",
        title: "Knight",
        kind: "sheet",
        dir: "vendor/assets/knight",
        files: [{ name: "sheet.png", role: "sheet", mime: "image/png" }],
        clips: ["idle", "walk"],
        columns: 4,
        rows: 2,
        frameWidth: 16,
        frameHeight: 16,
      },
    ]);
    expect(prompt).toMatch(/@asset:knight/);
    expect(prompt).toMatch(/\/workspace\/vendor\/assets\/knight\/sheet.png/);
    expect(prompt).toMatch(/drawImage/);
    expect(prompt).toMatch(/Do not regenerate pixels/);
  });

  it("upserts a Linked assets section in GAME.md", () => {
    const brief = "# Arcade\n\n## Loop\n\nPlay.\n\n## Persistence\n\nlocalStorage.\n";
    const next = upsertLinkedAssetsSection(brief, [
      {
        slug: "knight",
        title: "Knight",
        kind: "sprite",
        dir: "vendor/assets/knight",
        files: [{ name: "source.png", role: "source", mime: "image/png" }],
        clips: [],
      },
    ]);
    expect(next).toMatch(/## Linked assets/);
    expect(next).toMatch(/@asset:knight/);
    expect(next.indexOf("## Linked assets")).toBeLessThan(next.indexOf("## Persistence"));
    const again = upsertLinkedAssetsSection(next, []);
    expect(again).toMatch(/None\./);
    expect(again.match(/## Linked assets/g)).toHaveLength(1);
  });

  it("detects unused linked assets in canvas HTML", () => {
    expect(looksLikeUnusedLinkedAssets("<html></html>", ["knight"])).toBe(true);
    expect(
      looksLikeUnusedLinkedAssets('<img src="vendor/assets/knight/source.png">', ["knight"]),
    ).toBe(false);
    expect(looksLikeUnusedLinkedAssets("", ["knight"])).toBe(false);
    expect(unusedLinkedAssetsNudge(["knight"])).toMatch(/@asset:knight/);
    expect(unusedLinkedAssetsNudge(["knight"])).toMatch(/GLTFLoader/);
    expect(MAX_UNUSED_LINKED_ASSET_NUDGES).toBe(2);
  });

  it("lists mentionable asset chats for a game session", () => {
    const items = assetMentionItems({
      session: { id: "g1", kind: "game" },
      sessions: [
        {
          id: "a1",
          kind: "assets",
          title: "Knight",
          assetPack: {
            slug: "knight",
            kind: "sprite",
            title: "Knight",
            updatedAt: "t",
            files: ["source.png"],
          },
        },
        { id: "a2", kind: "assets", title: "Slime", archived: true },
        { id: "g1", kind: "game", title: "Arcade" },
      ],
    });
    expect(items.map((row) => row.token)).toEqual(["asset:knight"]);
    expect(items[0]?.previewUrl).toBe("/api/sessions/a1/canvas-files/.locus-asset/source.png");
    expect(filterAssetMentions(items, "kn").map((row) => row.token)).toEqual(["asset:knight"]);
    expect(filterAssetMentions(items, "nope")).toEqual([]);
    expect(
      resolveAssetMention("knight", [
        {
          id: "a1",
          kind: "assets",
          title: "Knight",
          assetPack: items[0] && {
            slug: "knight",
            kind: "sprite",
            title: "Knight",
            updatedAt: "t",
            files: ["source.png"],
          },
        },
      ])?.id,
    ).toBe("a1");
    expect(assetMentionItems({ session: { id: "x", kind: "agent" }, sessions: [] })).toEqual([]);
  });
});
