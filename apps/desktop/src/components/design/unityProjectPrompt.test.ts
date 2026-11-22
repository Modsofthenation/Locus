import { describe, expect, it } from "vitest";
import { unityProjectPrompt } from "./unityProjectPrompt";

describe("unityProjectPrompt", () => {
  it("guards existing projects", () => {
    const value = unityProjectPrompt({
      action: "edit",
      request: "Add jumping",
      projectPath: "/games/Runner",
    });
    expect(value).toContain("ProjectSettings/ProjectVersion.txt");
    expect(value).toContain("Preserve GUIDs and .meta files");
    expect(value).toContain("Add jumping");
    expect(value).toContain("/games/Runner");
    expect(value).not.toContain("CREATE NEW PROJECT:");
  });
  it("does not pretend Unity can be created or tested without an editor", () => {
    const value = unityProjectPrompt({ action: "create", request: "" });
    expect(value).toContain("-createProject");
    expect(value).toContain("If Unity isn't installed");
    expect(value).toContain("never claim compilation");
    expect(value).toContain("small playable Unity 3D starter");
  });
});
