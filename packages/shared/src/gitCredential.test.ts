import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  GIT_CREDENTIAL_HELPER_SCRIPT,
  gitCloneAuthFailureHint,
  gitCredentialFill,
  gitCredentialInstallCommand,
  gitFetchTarget,
  gitHttpsAuthUser,
  isGitHubAppAccessToken,
  parsePullRef,
  pullHeadRefspec,
  remoteUrlForToken,
  toHttpsRemoteUrl,
} from "./models/git.js";

describe("gitHttpsAuthUser", () => {
  it("picks the forge username git expects over HTTPS", () => {
    expect(gitHttpsAuthUser("https://bitbucket.org/acme/app.git")).toBe("x-token-auth");
    expect(gitHttpsAuthUser("bitbucket.org")).toBe("x-token-auth");
    expect(gitHttpsAuthUser("https://gitlab.com/acme/app.git")).toBe("oauth2");
    expect(gitHttpsAuthUser("github.com")).toBe("x-access-token");
  });

  it("uses git for GitHub user PATs and x-access-token for App tokens", () => {
    expect(isGitHubAppAccessToken("ghs_install")).toBe(true);
    expect(isGitHubAppAccessToken("ghu_user_to_server")).toBe(true);
    expect(isGitHubAppAccessToken("gho_oauth")).toBe(false);
    expect(gitHttpsAuthUser("github.com", "ghs_install")).toBe("x-access-token");
    expect(gitHttpsAuthUser("github.com", "ghu_user_to_server")).toBe("x-access-token");
    expect(gitHttpsAuthUser("https://github.com/acme/app.git", "gho_oauth")).toBe("git");
    expect(gitHttpsAuthUser("github.com", "ghp_classic")).toBe("git");
    expect(gitHttpsAuthUser("github.com", "github_pat_fine")).toBe("git");
    expect(gitHttpsAuthUser("github.com", "ghp_classic", "alice")).toBe("alice");
    expect(gitHttpsAuthUser("gitlab.com", "ghp_classic")).toBe("oauth2");
  });

  it("explains GitHub write-access clone 403s", () => {
    expect(gitCloneAuthFailureHint("timed out")).toBeUndefined();
    expect(
      gitCloneAuthFailureHint(
        "remote: Write access to repository not granted.\nfatal: unable to access 'https://github.com/acme/app.git/': The requested URL returned error: 403",
      ),
    ).toMatch(/classic PAT needs the repo scope/i);
  });
});

describe("token remotes", () => {
  it("rewrites SSH remotes to HTTPS when a token is set", () => {
    expect(toHttpsRemoteUrl("git@github.com:acme/app.git")).toBe("https://github.com/acme/app.git");
    expect(toHttpsRemoteUrl("ssh://git@gitlab.com/acme/api.git")).toBe(
      "https://gitlab.com/acme/api.git",
    );
    expect(remoteUrlForToken("git@bitbucket.org:acme/app.git", "bb_x")).toBe(
      "https://bitbucket.org/acme/app.git",
    );
    expect(remoteUrlForToken("git@github.com:acme/app.git", "")).toBe(
      "git@github.com:acme/app.git",
    );
    expect(remoteUrlForToken("https://github.com/acme/app.git", "ghs_x")).toBe(
      "https://github.com/acme/app.git",
    );
  });

  it("maps pull numbers to forge refspecs", () => {
    expect(pullHeadRefspec("github", 12)).toBe("refs/pull/12/head");
    expect(pullHeadRefspec("gitlab", 4)).toBe("refs/merge-requests/4/head");
    expect(pullHeadRefspec("bitbucket", 9)).toBe("refs/pull-requests/9/from");
    expect(parsePullRef("pull/12")).toBe(12);
    expect(parsePullRef("#3")).toBe(3);
    expect(parsePullRef("mr-8")).toBe(8);
    expect(parsePullRef("feat")).toBeUndefined();
  });

  it("fetches branches, SHAs, and PR heads", () => {
    expect(gitFetchTarget({ ref: "feat/login" })).toEqual({
      spec: "feat/login",
      localBranch: "feat/login",
      mode: "branch",
    });
    expect(gitFetchTarget({ pull: 12, url: "https://github.com/acme/app.git" })).toEqual({
      spec: "refs/pull/12/head",
      localBranch: "pr-12",
      mode: "pr",
    });
    expect(gitFetchTarget({ ref: "pull/4", url: "https://gitlab.com/acme/api.git" })).toEqual({
      spec: "refs/merge-requests/4/head",
      localBranch: "pr-4",
      mode: "pr",
    });
    expect(gitFetchTarget({ ref: "abcdef1" })?.mode).toBe("sha");
  });
});

