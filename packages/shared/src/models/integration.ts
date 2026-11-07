import { GOOGLE_INTEGRATION_KINDS, isGoogleIntegrationKind } from "./google.js";

export const INTEGRATION_KINDS = [
  "jira",
  "confluence",
  "linear",
  "slack",
  "grafana",
  "sentry",
  "miro",
  "figma",
  "incidentio",
  "aws",
  "portainer",
  ...GOOGLE_INTEGRATION_KINDS,
  "kubernetes",
] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export function isIntegrationKind(value: unknown): value is IntegrationKind {
  return (INTEGRATION_KINDS as readonly string[]).includes(value as string);
}

export type IntegrationAuthMethod = "token" | "oauth";

export interface IntegrationAccount {
  id: string;
  kind: IntegrationKind;
  name: string;
  enabled: boolean;
  baseUrl: string;
  token?: string;
  /** Slack user OAuth (`xoxp-`). Required for the Slack section. */
  authMethod?: IntegrationAuthMethod;
  oauthClientId?: string;
  oauthClientSecret?: string;
  teamId?: string;
  teamName?: string;
  userId?: string;
  userName?: string;
  userToken?: string;
  /** Slack bot user id from OAuth (`bot_user_id`), when posting as the app. */
  botUserId?: string;
  appToken?: string;
  /** Google OAuth refresh token. Vaulted like forge refresh tokens. */
  refreshToken?: string;
  /** Epoch ms when the Google access token should be refreshed. */
  tokenExpiresAt?: number;
  /** OAuth/JWT scopes observed when the token was saved. */
  tokenScopes?: string[];
  /** ISO timestamp when the current token was stored. */
  tokenSavedAt?: string;
  /** Runtime-only hygiene warning. Not persisted. */
  tokenWarning?: string;
  allowedSlackChannelIds?: string[];
  defaultRuntime?: "docker" | "vm" | "host";
  defaultRepoId?: string;
  defaultProviderId?: string;
  defaultModel?: string;
  /** AWS access key id. Secret key is `token`. */
  accessKeyId?: string;
  /** Temporary AWS session token (STS / IMDS). Vaulted. */
  sessionToken?: string;
  /** AWS region for STS. IAM Query still signs as us-east-1. */
  region?: string;
  /** Optional role to AssumeRole after resolving keys or IMDS. */
  roleArn?: string;
  /** Use EC2/ECS instance metadata when no access key is pasted. */
  useInstanceMetadata?: boolean;
  /** Optional STS endpoint (PrivateLink or API Gateway). Empty uses the gateway or regional STS. */
  stsUrl?: string;
  /**
   * Optional AWS gateway URL. When IAM/STS endpoints are still the AWS defaults, Query calls
   * POST here (path preserved) and sign as `execute-api` when the host is API Gateway.
   */
  gatewayUrl?: string;
}

export const DEFAULT_INTEGRATION_SPECS: Array<Omit<IntegrationAccount, "id" | "token">> = [
  { kind: "jira", name: "Jira", enabled: false, baseUrl: "https://your-site.atlassian.net" },
  {
    kind: "confluence",
    name: "Confluence",
    enabled: false,
    baseUrl: "https://your-site.atlassian.net",
  },
  { kind: "linear", name: "Linear", enabled: false, baseUrl: "https://api.linear.app" },
  { kind: "slack", name: "Slack", enabled: false, baseUrl: "https://slack.com/api" },
  { kind: "grafana", name: "Grafana", enabled: false, baseUrl: "http://127.0.0.1:3000" },
  { kind: "sentry", name: "Sentry", enabled: false, baseUrl: "https://sentry.io" },
  { kind: "miro", name: "Miro", enabled: false, baseUrl: "https://api.miro.com" },
  { kind: "figma", name: "Figma", enabled: false, baseUrl: "https://api.figma.com" },
  { kind: "incidentio", name: "incident.io", enabled: false, baseUrl: "https://api.incident.io" },
  { kind: "aws", name: "AWS IAM", enabled: false, baseUrl: "https://iam.amazonaws.com" },
  { kind: "portainer", name: "Portainer", enabled: false, baseUrl: "http://127.0.0.1:9000" },
  { kind: "gmail", name: "Gmail", enabled: false, baseUrl: "https://gmail.googleapis.com" },
  {
    kind: "gcal",
    name: "Google Calendar",
    enabled: false,
    baseUrl: "https://www.googleapis.com",
  },
  { kind: "gdrive", name: "Google Drive", enabled: false, baseUrl: "https://www.googleapis.com" },
  { kind: "kubernetes", name: "Kubernetes", enabled: false, baseUrl: "http://127.0.0.1:8001" },
];

