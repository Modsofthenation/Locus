import type { ToolResult } from "@locus/guest-agent";
import {
  SLACK_UPLOAD_MAX_BYTES,
  automationAllowsIntegration,
  integrationKindForTool,
  integrationReady,
  isIntegrationToolName,
  type AgentSession,
  type IntegrationAccount,
  type IntegrationToolName,
  type LocusConfig,
} from "@locus/shared";

export type SessionIntegrationDeps = {
  call: (
    name: IntegrationToolName,
    args: Record<string, unknown>,
    rows: IntegrationAccount[] | undefined,
  ) => Promise<ToolResult>;
  noteSlackPost: (sessionId: string, ts: string) => Promise<void>;
  /** Read a workspace file for slack_upload path=. Throws with an operator-readable reason. */
  readWorkspaceUpload?: (
    sessionId: string,
    path: string,
    maxBytes: number,
  ) => Promise<{ path: string; bytes: Uint8Array }>;
};

const SLACK_WRITE = new Set(["slack_post", "slack_upload"]);

/** Bind Ask-Locus / Slack-bound Turns onto the live thread unless the tool named another channel. */
export function bindSlackToolArgs(
  slack: AgentSession["slack"],
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!slack || !SLACK_WRITE.has(name)) return args;
  const next = { ...args };
  if (!next.channel) next.channel = slack.channelId;
  if (!next.thread_ts && next.channel === slack.channelId) {
    next.thread_ts = slack.threadTs;
  }
  return next;
}

export function slackToolLastPostTs(
  name: string,
  result: Pick<ToolResult, "ok" | "output">,
): string | undefined {
  if (!SLACK_WRITE.has(name) || !result.ok) return undefined;
  return /\bts=([0-9.]+)/.exec(result.output)?.[1];
}

const UPLOAD_MIME: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".zip": "application/zip",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
};

function uploadMime(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? undefined : UPLOAD_MIME[path.slice(dot).toLowerCase()];
}

/**
 * slack_upload path= reads the file from the session workspace host-side, so a large
 * report (Playwright HTML, a zip) never has to pass through the model as content.
 */
export async function resolveSlackUploadPath(
  deps: Pick<SessionIntegrationDeps, "readWorkspaceUpload">,
  sessionId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const path = typeof args.path === "string" ? args.path.trim() : "";
  if (!path) return args;
  if (typeof args.content === "string" && args.content) return args;
  if (typeof args.bytes_base64 === "string" && args.bytes_base64) return args;
  if (!deps.readWorkspaceUpload) throw new Error("path= uploads are not available here");
  const file = await deps.readWorkspaceUpload(sessionId, path, SLACK_UPLOAD_MAX_BYTES);
  if (!file.bytes.byteLength) throw new Error(`${file.path} is empty`);
  const base = file.path.split("/").pop() || "upload";
  const { path: _path, ...rest } = args;
  return {
    ...rest,
    filename: typeof args.filename === "string" && args.filename.trim() ? args.filename : base,
    mime: (typeof args.mime === "string" && args.mime) || uploadMime(base),
    bytes_base64: Buffer.from(file.bytes).toString("base64"),
  };
}

export async function executeIntegrationTool(
  deps: SessionIntegrationDeps,
  session: AgentSession,
  name: string,
  args: Record<string, unknown>,
  config: LocusConfig,
  wrapOutput: (name: string, output: string) => string,
): Promise<ToolResult> {
  if (!isIntegrationToolName(name)) {
    return { ok: false, output: `Unknown integration tool ${name}` };
  }
  if (!automationAllowsIntegration(session, name)) {
    throw new Error(`Tool ${name} is not allowed for this automation`);
  }
  if (!integrationReady(name, config.integrations)) {
    throw new Error(`Add a ${integrationKindForTool(name)} token in Settings → Integrations`);
  }
  const withFile =
    name === "slack_upload" ? await resolveSlackUploadPath(deps, session.id, args) : args;
  const bound = bindSlackToolArgs(session.slack, name, withFile);
  const result = await deps.call(name, bound, config.integrations);
  const ts = slackToolLastPostTs(name, result);
  if (ts) await deps.noteSlackPost(session.id, ts);
  return { ...result, output: wrapOutput(name, result.output) };
}
