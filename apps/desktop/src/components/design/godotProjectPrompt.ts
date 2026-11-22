/** Godot workflows must modify real project files, never the HTML Games canvas. */
export function godotProjectPrompt(input: {
  action: "create" | "edit";
  request: string;
  projectPath?: string;
}): string {
  return [
    "LOCUS_GODOT_WORKFLOW: Work on a real Godot 4 project, not an HTML/Phaser/Three.js game.",
    input.action === "edit"
      ? "EDIT EXISTING: Confirm project.godot exists before any changes. Inspect its config_version, main scene, autoloads, renderer, plugins, scenes and script language. Preserve existing scene/node references, UIDs and .godot project conventions. Do not overwrite or recreate an existing project."
      : "CREATE PROJECT: Inspect the selected Host workspace. Create a clearly named child folder with project.godot, a playable main .tscn scene and GDScript scripts; never overwrite existing files. Run the installed Godot 4 editor headless import after creation. If Godot is unavailable, explain that verification has not run.",
    "Use GDScript and Godot 4 .tscn/.tres scenes and resources. If this is a C# Godot project, preserve its C#/.NET setup and require a .NET-capable Godot build; do not pretend GDScript checks validate C#.",
    "Godot Editor operations can execute project tool scripts/plugins on the Host: work with trusted projects only.",
    "Locus provides godot_editor and godot_result tools: inspect scenes, import/parse, run a bounded headless smoke test, create a scene, and export Web/Linux/Windows/macOS using existing export presets.",
    "For an autonomous loop: edit files, call godot_editor action=import, poll godot_result until done, inspect log errors, fix, then run smoke and export. Never claim an operation passed until its job result actually succeeds.",
    "Web export requires a configured Web preset in export_presets.cfg and installed templates; successful HTML5 exports appear as a playable sandboxed Games preview. This is not the native Godot Editor Game View.",
    "Treat .godot/ and .locus-godot/ as generated content; don't commit them. Keep existing project files, scene IDs and resources intact.",
    input.projectPath
      ? "Selected Host workspace: " + input.projectPath
      : "Use the selected Host workspace.",
    "User request: " +
      (input.request.trim() ||
        (input.action === "create"
          ? "Create a simple playable Godot 3D starter project."
          : "Inspect this project and propose safe improvements.")),
    "Summarize changed files, validation performed, any errors, and how to open in Godot Project Manager.",
  ].join("\n\n");
}
