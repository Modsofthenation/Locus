import { describe, expect, it } from "vitest";
import { LOCUS_CANVAS_CHANGED_ON_DISK } from "@locus/shared";
import {
  annotateCanvasChangedOnDisk,
  cursorCliToolCallOk,
  structuredToolFailure,
} from "./cursorCliToolStatus.js";

describe("annotateCanvasChangedOnDisk", () => {
  it("adds a Locus live-paint note without blaming a model Write", () => {
    const plain = "index.html changed on disk after this tool call read it. Nothing was written.";
    expect(annotateCanvasChangedOnDisk(plain)).toContain(LOCUS_CANVAS_CHANGED_ON_DISK);
    const json = annotateCanvasChangedOnDisk(
      JSON.stringify({
        error: "index.html changed on disk after this tool call read it.",
        modelVisibleError: "changed on disk",
      }),
    );
    expect(json).toContain(LOCUS_CANVAS_CHANGED_ON_DISK);
    expect(annotateCanvasChangedOnDisk("ok")).toBe("ok");
    expect(annotateCanvasChangedOnDisk(`${plain}\n${LOCUS_CANVAS_CHANGED_ON_DISK}`)).toBe(
      `${plain}\n${LOCUS_CANVAS_CHANGED_ON_DISK}`,
    );
  });
});

describe("cursorCliToolCallOk", () => {
  it("treats completed calls as ok unless the payload is a structured failure", () => {
    expect(cursorCliToolCallOk("running")).toBeUndefined();
    expect(cursorCliToolCallOk("completed")).toBe(true);
    expect(cursorCliToolCallOk("completed", '{"ok":false}')).toBe(false);
    expect(cursorCliToolCallOk("completed", "plain text")).toBe(true);
    expect(cursorCliToolCallOk("completed", '{"error":"failed to apply patch"}')).toBe(false);
    expect(cursorCliToolCallOk("completed", "failed to apply patch")).toBe(true);
  });
});

describe("structuredToolFailure", () => {
  it("detects nested error flags and nonzero exit codes", () => {
    expect(structuredToolFailure({ isError: true })).toBe(true);
    expect(structuredToolFailure({ result: { exitCode: 2 } })).toBe(true);
    expect(structuredToolFailure({ error: "failed to apply patch" })).toBe(true);
    expect(structuredToolFailure({ success: {}, error: "ignored" })).toBe(false);
    expect(structuredToolFailure({ ok: true })).toBe(false);
  });
});
