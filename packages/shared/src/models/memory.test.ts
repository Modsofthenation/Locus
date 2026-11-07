import { describe, expect, it } from "vitest";
import {
  MAX_MEMORIES,
  applyRemember,
  formatAutomationMemoryPrompt,
  formatMemoriesPrompt,
  mergeMemoryPrompts,
  normalizeMemories,
  replaceMemoryText,
  sessionOffersRemember,
} from "./memory.js";

describe("applyRemember", () => {
  it("adds, lists, forgets, and clears facts", () => {
    const added = applyRemember([], { action: "add", text: "Uses Vite" }, { id: "m1" });
    expect(added.memories).toHaveLength(1);
    expect(added.output).toMatch(/Uses Vite/);
    expect(formatMemoriesPrompt(added.memories)).toMatch(/Uses Vite/);

    const listed = applyRemember(added.memories, { action: "list" });
    expect(listed.output).toMatch(/Uses Vite/);

    const forgot = applyRemember(added.memories, { action: "forget", id: "m1" });
    expect(forgot.memories).toEqual([]);
    expect(forgot.output).toMatch(/Forgot: Uses Vite/);

    const cleared = applyRemember(added.memories, { action: "clear" });
    expect(cleared.memories).toEqual([]);
  });

  it("rejects blank add, skips duplicates, and drops the oldest at the cap", () => {
    expect(applyRemember([], { action: "add" }).output).toMatch(/text is required/);
    const first = applyRemember([], { action: "add", text: "Uses Vite" }, { id: "m1" });
    const again = applyRemember(first.memories, { action: "add", text: "Uses Vite" }, { id: "m2" });
    expect(again.memories).toHaveLength(1);
    expect(again.output).toMatch(/already saved/);

    let memories = first.memories;
    for (let i = 0; i < MAX_MEMORIES; i += 1) {
      memories = applyRemember(
        memories,
        { action: "add", text: `fact ${i}` },
        { id: `n${i}` },
      ).memories;
    }
    expect(memories).toHaveLength(MAX_MEMORIES);
    expect(memories[0]?.text).toBe("fact 0");
    expect(memories.at(-1)?.text).toBe(`fact ${MAX_MEMORIES - 1}`);
  });

  it("formats automation memory with a remember hint", () => {
    expect(formatAutomationMemoryPrompt([])).toMatch(/No saved facts/);
    expect(formatAutomationMemoryPrompt([])).toMatch(/Call remember/);
    expect(mergeMemoryPrompts("Workspace note", formatAutomationMemoryPrompt([]))).toMatch(
      /Workspace note[\s\S]*Call remember/,
    );
    expect(normalizeMemories([{ id: "x", text: "  " }])).toEqual([]);
  });

  it("refuses to store tokens and assigned secrets", () => {
    expect(
      applyRemember([], { action: "add", text: "token: sk-live-abcdefghijklmnopqrstuvwxyz" })
        .output,
    ).toMatch(/Refusing to store a secret/);
    expect(
      applyRemember([], {
        action: "add",
        text: "ghp_abcdefghijklmnopqrstuvwxyzABCD",
      }).memories,
    ).toEqual([]);
    expect(applyRemember([], { action: "add", text: "Uses Vite" }).memories).toHaveLength(1);
  });

  it("edits a saved fact in place", () => {
    const added = applyRemember([], { action: "add", text: "Uses Vite" }, { id: "m1" });
    const updated = replaceMemoryText(added.memories, "m1", "Uses Vite and React");
    expect(updated.memories).toEqual([
      expect.objectContaining({ id: "m1", text: "Uses Vite and React" }),
    ]);
    expect(replaceMemoryText(added.memories, "missing", "nope").output).toMatch(/No matching fact/);
    expect(
      replaceMemoryText(added.memories, "m1", "token: sk-live-abcdefghijklmnopqrstuvwxyz").output,
    ).toMatch(/Refusing to store a secret/);
  });
});

describe("sessionOffersRemember", () => {
  it("offers workspace memory on coding docker/host, not VM, design, or review", () => {
    expect(sessionOffersRemember({ runtime: "docker" })).toBe(true);
    expect(sessionOffersRemember({ runtime: "host" })).toBe(true);
    expect(sessionOffersRemember({})).toBe(true);
    expect(sessionOffersRemember({ runtime: "vm" })).toBe(false);
    expect(sessionOffersRemember({ kind: "design", runtime: "docker" })).toBe(false);
    expect(sessionOffersRemember({ kind: "game", runtime: "docker" })).toBe(false);
    expect(sessionOffersRemember({ kind: "assets", runtime: "docker" })).toBe(false);
    expect(sessionOffersRemember({ kind: "review", runtime: "docker" })).toBe(false);
    expect(sessionOffersRemember({ kind: "setup", runtime: "docker" })).toBe(false);
    expect(sessionOffersRemember({ kind: "project", runtime: "host" })).toBe(false);
  });

  it("gates automations on persistMemory", () => {
    expect(sessionOffersRemember({ automationId: "job", persistMemory: true })).toBe(true);
    expect(sessionOffersRemember({ automationId: "job", persistMemory: false })).toBe(false);
    expect(sessionOffersRemember({ automationId: "job" })).toBe(false);
  });
});
