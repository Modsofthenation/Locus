import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { executeForgeTool, executeSessionForgeTool, isForgeToolName } from "./sessionForgeTools.js";

function session(patch: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "One",
    os: "ubuntu",
    templateId: "t",
    providerId: "p",
    model: "m",
    status: "idle",
    messages: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("executeSessionForgeTool", () => {
  it("skips non-forge names and fences list output", async () => {
    const listPulls = vi.fn(async () => [
      { number: 1, title: "hostile <script>", url: "https://example.test/1", state: "open" },
    ]);
    const deps = {
      forge: { listPulls } as never,
      attachPull: async () => undefined,
      requireForge: async () => ({
        account: {
          id: "gh",
          kind: "github" as const,
          name: "GitHub",
          apiBaseUrl: "https://api.github.com",
        },
        owner: "acme",
        repo: "demo",
      }),
      resolveGitHeadBranch: async () => "feat",
      loadLoadPathNotes: async () => undefined,
    };
    expect(
      await executeSessionForgeTool(deps, session(), { name: "exec", args: {} }, (_n, o) => o),
    ).toBeUndefined();
    const listed = await executeSessionForgeTool(
      deps,
      session({ repo: { url: "https://github.com/acme/demo.git" } as never }),
      { name: "git_pr_list", args: {} },
      (name, output) => `[${name}]${output}`,
    );
    expect(listed?.output.startsWith("[git_pr_list]")).toBe(true);
  });
});

describe("isForgeToolName", () => {
  it("matches the git_pr and git_issue families", () => {
    expect(isForgeToolName("git_pr")).toBe(true);
    expect(isForgeToolName("git_pr_merge")).toBe(true);
    expect(isForgeToolName("git_issue_list")).toBe(true);
    expect(isForgeToolName("git_issue_comment")).toBe(true);
    expect(isForgeToolName("git_push")).toBe(false);
  });
});

describe("executeForgeTool", () => {
  it("opens a pull through the forge adapter and attaches it", async () => {
    const attachPull = vi.fn(async () => undefined);
    const createPull = vi.fn(async () => ({
      number: 9,
      url: "https://example.test/pr/9",
      title: "WIP",
      state: "open",
    }));
    const result = await executeForgeTool(
      {
        forge: { createPull } as never,
        attachPull,
        requireForge: async () => ({
          account: {
            id: "gh",
            kind: "github",
            name: "GitHub",
            apiBaseUrl: "https://api.github.com",
          },
          owner: "acme",
          repo: "demo",
        }),
        resolveGitHeadBranch: async () => "feat",
        loadLoadPathNotes: async () => undefined,
      },
      session(),
      "git_pr",
      { title: "WIP" },
    );
    expect(result.ok).toBe(true);
    expect(createPull).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "demo",
      expect.objectContaining({ title: "WIP", head: "feat", base: "main" }),
    );
    expect(attachPull).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ number: 9, headRef: "feat", baseRef: "main" }),
    );
  });

  it("asks for a named branch when HEAD cannot be resolved", async () => {
    const result = await executeForgeTool(
      {
        forge: {} as never,
        attachPull: async () => undefined,
        requireForge: async () => ({
          account: {
            id: "gh",
            kind: "github",
            name: "GitHub",
            apiBaseUrl: "https://api.github.com",
          },
          owner: "acme",
          repo: "demo",
        }),
        resolveGitHeadBranch: async () => "HEAD",
        loadLoadPathNotes: async () => undefined,
      },
      session(),
      "git_pr",
      { title: "WIP" },
    );
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/named branch/);
  });

  it("honors git_pr_get include and paths so the card stays small", async () => {
    const getPull = vi.fn(async () => ({
      number: 12,
      title: "Add currency",
      url: "https://example.test/pr/12",
      state: "open",
      headRef: "feat",
      baseRef: "main",
      headSha: "abcdef12",
      body: "trace me",
      files: [
        { path: "a.ts", status: "modified", patch: "+a" },
        { path: "b.ts", status: "modified", patch: "+b" },
      ],
      comments: [{ id: "c1", body: "already noted", createdAt: "t" }],
      commits: [],
      checks: [{ name: "ci", status: "success" }],
    }));
    const deps = {
      forge: { getPull } as never,
      attachPull: async () => undefined,
      requireForge: async () => ({
        account: {
          id: "gh",
          kind: "github" as const,
          name: "GitHub",
          apiBaseUrl: "https://api.github.com",
        },
        owner: "acme",
        repo: "demo",
      }),
      resolveGitHeadBranch: async () => "feat",
      loadLoadPathNotes: async () => undefined,
    };
    const full = await executeForgeTool(deps, session(), "git_pr_get", { pull_number: 12 });
    expect(full.ok).toBe(true);
    expect(full.output).toContain("a.ts");
    expect(full.output).toContain("already noted");
    expect(full.output).toContain("ci: success");
    expect(full.output).toMatch(/Do not re-call git_pr_get with paths/);
    const comments = await executeForgeTool(deps, session(), "git_pr_get", {
      pull_number: 12,
      include: ["comments"],
    });
    expect(comments.output).toContain("already noted");
    expect(comments.output).not.toContain("a.ts");
    expect(comments.output).not.toContain("ci: success");
    const filtered = await executeForgeTool(deps, session(), "git_pr_get", {
      pull_number: 12,
      include: ["files"],
      paths: ["a.ts"],
    });
    expect(filtered.output).toContain("a.ts");
    expect(filtered.output).not.toContain("b.ts");
    expect(filtered.output).not.toContain("already noted");
  });

  it("posts COMMENT when GitHub rejects REQUEST_CHANGES on the author's PR", async () => {
    const postReview = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        output: "Can not request changes on your own pull request",
      })
      .mockResolvedValueOnce({ ok: true, output: "review posted" });
    const result = await executeForgeTool(
      {
        forge: { postReview } as never,
        attachPull: async () => undefined,
        requireForge: async () => ({
          account: {
            id: "gh",
            kind: "github",
            name: "GitHub",
            apiBaseUrl: "https://api.github.com",
          },
          owner: "acme",
          repo: "demo",
        }),
        resolveGitHeadBranch: async () => "feat",
        loadLoadPathNotes: async () => undefined,
      },
      session(),
      "git_pr_review",
      { body: "Need tests", event: "REQUEST_CHANGES", pull_number: 7 },
    );
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/Posted as COMMENT/);
    expect(postReview).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "acme",
      "demo",
      7,
      expect.objectContaining({ event: "REQUEST_CHANGES", body: "Need tests" }),
    );
    expect(postReview).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "acme",
      "demo",
      7,
      expect.objectContaining({ event: "COMMENT", body: expect.stringContaining("Need tests") }),
    );
  });

  it("lists, gets, and comments on forge issues", async () => {
    const listIssues = vi.fn(async () => [
      {
        number: 7,
        title: "Login 500",
        state: "open",
        url: "https://example.test/issues/7",
        labels: ["bug"],
      },
    ]);
    const getIssue = vi.fn(async () => ({
      number: 7,
      title: "Login 500",
      state: "open",
      url: "https://example.test/issues/7",
      body: "stack overflow",
      comments: [{ id: "c1", body: "repro on main", createdAt: "t", author: "sam" }],
    }));
    const postIssueComment = vi.fn(async () => ({ ok: true, output: "posted" }));
    const deps = {
      forge: { listIssues, getIssue, postIssueComment } as never,
      attachPull: async () => undefined,
      requireForge: async () => ({
        account: {
          id: "gh",
          kind: "github" as const,
          name: "GitHub",
          apiBaseUrl: "https://api.github.com",
        },
        owner: "acme",
        repo: "demo",
      }),
      resolveGitHeadBranch: async () => "feat",
      loadLoadPathNotes: async () => undefined,
    };
    const listed = await executeForgeTool(deps, session(), "git_issue_list", { state: "open" });
    expect(listed.ok).toBe(true);
    expect(listed.output).toContain("#7 Login 500");
    expect(listed.output).toContain("[bug]");
    const got = await executeForgeTool(deps, session(), "git_issue_get", { issue_number: 7 });
    expect(got.ok).toBe(true);
    expect(got.output).toContain("stack overflow");
    expect(got.output).toContain("repro on main");
    expect(got.output).toMatch(/kind="issue-text"/);
    const commentsOnly = await executeForgeTool(deps, session(), "git_issue_get", {
      issue_number: 7,
      include: ["comments"],
    });
    expect(commentsOnly.output).toContain("repro on main");
    expect(commentsOnly.output).not.toContain("stack overflow");
    const missing = await executeForgeTool(deps, session(), "git_issue_get", {});
    expect(missing.ok).toBe(false);
    expect(missing.output).toMatch(/issue_number/);
    const posted = await executeForgeTool(deps, session(), "git_issue_comment", {
      issue_number: 7,
      body: "ship it",
    });
    expect(posted).toEqual({ ok: true, output: "posted" });
    expect(postIssueComment).toHaveBeenCalledWith(expect.anything(), "acme", "demo", 7, {
      body: "ship it",
    });
  });
});
