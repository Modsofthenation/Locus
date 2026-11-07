import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyAttachmentPromptNote,
  attachmentPromptNote,
  landAssetSourceImage,
  materializeStoredAttachments,
  parseIncomingAttachments,
  persistChatAttachments,
  storedImageBase64,
} from "./attachments.js";
import { decodePngRgba, encodePngRgba } from "./pngRgba.js";

describe("chat attachments", () => {
  it("rejects oversize, unknown types, and too many files", () => {
    expect(() => parseIncomingAttachments({ name: "a.txt" })).toThrow(/array/);
    expect(() =>
      parseIncomingAttachments([
        { name: "a.txt", contentBase64: Buffer.from("hi").toString("base64") },
        { name: "b.txt", contentBase64: Buffer.from("hi").toString("base64") },
        { name: "c.txt", contentBase64: Buffer.from("hi").toString("base64") },
        { name: "d.txt", contentBase64: Buffer.from("hi").toString("base64") },
        { name: "e.txt", contentBase64: Buffer.from("hi").toString("base64") },
        { name: "f.txt", contentBase64: Buffer.from("hi").toString("base64") },
        { name: "g.txt", contentBase64: Buffer.from("hi").toString("base64") },
        { name: "h.txt", contentBase64: Buffer.from("hi").toString("base64") },
        { name: "i.txt", contentBase64: Buffer.from("hi").toString("base64") },
      ]),
    ).toThrow(/At most/);
    expect(() => parseIncomingAttachments([{ name: "evil.exe", contentBase64: "YQ==" }])).toThrow(
      /Unsupported/,
    );
  });

  it("writes attachments into the data dir and workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-att-"));
    const workspace = join(dir, "ws");
    const incoming = parseIncomingAttachments([
      {
        name: "notes.md",
        mime: "text/markdown",
        contentBase64: Buffer.from("# hi\n").toString("base64"),
      },
    ]);
    const saved = await persistChatAttachments(dir, "sess-1", incoming, workspace);
    expect(saved[0]?.storedName).toBe("notes.md");
    expect(await readFile(join(dir, "attachments", "sess-1", "notes.md"), "utf8")).toBe("# hi\n");
    expect(await readFile(join(workspace, ".locus-attachments", "notes.md"), "utf8")).toBe(
      "# hi\n",
    );
    expect(attachmentPromptNote(saved)).toContain("/workspace/.locus-attachments/notes.md");
  });

  it("inserts clipboard chips at their token instead of a trailing attach list", () => {
    const attachments = [
      { name: "clip.png", mime: "image/png", bytes: 12, storedName: "clip.png" },
      { name: "notes.md", mime: "text/markdown", bytes: 4, storedName: "notes.md" },
    ];
    expect(applyAttachmentPromptNote("Look at [[paste:clip.png]] please", attachments)).toBe(
      "Look at clip.png at /workspace/.locus-attachments/clip.png please\n\nAttached files:\n- notes.md (text/markdown, 4 bytes) at /workspace/.locus-attachments/notes.md",
    );
    expect(applyAttachmentPromptNote("[[paste:clip.png]]", [attachments[0]!])).toBe(
      "clip.png at /workspace/.locus-attachments/clip.png",
    );
    expect(applyAttachmentPromptNote("canvas[[paste:clip.png]]", [attachments[0]!])).toBe(
      "canvas\nclip.png at /workspace/.locus-attachments/clip.png",
    );
    expect(
      applyAttachmentPromptNote("[[paste:clip 2.png]] then [[paste:clip.png]]", [
        { name: "clip.png", mime: "image/png", bytes: 1, storedName: "clip.png" },
        { name: "clip 2.png", mime: "image/png", bytes: 2, storedName: "clip 2.png" },
      ]),
    ).toBe(
      "clip 2.png at /workspace/.locus-attachments/clip 2.png then clip.png at /workspace/.locus-attachments/clip.png",
    );
  });

  it("restores attachments onto a wiped docker workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-att-restore-"));
    const workspace = join(dir, "ws");
    const incoming = parseIncomingAttachments([
      {
        name: "shot.png",
        mime: "image/png",
        contentBase64: Buffer.from("png").toString("base64"),
      },
    ]);
    await persistChatAttachments(dir, "sess-1", incoming, workspace);
    await rm(join(workspace, ".locus-attachments"), { recursive: true, force: true });
    const src = await materializeStoredAttachments(dir, "sess-1", workspace);
    expect(src).toBe(join(dir, "attachments", "sess-1"));
    expect(await readFile(join(workspace, ".locus-attachments", "shot.png"))).toEqual(
      Buffer.from("png"),
    );
    expect(await landAssetSourceImage(dir, "sess-1", workspace)).toBe(true);
    expect(await readFile(join(workspace, "source.png"))).toEqual(Buffer.from("png"));
  });

  it("materializes stored files through a writeBytes callback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-att-writer-"));
    const incoming = parseIncomingAttachments([
      {
        name: "shot.png",
        mime: "image/png",
        contentBase64: Buffer.from("png").toString("base64"),
      },
    ]);
    await persistChatAttachments(dir, "sess-1", incoming);
    const written = new Map<string, Buffer>();
    const src = await materializeStoredAttachments(dir, "sess-1", undefined, async (rel, bytes) => {
      written.set(rel, bytes);
    });
    expect(src).toBe(join(dir, "attachments", "sess-1"));
    expect(written.get(".locus-attachments/shot.png")).toEqual(Buffer.from("png"));
    expect(
      await landAssetSourceImage(dir, "sess-1", undefined, {
        writeBytes: async (rel, bytes) => {
          written.set(rel, bytes);
        },
      }),
    ).toBe(true);
    expect(written.get("source.png")).toEqual(Buffer.from("png"));
  });

  it("lands front and side photos onto the asset studio root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-att-views-"));
    const workspace = join(dir, "ws");
    const incoming = parseIncomingAttachments([
      {
        name: "front.png",
        mime: "image/png",
        contentBase64: Buffer.from("front").toString("base64"),
      },
      {
        name: "side.png",
        mime: "image/png",
        contentBase64: Buffer.from("side").toString("base64"),
      },
    ]);
    await persistChatAttachments(dir, "sess-1", incoming, workspace);
    expect(await landAssetSourceImage(dir, "sess-1", workspace)).toBe(true);
    expect(await readFile(join(workspace, "source.png"))).toEqual(Buffer.from("front"));
    expect(await readFile(join(workspace, "source-side.png"))).toEqual(Buffer.from("side"));
  });

  it("enhances a PNG photo into a transparent cutout and mask", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-att-enhance-"));
    const workspace = join(dir, "ws");
    const width = 24;
    const height = 24;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const subject = x >= 7 && x < 17 && y >= 5 && y < 19;
        pixels[o] = subject ? 200 : 248;
        pixels[o + 1] = subject ? 40 : 248;
        pixels[o + 2] = subject ? 30 : 248;
        pixels[o + 3] = 255;
      }
    }
    const png = encodePngRgba(width, height, pixels);
    const incoming = parseIncomingAttachments([
      { name: "hero.png", mime: "image/png", contentBase64: png.toString("base64") },
    ]);
    await persistChatAttachments(dir, "sess-1", incoming, workspace);
    expect(await landAssetSourceImage(dir, "sess-1", workspace, { enhance: true })).toBe(true);
    const landed = decodePngRgba(await readFile(join(workspace, "source.png")));
    const mask = decodePngRgba(await readFile(join(workspace, "source-mask.png")));
    expect(landed?.width).toBe(24);
    expect(mask?.width).toBe(24);
    expect(landed?.data[(2 * width + 2) * 4 + 3]).toBe(0);
    expect(landed?.data[(12 * width + 12) * 4 + 3]).toBeGreaterThan(200);
  });

  it("rehydrates a stored image attachment as base64", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-att-img-"));
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const incoming = parseIncomingAttachments([
      { name: "shot.png", mime: "image/png", contentBase64: png.toString("base64") },
    ]);
    const saved = await persistChatAttachments(dir, "sess-1", incoming);
    const image = await storedImageBase64(dir, "sess-1", saved);
    expect(image?.mime).toBe("image/png");
    expect(image?.base64).toBe(png.toString("base64"));
  });

  it.skipIf(process.platform === "win32")(
    "does not follow a workspace symlink when copying a binary attachment",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-att-link-"));
      const workspace = join(dir, "ws");
      const outside = join(dir, "out");
      await mkdir(workspace);
      await mkdir(outside);
      await writeFile(join(outside, "secret.bin"), "SECRET");
      await symlink(outside, join(workspace, ".locus-attachments"));
      const incoming = parseIncomingAttachments([
        {
          name: "shot.png",
          mime: "image/png",
          contentBase64: Buffer.from("png").toString("base64"),
        },
      ]);
      await expect(persistChatAttachments(dir, "sess-1", incoming, workspace)).rejects.toThrow(
        /symlink/,
      );
      expect(await readFile(join(outside, "secret.bin"), "utf8")).toBe("SECRET");
    },
  );
});
