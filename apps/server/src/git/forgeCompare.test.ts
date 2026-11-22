import { describe, expect, it } from "vitest";
import type { GitForgeAccount } from "@locus/shared";
import { ForgeClient } from "./forge.js";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

function account(kind: GitForgeAccount["kind"], apiBaseUrl?: string): GitForgeAccount {
  return {
    id: `${kind}-1`,
    kind,
    name: kind,
    token: "tok",
    apiBaseUrl:
      apiBaseUrl ??
      (kind === "gitlab"
        ? "https://gitlab.com/api/v4"
        : kind === "bitbucket"
          ? "https://api.bitbucket.org/2.0"
          : "https://api.github.com"),
  };
}

type Call = { url: string; method: string; body?: string };

function clientFor(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  forge: ForgeClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return handler(url, init);
  };
  return { forge: new ForgeClient(fetchFn), calls };
}

describe("GitLab compareCommits / readFile / resolveReviewThreads", () => {
  const gl = account("gitlab", "https://git.example.com/api/v4");
  const project = "/projects/acme%2Fsvc";

  it("returns hunk-form files when base is an ancestor of head", async () => {
    const { forge, calls } = clientFor((url) => {
      if (url.includes(`${project}/repository/merge_base`)) return json({ id: BASE });
      if (url.includes(`${project}/repository/compare`)) {
        return json({
          commits: [{ id: HEAD }],
          diffs: [
            { new_path: "src/a.ts", old_path: "src/a.ts", diff: "@@ -1 +1 @@\n-a\n+b\n" },
            { new_path: "src/new.ts", old_path: "src/new.ts", new_file: true, diff: "@@ +1 @@" },
            { new_path: "src/c.ts", old_path: "src/b.ts", renamed_file: true, diff: "" },
          ],
        });
      }
      return json({}, 404);
    });
    const files = await forge.compareCommits(gl, "acme", "svc", BASE, HEAD);
    expect(files).toEqual([
      {
        path: "src/a.ts",
        previousPath: undefined,
        status: "modified",
        patch: "@@ -1 +1 @@\n-a\n+b\n",
      },
      { path: "src/new.ts", previousPath: undefined, status: "added", patch: "@@ +1 @@" },
      { path: "src/c.ts", previousPath: "src/b.ts", status: "renamed", patch: "" },
    ]);
    expect(calls.every((call) => call.url.startsWith("https://git.example.com/api/v4/"))).toBe(
      true,
    );
    const compare = calls.find((call) => call.url.includes("/repository/compare"));
    expect(compare?.url).toContain(`from=${BASE}&to=${HEAD}&straight=false`);
  });

  it("returns undefined after a force-push (merge base is not base)", async () => {
    const { forge } = clientFor((url) => {
      if (url.includes("/repository/merge_base")) return json({ id: "c".repeat(40) });
      if (url.includes("/repository/compare")) {
        return json({ commits: [{ id: HEAD }], diffs: [{ new_path: "x", diff: "@@" }] });
      }
      return json({}, 404);
    });
    expect(await forge.compareCommits(gl, "acme", "svc", BASE, HEAD)).toBeUndefined();
  });

  it("returns undefined when head has no new commits", async () => {
    const { forge } = clientFor((url) => {
      if (url.includes("/repository/merge_base")) return json({ id: BASE });
      if (url.includes("/repository/compare")) return json({ commits: [], diffs: [] });
      return json({}, 404);
    });
    expect(await forge.compareCommits(gl, "acme", "svc", BASE, BASE)).toBeUndefined();
  });

  it("reads a raw file and returns undefined on 404 or oversize", async () => {
    const { forge, calls } = clientFor((url) => {
      if (url.includes("/repository/files/docs%2FREVIEW.md/raw")) return text("# Rules\n");
      if (url.includes("/repository/files/big.txt/raw")) return text("x".repeat(300 * 1024));
      return json({ message: "404 File Not Found" }, 404);
    });
    expect(await forge.readFile(gl, "acme", "svc", "docs/REVIEW.md", "main")).toBe("# Rules\n");
    expect(calls[0]?.url).toBe(
      "https://git.example.com/api/v4/projects/acme%2Fsvc/repository/files/docs%2FREVIEW.md/raw?ref=main",
    );
    expect(await forge.readFile(gl, "acme", "svc", "missing.md", "main")).toBeUndefined();
    expect(await forge.readFile(gl, "acme", "svc", "big.txt", "main")).toBeUndefined();
  });

  it("resolves only picked, unresolved, resolvable discussions", async () => {
    const { forge, calls } = clientFor((url, init) => {
      if (url.includes("/merge_requests/7/discussions?per_page=100")) {
        return json([
          {
            id: "d1",
            notes: [
              {
                body: "bot: fix this",
                resolvable: true,
                resolved: false,
                author: { username: "locus-bot" },
                position: { new_path: "src/a.ts", new_line: 12 },
              },
            ],
          },
          {
            id: "d2",
            notes: [
              {
                body: "bot: already",
                resolvable: true,
                resolved: true,
                author: { username: "locus-bot" },
              },
            ],
          },
          {
            id: "d3",
            notes: [
              {
                body: "human note",
                resolvable: true,
                resolved: false,
                author: { username: "ann" },
              },
            ],
          },
          {
            id: "d4",
            notes: [
              {
                body: "bot: general",
                resolvable: false,
                resolved: false,
                author: { username: "locus-bot" },
              },
            ],
          },
        ]);
      }
      if (init?.method === "PUT") return json({ id: "d1", notes: [] });
      return json({}, 404);
    });
    const seen: unknown[] = [];
    const count = await forge.resolveReviewThreads(gl, "acme", "svc", 7, (thread) => {
      seen.push(thread);
      return thread.author === "locus-bot";
    });
    expect(count).toBe(1);
    expect(seen).toEqual([
      { path: "src/a.ts", line: 12, body: "bot: fix this", author: "locus-bot" },
      { path: undefined, line: undefined, body: "human note", author: "ann" },
    ]);
    const puts = calls.filter((call) => call.method === "PUT");
    expect(puts.map((call) => call.url)).toEqual([
      "https://git.example.com/api/v4/projects/acme%2Fsvc/merge_requests/7/discussions/d1?resolved=true",
    ]);
  });
});

