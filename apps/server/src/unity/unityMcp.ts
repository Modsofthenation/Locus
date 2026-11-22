import type { LocusMcpTool } from "../integrations/locusMcp.js";
import {
  isUnityAction,
  latestUnityJob,
  startUnityJob,
  unityJob,
  unityScreenshot,
  restoreUnityJobs,
} from "./runner.js";
import type { SessionService } from "../session/sessions.js";

export const UNITY_MCP_INSTRUCTIONS = [
  "Unity projects use the Unity Editor bridge, not Playwright or the HTML canvas.",
  "Call unity_editor to inspect, compile, run PlayMode tests, capture a scene or build.",
  "The call starts an Editor operation; call unity_result with the returned jobId and waitMs=3000 until it completes.",
  "Do not claim success until unity_result reports succeeded. Read the Editor log and fix errors before retrying.",
  "For visual iteration, call unity_editor action=capture and then unity_result. For a playable preview build target=webgl; once succeeded, Locus embeds the Unity player in a sandboxed browser frame.",
  "unity_result attaches the camera PNG as an image when capture succeeds.",
  "Only one Unity operation runs against a project at a time; wait for completion before starting another.",
  "The Editor must be closed interactively while an automation job runs.",
].join(" ");

export function unityMcpTools(): LocusMcpTool[] {
  return [
    {
      name: "unity_editor",
      description:
        "Start a real Unity Editor operation for this session's Host project. Actions: inspect scenes and hierarchy, create-scene, compile/import, PlayMode tests, capture a camera PNG, or build a standalone player or interactive WebGL preview. Follow with unity_result to inspect the actual outcome.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["inspect", "create-scene", "compile", "playtest", "capture", "build"],
          },
          scene: {
            type: "string",
            description:
              "Required for capture/create-scene: asset path such as Assets/Scenes/Main.unity",
          },
          target: {
            type: "string",
            enum: ["linux", "windows", "macos", "webgl"],
            description: "Required for build",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    {
      name: "unity_result",
      description:
        "Poll Unity Editor job status, compiler/test results, scene inspection and build output. Include jobId from unity_editor; if omitted retrieves the latest job for this session. A completed capture returns the actual scene PNG.",
      inputSchema: {
        type: "object",
        properties: {
          jobId: {
            type: "string",
            description: "Job ID returned by unity_editor. Omit to inspect latest.",
          },
          waitMs: {
            type: "number",
            description:
              "Optional bounded wait before polling, 0-10000ms. Avoid rapid busy polling.",
          },
        },
        additionalProperties: false,
      },
    },
  ];
}

export function isUnityMcpTool(name: string): boolean {
  return name === "unity_editor" || name === "unity_result";
}

export async function executeUnityMcp(
  sessions: SessionService,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string; screenshotBase64?: string; screenshotMime?: string }> {
  try {
    const root = await sessions.unityProjectRoot(sessionId);
    await restoreUnityJobs(root, sessionId);
    if (name === "unity_editor") {
      if (!isUnityAction(args.action)) return { ok: false, output: "Invalid Unity action" };
      const action = args.action;
      if ((action === "capture" || action === "create-scene") && typeof args.scene !== "string") {
        return { ok: false, output: "scene is required for capture and create-scene" };
      }
      if (
        action === "build" &&
        !["linux", "windows", "macos", "webgl"].includes(String(args.target ?? ""))
      ) {
        return { ok: false, output: "target must be linux, windows, macos or webgl" };
      }
      const job = await startUnityJob({
        root,
        sessionId,
        action,
        ...(typeof args.scene === "string" ? { scene: args.scene } : {}),
        ...(args.target === "linux" ||
        args.target === "windows" ||
        args.target === "macos" ||
        args.target === "webgl"
          ? { target: args.target }
          : {}),
      });
      return {
        ok: true,
        output: JSON.stringify({
          jobId: job.id,
          status: job.status,
          action: job.action,
          next: "Call unity_result with jobId until succeeded or failed.",
        }),
      };
    }
    if (name === "unity_result") {
      const id = typeof args.jobId === "string" ? args.jobId : undefined;
      const wait =
        typeof args.waitMs === "number" && Number.isFinite(args.waitMs)
          ? Math.min(10000, Math.max(0, args.waitMs))
          : 0;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const job = id ? unityJob(id, sessionId) : latestUnityJob(sessionId);
      if (!job) return { ok: false, output: "Unity job not found in this session" };
      const output = JSON.stringify(job, null, 2);
      const image =
        job.screenshot && job.status === "succeeded"
          ? await unityScreenshot(job.id, sessionId)
          : undefined;
      return {
        ok: job.status !== "failed",
        output:
          job.status === "running"
            ? output + "\nOperation is still running; call unity_result again."
            : output,
        ...(image
          ? { screenshotBase64: image.toString("base64"), screenshotMime: "image/png" }
          : {}),
      };
    }
    return { ok: false, output: "Unknown Unity MCP operation" };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}
