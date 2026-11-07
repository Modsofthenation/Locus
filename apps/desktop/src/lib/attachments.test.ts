import { describe, expect, it } from "vitest";
import {
  CLIPBOARD_FILENAME,
  clipboardChipLabel,
  composerFilesFromClipboard,
  filesFromDataTransfer,
  imageFilesFromClipboard,
  isImageFile,
  pastedTextFile,
  shouldAttachPastedText,
} from "./attachments";

function png(name = "shot.png") {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

describe("imageFilesFromClipboard", () => {
  it("reads image files from clipboard items", () => {
    const file = png();
    expect(
      imageFilesFromClipboard({
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      }),
    ).toEqual([file]);
  });

  it("ignores text-only pastes", () => {
    expect(
      imageFilesFromClipboard({
        items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
        files: [],
      }),
    ).toEqual([]);
  });

  it("skips non-image files", () => {
    const note = new File(["hi"], "note.txt", { type: "text/plain" });
    expect(
      imageFilesFromClipboard({
        items: [{ kind: "file", type: "text/plain", getAsFile: () => note }],
      }),
    ).toEqual([]);
  });

  it("falls back to data.files when items are empty", () => {
    const file = png("clip.png");
    expect(imageFilesFromClipboard({ files: [file] })).toEqual([file]);
  });

  it("names an untitled clipboard image", () => {
    const unnamed = new File([new Uint8Array([1, 2, 3])], "", { type: "image/jpeg" });
    const [file] = imageFilesFromClipboard({
      items: [{ kind: "file", type: "image/jpeg", getAsFile: () => unnamed }],
    });
    expect(file?.name).toBe("pasted-image.jpg");
    expect(file?.type).toBe("image/jpeg");
  });

  it("returns nothing for a null clipboard", () => {
    expect(imageFilesFromClipboard(null)).toEqual([]);
  });

  it("treats png and jpeg files as images", () => {
    expect(isImageFile(png())).toBe(true);
    expect(isImageFile(new File(["hi"], "note.txt", { type: "text/plain" }))).toBe(false);
  });
});

describe("filesFromDataTransfer", () => {
  it("keeps dropped files including non-images", () => {
    const note = new File(["hi"], "note.txt", { type: "text/plain" });
    const image = png();
    expect(filesFromDataTransfer({ files: [note, image] })).toEqual([note, image]);
  });

  it("returns nothing for a null transfer", () => {
    expect(filesFromDataTransfer(null)).toEqual([]);
  });
});

describe("composerFilesFromClipboard", () => {
  it("attaches a screenshot image ahead of clipboard text", () => {
    const file = png();
    const files = composerFilesFromClipboard({
      items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      getData: () => "line1\nline2\nline3",
    });
    expect(files).toEqual([file]);
  });

  it("turns a multi-line paste into a Clipboard file", () => {
    const [file] = composerFilesFromClipboard({
      items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
      files: [],
      getData: (type) => (type === "text/plain" ? "alpha\nbeta\ngamma" : ""),
    });
    expect(file?.name).toBe(CLIPBOARD_FILENAME);
    expect(file?.type).toBe("text/plain");
    expect(clipboardChipLabel("alpha\nbeta\ngamma")).toBe("@Clipboard (3 lines)");
  });

  it("turns a long single-line paste into a chip", () => {
    const text = "x".repeat(2000);
    const [file] = composerFilesFromClipboard({
      getData: () => text,
    });
    expect(file?.name).toBe(CLIPBOARD_FILENAME);
    expect(clipboardChipLabel(text)).toBe("@Clipboard (1 line)");
  });

  it("leaves a short paste for the composer textarea", () => {
    expect(
      composerFilesFromClipboard({
        items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
        getData: () => "fix this please",
      }),
    ).toEqual([]);
    expect(shouldAttachPastedText("one\ntwo")).toBe(false);
    expect(shouldAttachPastedText("")).toBe(false);
  });

  it("uniques a second clipboard file as Clipboard 2.txt", () => {
    expect(pastedTextFile("alpha\nbeta\ngamma", [CLIPBOARD_FILENAME]).name).toBe("Clipboard 2.txt");
  });

  it("uniques a second pasted image with the same filename", () => {
    const file = png("clip.png");
    const [second] = composerFilesFromClipboard(
      { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
      ["clip.png"],
    );
    expect(second?.name).toBe("clip 2.png");
  });
});
