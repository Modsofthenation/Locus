import { randomBytes } from "node:crypto";
import {
  GOOGLE_OAUTH_TOKEN,
  GOOGLE_OAUTH_USERINFO,
  GOOGLE_STATE_PREFIX,
  googleAuthorizeUrl,
  googleOauthCallbackUrl,
  googleOauthClientIdEnv,
  googleOauthClientSecretEnv,
  googleOauthScopes,
  isGoogleIntegrationKind,
  type IntegrationAccount,
} from "@locus/shared";
import type { JsonStore } from "../core/store.js";
import { resolveGoogleClientId, resolveGoogleClientSecret } from "./google.js";

const PENDING_TTL_MS = 15 * 60 * 1000;

export interface GoogleOauthStartResult {
  method: "redirect";
  authorizeUrl: string;
  expiresIn: number;
}

export interface GoogleOauthStatusResult {
  status: "idle" | "pending" | "complete" | "error" | "expired";
  authorizeUrl?: string;
  userName?: string;
  error?: string;
}

type Pending = {
  accountId: string;
  kind: IntegrationAccount["kind"];
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  state: string;
  expiresAt: number;
  status: "pending" | "complete" | "error" | "expired";
  error?: string;
  userName?: string;
};

export class GoogleOauth {
  private readonly byAccount = new Map<string, Pending>();
  private readonly byState = new Map<string, string>();

