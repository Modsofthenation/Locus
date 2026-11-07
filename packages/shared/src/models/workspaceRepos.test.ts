import { describe, expect, it } from "vitest";
import type { LinkedRepo } from "./repo.js";
import {
  assignWorkspaceCloneDests,
  attachLinkedCheckouts,
  checkoutDestRel,
  cursorCloudReposFromSession,
  destRelativeToWorkspace,
  formatAttachedReposPrompt,
  gitWorkspaceDests,
  isCheckoutDirAlias,
  isMultiRepoWorkspace,
  matchGitDest,
  matchWorkspaceCheckout,
  parseRepoIdList,
  relInGitDest,
  resolveGitWorkspaceDest,
  sanitizeCloneDirName,
  sessionRepoCheckouts,
  isGitPathToolName,
} from "./workspaceRepos.js";

const repos: LinkedRepo[] = [
  {
    id: "r1",
    name: "acme/app",
    checkout: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  },
  {
    id: "r2",
    name: "acme/lib",
    checkout: { forge: "github", url: "https://github.com/acme/lib.git" },
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  },
  {
    id: "r3",
    name: "other/app",
    checkout: { forge: "github", url: "https://github.com/other/app.git" },
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  },
];

describe("attachLinkedCheckouts", () => {
  it("keeps a single linked checkout on repo/repoId", () => {
    expect(attachLinkedCheckouts(repos, { repoId: "r1" })).toEqual({
      repoId: "r1",
      repo: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
    });
  });

  it("promotes extraRepoIds onto extraRepos and skips duplicates", () => {
    expect(attachLinkedCheckouts(repos, { repoId: "r1", extraRepoIds: ["r1", "r2"] })).toEqual({
      repoId: "r1",
      repo: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
      extraRepos: [{ forge: "github", url: "https://github.com/acme/lib.git" }],
      extraRepoIds: ["r2"],
    });
  });

  it("uses the first extraRepoId as primary when repoId is omitted", () => {
    expect(attachLinkedCheckouts(repos, { extraRepoIds: ["r2", "r1"] })).toEqual({
      repoId: "r2",
      repo: { forge: "github", url: "https://github.com/acme/lib.git" },
      extraRepos: [{ forge: "github", url: "https://github.com/acme/app.git", ref: "main" }],
      extraRepoIds: ["r1"],
    });
  });

  it("throws on an unknown extra repo id", () => {
    expect(() => attachLinkedCheckouts(repos, { repoId: "r1", extraRepoIds: ["missing"] })).toThrow(
      /Unknown linked repo/,
    );
  });

  it("applies extraRepos refs onto matching extraRepoIds", () => {
    expect(
      attachLinkedCheckouts(repos, {
        repoId: "r1",
        extraRepoIds: ["r2"],
        extraRepos: [{ forge: "github", url: "https://github.com/acme/lib.git", ref: "feat" }],
      }),
    ).toEqual({
      repoId: "r1",
      repo: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
      extraRepos: [{ forge: "github", url: "https://github.com/acme/lib.git", ref: "feat" }],
      extraRepoIds: ["r2"],
    });
  });
});

describe("assignWorkspaceCloneDests", () => {
  it("leaves a single checkout at the workspace root", () => {
    expect(
      assignWorkspaceCloneDests(
        [{ forge: "github", url: "https://github.com/acme/app.git" }],
        "/workspace",
      ),
    ).toEqual([{ forge: "github", url: "https://github.com/acme/app.git" }]);
  });

  it("puts each repo in /workspace/<name> and disambiguates collisions", () => {
    expect(
      assignWorkspaceCloneDests(
        [
          { forge: "github", url: "https://github.com/acme/app.git" },
          { forge: "github", url: "https://github.com/other/app.git" },
          { forge: "github", url: "https://github.com/acme/lib.git" },
        ],
        "/workspace",
      ),
    ).toEqual([
      { forge: "github", url: "https://github.com/acme/app.git", dest: "/workspace/app" },
      { forge: "github", url: "https://github.com/other/app.git", dest: "/workspace/other-app" },
      { forge: "github", url: "https://github.com/acme/lib.git", dest: "/workspace/lib" },
    ]);
  });

  it("sanitizes dest names and ignores parent segments", () => {
    expect(sanitizeCloneDirName("../weird name.git")).toBe("weird-name");
    expect(destRelativeToWorkspace("/workspace/app", "/workspace")).toBe("app");
    expect(destRelativeToWorkspace("/tmp/escape", "/workspace")).toBe("");
  });
});

