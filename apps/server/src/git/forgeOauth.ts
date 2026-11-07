import { createHash, randomBytes } from "node:crypto";
import {
  GITHUB_OAUTH_SCOPES,
  clearForgeOauth,
  defaultForgeApiUrl,
  forgeLabel,
  forgeOauthCallbackUrl,
  forgeOauthClientIdEnv,
  forgeOauthClientSecretEnv,
  forgeSupportsSso,
  forgeWebOrigin,
  githubAccessTokenUrl,
  githubDeviceCodeUrl,
  isForgeKind,
  isMaskedSecret,
  redirectAuthorizeUrl,
  redirectOauthScopes,
  replaceForgeAccount,
  tokenExpiresSoon,
  type ForgeKind,
  type GitForgeAccount,
  type LocusConfig,
} from "@locus/shared";
import type { JsonStore } from "../core/store.js";
import { forgeAuthAdapter } from "./forgeAuthAdapter.js";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const PENDING_TTL_MS = 15 * 60 * 1000;
const REFRESH_SKEW_MS = 60_000;

export interface ForgeOauthStartInput {
  kind?: ForgeKind;
  name?: string;
  apiBaseUrl?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
}

export interface ForgeOauthStartResult {
  method: "device" | "redirect";
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  authorizeUrl?: string;
  expiresIn: number;
  interval?: number;
}

export interface ForgeOauthStatusResult {
  status: "idle" | "pending" | "complete" | "error" | "expired";
  method?: "device" | "redirect";
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  authorizeUrl?: string;
  username?: string;
  error?: string;
}

type PendingOauth = {
  accountId: string;
  method: "device" | "redirect";
  kind: ForgeKind;
  clientId: string;
  clientSecret?: string;
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  authorizeUrl?: string;
  state?: string;
  codeVerifier?: string;
  redirectUri?: string;
  intervalMs: number;
  nextPollAt: number;
  expiresAt: number;
  status: "pending" | "complete" | "error" | "expired";
  error?: string;
  username?: string;
};

export class ForgeOauth {
  private readonly byAccount = new Map<string, PendingOauth>();
  private readonly byState = new Map<string, string>();

