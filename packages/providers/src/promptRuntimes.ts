import type { AgentRuntime, SessionKind } from "@locus/shared";
import { CODING_LOOP_HABIT, sessionKind } from "@locus/shared";

export type PromptRuntime =
  "design" | "game" | "assets" | "board" | "project" | "host" | "docker" | "vm";

export function promptRuntime(input: {
  runtime?: AgentRuntime;
  kind?: SessionKind;
}): PromptRuntime {
  if (sessionKind(input) === "design") return "design";
  if (sessionKind(input) === "game") return "game";
  if (sessionKind(input) === "assets") return "assets";
  if (sessionKind(input) === "board") return "board";
  if (sessionKind(input) === "project") return "project";
  if (input.runtime === "host") return "host";
  if (input.runtime === "docker") return "docker";
  return "vm";
}

export function machineLabel(
  runtime: PromptRuntime,
  opts?: { agentRuntime?: AgentRuntime },
): "host" | "container" | "guest VM" {
  if (
    (runtime === "design" || runtime === "game" || runtime === "assets") &&
    opts?.agentRuntime === "host"
  )
    return "host";
  if (runtime === "host" || runtime === "board" || runtime === "project") return "host";
  if (runtime === "docker" || runtime === "design" || runtime === "game" || runtime === "assets")
    return "container";
  return "guest VM";
}

export function promptIdentity(runtime: PromptRuntime): string {
  if (runtime === "design") {
    return "You are Locus Design. Chat is on the left; a live canvas on the right renders /workspace/index.html.";
  }
  if (runtime === "game") {
    return "You are Locus Games. Chat is on the left; a live playable canvas on the right renders /workspace/index.html.";
  }
  if (runtime === "assets") {
    return "You are Locus Assets. Chat is on the left; a live 2D/3D studio on the right renders /workspace/index.html.";
  }
  if (runtime === "board") {
    return "You are Locus Board. The operator is looking at a planning canvas. Chat is a right rail; the board is the work.";
  }
  if (runtime === "project") {
    return "You are a Locus Project coordinator. You direct other agents. You do not write application code.";
  }
  if (runtime === "host") {
    return "You are Locus, a local coding agent on this machine. There is no VM or Docker container.";
  }
  if (runtime === "docker") {
    return "You are Locus, a local coding agent that works inside a dedicated Docker container.";
  }
  return "You are Locus, a local coding agent that works inside a dedicated guest VM.";
}

