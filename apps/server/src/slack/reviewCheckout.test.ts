import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GitForgeAccount, ParsedPullUrl } from "@locus/shared";
import {
  cloneReviewCheckout,
  resolveCheckoutPath,
  reviewCheckoutAuthEnv,
  reviewFetchSpecs,
  reviewRemoteUrl,
  safeBranchName,
  runReviewTool,
  sweepReviewCheckouts,
} from "./reviewCheckout.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

/** A source repo with a base commit and a PR head published at refs/pull/7/head. */
async function sourceRepo(): Promise<{ dir: string; head: string }> {
  const dir = await temp("review-src-");
  git(dir, "init", "-q", "-b", "main");
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src/a.ts"), "export function a(x: number) {\n  return x;\n}\n");
  await writeFile(join(dir, "src/b.ts"), "import { a } from './a';\nconsole.log(a(1));\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "checkout", "-q", "-b", "feat");
  await writeFile(join(dir, "src/a.ts"), "export function a(x: string) {\n  return x;\n}\n");
  git(dir, "commit", "-q", "-am", "change a");
  const head = git(dir, "rev-parse", "HEAD").trim();
  git(dir, "update-ref", "refs/pull/7/head", head);
  git(dir, "checkout", "-q", "main");
  return { dir, head };
}

const account: GitForgeAccount = {
  id: "gh",
  kind: "github",
  name: "GitHub",
  apiBaseUrl: "https://api.github.com",
};

function pr(repoUrl: string): ParsedPullUrl {
  return { host: "github.com", owner: "acme", repo: "api", number: 7, repoUrl };
}

describe("cloneReviewCheckout", () => {
  it("checks out the PR head, lets tools read it, and deletes it on dispose", async () => {
    const src = await sourceRepo();
    const parent = await temp("review-parent-");
    const checkout = await cloneReviewCheckout({
      parentDir: parent,
      account,
      pr: pr(src.dir),
      headSha: src.head,
    });
    expect(checkout.sha).toBe(src.head);
    expect(checkout.dir.startsWith(parent) || checkout.dir.includes("review-")).toBe(true);

    const read = await checkout.run("read_file", { path: "src/a.ts" });
    expect(read).toMatchObject({ ok: true });
    expect(read.output).toContain("1  export function a(x: string)");

    const grep = await checkout.run("grep", { pattern: "a\\(1\\)" });
    expect(grep.output).toBe("src/b.ts:2:console.log(a(1));");

    expect((await checkout.run("find_files", { pattern: "*.ts" })).output).toBe(
      "src/a.ts\nsrc/b.ts",
    );
    expect((await checkout.run("list_dir", {})).output).toBe("./\nsrc/");

    await checkout.dispose();
    expect(existsSync(checkout.dir)).toBe(false);
    expect(await readdir(parent)).toEqual([]);
  });

  it("falls back to the PR ref when the SHA cannot be fetched directly", async () => {
    const src = await sourceRepo();
    const parent = await temp("review-parent-");
    const checkout = await cloneReviewCheckout({
      parentDir: parent,
      account,
      pr: pr(src.dir),
      headSha: "0".repeat(40),
    });
    expect(checkout.sha).toBe(src.head);
    await checkout.dispose();
  });

  describe("Bitbucket Cloud (short hash, no PR refs)", () => {
    const bitbucket: GitForgeAccount = {
      id: "bb",
      kind: "bitbucket",
      name: "Bitbucket",
      apiBaseUrl: "https://api.bitbucket.org/2.0",
    };

    /** Like Bitbucket Cloud: the PR exists only as its source branch. */
    async function bitbucketRepo(): Promise<{ dir: string; head: string }> {
      const src = await sourceRepo();
      git(src.dir, "update-ref", "-d", "refs/pull/7/head");
      return src;
    }

    it("fetches the source branch when the 12-character hash and PR ref both fail", async () => {
      const src = await bitbucketRepo();
      const parent = await temp("review-parent-");
      const checkout = await cloneReviewCheckout({
        parentDir: parent,
        account: bitbucket,
        pr: pr(src.dir),
        headSha: src.head.slice(0, 12),
        headRef: "feat",
      });
      expect(checkout.sha).toBe(src.head);
      await checkout.dispose();
    });

    it("finds the reviewed commit when the branch has moved on since", async () => {
      const src = await bitbucketRepo();
      git(src.dir, "checkout", "-q", "feat");
      await writeFile(join(src.dir, "src/c.ts"), "export const c = 1;\n");
      git(src.dir, "add", ".");
      git(src.dir, "commit", "-q", "-m", "later");
      git(src.dir, "checkout", "-q", "main");
      const parent = await temp("review-parent-");
      const checkout = await cloneReviewCheckout({
        parentDir: parent,
        account: bitbucket,
        pr: pr(src.dir),
        headSha: src.head.slice(0, 12),
        headRef: "feat",
      });
      expect(checkout.sha).toBe(src.head);
      await checkout.dispose();
    });

    it("names every attempt when nothing can be fetched", async () => {
      const src = await bitbucketRepo();
      const parent = await temp("review-parent-");
      const err = await cloneReviewCheckout({
        parentDir: parent,
        account: bitbucket,
        pr: pr(src.dir),
        headSha: src.head.slice(0, 12),
        headRef: "gone",
      }).catch((e: Error) => e);
      expect(String(err)).toContain("refs/pull-requests/7/from");
      expect(String(err)).toContain("refs/heads/gone");
      expect(await readdir(parent)).toEqual([]);
    });
  });

  it("removes its folder when the clone fails", async () => {
    const parent = await temp("review-parent-");
    await expect(
      cloneReviewCheckout({
        parentDir: parent,
        account,
        pr: pr(join(parent, "missing-repo")),
        headSha: "abc",
      }),
    ).rejects.toThrow();
    expect(await readdir(parent)).toEqual([]);
  });

  it("sweeps clones left over from an earlier crash before cloning", async () => {
    const src = await sourceRepo();
    const parent = await temp("review-parent-");
    const stale = join(parent, "review-old");
    await mkdir(stale);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(stale, old, old);
    const checkout = await cloneReviewCheckout({
      parentDir: parent,
      account,
      pr: pr(src.dir),
      headSha: src.head,
    });
    expect(existsSync(stale)).toBe(false);
    await checkout.dispose();
  });
});

describe("reviewRemoteUrl", () => {
  const bitbucket: GitForgeAccount = {
    id: "bb",
    kind: "bitbucket",
    name: "Bitbucket",
    token: "t",
    apiBaseUrl: "https://api.bitbucket.org/2.0",
  };

  it("clones over https when the PR link was pasted as http", () => {
    // The forge redirects http to https and git drops the auth header on the way.
    expect(reviewRemoteUrl(bitbucket, "http://bitbucket.org/signiq/signiq8")).toBe(
      "https://bitbucket.org/signiq/signiq8",
    );
  });

  it("leaves https links and other hosts alone", () => {
    expect(reviewRemoteUrl(bitbucket, "https://bitbucket.org/a/b")).toBe(
      "https://bitbucket.org/a/b",
    );
    expect(reviewRemoteUrl(bitbucket, "http://git.internal/a/b")).toBe("http://git.internal/a/b");
  });

  it("keeps http for a self-hosted forge that only serves http", () => {
    const gitlab: GitForgeAccount = {
      id: "gl",
      kind: "gitlab",
      name: "GitLab",
      token: "t",
      apiBaseUrl: "http://gitlab.internal/api/v4",
    };
    expect(reviewRemoteUrl(gitlab, "http://gitlab.internal/a/b")).toBe(
      "http://gitlab.internal/a/b",
    );
  });
});

describe("reviewFetchSpecs", () => {
  it("tries a full SHA, then the PR ref, then the source branch", () => {
    const full = "a".repeat(40);
    expect(
      reviewFetchSpecs({ forge: "github", number: 3, headSha: full, headRef: "feat/x" }),
    ).toEqual([full, "refs/pull/3/head", "refs/heads/feat/x"]);
  });

  it("skips a short hash, which git cannot fetch", () => {
    expect(
      reviewFetchSpecs({ forge: "bitbucket", number: 9, headSha: "abcdef123456", headRef: "f" }),
    ).toEqual(["refs/pull-requests/9/from", "refs/heads/f"]);
  });

  it("drops branch names that are not safe in a refspec", () => {
    for (const bad of ["", "-x", "a:b", "a..b", "a b", "+x:y", "a/", ".x", "x.lock", "a@{1}"]) {
      expect(safeBranchName(bad)).toBeUndefined();
    }
    expect(safeBranchName("refs/heads/feature/ABC-1_x")).toBe("feature/ABC-1_x");
  });
});

describe("sweepReviewCheckouts", () => {
  it("removes only old review-* folders, or all of them with maxAgeMs 0", async () => {
    const parent = await temp("review-parent-");
    const now = Date.now();
    for (const name of ["review-old", "review-new", "keep-me"]) await mkdir(join(parent, name));
    const old = new Date(now - 60 * 60 * 1000);
    await utimes(join(parent, "review-old"), old, old);
    await utimes(join(parent, "keep-me"), old, old);

    expect(await sweepReviewCheckouts(parent, { now })).toBe(1);
    expect((await readdir(parent)).sort()).toEqual(["keep-me", "review-new"]);

    expect(await sweepReviewCheckouts(parent, { maxAgeMs: 0 })).toBe(1);
    expect(await readdir(parent)).toEqual(["keep-me"]);
  });

  it("is a no-op when the folder does not exist", async () => {
    expect(await sweepReviewCheckouts(join(tmpdir(), "no-such-locus-dir-xyz"))).toBe(0);
  });
});

describe("review tools", () => {
  async function tree(): Promise<string> {
    const root = await temp("review-tools-");
    git(root, "init", "-q");
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src/x.ts"),
      Array.from({ length: 900 }, (_, i) => `l${i + 1}`).join("\n"),
    );
    await writeFile(join(root, "bin.dat"), Buffer.from([1, 0, 2]));
    git(root, "add", ".");
    return root;
  }

  it("keeps paths inside the checkout and out of .git", async () => {
    const root = await tree();
    expect(await resolveCheckoutPath(root, "../etc/passwd")).toEqual({
      error: "path is outside the repository",
    });
    expect(await resolveCheckoutPath(root, ".git/config")).toEqual({
      error: "the .git folder is not part of the review",
    });
    expect(await resolveCheckoutPath(root, "/src/x.ts")).toMatchObject({ rel: "src/x.ts" });
    const escaped = await runReviewTool(root, "grep", { pattern: "x", path: "../.." });
    expect(escaped).toEqual({ ok: false, output: "path is outside the repository" });
  });

  it("pages long files and refuses binaries and unknown tools", async () => {
    const root = await tree();
    const first = await runReviewTool(root, "read_file", { path: "src/x.ts" });
    expect(first.output).toContain("lines 1-400 of 900");
    expect(first.output).toContain("more: read_file start_line=401");
    const later = await runReviewTool(root, "read_file", { path: "src/x.ts", start_line: 850 });
    expect(later.output).toContain("lines 850-900 of 900");
    expect((await runReviewTool(root, "read_file", { path: "bin.dat" })).output).toContain(
      "binary",
    );
    expect((await runReviewTool(root, "exec", {})).ok).toBe(false);
  });

  it("filters grep by glob and reports no matches", async () => {
    const root = await tree();
    expect((await runReviewTool(root, "grep", { pattern: "^l42$", glob: "*.ts" })).output).toBe(
      "src/x.ts:42:l42",
    );
    expect((await runReviewTool(root, "grep", { pattern: "^l42$", glob: "*.py" })).output).toBe(
      "No matches.",
    );
  });
});

describe("reviewCheckoutAuthEnv", () => {
  it("sends the token as a header through env config, never in the URL", () => {
    expect(reviewCheckoutAuthEnv("https://github.com/acme/api", undefined)).toEqual({});
    const env = reviewCheckoutAuthEnv("https://github.com/acme/api", "ghp_x");
    expect(env.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
    expect(env.GIT_CONFIG_VALUE_0).toBe(
      `Authorization: Basic ${Buffer.from("git:ghp_x").toString("base64")}`,
    );
  });
});
