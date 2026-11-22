# Native Blender support in Assets

Assets offers **Web asset** (the existing browser canvas) and **Blender** (a real local `.blend` workflow).

## Requirements

- Blender installed on the computer running the Locus Host server.
- The `blender` executable on `PATH`, or `LOCUS_BLENDER_PATH` pointing to the Blender executable.
- A **Host** workspace (local execution only). Remote workers, VM and Docker sessions cannot run native Blender jobs through these controls.

## Workflow

1. Open **Assets → Blender**.
2. Choose **Create .blend** or **Edit existing** and select a local Host workspace.
3. Describe the asset or change to make. Locus creates a Host coding session, not a browser canvas.
4. In the Blender panel enter a **workspace-relative** `.blend` path (for example `models/character.blend`).
5. Run **Create scene**, **Inspect scene**, **Validate assets**, **Render preview**, or **Export asset**.
6. For model changes, create a reviewed `.py` file under the workspace and run **Run script**. It executes as the local user after confirmation in the desktop panel.
7. Poll job status or use MCP `blender_editor` and `blender_result` for safe operations. Script execution is deliberately excluded from MCP; the operator must review the script and click **Run script** in the local panel. The panel displays job logs, inspection metadata and rendered PNGs.

Exports support **GLB, FBX, OBJ and STL**. Successful exports can be downloaded directly from the Blender panel. Generated files and previews remain in the Host workspace under `.locus-blender/runs/<job-id>/` until manually cleaned up. Add `.locus-blender/` and `*.blend1` to project `.gitignore`.

## Safety and limitations

Operations require a local Host Blender session, allow only workspace-relative project file paths, reject symlink path traversal, run one job per workspace, use explicit Blender process arguments (not a shell), and bound execution time. Blender starts with `--factory-startup --disable-autoexec`, so embedded autorun scripts are disabled. **Explicit Python script execution still runs local code with your account permissions**: only run scripts you trust. Blender is not sandboxed.

Existing `.blend` projects are opened rather than recreated; **Create scene refuses to overwrite files**. Asset rendering requires a configured camera, scene and render engine. External textures may be missing; Validate assets reports these. The browser does not offer a native interactive Blender 3D viewport; use Blender itself for interactive editing. Locus renders still PNG previews.

The integration has unit tests for path validation, session scoping and tool catalogs. End-to-end Blender renders and exports must be verified on a machine with Blender installed.
