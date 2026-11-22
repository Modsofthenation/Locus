import type { LocusMcpTool } from "../integrations/locusMcp.js";
import type { SessionService } from "../session/sessions.js";
import {
  blenderImage,
  blenderJob,
  isBlenderAction,
  isBlenderExportFormat,
  latestBlenderJob,
  restoreBlenderJobs,
  startBlenderJob,
} from "./runner.js";

export const BLENDER_MCP_INSTRUCTIONS = [
  "Blender Asset Builder runs against a real Host .blend file, not the HTML asset canvas.",
  "Use blender_editor to inspect, validate, render or export; follow with blender_result until succeeded or failed.",
  "For creation, use action=create with a new workspace-relative .blend path; never overwrite an existing asset.",
  "To edit scenes, write a project-relative .py script for operator review, then ask the operator to run it in the local Blender panel. MCP cannot execute scripts without interactive confirmation.",
  "Blender scripts run locally with the user's permissions. Do not run scripts from untrusted projects.",
  "Blender background jobs disable automatic embedded scripts. Review error logs and report actual results.",
].join(" ");

export function blenderMcpTools(): LocusMcpTool[] {
  return [
    {
      name: "blender_editor",
      description:
        "Run a local Blender operation on a project-relative .blend file. Create a new scene, inspect objects, validate external images, render PNG, export GLB/FBX/OBJ/STL Scripted edits must be reviewed and run manually in the local Blender panel.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "inspect", "validate", "render", "export"] },
          file: { type: "string", description: "Workspace-relative .blend file path" },
          format: {
            type: "string",
            enum: ["glb", "fbx", "obj", "stl"],
            description: "Required for export",
          },
        },
        required: ["action", "file"],
        additionalProperties: false,
      },
    },
    {
      name: "blender_result",
      description:
        "Read the result of a Blender job, including scene inspection and logs. Render jobs can return a PNG image.",
      inputSchema: {
        type: "object",
        properties: {
          jobId: { type: "string" },
          waitMs: { type: "number", description: "Wait at most 10000ms before polling" },
        },
        additionalProperties: false,
      },
    },
  ];
}
export function isBlenderMcpTool(name: string): boolean {
  return name === "blender_editor" || name === "blender_result";
}
export async function executeBlenderMcp(
  sessions: SessionService,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string; screenshotBase64?: string; screenshotMime?: string }> {
  try {
    const root = await sessions.blenderProjectRoot(sessionId);
    await restoreBlenderJobs(root, sessionId);
    if (name === "blender_editor") {
      if (args.action === "script")
        return {
          ok: false,
          output:
            "Script execution requires explicit confirmation in the local Blender panel. Prepare the .py file and ask the operator to run it there.",
        };
      if (!isBlenderAction(args.action)) return { ok: false, output: "Invalid Blender action" };
      if (typeof args.file !== "string") return { ok: false, output: "file is required" };
      if (args.action === "export" && !isBlenderExportFormat(args.format))
        return { ok: false, output: "format must be glb, fbx, obj or stl" };
      const job = await startBlenderJob({
        root,
        sessionId,
        action: args.action,
        file: args.file,
        ...(isBlenderExportFormat(args.format) ? { format: args.format } : {}),
        ...(typeof args.script === "string" ? { script: args.script } : {}),
      });
      return {
        ok: true,
        output: JSON.stringify({
          jobId: job.id,
          status: job.status,
          next: "Poll blender_result until complete.",
        }),
      };
    }
    if (name === "blender_result") {
      const wait =
        typeof args.waitMs === "number" && Number.isFinite(args.waitMs)
          ? Math.min(10000, Math.max(0, args.waitMs))
          : 0;
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      const job =
        typeof args.jobId === "string"
          ? blenderJob(args.jobId, sessionId)
          : latestBlenderJob(sessionId);
      if (!job) return { ok: false, output: "Blender job not found in this session" };
      const image =
        job.image && job.status === "succeeded" ? await blenderImage(job.id, sessionId) : undefined;
      return {
        ok: job.status !== "failed",
        output:
          JSON.stringify(job) +
          (job.status === "running" ? "\nOperation still running; poll again." : ""),
        ...(image
          ? { screenshotBase64: image.toString("base64"), screenshotMime: "image/png" }
          : {}),
      };
    }
    return { ok: false, output: "Unknown Blender tool" };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}
