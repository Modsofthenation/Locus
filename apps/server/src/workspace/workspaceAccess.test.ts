import { describe, expect, it, vi } from "vitest";
import {
  listGuestWorkspaceEntries,
  listWorkspaceAccess,
  readGuestWorkspaceFile,
  readWorkspaceAccess,
  readWorkspaceRawAccess,
  WORKSPACE_FILE_MISSING,
  WORKSPACE_GUEST_STOPPED,
  WORKSPACE_DEBUG_WORKER_LAUNCH,
  WORKSPACE_DEBUG_VM_LAUNCH,
  WORKSPACE_UNSUPPORTED,
  canLaunchWorkspaceDebug,
  workspaceAccessKind,
  workspaceDebugLaunchNote,
  writeGuestWorkspaceFile,
  writeWorkspaceAccess,
  writeWorkspaceBytesAccess,
  mkdirGuestWorkspace,
  mkdirWorkspaceAccess,
  deleteGuestWorkspacePath,
  deleteWorkspaceAccess,
} from "./workspaceAccess.js";

const hostFile = { name: "README.md", path: "README.md", type: "file" as const };
const guestFile = { name: "app.ts", path: "src/app.ts", type: "file" as const };

describe("workspaceAccessKind", () => {
  it("uses a VM kind so Files can talk to the guest", () => {
    expect(workspaceAccessKind("vm", false)).toBe("vm");
  });

  it("picks worker before docker, and host on this machine", () => {
    expect(workspaceAccessKind("docker", true)).toBe("worker");
    expect(workspaceAccessKind("docker", false)).toBe("docker");
    expect(workspaceAccessKind("host", false)).toBe("host");
    expect(workspaceAccessKind("host", true)).toBe("worker");
  });

  it("allows process launch on Host, local Docker, and worker mirrors", () => {
    expect(canLaunchWorkspaceDebug("host")).toBe(true);
    expect(canLaunchWorkspaceDebug("docker")).toBe(true);
    expect(canLaunchWorkspaceDebug("worker")).toBe(true);
    expect(canLaunchWorkspaceDebug("unsupported")).toBe(false);
    expect(canLaunchWorkspaceDebug("vm")).toBe(true);
    expect(WORKSPACE_DEBUG_WORKER_LAUNCH).toMatch(/worker mirror/);
    expect(workspaceDebugLaunchNote("worker", "docker")).toBe(WORKSPACE_DEBUG_WORKER_LAUNCH);
    expect(workspaceDebugLaunchNote("vm", "vm")).toBe(WORKSPACE_DEBUG_VM_LAUNCH);
    expect(workspaceDebugLaunchNote("host", "host")).toBeUndefined();
  });
});

