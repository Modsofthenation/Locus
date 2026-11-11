import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  serverQuitAction,
  detachChild,
  probeControlPlane,
  controlPlaneKeepAlive,
  desktopServerRecordPath,
  rememberDesktopServer,
  readDesktopServer,
  forgetDesktopServer,
  pidAlive,
  environHasOwner,
  processHasOwner,
  stopAdoptedProcess,
} = createRequire(import.meta.url)(join(desktopRoot, "electron/keep-alive.cjs")) as {
  serverQuitAction: (input: {
    ownsChild?: boolean;
    keepAlive?: boolean;
    adoptedPid?: number;
  }) => "leave" | "detach" | "stop" | "stop-adopted";
  detachChild: (child: { unref?: () => void } | undefined) => void;
  probeControlPlane: (fetchImpl: typeof fetch, url: string, timeoutMs?: number) => Promise<boolean>;
  controlPlaneKeepAlive: (fetchImpl: typeof fetch, url: string) => Promise<boolean>;
  desktopServerRecordPath: (home?: string) => string;
  rememberDesktopServer: (
    path: string,
    record: { pid?: number; owner?: string; build?: string },
  ) => Promise<void>;
  readDesktopServer: (
    path: string,
  ) => Promise<{ pid: number; owner: string; build?: string } | undefined>;
  forgetDesktopServer: (path: string) => Promise<void>;
  pidAlive: (pid: number) => boolean;
  environHasOwner: (raw: Buffer | string, owner: string) => boolean;
  processHasOwner: (pid: number, owner: string) => boolean;
  stopAdoptedProcess: (pid: number) => void;
};

describe("control plane keep-alive", () => {
  it("detaches the child only when this process owns it and a project is kept alive", () => {
    expect(serverQuitAction({ ownsChild: true, keepAlive: true })).toBe("detach");
    expect(serverQuitAction({ ownsChild: true, keepAlive: false })).toBe("stop");
    expect(serverQuitAction({ ownsChild: false, keepAlive: true })).toBe("leave");
    expect(serverQuitAction({ ownsChild: false, keepAlive: false })).toBe("leave");
    expect(serverQuitAction({ ownsChild: false, keepAlive: false, adoptedPid: 42 })).toBe(
      "stop-adopted",
    );
    expect(serverQuitAction({ ownsChild: false, keepAlive: true, adoptedPid: 42 })).toBe("leave");
  });

  it("unrefs a detached child and does not throw when the handle is missing", () => {
    const unref = vi.fn();
    detachChild({ unref });
    expect(unref).toHaveBeenCalledOnce();
    expect(() => detachChild(undefined)).not.toThrow();
  });

  it("reads the keep-alive flag and treats a dead control plane as down", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ keepAlive: true }),
    })) as unknown as typeof fetch;
    expect(
      await controlPlaneKeepAlive(fetchImpl, "http://127.0.0.1:7420/api/projects/keep-alive"),
    ).toBe(true);
    const down = vi.fn(async () => {
      throw new Error("refused");
    }) as unknown as typeof fetch;
    expect(await probeControlPlane(down, "http://127.0.0.1:7420/api/health", 20)).toBe(false);
    expect(await controlPlaneKeepAlive(down, "http://127.0.0.1:7420/api/projects/keep-alive")).toBe(
      false,
    );
  });

  it("remembers the desktop-owned pid and stops that process on unkeep", async () => {
    const owner = "owner-token-12345678";
    expect(environHasOwner(Buffer.from(`LOCUS_DESKTOP_OWNER=${owner}\0PATH=/bin`), owner)).toBe(
      true,
    );
    expect(environHasOwner(Buffer.from("LOCUS_DESKTOP_OWNER=other-token-12345678"), owner)).toBe(
      false,
    );
    const dir = await mkdtemp(join(tmpdir(), "locus-keep-"));
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      env: { ...process.env, LOCUS_DESKTOP_OWNER: owner },
      detached: true,
      stdio: "ignore",
    });
    try {
      const path = desktopServerRecordPath(dir);
      expect(child.pid).toBeTruthy();
      expect(processHasOwner(child.pid!, owner)).toBe(true);
      expect(processHasOwner(child.pid!, "other-owner-12345678")).toBe(false);
      await rememberDesktopServer(path, { pid: child.pid, owner });
      expect(await readDesktopServer(path)).toEqual({ pid: child.pid, owner });
      await rememberDesktopServer(path, { pid: 1, owner });
      expect(await readDesktopServer(path)).toEqual({ pid: child.pid, owner });
      await rememberDesktopServer(path, { pid: child.pid, owner, build: "0.18.0+abc123" });
      expect(await readDesktopServer(path)).toEqual({
        pid: child.pid,
        owner,
        build: "0.18.0+abc123",
      });
      await rememberDesktopServer(path, { pid: child.pid, owner, build: "bad build/../" });
      expect(await readDesktopServer(path)).toEqual({ pid: child.pid, owner });
      stopAdoptedProcess(child.pid!);
      const deadline = Date.now() + 2000;
      while (pidAlive(child.pid!) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(pidAlive(child.pid!)).toBe(false);
      await forgetDesktopServer(path);
      expect(await readDesktopServer(path)).toBeUndefined();
    } finally {
      if (child.pid && pidAlive(child.pid)) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
