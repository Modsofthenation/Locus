import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentSession } from "@locus/shared";
import {
  activateDesignVariant,
  diskDesignFiles,
  registerVariantHtml,
  snapshotDesignVariant,
} from "./designVariants.js";

function session(partial: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "d1",
    title: "Landing",
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    kind: "design",
    runtime: "docker",
    providerId: "p",
    model: "m",
    status: "idle",
    messages: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("design variants", () => {
  it("snapshots and activates canvas HTML", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-var-"));
    await writeFile(join(dir, "index.html"), "<h1>A</h1>\n");
    const created = await snapshotDesignVariant(diskDesignFiles(dir), session(), "Hero");
    expect(created.variants).toHaveLength(1);
    expect(created.variants[0]?.name).toBe("Hero");
    expect(
      await readFile(join(dir, ".locus-variants", `${created.variants[0]!.id}.html`), "utf8"),
    ).toContain("A");
    await writeFile(join(dir, "index.html"), "<h1>B</h1>\n");
    await activateDesignVariant(
      diskDesignFiles(dir),
      session({ designVariants: created.variants }),
      created.variants[0]!.id,
    );
    expect(await readFile(join(dir, "index.html"), "utf8")).toContain("A");
  });

  it("registers explored direction HTML without emptying the live canvas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-var-dir-"));
    await writeFile(join(dir, "index.html"), "<h1>Live</h1>\n");
    const files = diskDesignFiles(dir);
    const registered = await registerVariantHtml(
      files,
      session(),
      "<h1>Direction A</h1>\n",
      "Direction 1",
      "direction-1",
    );
    expect(registered.variants[0]).toEqual({ id: "direction-1", name: "Direction 1" });
    expect(await readFile(join(dir, ".locus-variants", "direction-1.html"), "utf8")).toContain(
      "Direction A",
    );
    expect(await readFile(join(dir, "index.html"), "utf8")).toContain("Live");
  });

  it("overwrites a reserved id without changing the live canvas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-var-keep-"));
    await writeFile(join(dir, "index.html"), "<h1>Live</h1>\n");
    const files = diskDesignFiles(dir);
    const first = await snapshotDesignVariant(files, session(), "Before generate", {
      id: "undo",
      keepActive: true,
    });
    expect(first.variants[0]).toEqual({ id: "undo", name: "Before generate" });
    expect(first.activeVariantId).toBeUndefined();
    await writeFile(join(dir, "index.html"), "<h1>Next</h1>\n");
    const again = await snapshotDesignVariant(
      files,
      session({ designVariants: first.variants }),
      "Before generate",
      { id: "undo", keepActive: true },
    );
    expect(again.variants).toHaveLength(1);
    expect(await readFile(join(dir, ".locus-variants", "undo.html"), "utf8")).toContain("Next");
    expect(await readFile(join(dir, "index.html"), "utf8")).toContain("Next");
  });

  it("refuses an empty canvas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-var-empty-"));
    await expect(snapshotDesignVariant(diskDesignFiles(dir), session(), "Empty")).rejects.toThrow(
      /empty/,
    );
  });
});
