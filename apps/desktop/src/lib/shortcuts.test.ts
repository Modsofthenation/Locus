import { describe, expect, it } from "vitest";
import {
  altKeyDisplay,
  SHORTCUTS,
  matchAltDigit,
  matchModDigit,
  matchModKey,
  shortcutDisplay,
  shortcutHint,
  shortcutKeys,
} from "./shortcuts";

describe("shortcuts", () => {
  it("keeps the cheat-sheet order and ids unique", () => {
    expect(SHORTCUTS.map((row) => row.keys)).toEqual([
      "Ctrl/Cmd+N",
      "Ctrl/Cmd+K",
      "Ctrl/Cmd+Shift+K",
      "Ctrl/Cmd+P",
      "Ctrl/Cmd+T",
      "Ctrl/Cmd+Shift+F",
      "Ctrl/Cmd+`",
      "Ctrl/Cmd+,",
      "Ctrl/Cmd+F",
      "Ctrl/Cmd+1–9",
      "Alt+1–9",
      "F12",
      "Alt+F12",
      "Ctrl/Cmd+.",
      "Ctrl/Cmd+W",
      "Ctrl/Cmd+\\",
      "Ctrl/Cmd+S",
      "Ctrl/Cmd+Shift+S",
      "Ctrl/Cmd+Z",
      "Ctrl/Cmd+Shift+Z",
      "F2",
      "Ctrl+Space",
      "Alt+Shift+F",
      "Tab then Enter",
      "R P D M",
      "V H N T R L F C",
      "Ctrl/Cmd+0",
      "Ctrl/Cmd+] [",
    ]);
    expect(new Set(SHORTCUTS.map((row) => row.id)).size).toBe(SHORTCUTS.length);
  });

  it("formats palette hints and per-platform labels", () => {
    expect(shortcutKeys("palette")).toBe("Ctrl/Cmd+K");
    expect(shortcutHint("new")).toBe("Ctrl/Cmd+N");
    expect(shortcutHint("new", "on Design")).toBe("Ctrl/Cmd+N on Design");
    expect(shortcutDisplay("Ctrl/Cmd+K", "MacIntel")).toBe("⌘+K");
    expect(shortcutDisplay("Ctrl/Cmd+K", "Linux x86_64")).toBe("Ctrl+K");
  });

  it("matches modifier chords", () => {
    expect(
      matchModKey({ key: "k", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, "k"),
    ).toBe(true);
    expect(
      matchModKey(
        { key: "k", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false },
        "k",
        true,
      ),
    ).toBe(true);
    expect(
      matchModKey({ key: "k", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, "k"),
    ).toBe(false);
    expect(
      matchModKey({ key: ",", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, ","),
    ).toBe(true);
    expect(
      matchModDigit({ key: "3", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }),
    ).toBe("3");
    expect(
      matchModDigit({ key: "0", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }),
    ).toBe(null);
    expect(
      matchAltDigit({ key: "2", altKey: true, metaKey: false, ctrlKey: false, shiftKey: false }),
    ).toBe("2");
    expect(
      matchAltDigit({ key: "2", altKey: true, metaKey: true, ctrlKey: false, shiftKey: false }),
    ).toBe(null);
  });
});

describe("altKeyDisplay", () => {
  it("uses the Option glyph on Mac and Alt+ elsewhere", () => {
    expect(altKeyDisplay("MacIntel")).toBe("⌥");
    expect(altKeyDisplay("Linux x86_64")).toBe("Alt+");
  });
});