  constructor(
    private readonly store: JsonStore,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async start(accountId: string, input: ForgeOauthStartInput = {}): Promise<ForgeOauthStartResult> {
    const account = await this.upsertAccount(accountId, input);
    if (!forgeSupportsSso(account.kind)) {
      throw new Error("SSO sign-in is available for GitHub, GitLab, and Bitbucket");
    }
    const clientId = resolveClientId(account, input.oauthClientId);
    if (!clientId) {
      const env = forgeOauthClientIdEnv(account.kind);
      throw new Error(
        `Add an OAuth client ID for this ${forgeLabel(account.kind)} account${env ? ` (or set ${env})` : ""}.`,
      );
    }
    const clientSecret = resolveClientSecret(account, input.oauthClientSecret);
    this.cancel(accountId);
    const auth = forgeAuthAdapter(account.kind);
    if (auth.method === "device") {
      return this.startGitHub(account, clientId);
    }
    if (auth.requiresClientSecret && !clientSecret) {
      const env = forgeOauthClientSecretEnv(account.kind);
      throw new Error(
        `Add the ${forgeLabel(account.kind)} OAuth application secret${env ? ` (or set ${env})` : ""}.`,
      );
    }
    return this.startRedirect(account, clientId, clientSecret);
  }

  async status(accountId: string): Promise<ForgeOauthStatusResult> {
    const pending = this.byAccount.get(accountId);
    if (!pending) return { status: "idle" };
    if (pending.status === "pending" && Date.now() >= pending.expiresAt) {
      pending.status = "expired";
      pending.error = "Sign-in expired. Try again.";
    }
    if (pending.method === "device" && pending.status === "pending") {
      await this.pollGitHub(pending);
    }
    return snapshot(pending);
  }

  cancel(accountId: string): void {
    const pending = this.byAccount.get(accountId);
    if (pending?.state) this.byState.delete(pending.state);
    this.byAccount.delete(accountId);
  }

  async disconnect(accountId: string): Promise<GitForgeAccount> {
    this.cancel(accountId);
    const config = await this.store.loadConfig();
    const account = config.forges.find((row) => row.id === accountId);
    if (!account) throw new Error("Unknown forge account");
    const next = clearForgeOauth(account);
    await this.saveAccount(next);
    return next;
  }

  async handleCallback(query: {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  }): Promise<{ ok: boolean; html: string }> {
    const state = query.state?.trim();
    const accountId = state ? this.byState.get(state) : undefined;
    const pending = accountId ? this.byAccount.get(accountId) : undefined;
    if (!pending || pending.method !== "redirect") {
      return {
        ok: false,
        html: callbackPage(false, "This sign-in is not pending. Return to Locus."),
      };
    }
    if (query.error) {
      pending.status = "error";
      pending.error = query.error_description?.trim() || query.error;
      return { ok: false, html: callbackPage(false, pending.error) };
    }
    const code = query.code?.trim();
    if (!code) {
      pending.status = "error";
      pending.error = `${forgeLabel(pending.kind)} did not return an authorization code.`;
      return { ok: false, html: callbackPage(false, pending.error) };
    }
    try {
      const token = await this.exchangeRedirect(pending, code);
      const accessToken = token.access_token;
      if (!accessToken)
        throw new Error(`${forgeLabel(pending.kind)} did not return an access token`);
      const username = await this.fetchUsername(pending.kind, pending, accessToken);
      await this.applyAccessToken(pending.accountId, token, username);
      pending.status = "complete";
      pending.username = username;
      return {
        ok: true,
        html: callbackPage(true, `Signed in as ${username}. You can close this tab.`),
      };
    } catch (err) {
      pending.status = "error";
      pending.error =
        err instanceof Error ? err.message : `${forgeLabel(pending.kind)} sign-in failed`;
      return { ok: false, html: callbackPage(false, pending.error) };
    }
  }

  async withFreshToken(account: GitForgeAccount): Promise<GitForgeAccount> {
    if (account.authMethod !== "oauth" || !account.refreshToken) return account;
    if (!tokenExpiresSoon(account.tokenExpiresAt, REFRESH_SKEW_MS)) return account;
    const origin = forgeWebOrigin(account.kind, account.apiBaseUrl);
    const clientId = resolveClientId(account);
    const clientSecret = resolveClientSecret(account);
    if (!clientId) return account;
    try {
      const auth = forgeAuthAdapter(account.kind);
      const form = auth.refreshTokenForm(origin, clientId, clientSecret, account.refreshToken);
      const token = parseToken(await this.postForm(form.url, form.body, form.headers));
      if (!token.access_token) {
        if (token.error === "invalid_grant") {
          const cleared = clearForgeOauth(account);
          await this.saveAccount(cleared);
          return cleared;
        }
        return account;
      }
      const next: GitForgeAccount = {
        ...account,
        token: token.access_token,
        refreshToken: token.refresh_token || account.refreshToken,
        tokenExpiresAt: expiresAtFrom(token.expires_in),
        authMethod: "oauth",
      };
      await this.saveAccount(next);
      return next;
    } catch {
      return account;
    }
  }

  private async startGitHub(
    account: GitForgeAccount,
    clientId: string,
  ): Promise<ForgeOauthStartResult> {
    const origin = forgeWebOrigin(account.kind, account.apiBaseUrl);
    const data = await this.postForm(githubDeviceCodeUrl(origin), {
      client_id: clientId,
      scope: GITHUB_OAUTH_SCOPES,
    });
    const deviceCode = str(data.device_code);
    const userCode = str(data.user_code);
    const verificationUri = str(data.verification_uri);
    if (!deviceCode || !userCode || !verificationUri) {
      throw new Error(oauthError(data, "GitHub did not return a device code"));
    }
    const interval =
      data.interval == null || data.interval === "" ? 5 : Math.max(0, num(data.interval));
    const expiresIn = Math.max(60, num(data.expires_in) || 900);
    const pending: PendingOauth = {
      accountId: account.id,
      method: "device",
      kind: "github",
      clientId,
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete: str(data.verification_uri_complete) || undefined,
      intervalMs: interval * 1000,
      nextPollAt: Date.now(),
      expiresAt: Date.now() + expiresIn * 1000,
      status: "pending",
    };
    this.byAccount.set(account.id, pending);
    return {
      method: "device",
      userCode,
      verificationUri,
      verificationUriComplete: pending.verificationUriComplete,
      expiresIn,
      interval,
    };
  }

  private async startRedirect(
    account: GitForgeAccount,
    clientId: string,
    clientSecret: string,
  ): Promise<ForgeOauthStartResult> {
    const config = await this.store.loadConfig();
    const origin = forgeWebOrigin(account.kind, account.apiBaseUrl);
    const redirectUri = forgeOauthCallbackUrl(listenPort(config));
    const state = randomBytes(24).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const authorize = new URL(redirectAuthorizeUrl(account.kind, origin));
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("scope", redirectOauthScopes(account.kind));
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    const pending: PendingOauth = {
      accountId: account.id,
      method: "redirect",
      kind: account.kind,
      clientId,
      clientSecret,
      state,
      codeVerifier,
      redirectUri,
      authorizeUrl: authorize.toString(),
      intervalMs: 2000,
      nextPollAt: 0,
      expiresAt: Date.now() + PENDING_TTL_MS,
      status: "pending",
    };
    this.byAccount.set(account.id, pending);
    this.byState.set(state, account.id);
    return {
      method: "redirect",
      authorizeUrl: pending.authorizeUrl,
      expiresIn: PENDING_TTL_MS / 1000,
    };
  }

  private async pollGitHub(pending: PendingOauth): Promise<void> {
    if (!pending.deviceCode || Date.now() < pending.nextPollAt) return;
    pending.nextPollAt = Date.now() + pending.intervalMs;
    const config = await this.store.loadConfig();
    const account = config.forges.find((row) => row.id === pending.accountId);
    if (!account) {
      pending.status = "error";
      pending.error = "Forge account was removed.";
      return;
    }
    const origin = forgeWebOrigin("github", account.apiBaseUrl);
    const data = await this.postForm(githubAccessTokenUrl(origin), {
      client_id: pending.clientId,
      device_code: pending.deviceCode,
      grant_type: DEVICE_GRANT,
    });
    const err = str(data.error);
    if (err === "authorization_pending") return;
    if (err === "slow_down") {
      pending.intervalMs += 5000;
      pending.nextPollAt = Date.now() + pending.intervalMs;
      return;
    }
    if (err === "expired_token") {
      pending.status = "expired";
      pending.error = "Sign-in expired. Try again.";
      return;
    }
    if (err === "access_denied") {
      pending.status = "error";
      pending.error = "GitHub sign-in was denied.";
      return;
    }
    if (err) {
      pending.status = "error";
      pending.error = oauthError(data, err);
      return;
    }
    const token = parseToken(data);
    if (!token.access_token) {
      pending.status = "error";
      pending.error = "GitHub did not return an access token.";
      return;
    }
    const username = await this.fetchUsername("github", pending, token.access_token);
    await this.applyAccessToken(pending.accountId, token, username);
    pending.status = "complete";
    pending.username = username;
  }

  private async exchangeRedirect(pending: PendingOauth, code: string): Promise<ParsedToken> {
    const config = await this.store.loadConfig();
    const account = config.forges.find((row) => row.id === pending.accountId);
    const origin = forgeWebOrigin(
      pending.kind,
      account?.apiBaseUrl ?? defaultForgeApiUrl(pending.kind),
    );
    const auth = forgeAuthAdapter(pending.kind);
    const form = auth.exchangeCodeForm({
      origin,
      clientId: pending.clientId,
      clientSecret: pending.clientSecret ?? "",
      code,
      redirectUri: pending.redirectUri ?? "",
      codeVerifier: pending.codeVerifier ?? "",
    });
    const data = await this.postForm(form.url, form.body, form.headers);
    const token = parseToken(data);
    if (!token.access_token)
      throw new Error(
        oauthError(data, `${forgeLabel(pending.kind)} did not return an access token`),
      );
    return token;
  }

  private async fetchUsername(
    kind: ForgeKind,
    pending: PendingOauth,
    accessToken: string,
  ): Promise<string> {
    const config = await this.store.loadConfig();
    const account = config.forges.find((row) => row.id === pending.accountId);
    const api = (account?.apiBaseUrl || defaultForgeApiUrl(kind)).replace(/\/$/, "");
    const auth = forgeAuthAdapter(kind);
    const res = await this.fetchFn(auth.usernameUrl(api), {
      headers: auth.usernameHeaders(accessToken),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const name = str(data.login) || str(data.username) || str(data.nickname);
    return name || "connected";
  }

  private async applyAccessToken(
    accountId: string,
    token: ParsedToken,
    username: string,
  ): Promise<void> {
    const config = await this.store.loadConfig();
    const account = config.forges.find((row) => row.id === accountId);
    if (!account) throw new Error("Unknown forge account");
    await this.saveAccount({
      ...account,
      token: token.access_token,
      refreshToken: token.refresh_token || undefined,
      tokenExpiresAt: expiresAtFrom(token.expires_in),
      authMethod: "oauth",
      username,
    });
  }

  private async upsertAccount(
    accountId: string,
    input: ForgeOauthStartInput,
  ): Promise<GitForgeAccount> {
    const config = await this.store.loadConfig();
    const existing = config.forges.find((row) => row.id === accountId);
    const kind = isForgeKind(input.kind) ? input.kind : existing?.kind;
    if (!kind) throw new Error("Unknown forge account");
    const next: GitForgeAccount = {
      ...(existing ?? {
        id: accountId,
        kind,
        name: input.name?.trim() || forgeLabel(kind),
        apiBaseUrl: input.apiBaseUrl?.trim() || defaultForgeApiUrl(kind),
      }),
      id: accountId,
      kind,
    };
    if (input.name?.trim()) next.name = input.name.trim();
    if (input.apiBaseUrl?.trim()) next.apiBaseUrl = input.apiBaseUrl.trim();
    if (input.oauthClientId?.trim()) next.oauthClientId = input.oauthClientId.trim();
    if (input.oauthClientSecret && !isMaskedSecret(input.oauthClientSecret)) {
      next.oauthClientSecret = input.oauthClientSecret.trim() || undefined;
    }
    await this.saveAccount(next);
    const saved = await this.store.loadConfig();
    return saved.forges.find((row) => row.id === accountId) ?? next;
  }

  private async saveAccount(account: GitForgeAccount): Promise<void> {
    const config = await this.store.loadConfig();
    await this.store.saveConfig({ ...config, forges: replaceForgeAccount(config.forges, account) });
  }

  private async postForm(
    url: string,
    body: Record<string, string>,
    headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
  ): Promise<Record<string, unknown>> {
    const res = await this.fetchFn(url, {
      method: "POST",
      headers,
      body: new URLSearchParams(body).toString(),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      const params = new URLSearchParams(text);
      const out: Record<string, unknown> = {};
      for (const [key, value] of params) out[key] = value;
      return out;
    }
  }
}

export async function withFreshForgeToken(
  store: JsonStore,
  account: GitForgeAccount,
  fetchFn: typeof fetch = fetch,
): Promise<GitForgeAccount> {
  return new ForgeOauth(store, fetchFn).withFreshToken(account);
}

interface ParsedToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

function parseToken(data: Record<string, unknown>): ParsedToken {
  return {
    access_token: str(data.access_token) || undefined,
    refresh_token: str(data.refresh_token) || undefined,
    expires_in: num(data.expires_in) || undefined,
    error: str(data.error) || undefined,
  };
}

function resolveClientId(account: GitForgeAccount, override?: string): string {
  const direct = override?.trim() || account.oauthClientId?.trim();
  if (direct) return direct;
  const env = forgeOauthClientIdEnv(account.kind);
  return env ? (process.env[env] ?? "").trim() : "";
}

function resolveClientSecret(account: GitForgeAccount, override?: string): string {
  if (override && !isMaskedSecret(override)) return override.trim();
  if (account.oauthClientSecret?.trim()) return account.oauthClientSecret.trim();
  const env = forgeOauthClientSecretEnv(account.kind);
  return env ? (process.env[env] ?? "").trim() : "";
}

function listenPort(config: LocusConfig): number {
  const fromEnv = Number(process.env.PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return config.advanced.bindPort || 7420;
}

function snapshot(pending: PendingOauth): ForgeOauthStatusResult {
  return {
    status: pending.status,
    method: pending.method,
    userCode: pending.userCode,
    verificationUri: pending.verificationUri,
    verificationUriComplete: pending.verificationUriComplete,
    authorizeUrl: pending.authorizeUrl,
    username: pending.username,
    error: pending.error,
  };
}

function expiresAtFrom(expiresIn?: number): string | undefined {
  if (!expiresIn || expiresIn <= 0) return undefined;
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function oauthError(data: Record<string, unknown>, fallback: string): string {
  return str(data.error_description) || str(data.error) || fallback;
}

function callbackPage(ok: boolean, message: string): string {
  const title = ok ? "Signed in" : "Sign-in failed";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Locus · ${escapeHtml(title)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:48px auto;max-width:36rem;color:#e8e4dc;background:#161410}a{color:#f2c14e}</style>
</head><body><p>${escapeHtml(message)}</p><p><a href="http://127.0.0.1:5173">Back to Locus</a></p>
<script>try{window.close()}catch(e){}</script>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}