describe("listWorkspaceAccess", () => {
  it("rejects unknown workspace kinds", async () => {
    await expect(
      listWorkspaceAccess({
        kind: "unsupported",
        hasVm: false,
        messageChanges: [],
        listWorker: async () => [],
        listGuest: async () => undefined,
        listHost: async () => [],
        gitChanges: async () => [],
      }),
    ).rejects.toThrow(WORKSPACE_UNSUPPORTED);
  });

  it("flags a listing that stopped at the entry cap", async () => {
    const many = Array.from({ length: 16_000 }, (_, i) => ({
      name: `f${i}.ts`,
      path: `f${i}.ts`,
      type: "file" as const,
    }));
    const base = {
      hasVm: true,
      messageChanges: [],
      listGuest: async () => undefined,
      gitChanges: async () => [],
      skipGit: true,
    };
    const full = await listWorkspaceAccess({
      ...base,
      kind: "host",
      listWorker: async () => [],
      listHost: async () => many,
    });
    expect(full.truncated).toBe(true);
    const worker = await listWorkspaceAccess({
      ...base,
      kind: "worker",
      listWorker: async () => many,
      listHost: async () => [],
    });
    expect(worker.truncated).toBe(true);
    const small = await listWorkspaceAccess({
      ...base,
      kind: "host",
      listWorker: async () => [],
      listHost: async () => many.slice(0, 3),
    });
    expect(small.truncated).toBeUndefined();
  });

  it("lists nothing on a worker session before the guest exists", async () => {
    const listed = await listWorkspaceAccess({
      kind: "worker",
      hasVm: false,
      messageChanges: [{ path: "a.ts", additions: 1, deletions: 0 }],
      listWorker: async () => [hostFile],
      listGuest: async () => [guestFile],
      listHost: async () => [hostFile],
      gitChanges: async () => [{ path: "b.ts", additions: 2, deletions: 0 }],
    });
    expect(listed.entries).toEqual([]);
    expect(listed.changes).toEqual([{ path: "a.ts", additions: 1, deletions: 0 }]);
  });

  it("uses the worker listing and skips git merge", async () => {
    const listed = await listWorkspaceAccess({
      kind: "worker",
      hasVm: true,
      messageChanges: [{ path: "a.ts", additions: 1, deletions: 0 }],
      listWorker: async () => [hostFile],
      listGuest: async () => [guestFile],
      listHost: async () => [],
      gitChanges: async () => [{ path: "b.ts", additions: 2, deletions: 0 }],
    });
    expect(listed.entries).toEqual([hostFile]);
    expect(listed.changes).toEqual([{ path: "a.ts", additions: 1, deletions: 0 }]);
  });

  it("falls back to guest exec when the worker listing fails", async () => {
    const listed = await listWorkspaceAccess({
      kind: "worker",
      hasVm: true,
      messageChanges: [],
      listWorker: async () => {
        throw new Error("offline");
      },
      listGuest: async () => [guestFile],
      listHost: async () => [hostFile],
      gitChanges: async () => [],
    });
    expect(listed.entries).toEqual([guestFile]);
  });

  it("prefers a live VM guest listing over the laptop mirror", async () => {
    const listed = await listWorkspaceAccess({
      kind: "vm",
      hasVm: true,
      messageChanges: [],
      listWorker: async () => [],
      listGuest: async () => [guestFile],
      listHost: async () => [hostFile],
      gitChanges: async () => [],
    });
    expect(listed.entries).toEqual([guestFile]);
  });

  it("does not guest-fallback a host listing, and merges git dirty stats", async () => {
    const listed = await listWorkspaceAccess({
      kind: "host",
      hasVm: false,
      messageChanges: [{ path: "a.ts", additions: 1, deletions: 0 }],
      listWorker: async () => [],
      listGuest: async () => [guestFile],
      listHost: async () => [],
      gitChanges: async () => [{ path: "b.ts", additions: 2, deletions: 0 }],
    });
    expect(listed.entries).toEqual([]);
    expect(listed.changes).toEqual([
      { path: "a.ts", additions: 1, deletions: 0 },
      { path: "b.ts", additions: 2, deletions: 0 },
    ]);
  });

  it("skips git dirty stats for a shallow host listing", async () => {
    const gitChanges = vi.fn(async () => [{ path: "b.ts", additions: 2, deletions: 0 }]);
    const listed = await listWorkspaceAccess({
      kind: "host",
      hasVm: false,
      messageChanges: [{ path: "a.ts", additions: 1, deletions: 0 }],
      skipGit: true,
      listWorker: async () => [],
      listGuest: async () => [guestFile],
      listHost: async () => [hostFile],
      gitChanges,
    });
    expect(listed.entries).toEqual([hostFile]);
    expect(listed.changes).toEqual([{ path: "a.ts", additions: 1, deletions: 0 }]);
    expect(gitChanges).not.toHaveBeenCalled();
  });

  it("guest-fallbacks an empty docker bind mount", async () => {
    const listed = await listWorkspaceAccess({
      kind: "docker",
      hasVm: true,
      messageChanges: [],
      listWorker: async () => [],
      listGuest: async () => [guestFile],
      listHost: async () => [],
      gitChanges: async () => [],
    });
    expect(listed.entries).toEqual([guestFile]);
  });
});