  constructor(
    private readonly store: JsonStore,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async start(
    accountId: string,
    input: { oauthClientId?: string; oauthClientSecret?: string } = {},
  ): Promise<GoogleOauthStartResult> {
    const account = await this.requireGoogle(accountId);
    const clientId = resolveGoogleClientId(account, input.oauthClientId);
    if (!clientId) {
      throw new Error(
        `Add a Google OAuth client ID (or set ${googleOauthClientIdEnv()}). Create a Desktop or Web client in Google Cloud with redirect ${googleOauthCallbackUrl()}.`,
      );
    }
    const clientSecret = resolveGoogleClientSecret(account, input.oauthClientSecret);
    if (!clientSecret) {
      throw new Error(
        `Add the Google OAuth client secret (or set ${googleOauthClientSecretEnv()}).`,
      );
    }
    this.cancel(accountId);
    const config = await this.store.loadConfig();
    const redirectUri = googleOauthCallbackUrl(config.advanced.bindPort);
    const state = `${GOOGLE_STATE_PREFIX}${randomBytes(16).toString("hex")}`;
    const pending: Pending = {
      accountId,
      kind: account.kind,
      clientId,
      clientSecret,
      redirectUri,
      state,
      expiresAt: Date.now() + PENDING_TTL_MS,
      status: "pending",
    };
    this.byAccount.set(accountId, pending);
    this.byState.set(state, accountId);
    if (input.oauthClientId || input.oauthClientSecret) {
      await this.patchAccount(accountId, {
        oauthClientId: clientId,
        oauthClientSecret: clientSecret,
      });
    }
    const authorizeUrl = googleAuthorizeUrl({
      clientId,
      redirectUri,
      state,
      scopes: googleOauthScopes(account.kind),
    });
    return { method: "redirect", authorizeUrl, expiresIn: Math.floor(PENDING_TTL_MS / 1000) };
  }

  async status(accountId: string): Promise<GoogleOauthStatusResult> {
    const pending = this.byAccount.get(accountId);
    if (!pending) return { status: "idle" };
    if (pending.status === "pending" && Date.now() >= pending.expiresAt) {
      pending.status = "expired";
      pending.error = "Sign-in expired. Try again.";
    }
    return {
      status: pending.status,
      authorizeUrl:
        pending.status === "pending"
          ? googleAuthorizeUrl({
              clientId: pending.clientId,
              redirectUri: pending.redirectUri,
              state: pending.state,
              scopes: googleOauthScopes(pending.kind),
            })
          : undefined,
      userName: pending.userName,
      error: pending.error,
    };
  }

  cancel(accountId: string): void {
    const pending = this.byAccount.get(accountId);
    if (pending?.state) this.byState.delete(pending.state);
    this.byAccount.delete(accountId);
  }

  async disconnect(accountId: string): Promise<IntegrationAccount> {
    this.cancel(accountId);
    return this.patchAccount(accountId, {
      authMethod: undefined,
      token: undefined,
      refreshToken: undefined,
      tokenExpiresAt: undefined,
      userId: undefined,
      userName: undefined,
    });
  }

  ownsState(state: string | undefined): boolean {
    return Boolean(state && this.byState.has(state));
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
    if (!pending) {
      return {
        ok: false,
        html: callbackPage(false, "This Google sign-in is not pending. Return to Locus."),
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
      pending.error = "Google did not return an authorization code.";
      return { ok: false, html: callbackPage(false, pending.error) };
    }
    try {
      const tokens = await this.exchange(pending, code);
      const user = await this.userInfo(tokens.access_token);
      await this.patchAccount(pending.accountId, {
        authMethod: "oauth",
        enabled: true,
        token: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        tokenExpiresAt: Date.now() + Math.max(60, tokens.expires_in - 60) * 1000,
        userId: user.id,
        userName: user.email || user.name,
        oauthClientId: pending.clientId,
        oauthClientSecret: pending.clientSecret,
      });
      pending.status = "complete";
      pending.userName = user.email || user.name || "you";
      return {
        ok: true,
        html: callbackPage(
          true,
          `Signed in to Google${pending.userName ? ` as ${pending.userName}` : ""}. You can close this tab.`,
        ),
      };
    } catch (err) {
      pending.status = "error";
      pending.error = err instanceof Error ? err.message : "Google sign-in failed";
      return { ok: false, html: callbackPage(false, pending.error) };
    }
  }

  private async exchange(
    pending: Pending,
    code: string,
  ): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
    const res = await this.fetchFn(GOOGLE_OAUTH_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: pending.clientId,
        client_secret: pending.clientSecret ?? "",
        code,
        redirect_uri: pending.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !data.access_token?.trim()) {
      throw new Error(data.error_description || data.error || "Google token exchange failed");
    }
    return {
      access_token: data.access_token.trim(),
      refresh_token: data.refresh_token?.trim(),
      expires_in: typeof data.expires_in === "number" ? data.expires_in : 3600,
    };
  }

  private async userInfo(
    accessToken: string,
  ): Promise<{ id?: string; email?: string; name?: string }> {
    const res = await this.fetchFn(GOOGLE_OAUTH_USERINFO, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      email?: string;
      name?: string;
    };
    if (!res.ok) return {};
    return {
      id: typeof data.id === "string" ? data.id.trim() : undefined,
      email: typeof data.email === "string" ? data.email.trim() : undefined,
      name: typeof data.name === "string" ? data.name.trim() : undefined,
    };
  }

  private async requireGoogle(accountId: string): Promise<IntegrationAccount> {
    const config = await this.store.loadConfig();
    const account = (config.integrations ?? []).find((row) => row.id === accountId);
    if (!account || !isGoogleIntegrationKind(account.kind)) {
      throw new Error("Unknown Google account");
    }
    return account;
  }

  private async patchAccount(
    accountId: string,
    patch: Partial<IntegrationAccount>,
  ): Promise<IntegrationAccount> {
    const config = await this.store.loadConfig();
    const integrations = [...(config.integrations ?? [])];
    const index = integrations.findIndex((row) => row.id === accountId);
    if (index < 0) throw new Error("Unknown Google account");
    const next = { ...integrations[index]!, ...patch };
    for (const key of ["token", "refreshToken", "tokenExpiresAt", "userId", "userName"] as const) {
      if (key in patch && patch[key] === undefined) delete next[key];
    }
    if ("authMethod" in patch && patch.authMethod === undefined) delete next.authMethod;
    integrations[index] = next;
    await this.store.saveConfig({ ...config, integrations });
    return integrations[index]!;
  }
}

export function persistIntegrationAccount(
  store: JsonStore,
): (id: string, patch: Partial<IntegrationAccount>) => Promise<void> {
  return async (id, patch) => {
    const config = await store.loadConfig();
    const integrations = [...(config.integrations ?? [])];
    const index = integrations.findIndex((row) => row.id === id);
    if (index < 0) return;
    integrations[index] = { ...integrations[index]!, ...patch };
    await store.saveConfig({ ...config, integrations });
  };
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
