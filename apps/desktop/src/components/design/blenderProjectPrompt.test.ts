import { describe, expect, it } from "vitest";
import { blenderProjectPrompt } from "./blenderProjectPrompt";

describe("Blender project instructions", () => {
  it("uses Blender rather than a browser canvas", () => {
    const text = blenderProjectPrompt({
      action: "create",
      request: "Make a chair",
      projectPath: "/tmp/assets",
    });
    expect(text).toContain("LOCUS_BLENDER_WORKFLOW");
    expect(text).toContain("Make a chair");
    expect(text).toContain("action=create");
    expect(text).toContain("/tmp/assets");
  });
  it("preserves existing scene data on edit", () => {
    expect(blenderProjectPrompt({ action: "edit", request: "Fix UVs" })).toContain(
      "Preserve existing objects",
    );
  });
});