describe("Bitbucket compareCommits / readFile", () => {
  const bb = account("bitbucket");
  const root = "https://api.bitbucket.org/2.0/repositories/acme/mobile";
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 111..222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "diff --git a/old.ts b/new.ts",
    "similarity index 90%",
    "rename from old.ts",
    "rename to new.ts",
    "--- a/old.ts",
    "+++ b/new.ts",
    "@@ -2 +2 @@",
    "-x",
    "+y",
    "",
  ].join("\n");

  it("returns files with per-file patches when base is an ancestor (spec is head..base)", async () => {
    const { forge, calls } = clientFor((url) => {
      if (url === `${root}/merge-base/${HEAD}..${BASE}`) return json({ hash: BASE });
      if (url === `${root}/diffstat/${HEAD}..${BASE}?pagelen=100`) {
        return json({
          values: [
            { status: "modified", old: { path: "src/a.ts" }, new: { path: "src/a.ts" } },
            { status: "renamed", old: { path: "old.ts" }, new: { path: "new.ts" } },
          ],
        });
      }
      if (url === `${root}/diff/${HEAD}..${BASE}`) return text(diff);
      return json({}, 404);
    });
    const files = await forge.compareCommits(bb, "acme", "mobile", BASE, HEAD);
    expect(files?.map((file) => [file.path, file.status, file.previousPath])).toEqual([
      ["src/a.ts", "modified", undefined],
      ["new.ts", "renamed", "old.ts"],
    ]);
    expect(files?.[0]?.patch).toContain("@@ -1 +1 @@\n-a\n+b");
    expect(files?.[0]?.patch).not.toContain("new.ts");
    expect(files?.[1]?.patch).toContain("@@ -2 +2 @@\n-x\n+y");
    expect(calls[0]?.url).toBe(`${root}/merge-base/${HEAD}..${BASE}`);
  });

  it("returns undefined after a force-push without fetching the diff", async () => {
    const { forge, calls } = clientFor((url) => {
      if (url.includes("/merge-base/")) return json({ hash: "c".repeat(40) });
      return json({}, 404);
    });
    expect(await forge.compareCommits(bb, "acme", "mobile", BASE, HEAD)).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("returns undefined when the merge base can't be read", async () => {
    const { forge } = clientFor(() => json({ error: { message: "nope" } }, 404));
    expect(await forge.compareCommits(bb, "acme", "mobile", BASE, HEAD)).toBeUndefined();
  });

  it("reads a file, and returns undefined on 404, directories, and oversize", async () => {
    const { forge, calls } = clientFor((url) => {
      if (url === `${root}/src/main/docs/REVIEW%20rules.md`) return text("be kind\n");
      if (url === `${root}/src/main/docs`) {
        return json({
          values: [
            { type: "commit_file", path: "docs/a.md" },
            { type: "commit_directory", path: "docs/sub" },
          ],
          pagelen: 10,
        });
      }
      if (url === `${root}/src/main/big.txt`) return text("x".repeat(300 * 1024));
      return json({ type: "error" }, 404);
    });
    expect(await forge.readFile(bb, "acme", "mobile", "docs/REVIEW rules.md", "main")).toBe(
      "be kind\n",
    );
    expect(calls[0]?.url).toBe(`${root}/src/main/docs/REVIEW%20rules.md`);
    expect(await forge.readFile(bb, "acme", "mobile", "missing.md", "main")).toBeUndefined();
    expect(await forge.readFile(bb, "acme", "mobile", "docs", "main")).toBeUndefined();
    expect(await forge.readFile(bb, "acme", "mobile", "big.txt", "main")).toBeUndefined();
  });

  it("has no resolveReviewThreads, so the client returns 0", async () => {
    const { forge, calls } = clientFor(() => json({}));
    expect(await forge.resolveReviewThreads(bb, "acme", "mobile", 1, () => true)).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("GitHub resolveReviewThreads", () => {
  const gh = account("github");

  it("resolves only picked, unresolved threads via GraphQL", async () => {
    const mutations: string[] = [];
    const { forge } = clientFor((url, init) => {
      expect(url).toBe("https://api.github.com/graphql");
      const payload = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      if (payload.query.includes("reviewThreads")) {
        expect(payload.variables).toEqual({ owner: "acme", name: "app", number: 5 });
        return json({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [
                    {
                      id: "T1",
                      isResolved: false,
                      path: "src/a.ts",
                      line: 10,
                      originalLine: 9,
                      comments: { nodes: [{ body: "bot: one", author: { login: "locus[bot]" } }] },
                    },
                    {
                      id: "T2",
                      isResolved: true,
                      path: "src/b.ts",
                      line: 3,
                      comments: { nodes: [{ body: "bot: done", author: { login: "locus[bot]" } }] },
                    },
                    {
                      id: "T3",
                      isResolved: false,
                      path: "src/c.ts",
                      line: null,
                      originalLine: 4,
                      comments: { nodes: [{ body: "human", author: { login: "ann" } }] },
                    },
                    {
                      id: "T4",
                      isResolved: false,
                      path: "src/d.ts",
                      line: null,
                      originalLine: 8,
                      comments: {
                        nodes: [{ body: "bot: outdated", author: { login: "locus[bot]" } }],
                      },
                    },
                  ],
                },
              },
            },
          },
        });
      }
      mutations.push(String(payload.variables.id));
      return json({ data: { resolveReviewThread: { thread: { isResolved: true } } } });
    });
    const seen: unknown[] = [];
    const count = await forge.resolveReviewThreads(gh, "acme", "app", 5, (thread) => {
      seen.push(thread);
      return thread.author === "locus[bot]";
    });
    expect(count).toBe(2);
    expect(mutations).toEqual(["T1", "T4"]);
    expect(seen).toEqual([
      { path: "src/a.ts", line: 10, body: "bot: one", author: "locus[bot]" },
      { path: "src/c.ts", line: 4, body: "human", author: "ann" },
      { path: "src/d.ts", line: 8, body: "bot: outdated", author: "locus[bot]" },
    ]);
  });

  it("returns 0 when the GraphQL query fails", async () => {
    const { forge } = clientFor(() => json({ message: "Bad credentials" }, 401));
    expect(await forge.resolveReviewThreads(gh, "acme", "app", 5, () => true)).toBe(0);
  });

  it("is a no-op for Gitea / Forgejo", async () => {
    const { forge, calls } = clientFor(() => json({}));
    const gitea = account("gitea", "https://gitea.example.com/api/v1");
    expect(await forge.resolveReviewThreads(gitea, "acme", "app", 5, () => true)).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