describe("matchWorkspaceCheckout", () => {
  const session = {
    repo: {
      forge: "github" as const,
      url: "https://github.com/acme/app.git",
      dest: "/workspace/app",
    },
    extraRepos: [
      { forge: "github" as const, url: "https://github.com/acme/lib.git", dest: "/workspace/lib" },
    ],
  };

  it("matches by dest prefix or url and falls back to primary", () => {
    expect(matchWorkspaceCheckout(session, { path: "/workspace/lib/src/a.ts" })?.url).toMatch(
      /lib/,
    );
    expect(matchWorkspaceCheckout(session, { url: "https://github.com/acme/lib.git" })?.dest).toBe(
      "/workspace/lib",
    );
    expect(matchWorkspaceCheckout(session, {})?.url).toMatch(/app/);
    expect(isMultiRepoWorkspace(session)).toBe(true);
    expect(sessionRepoCheckouts(session)).toHaveLength(2);
    expect(isGitPathToolName("git_fetch")).toBe(true);
    expect(isGitPathToolName("git_push")).toBe(true);
  });

  it("matches relative dests and dests under another workspace root", () => {
    expect(matchWorkspaceCheckout(session, { path: "lib" })?.dest).toBe("/workspace/lib");
    expect(matchWorkspaceCheckout(session, { dest: "lib" })?.url).toMatch(/lib/);
    expect(matchWorkspaceCheckout(session, { path: "/home/locus/workspace/lib" })?.dest).toBe(
      "/workspace/lib",
    );
    expect(
      matchWorkspaceCheckout(session, { path: "/home/locus/workspace/lib/src/a.ts" })?.url,
    ).toMatch(/lib/);
    const vm = {
      repo: {
        forge: "github" as const,
        url: "https://github.com/acme/app.git",
        dest: "/home/locus/workspace/app",
      },
      extraRepos: [
        {
          forge: "github" as const,
          url: "https://github.com/acme/lib.git",
          dest: "/home/locus/workspace/lib",
        },
      ],
    };
    expect(matchWorkspaceCheckout(vm, { path: "/workspace/lib" })?.dest).toBe(
      "/home/locus/workspace/lib",
    );
    expect(matchWorkspaceCheckout(vm, { path: "lib" })?.dest).toBe("/home/locus/workspace/lib");
    expect(isCheckoutDirAlias("/workspace/lib", "/home/locus/workspace/lib")).toBe(true);
    expect(isCheckoutDirAlias("lib", "/home/locus/workspace/lib")).toBe(true);
    expect(isCheckoutDirAlias("/workspace/lib/src/a.ts", "/home/locus/workspace/lib")).toBe(false);
    expect(checkoutDestRel("/home/locus/workspace/lib")).toBe("lib");
  });
});

describe("cursorCloudReposFromSession", () => {
  it("emits GitHub urls only", () => {
    expect(
      cursorCloudReposFromSession({
        repo: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
        extraRepos: [
          { forge: "gitlab", url: "https://gitlab.com/acme/lib.git" },
          { forge: "github", url: "https://github.com/acme/lib.git" },
        ],
      }),
    ).toEqual([
      { url: "https://github.com/acme/app", startingRef: "main" },
      { url: "https://github.com/acme/lib", startingRef: undefined },
    ]);
  });
});

describe("formatAttachedReposPrompt", () => {
  it("lists dests for a multi-repo workspace", () => {
    const text = formatAttachedReposPrompt({
      checkouts: [
        { forge: "github", url: "https://github.com/acme/app.git", dest: "/workspace/app" },
        { forge: "github", url: "https://github.com/acme/lib.git", dest: "/workspace/lib" },
      ],
    });
    expect(text).toContain("at /workspace/app — primary");
    expect(text).toContain("at /workspace/lib");
    expect(text).toContain("cloned into /workspace/<name>");
    expect(text).toMatch(/Pass path to git_status/);
  });

  it("names the VM workspace root in the prompt header", () => {
    const text = formatAttachedReposPrompt({
      checkouts: [
        {
          forge: "github",
          url: "https://github.com/acme/app.git",
          dest: "/home/locus/workspace/app",
        },
        {
          forge: "github",
          url: "https://github.com/acme/lib.git",
          dest: "/home/locus/workspace/lib",
        },
      ],
    });
    expect(text).toContain("cloned into /home/locus/workspace/<name>");
    expect(text).toContain("at /home/locus/workspace/lib");
  });
});

describe("parseRepoIdList", () => {
  it("dedupes comma-separated and array ids", () => {
    expect(parseRepoIdList("r1, r2, r1")).toEqual(["r1", "r2"]);
    expect(parseRepoIdList([" r2 ", "", "r2"])).toEqual(["r2"]);
  });
});

describe("gitWorkspaceDests", () => {
  const session = {
    repo: {
      forge: "github" as const,
      url: "https://github.com/acme/app.git",
      dest: "/workspace/app",
    },
    extraRepos: [
      { forge: "github" as const, url: "https://github.com/acme/lib.git", dest: "/workspace/lib" },
    ],
  };

  it("lists relative dests and defaults to primary", () => {
    expect(gitWorkspaceDests(session).map((row) => row.dest)).toEqual(["app", "lib"]);
    expect(resolveGitWorkspaceDest(session, undefined)).toBe("app");
    expect(resolveGitWorkspaceDest(session, "lib")).toBe("lib");
    expect(resolveGitWorkspaceDest(session, "missing")).toBe("app");
    expect(matchGitDest("lib/src/a.ts", gitWorkspaceDests(session))?.dest).toBe("lib");
    expect(relInGitDest("lib/src/a.ts", "lib")).toBe("src/a.ts");
    expect(relInGitDest("src/a.ts", "lib")).toBe("src/a.ts");
  });
});
