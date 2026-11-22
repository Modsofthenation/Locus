import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, ChatMessage, LocusConfig } from "@locus/shared";
import { spawnGenericCli, type CursorCliSpawnRequest } from "@locus/providers";
import {
  cliThreadState,
  runHostCliTurn,
  type HostCliTurnInput,
  type HostCliKind,
} from "./hostCliTurn.js";
import type { HostCliTurnPorts } from "./hostCliTurn.js";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { MockHypervisor } from "@locus/hypervisor";
import { detectCliSandboxBackend, resolveCliSandbox } from "./cliSandbox.js";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "./sessions.js";
import { CliMcpGateway } from "../http/cliMcpGateway.js";
import { sessionMcpHandler } from "../http/mcpRoutes.js";

function session(partial: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "Agent",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    status: "running",
    os: "ubuntu",
    templateId: "host",
    runtime: "host",
    providerId: "claude",
    model: "opus",
    messages: [],
    ...partial,
  } as AgentSession;
}

function ports(overrides: Partial<HostCliTurnPorts> = {}): HostCliTurnPorts {
  const messages: ChatMessage[] = [];
  const row = session();
  return {
    require: async () => ({ ...row, messages }),
    loadConfig: async () =>
      ({
        providers: [],
        integrations: [],
        advanced: { bindPort: 7420 },
      }) as unknown as LocusConfig,
    dataDir: "/tmp/locus-test",
    appendMessage: async (_id, message) => {
      messages.push(message);
    },
    patch: async () => undefined,
    patchMeta: async () => row,
    isWorkerSession: () => false,
    workspaceRoot: () => "/tmp/ws",
    writeWorkspace: async () => undefined,
    cursorCliSpawner: () => {
      throw new Error("unused");
    },
    claudeCodeSpawner: () => {
      throw new Error("unused");
    },
    codexCliSpawner: () => {
      throw new Error("unused");
    },
    kiroCliSpawner: () => {
      throw new Error("unused");
    },
    genericCliSpawner: () => {
      throw new Error("unused");
    },
    requireWorker: async () => {
      throw new Error("no worker");
    },
    spawnOnWorker: () => {
      throw new Error("unused");
    },
    primeGameTurn: async () => "",
    snapshotStudioBaseline: async () => undefined,
    primeAssetTurn: async () => "",
    primeDesignTurn: async () => "",
    cursorCliAttachmentNote: async () => "",
    recordCursorCliContext: async () => undefined,
    spawnAborts: new Map(),
    cliGitTurns: new Map(),
    traces: { write: async () => undefined },
    appendThinking: async () => undefined,
    clearThinking: () => undefined,
    appendDelta: async () => undefined,
    applyCursorCliUsage: async () => undefined,
    upsertCursorToolCall: async () => undefined,
    applyCursorRunResult: async () => undefined,
    hasSteerAfter: async () => false,
    continueAfterCliRound: async () => ({ stop: true }),
    now: () => "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("runHostCliTurn", () => {
  it("appends a missing-provider note and stops", async () => {
    const append = vi.fn();
    const result = await runHostCliTurn(
      ports({
        appendMessage: async (_id, message) => {
          append(message.content);
        },
      }),
      {
        sessionId: "s1",
        userText: "hi",
        abort: new AbortController(),
        turnId: "t1",
        planTurn: false,
        stop: () => false,
        kind: "claude",
      },
    );
    expect(result).toBe("");
    expect(append.mock.calls[0]?.[0]).toMatch(/Claude Code provider is not configured/);
  });

  it("refuses a VM workspace without SSH", async () => {
    const append = vi.fn();
    const result = await runHostCliTurn(
      ports({
        require: async () => session({ runtime: "vm", providerId: "claude" }),
        loadConfig: async () =>
          ({
            providers: [{ id: "claude", kind: "claude-code", enabled: true }],
            integrations: [],
            advanced: { bindPort: 7420 },
          }) as unknown as LocusConfig,
        appendMessage: async (_id, message) => {
          append(message.content);
        },
      }),
      {
        sessionId: "s1",
        userText: "hi",
        abort: new AbortController(),
        turnId: "t1",
        planTurn: false,
        stop: () => false,
        kind: "claude",
      },
    );
    expect(result).toBe("");
    expect(append.mock.calls[0]?.[0]).toMatch(/running guest with SSH/);
  });

  it("spawns Claude Code over SSH on a Linux VM", async () => {
    const spawnOverSsh = vi.fn(() => ({
      lines: (async function* () {
        yield JSON.stringify({ type: "system", subtype: "init", session_id: "vm-cli" });
        yield JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "hi from vm" }] },
        });
        yield JSON.stringify({ type: "result", subtype: "success", result: "hi from vm" });
      })(),
      wait: async () => ({ code: 0, stderr: "" }),
      kill: () => undefined,
    }));
    const written: string[] = [];
    const result = await runHostCliTurn(
      ports({
        require: async () => session({ runtime: "vm", providerId: "claude" }),
        loadConfig: async () =>
          ({
            providers: [{ id: "claude", kind: "claude-code", enabled: true }],
            integrations: [],
            advanced: { bindPort: 7420 },
          }) as unknown as LocusConfig,
        guestSsh: async () => ({ host: "127.0.0.1", port: 2222, username: "locus" }),
        spawnOverSsh,
        writeWorkspace: async (_id, rel) => {
          written.push(rel);
        },
        claudeCodeSpawner: () => {
          throw new Error("must not spawn on the host");
        },
      }),
      {
        sessionId: "s1",
        userText: "hi",
        abort: new AbortController(),
        turnId: "t1",
        planTurn: false,
        stop: () => false,
        kind: "claude",
      },
    );
    expect(spawnOverSsh).toHaveBeenCalled();
    expect(written).toContain(".mcp.json");
    expect(result).toBeTruthy();
  });

  it("runs a Custom CLI agent, writes Gemini MCP on a VM, and stores the resume id", async () => {
    const spawnOverSsh = vi.fn((_target: unknown, req: { command: string; args: string[] }) => {
      expect(req.command).toBe("gemini");
      expect(req.args).toEqual([
        "-p",
        "hi",
        "-m",
        "gemini-2.5-pro",
        "--output-format",
        "stream-json",
      ]);
      return {
        lines: (async function* () {
          yield JSON.stringify({ type: "init", session_id: "gem-1" });
          yield JSON.stringify({ type: "message", role: "assistant", content: "ok", delta: true });
          yield JSON.stringify({ type: "result", status: "success" });
        })(),
        wait: async () => ({ code: 0, stderr: "" }),
        kill: () => undefined,
      };
    });
    const written: string[] = [];
    const patches: unknown[] = [];
    const deltas: string[] = [];
    await runHostCliTurn(
      ports({
        require: async () => session({ runtime: "vm", providerId: "gem", model: "gemini-2.5-pro" }),
        loadConfig: async () =>
          ({
            providers: [
              {
                id: "gem",
                name: "Gemini CLI",
                kind: "cli-agent",
                enabled: true,
                cli: {
                  command: "gemini",
                  args: ["-p", "{prompt}", "-m", "{model}", "--output-format", "stream-json"],
                  output: "jsonl",
                  preset: "gemini",
                },
              },
            ],
            integrations: [],
            advanced: { bindPort: 7420 },
          }) as unknown as LocusConfig,
        guestSsh: async () => ({ host: "127.0.0.1", port: 2222, username: "locus" }),
        spawnOverSsh: spawnOverSsh as unknown as HostCliTurnPorts["spawnOverSsh"],
        writeWorkspace: async (_id, rel) => {
          written.push(rel);
        },
        patch: async (_id, body) => {
          patches.push(body);
        },
        appendDelta: async (_id, _reply, delta) => {
          deltas.push(delta);
        },
      }),
      {
        sessionId: "s1",
        userText: "hi",
        abort: new AbortController(),
        turnId: "t1",
        planTurn: false,
        stop: () => false,
        kind: "generic",
      },
    );
    expect(spawnOverSsh).toHaveBeenCalled();
    expect(written).toContain(".gemini/settings.json");
    expect(patches).toContainEqual({ genericCli: { sessionId: "gem-1" } });
    expect(deltas.join("")).toBe("ok");
  });

  it("appends a missing Custom CLI agent note for a non-cli provider", async () => {
    const append = vi.fn();
    await runHostCliTurn(
      ports({
        appendMessage: async (_id, message) => {
          append(message.content);
        },
      }),
      {
        sessionId: "s1",
        userText: "hi",
        abort: new AbortController(),
        turnId: "t1",
        planTurn: false,
        stop: () => false,
        kind: "generic",
      },
    );
    expect(append.mock.calls[0]?.[0]).toMatch(/Custom CLI agent provider is not configured/);
  });

  it("appends a missing Kiro CLI provider note and stops", async () => {
    const append = vi.fn();
    const result = await runHostCliTurn(
      ports({
        appendMessage: async (_id, message) => {
          append(message.content);
        },
      }),
      {
        sessionId: "s1",
        userText: "hi",
        abort: new AbortController(),
        turnId: "t1",
        planTurn: false,
        stop: () => false,
        kind: "kiro",
      },
    );
    expect(result).toBe("");
    expect(append.mock.calls[0]?.[0]).toMatch(/Kiro CLI provider is not configured/);
  });
});

