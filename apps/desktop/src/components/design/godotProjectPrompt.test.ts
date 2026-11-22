import { describe, expect, it } from "vitest";
import { godotProjectPrompt } from "./godotProjectPrompt";
describe("godotProjectPrompt", () => {
  it("guards existing projects", () => {
    const p = godotProjectPrompt({
      action: "edit",
      request: "Add jumping",
      projectPath: "/games/Runner",
    });
    expect(p).toContain("project.godot");
    expect(p).toContain("Preserve existing scene/node references");
    expect(p).toContain("/games/Runner");
    expect(p).toContain("Add jumping");
  });
  it("requires truthful editor validation and real Godot files", () => {
    const p = godotProjectPrompt({ action: "create", request: "" });
    expect(p).toContain("Godot 4");
    expect(p).toContain("godot_editor");
    expect(p).toContain("never overwrite");
    expect(p).toContain("simple playable Godot 3D");
  });
});