describe("gitCredentialFill", () => {
  it("fills Bitbucket from GIT_TOKEN and stays quiet without a token", () => {
    const stdin = "protocol=https\nhost=bitbucket.org\n\n";
    expect(gitCredentialFill(stdin, { GIT_TOKEN: "bb_x" })).toBe(
      "username=x-token-auth\npassword=bb_x\n",
    );
    expect(gitCredentialFill(stdin, { BITBUCKET_TOKEN: "bb_app" })).toBe(
      "username=x-token-auth\npassword=bb_app\n",
    );
    expect(gitCredentialFill(stdin, {})).toBe("");
    expect(
      gitCredentialFill("protocol=https\nhost=github.com\n\n", { GITHUB_TOKEN: "ghs_x" }),
    ).toBe("username=x-access-token\npassword=ghs_x\n");
    expect(
      gitCredentialFill("protocol=https\nhost=github.com\n\n", { GITHUB_TOKEN: "gho_oauth" }),
    ).toBe("username=git\npassword=gho_oauth\n");
    expect(
      gitCredentialFill("protocol=https\nhost=github.com\n\n", { GIT_TOKEN: "ghp_classic" }),
    ).toBe("username=git\npassword=ghp_classic\n");
    expect(
      gitCredentialFill("protocol=https\nhost=gitlab.com\n\n", { GITLAB_TOKEN: "glpat_x" }),
    ).toBe("username=oauth2\npassword=glpat_x\n");
  });
});

describe("git credential helper", () => {
  it("matches the agent image helper and installs without embedding a token", () => {
    expect(gitCredentialInstallCommand()).toContain("credential.helper");
    expect(gitCredentialInstallCommand()).not.toContain("GIT_TOKEN=");
  });

  it.skipIf(process.platform === "win32")(
    "lets git credential fill authenticate Bitbucket from GIT_TOKEN",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-git-cred-"));
      const helper = join(dir, "git-credential-locus");
      await writeFile(helper, GIT_CREDENTIAL_HELPER_SCRIPT, { encoding: "utf8" });
      await chmod(helper, 0o755);
      const result = spawnSync("git", ["-c", `credential.helper=${helper}`, "credential", "fill"], {
        input: "protocol=https\nhost=bitbucket.org\n\n",
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          GIT_TOKEN: "bb_test_token",
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          HOME: dir,
        },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("username=x-token-auth");
      expect(result.stdout).toContain("password=bb_test_token");
      expect(result.stderr).not.toMatch(/Username|No such device/);
    },
  );

  it.skipIf(process.platform === "win32")(
    "uses git as the GitHub username for user OAuth tokens",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-git-cred-gh-"));
      const helper = join(dir, "git-credential-locus");
      await writeFile(helper, GIT_CREDENTIAL_HELPER_SCRIPT, { encoding: "utf8" });
      await chmod(helper, 0o755);
      const fill = (token: string) =>
        spawnSync("git", ["-c", `credential.helper=${helper}`, "credential", "fill"], {
          input: "protocol=https\nhost=github.com\n\n",
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            GIT_TOKEN: token,
            GIT_TERMINAL_PROMPT: "0",
            GIT_CONFIG_NOSYSTEM: "1",
            HOME: dir,
          },
        });
      const oauth = fill("gho_oauth");
      expect(oauth.status).toBe(0);
      expect(oauth.stdout).toContain("username=git");
      expect(oauth.stdout).toContain("password=gho_oauth");
      const app = fill("ghs_install");
      expect(app.status).toBe(0);
      expect(app.stdout).toContain("username=x-access-token");
      expect(app.stdout).toContain("password=ghs_install");
    },
  );

  it("does not prompt when GIT_TERMINAL_PROMPT is disabled and no token is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-git-noprompt-"));
    const result = spawnSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=bitbucket.org\n\n",
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        HOME: dir,
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(
      /could not read Username|terminal prompts disabled/i,
    );
  });
});

describe("agent image helper", () => {
  it("stays in sync with the shared script", async () => {
    const imageHelper = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../images/agent/git-credential-locus",
    );
    expect(await readFile(imageHelper, "utf8")).toBe(GIT_CREDENTIAL_HELPER_SCRIPT);
  });
});
