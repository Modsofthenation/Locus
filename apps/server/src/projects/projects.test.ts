import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { applySubscribe } from "@locus/shared";
import { ProjectService } from "./projects.js";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { registerProjectRoutes } from "../http/projectRoutes.js";
import { SessionService } from "../session/sessions.js";
import { SubscriptionService } from "../session/subscriptions.js";
import type { RepoService } from "../git/repos.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

async function setup(repos?: RepoService, opts?: { wakeDebounceMs?: number }) {
  const dir = await mkdtemp(join(tmpdir(), "locus-projects-"));
  dirs.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const hub = new Hub();
  const sessions = new SessionService(store, new MockHypervisor(dir), hub);
  const projects = new ProjectService(store, hub, sessions, repos, opts);
  sessions.plane.projects = projects;
  return { dir, store, hub, sessions, projects };
}

describe("ProjectService", () => {
  it("creates, lists, and deletes a project under the data dir", async () => {
    const { projects, dir } = await setup();
    const created = await projects.create({ starter: "feature", title: "Auth" });
    expect(created.title).toBe("Auth");
    expect(created.recipeId).toBe("feature");
    expect(created.maxConcurrentMembers).toBe(4);
    const listed = await projects.list();
    expect(listed.map((row) => row.id)).toEqual([created.id]);
    const raw = await readFile(join(dir, "projects", created.id, "project.json"), "utf8");
    expect(raw).toContain("Auth");
    const index = await readFile(join(dir, "projects", created.id, "context", "INDEX.md"), "utf8");
    expect(index).toMatch(/Auth/);
    const playbook = await readFile(
      join(dir, "projects", created.id, "context", "playbooks", "feature.md"),
      "utf8",
    );
    expect(playbook).toMatch(/one member per slice/i);
    await projects.remove(created.id);
    expect(await projects.list()).toEqual([]);
  });

  it("duplicates a project document and context without members", async () => {
    const { projects, dir } = await setup();
    const created = await projects.create({ starter: "feature", title: "Auth" });
    await projects.writeContextFile(created.id, "notes/extra.md", "# Extra\n");

    const app = new Hono();
    registerProjectRoutes(app, projects);
    const missing = await app.request("/api/projects/no-such/duplicate", { method: "POST" });
    expect(missing.status).toBe(404);

    const copied = await app.request(`/api/projects/${created.id}/duplicate`, { method: "POST" });
    expect(copied.status).toBe(201);
    const body = (await copied.json()) as {
      id: string;
      title: string;
      memberIds: string[];
      coordinatorSessionId?: string;
      recipeId?: string;
    };
    expect(body.id).not.toBe(created.id);
    expect(body.title).toBe("Auth copy");
    expect(body.memberIds).toEqual([]);
    expect(body.coordinatorSessionId).toBeUndefined();
    expect(body.recipeId).toBe("feature");
    const index = await readFile(join(dir, "projects", body.id, "context", "INDEX.md"), "utf8");
    expect(index).toMatch(/Auth/);
    expect(
      await readFile(join(dir, "projects", body.id, "context", "notes", "extra.md"), "utf8"),
    ).toBe("# Extra\n");
  });

  it("gives Swarm teams unique names and persists cross-team handoffs", async () => {
    const { projects, sessions } = await setup();
    const platform = await projects.create({
      surface: "swarm",
      teamName: "Platform",
      starter: "blank",
    });
    await expect(
      projects.create({ surface: "swarm", teamName: "platform", starter: "blank" }),
    ).rejects.toThrow(/already exists/);
    const experience = await projects.create({
      surface: "swarm",
      teamName: "Experience",
      starter: "blank",
    });
    const { sessionId: platformCoordinator } = await projects.ensureChat(platform.id);
    const { sessionId: experienceCoordinator } = await projects.ensureChat(experience.id);
    const roster = await sessions.executeTool(
      platformCoordinator,
      { name: "team_roster", args: {} },
      { ignoreAllowlist: true },
    );
    expect(JSON.parse(roster.output).teammates.map((row: { id: string }) => row.id)).not.toContain(
      experienceCoordinator,
    );
    const directory = await projects.executeTool(
      { id: "coord", kind: "project", projectId: platform.id },
      "team_directory",
      {},
    );
    expect(
      JSON.parse(directory.output)
        .map((row: { name: string }) => row.name)
        .sort(),
    ).toEqual(["Experience", "Platform"]);
    const sent = await projects.handoffToTeam(platform.id, {
      targetTeamId: experience.id,
      task: "Review the login flow",
    });
    expect(sent.status).toBe("queued");
    expect((await projects.listHandoffs(experience.id))[0]?.sourceTeamName).toBe("Platform");
    const accepted = await projects.actOnHandoff(experience.id, sent.id, "accept");
    expect(accepted.status).toBe("accepted");
    const completed = await projects.actOnHandoff(experience.id, sent.id, "complete");
    expect(completed.status).toBe("completed");
    expect((await projects.require(platform.id)).audit?.some((row) => row.kind === "team")).toBe(
      true,
    );
  });

  it("refuses path traversal ids and context writes", async () => {
    const { projects } = await setup();
    expect(await projects.get("../secrets")).toBeUndefined();
    expect(await projects.get("a/b")).toBeUndefined();
    const created = await projects.create({ starter: "blank" });
    const bad = await projects.executeTool(
      { id: "coord", kind: "project", projectId: created.id },
      "project_context_write",
      { path: "../secret.md", content: "nope" },
    );
    expect(bad.ok).toBe(false);
    expect(bad.output).toMatch(/Invalid context path/);
  });

  it("filters cross-project member ids when updating a roster", async () => {
    const { projects, sessions, store } = await setup();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    const project = await projects.create({ starter: "blank", surface: "swarm" });
    const foreign = await sessions.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      surface: "developer",
      startVm: false,
      providerId: provider.id,
      model: provider.defaultModel,
    });
    const patched = await projects.patch(project.id, { memberIds: [foreign.id] });
    expect(patched.memberIds).toEqual([]);
  });

  it("seeds a distinct playbook per starter", async () => {
    const { projects, dir } = await setup();
    const feature = await projects.create({ starter: "feature" });
    const migration = await projects.create({ starter: "migration" });
    const gardening = await projects.create({ starter: "gardening" });
    const blank = await projects.create({ starter: "blank" });
    expect(
      await readFile(
        join(dir, "projects", feature.id, "context", "playbooks", "feature.md"),
        "utf8",
      ),
    ).toMatch(/slice/);
    expect(
      await readFile(
        join(dir, "projects", migration.id, "context", "playbooks", "migration.md"),
        "utf8",
      ),
    ).toMatch(/cohort/);
    expect(
      await readFile(
        join(dir, "projects", gardening.id, "context", "playbooks", "garden.md"),
        "utf8",
      ),
    ).toMatch(/timer/);
    expect(
      await readFile(join(dir, "projects", blank.id, "context", "playbooks", "notes.md"), "utf8"),
    ).toMatch(/Playbook/);
  });

  it("opens a host coordinator without exec or apply_patch", async () => {
    const { projects, sessions } = await setup();
    const created = await projects.create({ starter: "blank", title: "Coord" });
    const { sessionId, project } = await projects.ensureChat(created.id);
    expect(project.coordinatorSessionId).toBe(sessionId);
    const session = await sessions.get(sessionId);
    expect(session?.kind).toBe("project");
    expect(session?.runtime).toBe("host");
    expect(session?.projectId).toBe(created.id);
    expect(session?.allowedTools).not.toContain("apply_patch");
    expect(session?.allowedTools).not.toContain("exec");
    await expect(
      sessions.executeTool(sessionId, {
        name: "apply_patch",
        args: { path: "x.ts", patch: "--- a/x.ts\n+++ b/x.ts\n" },
      }),
    ).rejects.toThrow(/not allowed/);
    await expect(
      sessions.executeTool(sessionId, {
        name: "exec",
        args: { command: "echo hi" },
      }),
    ).rejects.toThrow(/not allowed/);
  });

  it("renames the coordinator session title when the team name changes", async () => {
    const { projects, sessions } = await setup();
    const created = await projects.create({
      surface: "swarm",
      teamName: "R&D",
      starter: "blank",
    });
    const { sessionId } = await projects.ensureChat(created.id);
    expect((await sessions.get(sessionId))?.title).toBe("R&D");
    await projects.patch(created.id, { teamName: "Team Rapid Fire", title: "Team Rapid Fire" });
    expect((await sessions.get(sessionId))?.title).toBe("Team Rapid Fire");
  });

  it("reads a single team briefing context file", async () => {
    const { projects } = await setup();
    const created = await projects.create({
      surface: "swarm",
      teamName: "Briefing",
      starter: "blank",
    });
    const listed = await projects.listContext(created.id);
    expect(listed.some((row) => row.path === "INDEX.md")).toBe(true);
    const index = await projects.readContext(created.id, "INDEX.md");
    expect(index).toMatch(/Briefing/);
    await expect(projects.readContext(created.id, "../secrets")).rejects.toThrow(
      /Invalid context path/,
    );
    await expect(projects.readContext(created.id, "missing.md")).rejects.toThrow(
      /Context file not found/,
    );
    await expect(projects.readContext("no-such-project", "INDEX.md")).rejects.toThrow(
      /Project not found/,
    );

    const app = new Hono();
    registerProjectRoutes(app, projects);
    const ok = await app.request(`/api/projects/${created.id}/context/file?path=INDEX.md`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      path: "INDEX.md",
      content: expect.stringMatching(/Briefing/),
    });
    const missingPath = await app.request(`/api/projects/${created.id}/context/file`);
    expect(missingPath.status).toBe(400);
    const missingProject = await app.request(`/api/projects/no-such/context/file?path=INDEX.md`);
    expect(missingProject.status).toBe(404);
    const traversal = await app.request(
      `/api/projects/${created.id}/context/file?path=${encodeURIComponent("../secrets")}`,
    );
    expect(traversal.status).toBe(400);
  });

  it("creates a Swarm group chat and routes explicit mentions to its members", async () => {
    const { projects, sessions, store } = await setup();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    const alice = await sessions.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      surface: "swarm",
      startVm: false,
      providerId: provider.id,
      model: provider.defaultModel,
      persona: { displayName: "Alice", hubRole: "Researcher" },
    });
    const bob = await sessions.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      surface: "swarm",
      startVm: false,
      providerId: provider.id,
      model: provider.defaultModel,
      persona: { displayName: "Bob", hubRole: "Writer" },
    });
    const group = await projects.create({
      title: "Launch room",
      surface: "swarm",
      groupChat: true,
      participantIds: [alice.id, bob.id],
    });
    expect(group.groupChat).toBe(true);
    expect(group.memberIds).toEqual([alice.id, bob.id]);
    const { sessionId } = await projects.ensureChat(group.id);
    const coord = await sessions.get(sessionId);
    expect(coord?.allowedTools).toEqual([
      "project_get",
      "project_context_list",
      "project_context_read",
      "project_context_write",
      "project_context_delete",
      "team_roster",
      "team_peer_status",
      "team_add_teammate",
      "team_message",
    ]);
    expect(coord?.playbook).toMatch(/that teammate owns the reply/i);
    expect(coord?.playbook).toMatch(/@everyone is routed to every/i);
    expect(coord?.playbook).not.toMatch(/With @everyone or no mention, pick a/);
    expect(coord?.playbook).not.toMatch(/git_pr_list/);

    await sessions.appendMessage(sessionId, {
      id: "u-prior",
      role: "user",
      content: "ship Friday",
      createdAt: new Date().toISOString(),
    });
    await sessions.appendMessage(sessionId, {
      id: "a-prior",
      role: "assistant",
      content: "Alice owns research.",
      createdAt: new Date().toISOString(),
    });

    const routed: string[] = [];
    let routedOptions: { plan?: boolean; wakeRequester?: boolean } | undefined;
    sessions.sendChat = async (id, content, options) => {
      routed.push(`${id}:${content}`);
      routedOptions = options;
    };
    expect(
      await projects.sendGroupMessage(sessionId, "@Alice gather the sources", { plan: true }),
    ).toBe(true);
    expect(routed).toHaveLength(1);
    expect(routed[0]).toContain(`${alice.id}:`);
    expect(routed[0]).toContain("Request: @Alice gather the sources");
    expect(routed[0]).toContain('Group chat "Launch room"');
    expect(routed[0]).toContain("Recent thread:");
    expect(routed[0]).toContain("Operator: ship Friday");
    expect(routed[0]).not.toMatch(/The operator addressed you directly/);
    expect(routedOptions?.plan).toBe(true);
    expect(routedOptions?.wakeRequester).toBe(false);
    const transcript = await sessions.get(sessionId);
    expect(transcript?.messages.at(-1)?.content).toBe("@Alice gather the sources");

    routed.length = 0;
    expect(await projects.sendGroupMessage(sessionId, "@everyone stand up")).toBe(true);
    expect(routed).toHaveLength(2);
    expect(routed.some((row) => row.startsWith(`${alice.id}:`))).toBe(true);
    expect(routed.some((row) => row.startsWith(`${bob.id}:`))).toBe(true);
    expect(routed.every((row) => row.includes("Request: @everyone stand up"))).toBe(true);

    await sessions.patchMeta(sessionId, {
      allowedTools: ["git_pr_list", "team_message", "slack_history"],
      playbook: "Old coordinator playbook with git_pr_list",
    });
    await projects.ensureChat(group.id);
    const migrated = await sessions.get(sessionId);
    expect(migrated?.allowedTools).toEqual([
      "project_get",
      "project_context_list",
      "project_context_read",
      "project_context_write",
      "project_context_delete",
      "team_roster",
      "team_peer_status",
      "team_add_teammate",
      "team_message",
    ]);
    expect(migrated?.playbook).toMatch(/@everyone is routed to every/i);
    expect(migrated?.playbook).not.toMatch(/git_pr_list/);

    await expect(projects.patch(group.id, { memberIds: [alice.id] })).rejects.toThrow(/2-6/);
  });

  it("posts group-chat mention completions without a coordinator LLM turn", async () => {
    const { projects, sessions, store } = await setup();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    const alice = await sessions.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      surface: "swarm",
      startVm: false,
      providerId: provider.id,
      model: provider.defaultModel,
      persona: { displayName: "Alice", hubRole: "Researcher" },
    });
    const bob = await sessions.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      surface: "swarm",
      startVm: false,
      providerId: provider.id,
      model: provider.defaultModel,
      persona: { displayName: "Bob", hubRole: "Writer" },
    });
    const group = await projects.create({
      title: "Launch room",
      surface: "swarm",
      groupChat: true,
      participantIds: [alice.id, bob.id],
    });
    const { sessionId } = await projects.ensureChat(group.id);
    await store.mutateSession(alice.id, (row) => {
      row.status = "idle";
      row.messages.push({
        id: "a-alice",
        role: "assistant",
        content: "Found three sources.",
        createdAt: new Date().toISOString(),
      });
    });
    const svc = sessions as unknown as {
      peerHandoffs: Map<string, { requesterId: string; task: string; wakeRequester?: boolean }>;
      deliverPeerHandoff: (
        peerId: string,
        peer: Awaited<ReturnType<SessionService["get"]>>,
        opts: { kind: "done" | "needs_you" | "blocked"; detail?: string },
      ) => Promise<void>;
    };
    const woke: string[] = [];
    sessions.sendChat = async (id, content) => {
      woke.push(`${id}:${content}`);
    };

    svc.peerHandoffs.set(alice.id, {
      requesterId: sessionId,
      task: "gather",
      wakeRequester: false,
    });
    const peerLive = await sessions.get(alice.id);
    await svc.deliverPeerHandoff(alice.id, peerLive!, { kind: "done" });
    const thread = await sessions.get(sessionId);
    expect(
      thread?.messages.some(
        (message) =>
          message.teamEvent === "done" && message.content.includes("Found three sources"),
      ),
    ).toBe(true);
    expect(woke).toEqual([]);
    expect(
      thread?.messages.some(
        (message) => message.role === "user" && message.content.includes("Peer update"),
      ),
    ).toBe(false);

    svc.peerHandoffs.set(alice.id, {
      requesterId: sessionId,
      task: "gather",
      wakeRequester: false,
    });
    await svc.deliverPeerHandoff(alice.id, (await sessions.get(alice.id))!, {
      kind: "needs_you",
      detail: "Need the API key",
    });
    expect(woke.some((row) => row.includes(sessionId) && row.includes("Peer update"))).toBe(true);
    expect(woke.some((row) => row.includes("Need the API key"))).toBe(true);
  });

  it("spawns a member with projectId and refuses a fifth live member at cap 4", async () => {
    const { projects, sessions } = await setup();
    const created = await projects.create({
      starter: "feature",
      title: "Fleet",
      maxConcurrentMembers: 4,
    });
    const first = await projects.spawnMember(created.id, { task: "slice one", title: "One" });
    const member = await sessions.get(first.sessionId);
    expect(member?.projectId).toBe(created.id);
    expect(member?.kind).toBeUndefined();
    for (let i = 0; i < 3; i += 1) {
      await projects.spawnMember(created.id, { task: `slice ${i + 2}` });
    }
    const fleet = await projects.require(created.id);
    expect(fleet.memberIds).toHaveLength(4);
    const live = new Set(fleet.memberIds);
    const origList = sessions.list.bind(sessions);
    sessions.list = async () =>
      (await origList()).map((row) =>
        live.has(row.id) ? { ...row, status: "running" as const } : row,
      );
    const fifth = await projects.executeTool(
      { id: "coord", kind: "project", projectId: created.id },
      "project_spawn",
      { task: "slice five" },
    );
    expect(fifth.ok).toBe(false);
    expect(fifth.output).toMatch(/Concurrent member cap/);
  });

  it("spawns one fix member when CI goes red and flags Needs you when it is green", async () => {
    const detail: {
      number: number;
      url: string;
      title: string;
      state: "open";
      headRef: string;
      baseRef: string;
      headSha: string;
      checkState: "pending" | "failure" | "success";
      checks: Array<{ name: string; status: "in_progress" | "failure" | "success" }>;
      comments: Array<{ id: string; body: string; author: string; createdAt: string }>;
      files: [];
      commits: [];
      repoId: string;
      forge: "github";
      updatedAt: string;
    } = {
      number: 12,
      url: "https://github.com/acme/app/pull/12",
      title: "Auth",
      state: "open",
      headRef: "auth",
      baseRef: "main",
      headSha: "aaa",
      checkState: "pending",
      checks: [{ name: "test", status: "in_progress" }],
      comments: [
        { id: "c1", body: "ship it", author: "ada", createdAt: "2020-01-01T00:00:00.000Z" },
      ],
      files: [],
      commits: [],
      repoId: "repo-1",
      forge: "github" as const,
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const repos = { getPull: async () => detail } as unknown as RepoService;
    const { projects, sessions, store } = await setup(repos, { wakeDebounceMs: 0 });
    const created = await projects.create({ title: "Migrate" });
    const member = await projects.spawnMember(created.id, {
      task: "slice the auth change",
      title: "Auth slice",
    });
    await store.mutateSession(member.sessionId, (row) => {
      row.repoId = "repo-1";
      row.pull = {
        number: 12,
        url: detail.url,
        title: detail.title,
        state: "open",
        headRef: "auth",
        baseRef: "main",
        checkState: "pending",
      };
    });

    await projects.tickFleet();
    expect((await projects.get(created.id))?.memberIds).toHaveLength(1);

    detail.headSha = "bbb";
    detail.checkState = "failure";
    detail.checks = [{ name: "test", status: "failure" }];
    detail.comments = [
      ...detail.comments,
      { id: "c2", body: "race in checkout", author: "bea", createdAt: "2020-01-02T00:00:00.000Z" },
    ];
    await projects.tickFleet();
    const woken = await projects.get(created.id);
    expect(woken?.memberIds).toHaveLength(2);
    const fix = (await sessions.list()).find((row) => row.title === "Fix #12");
    expect(fix?.projectId).toBe(created.id);
    expect(fix?.pull?.number).toBe(12);
    expect(fix?.messages.some((message) => message.content.includes("Do not merge"))).toBe(true);

    await projects.tickFleet();
    expect((await projects.get(created.id))?.memberIds).toHaveLength(2);

    detail.headSha = "ccc";
    detail.checkState = "success";
    detail.checks = [{ name: "test", status: "success" }];
    await projects.tickFleet();
    const flagged = await sessions.get(member.sessionId);
    expect(flagged?.needsHuman).toMatch(/Approve git_pr_merge/);
    expect(flagged?.needsHuman).toMatch(/CI success/);
  });

  it("spawns one fix member when two sessions share a pull, then steers that member once", async () => {
    const detail: {
      number: number;
      url: string;
      title: string;
      state: "open";
      headRef: string;
      baseRef: string;
      headSha: string;
      checkState: "pending" | "failure" | "success";
      checks: Array<{ name: string; status: "in_progress" | "failure" | "success" }>;
      comments: Array<{ id: string; body: string; author: string; createdAt: string }>;
      files: [];
      commits: [];
      repoId: string;
      forge: "github";
      updatedAt: string;
    } = {
      number: 9,
      url: "https://github.com/acme/app/pull/9",
      title: "Billing",
      state: "open",
      headRef: "billing",
      baseRef: "main",
      headSha: "aaa",
      checkState: "pending",
      checks: [{ name: "test", status: "in_progress" }],
      comments: [
        { id: "c1", body: "ship it", author: "ada", createdAt: "2020-01-01T00:00:00.000Z" },
      ],
      files: [],
      commits: [],
      repoId: "repo-1",
      forge: "github" as const,
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const repos = { getPull: async () => detail } as unknown as RepoService;
    const { projects, sessions, store } = await setup(repos, { wakeDebounceMs: 0 });
    const steered: string[] = [];
    sessions.sendChat = (async (id: string) => {
      steered.push(id);
    }) as typeof sessions.sendChat;
    const created = await projects.create({ title: "Billing" });
    for (const title of ["Slice A", "Slice B"]) {
      const member = await projects.spawnMember(created.id, { task: title, title });
      await store.mutateSession(member.sessionId, (row) => {
        row.repoId = "repo-1";
        row.pull = {
          number: 9,
          url: detail.url,
          title: detail.title,
          state: "open",
          headRef: "billing",
          baseRef: "main",
          checkState: "pending",
        };
      });
    }

    await projects.tickFleet();
    detail.headSha = "bbb";
    detail.checkState = "failure";
    detail.checks = [{ name: "test", status: "failure" }];
    detail.comments = [
      ...detail.comments,
      { id: "c2", body: "nil total", author: "bea", createdAt: "2020-01-02T00:00:00.000Z" },
    ];
    await projects.tickFleet();
    const fixes = (await sessions.list()).filter((row) => row.title === "Fix #9");
    expect(fixes).toHaveLength(1);
    steered.length = 0;

    detail.comments = [
      ...detail.comments,
      { id: "c3", body: "also tax", author: "cy", createdAt: "2020-01-03T00:00:00.000Z" },
    ];
    await projects.tickFleet();
    expect((await sessions.list()).filter((row) => row.title === "Fix #9")).toHaveLength(1);
    expect(steered).toEqual([fixes[0]?.id]);
  });

  it("reports keep-alive while a project should outlive the desktop", async () => {
    const { projects } = await setup();
    const app = new Hono();
    registerProjectRoutes(app, projects);
    const created = await projects.create({ title: "Garden" });
    expect(await (await app.request("/api/projects/keep-alive")).json()).toEqual({
      keepAlive: false,
    });
    await projects.patch(created.id, { keepAlive: true });
    expect(await (await app.request("/api/projects/keep-alive")).json()).toEqual({
      keepAlive: true,
    });
    await projects.patch(created.id, { paused: true });
    expect(await (await app.request("/api/projects/keep-alive")).json()).toEqual({
      keepAlive: false,
    });
  });

  it("collects a member after a mocked assistant turn", async () => {
    const { projects, sessions, store } = await setup();
    const created = await projects.create({ starter: "blank" });
    const spawned = await projects.spawnMember(created.id, { task: "write notes" });
    await store.mutateSession(spawned.sessionId, (row) => {
      row.messages.push({
        id: "a1",
        role: "assistant",
        content: "Wrote research/auth.md",
        createdAt: new Date().toISOString(),
      });
    });
    const collected = await projects.collectMember(created.id, spawned.sessionId);
    expect(collected).toMatch(/Wrote research\/auth.md/);
    const live = await sessions.get(spawned.sessionId);
    expect(live?.projectId).toBe(created.id);
  });

  it("leaves members when the project is deleted", async () => {
    const { projects, sessions } = await setup();
    const created = await projects.create({ starter: "blank" });
    const spawned = await projects.spawnMember(created.id, { task: "keep me" });
    await projects.remove(created.id);
    expect(await projects.get(created.id)).toBeUndefined();
    expect(await sessions.get(spawned.sessionId)).toBeTruthy();
  });

  it("seeds a garden-scan timer on the gardening coordinator", async () => {
    const { projects, sessions } = await setup();
    const created = await projects.create({ starter: "gardening" });
    const { sessionId } = await projects.ensureChat(created.id);
    const session = await sessions.get(sessionId);
    expect(session?.subscriptions?.some((row) => row.name === "garden-scan")).toBe(true);
  });

  it("keeps a local spawn local even when the project defaults to worker", async () => {
    const { projects, sessions } = await setup();
    const created = await projects.create({
      starter: "feature",
      placement: "worker",
      backendId: "worker-1",
    });
    const local = await projects.spawnMember(created.id, {
      task: "run the GUI test",
      placement: "local",
    });
    const session = await sessions.get(local.sessionId);
    expect(session?.placement).not.toBe("worker");
    const still = await projects.get(created.id);
    expect(still?.placement).toBe("worker");
    expect(still?.backendId).toBe("worker-1");
  });

  it("refuses spawn from a member session", async () => {
    const { projects } = await setup();
    const created = await projects.create({ starter: "blank" });
    const spawned = await projects.spawnMember(created.id, { task: "implement slice" });
    const refused = await projects.executeTool(
      { id: spawned.sessionId, kind: "agent", projectId: created.id },
      "project_spawn",
      { task: "nested fleet" },
    );
    expect(refused.ok).toBe(false);
    expect(refused.output).toMatch(/coordinator/i);
    const wrote = await projects.executeTool(
      { id: spawned.sessionId, kind: "agent", projectId: created.id },
      "project_context_write",
      { path: "research/notes.md", content: "Found the login path." },
    );
    expect(wrote.ok).toBe(true);
  });

  it("does not wake a paused project's coordinator", async () => {
    const { projects, sessions, store, hub } = await setup();
    const created = await projects.create({ starter: "gardening" });
    const { sessionId } = await projects.ensureChat(created.id);
    const prompts: string[] = [];
    sessions.sendChat = async (_id, content) => {
      prompts.push(content);
    };
    let now = new Date("2026-09-11T12:00:00.000Z");
    const sub = applySubscribe(
      [],
      { kind: "timer", name: "nudge", delaySeconds: 30, once: true, prompt: "scan PRs" },
      { id: "t1", createdAt: now.toISOString(), now },
    ).subscriptions;
    await sessions.patchMeta(sessionId, { subscriptions: sub });
    await projects.patch(created.id, { paused: true });
    const svc = new SubscriptionService(store, sessions, {
      hub,
      now: () => now,
      projects,
    });
    now = new Date("2026-09-11T12:00:31.000Z");
    await svc.tick();
    expect(prompts).toEqual([]);
  });

  it("includes column on project_get and refreshes pull state", async () => {
    let getPullCalls = 0;
    const getPullOpts: Array<{ fresh?: boolean } | undefined> = [];
    const { projects, store } = await setup({
      getPull: async (_repoId: string, _number: number, opts?: { fresh?: boolean }) => {
        getPullCalls += 1;
        getPullOpts.push(opts);
        return {
          repoId: "repo-1",
          forge: "github",
          number: 12,
          title: "feat",
          state: "merged",
          headRef: "feat",
          baseRef: "main",
          headSha: "abc",
          url: "https://github.com/acme/app/pull/12",
          updatedAt: new Date().toISOString(),
          files: [],
          comments: [],
          commits: [],
          checks: [],
        };
      },
    } as never);
    const created = await projects.create({ starter: "feature" });
    const spawned = await projects.spawnMember(created.id, { task: "open a PR", title: "PR work" });
    await store.mutateSession(spawned.sessionId, (row) => {
      row.repoId = "repo-1";
      row.pull = {
        number: 12,
        url: "https://github.com/acme/app/pull/12",
        title: "feat",
        state: "open",
        headRef: "feat",
        baseRef: "main",
      };
    });
    const got = await projects.executeTool(
      { id: "coord", kind: "project", projectId: created.id },
      "project_get",
      {},
    );
    expect(got.ok).toBe(true);
    const payload = JSON.parse(got.output) as {
      members: Array<{ id: string; column: string }>;
    };
    expect(payload.members[0]?.column).toBe("done");
    expect(getPullCalls).toBe(1);
    expect(getPullOpts[0]).toEqual({ fresh: true });
    const again = await projects.executeTool(
      { id: "coord", kind: "project", projectId: created.id },
      "project_get",
      {},
    );
    expect(again.ok).toBe(true);
    expect(getPullCalls).toBe(1);
  });

  it("keeps cached pull when forge refresh fails", async () => {
    const { projects, sessions, store } = await setup({
      getPull: async () => {
        throw new Error("forge down");
      },
    } as never);
    const created = await projects.create({ starter: "blank" });
    const spawned = await projects.spawnMember(created.id, { task: "keep open PR" });
    await store.mutateSession(spawned.sessionId, (row) => {
      row.repoId = "repo-1";
      row.pull = {
        number: 9,
        url: "https://github.com/acme/app/pull/9",
        title: "wip",
        state: "open",
        headRef: "wip",
        baseRef: "main",
      };
    });
    await projects.syncFleetPulls(created);
    const session = await sessions.get(spawned.sessionId);
    expect(session?.pull?.state).toBe("open");
    const got = await projects.executeTool(
      { id: "coord", kind: "project", projectId: created.id },
      "project_get",
      {},
    );
    expect(got.ok).toBe(true);
    expect(JSON.parse(got.output).members[0].column).toBe("in_review");
  });

  it("team_message returns async and wakes the requester when the peer handoff completes", async () => {
    const { sessions, store, projects } = await setup();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    const team = await projects.create({
      surface: "swarm",
      teamName: "Research",
      starter: "blank",
    });
    const coord = await sessions.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      surface: "swarm",
      startVm: false,
      providerId: provider.id,
      model: provider.defaultModel,
      projectId: team.id,
      persona: { displayName: "Head of staff", hubRole: "Coordinator" },
    });
    const peer = await sessions.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      surface: "swarm",
      startVm: false,
      providerId: provider.id,
      model: provider.defaultModel,
      projectId: team.id,
      persona: { displayName: "The Knowledge base", hubRole: "Researcher" },
    });
    const sent = await sessions.executeTool(
      coord.id,
      {
        name: "team_message",
        args: { name: "Knowledge", message: "Summarize the brain docs." },
      },
      { ignoreAllowlist: true },
    );
    expect(sent.ok).toBe(true);
    const payload = JSON.parse(sent.output);
    expect(payload.async).toBe(true);
    expect(payload.teammateId).toBe(peer.id);

    await sessions.abortChat(peer.id).catch(() => undefined);
    await store.mutateSession(peer.id, (row) => {
      row.status = "idle";
      row.messages.push({
        id: "a-peer",
        role: "assistant",
        content: "Three durable facts from the brain.",
        createdAt: new Date().toISOString(),
      });
    });
    const svc = sessions as unknown as {
      peerHandoffs: Map<string, { requesterId: string; task: string }>;
      deliverPeerHandoff: (
        peerId: string,
        peer: Awaited<ReturnType<SessionService["get"]>>,
        opts: { kind: "done" | "needs_you" | "blocked"; detail?: string },
      ) => Promise<void>;
    };
    // Re-register: abort/turn end may have cleared the handoff during the mocked loop.
    svc.peerHandoffs.set(peer.id, { requesterId: coord.id, task: "Summarize the brain docs." });
    const peerLive = await sessions.get(peer.id);
    await svc.deliverPeerHandoff(peer.id, peerLive!, { kind: "done" });

    const deadline = Date.now() + 5000;
    let woke = false;
    while (Date.now() < deadline) {
      const live = await sessions.get(coord.id);
      woke = Boolean(
        live?.messages.some(
          (m) =>
            (m.teamEvent === "done" && m.content.includes("Three durable facts")) ||
            (m.role === "user" && m.content.includes("Peer update")),
        ),
      );
      if (woke) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    expect(woke).toBe(true);
  });

  it("deduplicates Needs-you relay and persists an operator decision in the audit trail", async () => {
    const { projects, sessions } = await setup();
    const created = await projects.create({ starter: "feature", surface: "swarm" });
    const { sessionId } = await projects.ensureChat(created.id);
    const member = await projects.spawnMember(created.id, {
      task: "wait for the operator",
      role: "Implementer",
    });
    await projects.relayMemberNeedsHuman(member.sessionId, "Approve the protected branch");
    await projects.relayMemberNeedsHuman(member.sessionId, "Approve the protected branch");
    const pending = await projects.require(created.id);
    expect(pending.needsYou).toHaveLength(1);
    expect(pending.audit?.some((event) => event.kind === "need")).toBe(true);
    expect(pending.coordinatorSessionId).toBe(sessionId);

    const updated = await projects.actOnNeed(created.id, pending.needsYou![0]!.id, "approve");
    expect(updated.needsYou?.[0]?.status).toBe("approved");
    expect(updated.audit?.at(-1)?.message).toContain("approve");
    const memberSession = await sessions.get(member.sessionId);
    expect(memberSession?.needsHuman).toBeUndefined();
    const continued =
      memberSession?.messages.some(
        (message) => message.role === "user" && /operator approved/i.test(message.content),
      ) || memberSession?.queue?.some((item) => /operator approved/i.test(item.text));
    expect(continued).toBe(true);
  });

  it("collapses a repeated block onto the retrying need", async () => {
    const { projects } = await setup();
    const created = await projects.create({ starter: "feature", surface: "swarm" });
    await projects.ensureChat(created.id);
    const member = await projects.spawnMember(created.id, { task: "retry the gate" });
    await projects.relayMemberNeedsHuman(member.sessionId, "Approve the protected branch");
    const pending = await projects.require(created.id);
    await projects.actOnNeed(created.id, pending.needsYou![0]!.id, "retry");
    await projects.relayMemberNeedsHuman(member.sessionId, "Approve the protected branch");
    const again = await projects.require(created.id);
    expect(again.needsYou).toHaveLength(1);
    expect(again.needsYou?.[0]?.status).toBe("retrying");
  });

  it("persists swarm persona and refuses messages from outside a named team", async () => {
    const { projects, sessions, store } = await setup();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    const team = await projects.create({
      surface: "swarm",
      teamName: "Platform",
      starter: "blank",
    });
    const { sessionId: coordinatorId } = await projects.ensureChat(team.id);
    const teammate = await sessions.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      surface: "swarm",
      startVm: false,
      providerId: provider.id,
      model: provider.defaultModel,
      projectId: team.id,
      persona: { displayName: "Nova", hubRole: "Researcher" },
    });
    expect(teammate.persona?.displayName).toBe("Nova");
    expect(teammate.persona?.hubRole).toBe("Researcher");
    expect((await projects.require(team.id)).memberIds).toContain(teammate.id);

    const outsider = await sessions.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      surface: "swarm",
      startVm: false,
      providerId: provider.id,
      model: provider.defaultModel,
      persona: { displayName: "Outsider", hubRole: "Coordinator" },
    });
    expect(outsider.persona?.hubRole).toBe("Coordinator");
    const roster = await sessions.executeTool(
      outsider.id,
      { name: "team_roster", args: {} },
      { ignoreAllowlist: true },
    );
    const rosterIds = JSON.parse(roster.output).teammates.map((row: { id: string }) => row.id);
    expect(rosterIds).not.toContain(coordinatorId);
    expect(rosterIds).not.toContain(teammate.id);
    const blocked = await sessions.executeTool(
      outsider.id,
      {
        name: "team_message",
        args: { teammate_id: teammate.id, message: "Peek at the other team" },
      },
      { ignoreAllowlist: true },
    );
    expect(blocked.ok).toBe(false);
    const other = await sessions.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      surface: "swarm",
      startVm: false,
      providerId: provider.id,
      model: provider.defaultModel,
      persona: { displayName: "Other", hubRole: "Researcher" },
    });
    const sent = await sessions.executeTool(
      outsider.id,
      { name: "team_message", args: { name: "Other", message: "Talk outside a team" } },
      { ignoreAllowlist: true },
    );
    expect(sent.ok).toBe(false);
    expect(sent.output).toMatch(/named team/);
    expect(other.persona?.displayName).toBe("Other");
  });

  it("team_add_teammate creates a Designer with Swarm persona defaults", async () => {
    const { sessions, store } = await setup();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    const coord = await sessions.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      surface: "swarm",
      startVm: false,
      providerId: provider.id,
      model: provider.defaultModel,
      persona: { displayName: "Head of staff", hubRole: "Coordinator" },
    });
    const added = await sessions.executeTool(
      coord.id,
      {
        name: "team_add_teammate",
        args: { name: "Pixel", role: "Designer" },
      },
      { ignoreAllowlist: true },
    );
    expect(added.ok).toBe(true);
    const payload = JSON.parse(added.output);
    const designer = await sessions.get(payload.teammateId as string);
    expect(designer?.surface).toBe("swarm");
    expect(designer?.persona?.hubRole).toBe("Designer");
    expect(designer?.persona?.displayName).toBe("Pixel");
    expect(designer?.persona?.personality).toMatch(/Visual/);
    expect(designer?.persona?.avatarId).toBe("bloom");
    expect(designer?.kind).not.toBe("design");
  });

  it("enrolls an existing Swarm teammate onto a named team", async () => {
    const { projects, sessions, store } = await setup();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    const team = await projects.create({
      surface: "swarm",
      teamName: "Platform",
      starter: "blank",
    });
    const nova = await sessions.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      surface: "swarm",
      startVm: false,
      providerId: provider.id,
      model: provider.defaultModel,
      persona: { displayName: "Nova", hubRole: "Researcher" },
    });
    expect(nova.projectId).toBeUndefined();
    const enrolled = await projects.enrollExistingMember(team.id, nova.id);
    expect(enrolled.session.projectId).toBe(team.id);
    expect(enrolled.project.memberIds).toContain(nova.id);
    expect(enrolled.project.team?.members.map((row) => row.sessionId)).toContain(nova.id);
    const again = await projects.enrollExistingMember(team.id, nova.id);
    expect(again.project.memberIds.filter((id) => id === nova.id)).toHaveLength(1);
  });

  it("moves an existing teammate from one Swarm team to another", async () => {
    const { projects, sessions, store } = await setup();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    const research = await projects.create({
      surface: "swarm",
      teamName: "Research",
      starter: "blank",
    });
    const platform = await projects.create({
      surface: "swarm",
      teamName: "Platform",
      starter: "blank",
    });
    const nova = await sessions.create({
      os: "ubuntu",
      templateId: "host",
      runtime: "host",
      surface: "swarm",
      startVm: false,
      providerId: provider.id,
      model: provider.defaultModel,
      projectId: research.id,
      persona: { displayName: "Nova", hubRole: "Researcher" },
    });
    expect((await projects.require(research.id)).memberIds).toContain(nova.id);
    const moved = await projects.enrollExistingMember(platform.id, nova.id);
    expect(moved.session.projectId).toBe(platform.id);
    expect(moved.project.memberIds).toContain(nova.id);
    expect((await projects.require(research.id)).memberIds).not.toContain(nova.id);
  });

  it("refuses to enroll a team coordinator as a member", async () => {
    const { projects } = await setup();
    const team = await projects.create({
      surface: "swarm",
      teamName: "Platform",
      starter: "blank",
    });
    const { sessionId } = await projects.ensureChat(team.id);
    await expect(projects.enrollExistingMember(team.id, sessionId)).rejects.toThrow(/coordinator/i);
  });

  it("pins a board and proposes merge / rule", async () => {
    const { projects, sessions, store } = await setup();
    const created = await projects.create({ starter: "feature", boardId: "board-1" });
    expect(created.boardId).toBe("board-1");
    const unpinned = await projects.patch(created.id, { boardId: null });
    expect(unpinned.boardId).toBeUndefined();
    await projects.patch(created.id, { boardId: "board-2" });
    expect((await projects.require(created.id)).boardId).toBe("board-2");

    const spawned = await projects.spawnMember(created.id, { task: "open a PR", title: "PR work" });
    await store.mutateSession(spawned.sessionId, (row) => {
      row.pull = {
        number: 12,
        url: "https://github.com/acme/app/pull/12",
        title: "feat",
        state: "open",
        headRef: "feat",
        baseRef: "main",
        checkState: "success",
      };
    });
    const merge = await projects.executeTool(
      { id: "coord", kind: "project", projectId: created.id },
      "project_propose_merge",
      { member_id: spawned.sessionId },
    );
    expect(merge.ok).toBe(true);
    const member = await sessions.get(spawned.sessionId);
    expect(member?.needsHuman).toMatch(/Propose merge #12/);
    expect(member?.needsHuman).toMatch(/CI success/);

    const rule = await projects.executeTool(
      { id: "coord", kind: "project", projectId: created.id },
      "project_propose_rule",
      { title: "No Stripe from workers", rule: "Bill only from the API process." },
    );
    expect(rule.ok).toBe(true);
    const after = await projects.require(created.id);
    expect(after.needsYou?.some((row) => /No Stripe from workers/.test(row.reason))).toBe(true);
    const written = await readFile(
      join(
        dirs[dirs.length - 1]!,
        "projects",
        created.id,
        "context",
        "rules",
        "no-stripe-from-workers.md",
      ),
      "utf8",
    );
    expect(written).toMatch(/Bill only from the API process/);
  });
});
