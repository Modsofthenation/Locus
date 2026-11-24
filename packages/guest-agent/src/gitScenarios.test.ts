import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitBranchCommand, gitEnvPrelude, gitFetchCommand, gitPushCommand } from "./git.js";

/**
 * Runs the real POSIX commands the git tools build against local repositories, covering the
 * common checkouts: a full clone in a host folder, a shallow Locus clone, an operator's SSH
 * origin, and a diverged branch.
 */
const hasGit = spawnSync("git", ["--version"]).status === 0;

let root: string;
let env: NodeJS.ProcessEnv;

function sh(command: string, cwd = root) {
  const out = spawnSync("sh", ["-c", command], { cwd, env, encoding: "utf8" });
  return {
    code: out.status ?? 1,
    stdout: out.stdout,
    stderr: out.stderr,
    all: out.stdout + out.stderr,
  };
}

function git(args: string, cwd: string): string {
  const out = sh(`git ${args}`, cwd);
  if (out.code !== 0) throw new Error(`git ${args} failed: ${out.all}`);
  return out.stdout.trim();
}

function commit(cwd: string, message: string) {
  writeFileSync(join(cwd, `${message}.txt`), message);
  git(`add -A`, cwd);
  git(`commit -qm ${message}`, cwd);
}

/** upstream (develop + main, 3 commits), plus a full clone of it at `user`. */
function setup() {
  const up = join(root, "up");
  mkdirSync(up);
  git("init -q -b develop", up);
  commit(up, "c1");
  commit(up, "c2");
  commit(up, "c3");
  git("branch main", up);
  const bare = join(root, "up.git");
  git(`clone -q --bare ${up} ${bare}`, root);
  const user = join(root, "user");
  git(`clone -q file://${bare} ${user}`, root);
  return { up, bare, user, url: `file://${bare}` };
}

function advance(bare: string, branch: string, message: string) {
  const work = join(root, `adv-${message}`);
  git(`clone -q -b ${branch} file://${bare} ${work}`, root);
  commit(work, message);
  git(`push -q origin ${branch}`, work);
}

