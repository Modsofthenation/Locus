import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockHypervisor } from "@locus/hypervisor";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { Hub } from "./core/hub.js";
import { JsonStore } from "./core/store.js";
import { SessionService } from "./session/sessions.js";

const operatorToken = `op_${"e".repeat(64)}`;
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function setup(peer = "127.0.0.1") {
  const dir = await mkdtemp(join(tmpdir(), "locus-opauth-"));
  dirs.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const hypervisor = new MockHypervisor(dir);
  const sessions = new SessionService(store, hypervisor, new Hub());
  return createApp({ store, sessions, hypervisor, operatorToken, peerAddress: () => peer });
}

describe("operator token on the control plane", () => {
  it("refuses a bare loopback client on /api", async () => {
    const app = await setup();
    // What a sandboxed CLI's `curl 127.0.0.1:7420/api/sessions` used to get through with.
    expect((await app.request("/api/sessions")).status).toBe(403);
    expect((await app.request("/api/config")).status).toBe(403);
    expect(
      (await app.request("/api/sessions", { headers: { origin: "http://127.0.0.1:7420" } })).status,
    ).toBe(403);
  });

  it("serves /api with the header or the cookie", async () => {
    const app = await setup();
    const viaHeader = await app.request("/api/sessions", {
      headers: { "x-locus-operator": operatorToken },
    });
    expect(viaHeader.status).toBe(200);
    const viaCookie = await app.request("/api/sessions", {
      headers: { cookie: `locus_operator=${operatorToken}`, origin: "http://127.0.0.1:5173" },
    });
    expect(viaCookie.status).toBe(200);
  });

  it("keeps health open for launchers and probes", async () => {
    const app = await setup();
    expect((await app.request("/api/health")).status).toBe(200);
  });

  it("signs a plain browser in from ?operator= and strips it from the URL", async () => {
    const app = await setup();
    const res = await app.request(`/?operator=${operatorToken}&tab=agents`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?tab=agents");
    expect(res.headers.get("set-cookie")).toContain(`locus_operator=${operatorToken}`);
    const wrong = await app.request(`/?operator=op_${"f".repeat(64)}`);
    expect(wrong.headers.get("set-cookie") ?? "").not.toContain("locus_operator");
  });

  it("does not let a LAN peer use the operator token", async () => {
    const app = await setup("192.168.1.20");
    const res = await app.request("/api/sessions", {
      headers: { "x-locus-operator": operatorToken },
    });
    expect(res.status).toBe(403);
  });
});
