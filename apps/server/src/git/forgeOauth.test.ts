import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import type { GitForgeAccount } from "@locus/shared";
import { createApp } from "../app.js";
import { ForgeOauth } from "./forgeOauth.js";
import { Hub } from "../core/hub.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function setup(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const dir = await mkdtemp(join(tmpdir(), "locus-oauth-"));
  const store = new JsonStore(dir);
  await store.init();
  const config = await store.loadConfig();
  const github = config.forges.find((row) => row.kind === "github")!;
  const bitbucket = config.forges.find((row) => row.kind === "bitbucket")!;
  github.oauthClientId = "gh-client";
  bitbucket.oauthClientId = "bb-client";
  bitbucket.oauthClientSecret = "bb-secret";
  await store.saveConfig(config);
  const fetchFn: typeof fetch = async (input, init) => handler(String(input), init);
  return { dir, store, github, bitbucket, oauth: new ForgeOauth(store, fetchFn) };
}

describe("ForgeOauth", () => {
  it("runs GitHub device flow until the user authorizes", async () => {
    let polls = 0;
    const ctx = await setup((url, init) => {
      if (url.includes("/login/device/code")) {
        const body = String(init?.body ?? "");
        expect(body).toContain("client_id=gh-client");
        expect(body).toContain("scope=");
        return json({
          device_code: "dev-1",
          user_code: "WDJB-MJHT",
          verification_uri: "https://github.com/login/device",
          verification_uri_complete: "https://github.com/login/device?user_code=WDJB-MJHT",
          expires_in: 900,
          interval: 0,
        });
      }
      if (url.includes("/login/oauth/access_token")) {
        polls += 1;
        if (polls === 1) return json({ error: "authorization_pending" });
        return json({ access_token: "gho_sso", token_type: "bearer", scope: "repo" });
      }
      if (url.includes("api.github.com/user")) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer gho_sso");
        return json({ login: "octo" });
      }
      return json({ error: `unexpected ${url}` }, 500);
    });
    const started = await ctx.oauth.start(ctx.github.id, { oauthClientId: "gh-client" });
    expect(started).toMatchObject({
      method: "device",
      userCode: "WDJB-MJHT",
      verificationUri: "https://github.com/login/device",
    });
    expect((await ctx.oauth.status(ctx.github.id)).status).toBe("pending");
    const done = await ctx.oauth.status(ctx.github.id);
    expect(done).toMatchObject({ status: "complete", username: "octo" });
    const saved = await ctx.store.loadConfig();
    const account = saved.forges.find((row) => row.id === ctx.github.id)!;
    expect(account.token).toBe("gho_sso");
    expect(account.authMethod).toBe("oauth");
    expect(account.username).toBe("octo");
    const disk = JSON.parse(await readFile(join(ctx.dir, "config.json"), "utf8")) as {
      forges: GitForgeAccount[];
    };
    expect(disk.forges.find((row) => row.id === ctx.github.id)?.token).toBeFalsy();
  });

  it("exchanges a Bitbucket redirect code and stores the refresh token", async () => {
    const ctx = await setup((url, init) => {
      if (url.includes("/site/oauth2/access_token")) {
        const body = String(init?.body ?? "");
        expect(body).toContain("grant_type=authorization_code");
        expect(body).toContain("code=bb-code");
        expect(body).toContain("code_verifier=");
        const auth = new Headers(init?.headers).get("authorization") ?? "";
        expect(auth.startsWith("Basic ")).toBe(true);
        return json({
          access_token: "bb_access",
          refresh_token: "bb_refresh",
          expires_in: 7200,
        });
      }
      if (url.includes("api.bitbucket.org/2.0/user")) {
        return json({ username: "bb-user" });
      }
      return json({ error: `unexpected ${url}` }, 500);
    });
    const started = await ctx.oauth.start(ctx.bitbucket.id, {
      oauthClientId: "bb-client",
      oauthClientSecret: "bb-secret",
    });
    expect(started.method).toBe("redirect");
    expect(started.authorizeUrl).toContain("https://bitbucket.org/site/oauth2/authorize");
    expect(started.authorizeUrl).toContain("client_id=bb-client");
    expect(started.authorizeUrl).toContain("code_challenge=");
    const authorize = new URL(started.authorizeUrl!);
    const result = await ctx.oauth.handleCallback({
      code: "bb-code",
      state: authorize.searchParams.get("state") ?? "",
    });
    expect(result.ok).toBe(true);
    expect(result.html).toContain("bb-user");
    const saved = await ctx.store.loadConfig();
    const account = saved.forges.find((row) => row.id === ctx.bitbucket.id)!;
    expect(account.token).toBe("bb_access");
    expect(account.refreshToken).toBe("bb_refresh");
    expect(account.authMethod).toBe("oauth");
    expect(account.username).toBe("bb-user");
    expect(account.tokenExpiresAt).toBeTruthy();
    const disk = JSON.parse(await readFile(join(ctx.dir, "config.json"), "utf8")) as {
      forges: GitForgeAccount[];
    };
    expect(disk.forges.find((row) => row.id === ctx.bitbucket.id)?.refreshToken).toBeFalsy();
    expect(disk.forges.find((row) => row.id === ctx.bitbucket.id)?.oauthClientSecret).toBeFalsy();
  });

  it("refreshes an expired Bitbucket access token", async () => {
    const ctx = await setup((url, init) => {
      if (url.includes("/site/oauth2/access_token")) {
        const body = String(init?.body ?? "");
        expect(body).toContain("grant_type=refresh_token");
        expect(body).toContain("refresh_token=bb_refresh");
        return json({ access_token: "bb_new", refresh_token: "bb_refresh2", expires_in: 7200 });
      }
      return json({ error: `unexpected ${url}` }, 500);
    });
    const config = await ctx.store.loadConfig();
    const account: GitForgeAccount = {
      ...config.forges.find((row) => row.id === ctx.bitbucket.id)!,
      token: "bb_old",
      refreshToken: "bb_refresh",
      authMethod: "oauth",
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      oauthClientId: "bb-client",
      oauthClientSecret: "bb-secret",
    };
    await ctx.store.saveConfig({
      ...config,
      forges: config.forges.map((row) => (row.id === account.id ? account : row)),
    });
    const fresh = await ctx.oauth.withFreshToken(account);
    expect(fresh.token).toBe("bb_new");
    expect(fresh.refreshToken).toBe("bb_refresh2");
    expect((await ctx.store.loadConfig()).forges.find((row) => row.id === account.id)?.token).toBe(
      "bb_new",
    );
  });

  it("exchanges a GitLab redirect code and stores the refresh token", async () => {
    const ctx = await setup((url, init) => {
      if (url.includes("/oauth/token")) {
        const body = String(init?.body ?? "");
        expect(body).toContain("grant_type=authorization_code");
        expect(body).toContain("code=gl-code");
        expect(body).toContain("client_id=gl-client");
        expect(body).toContain("client_secret=gl-secret");
        expect(body).toContain("code_verifier=");
        return json({
          access_token: "gl_access",
          refresh_token: "gl_refresh",
          expires_in: 7200,
        });
      }
      if (url.includes("gitlab.com/api/v4/user")) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer gl_access");
        return json({ username: "gl-user" });
      }
      return json({ error: `unexpected ${url}` }, 500);
    });
    const config = await ctx.store.loadConfig();
    const gitlab = config.forges.find((row) => row.kind === "gitlab")!;
    gitlab.oauthClientId = "gl-client";
    gitlab.oauthClientSecret = "gl-secret";
    await ctx.store.saveConfig(config);
    const started = await ctx.oauth.start(gitlab.id, {
      oauthClientId: "gl-client",
      oauthClientSecret: "gl-secret",
    });
    expect(started.method).toBe("redirect");
    expect(started.authorizeUrl).toContain("https://gitlab.com/oauth/authorize");
    expect(started.authorizeUrl).toContain("client_id=gl-client");
    expect(started.authorizeUrl).toContain("scope=api");
    const authorize = new URL(started.authorizeUrl!);
    const result = await ctx.oauth.handleCallback({
      code: "gl-code",
      state: authorize.searchParams.get("state") ?? "",
    });
    expect(result.ok).toBe(true);
    expect(result.html).toContain("gl-user");
    const saved = await ctx.store.loadConfig();
    const account = saved.forges.find((row) => row.id === gitlab.id)!;
    expect(account.token).toBe("gl_access");
    expect(account.refreshToken).toBe("gl_refresh");
    expect(account.authMethod).toBe("oauth");
    expect(account.username).toBe("gl-user");
  });

  it("refuses missing client IDs", async () => {
    const ctx = await setup(() => json({}));
    const config = await ctx.store.loadConfig();
    const github = { ...ctx.github, oauthClientId: undefined };
    await ctx.store.saveConfig({
      ...config,
      forges: config.forges.map((row) => (row.id === github.id ? github : row)),
    });
    await expect(ctx.oauth.start(github.id)).rejects.toThrow(/OAuth client ID/);
  });

  it("disconnects an SSO account", async () => {
    const ctx = await setup(() => json({}));
    const config = await ctx.store.loadConfig();
    await ctx.store.saveConfig({
      ...config,
      forges: config.forges.map((row) =>
        row.id === ctx.github.id
          ? { ...row, token: "gho_x", authMethod: "oauth" as const, username: "octo" }
          : row,
      ),
    });
    await ctx.oauth.disconnect(ctx.github.id);
    const saved = await ctx.store.loadConfig();
    const account = saved.forges.find((row) => row.id === ctx.github.id)!;
    expect(account.token).toBeFalsy();
    expect(account.authMethod).toBeUndefined();
    expect(account.username).toBeUndefined();
  });

  it("exposes start, status, and callback HTTP routes", async () => {
    let polls = 0;
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/login/device/code")) {
        return json({
          device_code: "dev-1",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 0,
        });
      }
      if (url.includes("/login/oauth/access_token")) {
        polls += 1;
        if (polls === 1) return json({ error: "authorization_pending" });
        return json({ access_token: "gho_http" });
      }
      if (url.includes("api.github.com/user")) return json({ login: "http-user" });
      return json({ error: url }, 500);
    };
    const dir = await mkdtemp(join(tmpdir(), "locus-oauth-http-"));
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const app = createApp({ store, sessions, hypervisor, fetchFn });
    const config = await store.loadConfig();
    const github = config.forges.find((row) => row.kind === "github")!;
    const started = await app.request(`/api/forges/${github.id}/oauth/start`, {
      method: "POST",
      body: JSON.stringify({ oauthClientId: "gh-client" }),
    });
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ method: "device", userCode: "ABCD-EFGH" });
    const pending = await app.request(`/api/forges/${github.id}/oauth/status`);
    expect(((await pending.json()) as { status: string }).status).toBe("pending");
    const done = await app.request(`/api/forges/${github.id}/oauth/status`);
    expect(await done.json()).toMatchObject({ status: "complete", username: "http-user" });
    const redacted = (await (await app.request("/api/config")).json()) as {
      forges: GitForgeAccount[];
    };
    expect(redacted.forges.find((row) => row.id === github.id)?.token).toBe("••••••••");
    hypervisor.shutdown();
  });
});