describe("readWorkspaceAccess", () => {
  const text = { path: "README.md", content: "hi", mtime: "2020-01-01T00:00:00.000Z" };

  it("adds a git baseline on host/docker bind-mount hits", async () => {
    const file = await readWorkspaceAccess({
      kind: "docker",
      hasVm: true,
      readWorker: async () => text,
      readGuest: async () => undefined,
      readHost: async () => text,
      gitBaseline: async () => "old",
    });
    expect(file).toEqual({ ...text, baseline: "old" });
  });

  it("starts the git baseline before the host read returns", async () => {
    let hostStarted = 0;
    let gitStarted = 0;
    const file = await readWorkspaceAccess({
      kind: "host",
      hasVm: false,
      readWorker: async () => text,
      readGuest: async () => undefined,
      readHost: async () => {
        hostStarted = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 40));
        return text;
      },
      gitBaseline: async () => {
        gitStarted = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 40));
        return "old";
      },
    });
    expect(file.baseline).toBe("old");
    expect(Math.abs(gitStarted - hostStarted)).toBeLessThan(20);
  });

  it("reads from guest exec when the docker bind mount is empty", async () => {
    const file = await readWorkspaceAccess({
      kind: "docker",
      hasVm: true,
      readWorker: async () => text,
      readGuest: async () => ({ ...text, content: "from guest" }),
      readHost: async () => undefined,
      gitBaseline: async () => "old",
    });
    expect(file.content).toBe("from guest");
    expect(file.baseline).toBeUndefined();
  });

  it("does not map a busy host filesystem to File not found", async () => {
    await expect(
      readWorkspaceAccess({
        kind: "host",
        hasVm: false,
        readWorker: async () => text,
        readGuest: async () => text,
        readHost: async () => {
          throw Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" });
        },
        gitBaseline: async () => undefined,
      }),
    ).rejects.toThrow(/EMFILE/);
  });

  it("does not guest-fallback a missing host file", async () => {
    await expect(
      readWorkspaceAccess({
        kind: "host",
        hasVm: false,
        readWorker: async () => text,
        readGuest: async () => text,
        readHost: async () => undefined,
        gitBaseline: async () => undefined,
      }),
    ).rejects.toThrow(WORKSPACE_FILE_MISSING);
  });

  it("falls back to guest exec when the worker read fails", async () => {
    const file = await readWorkspaceAccess({
      kind: "worker",
      hasVm: true,
      readWorker: async () => {
        throw new Error("offline");
      },
      readGuest: async () => text,
      readHost: async () => undefined,
      gitBaseline: async () => undefined,
    });
    expect(file).toEqual(text);
  });

  it("does not treat a missing worker file as a guest-exec fallback", async () => {
    await expect(
      readWorkspaceAccess({
        kind: "worker",
        hasVm: true,
        readWorker: async () => {
          throw new Error("File not found");
        },
        readGuest: async () => text,
        readHost: async () => undefined,
        gitBaseline: async () => undefined,
      }),
    ).rejects.toThrow(WORKSPACE_FILE_MISSING);
  });
});

describe("readWorkspaceRawAccess", () => {
  const raw = {
    path: "logo.png",
    bytes: Buffer.from("png"),
    mime: "image/png",
    mtime: "2020-01-01T00:00:00.000Z",
  };

  it("does not guest-fallback a worker raw read", async () => {
    const file = await readWorkspaceRawAccess({
      kind: "worker",
      hasVm: true,
      readWorker: async () => raw,
      readHost: async () => undefined,
    });
    expect(file).toEqual(raw);
  });

  it("throws when the worker guest is missing", async () => {
    await expect(
      readWorkspaceRawAccess({
        kind: "worker",
        hasVm: false,
        readWorker: async () => raw,
        readHost: async () => raw,
      }),
    ).rejects.toThrow(WORKSPACE_FILE_MISSING);
  });
});

describe("writeWorkspaceAccess", () => {
  const saved = { path: "README.md", mtime: "2020-01-01T00:00:00.000Z" };

  it("mirrors a docker save onto guest exec", async () => {
    const writeGuest = vi.fn(async () => undefined);
    await expect(
      writeWorkspaceAccess({
        kind: "docker",
        hasVm: true,
        rel: "README.md",
        writeWorker: async () => saved,
        writeGuest,
        writeHost: async () => saved,
      }),
    ).resolves.toEqual(saved);
    expect(writeGuest).toHaveBeenCalledOnce();
  });

  it("does not mirror a host save onto guest exec", async () => {
    const writeGuest = vi.fn(async () => undefined);
    await writeWorkspaceAccess({
      kind: "host",
      hasVm: false,
      rel: "README.md",
      writeWorker: async () => saved,
      writeGuest,
      writeHost: async () => saved,
    });
    expect(writeGuest).not.toHaveBeenCalled();
  });

  it("writes through guest exec when the worker PUT fails", async () => {
    const writeGuest = vi.fn(async () => undefined);
    const result = await writeWorkspaceAccess({
      kind: "worker",
      hasVm: true,
      rel: "README.md",
      writeWorker: async () => {
        throw new Error("offline");
      },
      writeGuest,
      writeHost: async () => saved,
    });
    expect(writeGuest).toHaveBeenCalledOnce();
    expect(result.path).toBe("README.md");
  });

  it("rejects a worker write before the guest exists", async () => {
    await expect(
      writeWorkspaceAccess({
        kind: "worker",
        hasVm: false,
        rel: "README.md",
        writeWorker: async () => saved,
        writeGuest: async () => undefined,
        writeHost: async () => saved,
      }),
    ).rejects.toThrow(WORKSPACE_GUEST_STOPPED);
  });
});

