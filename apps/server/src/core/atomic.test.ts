import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isLockedFileError, moveIntoPlace, replaceFile } from "./atomic.js";

function locked(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
}

describe("isLockedFileError", () => {
  it("matches Windows rename-in-use codes", () => {
    expect(isLockedFileError(locked("EPERM"))).toBe(true);
    expect(isLockedFileError(locked("EACCES"))).toBe(true);
    expect(isLockedFileError(locked("EBUSY"))).toBe(true);
    expect(isLockedFileError(locked("ENOENT"))).toBe(false);
    expect(isLockedFileError(new Error("no code"))).toBe(false);
  });
});

describe("moveIntoPlace", () => {
  it("renames when the destination is free", async () => {
    const io = {
      rename: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn(),
      unlink: vi.fn(),
      sleep: vi.fn(),
    };
    await moveIntoPlace("sessions.json.tmp", "sessions.json", io);
    expect(io.rename).toHaveBeenCalledOnce();
    expect(io.copyFile).not.toHaveBeenCalled();
    expect(io.sleep).not.toHaveBeenCalled();
  });

  it("copies in place when rename hits EPERM", async () => {
    const io = {
      rename: vi.fn().mockRejectedValue(locked("EPERM")),
      copyFile: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      sleep: vi.fn(),
    };
    await moveIntoPlace("sessions.json.1.tmp", "sessions.json", io);
    expect(io.copyFile).toHaveBeenCalledWith("sessions.json.1.tmp", "sessions.json");
    expect(io.unlink).toHaveBeenCalledWith("sessions.json.1.tmp");
    expect(io.sleep).not.toHaveBeenCalled();
  });

  it("retries after both rename and copy stay locked", async () => {
    const io = {
      rename: vi.fn().mockRejectedValueOnce(locked("EPERM")).mockResolvedValue(undefined),
      copyFile: vi.fn().mockRejectedValue(locked("EACCES")),
      unlink: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined),
    };
    await moveIntoPlace("a.tmp", "a.json", io);
    expect(io.sleep).toHaveBeenCalledOnce();
    expect(io.rename).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated errors", async () => {
    const io = {
      rename: vi.fn().mockRejectedValue(locked("ENOENT")),
      copyFile: vi.fn(),
      unlink: vi.fn(),
      sleep: vi.fn(),
    };
    await expect(moveIntoPlace("missing.tmp", "dest.json", io)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(io.copyFile).not.toHaveBeenCalled();
  });

  it("gives up after repeated lock errors", async () => {
    const io = {
      rename: vi.fn().mockRejectedValue(locked("EBUSY")),
      copyFile: vi.fn().mockRejectedValue(locked("EPERM")),
      unlink: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined),
    };
    await expect(moveIntoPlace("a.tmp", "a.json", io)).rejects.toMatchObject({ code: "EPERM" });
    expect(io.rename).toHaveBeenCalledTimes(8);
    expect(io.sleep).toHaveBeenCalledTimes(7);
  });
});

describe("replaceFile", () => {
  it("overwrites an existing JSON file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-atomic-"));
    const path = join(dir, "sessions.json");
    await writeFile(path, "[]");
    await replaceFile(path, '[{"id":"s1"}]');
    expect(await readFile(path, "utf8")).toBe('[{"id":"s1"}]');
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
