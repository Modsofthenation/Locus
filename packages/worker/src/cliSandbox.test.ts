import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockDockerEngine } from "@locus/hypervisor";
import {
  detectCliSandboxBackend,
  resolveCliSandbox,
  type CliSandboxPolicy,
  type ResolvedCliSandbox,
} from "@locus/shared/cliSandbox";
import { createWorkerApp } from "./app.js";
import { WorkerClient } from "./client.js";

const cleanup: string[] = [];
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function workerHome() {
  const home = await mkdtemp(join(tmpdir(), "locus-worker-sbx-"));
  cleanup.push(home);
  await writeFile(join(home, "token"), "WORKER-TOKEN-SECRET\n");
  await mkdir(join(home, "tls"), { recursive: true });
  await writeFile(join(home, "tls", "key.pem"), "WORKER-TLS-KEY\n");
  return home;
}

function workerApp(
  home: string,
  cliSandbox: (policy: CliSandboxPolicy) => ResolvedCliSandbox | undefined,
) {
  const engine = new MockDockerEngine(home);
  const app = createWorkerApp({
    engine,
    token: "secret",
    name: "studio",
    dataDir: home,
    cliSandbox,
  });
  const fetchFn: typeof fetch = async (input, init) =>
    app.request(String(input).replace("http://127.0.0.1:7421", ""), init);
  const client = new WorkerClient(
    { id: "w1", name: "studio", url: "http://127.0.0.1:7421", token: "secret" },
    fetchFn,
  );
  return { engine, client };
}

describe("worker CLI sandbox", () => {
  it("fails closed for Docker guests when no sandbox works", async () => {
    const home = await workerHome();
    const cliSandbox = vi.fn(() => ({ ok: false as const, reason: "No sandbox on this worker." }));
    const { engine, client } = workerApp(home, cliSandbox);
    const guest = await client.create({ sessionId: "s1", name: "agent", image: "locus/agent" });
    await expect(client.streamCursorCli(guest.id, { command: "agent", args: [] })).rejects.toThrow(
      "No sandbox on this worker.",
    );
    expect(cliSandbox).toHaveBeenCalledWith({
      locusHome: home,
      workspace: engine.get(guest.id)?.diskPath,
    });
  });

  // End to end: a real `sh` CLI on a worker Docker guest tries to read the worker token,
  // its TLS key and another guest's workspace, and must only reach its own workspace.
  const probe = detectCliSandboxBackend();
  const sandboxed = Boolean(probe.backend);
  it.runIf(process.env.LOCUS_REQUIRE_CLI_SANDBOX === "1")("has a working CLI sandbox", () => {
    expect(probe.reason).toBeUndefined();
    expect(sandboxed).toBe(true);
  });
  it.runIf(sandboxed)(
    "a worker Docker-guest CLI cannot read the worker data dir or another guest's workspace",
    async () => {
      const home = await workerHome();
      // The CLI binary lives outside the worker data dir, like a real install.
      const bin = await mkdtemp(join(tmpdir(), "locus-worker-sbx-bin-"));
      cleanup.push(bin);
      let sandbox: (policy: CliSandboxPolicy) => ResolvedCliSandbox | undefined = () => undefined;
      const { engine, client } = workerApp(home, (policy) => sandbox(policy));
      const own = await client.create({ sessionId: "s1", name: "agent", image: "locus/agent" });
      const other = await client.create({ sessionId: "s2", name: "other", image: "locus/agent" });
      const ownDisk = engine.get(own.id)!.diskPath;
      const otherDisk = engine.get(other.id)!.diskPath;
      await mkdir(ownDisk, { recursive: true });
      await mkdir(otherDisk, { recursive: true });
      await writeFile(join(otherDisk, "secret.txt"), "OTHER-GUEST-SECRET\n");

      const command = join(bin, "probe-cli");
      await writeFile(
        command,
        [
          "#!/bin/sh",
          `cat ${JSON.stringify(join(home, "token"))} 2>/dev/null || echo NO-TOKEN`,
          `cat ${JSON.stringify(join(home, "tls", "key.pem"))} 2>/dev/null || echo NO-TLS`,
          `cat ${JSON.stringify(join(otherDisk, "secret.txt"))} 2>/dev/null || echo NO-OTHER`,
          `echo "LS:$(ls ${JSON.stringify(home)} | tr '\\n' ' ')"`,
          `echo "ENV:$LOCUS_WORKER_TOKEN"`,
          "echo own > own.txt && echo WROTE-WORKSPACE",
          "",
        ].join("\n"),
      );
      await chmod(command, 0o755);
      const run = async () =>
        new Response(await client.streamCursorCli(own.id, { command, args: [] })).text();

      const prevToken = process.env.LOCUS_WORKER_TOKEN;
      process.env.LOCUS_WORKER_TOKEN = "ENV-TOKEN-SECRET";
      try {
        // Control: unsandboxed, the same CLI reads everything (this is the gap).
        const open = await run();
        expect(open).toContain("WORKER-TOKEN-SECRET");
        expect(open).toContain("WORKER-TLS-KEY");
        expect(open).toContain("OTHER-GUEST-SECRET");

        sandbox = (policy) => resolveCliSandbox(policy, { env: {} });
        const text = await run();
        expect(text).not.toContain("WORKER-TOKEN-SECRET");
        expect(text).not.toContain("WORKER-TLS-KEY");
        expect(text).not.toContain("OTHER-GUEST-SECRET");
        expect(text).not.toContain("ENV-TOKEN-SECRET");
        expect(text).toContain("NO-TOKEN");
        expect(text).toContain("NO-TLS");
        expect(text).toContain("NO-OTHER");
        // The worker home is an empty tmpfs apart from the path down to this workspace.
        expect(text).not.toMatch(/LS:.*\btoken\b/);
        expect(text).not.toMatch(/LS:.*\btls\b/);
        expect(text).toContain("WROTE-WORKSPACE");
        expect(await readFile(join(ownDisk, "own.txt"), "utf8")).toBe("own\n");
      } finally {
        if (prevToken === undefined) delete process.env.LOCUS_WORKER_TOKEN;
        else process.env.LOCUS_WORKER_TOKEN = prevToken;
      }
    },
    20_000,
  );
});