const CLI_PROVIDERS: Record<HostCliKind, Record<string, unknown>> = {
  cursor: { id: "p", kind: "cursor-cli", enabled: true, models: [] },
  claude: { id: "p", kind: "claude-code", enabled: true, models: [] },
  codex: { id: "p", kind: "codex-cli", enabled: true, models: [] },
  kiro: { id: "p", kind: "kiro-cli", enabled: true, models: [] },
  generic: {
    id: "p",
    name: "Shell",
    kind: "cli-agent",
    enabled: true,
    models: [],
    cli: { command: "sh", args: ["-c", "echo {prompt}"], output: "text" },
  },
};

function turn(kind: HostCliKind, userText = "hi"): HostCliTurnInput {
  return {
    sessionId: "s1",
    userText,
    abort: new AbortController(),
    turnId: "t1",
    planTurn: false,
    stop: () => false,
    kind,
  };
}

describe("runHostCliTurn Docker sandbox", () => {
  const cleanup: string[] = [];
  afterEach(async () => {
    while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true });
  });

  async function locusHome() {
    const home = await mkdtemp(join(tmpdir(), "locus-cli-sbx-"));
    cleanup.push(home);
    const workspace = join(home, "docker-workspaces", "s1");
    const otherAttachments = join(home, "attachments", "other-session");
    await mkdir(workspace, { recursive: true });
    await mkdir(otherAttachments, { recursive: true });
    await writeFile(join(home, "config.json"), '{"token":"LOCUS-CONFIG-SECRET"}\n');
    await writeFile(join(otherAttachments, "Clipboard.txt"), "OTHER-SESSION-SECRET\n");
    return { home, workspace, otherAttachments };
  }

  function dockerPorts(
    home: string,
    workspace: string,
    kind: HostCliKind,
    overrides: Partial<HostCliTurnPorts> = {},
  ): HostCliTurnPorts {
    const docker = session({ runtime: "docker", templateId: "docker", providerId: "p" });
    return ports({
      require: async () => docker,
      loadConfig: async () =>
        ({
          providers: [CLI_PROVIDERS[kind]],
          integrations: [],
          advanced: { bindPort: 7420 },
        }) as unknown as LocusConfig,
      dataDir: home,
      workspaceRoot: () => workspace,
      ...overrides,
    });
  }

  for (const kind of ["cursor", "claude", "codex", "kiro", "generic"] as const) {
    it(`sandboxes the host spawn of ${kind} on a Docker session`, async () => {
      const { home, workspace } = await locusHome();
      const spawned: CursorCliSpawnRequest[] = [];
      const fake = (req: CursorCliSpawnRequest) => {
        spawned.push(req);
        return {
          lines: (async function* () {})(),
          wait: async () => ({ code: 0, stderr: "" }),
          kill: () => undefined,
        };
      };
      const policies: unknown[] = [];
      await runHostCliTurn(
        dockerPorts(home, workspace, kind, {
          cursorCliSpawner: () => fake,
          claudeCodeSpawner: () => fake,
          codexCliSpawner: () => fake,
          kiroCliSpawner: () => fake,
          genericCliSpawner: () => fake,
          cliSandbox: (policy) => {
            policies.push(policy);
            return {
              ok: true,
              backend: "bwrap",
              isolatesNetwork: true,
              wrap: (spawn) => (req) =>
                spawn({ ...req, command: "sandboxed", args: [req.command] }),
            };
          },
        }),
        turn(kind),
      );
      expect(policies).toEqual([{ locusHome: home, workspace, loopbackPorts: [] }]);
      expect(spawned.length).toBeGreaterThan(0);
      expect(spawned.every((req) => req.command === "sandboxed")).toBe(true);
    });
  }

  it("hands a sandboxed CLI the gateway MCP URL, forwards only its port, and revokes it", async () => {
    const { home, workspace } = await locusHome();
    const fake = () => ({
      lines: (async function* () {})(),
      wait: async () => ({ code: 0, stderr: "" }),
      kill: () => undefined,
    });
    const revoke = vi.fn();
    const grantUrl = "http://127.0.0.1:41234/mcp/sessions/s1/tok";
    const policies: unknown[] = [];
    await runHostCliTurn(
      dockerPorts(home, workspace, "claude", {
        claudeCodeSpawner: () => fake,
        cliMcpGrant: async () => ({ url: grantUrl, port: 41234, revoke }),
        cliSandbox: (policy) => {
          policies.push(policy);
          return { ok: true, backend: "bwrap", isolatesNetwork: true, wrap: (spawn) => spawn };
        },
      }),
      turn("claude"),
    );
    expect(policies).toEqual([{ locusHome: home, workspace, loopbackPorts: [41234] }]);
    const mcp = JSON.parse(await readFile(join(workspace, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, { url: string }>;
    };
    expect(mcp.mcpServers.locus?.url).toBe(grantUrl);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("refuses the turn when no sandbox is available", async () => {
    const { home, workspace } = await locusHome();
    const notes: string[] = [];
    const spawner = vi.fn();
    const result = await runHostCliTurn(
      dockerPorts(home, workspace, "claude", {
        claudeCodeSpawner: () => spawner,
        appendMessage: async (_id, message) => {
          notes.push(message.content);
        },
        cliSandbox: () => ({ ok: false, reason: "No sandbox here." }),
      }),
      turn("claude"),
    );
    expect(result).toBe("");
    expect(spawner).not.toHaveBeenCalled();
    expect(notes).toEqual(["No sandbox here."]);
  });

  describe("local VM sessions", () => {
    function vmPorts(kind: HostCliKind, overrides: Partial<HostCliTurnPorts> = {}) {
      return ports({
        require: async () =>
          session({ runtime: "vm", templateId: "ubuntu", providerId: "p", model: "m" }),
        loadConfig: async () =>
          ({
            providers: [CLI_PROVIDERS[kind]],
            integrations: [],
            advanced: { bindPort: 7420 },
          }) as unknown as LocusConfig,
        guestSsh: async () => ({ host: "127.0.0.1", port: 2222, username: "locus" }),
        ...overrides,
      });
    }

    for (const kind of ["claude", "codex"] as const) {
      it(`forwards the guest's MCP port to the gateway, not the control plane (${kind})`, async () => {
        const revoke = vi.fn();
        const events: string[] = [];
        const forwards: unknown[] = [];
        const envs: (NodeJS.ProcessEnv | undefined)[] = [];
        const files = new Map<string, string>();
        await runHostCliTurn(
          vmPorts(kind, {
            cliMcpGrant: async (sessionId) => ({
              url: `http://127.0.0.1:41234/mcp/sessions/${sessionId}/tok`,
              port: 41234,
              revoke: () => {
                events.push("revoke");
                revoke();
              },
            }),
            writeWorkspace: async (_id, rel, body) => {
              files.set(rel, body);
            },
            spawnOverSsh: (_target, req, extra) => {
              events.push("spawn");
              forwards.push(...(extra?.reverseForwards ?? []));
              envs.push(req.env);
              return {
                lines: (async function* () {})(),
                wait: async () => ({ code: 0, stderr: "" }),
                kill: () => undefined,
              };
            },
          }),
          turn(kind),
        );
        // The guest still listens on <bindPort>, but it reaches the gateway, never 7420.
        expect(forwards.length).toBeGreaterThan(0);
        expect(new Set(forwards.map((f) => JSON.stringify(f)))).toEqual(
          new Set([JSON.stringify({ listenPort: 7420, hostPort: 41234 })]),
        );
        const guestUrl = "http://127.0.0.1:7420/mcp/sessions/s1/tok";
        if (kind === "claude") {
          const mcp = JSON.parse(files.get(".mcp.json") ?? "{}") as {
            mcpServers?: Record<string, { url: string }>;
          };
          expect(mcp.mcpServers?.locus?.url).toBe(guestUrl);
        } else {
          expect(envs.every((env) => env?.LOCUS_GIT_MCP_URL === guestUrl)).toBe(true);
        }
        expect(revoke).toHaveBeenCalledTimes(1);
        expect(events.at(-1)).toBe("revoke");
      });
    }

    it("forwards nothing without a gateway grant", async () => {
      const forwards: unknown[] = [];
      await runHostCliTurn(
        vmPorts("claude", {
          spawnOverSsh: (_target, _req, extra) => {
            forwards.push(...(extra?.reverseForwards ?? []));
            return {
              lines: (async function* () {})(),
              wait: async () => ({ code: 0, stderr: "" }),
              kill: () => undefined,
            };
          },
        }),
        turn("claude"),
      );
      expect(forwards).toEqual([]);
    });
  });

  it("leaves Host-runtime sessions unsandboxed", async () => {
    const { home, workspace } = await locusHome();
    const cliSandbox = vi.fn();
    const fake = vi.fn(() => ({
      lines: (async function* () {})(),
      wait: async () => ({ code: 0, stderr: "" }),
    }));
    await runHostCliTurn(
      ports({
        loadConfig: async () =>
          ({
            providers: [CLI_PROVIDERS.claude],
            integrations: [],
            advanced: { bindPort: 7420 },
          }) as unknown as LocusConfig,
        require: async () => session({ runtime: "host", providerId: "p" }),
        dataDir: home,
        workspaceRoot: () => workspace,
        claudeCodeSpawner: () => fake,
        cliSandbox,
      }),
      turn("claude"),
    );
    expect(cliSandbox).not.toHaveBeenCalled();
    expect(fake).toHaveBeenCalled();
  });

  // End to end: a real CLI process (a Custom CLI agent running `sh`) on a Docker
  // session tries what the Kiro trace did — read Locus config and another session's
  // attachments — and must only reach its own workspace.
  const probe = detectCliSandboxBackend();
  const sandboxed = Boolean(probe.backend);
  // CI installs bubblewrap and sets this so the end-to-end test cannot silently skip.
  it.runIf(process.env.LOCUS_REQUIRE_CLI_SANDBOX === "1")("has a working CLI sandbox", () => {
    expect(probe.reason).toBeUndefined();
    expect(sandboxed).toBe(true);
  });
  it.runIf(sandboxed)(
    "a host-spawned CLI on a Docker session cannot read LOCUS_HOME config or other sessions",
    async () => {
      const { home, workspace, otherAttachments } = await locusHome();
      const script = [
        `cat ${JSON.stringify(join(home, "config.json"))} 2>/dev/null || echo NO-CONFIG`,
        `cat ${JSON.stringify(join(otherAttachments, "Clipboard.txt"))} 2>/dev/null || echo NO-ATTACHMENT`,
        `ls ${JSON.stringify(home)}`,
        "echo own > own.txt && echo WROTE-WORKSPACE",
      ].join("; ");
      const provider = {
        ...CLI_PROVIDERS.generic,
        cli: { command: "sh", args: ["-c", script, "sh", "{prompt}"], output: "text" },
      };
      const out: string[] = [];
      const run = (cliSandbox: HostCliTurnPorts["cliSandbox"]) =>
        runHostCliTurn(
          dockerPorts(home, workspace, "generic", {
            loadConfig: async () =>
              ({
                providers: [provider],
                integrations: [],
                advanced: { bindPort: 7420 },
              }) as unknown as LocusConfig,
            genericCliSpawner: () => spawnGenericCli,
            appendDelta: async (_id, _reply, delta) => {
              out.push(delta);
            },
            cliSandbox,
          }),
          turn("generic"),
        );

      // Control: unsandboxed, the same CLI reads everything (this is the bug).
      await run(() => undefined);
      expect(out.join("")).toContain("LOCUS-CONFIG-SECRET");
      expect(out.join("")).toContain("OTHER-SESSION-SECRET");

      out.length = 0;
      await run((policy) => resolveCliSandbox(policy, { env: {} }));
      const text = out.join("");
      expect(text).not.toContain("LOCUS-CONFIG-SECRET");
      expect(text).not.toContain("OTHER-SESSION-SECRET");
      expect(text).toContain("NO-CONFIG");
      expect(text).toContain("NO-ATTACHMENT");
      expect(text).not.toMatch(/\battachments\b/);
      expect(text).toContain("WROTE-WORKSPACE");
      expect(await readFile(join(workspace, "own.txt"), "utf8")).toBe("own\n");
    },
    20_000,
  );

  // End to end: the same CLI tries to read another session's transcript through the
  // control plane's HTTP API, which trusts loopback clients as the operator. Sandboxed,
  // it can reach only its own session's MCP on the gateway.
  it.runIf(sandboxed)(
    "a sandboxed CLI cannot read /api/sessions for another session",
    async () => {
      const { home, workspace } = await locusHome();
      const store = new JsonStore(home);
      await store.init();
      const base = { createdAt: "2026-01-01", updatedAt: "2026-01-01", status: "idle" };
      await store.saveSessions([
        session({
          ...base,
          id: "victim",
          title: "Victim",
          messages: [{ id: "m1", role: "user", content: "VICTIM-SECRET", createdAt: "2026-01-01" }],
        } as Partial<AgentSession>),
        session({
          ...base,
          id: "s1",
          runtime: "docker",
          templateId: "docker",
        } as Partial<AgentSession>),
      ]);
      const hypervisor = new MockHypervisor(home);
      const sessions = new SessionService(store, hypervisor, new Hub());
      const app = createApp({ store, sessions, hypervisor });
      const servers: Server[] = [];
      const listen = (fetch: typeof app.fetch) =>
        new Promise<number>((resolve) => {
          const server = createServer(getRequestListener(fetch));
          servers.push(server);
          server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
        });
      const controlPlane = await listen(app.fetch);
      const gateway = new CliMcpGateway(sessionMcpHandler({ store, sessions }));
      try {
        // Sanity: from outside any sandbox, loopback is the operator.
        const direct = await fetch(`http://127.0.0.1:${controlPlane}/api/sessions/victim`);
        expect(await direct.text()).toContain("VICTIM-SECRET");

        const cp = `http://127.0.0.1:${controlPlane}`;
        const rpc = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
        const script = `
          const fs = require("fs");
          const out = [];
          async function hit(label, url, init) {
            try {
              const res = await fetch(url, { ...init, signal: AbortSignal.timeout(3000) });
              out.push(label + ":" + res.status + ":" + (await res.text()).slice(0, 4000));
            } catch {
              out.push(label + ":BLOCKED");
            }
          }
          (async () => {
            await hit("CP-SESSION", ${JSON.stringify(`${cp}/api/sessions/victim`)});
            await hit("CP-LIST", ${JSON.stringify(`${cp}/api/sessions`)});
            await hit("CP-ORIGIN", ${JSON.stringify(`${cp}/api/sessions/victim`)}, {
              headers: { origin: ${JSON.stringify(cp)} },
            });
            let mcp;
            try { mcp = fs.readFileSync("mcp-url.txt", "utf8").trim(); } catch {}
            if (mcp) {
              const post = { method: "POST", headers: { "content-type": "application/json" }, body: ${JSON.stringify(rpc)} };
              await hit("GW-API", new URL(mcp).origin + "/api/sessions/victim");
              await hit("GW-OTHER", mcp.replace("/sessions/s1/", "/sessions/victim/"), post);
              await hit("GW-OWN", mcp, post);
            }
            console.log(out.join("\\n"));
          })();
        `;
        const provider = {
          ...CLI_PROVIDERS.generic,
          cli: { command: process.execPath, args: ["-e", script, "{prompt}"], output: "text" },
        };
        const out: string[] = [];
        const run = (cliSandbox: HostCliTurnPorts["cliSandbox"]) =>
          runHostCliTurn(
            dockerPorts(home, workspace, "generic", {
              loadConfig: async () =>
                ({
                  providers: [provider],
                  integrations: [],
                  advanced: { bindPort: controlPlane },
                }) as unknown as LocusConfig,
              genericCliSpawner: () => spawnGenericCli,
              appendDelta: async (_id, _reply, delta) => {
                out.push(delta);
              },
              cliMcpGrant: async (sessionId) => {
                const grant = await gateway.issue(sessionId);
                await writeFile(join(workspace, "mcp-url.txt"), grant.url);
                return grant;
              },
              cliSandbox,
            }),
            turn("generic"),
          );

        // Control: unsandboxed, the CLI reads the other session's transcript (this is the bug).
        await run(() => undefined);
        expect(out.join("")).toContain("VICTIM-SECRET");

        out.length = 0;
        await run((policy) => resolveCliSandbox(policy, { env: {} }));
        const text = out.join("");
        expect(text).not.toContain("VICTIM-SECRET");
        expect(text).toContain("CP-SESSION:BLOCKED");
        expect(text).toContain("CP-LIST:BLOCKED");
        expect(text).toContain("CP-ORIGIN:BLOCKED");
        // The gateway port serves no API and no other session.
        expect(text).toMatch(/GW-API:404:/);
        expect(text).toMatch(/GW-OTHER:403:/);
        // Its own session's MCP still works.
        expect(text).toMatch(/GW-OWN:200:.*"tools"/);

        // The grant died with the turn.
        const url = (await readFile(join(workspace, "mcp-url.txt"), "utf8")).trim();
        const after = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: rpc,
        });
        expect(after.status).toBe(403);
      } finally {
        await gateway.close();
        await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
      }
    },
    30_000,
  );
});

describe("cliThreadState", () => {
  it("remembers MCP instructions per CLI thread", () => {
    expect(cliThreadState("t1", undefined, true, "git")).toEqual({
      sessionId: "t1",
      mcpPrompt: "git",
    });
    // Same thread resumed without resending: keep the marker.
    expect(cliThreadState("t1", { sessionId: "t1", mcpPrompt: "git" }, false, "git")).toEqual({
      sessionId: "t1",
      mcpPrompt: "git",
    });
    // Resume fell back to a fresh thread: it has not seen the instructions.
    expect(cliThreadState("t2", { sessionId: "t1", mcpPrompt: "git" }, false, "git")).toEqual({
      sessionId: "t2",
    });
  });
});
