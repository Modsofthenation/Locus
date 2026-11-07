import { forgeOauthCallbackUrl } from "./git.js";

export const GOOGLE_INTEGRATION_KINDS = ["gmail", "gcal", "gdrive"] as const;
export type GoogleIntegrationKind = (typeof GOOGLE_INTEGRATION_KINDS)[number];

export const GOOGLE_OAUTH_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
export const GOOGLE_OAUTH_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";
export const GOOGLE_STATE_PREFIX = "google.";

const EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const PROFILE_SCOPE = "https://www.googleapis.com/auth/userinfo.profile";

export const GMAIL_OAUTH_SCOPES = [
  EMAIL_SCOPE,
  PROFILE_SCOPE,
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

export const GCAL_OAUTH_SCOPES = [
  EMAIL_SCOPE,
  PROFILE_SCOPE,
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export const GDRIVE_OAUTH_SCOPES = [
  EMAIL_SCOPE,
  PROFILE_SCOPE,
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
] as const;

export const DRIVE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

export function isGoogleIntegrationKind(value: unknown): value is GoogleIntegrationKind {
  return (GOOGLE_INTEGRATION_KINDS as readonly string[]).includes(value as string);
}

export function googleOauthCallbackUrl(bindPort = 7420): string {
  return forgeOauthCallbackUrl(bindPort);
}

export function googleOauthClientIdEnv(): string {
  return "LOCUS_GOOGLE_OAUTH_CLIENT_ID";
}

export function googleOauthClientSecretEnv(): string {
  return "LOCUS_GOOGLE_OAUTH_CLIENT_SECRET";
}

export function isGoogleOauthState(state: string | undefined): boolean {
  return Boolean(state?.startsWith(GOOGLE_STATE_PREFIX));
}

export function googleOauthScopes(kind: string): readonly string[] {
  if (kind === "gmail") return GMAIL_OAUTH_SCOPES;
  if (kind === "gcal") return GCAL_OAUTH_SCOPES;
  if (kind === "gdrive") return GDRIVE_OAUTH_SCOPES;
  return [EMAIL_SCOPE, PROFILE_SCOPE];
}

export function googleAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: readonly string[];
}): string {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

export function googleAccessToken(account: {
  token?: string;
  userToken?: string;
}): string | undefined {
  return account.token?.trim() || account.userToken?.trim() || undefined;
}

export function googleTokenExpired(
  account: { tokenExpiresAt?: number },
  now = Date.now(),
): boolean {
  const exp = account.tokenExpiresAt;
  return typeof exp === "number" && Number.isFinite(exp) && exp > 0 && now >= exp;
}
