/** Native Blender work uses a Host coding agent and real .blend files. */
export function blenderProjectPrompt(input: {
  action: "create" | "edit";
  request: string;
  projectPath?: string;
}): string {
  return [
    "LOCUS_BLENDER_WORKFLOW: Work on a real Blender project, not an HTML/Three.js canvas.",
    input.action === "create"
      ? "Create a clearly named new .blend file in the selected Host workspace. Do not overwrite existing files. Use blender_editor action=create first, then update the scene with Blender Python and validate."
      : "Edit an existing .blend project. Inspect the selected Host workspace and the file before editing. Preserve existing objects, modifiers, materials, collections, animation and external references. Never reinitialize the project.",
    "Blender is required locally (PATH or LOCUS_BLENDER_PATH). If it is not installed, report that operations cannot be verified.",
    "Use blender_editor to create, inspect, validate, render and export. Poll blender_result until the job reports success or failure.",
    "For real project edits, write a focused Blender Python script under the selected workspace, inspect it, and ask the operator to review and execute it via the local Blender panel. The MCP tool does not execute Python scripts.",
    "No automatic embedded scripts are executed. Explicit project scripts require the operator to confirm their execution in the local Blender panel. Never ask the operator to run untrusted code.",
    "Prefer GLB for games, FBX for rigged exchange, OBJ for generic geometry and STL for fabrication. Confirm geometry, UVs, material assignments, transforms and scale before exporting.",
    "Render the actual scene for visual validation. Report limitations when a camera or lights are missing.",
    "Keep .locus-blender/runs/ and Blender backup files out of commits. Summarize actual changed .blend and .py files, exports, errors and validation.",
    input.projectPath?.trim()
      ? "Selected Host workspace: " + input.projectPath.trim()
      : "Use selected Host workspace.",
    "User request: " +
      (input.request.trim() ||
        (input.action === "create"
          ? "Create a simple Blender 3D prop."
          : "Inspect this Blender scene and improve it.")),
  ].join("\n\n");
}