export function promptWorkspace(
  runtime: PromptRuntime,
  opts: { dockerImage?: string; osLabel: string },
): string {
  if (runtime === "design") {
    const where = opts.dockerImage
      ? `Container image: ${opts.dockerImage}.`
      : "Workspace: /workspace on this machine's disk.";
    return `${where} Always write a complete, self-contained HTML document to /workspace/index.html (inline CSS and JavaScript, no external CDNs). The preview only renders that file — never split the page into parts/ or other scripts. Finish with </html> in the same file_write; keep the first draft small enough to complete (a short playable loop for games), then iterate with apply_patch. Write a first full-page draft as soon as the layout exists, then iterate in place so the canvas paints while you stream.`;
  }
  if (runtime === "game") {
    const where = opts.dockerImage
      ? `Container image: ${opts.dockerImage}.`
      : "Workspace: /workspace on this machine's disk.";
    return `${where} Always write a complete, self-contained playable HTML game to /workspace/index.html (inline CSS and JavaScript, no external CDNs). The first draft must be playable: input, a game loop, and a win/lose or score. Finish with </html> in the same file_write; keep that first loop small enough to complete, then iterate juice and levels with apply_patch. If you vendor ES modules, call preview with no port so the folder is served over HTTP. If /workspace/vendor/assets/index.json exists, load those linked operator assets as the real sprites/meshes — do not redraw them. Write a first playable as soon as the loop exists, then iterate in place so the canvas paints while you stream.`;
  }
  if (runtime === "assets") {
    const where = opts.dockerImage
      ? `Container image: ${opts.dockerImage}.`
      : "Workspace: /workspace on this machine's disk.";
    return `${where} Always write a complete, self-contained HTML asset studio to /workspace/index.html (inline CSS and JavaScript, no external CDNs). The first draft must show a 2D sprite/cutout or a 3D mesh with orbit — CSS preserve-3d is not wired 3D. Pipeline: punch out the photo backdrop → silhouette hull → albedo on the subject only → rig. Prefer ./vendor/reconstruct.js (reconstructFromPhoto) when ./source.png exists; do not billboard the whole photo. Finish with </html> in the same file_write; keep that first studio small enough to complete, then iterate texture, topology, and rig with apply_patch. Relative photos (./source.png, ./source-side.png, ./source-back.png) taint getImageData in the unique-origin iframe — set img.crossOrigin='anonymous'; canvas-files HTTP is automatic for relative photos and vendored modules. Do not call preview or search MCP for it. Map attached photos as ./source.png (front) plus side/back files when present. Write a first viewable asset as soon as the mesh or sprite exists, then iterate in place so the canvas paints while you stream.`;
  }
  if (runtime === "board") {
    return "There is no guest workspace. Use board_get, board_upsert, board_delete, board_comment, and board_cluster. Stickies, frames, shapes, connectors, cards, tables, timelines, and ink are the write target. Cluster selected stickies with one board_cluster call. Stickies that share stackId form a deck. When Miro is connected, miro_list / miro_get / miro_import / miro_export copy between canvases. When Figma is connected, figma_list / figma_get / figma_images read a file. Do not write HTML files.";
  }
  if (runtime === "project") {
    return "There is no guest workspace. Use project_get, project_spawn, project_steer, project_stop, project_collect, and project_context_*. Write notes into the project context tree. Never apply_patch, exec, git_push, or open a PR yourself. Spawn returns a member id immediately; the child runs on its own.";
  }
  if (runtime === "host") {
    return "Workspace: /workspace on this machine's disk. Use exec, file_read, file_write, file_list, grep, glob, apply_patch, git, and Chrome (isolated host-chrome, or the operator's real tabs when Use my Chrome is on).";
  }
  if (runtime === "docker") {
    return `Container image: ${opts.dockerImage ?? "unspecified"}. Workspace: /workspace.`;
  }
  return `Guest OS: ${opts.osLabel}.`;
}

/** Shared apply_patch / grep / git habits. Runtime adapters add desktop or Chromium notes around this. */
export function workspaceToolingRules(): string {
  return [
    "Prefer grep, glob, and file_read over dumping whole files. grep already returns 3 lines of context — do not file_read every hit. file_read accepts paths[] for several files in one call. Prefer apply_patch with a unified diff instead of rewriting whole files. Prefer git_diff before git_commit / git_push. The repo map in this prompt lists likely files first; start there, or call repo_map with query to zoom in. Keep the plan in task_list, and put durable notes in scratchpad. After a compact note, do not re-read listed files unless you need a specific line range — continue from the scratchpad. If you already know the edit, call apply_patch or file_write; do not spend more rounds on exec grep/sed/cat of those files. Do not spend a round only updating task_list once the plan is written. spawn_agent is for bounded research and returns a summary, not a transcript.",
    "Independent reads belong in one turn: emit several tool calls together, or one exec with commands[] (git show a, git show b, git grep). Do not spend a round on a single git show or git grep when more reads are already known.",
    "commands[] is for short independent reads. Do not put heredocs (<<EOF) in commands[] — use command, or file_write a script then exec it. Do not edit source with sed -i or python string replace; use apply_patch, or file_write the whole file if the patch fails. Delete leftover .orig/.rej. Put remaining lint findings in scratchpad. Do not pipe checks through tail — that hides the real exit code.",
    CODING_LOOP_HABIT,
  ].join("\n");
}
