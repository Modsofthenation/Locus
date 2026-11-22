import type { LocusMcpTool } from "../integrations/locusMcp.js";
import type { SessionService } from "../session/sessions.js";
import {
  godotJob,
  isGodotAction,
  isGodotTarget,
  latestGodotJob,
  restoreGodotJobs,
  startGodotJob,
} from "./runner.js";

export const GODOT_MCP_INSTRUCTIONS = [
  "Use godot_editor and godot_result for real Godot 4 project validation, not the Games HTML canvas.",
  "godot_editor starts a Host Godot operation and returns a job ID; poll godot_result with waitMs=3000.",
  "Inspect scenes, import/parse, run a bounded smoke test, or export a Web/Linux/Windows/macOS player.",
  "Only claim success once godot_result reports succeeded. Read logs and fix parse/script errors before retrying.",
  "Web exports need an installed Godot export template and a matching export preset.",
  "Only one operation per project can run at a time. Godot project plugins may run on the host; use trusted projects only.",
].join(" ");

export function godotMcpTools(): LocusMcpTool[] {
  return [
    {
      name: "godot_editor",
      description:
        "Run Godot 4 editor actions on this session's selected Host project: inspect scenes, import, headless smoke, create-scene or export (web/linux/windows/macos). Returns a jobId for godot_result.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["inspect", "import", "smoke", "export", "create-scene"],
          },
          scene: { type: "string", description: "For create-scene: res://Scenes/Main.tscn" },
          target: { type: "string", enum: ["web", "linux", "windows", "macos"] },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    {
      name: "godot_result",
      description:
        "Get results, logs, scene inspection or export state for a Godot operation. Omit jobId for the most recent operation; use waitMs for bounded polling.",
      inputSchema: {
        type: "object",
        properties: {
          jobId: { type: "string" },
          waitMs: {
            type: "number",
            description: "Wait 0-10000 milliseconds before reading result",
          },
        },
        additionalProperties: false,
      },
    },
  ];
}
export function isGodotMcpTool(name: string): boolean {
  return name === "godot_editor" || name === "godot_result";
}
export async function executeGodotMcp(
  sessions: SessionService,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  try {
    const root = await sessions.godotProjectRoot(sessionId);
    await restoreGodotJobs(root, sessionId);
    if (name === "godot_editor") {
      if (!isGodotAction(args.action)) return { ok: false, output: "Invalid Godot action" };
      const action = args.action;
      if (action === "export" && !isGodotTarget(args.target))
        return { ok: false, output: "Select web, linux, windows or macos target" };
      if (action === "create-scene" && typeof args.scene !== "string")
        return { ok: false, output: "scene is required for create-scene" };
      const result = await startGodotJob({
        root,
        sessionId,
        action,
        ...(typeof args.scene === "string" ? { scene: args.scene } : {}),
        ...(isGodotTarget(args.target) ? { target: args.target } : {}),
      });
      return {
        ok: true,
        output: JSON.stringify({
          jobId: result.id,
          status: result.status,
          action,
          next: "Poll godot_result until succeeded or failed",
        }),
      };
    }
    if (name === "godot_result") {
      const wait =
        typeof args.waitMs === "number" && Number.isFinite(args.waitMs)
          ? Math.min(10_000, Math.max(0, args.waitMs))
          : 0;
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      const result =
        typeof args.jobId === "string"
          ? godotJob(args.jobId, sessionId)
          : latestGodotJob(sessionId);
      if (!result) return { ok: false, output: "Godot job not found in this session" };
      return { ok: result.status !== "failed", output: JSON.stringify(result, null, 2) };
    }
    return { ok: false, output: "Unknown Godot tool" };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}
