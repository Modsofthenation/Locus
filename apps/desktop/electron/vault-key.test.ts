import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { wrapMasterKey } = createRequire(import.meta.url)("./vault-key.cjs") as {
  wrapMasterKey: (
    safeStorage: {
      isEncryptionAvailable?: () => boolean;
      encryptString: (plain: string) => Buffer;
      decryptString: (encrypted: Buffer) => string;
    },
    opts?: { unlinkPlaintext?: boolean },
  ) => { LOCUS_MASTER_KEY?: string };
};

const fakeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plain: string) => Buffer.from(plain, "utf8"),
  decryptString: (encrypted: Buffer) => Buffer.from(encrypted).toString("utf8"),
};

describe("wrapMasterKey", () => {
  const previousHome = process.env.LOCUS_HOME;
  const previousKey = process.env.LOCUS_MASTER_KEY;

  afterEach(() => {
    if (previousHome === undefined) delete process.env.LOCUS_HOME;
    else process.env.LOCUS_HOME = previousHome;
    if (previousKey === undefined) delete process.env.LOCUS_MASTER_KEY;
    else process.env.LOCUS_MASTER_KEY = previousKey;
  });

  it("keeps plaintext master.key in unpackaged mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "locus-wrap-dev-"));
    delete process.env.LOCUS_MASTER_KEY;
    process.env.LOCUS_HOME = dir;
    writeFileSync(join(dir, "master.key"), `${"ab".repeat(32)}\n`, { mode: 0o600 });
    const result = wrapMasterKey(fakeStorage, { unlinkPlaintext: false });
    expect(result.LOCUS_MASTER_KEY).toBe("ab".repeat(32));
    expect(existsSync(join(dir, "master.key"))).toBe(true);
    expect(existsSync(join(dir, "master.key.safe"))).toBe(true);
  });

  it("deletes leftover plaintext master.key after wrapping", () => {
    const dir = mkdtempSync(join(tmpdir(), "locus-wrap-pkg-"));
    delete process.env.LOCUS_MASTER_KEY;
    process.env.LOCUS_HOME = dir;
    writeFileSync(join(dir, "master.key"), `${"cd".repeat(32)}\n`, { mode: 0o600 });
    const result = wrapMasterKey(fakeStorage, { unlinkPlaintext: true });
    expect(result.LOCUS_MASTER_KEY).toBe("cd".repeat(32));
    expect(existsSync(join(dir, "master.key"))).toBe(false);
    expect(existsSync(join(dir, "master.key.safe"))).toBe(true);
  });

  it("deletes leftover plaintext when a wrapped key already exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "locus-wrap-left-"));
    delete process.env.LOCUS_MASTER_KEY;
    process.env.LOCUS_HOME = dir;
    writeFileSync(join(dir, "master.key"), `${"ef".repeat(32)}\n`, { mode: 0o600 });
    wrapMasterKey(fakeStorage, { unlinkPlaintext: false });
    expect(existsSync(join(dir, "master.key"))).toBe(true);
    const result = wrapMasterKey(fakeStorage, { unlinkPlaintext: true });
    expect(result.LOCUS_MASTER_KEY).toBe("ef".repeat(32));
    expect(existsSync(join(dir, "master.key"))).toBe(false);
  });
});
