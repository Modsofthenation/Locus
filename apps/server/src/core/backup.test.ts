import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RESTORE_MARKER,
  RESTORE_STAGING_DIR,
  applyPendingRestore,
  createBackup,
  extractBackup,
  includeTopLevel,
  inspectBackup,
  pendingRestore,
  safeJoin,
  stageRestore,
} from "./backup.js";
import { JsonStore } from "./store.js";

const cleanup: string[] = [];
const savedKey = process.env.LOCUS_MASTER_KEY;

afterEach(async () => {
  if (savedKey == null) delete process.env.LOCUS_MASTER_KEY;
  else process.env.LOCUS_MASTER_KEY = savedKey;
  await Promise.all(cleanup.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

async function seedSource(): Promise<string> {
  delete process.env.LOCUS_MASTER_KEY;
  const dir = await tmp("locus-bak-src-");
  const store = new JsonStore(dir);
  await store.init();
  const config = await store.loadConfig();
  config.providers[0]!.apiKey = "sk-from-old-machine";
  await store.saveConfig(config);
  await mkdir(join(dir, "sessions"), { recursive: true });
  await writeFile(
    join(dir, "sessions", "s1.json"),
    JSON.stringify({ id: "s1", workspace: join(dir, "docker-workspaces", "s1") }),
  );
  await mkdir(join(dir, "docker-workspaces", "s1", "node_modules", "x"), { recursive: true });
  await writeFile(join(dir, "docker-workspaces", "s1", "app.js"), "console.log(1)\n");
  await writeFile(join(dir, "docker-workspaces", "s1", "node_modules", "x", "i.js"), "big");
  await mkdir(join(dir, "disks"), { recursive: true });
  await writeFile(join(dir, "disks", "vm.qcow2"), Buffer.alloc(4096, 1));
  await mkdir(join(dir, "logs"), { recursive: true });
  await writeFile(join(dir, "logs", "server.log"), "noise");
  return dir;
}

describe("backup", () => {
  it("excludes keys, caches and (by default) disks at the top level", () => {
    for (const name of ["master.key", "master.key.safe", "secrets.enc", "logs", "updates"]) {
      expect(includeTopLevel(name, true)).toBe(false);
    }
    expect(includeTopLevel(".before-restore-2026", true)).toBe(false);
    expect(includeTopLevel("disks", false)).toBe(false);
    expect(includeTopLevel("disks", true)).toBe(true);
    expect(includeTopLevel("sessions", false)).toBe(true);
  });

  it("refuses paths that escape the restore root", () => {
    const root = join(tmpdir(), "root");
    expect(() => safeJoin(root, "../evil")).toThrow(/Unsafe/);
    expect(() => safeJoin(root, "/etc/passwd")).toThrow(/Unsafe/);
    expect(() => safeJoin(root, "a//b")).toThrow(/Unsafe/);
    expect(safeJoin(root, "sessions/a.json")).toBe(join(root, "sessions", "a.json"));
  });

  it("round-trips to another machine: new key, same secrets, rewritten paths", async () => {
    const src = await seedSource();
    const out = join(await tmp("locus-bak-out-"), "b.locusbak");
    const made = await createBackup({ dataDir: src, passphrase: "correct horse", outPath: out });
    expect(made.manifest.dataDir).toBe(src);
    expect(made.manifest.includeDisks).toBe(false);

    const raw = await readFile(out);
    expect(raw.subarray(0, 10).toString()).toBe("LOCUSBAK1\n");
    expect(raw.includes(Buffer.from("sk-from-old-machine"))).toBe(false);

    const peek = await extractBackup({
      path: out,
      passphrase: "correct horse",
      destDir: await tmp("locus-bak-peek-"),
    });
    expect(Object.values(peek.vault.providerKeys)).toContain("sk-from-old-machine");

    // The "new machine" has its own data dir and master key.
    const dest = await tmp("locus-bak-dest-");
    const destStore = new JsonStore(dest);
    await destStore.init();
    await writeFile(join(dest, "stale.json"), "{}");
    const staged = await stageRestore({ dataDir: dest, path: out, passphrase: "correct horse" });
    expect(staged.restartRequired).toBe(true);
    expect(await pendingRestore(dest)).toBeDefined();
    // Live state is untouched until the next start.
    expect(await readFile(join(dest, "stale.json"), "utf8")).toBe("{}");

    const applied = await applyPendingRestore(dest);
    expect(applied.applied).toBe(true);
    const names = await readdir(dest);
    expect(names).not.toContain(RESTORE_MARKER);
    expect(names).not.toContain(RESTORE_STAGING_DIR);
    expect(names).not.toContain("stale.json");
    expect(await readdir(applied.movedAsideTo!)).toContain("stale.json");
    expect(names).not.toContain("logs");
    await expect(stat(join(dest, "docker-workspaces", "s1", "node_modules"))).rejects.toThrow();
    expect(await readFile(join(dest, "docker-workspaces", "s1", "app.js"), "utf8")).toContain(
      "console",
    );

    const session = JSON.parse(await readFile(join(dest, "sessions", "s1.json"), "utf8"));
    expect(session.workspace).toBe(join(dest, "docker-workspaces", "s1"));

    const config = await new JsonStore(dest).loadConfig();
    expect(config.providers[0]!.apiKey).toBe("sk-from-old-machine");
  });

  it("includes disks when asked", async () => {
    const src = await seedSource();
    const out = join(await tmp("locus-bak-out-"), "d.locusbak");
    await createBackup({
      dataDir: src,
      passphrase: "correct horse",
      outPath: out,
      includeDisks: true,
    });
    const dest = await tmp("locus-bak-x-");
    await extractBackup({ path: out, passphrase: "correct horse", destDir: dest });
    expect((await stat(join(dest, "disks", "vm.qcow2"))).size).toBe(4096);
  });

  it("rejects a wrong passphrase and a short one", async () => {
    const src = await seedSource();
    const out = join(await tmp("locus-bak-out-"), "w.locusbak");
    await createBackup({ dataDir: src, passphrase: "correct horse", outPath: out });
    await expect(
      inspectBackup({ path: out, passphrase: "wrong horse", scratchDir: await tmp("s-") }),
    ).rejects.toThrow(/Wrong passphrase/);
    await expect(createBackup({ dataDir: src, passphrase: "short", outPath: out })).rejects.toThrow(
      /at least 8/,
    );
    const dest = await tmp("locus-bak-wrong-");
    await expect(
      stageRestore({ dataDir: dest, path: out, passphrase: "wrong horse" }),
    ).rejects.toThrow(/Wrong passphrase/);
    expect(await readdir(dest)).not.toContain(RESTORE_STAGING_DIR);
  });

  it("rejects a tampered archive", async () => {
    const src = await seedSource();
    const out = join(await tmp("locus-bak-out-"), "t.locusbak");
    await createBackup({ dataDir: src, passphrase: "correct horse", outPath: out });
    const raw = await readFile(out);
    raw[raw.length - 40] = raw[raw.length - 40]! ^ 0xff;
    await writeFile(out, raw);
    await expect(
      inspectBackup({ path: out, passphrase: "correct horse", scratchDir: await tmp("s-") }),
    ).rejects.toThrow(/Wrong passphrase|damaged/);
  });

  it("is a no-op when nothing is staged", async () => {
    const dir = await tmp("locus-bak-none-");
    expect(await applyPendingRestore(dir)).toEqual({ applied: false });
  });
});
