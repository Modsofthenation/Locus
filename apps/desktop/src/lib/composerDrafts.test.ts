import { afterEach, describe, expect, it } from "vitest";
import {
  clearAllComposerDrafts,
  clearComposerDraft,
  composerDraftKey,
  loadComposerDraft,
  readLiveComposerDraft,
  resetComposerDrafts,
  saveComposerDraft,
  writeLiveComposerDraft,
} from "./composerDrafts";

describe("composerDrafts", () => {
  afterEach(() => {
    localStorage.removeItem(composerDraftKey("s1"));
  });

  it("round-trips text and clears empty drafts", () => {
    saveComposerDraft("s1", "  hello  ");
    expect(loadComposerDraft("s1")).toBe("  hello  ");
    saveComposerDraft("s1", "   ");
    expect(loadComposerDraft("s1")).toBe("");
    saveComposerDraft("s1", "keep");
    clearComposerDraft("s1");
    expect(loadComposerDraft("s1")).toBe("");
    saveComposerDraft("s1", "again");
    clearAllComposerDrafts();
    expect(loadComposerDraft("s1")).toBe("");
  });

  it("keeps live files in memory and text on disk", () => {
    const file = new File(["a"], "a.txt");
    writeLiveComposerDraft("s1", { text: "draft", files: [file] }, "keep");
    expect(readLiveComposerDraft("s1")).toEqual({ text: "draft", files: [file] });
    expect(loadComposerDraft("s1")).toBe("draft");
    resetComposerDrafts();
    expect(readLiveComposerDraft("s1")).toEqual({ text: "", files: [] });
  });
});