export function defaultIntegrationUrl(kind: IntegrationKind): string {
  return DEFAULT_INTEGRATION_SPECS.find((row) => row.kind === kind)?.baseUrl ?? "";
}

export function integrationLabel(kind: IntegrationKind): string {
  if (kind === "jira") return "Jira";
  if (kind === "confluence") return "Confluence";
  if (kind === "linear") return "Linear";
  if (kind === "grafana") return "Grafana";
  if (kind === "sentry") return "Sentry";
  if (kind === "miro") return "Miro";
  if (kind === "figma") return "Figma";
  if (kind === "incidentio") return "incident.io";
  if (kind === "aws") return "AWS IAM";
  if (kind === "portainer") return "Portainer";
  if (kind === "gmail") return "Gmail";
  if (kind === "gcal") return "Google Calendar";
  if (kind === "gdrive") return "Google Drive";
  if (kind === "kubernetes") return "Kubernetes";
  return "Slack";
}

export function isLoopbackIntegrationUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

export function kubernetesReady(
  account: Pick<IntegrationAccount, "kind" | "enabled" | "token" | "baseUrl">,
): boolean {
  if (account.kind !== "kubernetes" || account.enabled === false) return false;
  if (account.token?.trim()) return true;
  return isLoopbackIntegrationUrl(account.baseUrl);
}

export function awsCredentialReady(
  account: Pick<
    IntegrationAccount,
    "kind" | "enabled" | "token" | "accessKeyId" | "useInstanceMetadata"
  >,
): boolean {
  if (account.kind !== "aws" || account.enabled === false) return false;
  if (account.useInstanceMetadata) return true;
  return Boolean(account.accessKeyId?.trim() && account.token?.trim());
}

export function integrationHasToken(
  account: Pick<
    IntegrationAccount,
    | "kind"
    | "token"
    | "userToken"
    | "refreshToken"
    | "enabled"
    | "accessKeyId"
    | "useInstanceMetadata"
    | "baseUrl"
  >,
): boolean {
  if (account.enabled === false) return false;
  if (account.kind === "aws") return awsCredentialReady(account);
  if (account.kind === "kubernetes") return kubernetesReady(account);
  return Boolean(
    account.token?.trim() || account.userToken?.trim() || account.refreshToken?.trim(),
  );
}

/** Slack client + user-identity posts need a user token, not a leftover bot paste. */
export function slackClientReady(
  account: Pick<IntegrationAccount, "kind" | "enabled" | "userToken">,
): boolean {
  return (
    account.kind === "slack" && account.enabled !== false && Boolean(account.userToken?.trim())
  );
}

/** True when Settings already has a Slack sign-in (token or identity), even if live status is still loading. */
export function slackAccountLinked(
  account: Pick<
    IntegrationAccount,
    "kind" | "enabled" | "userToken" | "userId" | "userName" | "teamId" | "teamName"
  >,
): boolean {
  if (account.kind !== "slack" || account.enabled === false) return false;
  return Boolean(
    account.userToken?.trim() ||
    account.userId?.trim() ||
    account.userName?.trim() ||
    account.teamId?.trim() ||
    account.teamName?.trim(),
  );
}

export type SlackPostAs = "user" | "bot";

export function parseSlackPostAs(value: unknown): SlackPostAs {
  return typeof value === "string" && value.trim().toLowerCase() === "bot" ? "bot" : "user";
}

export function slackBotToken(account: Pick<IntegrationAccount, "token">): string | undefined {
  return account.token?.trim() || undefined;
}

/** True when slack_post / the composer can send as the Locus app. */
export function slackBotReady(
  account: Pick<IntegrationAccount, "kind" | "enabled" | "token">,
): boolean {
  return account.kind === "slack" && account.enabled !== false && Boolean(slackBotToken(account));
}

export function slackWriteToken(
  account: Pick<IntegrationAccount, "userToken" | "token">,
  as: SlackPostAs = "user",
): string | undefined {
  if (as === "bot") return slackBotToken(account);
  return account.userToken?.trim() || slackBotToken(account);
}

export function integrationsWithTokens(
  rows: IntegrationAccount[] | undefined,
): IntegrationAccount[] {
  return (rows ?? []).filter(integrationHasToken);
}

