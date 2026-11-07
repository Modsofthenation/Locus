import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureHostKey, type Keygen } from "./keys.js";

describe("ensureHostKey", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("creates an ed25519 keypair via keygen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-keys-"));
    dirs.push(dir);
    let called: string[] | undefined;
    const keygen: Keygen = async (args) => {
      called = args;
      const path = args[args.indexOf("-f") + 1]!;
      await writeFile(path, "PRIVATE");
      await writeFile(`${path}.pub`, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake locus@host\n");
    };
    const key = await ensureHostKey(dir, keygen);
    expect(called).toEqual([
      "-t",
      "ed25519",
      "-f",
      join(dir, "ssh", "id_ed25519"),
      "-N",
      "",
      "-C",
      "locus@host",
      "-q",
    ]);
    expect(key.privateKeyPath).toBe(join(dir, "ssh", "id_ed25519"));
    expect(key.publicKey).toBe("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake locus@host");
    expect(await readFile(key.privateKeyPath, "utf8")).toBe("PRIVATE");
  });

  it("reuses an existing keypair without calling keygen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-keys-"));
    dirs.push(dir);
    const sshDir = join(dir, "ssh");
    await mkdir(sshDir, { recursive: true });
    await writeFile(join(sshDir, "id_ed25519"), "EXISTING");
    await writeFile(join(sshDir, "id_ed25519.pub"), "ssh-ed25519 AAAAC3 existing");
    let calls = 0;
    const key = await ensureHostKey(dir, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    expect(key.publicKey).toBe("ssh-ed25519 AAAAC3 existing");
  });
});
