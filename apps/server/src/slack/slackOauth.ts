import { randomBytes } from "node:crypto";
import {
  SLACK_OAUTH_ACCESS,
  SLACK_STATE_PREFIX,
  isMaskedSecret,
  slackAuthorizeUrl,
  slackOauthCallbackUrl,
  slackOauthClientIdEnv,
  slackOauthClientSecretEnv,
  type IntegrationAccount,
} from "@locus/shared";
import type { JsonStore } from "../core/store.js";

const PENDING_TTL_MS = 15 * 60 * 1000;

export interface SlackOauthStartResult {
  method: "redirect";
  authorizeUrl: string;
  expiresIn: number;
}

export interface SlackOauthStatusResult {
  status: "idle" | "pending" | "complete" | "error" | "expired";
  authorizeUrl?: string;
  userName?: string;
  teamName?: string;
  error?: string;
}

type Pending = {
  accountId: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  state: string;
  expiresAt: number;
  status: "pending" | "complete" | "error" | "expired";
  error?: string;
  userName?: string;
  teamName?: string;
};

export class SlackOauth {
  private readonly byAccount = new Map<string, Pending>();
  private readonly byState = new Map<string, string>();

  constructor(
    private readonly store: JsonStore,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async start(
    accountId: string,
    input: { oauthClientId?: string; oauthClientSecret?: string } = {},
  ): Promise<SlackOauthStartResult> {
    const account = await this.requireSlack(accountId);
    const clientId = resolveClientId(account, input.oauthClientId);
    if (!clientId) {
      throw new Error(
        `Add a Slack OAuth client ID (or set ${slackOauthClientIdEnv()}). Create an app and paste the manifest from docs/slack-app-manifest.yaml.`,
      );
    }
    const clientSecret = resolveClientSecret(account, input.oauthClientSecret);
    if (!clientSecret) {
      throw new Error(`Add the Slack OAuth client secret (or set ${slackOauthClientSecretEnv()}).`);
    }
    this.cancel(accountId);
    const config = await this.store.loadConfig();
    const redirectUri = slackOauthCallbackUrl(config.advanced.bindPort);
    const state = `${SLACK_STATE_PREFIX}${randomBytes(16).toString("hex")}`;
    const pending: Pending = {
      accountId,
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
    const authorizeUrl = slackAuthorizeUrl({ clientId, redirectUri, state });
    return { method: "redirect", authorizeUrl, expiresIn: Math.floor(PENDING_TTL_MS / 1000) };
  }

  async status(accountId: string): Promise<SlackOauthStatusResult> {
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
          ? slackAuthorizeUrl({
              clientId: pending.clientId,
              redirectUri: pending.redirectUri,
              state: pending.state,
            })
          : undefined,
      userName: pending.userName,
      teamName: pending.teamName,
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
      userToken: undefined,
      userId: undefined,
      userName: undefined,
      teamId: undefined,
      teamName: undefined,
      token: undefined,
      botUserId: undefined,
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
        html: callbackPage(false, "This Slack sign-in is not pending. Return to Locus."),
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
      pending.error = "Slack did not return an authorization code.";
      return { ok: false, html: callbackPage(false, pending.error) };
    }
    try {
      const body = await this.exchange(pending, code);
      const user = body.authed_user;
      const userToken = typeof user?.access_token === "string" ? user.access_token.trim() : "";
      if (!userToken.startsWith("xoxp-")) {
        throw new Error(
          "Slack did not return a user token. Check that the app requests user scopes.",
        );
      }
      const userId = typeof user?.id === "string" ? user.id : "";
      const teamId = typeof body.team?.id === "string" ? body.team.id : "";
      const teamName = typeof body.team?.name === "string" ? body.team.name : undefined;
      const botToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
      const botUserId = typeof body.bot_user_id === "string" ? body.bot_user_id.trim() : "";
      await this.patchAccount(pending.accountId, {
        authMethod: "oauth",
        userToken,
        userId: userId || undefined,
        teamId: teamId || undefined,
        teamName,
        enabled: true,
        ...(botToken.startsWith("xoxb-") ? { token: botToken } : {}),
        ...(botUserId ? { botUserId } : {}),
      });
      pending.status = "complete";
      pending.userName = userId || "you";
      pending.teamName = teamName;
      return {
        ok: true,
        html: callbackPage(
          true,
          `Signed in to Slack${teamName ? ` · ${teamName}` : ""}. You can close this tab.`,
        ),
      };
    } catch (err) {
      pending.status = "error";
      pending.error = err instanceof Error ? err.message : "Slack sign-in failed";
      return { ok: false, html: callbackPage(false, pending.error) };
    }
  }

  private async exchange(
    pending: Pending,
    code: string,
  ): Promise<{
    access_token?: string;
    bot_user_id?: string;
    authed_user?: { id?: string; access_token?: string };
    team?: { id?: string; name?: string };
  }> {
    const res = await this.fetchFn(SLACK_OAUTH_ACCESS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: pending.clientId,
        client_secret: pending.clientSecret ?? "",
        code,
        redirect_uri: pending.redirectUri,
      }).toString(),
    });
    const data = (await res.json()) as Record<string, unknown> & {
      ok?: boolean;
      error?: string;
      access_token?: string;
      bot_user_id?: string;
      authed_user?: { id?: string; access_token?: string };
      team?: { id?: string; name?: string };
    };
    if (!res.ok || data.ok === false) {
      throw new Error(typeof data.error === "string" ? data.error : "Slack token exchange failed");
    }
    return data;
  }

  private async requireSlack(accountId: string): Promise<IntegrationAccount> {
    const config = await this.store.loadConfig();
    const account = (config.integrations ?? []).find((row) => row.id === accountId);
    if (!account || account.kind !== "slack") throw new Error("Unknown Slack account");
    return account;
  }

  private async patchAccount(
    accountId: string,
    patch: Partial<IntegrationAccount>,
  ): Promise<IntegrationAccount> {
    const config = await this.store.loadConfig();
    const integrations = [...(config.integrations ?? [])];
    const index = integrations.findIndex((row) => row.id === accountId);
    if (index < 0) throw new Error("Unknown Slack account");
    integrations[index] = { ...integrations[index]!, ...patch };
    await this.store.saveConfig({ ...config, integrations });
    return integrations[index]!;
  }
}

function resolveClientId(account: IntegrationAccount, override?: string): string {
  return (
    override?.trim() ||
    account.oauthClientId?.trim() ||
    process.env[slackOauthClientIdEnv()]?.trim() ||
    ""
  );
}

function resolveClientSecret(account: IntegrationAccount, override?: string): string {
  const fromInput = override?.trim();
  if (fromInput && !isMaskedSecret(fromInput)) return fromInput;
  return (
    account.oauthClientSecret?.trim() || process.env[slackOauthClientSecretEnv()]?.trim() || ""
  );
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