describe.skipIf(!hasGit)("git tool scenarios (real git)", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "locus-git-scn-"));
    const home = join(root, "home");
    mkdirSync(home);
    env = {
      PATH: process.env.PATH,
      HOME: home,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
      GIT_TOKEN: "tok",
    };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("fetching a branch into a full clone fast-forwards it and keeps it full", () => {
    const { bare, user } = setup();
    advance(bare, "develop", "c4");
    const out = sh(gitFetchCommand({ path: user, ref: "develop", windows: false }));
    expect(out.code, out.all).toBe(0);
    expect(git("rev-parse --is-shallow-repository", user)).toBe("false");
    expect(git("log -1 --format=%s", user)).toBe("c4");
    expect(git("log -1 --format=%s origin/develop", user)).toBe("c4");
    expect(git("rev-list --count HEAD", user)).toBe("4");
  });

  it("with a token and URL, fetches and pushes by URL without rewriting origin", () => {
    const { bare, user, url } = setup();
    git("remote set-url origin git@bitbucket.org:acme/app.git", user);
    advance(bare, "develop", "c4");
    const fetched = sh(
      gitFetchCommand({ path: user, ref: "develop", url, token: "tok", windows: false }),
    );
    expect(fetched.code, fetched.all).toBe(0);
    expect(git("log -1 --format=%s", user)).toBe("c4");
    expect(git("remote get-url origin", user)).toBe("git@bitbucket.org:acme/app.git");

    git("checkout -q -b feature", user);
    commit(user, "f1");
    const pushed = sh(gitPushCommand({ path: user, url, token: "tok", windows: false }));
    expect(pushed.code, pushed.all).toBe(0);
    expect(git("rev-parse refs/heads/feature", bare)).toBe(git("rev-parse HEAD", user));
    expect(git("remote get-url origin", user)).toBe("git@bitbucket.org:acme/app.git");
    expect(git("rev-parse --abbrev-ref feature@{upstream}", user)).toBe("origin/feature");
  });

  it("only uses --depth on checkouts that are already shallow", () => {
    const { bare } = setup();
    const shallow = join(root, "shallow");
    git(`clone -q --depth 1 -b develop file://${bare} ${shallow}`, root);
    advance(bare, "develop", "c4");
    const out = sh(gitFetchCommand({ path: shallow, ref: "develop", windows: false }));
    expect(out.code, out.all).toBe(0);
    expect(git("rev-parse --is-shallow-repository", shallow)).toBe("true");
    expect(git("log -1 --format=%s", shallow)).toBe("c4");
    expect(git("rev-list --count HEAD", shallow)).toBe("2");

    const other = sh(gitFetchCommand({ path: shallow, ref: "main", windows: false }));
    expect(other.code, other.all).toBe(0);
    expect(git("branch --show-current", shallow)).toBe("main");
    expect(git("rev-list --count HEAD", shallow)).toBe("1");
  });

  it("reports a diverged branch instead of merging it", () => {
    const { bare, user } = setup();
    advance(bare, "develop", "c4");
    commit(user, "local");
    const before = git("rev-parse HEAD", user);
    const out = sh(gitFetchCommand({ path: user, ref: "develop", windows: false }));
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain("LOCUS_DIVERGED");
    expect(out.stderr).toMatch(/ahead\/behind: 1\/1/);
    expect(git("rev-parse HEAD", user)).toBe(before);
    expect(git("log -1 --format=%s origin/develop", user)).toBe("c4");
  });

  it("switches to an existing local branch and fast-forwards it, or creates a tracking one", () => {
    const { bare, user } = setup();
    git("checkout -q -b scratch", user);
    advance(bare, "develop", "c4");
    const out = sh(gitFetchCommand({ path: user, ref: "develop", windows: false }));
    expect(out.code, out.all).toBe(0);
    expect(git("branch --show-current", user)).toBe("develop");
    expect(git("log -1 --format=%s", user)).toBe("c4");

    const created = sh(gitFetchCommand({ path: user, ref: "main", windows: false }));
    expect(created.code, created.all).toBe(0);
    expect(git("branch --show-current", user)).toBe("main");
    expect(git("rev-parse --abbrev-ref main@{upstream}", user)).toBe("origin/main");
  });

  it("git_branch switches to an existing branch without resetting it", () => {
    const { user } = setup();
    git("checkout -q -b work", user);
    commit(user, "w1");
    const tip = git("rev-parse HEAD", user);
    git("checkout -q develop", user);
    const out = sh(gitBranchCommand({ path: user, name: "work", from: "develop", windows: false }));
    expect(out.code, out.all).toBe(0);
    expect(out.stdout).toContain("already exists");
    expect(git("rev-parse HEAD", user)).toBe(tip);

    const fresh = sh(
      gitBranchCommand({ path: user, name: "next", from: "origin/main", windows: false }),
    );
    expect(fresh.code, fresh.all).toBe(0);
    expect(git("rev-parse HEAD", user)).toBe(git("rev-parse origin/main", user));
  });

  it("git_push refuses detached HEAD and protected branches", () => {
    const { user, url } = setup();
    git("checkout -q --detach HEAD", user);
    const detached = sh(gitPushCommand({ path: user, url, token: "tok", windows: false }));
    expect(detached.code).not.toBe(0);
    expect(detached.stderr).toContain("LOCUS_DETACHED_HEAD");
    git("checkout -q main", user);
    const main = sh(gitPushCommand({ path: user, url, token: "tok", windows: false }));
    expect(main.code).not.toBe(0);
    expect(main.stderr).toContain("Refusing git_push to protected branch main");
  });

  it("token isolation keeps proxy/CA/safe.directory but drops insteadOf, helpers, extraHeader", () => {
    writeFileSync(
      join(env.HOME!, ".gitconfig"),
      [
        "[http]",
        "\tproxy = http://proxy.corp:3128",
        "\tsslCAInfo = /etc/corp-ca.pem",
        "\textraHeader = Authorization: Basic stale",
        "[safe]",
        "\tdirectory = *",
        '[url "https://x-access-token:bad@github.com/"]',
        "\tinsteadOf = https://github.com/",
        "[credential]",
        "\thelper = store",
        "",
      ].join("\n"),
    );
    const probe = (key: string) =>
      sh(`${gitEnvPrelude(false, true)}git config --get-all ${key} || echo MISSING`).stdout.trim();
    expect(probe("http.proxy")).toBe("http://proxy.corp:3128");
    expect(probe("http.sslcainfo")).toBe("/etc/corp-ca.pem");
    expect(probe("safe.directory")).toBe("*");
    expect(probe("http.extraheader")).toBe("MISSING");
    expect(probe("credential.helper")).toBe("MISSING");
    expect(probe("url.https://x-access-token:bad@github.com/.insteadof")).toBe("MISSING");
    const leftovers = sh(`ls ${tmpdir()} | grep -c locus-gitcfg || true`).stdout.trim();
    expect(Number(leftovers)).toBe(0);
  });

  it("puts SSH in batch mode unless the operator configured an SSH command", () => {
    const batch = sh(`${gitEnvPrelude(false, false)}echo "$GIT_SSH_COMMAND"`).stdout.trim();
    expect(batch).toBe("ssh -o BatchMode=yes");
    writeFileSync(join(env.HOME!, ".gitconfig"), "[core]\n\tsshCommand = ssh -i ~/.ssh/work\n");
    const own = sh(`${gitEnvPrelude(false, false)}echo "[$GIT_SSH_COMMAND]"`).stdout.trim();
    expect(own).toBe("[]");
    const withToken = sh(
      `${gitEnvPrelude(false, true)}git config --get core.sshcommand`,
    ).stdout.trim();
    expect(withToken).toBe("ssh -i ~/.ssh/work");
  });
});
