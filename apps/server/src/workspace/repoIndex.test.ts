import { mkdir, symlink, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { parseIgnore, pathIgnored } from "./repoIgnore.js";
import {
  buildWorkspaceIndex,
  indexWorkspace,
  peekWorkspaceIndex,
  resetWorkspaceIndexCache,
  searchWorkspaceIndex,
  updateIndexPaths,
} from "./repoIndex.js";

const execFileAsync = promisify(execFile);

let cleanup: string[] = [];
afterEach(async () => {
  resetWorkspaceIndexCache();
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    cleanup.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
  cleanup = [];
});

async function fixture(): Promise<{ root: string; cache: string }> {
  const parent = await mkdtemp(join(tmpdir(), "locus-idx-"));
  cleanup.push(parent);
  const root = join(parent, "ws");
  const cache = join(parent, "cache");
  await mkdir(root);
  return { root, cache };
}

describe("ignore rules", () => {
  it("ignores gitignore directories and files", () => {
    const rules = parseIgnore("build/\n*.log\n/secret.txt\n");
    expect(pathIgnored("build", true, rules)).toBe(true);
    expect(pathIgnored("build/out.js", false, rules)).toBe(true);
    expect(pathIgnored("src/app.ts", false, rules)).toBe(false);
    expect(pathIgnored("debug.log", false, rules)).toBe(true);
    expect(pathIgnored("secret.txt", false, rules)).toBe(true);
    expect(pathIgnored("nested/secret.txt", false, rules)).toBe(false);
  });

  it("matches gitignore rules without recompiling a regex per file", () => {
    const rules = parseIgnore("build/\n*.log\n*.tmp\nnode_modules/\ndist/\n");
    const t0 = Date.now();
    let hits = 0;
    for (let i = 0; i < 8000; i += 1) {
      if (pathIgnored(`src/pkg/f${i}.ts`, false, rules)) hits += 1;
      if (pathIgnored(`build/out${i}.js`, false, rules)) hits += 1;
    }
    expect(hits).toBe(8000);
    expect(Date.now() - t0).toBeLessThan(750);
  });
});

describe("workspace index", () => {
  it("maps symbols from a workspace tree", async () => {
    const { root } = await fixture();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "compact.ts"), "export function foldOldTurns() {}\n");
    await writeFile(join(root, "README.md"), "# hi\n");
    const text = await indexWorkspace(root, { query: "fold" });
    expect(text).toContain("src/compact.ts");
    expect(text).toContain("foldOldTurns");
    expect(text).not.toContain("# hi");
  });

  it("indexes more than 400 files and skips node_modules", async () => {
    const { root, cache } = await fixture();
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(root, ".locus-chrome", "Default"), { recursive: true });
    await writeFile(
      join(root, "node_modules", "pkg", "skip.ts"),
      "export function vendorHit() {}\n",
    );
    await writeFile(join(root, ".locus-chrome", "Default", "Cookies"), "secret");
    for (let i = 0; i < 500; i += 1) {
      const body = i === 10 ? "export function zeta401() {}\n" : `export const n${i} = ${i};\n`;
      await writeFile(join(root, "src", `f${String(i).padStart(3, "0")}.ts`), body);
    }
    const built = await buildWorkspaceIndex(root, { cacheDir: cache });
    expect(built.stats.files).toBe(500);
    expect(built.map.files.some((file) => file.path.includes("node_modules"))).toBe(false);
    expect(built.map.files.some((file) => file.path.includes(".locus-chrome"))).toBe(false);
    const ranked = await indexWorkspace(root, { query: "zeta401", rank: true, cacheDir: cache });
    expect(ranked).toMatch(/Likely relevant/);
    expect(ranked).toContain("src/f010.ts");
    expect(ranked).toContain("zeta401");
  });

  it("reuses unchanged files on a second build", async () => {
    const { root, cache } = await fixture();
    await writeFile(join(root, "a.ts"), "export function alpha() {}\n");
    const first = await buildWorkspaceIndex(root, { cacheDir: cache });
    expect(first.stats.read).toBe(1);
    const second = await buildWorkspaceIndex(root, { cacheDir: cache });
    expect(second.stats.read).toBe(0);
    expect(second.stats.reused).toBe(1);
    expect(second.map.files[0]?.symbols).toContain("alpha");
  });

  it("reuses unchanged files when force rebuilds the index", async () => {
    const { root, cache } = await fixture();
    await writeFile(join(root, "a.ts"), "export function alpha() {}\n");
    await buildWorkspaceIndex(root, { cacheDir: cache });
    await writeFile(join(root, "b.ts"), "export function beta() {}\n");
    const forced = await buildWorkspaceIndex(root, { cacheDir: cache, force: true });
    expect(forced.stats.reused).toBe(1);
    expect(forced.stats.read).toBe(1);
    expect(forced.stats.files).toBe(2);
    expect(forced.map.files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
    expect(forced.map.files[0]?.symbols).toContain("alpha");
    expect(forced.map.files[1]?.symbols).toContain("beta");
  });

  it("skips binary files and does not index symlink targets", async () => {
    const { root } = await fixture();
    await writeFile(join(root, "ok.ts"), "export function keep() {}\n");
    await writeFile(join(root, "blob.bin"), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(root, "notes.md"), "# hi\n");
    const built = await buildWorkspaceIndex(root);
    expect(built.map.files.map((file) => file.path)).toEqual(["notes.md", "ok.ts"]);
    expect(built.map.files.find((file) => file.path === "notes.md")?.symbols).toEqual([]);
  });

  it("peeks live index progress after a build", async () => {
    const { root, cache } = await fixture();
    await writeFile(join(root, "a.ts"), "export function alpha() {}\n");
    expect(await peekWorkspaceIndex(cache)).toBeUndefined();
    await buildWorkspaceIndex(root, { cacheDir: cache });
    expect(await peekWorkspaceIndex(cache)).toMatchObject({
      status: "ready",
      fileCount: 1,
      scanned: 1,
    });
  });

  it("updates a path after write without waiting", async () => {
    const { root, cache } = await fixture();
    await writeFile(join(root, "a.ts"), "export function alpha() {}\n");
    await buildWorkspaceIndex(root, { cacheDir: cache });
    await writeFile(join(root, "b.ts"), "export function nova() {}\n");
    await updateIndexPaths(root, cache, ["b.ts"]);
    const text = await indexWorkspace(root, { query: "nova", cacheDir: cache });
    expect(text).toContain("b.ts");
    expect(text).toContain("nova");
  });

  it("returns ranked file and symbol search hits", async () => {
    const { root, cache } = await fixture();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "compact.ts"), "export function foldOldTurns() {}\n");
    await writeFile(join(root, "src", "loop.py"), "def run_turn():\n    pass\n");
    await buildWorkspaceIndex(root, { cacheDir: cache });
    const hits = await searchWorkspaceIndex(root, { query: "foldOld", cacheDir: cache });
    expect(hits.fileCount).toBe(2);
    expect(hits.items[0]).toMatchObject({
      path: "src/compact.ts",
      kind: "symbol",
      symbol: "foldOldTurns",
    });
    await writeFile(
      join(root, "src", "compact.ts"),
      "export function foldOldTurns() {}\nexport function nova() {}\n",
    );
    await updateIndexPaths(root, cache, ["src/compact.ts"]);
    const after = await searchWorkspaceIndex(root, { query: "nova", cacheDir: cache });
    expect(after.items.some((hit) => hit.symbol === "nova")).toBe(true);
  });

  it("serves search from the ready index without walking new files", async () => {
    const { root, cache } = await fixture();
    await writeFile(join(root, "a.ts"), "export function alpha() {}\n");
    await buildWorkspaceIndex(root, { cacheDir: cache });
    await writeFile(join(root, "b.ts"), "export function beta() {}\n");
    const stale = await searchWorkspaceIndex(root, { query: "beta", cacheDir: cache });
    expect(stale.items.some((hit) => hit.path === "b.ts")).toBe(false);
    const t0 = Date.now();
    const again = await searchWorkspaceIndex(root, { query: "alpha", cacheDir: cache });
    expect(Date.now() - t0).toBeLessThan(40);
    expect(again.items[0]).toMatchObject({ symbol: "alpha" });
    await updateIndexPaths(root, cache, ["b.ts"]);
    const fresh = await searchWorkspaceIndex(root, { query: "beta", cacheDir: cache });
    expect(fresh.items.some((hit) => hit.path === "b.ts" && hit.symbol === "beta")).toBe(true);
  });

  it("hydrates search from disk without rebuilding after a process restart", async () => {
    const { root, cache } = await fixture();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "compact.ts"), "export function foldOldTurns() {}\n");
    await buildWorkspaceIndex(root, { cacheDir: cache });
    resetWorkspaceIndexCache();
    const t0 = Date.now();
    const hits = await searchWorkspaceIndex(root, { query: "foldOld", cacheDir: cache });
    expect(Date.now() - t0).toBeLessThan(80);
    expect(hits.items[0]).toMatchObject({
      path: "src/compact.ts",
      kind: "symbol",
      symbol: "foldOldTurns",
    });
    expect(hits.fileCount).toBe(1);
  });

  it("honors .gitignore build/", async () => {
    const { root } = await fixture();
    await writeFile(join(root, ".gitignore"), "build/\n");
    await mkdir(join(root, "build"), { recursive: true });
    await mkdir(join(root, "src"));
    await writeFile(join(root, "build", "out.ts"), "export function leaked() {}\n");
    await writeFile(join(root, "src", "ok.ts"), "export function keep() {}\n");
    const built = await buildWorkspaceIndex(root);
    expect(built.map.files.map((file) => file.path).sort()).toEqual([".gitignore", "src/ok.ts"]);
  });

  it("skips .cache even without gitignore, and honors .locusignore", async () => {
    const { root } = await fixture();
    await mkdir(join(root, ".cache"), { recursive: true });
    await mkdir(join(root, ".tmp"), { recursive: true });
    await mkdir(join(root, ".cursor"), { recursive: true });
    await mkdir(join(root, ".github", "workflows"), { recursive: true });
    await mkdir(join(root, "scratch"), { recursive: true });
    await mkdir(join(root, "src"));
    await writeFile(join(root, ".cache", "noise.ts"), "export function leaked() {}\n");
    await writeFile(join(root, ".tmp", "blob.ts"), "export function tmpLeak() {}\n");
    await writeFile(join(root, ".cursor", "index.ts"), "export function cursorLeak() {}\n");
    await writeFile(join(root, ".github", "workflows", "ci.yml"), "name: ci\n");
    await writeFile(join(root, "scratch", "tmp.ts"), "export function ignored() {}\n");
    await writeFile(join(root, ".locusignore"), "scratch/\n");
    await writeFile(join(root, "src", "ok.ts"), "export function keep() {}\n");
    const built = await buildWorkspaceIndex(root);
    expect(built.map.files.map((file) => file.path).sort()).toEqual([
      ".github/workflows/ci.yml",
      ".locusignore",
      "src/ok.ts",
    ]);
  });

  it("publishes live progress while a build is still running", async () => {
    const { root, cache } = await fixture();
    await mkdir(join(root, "src"));
    for (let i = 0; i < 400; i += 1) {
      await writeFile(
        join(root, "src", `f${String(i).padStart(3, "0")}.ts`),
        `export const n${i} = ${i};\n`,
      );
    }
    const samples: Array<{ status?: string; scanned: number }> = [];
    const poll = setInterval(() => {
      void peekWorkspaceIndex(cache).then((peek) => {
        if (peek) samples.push({ status: peek.status, scanned: peek.scanned });
      });
    }, 5);
    const built = await buildWorkspaceIndex(root, { cacheDir: cache });
    clearInterval(poll);
    expect(built.meta.fileCount).toBe(400);
    expect(samples.some((row) => row.status === "building")).toBe(true);
    expect(samples.some((row) => row.scanned > 0)).toBe(true);
  });

  it("indexes a nested git clone inside a parent git workspace", async () => {
    const { root } = await fixture();
    await execFileAsync("git", ["init"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "locus@test"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "Locus"], { cwd: root });
    await writeFile(join(root, "root.ts"), "export function rootFn() {}\n");
    await execFileAsync("git", ["add", "."], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "root"], { cwd: root });
    await mkdir(join(root, "nested", "src"), { recursive: true });
    await writeFile(join(root, "nested", "src", "app.ts"), "export function nestedFn() {}\n");
    await execFileAsync("git", ["init"], { cwd: join(root, "nested") });
    await mkdir(join(root, ".cache"), { recursive: true });
    await writeFile(join(root, ".cache", "noise.ts"), "export function leaked() {}\n");
    const built = await buildWorkspaceIndex(root);
    expect(built.map.files.map((file) => file.path).sort()).toEqual([
      "nested/src/app.ts",
      "root.ts",
    ]);
    expect(built.map.files.find((file) => file.path === "nested/src/app.ts")?.symbols).toContain(
      "nestedFn",
    );
  });

  it("indexes every file after the symbol-read cap", async () => {
    const { root } = await fixture();
    await mkdir(join(root, "src"));
    for (let i = 0; i < 900; i += 1) {
      await writeFile(
        join(root, "src", `f${String(i).padStart(3, "0")}.ts`),
        `export const n${i} = ${i};\n`,
      );
    }
    const built = await buildWorkspaceIndex(root);
    expect(built.stats.files).toBe(900);
    const withSymbols = built.map.files.filter((file) => file.symbols.length > 0);
    expect(withSymbols.length).toBeGreaterThan(0);
    expect(withSymbols.length).toBeLessThan(900);
  });

  it.skipIf(process.platform === "win32")(
    "does not follow a symlink out of the workspace",
    async () => {
      const { root, cache } = await fixture();
      const outside = await mkdtemp(join(tmpdir(), "locus-idx-out-"));
      cleanup.push(outside);
      await writeFile(join(outside, "secret.ts"), "export function leaked() {}\n");
      await symlink(join(outside, "secret.ts"), join(root, "secret.ts"));
      await writeFile(join(root, "ok.ts"), "export function keep() {}\n");
      const built = await buildWorkspaceIndex(root);
      expect(built.map.files.map((file) => file.path)).toEqual(["ok.ts"]);
      await updateIndexPaths(root, cache, ["../secret.ts", "secret.ts"]);
      const again = await buildWorkspaceIndex(root);
      expect(again.map.files.map((file) => file.path)).toEqual(["ok.ts"]);
    },
  );
});
