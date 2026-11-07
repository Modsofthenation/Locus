import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dockerWorkspaceDir, hostWorkspaceDir, MockHypervisor } from "@locus/hypervisor";
import type { AgentSession, ClientEvent } from "@locus/shared";
import { Hub } from "../core/hub.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";

let cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)),
  );
  cleanup = [];
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "locus-create-attach-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const hub = new Hub();
  const sessions = new SessionService(store, new MockHypervisor(dir), hub);
  return { dir, store, sessions, hub };
}

const B64 = Buffer.from("hello").toString("base64");

describe("session create with attachments", () => {
  it("stores create-time attachments and includes them in the first turn", async () => {
    const { dir, store, sessions } = await setup();
    const config = await store.loadConfig();
    const session = (await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      runtime: "docker",
      dockerImage: "ubuntu:24.04",
      startVm: false,
      prompt: "Summarize the file",
      attachments: [{ name: "note.txt", mime: "text/plain", contentBase64: B64 }],
    })) as AgentSession;

    // Stored server-side under the session's attachment dir.
    const stored = await readFile(join(dir, "attachments", session.id, "note.txt"), "utf8");
    expect(stored).toBe("hello");

    // First user message carries the attachment metadata plus prompt note.
    const user = session.messages.find((m) => m.role === "user");
    expect(user?.content).toContain("Summarize the file");
    expect(user?.content).toContain("Attached files:");
    expect(user?.content).toContain(".locus-attachments/note.txt");
    expect(user?.attachments?.[0]?.storedName).toBe("note.txt");
    expect(
      await readFile(
        join(dir, "docker-workspaces", session.id, ".locus-attachments", "note.txt"),
        "utf8",
      ),
    ).toBe("hello");
  });

  it("keeps creating the session when an attachment is rejected", async () => {
    const { store, sessions } = await setup();
    const config = await store.loadConfig();
    const session = (await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      runtime: "docker",
      dockerImage: "ubuntu:24.04",
      startVm: false,
      prompt: "Look at this",
      attachments: [
        {
          name: "big.png",
          mime: "image/png",
          contentBase64: Buffer.alloc(11 * 1024 * 1024 + 1).toString("base64"),
        },
      ],
    })) as AgentSession;
    // The session still starts; only the bad file is dropped.
    expect(session.status).toBe("running");
    const system = session.messages.find((m) => m.role === "system");
    expect(system?.content).toMatch(/too large/i);
    const user = session.messages.find((m) => m.role === "user");
    expect(user?.content).toContain("Look at this");
  });

  it("creates without attachments exactly as before", async () => {
    const { store, sessions } = await setup();
    const config = await store.loadConfig();
    const session = (await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      runtime: "docker",
      dockerImage: "ubuntu:24.04",
      startVm: false,
      prompt: "Just text",
    })) as AgentSession;
    const user = session.messages.find((m) => m.role === "user");
    expect(user?.content).toBe("Just text");
    expect(user?.attachments).toBeUndefined();
  });

  it("keeps /workspace empty until the repo clone finishes, then copies attachments", async () => {
    const { dir, store, sessions } = await setup();
    const config = await store.loadConfig();
    const session = (await sessions.create(
      {
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        runtime: "docker",
        dockerImage: "ubuntu:24.04",
        startVm: true,
        repo: { forge: "github", url: "https://github.com/acme/demo.git" },
        prompt: "Review the attached HTML",
        attachments: [{ name: "note.txt", mime: "text/plain", contentBase64: B64 }],
      },
      { waitUntilStarted: false },
    )) as AgentSession;

    expect(await readFile(join(dir, "attachments", session.id, "note.txt"), "utf8")).toBe("hello");
    const workspace = dockerWorkspaceDir(dir, session.id);
    const clonedAtCreate = session.messages.some(
      (m) => m.role === "system" && m.content.includes("Cloned"),
    );
    if (!clonedAtCreate) {
      await expect(
        readFile(join(workspace, ".locus-attachments", "note.txt"), "utf8"),
      ).rejects.toThrow();
    }

    const deadline = Date.now() + 2000;
    let fresh = await sessions.get(session.id);
    while (Date.now() < deadline) {
      if (
        fresh?.messages.some((m) => m.role === "system" && /Cloned |Clone failed:/.test(m.content))
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
      fresh = await sessions.get(session.id);
    }
    const notes = (fresh?.messages ?? [])
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    expect(notes).toMatch(/Cloning .+acme\/demo/);
    expect(notes).toMatch(/Cloned .+acme\/demo/);
    expect(notes.indexOf("Cloning")).toBeGreaterThanOrEqual(0);
    expect(notes.indexOf("Cloned")).toBeGreaterThan(notes.indexOf("Cloning"));
    expect(notes).not.toMatch(/Clone failed:/);
    expect(await readFile(join(workspace, "README.md"), "utf8")).toContain(
      "github.com/acme/demo.git",
    );
    expect(await readFile(join(workspace, ".locus-attachments", "note.txt"), "utf8")).toBe("hello");
  });

  it("copies create-time attachments into the host workspace", async () => {
    const { dir, store, sessions } = await setup();
    const config = await store.loadConfig();
    const session = (await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      runtime: "host",
      startVm: false,
      prompt: "Summarize the file",
      attachments: [{ name: "note.txt", mime: "text/plain", contentBase64: B64 }],
    })) as AgentSession;

    expect(await readFile(join(dir, "attachments", session.id, "note.txt"), "utf8")).toBe("hello");
    expect(
      await readFile(
        join(hostWorkspaceDir(dir, session.id), ".locus-attachments", "note.txt"),
        "utf8",
      ),
    ).toBe("hello");
    const user = session.messages.find((m) => m.role === "user");
    expect(user?.content).toContain(".locus-attachments/note.txt");
    expect(user?.attachments?.[0]?.storedName).toBe("note.txt");
  });

  it("posts Cloning before git_clone returns", async () => {
    const { store, sessions, hub } = await setup();
    const progress: ClientEvent[] = [];
    const send = hub.broadcast.bind(hub);
    hub.broadcast = (event) => {
      progress.push(event);
      send(event);
    };
    const original = sessions.executeTool.bind(sessions);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    sessions.executeTool = (async (sessionId, req, opts) => {
      if (req.name === "git_clone") await gate;
      return original(sessionId, req, opts);
    }) as typeof sessions.executeTool;

    try {
      const config = await store.loadConfig();
      void sessions
        .create(
          {
            os: "ubuntu",
            templateId: config.templates[0]!.id,
            providerId: config.providers[0]!.id,
            model: config.providers[0]!.defaultModel,
            runtime: "docker",
            dockerImage: "ubuntu:24.04",
            startVm: true,
            repo: { forge: "github", url: "https://github.com/acme/demo.git" },
          },
          { waitUntilStarted: false },
        )
        .catch(() => undefined);

      const deadline = Date.now() + 2000;
      let sessionId = "";
      let sawStart = false;
      while (Date.now() < deadline) {
        const all = await store.loadSessions();
        const session = all[0];
        if (session) sessionId = session.id;
        const cloning = session?.messages.some(
          (m) => m.role === "system" && m.content.startsWith("Cloning "),
        );
        const started = progress.some(
          (event) =>
            event.type === "clone.progress" && event.percent === 0 && event.phase === "Starting",
        );
        if (cloning && started) {
          expect(session?.messages.some((m) => /Cloned |Clone failed:/.test(m.content))).toBe(
            false,
          );
          sawStart = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(sawStart).toBe(true);
      release();

      const doneDeadline = Date.now() + 2000;
      let fresh = await sessions.get(sessionId);
      while (Date.now() < doneDeadline) {
        if (fresh?.messages.some((m) => m.role === "system" && m.content.includes("Cloned"))) break;
        await new Promise((r) => setTimeout(r, 20));
        fresh = await sessions.get(sessionId);
      }
      expect(fresh?.messages.some((m) => m.role === "system" && m.content.includes("Cloned"))).toBe(
        true,
      );
      expect(
        progress.some((event) => event.type === "clone.progress" && event.clear === true),
      ).toBe(true);
    } finally {
      release();
    }
  });
});
