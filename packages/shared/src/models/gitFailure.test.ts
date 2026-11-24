import { describe, expect, it } from "vitest";
import {
  bitbucketTokenKind,
  forgeGitHost,
  gitCredentialFill,
  gitHttpsAuthUser,
  normalizeRepoUrl,
  parseRepoUrl,
} from "./git.js";
import { classifyGitFailure, shellGitAuthHint } from "./gitFailure.js";
import { matchWorkspaceCheckout } from "./workspaceRepos.js";

describe("forge host aliases", () => {
  it("maps www. forge hosts to the main host", () => {
    expect(parseRepoUrl("https://www.bitbucket.org/signiq/signiq8")).toEqual({
      forge: "bitbucket",
      url: "https://bitbucket.org/signiq/signiq8.git",
    });
    expect(parseRepoUrl("https://www.github.com/acme/app")?.url).toBe(
      "https://github.com/acme/app.git",
    );
    expect(normalizeRepoUrl("https://www.bitbucket.org/signiq/signiq8")).toBe(
      normalizeRepoUrl("git@bitbucket.org:signiq/signiq8.git").replace(
        "git@bitbucket.org:",
        "https://bitbucket.org/",
      ),
    );
    expect(normalizeRepoUrl("https://www.bitbucket.org/Signiq/signiq8/")).toBe(
      "https://bitbucket.org/signiq/signiq8",
    );
  });

  it("matches a www. origin against the attached checkout", () => {
    const hit = matchWorkspaceCheckout(
      {
        repo: {
          forge: "bitbucket",
          url: "https://bitbucket.org/signiq/signiq8.git",
          dest: "/workspace",
        },
      } as never,
      { url: "https://www.bitbucket.org/signiq/signiq8" },
    );
    expect(hit?.url).toBe("https://bitbucket.org/signiq/signiq8.git");
  });
});

describe("Bitbucket credentials", () => {
  it("picks the git username for each token kind", () => {
    expect(bitbucketTokenKind("ATATT3xFf")).toBe("api-token");
    expect(bitbucketTokenKind("ATBB123")).toBe("app-password");
    expect(bitbucketTokenKind("ATCTT3x")).toBe("bearer");
    expect(gitHttpsAuthUser("https://bitbucket.org/a/b.git", "ATATT3x")).toBe(
      "x-bitbucket-api-token-auth",
    );
    expect(gitHttpsAuthUser("https://bitbucket.org/a/b.git", "ATBB1", "jo")).toBe("jo");
    expect(gitHttpsAuthUser("https://bitbucket.org/a/b.git", "oauth-token")).toBe("x-token-auth");
    expect(gitHttpsAuthUser(forgeGitHost("bitbucket"), "x")).toBe("x-token-auth");
    expect(gitHttpsAuthUser(forgeGitHost("gitlab"), "x")).toBe("oauth2");
    expect(gitCredentialFill("host=bitbucket.org\n", { GIT_TOKEN: "ATATT9" })).toContain(
      "username=x-bitbucket-api-token-auth",
    );
  });
});

describe("classifyGitFailure", () => {
  it("classifies the failures seen in host sessions", () => {
    expect(
      classifyGitFailure(
        "fatal: could not read Username for 'https://bitbucket.org': No such device or address",
      )?.category,
    ).toBe("git-auth");
    expect(
      classifyGitFailure(
        " ! [rejected]        feat -> feat (non-fast-forward)\nerror: failed to push some refs",
      )?.category,
    ).toBe("git-non-fast-forward");
    expect(classifyGitFailure("LOCUS_DIVERGED: fetched origin/develop")?.category).toBe(
      "git-diverged",
    );
    expect(classifyGitFailure("Refusing git_push to protected branch main")?.category).toBe(
      "git-protected-branch",
    );
    expect(classifyGitFailure("fatal: couldn't find remote ref feature/x")?.category).toBe(
      "git-not-found",
    );
    expect(
      classifyGitFailure("fatal: unable to access 'https://x/': Could not resolve host: x")
        ?.category,
    ).toBe("git-network");
    expect(classifyGitFailure("all good")).toBeUndefined();
  });

  it("hints shell git auth failures toward the Locus tools", () => {
    expect(
      shellGitAuthHint(
        "fatal: could not read Username for 'https://bitbucket.org': No such device",
      ),
    ).toContain("git_fetch");
    expect(shellGitAuthHint("Already up to date.")).toBeUndefined();
  });
});
