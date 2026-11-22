/** Unreal workflows edit a real Unreal Engine project, never the HTML Games canvas. */
export function unrealProjectPrompt(input: {
  action: "create" | "edit";
  request: string;
  projectPath?: string;
}): string {
  const task =
    input.request.trim() ||
    (input.action === "create"
      ? "Create a small playable Unreal Engine 5 starter project."
      : "Inspect the existing Unreal project and suggest a safe first improvement.");
  return [
    "LOCUS_UNREAL_WORKFLOW: Work on a real Unreal Engine project, not an HTML, Three.js or Phaser game. Do not write /workspace/index.html.",
    input.action === "edit"
      ? "EDIT EXISTING PROJECT: Confirm the selected folder contains exactly one .uproject. Call unreal_editor action=inspect first to learn its EngineAssociation, matching engine install, modules, plugins and maps. Preserve existing assets, redirectors, config and module names. Make focused changes and never regenerate or re-template the project."
      : 'CREATE NEW PROJECT: Inspect the workspace first and never overwrite an existing project. Create a clearly named child folder with a .uproject (EngineAssociation set to the installed engine version, e.g. "5.4"), Config/DefaultEngine.ini and DefaultGame.ini, and, for C++, Source/<Name>/ with <Name>.Build.cs plus <Name>.Target.cs and <Name>Editor.Target.cs. If no Unreal Engine install is found, report the missing prerequisite rather than pretending the project was verified.',
    ".uasset and .umap files are binary: never write or patch them as text. Build gameplay in C++ (UCLASS/UPROPERTY with the project's API macro) and create levels, actors and Blueprint assets with editor Python scripts (enable PythonScriptPlugin in the .uproject, keep scripts under Content/Python/, run them with unreal_editor action=python).",
    "Locus provides unreal_editor and unreal_result: inspect, compile (C++ editor target via UnrealBuildTool, then CompileAllBlueprints), test (automation tests, filter by test name), python (run a project .py in the editor) and package (BuildCookRun for windows/linux/macos). Logs, test reports and packaged builds are saved under .locus-unreal/runs/.",
    "Autonomous loop: edit source, call unreal_editor action=compile, poll unreal_result (waitMs=5000) until done, read errors, fix and retry; then run tests and package. Never claim a compile, test or package passed until its job result actually succeeds.",
    "Unreal Editor operations run project code and plugins on the Host: work with trusted projects only, and ask the user to close the interactive Unreal Editor while jobs run.",
    "Keep Binaries/, Intermediate/, Saved/, DerivedDataCache/ and .locus-unreal/ out of version control (add them to .gitignore). Do not expose project secrets.",
    input.projectPath?.trim()
      ? `Selected Host workspace: ${input.projectPath.trim()}`
      : "Use the selected Host workspace.",
    `User request: ${task}`,
    "Summarise changed files, validation performed, any remaining errors and how to open the project in Unreal Editor.",
  ].join("\n\n");
}
