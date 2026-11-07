import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "../session/sessions.js";

async function* quietEngine() {
  yield { type: "text" as const, text: "ok" };
}

describe("Google OAuth", () => {
  it("exchanges a code and stores the access plus refresh tokens", async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "ya29.from-oauth",
            refresh_token: "1//from-oauth",
            expires_in: 3600,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (String(url).includes("oauth2/v2/userinfo")) {
        return new Response(JSON.stringify({ id: "123", email: "you@acme.com", name: "You" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected ${String(url)}`);
    };
    const dir = await mkdtemp(join(tmpdir(), "locus-google-oauth-"));
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    const hub = new Hub();
    const sessions = new SessionService(store, hypervisor, hub, quietEngine);
    const app = createApp({ store, sessions, hypervisor, hub, fetchFn });
    const config = await store.loadConfig();
    config.integrations = [
      {
        id: "gm1",
        kind: "gmail",
        name: "Gmail",
        enabled: true,
        baseUrl: "https://gmail.googleapis.com",
        oauthClientId: "cid.apps.googleusercontent.com",
        oauthClientSecret: "csecret",
      },
    ];
    await store.saveConfig(config);
    const start = await app.request("/api/google/oauth/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "gm1" }),
    });
    expect(start.status).toBe(200);
    const started = (await start.json()) as { authorizeUrl: string };
    expect(started.authorizeUrl).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(started.authorizeUrl).toContain("access_type=offline");
    expect(started.authorizeUrl).toContain(encodeURIComponent("gmail.readonly"));
    const state = new URL(started.authorizeUrl).searchParams.get("state") ?? "";
    expect(state.startsWith("google.")).toBe(true);
    const callback = await app.request(
      `/api/oauth/callback?code=abc&state=${encodeURIComponent(state)}`,
    );
    expect(callback.status).toBe(200);
    expect(calls.some((row) => row.includes("oauth2.googleapis.com/token"))).toBe(true);
    expect(calls.some((row) => row.includes("userinfo"))).toBe(true);
    const saved = await store.loadConfig();
    expect(saved.integrations?.[0]?.token).toBe("ya29.from-oauth");
    expect(saved.integrations?.[0]?.refreshToken).toBe("1//from-oauth");
    expect(saved.integrations?.[0]?.userName).toBe("you@acme.com");
    expect(saved.integrations?.[0]?.authMethod).toBe("oauth");
  });
});
