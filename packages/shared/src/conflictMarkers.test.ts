import { describe, expect, it } from "vitest";
import { hasConflictMarkers, resolveConflictMarkers } from "./conflictMarkers.js";

const sample = [
  "keep",
  "<<<<<<< HEAD",
  "ours-a",
  "=======",
  "theirs-a",
  ">>>>>>> topic",
  "mid",
  "<<<<<<< HEAD",
  "ours-b",
  "=======",
  "theirs-b",
  ">>>>>>> topic",
  "end",
  "",
].join("\n");

describe("conflictMarkers", () => {
  it("detects and resolves ours vs theirs", () => {
    expect(hasConflictMarkers(sample)).toBe(true);
    expect(hasConflictMarkers("plain")).toBe(false);
    expect(resolveConflictMarkers(sample, "ours")).toBe("keep\nours-a\nmid\nours-b\nend\n");
    expect(resolveConflictMarkers(sample, "theirs")).toBe("keep\ntheirs-a\nmid\ntheirs-b\nend\n");
  });
});
