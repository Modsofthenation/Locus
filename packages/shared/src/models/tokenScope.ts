import type { IntegrationAccount, IntegrationKind } from "./integration.js";

export const TOKEN_ROTATION_DAYS = 90;
export const TOKEN_EXPIRY_SOON_DAYS = 14;

/** Write/admin scopes first-party tools do not need unless the matching write tool is enabled. */
export const INTEGRATION_WRITE_SCOPES: Record<string, string[]> = {
  jira: [
    "write:jira-work",
    "write:issue:jira",
    "write:comment:jira",
    "manage:jira-project",
    "manage:jira-configuration",
    "admin:jira",
    "admin:jira-project",
  ],
  slack: [
    "chat:write",
    "chat:write.public",
    "chat:write.customize",
    "files:write",
    "admin",
    "admin.conversations:write",
    "admin.users:write",
    "admin.teams:write",
  ],
  google: [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.file",
  ],
  gmail: [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
  gcal: [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  gdrive: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/drive.file"],
  aws: [
    "iam:*",
    "iam:Create*",
    "iam:Delete*",
    "iam:Put*",
    "iam:Attach*",
    "AdministratorAccess",
    "*",
  ],
};

export const INTEGRATION_ADMIN_SCOPES: Record<string, string[]> = {
  jira: ["manage:jira-configuration", "admin:jira", "admin:jira-project", "manage:jira-project"],
  slack: ["admin", "admin.conversations:write", "admin.users:write", "admin.teams:write"],
  google: ["https://www.googleapis.com/auth/admin.directory.user"],
  gmail: [],
  gcal: [],
  gdrive: [],
  aws: ["AdministratorAccess", "iam:*", "*"],
};

const WRITE_TOOLS: Record<string, string[]> = {
  jira: ["jira_create", "jira_update", "jira_comment", "jira_transition"],
  slack: ["slack_post", "slack_upload"],
  gmail: ["gmail_send"],
  gcal: ["calendar_create"],
  gdrive: ["drive_upload"],
  aws: [],
};

export interface JwtClaims {
  exp?: number;
  scope?: string;
  scp?: string | string[];
  scopes?: string | string[];
  permissions?: string | string[];
}

export function decodeJwtPayload(token: string): JwtClaims | undefined {
  const parts = token.trim().split(".");
  if (parts.length < 2) return undefined;
  try {
    const json = decodeBase64Url(parts[1]!);
    const parsed = JSON.parse(json) as JwtClaims;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function decodeBase64Url(value: string): string {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return atob(b64);
}

function asScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .flatMap((item) => item.split(/[\s,]+/))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function scopesFromToken(token?: string): string[] {
  if (!token?.trim()) return [];
  const claims = decodeJwtPayload(token);
  if (!claims) return slackScopesFromToken(token);
  const fromClaims = [
    ...asScopes(claims.scope),
    ...asScopes(claims.scp),
    ...asScopes(claims.scopes),
    ...asScopes(claims.permissions),
  ];
  return unique(fromClaims);
}

function slackScopesFromToken(token: string): string[] {
  const trimmed = token.trim();
  if (trimmed.startsWith("xoxp-") || trimmed.startsWith("xoxe.xoxp-")) return [];
  return [];
}

function unique(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim();
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

export function expiryFromToken(token?: string): number | undefined {
  if (!token?.trim()) return undefined;
  const claims = decodeJwtPayload(token);
  if (typeof claims?.exp === "number" && Number.isFinite(claims.exp) && claims.exp > 0) {
    return claims.exp > 1_000_000_000_000 ? claims.exp : claims.exp * 1000;
  }
  return undefined;
}

export function normalizeScopeList(raw?: string[] | string): string[] {
  return unique(asScopes(raw));
}

function kindKey(kind: IntegrationKind): string {
  if (kind === "gmail" || kind === "gcal" || kind === "gdrive") return kind;
  if (kind === "jira" || kind === "slack" || kind === "aws") return kind;
  return kind;
}

export function extraWriteScopes(
  kind: IntegrationKind,
  scopes: string[],
  enabledTools: string[] = [],
): string[] {
  const key = kindKey(kind);
  const write = INTEGRATION_WRITE_SCOPES[key] ?? INTEGRATION_WRITE_SCOPES.google ?? [];
  const admin = INTEGRATION_ADMIN_SCOPES[key] ?? [];
  const neededWrite = WRITE_TOOLS[key] ?? [];
  const writesEnabled = neededWrite.some((tool) => enabledTools.includes(tool));
  const extra: string[] = [];
  for (const scope of scopes) {
    const lower = scope.toLowerCase();
    const isAdmin = admin.some((item) => item.toLowerCase() === lower || lower.includes("admin"));
    const isWrite = write.some(
      (item) =>
        item.toLowerCase() === lower ||
        (item.endsWith("*") && lower.startsWith(item.slice(0, -1).toLowerCase())),
    );
    if (isAdmin) extra.push(scope);
    else if (isWrite && !writesEnabled) extra.push(scope);
  }
  return unique(extra);
}

export interface TokenHygiene {
  accountId: string;
  kind: IntegrationKind;
  name: string;
  scopes: string[];
  extraScopes: string[];
  expiresAt?: number;
  savedAt?: string;
  rotationDue: boolean;
  expiringSoon: boolean;
  warning?: string;
}

export function inspectIntegrationToken(
  account: IntegrationAccount,
  opts?: { enabledTools?: string[]; now?: number },
): TokenHygiene {
  const token = account.token || account.userToken || account.refreshToken;
  const scopes = unique([...(account.tokenScopes ?? []), ...scopesFromToken(token)]);
  const extraScopes = extraWriteScopes(
    account.kind,
    scopes,
    opts?.enabledTools ?? writeToolsForKind(account.kind),
  );
  const expiresAt = account.tokenExpiresAt ?? expiryFromToken(token);
  const now = opts?.now ?? Date.now();
  const expiringSoon =
    typeof expiresAt === "number" &&
    expiresAt > 0 &&
    expiresAt - now <= TOKEN_EXPIRY_SOON_DAYS * 86_400_000;
  const savedAt = account.tokenSavedAt;
  const savedMs = savedAt ? Date.parse(savedAt) : Number.NaN;
  const rotationDue =
    expiringSoon ||
    (Number.isFinite(savedMs) && now - savedMs >= TOKEN_ROTATION_DAYS * 86_400_000 && !expiresAt);
  const bits: string[] = [];
  if (extraScopes.length) {
    bits.push(`has ${extraScopes.join(", ")} beyond what the enabled tools need`);
  }
  if (expiringSoon && expiresAt) {
    bits.push(`expires ${new Date(expiresAt).toISOString().slice(0, 10)}`);
  } else if (rotationDue) {
    bits.push(`older than ${TOKEN_ROTATION_DAYS} days — rotate`);
  }
  return {
    accountId: account.id,
    kind: account.kind,
    name: account.name,
    scopes,
    extraScopes,
    expiresAt,
    savedAt,
    rotationDue,
    expiringSoon,
    warning: bits.length ? bits.join("; ") : undefined,
  };
}

function writeToolsForKind(kind: IntegrationKind): string[] {
  return WRITE_TOOLS[kindKey(kind)] ?? [];
}

export function inspectIntegrationTokens(
  accounts: IntegrationAccount[] | undefined,
  opts?: { enabledTools?: string[]; now?: number },
): TokenHygiene[] {
  return (accounts ?? [])
    .filter((row) => Boolean(row.token || row.userToken || row.refreshToken || row.accessKeyId))
    .map((row) => inspectIntegrationToken(row, opts));
}

export function stampIntegrationToken(
  account: IntegrationAccount,
  now = new Date().toISOString(),
): IntegrationAccount {
  const token = account.token || account.userToken || account.refreshToken;
  if (!token) return account;
  const scopes = unique([...(account.tokenScopes ?? []), ...scopesFromToken(token)]);
  const expiresAt = account.tokenExpiresAt ?? expiryFromToken(token);
  return {
    ...account,
    tokenScopes: scopes.length ? scopes : account.tokenScopes,
    tokenExpiresAt: expiresAt,
    tokenSavedAt: account.tokenSavedAt || now,
  };
}

export function clearIntegrationCredentials(account: IntegrationAccount): IntegrationAccount {
  return {
    ...account,
    token: undefined,
    userToken: undefined,
    appToken: undefined,
    refreshToken: undefined,
    sessionToken: undefined,
    accessKeyId:
      account.kind === "aws" && account.useInstanceMetadata ? account.accessKeyId : undefined,
    tokenScopes: undefined,
    tokenExpiresAt: undefined,
    tokenSavedAt: undefined,
    tokenWarning: undefined,
  };
}