export const INTEGRATION_TOOL_NAMES = [
  "jira_search",
  "jira_get",
  "jira_comment",
  "jira_create",
  "jira_update",
  "jira_transition",
  "confluence_search",
  "confluence_get",
  "confluence_create",
  "confluence_update",
  "confluence_comment",
  "linear_search",
  "linear_get",
  "linear_comment",
  "linear_create",
  "linear_update",
  "slack_post",
  "slack_upload",
  "slack_channels",
  "slack_history",
  "slack_replies",
  "grafana_search",
  "grafana_get",
  "grafana_query",
  "sentry_projects",
  "sentry_search",
  "sentry_get",
  "sentry_events",
  "sentry_update",
  "miro_list",
  "miro_get",
  "miro_import",
  "miro_export",
  "figma_list",
  "figma_get",
  "figma_images",
  "figma_comment",
  "incidentio_search",
  "incidentio_get",
  "incidentio_comment",
  "incidentio_create",
  "incidentio_update",
  "aws_sts_identity",
  "aws_iam_list",
  "aws_iam_get",
  "aws_iam_simulate",
  "portainer_endpoints",
  "portainer_containers",
  "portainer_inspect",
  "portainer_logs",
  "portainer_stacks",
  "portainer_container_action",
  "portainer_stack_action",
  "gmail_search",
  "gmail_get",
  "gmail_send",
  "calendar_list",
  "calendar_get",
  "calendar_create",
  "drive_list",
  "drive_get",
  "drive_upload",
  "k8s_list",
  "k8s_get",
  "k8s_logs",
  "k8s_events",
  "k8s_apply",
  "k8s_delete",
  "k8s_scale",
] as const;

export type IntegrationToolName = (typeof INTEGRATION_TOOL_NAMES)[number];

export function isIntegrationToolName(name: string): name is IntegrationToolName {
  return (INTEGRATION_TOOL_NAMES as readonly string[]).includes(name);
}

export function isIntegrationWriteTool(name: string): boolean {
  return (
    name === "jira_comment" ||
    name === "jira_create" ||
    name === "jira_update" ||
    name === "jira_transition" ||
    name === "confluence_create" ||
    name === "confluence_update" ||
    name === "confluence_comment" ||
    name === "linear_comment" ||
    name === "linear_create" ||
    name === "linear_update" ||
    name === "slack_post" ||
    name === "slack_upload" ||
    name === "sentry_update" ||
    name === "miro_export" ||
    name === "figma_comment" ||
    name === "incidentio_comment" ||
    name === "incidentio_create" ||
    name === "incidentio_update" ||
    name === "portainer_container_action" ||
    name === "portainer_stack_action" ||
    name === "gmail_send" ||
    name === "calendar_create" ||
    name === "drive_upload" ||
    name === "k8s_apply" ||
    name === "k8s_delete" ||
    name === "k8s_scale"
  );
}

export function parseSlackChannelAllowlist(raw: unknown): string[] | undefined {
  const parts = Array.isArray(raw)
    ? raw.flatMap((row) => (typeof row === "string" ? row.split(/[\s,]+/) : []))
    : typeof raw === "string"
      ? raw.split(/[\s,]+/)
      : [];
  const ids = [...new Set(parts.map((row) => row.trim()).filter(Boolean))];
  return ids.length ? ids : undefined;
}

export function slackChannelAllowed(
  account: Pick<IntegrationAccount, "allowedSlackChannelIds">,
  channelId: string,
): boolean {
  const allow = account.allowedSlackChannelIds;
  if (!allow?.length) return true;
  return allow.includes(channelId);
}

export function integrationKindForTool(name: string): IntegrationKind | undefined {
  if (!isIntegrationToolName(name)) return undefined;
  if (name.startsWith("jira_")) return "jira";
  if (name.startsWith("confluence_")) return "confluence";
  if (name.startsWith("linear_")) return "linear";
  if (name.startsWith("slack_")) return "slack";
  if (name.startsWith("sentry_")) return "sentry";
  if (name.startsWith("miro_")) return "miro";
  if (name.startsWith("figma_")) return "figma";
  if (name.startsWith("incidentio_")) return "incidentio";
  if (name.startsWith("aws_")) return "aws";
  if (name.startsWith("portainer_")) return "portainer";
  if (name.startsWith("gmail_")) return "gmail";
  if (name.startsWith("calendar_")) return "gcal";
  if (name.startsWith("drive_")) return "gdrive";
  if (name.startsWith("k8s_")) return "kubernetes";
  return "grafana";
}