describe("writeWorkspaceBytesAccess", () => {
  const saved = { path: "logo.png", mtime: "2020-01-01T00:00:00.000Z" };

  it("does not guest-fallback a worker byte write", async () => {
    const result = await writeWorkspaceBytesAccess({
      kind: "worker",
      hasVm: true,
      rel: "logo.png",
      writeWorker: async () => saved,
      writeHost: async () => ({ path: "nope", mtime: saved.mtime }),
    });
    expect(result).toEqual(saved);
  });
});

describe("guest workspace adapters", () => {
  it("lists via find, reads via head, writes via file_write", async () => {
    const execute = vi.fn(async (req: { name: string; args: Record<string, unknown> }) => {
      if (req.name === "exec" && String(req.args.command).includes("find '/workspace")) {
        return { ok: true, output: "f\t/workspace/src/app.ts\n" };
      }
      if (req.name === "exec" && String(req.args.command).startsWith("head ")) {
        return { ok: true, output: "export {}\n" };
      }
      return { ok: true, output: "" };
    });
    await expect(listGuestWorkspaceEntries(execute, "", true)).resolves.toEqual([
      { name: "app.ts", path: "src/app.ts", type: "file" },
    ]);
    await expect(readGuestWorkspaceFile(execute, "src/app.ts", true)).resolves.toMatchObject({
      path: "src/app.ts",
      content: "export {}\n",
    });
    await writeGuestWorkspaceFile(execute, "src/app.ts", "next\n", true);
    expect(execute).toHaveBeenCalledWith({
      name: "file_write",
      args: { path: "/workspace/src/app.ts", content: "next\n" },
    });
  });

  it("skips guest I/O when the machine is not ready", async () => {
    const execute = vi.fn(async () => ({ ok: true, output: "" }));
    await expect(listGuestWorkspaceEntries(execute, "", false)).resolves.toBeUndefined();
    await expect(readGuestWorkspaceFile(execute, "a.ts", false)).resolves.toBeUndefined();
    await writeGuestWorkspaceFile(execute, "a.ts", "x", false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("mkdirs and deletes on the guest via exec", async () => {
    const execute = vi.fn(async () => ({ ok: true, output: "" }));
    await mkdirGuestWorkspace(execute, "src/components", true);
    expect(execute).toHaveBeenCalledWith({
      name: "exec",
      args: { command: 'mkdir -p -- "/workspace/src/components"' },
    });
    await deleteGuestWorkspacePath(execute, "src/app.ts", true);
    expect(execute).toHaveBeenCalledWith({
      name: "exec",
      args: { command: 'rm -f -- "/workspace/src/app.ts" || rmdir -- "/workspace/src/app.ts"' },
    });
  });

  it("mkdirs on the host then guest for Docker", async () => {
    const mkdirGuest = vi.fn(async () => undefined);
    await expect(
      mkdirWorkspaceAccess({
        kind: "docker",
        hasVm: true,
        rel: "src",
        mkdirWorker: async () => ({ path: "nope" }),
        mkdirGuest,
        mkdirHost: async () => ({ path: "src" }),
      }),
    ).resolves.toEqual({ path: "src" });
    expect(mkdirGuest).toHaveBeenCalled();
  });

  it("deletes on the host then guest for Docker", async () => {
    const deleteGuest = vi.fn(async () => undefined);
    await expect(
      deleteWorkspaceAccess({
        kind: "docker",
        hasVm: true,
        rel: "src/app.ts",
        deleteWorker: async () => ({ path: "nope" }),
        deleteGuest,
        deleteHost: async () => ({ path: "src/app.ts" }),
      }),
    ).resolves.toEqual({ path: "src/app.ts" });
    expect(deleteGuest).toHaveBeenCalled();
  });

  it("rejects a binary guest read", async () => {
    await expect(
      readGuestWorkspaceFile(async () => ({ ok: true, output: "a\0b" }), "blob.bin", true),
    ).rejects.toThrow("Binary files cannot be opened in the host editor");
  });
});
