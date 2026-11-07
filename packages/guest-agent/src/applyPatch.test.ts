import { describe, expect, it } from "vitest";
import { applyGuestPatch, PATCH_REQUIRED } from "./applyPatch.js";

function memoryStore(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    isFile: (path: string) => files.has(path),
    read: async (path: string) => ({ content: files.get(path) }),
    write: async (path: string, content: string) => {
      files.set(path, content);
    },
    remove: async (path: string) => {
      files.delete(path);
    },
  };
}

describe("applyGuestPatch", () => {
  it("rejects an empty patch", async () => {
    const store = memoryStore();
    await expect(
      applyGuestPatch({
        patch: "  ",
        requestedCwd: "/workspace",
        workspace: "/workspace",
        ...store,
      }),
    ).resolves.toEqual({ ok: false, output: PATCH_REQUIRED });
  });

  it("rejects a patch with no hunks", async () => {
    const store = memoryStore();
    const result = await applyGuestPatch({
      patch: "not a diff",
      requestedCwd: "/workspace",
      workspace: "/workspace",
      ...store,
    });
    expect(result?.ok).toBe(false);
    expect(result?.output).toMatch(/did not contain any file hunks/);
  });

  it("adds, updates, and deletes files through the store", async () => {
    const store = memoryStore({ "/workspace/a.ts": "old\n", "/workspace/gone.ts": "bye\n" });
    const patch = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      "diff --git a/b.ts b/b.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/b.ts",
      "@@ -0,0 +1 @@",
      "+hello",
    ].join("\n");
    const result = await applyGuestPatch({
      patch,
      requestedCwd: "/workspace",
      workspace: "/workspace",
      ...store,
    });
    expect(result?.ok).toBe(true);
    expect(store.files.get("/workspace/a.ts")).toBe("new\n");
    expect(store.files.has("/workspace/gone.ts")).toBe(false);
    expect(store.files.get("/workspace/b.ts")).toBe("hello\n");
  });

  it("aborts when the store cannot map a path", async () => {
    const result = await applyGuestPatch({
      patch: "--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n",
      requestedCwd: "/workspace",
      workspace: "/workspace",
      isFile: () => false,
      read: async () => ({ abort: true }),
      write: async () => undefined,
      remove: async () => undefined,
    });
    expect(result).toBeUndefined();
  });

  it("returns a write failure instead of throwing", async () => {
    const result = await applyGuestPatch({
      patch: "--- /dev/null\n+++ b/a.ts\n@@ -0,0 +1,1 @@\n+hi\n",
      requestedCwd: "/workspace",
      workspace: "/workspace",
      isFile: () => false,
      read: async () => ({ content: undefined }),
      write: async () => ({ ok: false, output: "path is outside /workspace: /workspace/a.ts" }),
      remove: async () => undefined,
    });
    expect(result).toEqual({
      ok: false,
      output: "path is outside /workspace: /workspace/a.ts",
    });
  });
});