/** True when this tool is not an integration, or the matching first-party account has a token. */
export function integrationReady(name: string, rows: IntegrationAccount[] | undefined): boolean {
  const kind = integrationKindForTool(name);
  if (!kind) return true;
  return integrationsWithTokens(rows).some((row) => row.kind === kind);
}

/** Automations only see first-party integration tools when the operator listed them. */
export function automationAllowsIntegration(
  session: { automationId?: string; allowedMcpTools?: string[]; allowedTools?: string[] },
  name: string,
): boolean {
  if (!isIntegrationToolName(name)) return true;
  if (!session.automationId) return true;
  return (
    (session.allowedMcpTools ?? []).includes(name) || (session.allowedTools ?? []).includes(name)
  );
}

export function parseIntegrationAccount(raw: unknown): IntegrationAccount | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : undefined;
  if (!id || !isIntegrationKind(value.kind)) return undefined;
  const name =
    typeof value.name === "string" && value.name.trim()
      ? value.name.trim()
      : integrationLabel(value.kind);
  const baseUrl =
    typeof value.baseUrl === "string" && value.baseUrl.trim()
      ? value.baseUrl.trim().replace(/\/+$/, "")
      : defaultIntegrationUrl(value.kind);
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  const tokenScopes = Array.isArray(value.tokenScopes)
    ? value.tokenScopes.filter(
        (item): item is string => typeof item === "string" && Boolean(item.trim()),
      )
    : undefined;
  const account: IntegrationAccount = {
    id,
    kind: value.kind,
    name,
    enabled: value.enabled !== false,
    baseUrl,
    token: typeof value.token === "string" && value.token.trim() ? value.token : undefined,
    tokenExpiresAt: numOpt(value.tokenExpiresAt),
    tokenScopes: tokenScopes?.length ? tokenScopes : undefined,
    tokenSavedAt: strOpt(value.tokenSavedAt),
  };
  if (value.kind === "aws") {
    const region = strOpt(value.region);
    const roleArn = strOpt(value.roleArn);
    return {
      ...account,
      accessKeyId: strOpt(value.accessKeyId),
      sessionToken: strOpt(value.sessionToken),
      region,
      roleArn,
      useInstanceMetadata: value.useInstanceMetadata === true ? true : undefined,
      stsUrl: strOpt(value.stsUrl),
      gatewayUrl: strOpt(value.gatewayUrl),
    };
  }
  if (isGoogleIntegrationKind(value.kind)) {
    const authMethod =
      value.authMethod === "oauth" || value.authMethod === "token" ? value.authMethod : undefined;
    return {
      ...account,
      authMethod,
      oauthClientId: strOpt(value.oauthClientId),
      oauthClientSecret: strOpt(value.oauthClientSecret),
      refreshToken: strOpt(value.refreshToken),
      tokenExpiresAt: numOpt(value.tokenExpiresAt),
      userId: strOpt(value.userId),
      userName: strOpt(value.userName),
    };
  }
  if (value.kind !== "slack") return account;
  const authMethod =
    value.authMethod === "oauth" || value.authMethod === "token" ? value.authMethod : undefined;
  const channels = parseSlackChannelAllowlist(value.allowedSlackChannelIds);
  const runtime =
    value.defaultRuntime === "docker" ||
    value.defaultRuntime === "vm" ||
    value.defaultRuntime === "host"
      ? value.defaultRuntime
      : undefined;
  return {
    ...account,
    authMethod,
    oauthClientId: strOpt(value.oauthClientId),
    oauthClientSecret: strOpt(value.oauthClientSecret),
    teamId: strOpt(value.teamId),
    teamName: strOpt(value.teamName),
    userId: strOpt(value.userId),
    userName: strOpt(value.userName),
    userToken: strOpt(value.userToken),
    botUserId: strOpt(value.botUserId),
    appToken: strOpt(value.appToken),
    allowedSlackChannelIds: channels?.length ? channels : undefined,
    defaultRuntime: runtime,
    defaultRepoId: strOpt(value.defaultRepoId),
    defaultProviderId: strOpt(value.defaultProviderId),
    defaultModel: strOpt(value.defaultModel),
  };
}

function strOpt(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numOpt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

export function parseIntegrationAccounts(raw: unknown): IntegrationAccount[] {
  if (!Array.isArray(raw)) return [];
  const out: IntegrationAccount[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const parsed = parseIntegrationAccount(row);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    out.push(parsed);
  }
  return out;
}
