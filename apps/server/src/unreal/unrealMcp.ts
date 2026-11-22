import type { LocusMcpTool } from "../integrations/locusMcp.js";
import type { SessionService } from "../session/sessions.js";
import {
  isSafeTestFilter,
  isUnrealAction,
  isUnrealTarget,
  latestUnrealJob,
  restoreUnrealJobs,
  startUnrealJob,
  unrealJob,
} from "./runner.js";

export const UNREAL_MCP_INSTRUCTIONS = [
  "Unreal Engine projects use the Unreal editor/UAT bridge, not Playwright or the HTML canvas.",
  "Call unreal_editor to inspect the project, compile (C++ editor target + all Blueprints), run automation tests, run an editor Python script, or package a player.",
  "The call starts a Host operation; poll unreal_result with the returned jobId and waitMs=5000 until it completes. Builds and packaging can take many minutes.",
  "Do not claim success until unreal_result reports succeeded. Read the log, fix compile or Blueprint errors and retry.",
  "Prefer editor Python scripts (action=python, PythonScriptPlugin enabled) over hand-editing binary .uasset/.umap files, which cannot be edited as text.",
  "Only one Unreal operation runs against a project at a time. Close the interactive Unreal Editor while automation jobs run.",
].join(" ");

export function unrealMcpTools(): LocusMcpTool[] {
  return [
    {
      name: "unreal_editor",
      description:
        "Start a real Unreal Engine operation for this session's Host project: inspect (.uproject, maps, modules, plugins, matching engine), compile (C++ editor target and all Blueprints), test (automation tests), python (run a project .py with the editor's Python scripting) or package (BuildCookRun for windows/linux/macos). Follow with unreal_result.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["inspect", "compile", "test", "python", "package"] },
          target: {
            type: "string",
            enum: ["windows", "linux", "macos"],
            description: "Required for package",
          },
          filter: {
            type: "string",
            description:
              "For test: automation test name filter (default: the project name), e.g. MyGame.Gameplay",
          },
          script: {
            type: "string",
            description: "For python: project-relative script, e.g. Content/Python/build_level.py",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    {
      name: "unreal_result",
      description:
        "Poll an Unreal operation: status, build/compile log, automation test summary, inspection data or package output. Omit jobId for the latest job in this session.",
      inputSchema: {
        type: "object",
        properties: {
          jobId: { type: "string", description: "Job ID returned by unreal_editor." },
          waitMs: {
            type: "number",
            description: "Optional bounded wait before polling, 0-10000ms.",
          },
        },
        additionalProperties: false,
      },
    },
  ];
}

export function isUnrealMcpTool(name: string): boolean {
  return name === "unreal_editor" || name === "unreal_result";
}

export async function executeUnrealMcp(
  sessions: SessionService,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  try {
    const root = await sessions.unrealProjectRoot(sessionId);
    await restoreUnrealJobs(root, sessionId);
    if (name === "unreal_editor") {
      if (!isUnrealAction(args.action)) return { ok: false, output: "Invalid Unreal action" };
      const action = args.action;
      if (action === "package" && !isUnrealTarget(args.target))
        return { ok: false, output: "target must be windows, linux or macos" };
      if (action === "python" && typeof args.script !== "string")
        return { ok: false, output: "script is required for python" };
      if (args.filter !== undefined && !isSafeTestFilter(args.filter))
        return {
          ok: false,
          output: "filter may only contain letters, numbers, spaces, . _ + and -",
        };
      const job = await startUnrealJob({
        root,
        sessionId,
        action,
        ...(isUnrealTarget(args.target) ? { target: args.target } : {}),
        ...(typeof args.filter === "string" ? { filter: args.filter } : {}),
        ...(typeof args.script === "string" ? { script: args.script } : {}),
      });
      return {
        ok: true,
        output: JSON.stringify({
          jobId: job.id,
          status: job.status,
          action,
          next: "Call unreal_result with jobId until succeeded or failed.",
        }),
      };
    }
    if (name === "unreal_result") {
      const wait =
        typeof args.waitMs === "number" && Number.isFinite(args.waitMs)
          ? Math.min(10_000, Math.max(0, args.waitMs))
          : 0;
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      const job =
        typeof args.jobId === "string"
          ? unrealJob(args.jobId, sessionId)
          : latestUnrealJob(sessionId);
      if (!job) return { ok: false, output: "Unreal job not found in this session" };
      const output = JSON.stringify(job, null, 2);
      return {
        ok: job.status !== "failed",
        output:
          job.status === "running"
            ? output + "\nOperation is still running; call unreal_result again."
            : output,
      };
    }
    return { ok: false, output: "Unknown Unreal tool" };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}
