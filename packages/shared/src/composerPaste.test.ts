import { describe, expect, it } from "vitest";
import {
  deletePasteChipAt,
  insertPasteChips,
  movePasteChipCaret,
  pasteChipNames,
  pasteChipPromptMatches,
  pasteChipToken,
  sanitizePasteChipName,
  snapPasteChipCaret,
  snapPasteChipSelection,
  uniquePasteChipName,
} from "./composerPaste.js";

describe("composer paste chips", () => {
  it("sanitizes brackets out of the chip name", () => {
    expect(sanitizePasteChipName("clip[1].png")).toBe("clip1.png");
    expect(sanitizePasteChipName("")).toBe("pasted");
    expect(pasteChipToken("clip.png")).toBe("[[paste:clip.png]]");
  });

  it("uniques a second paste of the same filename", () => {
    expect(uniquePasteChipName("clip.png", [])).toBe("clip.png");
    expect(uniquePasteChipName("clip.png", ["clip.png"])).toBe("clip 2.png");
    expect(uniquePasteChipName("clip.png", ["clip.png", "clip 2.png"])).toBe("clip 3.png");
  });

  it("inserts chips at the caret so later text stays after them", () => {
    expect(insertPasteChips("Look at  please", 8, ["clip.png"])).toEqual({
      text: "Look at [[paste:clip.png]]  please",
      cursor: 27,
    });
    expect(insertPasteChips("before", 6, ["a.png", "b.png"])).toEqual({
      text: "before\n[[paste:a.png]] [[paste:b.png]] ",
      cursor: 39,
    });
    expect(insertPasteChips("canvas", 6, ["image.png"])).toEqual({
      text: "canvas\n[[paste:image.png]] ",
      cursor: 27,
    });
  });

  it("replaces the selected range when inserting a chip", () => {
    expect(insertPasteChips("Look at this please", 8, ["clip.png"], 12)).toEqual({
      text: "Look at [[paste:clip.png]]  please",
      cursor: 27,
    });
  });

  it("keeps the caret and selection off the interior of a chip", () => {
    const text = "See [[paste:clip.png]] now";
    expect(snapPasteChipCaret(text, 10)).toBe(4);
    expect(snapPasteChipCaret(text, 18)).toBe(22);
    expect(snapPasteChipCaret(text, 4)).toBe(4);
    expect(snapPasteChipCaret(text, 22)).toBe(22);
    expect(snapPasteChipSelection(text, 10, 10)).toEqual({ start: 4, end: 4 });
    expect(snapPasteChipSelection(text, 8, 14)).toEqual({ start: 4, end: 22 });
    expect(movePasteChipCaret(text, 22, "backward")).toBe(4);
    expect(movePasteChipCaret(text, 4, "forward")).toBe(22);
    expect(movePasteChipCaret(text, 0, "forward")).toBeNull();
  });

  it("lists chip names in document order", () => {
    expect(pasteChipNames("See [[paste:a.png]] then [[paste:b.png]]")).toEqual(["a.png", "b.png"]);
    expect(pasteChipNames("no chips")).toEqual([]);
  });

  it("deletes a chip as one token on backspace or delete", () => {
    const text = "See [[paste:clip.png]] now";
    expect(deletePasteChipAt(text, 22, "backward")).toEqual({
      text: "See  now",
      cursor: 4,
      start: 4,
      name: "clip.png",
    });
    expect(deletePasteChipAt(text, 4, "forward")).toEqual({
      text: "See  now",
      cursor: 4,
      start: 4,
      name: "clip.png",
    });
    expect(deletePasteChipAt(text, 4, "backward")).toBeNull();
    expect(deletePasteChipAt(text, 22, "forward")).toBeNull();
  });

  it("matches a sent chip prompt to the interpolated persisted message", () => {
    expect(
      pasteChipPromptMatches(
        "Look at [[paste:clip.png]] please",
        "Look at clip.png at /workspace/.locus-attachments/clip.png please",
      ),
    ).toBe(true);
    expect(
      pasteChipPromptMatches(
        "See [[paste:Clipboard 2.txt]]",
        "See Clipboard 2.txt at /workspace/.locus-attachments/Clipboard 2.txt",
      ),
    ).toBe(true);
    expect(pasteChipPromptMatches("Look at [[paste:clip.png]] please", "hello")).toBe(false);
    expect(
      pasteChipPromptMatches(
        "canvas[[paste:image.png]]",
        "canvas\nimage.png at /workspace/.locus-attachments/image.png",
      ),
    ).toBe(true);
  });
});
