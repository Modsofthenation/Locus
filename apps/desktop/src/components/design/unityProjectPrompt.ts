/** Unity flows use a coding agent rather than the HTML-only Games canvas. */
export function unityProjectPrompt(input: {
  action: "create" | "edit";
  request: string;
  projectPath?: string;
}): string {
  const task =
    input.request.trim() ||
    (input.action === "create"
      ? "Create a small playable Unity 3D starter project."
      : "Inspect the existing Unity project and suggest a safe first improvement.");
  return [
    "Work on a real Unity 3D project, not an HTML, Three.js or Phaser game. Do not write /workspace/index.html.",
    "Use Unity C# scripts, scenes, prefabs, ScriptableObjects, materials and Unity project files.",
    input.action === "edit"
      ? "EDIT EXISTING PROJECT: Verify Assets/, Packages/manifest.json and ProjectSettings/ProjectVersion.txt exist in the selected folder. If not, stop and explain what folder to select. Inspect the Unity version, project packages, scenes and input/render pipelines. Preserve GUIDs and .meta files, serialized references and unrelated assets. Make focused changes and never reinitialize this project."
      : "CREATE NEW PROJECT: Inspect the workspace first and never overwrite an existing project. Find a compatible installed Unity Editor/Unity Hub, then use its supported -batchmode -createProject workflow to initialize a clearly named child folder. If Unity isn't installed, report the missing prerequisite rather than inventing a complete Unity project or editor-generated metadata. After initialization implement a playable 3D scene and controls.",
    "Use editor-supported scene/prefab modifications, e.g. temporary Assets/Editor scripts, rather than editing serialized Unity YAML directly when possible.",
    "Run -batchmode -nographics -projectPath ... -quit where an installed Unity Editor allows import/compile checks. Report the actual editor version, log output, errors and checks performed; never claim compilation, playtesting or build success without running Unity.",
    "Do not remove existing Library, Temp, Obj or unrelated files. Keep .meta files tracked; exclude Library and generated output from commits. Do not expose project secrets.",
    "Locus exposes Unity Editor actions in this chat: Inspect scenes, Create scene, Compile/import, PlayMode tests, Capture scene and Build player. They run a separate Unity Editor batch process and save logs, reports, screenshots and builds under .locus-unity/runs/. Inspect those results before claiming success. Include .locus-unity/ in the project gitignore.",
    input.projectPath?.trim()
      ? `Selected Host workspace: ${input.projectPath.trim()}`
      : "Use the selected Host workspace.",
    `User request: ${task}`,
    "Summarise changed files, steps to open in Unity Hub and any remaining validation.",
  ].join("\n\n");
}
