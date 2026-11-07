import { describe, expect, it } from "vitest";
import {
  applyComposerChipKey,
  applyComposerPaste,
  fileForPasteChip,
  highlightPasteChips,
  leftoverAttachChips,
  pastePreviewText,
  pointInRects,
  splitComposerFiles,
} from "./composerPaste";

function png(name: string) {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

describe("composer clipboard paste", () => {
  it("inserts a chip at the caret and keeps later text after it", () => {
    const image = png("clip.png");
    const next = applyComposerPaste("Look at  please", 8, [], [image]);
    expect(next.text).toBe("Look at [[paste:clip.png]]  please");
    expect(next.cursor).toBe(27);
    expect(next.files).toEqual([image]);
  });

  it("replaces the selected range with the pasted chip", () => {
    const image = png("clip.png");
    const next = applyComposerPaste("Look at this please", 8, [], [image], 12);
    expect(next.text).toBe("Look at [[paste:clip.png]]  please");
    expect(next.cursor).toBe(27);
  });

  it("uniques a second image pasted with the same name", () => {
    const first = png("clip.png");
    const second = new File([new Uint8Array([1, 2, 3])], "clip.png", { type: "image/png" });
    const next = applyComposerPaste("[[paste:clip.png]]  here", 19, [first], [second]);
    expect(next.files[1]?.name).toBe("clip 2.png");
    expect(next.text).toBe("[[paste:clip.png]] [[paste:clip 2.png]]  here");
  });

  it("keeps +/dropped files on the bar and clipboard files inline", () => {
    const clip = png("clip.png");
    const note = new File(["hi"], "note.txt", { type: "text/plain" });
    const split = splitComposerFiles("See [[paste:clip.png]]", [clip, note]);
    expect(split.inline).toEqual([clip]);
    expect(split.bar).toEqual([note]);
  });

  it("backspaces a clipboard chip as one token", () => {
    const image = png("clip.png");
    const next = applyComposerChipKey("Backspace", "See [[paste:clip.png]] now", 22, [image]);
    expect(next?.text).toBe("See  now");
    expect(next?.files).toEqual([]);
  });

  it("removes the matching file when two chips share a name", () => {
    const first = png("clip.png");
    const second = new File([new Uint8Array([1, 2, 3])], "clip.png", { type: "image/png" });
    const text = "[[paste:clip.png]] [[paste:clip.png]] ";
    const next = applyComposerChipKey("Backspace", text, 35, [first, second]);
    expect(next?.files).toEqual([first]);
    expect(next?.text).toBe("[[paste:clip.png]]  ");
  });

  it("highlights chip tokens without interpreting markup", () => {
    expect(highlightPasteChips("See [[paste:clip.png]] <ok>")).toContain(
      'data-testid="composer-paste-chip"',
    );
    expect(highlightPasteChips("See [[paste:clip.png]] <ok>")).toContain("&lt;ok&gt;");
    expect(highlightPasteChips("See [[paste:clip.png]] <ok>")).toContain(
      'data-paste-name="clip.png"',
    );
  });

  it("resolves a paste chip to the matching file by occurrence", () => {
    const first = png("clip.png");
    const second = png("clip.png");
    expect(fileForPasteChip([first, second], "clip.png", 0)).toBe(first);
    expect(fileForPasteChip([first, second], "clip.png", 1)).toBe(second);
    expect(fileForPasteChip([first], "missing.png", 0)).toBeUndefined();
  });

  it("hit-tests a point against chip rects", () => {
    expect(pointInRects([{ left: 8, top: 4, right: 40, bottom: 18 }], 12, 10)).toBe(true);
    expect(pointInRects([{ left: 8, top: 4, right: 40, bottom: 18 }], 50, 10)).toBe(false);
  });

  it("truncates a long clipboard preview", () => {
    expect(pastePreviewText("short")).toBe("short");
    expect(pastePreviewText("x".repeat(12), 8)).toBe(`${"x".repeat(8)}\n…`);
  });

  it("hides leftover attach chips when the file is already inline", () => {
    expect(
      leftoverAttachChips("Look at clip.png at /workspace/.locus-attachments/clip.png", [
        { name: "clip.png", storedName: "clip.png" },
        { name: "notes.md", storedName: "notes.md" },
      ]),
    ).toEqual([{ name: "notes.md", storedName: "notes.md" }]);
  });
});
