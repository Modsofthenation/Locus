import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import { RepoService } from "./repos.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";
import type { ChangeStackSummarizer } from "./changeStackSummaries.js";
import type { AgentSession, LinkedRepo, LocusConfig } from "@locus/shared";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Default stub: linking looks up the default branch, and tests must never hit the network. */
const offlineFetch: typeof fetch = async () => json({ message: "offline" }, 503);

async function setup(
  fetchFn: typeof fetch = offlineFetch,
  summarizer: ChangeStackSummarizer | null = null,
) {
  const dir = await mkdtemp(join(tmpdir(), "locus-repos-"));
  const store = new JsonStore(dir);
  await store.init();
  const hypervisor = new MockHypervisor(dir);
  const hub = new Hub();
  const sessions = new SessionService(store, hypervisor, hub);
  sessions.fetchFn = fetchFn;
  const repos = new RepoService(store, sessions, hub, fetchFn, summarizer);
  const app = createApp({ store, sessions, hypervisor, repos });
  return { dir, store, app };
}

let cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)),
  );
  cleanup = [];
});

describe("repos api", () => {
  it("links GitHub, GitLab, and Bitbucket URLs as separate catalog rows", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const created = [];
    for (const url of [
      "https://github.com/acme/app",
      "https://gitlab.com/acme/service",
      "https://bitbucket.org/acme/mobile",
    ]) {
      const res = await ctx.app.request("/api/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      expect(res.status).toBe(201);
      created.push((await res.json()) as LinkedRepo);
    }
    expect(created.map((row) => row.checkout.forge)).toEqual(["github", "gitlab", "bitbucket"]);
    const listed = (await (await ctx.app.request("/api/repos")).json()) as LinkedRepo[];
    expect(listed).toHaveLength(3);
  });

  it("unlinks a catalog row without touching sessions", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://bitbucket.org/acme/mobile" }),
    });
    const repo = (await created.json()) as LinkedRepo;
    const deleted = await ctx.app.request(`/api/repos/${repo.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    const listed = (await (await ctx.app.request("/api/repos")).json()) as LinkedRepo[];
    expect(listed).toEqual([]);
  });

  it("lists branches for a linked repo", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/repos/acme/app/branches")) {
        return json([{ name: "feat" }, { name: "main" }]);
      }
      if (url.endsWith("/repos/acme/app")) {
        return json({ default_branch: "main" });
      }
      return json({ error: url }, 404);
    };
    const ctx = await setup(fetchFn);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const github = config.forges.find((row) => row.kind === "github")!;
    config.forges = [{ ...github, token: "tok" }];
    await ctx.store.saveConfig(config);
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/app", ref: "main" }),
    });
    const repo = (await created.json()) as LinkedRepo;
    const listed = await ctx.app.request(`/api/repos/${repo.id}/branches`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      branches: ["main", "feat"],
      defaultBranch: "main",
    });
  });

  it("imports from every tokened account and keeps two GitHubs distinct", async () => {
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const auth = headers.get("authorization") ?? "";
      const token = headers.get("private-token") ?? "";
      if (url.includes("api.github.com/user/repos") && auth === "Bearer tok-home") {
        return json([
          {
            name: "dotfiles",
            full_name: "me/dotfiles",
            clone_url: "https://github.com/me/dotfiles.git",
            owner: { login: "me" },
          },
        ]);
      }
      if (url.includes("api.github.com/user/repos") && auth === "Bearer tok-work") {
        return json([
          {
            name: "app",
            full_name: "acme/app",
            clone_url: "https://github.com/acme/app.git",
            owner: { login: "acme" },
          },
        ]);
      }
      if (url.includes("gitlab.com/api/v4/projects") && token === "gl") {
        return json([
          {
            path_with_namespace: "acme/service",
            path: "service",
            http_url_to_repo: "https://gitlab.com/acme/service.git",
          },
        ]);
      }
      if (url.includes("api.bitbucket.org/2.0/repositories") && auth === "Bearer bb") {
        return json({
          values: [
            {
              full_name: "acme/mobile",
              links: { clone: [{ name: "https", href: "https://bitbucket.org/acme/mobile.git" }] },
            },
          ],
        });
      }
      return json({ error: `${url} ${auth} ${token}` }, 500);
    };
    const ctx = await setup(fetchFn);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const github = config.forges.find((row) => row.kind === "github")!;
    config.forges = [
      { ...github, token: "tok-work" },
      {
        id: "gh-home",
        kind: "github",
        name: "Home GitHub",
        apiBaseUrl: "https://api.github.com",
        token: "tok-home",
      },
      { ...config.forges.find((row) => row.kind === "gitlab")!, token: "gl" },
      { ...config.forges.find((row) => row.kind === "bitbucket")!, token: "bb" },
    ];
    await ctx.store.saveConfig(config);

    const imported = await ctx.app.request("/api/repos/import", { method: "POST" });
    expect(imported.status).toBe(200);
    const body = (await imported.json()) as {
      accounts: Array<{
        accountId: string;
        kind: string;
        error?: string;
        repos: Array<{ url: string }>;
      }>;
    };
    expect(body.accounts).toHaveLength(4);
    expect(body.accounts.every((row) => !row.error)).toBe(true);
    expect(body.accounts.flatMap((row) => row.repos.map((repo) => repo.url)).sort()).toEqual([
      "https://bitbucket.org/acme/mobile.git",
      "https://github.com/acme/app.git",
      "https://github.com/me/dotfiles.git",
      "https://gitlab.com/acme/service.git",
    ]);
  });

  it("keeps git_pr host tools working without a linked catalog row", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const config = (await (await ctx.app.request("/api/config")).json()) as LocusConfig;
    const created = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: false,
      }),
    });
    const session = (await created.json()) as { id: string };
    const pr = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "git_pr", args: { title: "WIP" } }),
    });
    const prBody = (await pr.json()) as { output: string };
    expect(prBody.output).toMatch(/No repository is attached/i);
  });

  it("computes a load path from PR files and stores operator notes for the reviewer", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/repos/acme/app/pulls?state=")) {
        return json([
          {
            number: 12,
            title: "Add currency",
            html_url: "https://github.com/acme/app/pull/12",
            state: "open",
            head: { ref: "feat", sha: "abcdef123456" },
            base: { ref: "main" },
          },
        ]);
      }
      if (url.includes("/repos/acme/app/pulls/12/files")) {
        return json([
          {
            filename: "billing/serializers.py",
            status: "modified",
            patch:
              '@@ -1,4 +1,5 @@\n class InvoiceSerializer:\n     class Meta:\n-        fields = ("id",)\n+        fields = ("id", "currency")\n',
          },
          {
            filename: "billing/tests.py",
            status: "modified",
            patch:
              '@@ -1,3 +1,4 @@\n def test_invoice_serializer():\n     data = InvoiceSerializer().data\n+    assert "currency" in data\n',
          },
          {
            filename: "frontend/src/InvoicePage.tsx",
            status: "modified",
            patch:
              '@@ -1,4 +1,5 @@\n import { fetchInvoice } from "./invoiceApi";\n+import { currencyLabel } from "./format";\n export function InvoicePage() {\n   return <div />;\n }\n',
          },
        ]);
      }
      if (url.includes("/repos/acme/app/pulls/12/comments")) {
        return json([
          {
            id: 99,
            body: "Bulk assign overwrites stores",
            user: { login: "reviewer" },
            path: "billing/serializers.py",
            line: 4,
            created_at: "2026-08-01T00:00:00Z",
          },
        ]);
      }
      if (url.includes("/issues/12/comments") || url.includes("/pulls/12/commits")) {
        return json([]);
      }
      if (url.includes("/commits/") && url.endsWith("/status")) return json({ statuses: [] });
      if (url.includes("/repos/acme/app/pulls/12")) {
        return json({
          number: 12,
          title: "Add currency",
          html_url: "https://github.com/acme/app/pull/12",
          state: "open",
          body: "trace me",
          head: { ref: "feat", sha: "abcdef123456" },
          base: { ref: "main" },
        });
      }
      return json({ error: url }, 404);
    };
    const ctx = await setup(fetchFn);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const github = config.forges.find((row) => row.kind === "github")!;
    config.forges = [{ ...github, token: "tok" }];
    await ctx.store.saveConfig(config);
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/app" }),
    });
    const repo = (await created.json()) as LinkedRepo;

    const loadpath = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/loadpath`);
    expect(loadpath.status).toBe(200);
    const brief = (await loadpath.json()) as {
      risk: string;
      layers: string[];
      markdown: string;
      changeKinds: string[];
      notes?: string;
    };
    expect(brief.layers).toEqual(expect.arrayContaining(["api", "ui", "tests"]));
    expect(brief.changeKinds).toContain("public_contract");
    expect(brief.markdown).toMatch(/Load path:/);

    const stackRes = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/changestack`);
    expect(stackRes.status).toBe(200);
    const stack = (await stackRes.json()) as {
      source: string;
      headSha: string;
      cohorts: Array<{ title: string; layers: Array<{ title: string; ranges: unknown[] }> }>;
      markdown: string;
    };
    expect(stack.source).toBe("heuristic");
    expect(stack.headSha).toBe("abcdef123456");
    expect(stack.cohorts.length).toBeGreaterThan(0);
    expect(stack.markdown).toMatch(/Change stack/);
    const cached = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/changestack`);
    expect(cached.status).toBe(200);
    const rebuilt = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/changestack`, {
      method: "POST",
    });
    expect(rebuilt.status).toBe(200);
    const revisionsRes = await ctx.app.request(
      `/api/repos/${repo.id}/pulls/12/changestack/revisions`,
    );
    expect(revisionsRes.status).toBe(200);
    const revisionList = (await revisionsRes.json()) as {
      revisions: Array<{ headSha: string; current?: boolean }>;
    };
    expect(revisionList.revisions[0]!.headSha).toBe("abcdef123456");
    expect(revisionList.revisions[0]!.current).toBe(true);

    const patched = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/loadpath`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "Watch the invoice cache." }),
    });
    expect(patched.status).toBe(200);
    const withNotes = (await patched.json()) as { notes?: string; markdown: string };
    expect(withNotes.notes).toBe("Watch the invoice cache.");
    expect(withNotes.markdown).toContain("Watch the invoice cache.");

    const review = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/review-session`, {
      method: "POST",
    });
    expect(review.status).toBe(201);
    const session = (await review.json()) as {
      id: string;
      messages: Array<{ role: string; content: string }>;
      repo?: { ref?: string };
      pull?: { number?: number; headRef?: string };
    };
    expect(session.repo?.ref).toBe("feat");
    expect(session.pull).toEqual(expect.objectContaining({ number: 12, headRef: "feat" }));
    const prompt = session.messages.find((row) => row.role === "user")?.content ?? "";
    expect(prompt).toContain("git_pr_loadpath");
    expect(prompt).toContain("Watch the invoice cache.");
    expect(prompt).toContain("<untrusted-data");
    expect(prompt).toMatch(/Load path:/);
    expect(prompt).toMatch(/Change stack/);
    expect(prompt).toContain('include=["files"]');
    expect(prompt).toContain("Existing review comments");
    expect(prompt).toContain("Bulk assign overwrites stores");

    const getPr = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "git_pr_get", args: { pull_number: 12 } }),
    });
    const getBody = (await getPr.json()) as { ok?: boolean; output?: string };
    expect(getBody.output).toContain("modified billing/serializers.py");
    expect(getBody.output).toContain("currency");
    expect(getBody.output).toContain("Bulk assign overwrites stores");
    expect(getBody.output).toContain('kind="pr-text"');
    expect(getBody.output).toContain('source="patch_billing_serializers.py"');

    const commentsOnly = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "git_pr_get",
        args: { pull_number: 12, include: ["comments"] },
      }),
    });
    const commentsBody = (await commentsOnly.json()) as { output?: string };
    expect(commentsBody.output).toContain("Bulk assign overwrites stores");
    expect(commentsBody.output).not.toContain("modified billing/serializers.py");

    const tool = await ctx.app.request(`/api/sessions/${session.id}/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "git_pr_loadpath", args: { pull_number: 12 } }),
    });
    const toolBody = (await tool.json()) as { ok?: boolean; output?: string };
    expect(toolBody.output).toMatch(/Load path:/);
    expect(toolBody.output).toContain("Watch the invoice cache.");

    const missing = await ctx.app.request(`/api/repos/${repo.id}/pulls/99/loadpath`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "orphan" }),
    });
    expect(missing.status).toBeGreaterThanOrEqual(400);
    await expect(
      readFile(join(ctx.dir, "repos", repo.id, "pulls", "99.loadpath.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("summarizes on POST, never on GET, and serves archived snapshots", async () => {
    let summarizeCalls = 0;
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/repos/acme/app/pulls?") && !url.includes("/pulls/")) {
        return json([
          {
            number: 12,
            title: "Add currency",
            html_url: "https://github.com/acme/app/pull/12",
            state: "open",
            head: { ref: "feat", sha: "abcdef123456" },
            base: { ref: "main" },
          },
        ]);
      }
      if (url.includes("/repos/acme/app/pulls/12/files")) {
        return json([
          {
            filename: "billing/serializers.py",
            status: "modified",
            patch:
              '@@ -1,4 +1,5 @@\n class InvoiceSerializer:\n     class Meta:\n-        fields = ("id",)\n+        fields = ("id", "currency")\n',
          },
        ]);
      }
      if (
        url.includes("/repos/acme/app/pulls/12/comments") ||
        url.includes("/issues/12/comments") ||
        url.includes("/pulls/12/commits")
      ) {
        return json([]);
      }
      if (url.includes("/commits/") && url.endsWith("/status")) return json({ statuses: [] });
      if (url.includes("/repos/acme/app/pulls/12")) {
        return json({
          number: 12,
          title: "Add currency",
          html_url: "https://github.com/acme/app/pull/12",
          state: "open",
          body: "trace me",
          head: { ref: "feat", sha: "abcdef123456" },
          base: { ref: "main" },
        });
      }
      return json({ error: url }, 404);
    };
    const ctx = await setup(fetchFn, async ({ stack }) => {
      summarizeCalls += 1;
      const cohort = stack.cohorts[0];
      if (!cohort) return stack;
      return {
        ...stack,
        source: "heuristic+model",
        cohorts: [{ ...cohort, title: "Invoice currency contract" }],
        markdown: "## Change stack\n\nInvoice currency contract",
      };
    });
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const github = config.forges.find((row) => row.kind === "github")!;
    config.forges = [{ ...github, token: "tok" }];
    await ctx.store.saveConfig(config);
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/app" }),
    });
    const repo = (await created.json()) as LinkedRepo;

    const first = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/changestack`);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { source: string }).source).toBe("heuristic");
    expect(summarizeCalls).toBe(0);

    const review = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/review-session`, {
      method: "POST",
    });
    expect(review.status).toBe(201);
    expect(summarizeCalls).toBe(0);

    const postedA = ctx.app.request(`/api/repos/${repo.id}/pulls/12/changestack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fresh: false }),
    });
    const postedB = ctx.app.request(`/api/repos/${repo.id}/pulls/12/changestack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fresh: false }),
    });
    const [posted, postedAgain] = await Promise.all([postedA, postedB]);
    expect(posted.status).toBe(200);
    expect(postedAgain.status).toBe(200);
    const summarized = (await posted.json()) as {
      source: string;
      cohorts: Array<{ title: string }>;
    };
    expect(summarized.source).toBe("heuristic+model");
    expect(summarized.cohorts[0]!.title).toBe("Invoice currency contract");
    expect(summarizeCalls).toBe(1);

    const previous = await ctx.store.loadChangeStack(repo.id, 12);
    expect(previous).toBeTruthy();
    await ctx.store.saveChangeStack(repo.id, 12, {
      ...previous!,
      headSha: "deadbeefdead",
      generatedAt: "2026-09-01T00:00:00.000Z",
    });
    const latest = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/changestack`);
    expect(latest.status).toBe(200);
    expect(((await latest.json()) as { headSha: string }).headSha).toBe("abcdef123456");
    expect(summarizeCalls).toBe(1);

    const historical = await ctx.app.request(
      `/api/repos/${repo.id}/pulls/12/changestack?sha=deadbeefdead`,
    );
    expect(historical.status).toBe(200);
    expect(((await historical.json()) as { headSha: string }).headSha).toBe("deadbeefdead");
    const missing = await ctx.app.request(
      `/api/repos/${repo.id}/pulls/12/changestack?sha=ffffffffffff`,
    );
    expect(missing.status).toBe(404);
    const revisions = (await (
      await ctx.app.request(`/api/repos/${repo.id}/pulls/12/changestack/revisions`)
    ).json()) as { revisions: Array<{ headSha: string; current?: boolean }> };
    expect(revisions.revisions.map((row) => row.headSha)).toEqual(
      expect.arrayContaining(["abcdef123456", "deadbeefdead"]),
    );
  });

  it("starts an isolated review chat and container instead of reusing the coding session", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/repos/acme/app/pulls?") && !url.includes("/pulls/")) {
        return json([
          {
            number: 12,
            title: "Add currency",
            html_url: "https://github.com/acme/app/pull/12",
            state: "open",
            head: { ref: "feat", sha: "abcdef123456" },
            base: { ref: "main" },
          },
        ]);
      }
      if (
        url.includes("/repos/acme/app/pulls/12/files") ||
        url.includes("/repos/acme/app/pulls/12/comments") ||
        url.includes("/issues/12/comments") ||
        url.includes("/pulls/12/commits")
      ) {
        return json([]);
      }
      if (url.includes("/commits/") && url.endsWith("/status")) return json({ statuses: [] });
      if (url.includes("/repos/acme/app/pulls/12")) {
        return json({
          number: 12,
          title: "Add currency",
          html_url: "https://github.com/acme/app/pull/12",
          state: "open",
          body: "please review",
          head: { ref: "feat", sha: "abcdef123456" },
          base: { ref: "main" },
        });
      }
      return json({ error: url }, 404);
    };
    const ctx = await setup(fetchFn);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const github = config.forges.find((row) => row.kind === "github")!;
    config.forges = [{ ...github, token: "tok" }];
    await ctx.store.saveConfig(config);
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/app" }),
    });
    const repo = (await created.json()) as LinkedRepo;

    const codingRes = await ctx.app.request(`/api/repos/${repo.id}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startVm: true }),
    });
    expect(codingRes.status).toBe(201);
    const coding = (await codingRes.json()) as AgentSession;
    expect(coding.kind).not.toBe("review");
    expect(coding.vmId).toBeTruthy();

    const reviewRes = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/review-session`, {
      method: "POST",
    });
    expect(reviewRes.status).toBe(201);
    const review = (await reviewRes.json()) as AgentSession;
    expect(review.id).not.toBe(coding.id);
    expect(review.kind).toBe("review");
    expect(review.vmId).toBeTruthy();
    expect(review.vmId).not.toBe(coding.vmId);
    expect(review.pull?.number).toBe(12);
    expect(
      review.messages.some((row) => row.role === "user" && row.content.includes("git_pr_loadpath")),
    ).toBe(true);
    expect(
      review.messages.some((row) => row.content.includes("do not start a parallel session")),
    ).toBe(false);

    const codingAfter = (await (
      await ctx.app.request(`/api/sessions/${coding.id}`)
    ).json()) as AgentSession;
    expect(codingAfter.messages.some((row) => row.content.includes("git_pr_loadpath"))).toBe(false);
    expect(codingAfter.kind).not.toBe("review");
    expect(codingAfter.pull).toBeUndefined();

    const secondRes = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/review-session`, {
      method: "POST",
    });
    expect(secondRes.status).toBe(201);
    const second = (await secondRes.json()) as AgentSession;
    expect(second.id).not.toBe(review.id);
    expect(second.id).not.toBe(coding.id);
    expect(second.kind).toBe("review");
    expect(second.vmId).toBeTruthy();
    expect(second.vmId).not.toBe(review.vmId);
    expect(second.vmId).not.toBe(coding.vmId);

    const secondCodingRes = await ctx.app.request(`/api/repos/${repo.id}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startVm: true }),
    });
    expect(secondCodingRes.status).toBe(201);
    const secondCoding = (await secondCodingRes.json()) as AgentSession;
    expect(secondCoding.id).not.toBe(coding.id);
    expect(secondCoding.id).not.toBe(review.id);
    expect(secondCoding.kind).not.toBe("review");
    expect(secondCoding.vmId).toBeTruthy();
    expect(secondCoding.vmId).not.toBe(coding.vmId);
    expect(secondCoding.vmId).not.toBe(review.vmId);
    expect(secondCoding.pull).toBeUndefined();

    const detail = (await (await ctx.app.request(`/api/repos/${repo.id}/pulls/12`)).json()) as {
      sessionIds?: string[];
    };
    expect(detail.sessionIds?.sort()).toEqual([review.id, second.id].sort());
    const listed = (await (
      await ctx.app.request(`/api/repos/${repo.id}/pulls?state=open`)
    ).json()) as Array<{
      number: number;
      sessionIds?: string[];
    }>;
    expect(listed.find((row) => row.number === 12)?.sessionIds?.sort()).toEqual(
      [review.id, second.id].sort(),
    );
    expect(listed.find((row) => row.number === 12)?.sessionIds).not.toContain(coding.id);
    expect(listed.find((row) => row.number === 12)?.sessionIds).not.toContain(secondCoding.id);
  });

  it("starts a new coding chat and container instead of reusing the bound session", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/app" }),
    });
    const repo = (await created.json()) as LinkedRepo;

    const firstRes = await ctx.app.request(`/api/repos/${repo.id}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startVm: true }),
    });
    expect(firstRes.status).toBe(201);
    const first = (await firstRes.json()) as AgentSession;
    expect(first.kind).not.toBe("review");
    expect(first.repoId).toBe(repo.id);
    expect(first.runtime).toBe("docker");
    expect(first.vmId).toBeTruthy();
    expect(first.messages.filter((m) => m.role !== "system")).toEqual([]);

    const reuseRes = await ctx.app.request(`/api/repos/${repo.id}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startVm: true, reuse: true }),
    });
    expect(reuseRes.status).toBe(201);
    const reused = (await reuseRes.json()) as AgentSession;
    expect(reused.id).toBe(first.id);
    expect(reused.vmId).toBe(first.vmId);

    const secondRes = await ctx.app.request(`/api/repos/${repo.id}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startVm: true }),
    });
    expect(secondRes.status).toBe(201);
    const second = (await secondRes.json()) as AgentSession;
    expect(second.id).not.toBe(first.id);
    expect(second.kind).not.toBe("review");
    expect(second.repoId).toBe(repo.id);
    expect(second.runtime).toBe("docker");
    expect(second.vmId).toBeTruthy();
    expect(second.vmId).not.toBe(first.vmId);
    expect(second.messages.filter((m) => m.role !== "system")).toEqual([]);

    const stillFirst = (await (
      await ctx.app.request(`/api/sessions/${first.id}`)
    ).json()) as AgentSession;
    expect(stillFirst.id).toBe(first.id);
    expect(stillFirst.vmId).toBe(first.vmId);
  });

  it("starts a setup-environment agent that writes the env-setup playbook", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/app" }),
    });
    const repo = (await created.json()) as LinkedRepo;
    const res = await ctx.app.request(`/api/repos/${repo.id}/setup-environment`, {
      method: "POST",
    });
    expect(res.status).toBe(201);
    const session = (await res.json()) as AgentSession;
    expect(session.kind).toBe("setup");
    expect(session.runtime).toBe("docker");
    expect(session.repoId).toBe(repo.id);
    expect(session.title).toMatch(/Setup environment/);
    expect(session.playbook).toMatch(/\.locus\/environment\.json/);
    expect(session.vmId).toBeTruthy();
    expect(
      session.messages.some(
        (row) => row.role === "user" && row.content.includes(".locus/environment.json"),
      ),
    ).toBe(true);
    expect(
      session.messages.some(
        (row) => row.role === "user" && row.content.includes("https://github.com/acme/app"),
      ),
    ).toBe(true);

    const reuseRes = await ctx.app.request(`/api/repos/${repo.id}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startVm: true, reuse: true }),
    });
    expect(reuseRes.status).toBe(201);
    const reused = (await reuseRes.json()) as AgentSession;
    expect(reused.id).not.toBe(session.id);
    expect(reused.kind).not.toBe("setup");
    expect(reused.repoId).toBe(repo.id);
  });

  it("starts a fix session on the PR head with the reviewer findings", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/repos/acme/app/pulls?") && !url.includes("/pulls/")) {
        return json([
          {
            number: 12,
            title: "Add currency",
            html_url: "https://github.com/acme/app/pull/12",
            state: "open",
            head: { ref: "feat", sha: "abcdef123456" },
            base: { ref: "main" },
          },
        ]);
      }
      if (
        url.includes("/repos/acme/app/pulls/12/files") ||
        url.includes("/repos/acme/app/pulls/12/comments") ||
        url.includes("/issues/12/comments") ||
        url.includes("/pulls/12/commits")
      ) {
        return json([]);
      }
      if (url.includes("/commits/") && url.endsWith("/status")) return json({ statuses: [] });
      if (url.includes("/repos/acme/app/pulls/12")) {
        return json({
          number: 12,
          title: "Add currency",
          html_url: "https://github.com/acme/app/pull/12",
          state: "open",
          body: "please review",
          head: { ref: "feat", sha: "abcdef123456" },
          base: { ref: "main" },
        });
      }
      return json({ error: url }, 404);
    };
    const ctx = await setup(fetchFn);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const github = config.forges.find((row) => row.kind === "github")!;
    config.forges = [{ ...github, token: "tok" }];
    await ctx.store.saveConfig(config);
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/app" }),
    });
    const repo = (await created.json()) as LinkedRepo;
    const reviewRes = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/review-session`, {
      method: "POST",
    });
    expect(reviewRes.status).toBe(201);
    const review = (await reviewRes.json()) as AgentSession;
    await ctx.store.mutateSession(review.id, (current) => {
      current.messages.push(
        { id: "u1", role: "user", content: "review this", createdAt: "2020-01-01T00:00:00.000Z" },
        {
          id: "a1",
          role: "assistant",
          content: '{"verdict":"FAIL","reasons":["stale rows"],"risk":"high"}',
          createdAt: "2020-01-01T00:00:01.000Z",
        },
        {
          id: "u2",
          role: "user",
          content: "Can you continue on?",
          createdAt: "2020-01-01T00:00:02.000Z",
        },
        {
          id: "a2",
          role: "assistant",
          content: "Still looking at the hop.",
          createdAt: "2020-01-01T00:00:03.000Z",
        },
      );
    });

    const fixRes = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/fix-session`, {
      method: "POST",
    });
    expect(fixRes.status).toBe(201);
    const fix = (await fixRes.json()) as AgentSession;
    expect(fix.id).not.toBe(review.id);
    expect(fix.kind).not.toBe("review");
    expect(fix.repoId).toBe(repo.id);
    expect(fix.pull?.number).toBe(12);
    expect(fix.repo?.ref).toBe("feat");
    const prompt = fix.messages.find((row) => row.role === "user")?.content ?? "";
    expect(prompt).toContain("Implement the reviewer's findings");
    expect(prompt).toContain("Reviewer FAIL (risk high): stale rows");
  });

  it("reuses a cached PR list and detail until fresh=1", async () => {
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/repos/acme/app/pulls?") && !url.includes("/pulls/")) {
        return json([
          {
            number: 12,
            title: "Fix",
            html_url: "https://github.com/acme/app/pull/12",
            state: "open",
            head: { ref: "feat", sha: "abc" },
            base: { ref: "main" },
          },
        ]);
      }
      if (
        url.includes("/repos/acme/app/pulls/12/files") ||
        url.includes("/repos/acme/app/pulls/12/comments") ||
        url.includes("/issues/12/comments") ||
        url.includes("/pulls/12/commits")
      ) {
        return json([]);
      }
      if (url.includes("/commits/") && url.endsWith("/status")) return json({ statuses: [] });
      if (url.includes("/repos/acme/app/pulls/12")) {
        return json({
          number: 12,
          title: "Fix",
          html_url: "https://github.com/acme/app/pull/12",
          state: "open",
          head: { ref: "feat", sha: "abc" },
          base: { ref: "main" },
        });
      }
      return json({ error: url }, 404);
    };
    const ctx = await setup(fetchFn);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const github = config.forges.find((row) => row.kind === "github")!;
    config.forges = [{ ...github, token: "tok" }];
    await ctx.store.saveConfig(config);
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/app" }),
    });
    const repo = (await created.json()) as LinkedRepo;

    const listed = await ctx.app.request(`/api/repos/${repo.id}/pulls?state=open`);
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { number: number }[])[0]?.number).toBe(12);
    const listedAgain = await ctx.app.request(`/api/repos/${repo.id}/pulls?state=open`);
    expect(listedAgain.status).toBe(200);
    expect(urls.filter((url) => url.includes("/pulls?state=open"))).toHaveLength(1);

    const detail = await ctx.app.request(`/api/repos/${repo.id}/pulls/12`);
    expect(detail.status).toBe(200);
    const afterDetail = urls.length;
    const detailAgain = await ctx.app.request(`/api/repos/${repo.id}/pulls/12`);
    expect(detailAgain.status).toBe(200);
    expect(urls).toHaveLength(afterDetail);

    const freshList = await ctx.app.request(`/api/repos/${repo.id}/pulls?state=open&fresh=1`);
    expect(freshList.status).toBe(200);
    expect(urls.filter((url) => url.includes("/pulls?state=open"))).toHaveLength(2);

    await ctx.store.savePullListCache(repo.id, "open", [], "2020-01-01T00:00:00.000Z");
    const stale = await ctx.app.request(`/api/repos/${repo.id}/pulls?state=open`);
    expect(stale.status).toBe(200);
    expect(urls.filter((url) => url.includes("/pulls?state=open"))).toHaveLength(3);
  });

  it("stores a per-repo review prompt and appends it to review sessions", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/repos/acme/app/pulls?") && !url.includes("/pulls/")) {
        return json([
          {
            number: 12,
            title: "Add currency",
            html_url: "https://github.com/acme/app/pull/12",
            state: "open",
            head: { ref: "feat", sha: "abcdef123456" },
            base: { ref: "main" },
          },
        ]);
      }
      if (
        url.includes("/repos/acme/app/pulls/12/files") ||
        url.includes("/repos/acme/app/pulls/12/comments") ||
        url.includes("/issues/12/comments") ||
        url.includes("/pulls/12/commits")
      ) {
        return json([]);
      }
      if (url.includes("/commits/") && url.endsWith("/status")) return json({ statuses: [] });
      if (url.includes("/repos/acme/app/pulls/12")) {
        return json({
          number: 12,
          title: "Add currency",
          html_url: "https://github.com/acme/app/pull/12",
          state: "open",
          body: "please review",
          head: { ref: "feat", sha: "abcdef123456" },
          base: { ref: "main" },
        });
      }
      return json({ error: url }, 404);
    };
    const ctx = await setup(fetchFn);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const github = config.forges.find((row) => row.kind === "github")!;
    config.forges = [{ ...github, token: "tok" }];
    await ctx.store.saveConfig(config);
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/app" }),
    });
    const repo = (await created.json()) as LinkedRepo;
    const patched = await ctx.app.request(`/api/repos/${repo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewPrompt: "No new public APIs without OpenAPI." }),
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as LinkedRepo).reviewPrompt).toBe(
      "No new public APIs without OpenAPI.",
    );
    const reviewRes = await ctx.app.request(`/api/repos/${repo.id}/pulls/12/review-session`, {
      method: "POST",
    });
    expect(reviewRes.status).toBe(201);
    const review = (await reviewRes.json()) as AgentSession;
    expect(review.playbook).toContain("standard review lens");
    expect(review.playbook).toContain("Repo review prompt:");
    expect(review.playbook).toContain("No new public APIs without OpenAPI.");
  });

  it("saves a named environment from setup and boots later agents from the golden image", async () => {
    const ctx = await setup();
    cleanup.push(ctx.dir);
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/app" }),
    });
    const repo = (await created.json()) as LinkedRepo;
    const setupRes = await ctx.app.request(`/api/repos/${repo.id}/setup-environment`, {
      method: "POST",
    });
    expect(setupRes.status).toBe(201);
    const setupSession = (await setupRes.json()) as AgentSession;
    expect(setupSession.kind).toBe("setup");
    const saved = await ctx.app.request(`/api/sessions/${setupSession.id}/save-environment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "acme-prod" }),
    });
    expect(saved.status).toBe(201);
    const body = (await saved.json()) as {
      image: { id: string };
      environment: { id: string; name: string; imageId?: string; recipeId?: string };
      repo?: { namedEnvironmentId?: string };
    };
    expect(body.environment.name).toBe("acme-prod");
    expect(body.environment.imageId).toBe(body.image.id);
    expect(body.environment.recipeId).toBeUndefined();
    expect(body.repo?.namedEnvironmentId).toBe(body.environment.id);

    const agentRes = await ctx.app.request(`/api/repos/${repo.id}/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startVm: false }),
    });
    expect(agentRes.status).toBe(201);
    const agent = (await agentRes.json()) as AgentSession;
    expect(agent.kind).not.toBe("setup");
    expect(agent.imageId).toBe(body.image.id);
  });

  it("lists, gets, comments, and caches forge issues", async () => {
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/repos/acme/app/issues?") && !url.includes("/issues/")) {
        return json([
          {
            number: 7,
            title: "Login 500",
            html_url: "https://github.com/acme/app/issues/7",
            state: "open",
            user: { login: "ada" },
            labels: [{ name: "bug" }],
          },
          {
            number: 8,
            title: "PR as issue",
            html_url: "https://github.com/acme/app/pull/8",
            state: "open",
            pull_request: { url: "https://api.github.com/repos/acme/app/pulls/8" },
          },
        ]);
      }
      if (url.includes("/repos/acme/app/issues/7/comments") && init?.method === "POST") {
        return json({ id: 99, body: "ship it" });
      }
      if (url.includes("/repos/acme/app/issues/7/comments")) {
        return json([
          {
            id: 11,
            body: "repro on main",
            user: { login: "sam" },
            created_at: "2026-10-01T00:00:00.000Z",
          },
        ]);
      }
      if (url.includes("/repos/acme/app/issues/7")) {
        return json({
          number: 7,
          title: "Login 500",
          html_url: "https://github.com/acme/app/issues/7",
          state: "open",
          body: "stack overflow",
          user: { login: "ada" },
          labels: [{ name: "bug" }],
        });
      }
      return json({ error: url }, 404);
    };
    const ctx = await setup(fetchFn);
    cleanup.push(ctx.dir);
    const config = await ctx.store.loadConfig();
    const github = config.forges.find((row) => row.kind === "github")!;
    config.forges = [{ ...github, token: "tok" }];
    await ctx.store.saveConfig(config);
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/app" }),
    });
    const repo = (await created.json()) as LinkedRepo;

    const listed = await ctx.app.request(`/api/repos/${repo.id}/issues?state=open`);
    expect(listed.status).toBe(200);
    const rows = (await listed.json()) as { number: number; title: string }[];
    expect(rows.map((row) => row.number)).toEqual([7]);
    const listedAgain = await ctx.app.request(`/api/repos/${repo.id}/issues?state=open`);
    expect(listedAgain.status).toBe(200);
    expect(urls.filter((url) => url.includes("/issues?state=open"))).toHaveLength(1);

    const detail = await ctx.app.request(`/api/repos/${repo.id}/issues/7`);
    expect(detail.status).toBe(200);
    const issue = (await detail.json()) as { body?: string; comments: { body: string }[] };
    expect(issue.body).toBe("stack overflow");
    expect(issue.comments[0]?.body).toBe("repro on main");

    const comment = await ctx.app.request(`/api/repos/${repo.id}/issues/7/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "ship it" }),
    });
    expect(comment.status).toBe(200);
  });
});

describe("repos api without a forge token", () => {
  const pull = {
    number: 7,
    title: "Add router",
    html_url: "https://github.com/honojs/hono/pull/7",
    state: "open",
    head: { ref: "feat", sha: "abc" },
    base: { ref: "main" },
    updated_at: "2026-01-01T00:00:00Z",
  };

  function publicGithub(calls: Array<{ url: string; auth: string | null; method: string }>) {
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        auth: new Headers(init?.headers).get("authorization"),
        method: init?.method ?? "GET",
      });
      if (url.endsWith("/repos/honojs/hono")) return json({ default_branch: "main" });
      if (url.includes("/repos/honojs/hono/branches")) return json([{ name: "main" }]);
      if (url.includes("/repos/honojs/hono/pulls?")) return json([pull]);
      if (url.includes("/repos/honojs/hono/issues?")) return json([]);
      return json({ message: "Not Found" }, 404);
    };
    return fetchFn;
  }

  async function linkHono(ctx: Awaited<ReturnType<typeof setup>>, url = "honojs/hono") {
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `https://github.com/${url}` }),
    });
    expect(created.status).toBe(201);
    return (await created.json()) as LinkedRepo;
  }

  it("reads a public GitHub repo's pulls unauthenticated and fills the default branch", async () => {
    const calls: Array<{ url: string; auth: string | null; method: string }> = [];
    const ctx = await setup(publicGithub(calls));
    cleanup.push(ctx.dir);
    const repo = await linkHono(ctx);
    expect(repo.checkout.ref).toBe("main");
    const res = await ctx.app.request(`/api/repos/${repo.id}/pulls`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Array<{ number: number }>).map((row) => row.number)).toEqual([7]);
    const issues = await ctx.app.request(`/api/repos/${repo.id}/issues`);
    expect(issues.status).toBe(200);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((row) => row.auth === null)).toBe(true);
  });

  it("returns a needs-token error when the forge refuses an anonymous read", async () => {
    const ctx = await setup(async () => json({ message: "Not Found" }, 404));
    cleanup.push(ctx.dir);
    const repo = await linkHono(ctx, "acme/private");
    expect(repo.checkout.ref).toBeUndefined();
    const res = await ctx.app.request(`/api/repos/${repo.id}/pulls`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /GitHub needs a token to read this repo/,
    );
  });

  it("returns a rate-limit error when the anonymous quota is spent", async () => {
    const ctx = await setup(
      async () =>
        new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
    );
    cleanup.push(ctx.dir);
    const repo = await linkHono(ctx);
    const res = await ctx.app.request(`/api/repos/${repo.id}/issues`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/rate limit reached/);
  });

  it("still requires a token to merge, comment, or review", async () => {
    const calls: Array<{ url: string; auth: string | null; method: string }> = [];
    const ctx = await setup(publicGithub(calls));
    cleanup.push(ctx.dir);
    const repo = await linkHono(ctx);
    calls.length = 0;
    for (const [path, body] of [
      ["merge", {}],
      ["comments", { body: "hi" }],
      ["reviews", { body: "hi" }],
    ] as const) {
      const res = await ctx.app.request(`/api/repos/${repo.id}/pulls/7/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/token/);
    }
    expect(calls.filter((row) => row.method !== "GET")).toEqual([]);
  });
});
