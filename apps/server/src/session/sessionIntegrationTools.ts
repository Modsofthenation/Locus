import type { ToolResult } from "@locus/guest-agent";
import {
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
  const bound = bindSlackToolArgs(session.slack, name, args);
  const result = await deps.call(name, bound, config.integrations);
  const ts = slackToolLastPostTs(name, result);
  if (ts) await deps.noteSlackPost(session.id, ts);
  return { ...result, output: wrapOutput(name, result.output) };
}
