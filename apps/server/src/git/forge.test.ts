import { describe, expect, it } from "vitest";
import type { GitForgeAccount } from "@locus/shared";
import { ForgeClient } from "./forge.js";
import { createGithubForgeAdapter } from "./githubForge.js";
import { createGitlabForgeAdapter } from "./gitlabForge.js";
import { createBitbucketForgeAdapter } from "./bitbucketForge.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function account(
  partial: Partial<GitForgeAccount> & Pick<GitForgeAccount, "id" | "kind" | "token">,
): GitForgeAccount {
  const apiBaseUrl =
    partial.apiBaseUrl ??
    (partial.kind === "gitlab"
      ? "https://gitlab.com/api/v4"
      : partial.kind === "bitbucket"
        ? "https://api.bitbucket.org/2.0"
        : "https://api.github.com");
  return { name: partial.name ?? partial.kind, apiBaseUrl, ...partial };
}

function clientFor(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): ForgeClient {
  const fetchFn: typeof fetch = async (input, init) => handler(String(input), init);
  return new ForgeClient(fetchFn);
}

describe("ForgeClient", () => {
  it("lists repos from GitHub, GitLab, and Bitbucket using each account token", async () => {
    const forge = clientFor((url, init) => {
      const headers = new Headers(init?.headers);
      const auth = headers.get("authorization") ?? "";
      const token = headers.get("private-token") ?? "";
      if (url.includes("api.github.com/user/repos") && auth === "Bearer gh-work") {
        return json([
          {
            name: "app",
            full_name: "acme/app",
            clone_url: "https://github.com/acme/app.git",
            owner: { login: "acme" },
            default_branch: "main",
          },
        ]);
      }
      if (url.includes("api.github.com/user/repos") && auth === "Bearer gh-home") {
        return json([
          {
            name: "dotfiles",
            full_name: "me/dotfiles",
            clone_url: "https://github.com/me/dotfiles.git",
            owner: { login: "me" },
          },
        ]);
      }
      if (url.includes("gitlab.com/api/v4/projects") && token === "gl-token") {
        return json([
          {
            path_with_namespace: "acme/service",
            path: "service",
            http_url_to_repo: "https://gitlab.com/acme/service.git",
            default_branch: "main",
          },
        ]);
      }
      if (url.includes("api.bitbucket.org/2.0/repositories") && auth === "Bearer bb-token") {
        return json({
          values: [
            {
              full_name: "acme/mobile",
              name: "mobile",
              links: { clone: [{ name: "https", href: "https://bitbucket.org/acme/mobile.git" }] },
              mainbranch: { name: "main" },
            },
          ],
        });
      }
      return json({ error: url }, 404);
    });

    const work = await forge.listRepos(
      account({ id: "gh1", kind: "github", token: "gh-work", name: "Work" }),
    );
    const home = await forge.listRepos(
      account({ id: "gh2", kind: "github", token: "gh-home", name: "Home" }),
    );
    const gl = await forge.listRepos(account({ id: "gl1", kind: "gitlab", token: "gl-token" }));
    const bb = await forge.listRepos(account({ id: "bb1", kind: "bitbucket", token: "bb-token" }));
    expect(work.map((row) => row.url)).toEqual(["https://github.com/acme/app.git"]);
    expect(home.map((row) => `${row.accountId}:${row.name}`)).toEqual(["gh2:dotfiles"]);
    expect(gl[0]).toMatchObject({ forge: "gitlab", owner: "acme", name: "service" });
    expect(bb[0]).toMatchObject({ forge: "bitbucket", owner: "acme", name: "mobile" });
  });

  it("lists and opens pull requests on all three forges", async () => {
    const forge = clientFor((url, init) => {
      if (url.includes("/repos/acme/app/pulls") && !url.includes("/pulls/")) {
        return json([
          {
            number: 3,
            title: "Fix",
            html_url: "https://github.com/acme/app/pull/3",
            state: "open",
            head: { ref: "feat" },
            base: { ref: "main" },
          },
        ]);
      }
      if (url.includes("/merge_requests") && init?.method === "POST") {
        return json({
          iid: 9,
          title: "MR",
          web_url: "https://gitlab.com/acme/app/-/merge_requests/9",
        });
      }
      if (url.includes("/pullrequests") && init?.method === "POST") {
        return json({
          id: 4,
          title: "BB",
          links: { html: { href: "https://bitbucket.org/acme/app/pull-requests/4" } },
        });
      }
      return json({ error: url }, 404);
    });
    const gh = account({ id: "gh1", kind: "github", token: "t" });
    const gl = account({ id: "gl1", kind: "gitlab", token: "t" });
    const bb = account({ id: "bb1", kind: "bitbucket", token: "t" });
    const listed = await forge.listPulls(gh, "acme", "app", "open");
    expect(listed[0]?.number).toBe(3);
    expect(
      await forge.createPull(gl, "acme", "app", { title: "MR", head: "feat", base: "main" }),
    ).toMatchObject({
      number: 9,
      url: "https://gitlab.com/acme/app/-/merge_requests/9",
    });
    expect(
      await forge.createPull(bb, "acme", "app", { title: "BB", head: "feat", base: "main" }),
    ).toMatchObject({
      number: 4,
    });
  });

  it("maps GitHub GraphQL list fields for the PR table", async () => {
    const forge = clientFor((url) => {
      if (url.includes("api.github.com/graphql")) {
        return json({
          data: {
            repository: {
              pullRequests: {
                nodes: [
                  {
                    number: 42,
                    title: "Copy paste nodes",
                    url: "https://github.com/acme/app/pull/42",
                    isDraft: true,
                    state: "OPEN",
                    createdAt: "2026-08-24T00:00:00.000Z",
                    updatedAt: "2026-09-10T11:00:00.000Z",
                    author: { login: "jack", avatarUrl: "https://avatars.example/jack.png" },
                    headRefName: "cursor/copy-paste",
                    baseRefName: "develop",
                    headRefOid: "abc123",
                    comments: { totalCount: 5 },
                    reviews: { totalCount: 4 },
                    reviewRequests: { nodes: [] },
                    commits: {
                      nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }],
                    },
                  },
                ],
              },
            },
          },
        });
      }
      return json({ error: url }, 404);
    });
    const listed = await forge.listPulls(
      account({ id: "gh1", kind: "github", token: "t" }),
      "acme",
      "app",
      "open",
    );
    expect(listed[0]).toMatchObject({
      number: 42,
      draft: true,
      author: "jack",
      authorAvatarUrl: "https://avatars.example/jack.png",
      createdAt: "2026-08-24T00:00:00.000Z",
      commentCount: 5,
      reviewCount: 4,
      checkState: "success",
      headRef: "cursor/copy-paste",
      baseRef: "develop",
    });
  });

  it("maps GitLab and Bitbucket list metadata for the PR table", async () => {
    const forge = clientFor((url) => {
      if (url.includes("gitlab.com") && url.includes("/merge_requests?state=opened")) {
        return json([
          {
            iid: 2,
            title: "GL",
            web_url: "https://gitlab.com/acme/app/-/merge_requests/2",
            state: "opened",
            author: { username: "ada", avatar_url: "https://gitlab.com/ada.png" },
            created_at: "2026-09-01T00:00:00.000Z",
            updated_at: "2026-09-10T00:00:00.000Z",
            source_branch: "feat",
            target_branch: "main",
            sha: "def",
            user_notes_count: 3,
            reviewers: [{ username: "sam" }],
            head_pipeline: { status: "failed" },
          },
        ]);
      }
      if (url.includes("api.bitbucket.org") && url.includes("state=OPEN")) {
        return json({
          values: [
            {
              id: 9,
              title: "BB open",
              state: "OPEN",
              draft: false,
              created_on: "2026-09-02T00:00:00.000Z",
              updated_on: "2026-09-10T00:00:00.000Z",
              comment_count: 2,
              author: {
                nickname: "pat",
                links: { avatar: { href: "https://bitbucket.org/pat.png" } },
              },
              source: { branch: { name: "feat" }, commit: { hash: "mno" } },
              destination: { branch: { name: "main" } },
              participants: [{ role: "REVIEWER", user: { nickname: "lee" } }],
              links: { html: { href: "https://bitbucket.org/acme/app/pull-requests/9" } },
            },
          ],
        });
      }
      return json({ error: url }, 404);
    });
    const gl = await forge.listPulls(
      account({ id: "gl1", kind: "gitlab", token: "t" }),
      "acme",
      "app",
      "open",
    );
    expect(gl[0]).toMatchObject({
      commentCount: 3,
      reviewers: ["sam"],
      checkState: "failure",
      authorAvatarUrl: "https://gitlab.com/ada.png",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    const bb = await forge.listPulls(
      account({ id: "bb1", kind: "bitbucket", token: "t" }),
      "acme",
      "app",
      "open",
    );
    expect(bb.find((row) => row.number === 9)).toMatchObject({
      commentCount: 2,
      reviewers: ["lee"],
      authorAvatarUrl: "https://bitbucket.org/pat.png",
      createdAt: "2026-09-02T00:00:00.000Z",
    });
  });

  it("maps forge draft and closed states, including Bitbucket drafts omitted from state=OPEN", async () => {
    const urls: string[] = [];
    const forge = clientFor((url) => {
      urls.push(url);
      if (url.includes("api.github.com") && url.includes("/pulls?state=open")) {
        return json([
          {
            number: 1,
            title: "GH draft",
            html_url: "https://github.com/acme/app/pull/1",
            state: "open",
            draft: true,
            head: { ref: "feat" },
            base: { ref: "main" },
          },
        ]);
      }
      if (url.includes("gitlab.com") && url.includes("/merge_requests?state=opened")) {
        return json([
          {
            iid: 2,
            title: "GL WIP",
            web_url: "https://gitlab.com/acme/app/-/merge_requests/2",
            state: "opened",
            work_in_progress: true,
            source_branch: "feat",
            target_branch: "main",
          },
        ]);
      }
      if (url.includes("api.bitbucket.org") && url.includes("/pullrequests")) {
        const decoded = decodeURIComponent(url);
        if (decoded.includes("draft=true")) {
          return json({
            values: [
              {
                id: 8,
                title: "BB draft",
                state: "OPEN",
                draft: true,
                source: { branch: { name: "feat" }, commit: { hash: "abc" } },
                destination: { branch: { name: "main" } },
                links: { html: { href: "https://bitbucket.org/acme/app/pull-requests/8" } },
              },
            ],
          });
        }
        if (url.includes("state=MERGED")) {
          return json({
            values: [
              {
                id: 7,
                title: "BB merged",
                state: "MERGED",
                source: { branch: { name: "old" }, commit: { hash: "def" } },
                destination: { branch: { name: "main" } },
                links: { html: { href: "https://bitbucket.org/acme/app/pull-requests/7" } },
              },
              {
                id: 6,
                title: "BB declined",
                state: "DECLINED",
                source: { branch: { name: "nope" }, commit: { hash: "ghi" } },
                destination: { branch: { name: "main" } },
                links: { html: { href: "https://bitbucket.org/acme/app/pull-requests/6" } },
              },
              {
                id: 5,
                title: "BB superseded",
                state: "SUPERSEDED",
                source: { branch: { name: "old2" }, commit: { hash: "jkl" } },
                destination: { branch: { name: "main" } },
                links: { html: { href: "https://bitbucket.org/acme/app/pull-requests/5" } },
              },
            ],
          });
        }
        return json({
          values: [
            {
              id: 9,
              title: "BB open",
              state: "OPEN",
              draft: false,
              source: { branch: { name: "feat" }, commit: { hash: "mno" } },
              destination: { branch: { name: "main" } },
              links: { html: { href: "https://bitbucket.org/acme/app/pull-requests/9" } },
            },
          ],
        });
      }
      return json({ error: url }, 404);
    });
    const gh = account({ id: "gh1", kind: "github", token: "t" });
    const gl = account({ id: "gl1", kind: "gitlab", token: "t" });
    const bb = account({ id: "bb1", kind: "bitbucket", token: "t" });

    const ghDrafts = await forge.listPulls(gh, "acme", "app", "draft");
    expect(ghDrafts).toEqual([expect.objectContaining({ number: 1, state: "draft", draft: true })]);

    const glDrafts = await forge.listPulls(gl, "acme", "app", "draft");
    expect(glDrafts).toEqual([expect.objectContaining({ number: 2, state: "draft", draft: true })]);

    urls.length = 0;
    const bbOpen = await forge.listPulls(bb, "acme", "app", "open");
    expect(bbOpen.map((row) => row.number).sort()).toEqual([8, 9]);
    expect(bbOpen.find((row) => row.number === 8)).toMatchObject({ state: "draft", draft: true });
    expect(bbOpen.find((row) => row.number === 9)).toMatchObject({ state: "open", draft: false });
    expect(
      urls.some(
        (url) => url.includes("state=OPEN") && !decodeURIComponent(url).includes("draft=true"),
      ),
    ).toBe(true);
    expect(
      urls.some((url) => decodeURIComponent(url).includes('state="OPEN" AND draft=true')),
    ).toBe(true);

    urls.length = 0;
    const bbDrafts = await forge.listPulls(bb, "acme", "app", "draft");
    expect(bbDrafts).toEqual([expect.objectContaining({ number: 8, state: "draft" })]);
    expect(urls.every((url) => decodeURIComponent(url).includes("draft=true"))).toBe(true);
    expect(
      urls.some((url) => url.includes("state=OPEN") && !decodeURIComponent(url).includes("draft=")),
    ).toBe(false);

    urls.length = 0;
    const bbAll = await forge.listPulls(bb, "acme", "app", "all");
    expect(bbAll.map((row) => `${row.number}:${row.state}`).sort()).toEqual([
      "5:closed",
      "6:closed",
      "7:merged",
      "8:draft",
    ]);
    expect(
      urls.some(
        (url) =>
          url.includes("state=MERGED") &&
          url.includes("state=DECLINED") &&
          url.includes("state=SUPERSEDED"),
      ),
    ).toBe(true);
  });

  it("returns draft state when opening a Bitbucket pull request as a draft", async () => {
    const forge = clientFor((url, init) => {
      if (url.includes("/pullrequests") && init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}")) as { draft?: boolean };
        expect(body.draft).toBe(true);
        return json({
          id: 4,
          title: "BB",
          draft: true,
          state: "OPEN",
          links: { html: { href: "https://bitbucket.org/acme/app/pull-requests/4" } },
        });
      }
      return json({ error: url }, 404);
    });
    expect(
      await forge.createPull(account({ id: "bb1", kind: "bitbucket", token: "t" }), "acme", "app", {
        title: "BB",
        head: "feat",
        base: "main",
        draft: true,
      }),
    ).toMatchObject({ number: 4, state: "draft" });
  });

  it("surfaces forge JSON error bodies as a human message", async () => {
    const bb = clientFor(() =>
      json(
        {
          type: "error",
          error: { message: "Token is invalid, expired, or not supported for this endpoint." },
        },
        401,
      ),
    );
    await expect(
      bb.listPulls(account({ id: "bb1", kind: "bitbucket", token: "dead" }), "acme", "app", "open"),
    ).rejects.toThrow("Token is invalid, expired, or not supported for this endpoint.");

    const gh = clientFor(() => json({ message: "Bad credentials" }, 401));
    await expect(
      gh.listPulls(account({ id: "gh1", kind: "github", token: "dead" }), "acme", "app", "open"),
    ).rejects.toThrow("Bad credentials");
  });

  it("parses forge JSON larger than 12 KiB and rejects huge comments", async () => {
    const patch = "diff --git a/x b/x\n" + "a".repeat(20_000);
    const forge = clientFor((url) => {
      if (url.includes("/repos/acme/app/pulls?state=")) {
        return json([
          {
            number: 3,
            title: "Fix",
            html_url: "https://github.com/acme/app/pull/3",
            state: "open",
            head: { ref: "feat" },
            base: { ref: "main" },
            patch,
          },
        ]);
      }
      return json({ error: url }, 404);
    });
    const gh = account({ id: "gh1", kind: "github", token: "t" });
    const listed = await forge.listPulls(gh, "acme", "app", "open");
    expect(listed[0]?.number).toBe(3);
    await expect(
      forge.postComment(gh, "acme", "app", 3, { body: "x".repeat(20_000) }),
    ).rejects.toThrow(/too long/);
  });

  it("attaches Bitbucket unified diffs to PR files", async () => {
    const unified = [
      "diff --git a/siq8/batch/assignment.py b/siq8/batch/assignment.py",
      "index 111..222 100644",
      "--- a/siq8/batch/assignment.py",
      "+++ b/siq8/batch/assignment.py",
      "@@ -1,1 +1,2 @@",
      " keep",
      "+appear",
      "diff --git a/siq8/static/src/batch/batch.ts b/siq8/static/src/batch/batch.ts",
      "new file mode 100644",
      "index 0000000..abc",
      "--- /dev/null",
      "+++ b/siq8/static/src/batch/batch.ts",
      "@@ -0,0 +1,1 @@",
      "+export {}",
    ].join("\n");
    const forge = clientFor((url) => {
      if (url.endsWith("/pullrequests/10222")) {
        return json({
          id: 10222,
          title: "Keep source appear and disappear dates",
          description: "body",
          state: "OPEN",
          source: { branch: { name: "feat" }, commit: { hash: "af21647" } },
          destination: { branch: { name: "develop" } },
          links: { html: { href: "https://bitbucket.org/acme/app/pull-requests/10222" } },
          author: { nickname: "damon" },
        });
      }
      if (url.includes("/pullrequests/10222/diffstat")) {
        return json({
          values: [
            {
              status: "modified",
              old: { path: "siq8/batch/assignment.py" },
              new: { path: "siq8/batch/assignment.py" },
            },
            { status: "added", old: null, new: { path: "siq8/static/src/batch/batch.ts" } },
            { status: "modified", old: { path: "binary.bin" }, new: { path: "binary.bin" } },
          ],
        });
      }
      if (url.endsWith("/pullrequests/10222/diff")) {
        return new Response(unified, { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (url.includes("/pullrequests/10222/comments")) return json({ values: [] });
      if (url.includes("/pullrequests/10222/commits")) return json({ values: [] });
      if (url.includes("/commit/af21647/statuses")) return json({ values: [] });
      return json({ error: url }, 404);
    });
    const pull = await forge.getPull(
      account({ id: "bb1", kind: "bitbucket", token: "t" }),
      "acme",
      "app",
      10222,
    );
    expect(pull.files).toHaveLength(3);
    expect(pull.files[0]).toMatchObject({
      path: "siq8/batch/assignment.py",
      status: "modified",
    });
    expect(pull.files[0]?.patch).toContain("+appear");
    expect(pull.files[1]).toMatchObject({
      path: "siq8/static/src/batch/batch.ts",
      status: "added",
    });
    expect(pull.files[1]?.patch).toContain("+export {}");
    expect(pull.files[1]?.patch).not.toContain("assignment.py");
    expect(pull.files[2]?.patch).toBeUndefined();
  });

  it("attaches Bitbucket patches for quoted paths with spaces", async () => {
    const unified = [
      'diff --git "a/docs/my file.md" "b/docs/my file.md"',
      "index 111..222 100644",
      '--- "a/docs/my file.md"',
      '+++ "b/docs/my file.md"',
      "@@ -1,1 +1,2 @@",
      " keep",
      "+space",
    ].join("\n");
    const forge = clientFor((url) => {
      if (url.endsWith("/pullrequests/9")) {
        return json({
          id: 9,
          title: "Spaces",
          description: "",
          state: "OPEN",
          source: { branch: { name: "feat" }, commit: { hash: "abc" } },
          destination: { branch: { name: "main" } },
          links: { html: { href: "https://bitbucket.org/acme/app/pull-requests/9" } },
        });
      }
      if (url.includes("/pullrequests/9/diffstat")) {
        return json({
          values: [
            {
              status: "modified",
              old: { path: "docs/my file.md" },
              new: { path: "docs/my file.md" },
            },
          ],
        });
      }
      if (url.endsWith("/pullrequests/9/diff")) {
        return new Response(unified, { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (url.includes("/pullrequests/9/comments")) return json({ values: [] });
      if (url.includes("/pullrequests/9/commits")) return json({ values: [] });
      if (url.includes("/commit/abc/statuses")) return json({ values: [] });
      return json({ error: url }, 404);
    });
    const pull = await forge.getPull(
      account({ id: "bb1", kind: "bitbucket", token: "t" }),
      "acme",
      "app",
      9,
    );
    expect(pull.files).toHaveLength(1);
    expect(pull.files[0]?.path).toBe("docs/my file.md");
    expect(pull.files[0]?.patch).toContain("+space");
  });

  it("reads the latest commit SHA and swallows HTTP failure", async () => {
    const forge = clientFor((url) => {
      if (url.includes("/repos/acme/app/commits/main")) return json({ sha: "aaa111" });
      if (url.includes("/projects/") && url.includes("/repository/commits/HEAD")) {
        return json({ id: "bbb222" });
      }
      if (url.includes("/repositories/acme/app/commits/feat") && url.includes("pagelen=1")) {
        return json({ values: [{ hash: "ccc333" }] });
      }
      if (url.includes("/repos/acme/app/commits/missing")) return json({ error: "nope" }, 404);
      return json({ error: url }, 500);
    });
    const gh = account({ id: "gh1", kind: "github", token: "t" });
    const gl = account({ id: "gl1", kind: "gitlab", token: "t" });
    const bb = account({ id: "bb1", kind: "bitbucket", token: "t" });
    expect(await forge.latestCommitSha(gh, "acme", "app", "refs/heads/main")).toBe("aaa111");
    expect(await forge.latestCommitSha(gl, "acme", "app")).toBe("bbb222");
    expect(await forge.latestCommitSha(bb, "acme", "app", "feat")).toBe("ccc333");
    expect(await forge.latestCommitSha(gh, "acme", "app", "missing")).toBeUndefined();
  });

  it("reads the latest open pull cursor and swallows HTTP failure", async () => {
    const forge = clientFor((url) => {
      if (url.includes("/repos/acme/app/pulls")) {
        return json([{ number: 12, updated_at: "2026-08-20T00:00:00Z" }]);
      }
      if (url.includes("/merge_requests")) {
        return json([{ iid: 7, updated_at: "2026-08-21T00:00:00Z" }]);
      }
      if (url.includes("/pullrequests?state=OPEN")) {
        return json({ values: [{ id: 3, updated_on: "2026-08-22T00:00:00Z" }] });
      }
      return json({ error: url }, 404);
    });
    const gh = account({ id: "gh1", kind: "github", token: "t" });
    const gl = account({ id: "gl1", kind: "gitlab", token: "t" });
    const bb = account({ id: "bb1", kind: "bitbucket", token: "t" });
    expect(await forge.latestOpenPullCursor(gh, "acme", "app")).toBe("pr:12:2026-08-20T00:00:00Z");
    expect(await forge.latestOpenPullCursor(gl, "acme", "app")).toBe("mr:7:2026-08-21T00:00:00Z");
    expect(await forge.latestOpenPullCursor(bb, "acme", "app")).toBe("pr:3:2026-08-22T00:00:00Z");
    expect(
      await forge.latestOpenPullCursor(
        account({ id: "gh2", kind: "github", token: "t" }),
        "no",
        "repo",
      ),
    ).toBeUndefined();
  });

  it("selects one ForgeAdapter per account kind", () => {
    const forge = clientFor(() => json([]));
    const gh = forge.adapter(account({ id: "gh1", kind: "github", token: "t" }));
    const gl = forge.adapter(account({ id: "gl1", kind: "gitlab", token: "t" }));
    const bb = forge.adapter(account({ id: "bb1", kind: "bitbucket", token: "t" }));
    expect(gh).not.toBe(gl);
    expect(gl).not.toBe(bb);
    expect(typeof gh.listRepos).toBe("function");
    expect(typeof gl.merge).toBe("function");
    expect(typeof bb.latestCommitSha).toBe("function");
  });

  it("lists branches from GitHub, GitLab, and Bitbucket", async () => {
    const forge = clientFor((url) => {
      if (url.endsWith("/repos/acme/app/branches?per_page=100")) {
        return json([{ name: "feat" }, { name: "main" }]);
      }
      if (url.endsWith("/repos/acme/app")) {
        return json({ default_branch: "main" });
      }
      if (url.includes("/repository/branches")) {
        return json([{ name: "main", default: true }, { name: "develop" }]);
      }
      if (url.includes("/refs/branches")) {
        return json({ values: [{ name: "main" }, { name: "mobile" }] });
      }
      if (
        url.includes("api.bitbucket.org/2.0/repositories/acme/mobile") &&
        !url.includes("/refs/")
      ) {
        return json({ mainbranch: { name: "main" } });
      }
      return json({ error: url }, 404);
    });
    const gh = account({ id: "gh1", kind: "github", token: "t" });
    const gl = account({ id: "gl1", kind: "gitlab", token: "t" });
    const bb = account({ id: "bb1", kind: "bitbucket", token: "t" });
    expect(await forge.listBranches(gh, "acme", "app")).toEqual({
      branches: ["main", "feat"],
      defaultBranch: "main",
    });
    expect(await forge.listBranches(gl, "acme", "service")).toEqual({
      branches: ["main", "develop"],
      defaultBranch: "main",
    });
    expect(await forge.listBranches(bb, "acme", "mobile")).toEqual({
      branches: ["main", "mobile"],
      defaultBranch: "main",
    });
  });

  it("lists, gets, and comments on issues on all three forges", async () => {
    const posted: string[] = [];
    const forge = clientFor((url, init) => {
      if (url.includes("/repos/acme/app/issues?") && !url.includes("/issues/")) {
        return json([
          {
            number: 7,
            title: "Login 500",
            html_url: "https://github.com/acme/app/issues/7",
            state: "open",
            user: { login: "ada" },
            comments: 2,
            labels: [{ name: "bug" }],
          },
          {
            number: 8,
            title: "A PR listed as an issue",
            html_url: "https://github.com/acme/app/pull/8",
            state: "open",
            pull_request: { url: "https://api.github.com/repos/acme/app/pulls/8" },
          },
        ]);
      }
      if (url.includes("/repos/acme/app/issues/7/comments") && init?.method === "POST") {
        posted.push("github");
        return json({ id: 1, body: "ship it" });
      }
      if (url.includes("/repos/acme/app/issues/7/comments")) {
        return json([
          {
            id: 11,
            body: "repro on main",
            user: { login: "sam" },
            created_at: "2026-10-01T00:00:00.000Z",
            html_url: "https://github.com/acme/app/issues/7#issuecomment-11",
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
      if (url.includes("/issues/9/notes") && init?.method === "POST") {
        posted.push("gitlab");
        return json({ id: 2, body: "ack" });
      }
      if (url.includes("/issues/9/notes")) {
        return json([
          { id: 21, body: "system note", system: true, author: { username: "bot" } },
          { id: 22, body: "still broken", system: false, author: { username: "lee" } },
        ]);
      }
      if (url.includes("/issues?state=opened") || url.includes("/issues?state=open")) {
        return json([
          {
            iid: 9,
            title: "Timeout",
            web_url: "https://gitlab.com/acme/app/-/issues/9",
            state: "opened",
            author: { username: "ada" },
            labels: ["bug"],
            user_notes_count: 1,
          },
        ]);
      }
      if (url.includes("/issues/9") && url.includes("gitlab.com")) {
        return json({
          iid: 9,
          title: "Timeout",
          web_url: "https://gitlab.com/acme/app/-/issues/9",
          state: "opened",
          description: "500ms",
          author: { username: "ada" },
          labels: ["bug"],
        });
      }
      if (url.includes("/issues/4/comments") && init?.method === "POST") {
        posted.push("bitbucket");
        return json({ id: 3 });
      }
      if (url.includes("/issues/4/comments")) {
        return json({
          values: [
            {
              id: 31,
              content: { raw: "happens on safari" },
              user: { nickname: "pat" },
              created_on: "2026-10-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/issues/4") && url.includes("bitbucket")) {
        return json({
          id: 4,
          title: "Safari crash",
          state: "open",
          content: { raw: "tab dies" },
          kind: "bug",
          reporter: { nickname: "pat" },
          links: { html: { href: "https://bitbucket.org/acme/app/issues/4" } },
        });
      }
      if (url.includes("/issues?") && url.includes("bitbucket")) {
        return json({
          values: [
            {
              id: 4,
              title: "Safari crash",
              state: "open",
              kind: "bug",
              reporter: { nickname: "pat" },
              links: { html: { href: "https://bitbucket.org/acme/app/issues/4" } },
            },
          ],
        });
      }
      return json({ error: url }, 404);
    });
    const gh = account({ id: "gh1", kind: "github", token: "t" });
    const gl = account({ id: "gl1", kind: "gitlab", token: "t" });
    const bb = account({ id: "bb1", kind: "bitbucket", token: "t" });
    const listed = await forge.listIssues(gh, "acme", "app", "open");
    expect(listed.map((row) => row.number)).toEqual([7]);
    expect(listed[0]).toMatchObject({ title: "Login 500", labels: ["bug"], author: "ada" });
    const issue = await forge.getIssue(gh, "acme", "app", 7);
    expect(issue.body).toBe("stack overflow");
    expect(issue.comments[0]?.body).toBe("repro on main");
    expect(await forge.postIssueComment(gh, "acme", "app", 7, { body: "ship it" })).toMatchObject({
      ok: true,
    });
    const glListed = await forge.listIssues(gl, "acme", "app", "open");
    expect(glListed[0]?.number).toBe(9);
    const glIssue = await forge.getIssue(gl, "acme", "app", 9);
    expect(glIssue.comments.map((row) => row.body)).toEqual(["still broken"]);
    expect(await forge.postIssueComment(gl, "acme", "app", 9, { body: "ack" })).toMatchObject({
      ok: true,
    });
    const bbListed = await forge.listIssues(bb, "acme", "app", "open");
    expect(bbListed[0]).toMatchObject({ number: 4, labels: ["bug"] });
    const bbIssue = await forge.getIssue(bb, "acme", "app", 4);
    expect(bbIssue.comments[0]?.body).toBe("happens on safari");
    expect(await forge.postIssueComment(bb, "acme", "app", 4, { body: "fix" })).toMatchObject({
      ok: true,
    });
    expect(posted).toEqual(["github", "gitlab", "bitbucket"]);
  });

  it("rejects GitHub pull requests on issue get and comment", async () => {
    const posted: string[] = [];
    const forge = clientFor((url, init) => {
      if (url.includes("/repos/acme/app/issues/8") && init?.method === "POST") {
        posted.push("github");
        return json({ id: 1, body: "leak" });
      }
      if (url.includes("/repos/acme/app/issues/8")) {
        return json({
          number: 8,
          title: "A PR listed as an issue",
          html_url: "https://github.com/acme/app/pull/8",
          state: "open",
          body: "do not treat this as an issue",
          pull_request: { url: "https://api.github.com/repos/acme/app/pulls/8" },
        });
      }
      return json({ error: url }, 404);
    });
    const gh = account({ id: "gh1", kind: "github", token: "t" });
    await expect(forge.getIssue(gh, "acme", "app", 8)).rejects.toThrow(/pull request/);
    await expect(forge.postIssueComment(gh, "acme", "app", 8, { body: "leak" })).rejects.toThrow(
      /pull request/,
    );
    expect(posted).toEqual([]);
  });

  it("returns an empty issue list when the tracker is disabled", async () => {
    const forge = clientFor((url) => {
      if (url.includes("/issues")) return json({ error: "gone" }, 410);
      return json({ error: url }, 404);
    });
    expect(
      await forge.listIssues(
        account({ id: "gh1", kind: "github", token: "t" }),
        "acme",
        "app",
        "open",
      ),
    ).toEqual([]);
    expect(
      await forge.listIssues(
        account({ id: "gl1", kind: "gitlab", token: "t" }),
        "acme",
        "app",
        "open",
      ),
    ).toEqual([]);
    expect(
      await forge.listIssues(
        account({ id: "bb1", kind: "bitbucket", token: "t" }),
        "acme",
        "app",
        "open",
      ),
    ).toEqual([]);
  });
});

describe("forge adapter factories", () => {
  it("each kind exposes the ForgeAdapter interface", () => {
    const fetchFn = (async () => new Response("{}")) as typeof fetch;
    for (const adapter of [
      createGithubForgeAdapter(fetchFn),
      createGitlabForgeAdapter(fetchFn),
      createBitbucketForgeAdapter(fetchFn),
    ]) {
      expect(typeof adapter.listRepos).toBe("function");
      expect(typeof adapter.getPull).toBe("function");
      expect(typeof adapter.listIssues).toBe("function");
      expect(typeof adapter.getIssue).toBe("function");
      expect(typeof adapter.postIssueComment).toBe("function");
      expect(typeof adapter.merge).toBe("function");
    }
    expect(typeof createGithubForgeAdapter(fetchFn).setFileViewed).toBe("function");
    expect(createGitlabForgeAdapter(fetchFn).setFileViewed).toBeUndefined();
  });
});
