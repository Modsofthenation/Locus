import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocusClient, readOperatorToken } from "./client.js";

const cleanups: Array<() => Promise<void>> = [];
const savedEnv = { ...process.env };
afterEach(async () => {
  process.env = { ...savedEnv };
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

async function headerEcho(): Promise<{ url: string; seen: IncomingHttpHeaders[] }> {
  const seen: IncomingHttpHeaders[] = [];
  const server = createServer((req, res) => {
    seen.push(req.headers);
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

describe("LocusClient operator token", () => {
  it("reads LOCUS_OPERATOR_TOKEN, else <LOCUS_HOME>/operator.token", async () => {
    const home = await mkdtemp(join(tmpdir(), "locus-cli-op-"));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    process.env.LOCUS_HOME = home;
    delete process.env.LOCUS_OPERATOR_TOKEN;
    expect(readOperatorToken()).toBeUndefined();
    await writeFile(join(home, "operator.token"), "op_from_file\n");
    expect(readOperatorToken()).toBe("op_from_file");
    process.env.LOCUS_OPERATOR_TOKEN = "op_from_env";
    expect(readOperatorToken()).toBe("op_from_env");
  });

  it("sends x-locus-operator on API requests", async () => {
    const echo = await headerEcho();
    const client = new LocusClient(echo.url, () => "op_test");
    await client.get("/api/sessions");
    await client.post("/api/sessions", { title: "x" });
    expect(echo.seen.map((h) => h["x-locus-operator"])).toEqual(["op_test", "op_test"]);
  });

  it("omits the header when there is no token", async () => {
    const echo = await headerEcho();
    const client = new LocusClient(echo.url, () => undefined);
    await client.get("/api/health");
    expect(echo.seen[0]?.["x-locus-operator"]).toBeUndefined();
  });

  it("builds a browser sign-in URL", () => {
    const client = new LocusClient("http://127.0.0.1:7420", () => "op_test");
    expect(client.signInUrl("/")).toBe("http://127.0.0.1:7420/?operator=op_test");
    expect(new LocusClient("http://127.0.0.1:7420", () => undefined).signInUrl("/")).toBe(
      "http://127.0.0.1:7420/",
    );
  });
});
