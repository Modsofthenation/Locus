import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  hostExecEnv,
  hostGitAuthEnv,
  hostSpawnErrorOutput,
  posixShellCandidates,
  posixShellPath,
} from "./posixShell.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("posixShellPath", () => {
  it("prefers /bin/sh on Unix when it exists", () => {
    expect(posixShellCandidates("linux", {})).toEqual([
      "/bin/sh",
      "/bin/bash",
      "/usr/bin/sh",
      "/usr/bin/bash",
    ]);
    expect(posixShellPath("linux", {}, (path) => path === "/bin/sh")).toBe("/bin/sh");
    expect(
      posixShellPath("darwin", { LOCUS_SHELL: "/opt/homebrew/bin/bash" }, (path) =>
        path.includes("homebrew"),
      ),
    ).toBe("/opt/homebrew/bin/bash");
  });

  it("finds Git for Windows sh.exe without relying on PATH", () => {
    const env = {
      ProgramFiles: "C:\\Program Files",
      LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    };
    expect(posixShellCandidates("win32", env)).toEqual(
      expect.arrayContaining([
        "C:\\Program Files\\Git\\bin\\sh.exe",
        "C:\\Program Files\\Git\\usr\\bin\\sh.exe",
        "C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\sh.exe",
      ]),
    );
    expect(
      posixShellPath("win32", env, (path) => path === "C:\\Program Files\\Git\\bin\\sh.exe"),
    ).toBe("C:\\Program Files\\Git\\bin\\sh.exe");
    expect(posixShellPath("win32", {}, () => false)).toBe("sh.exe");
  });
});

describe("hostExecEnv", () => {
  it("fills Unix PATH when the process environment is empty", () => {
    const env = hostExecEnv("linux", {});
    expect(env.PATH?.split(":")).toEqual(
      expect.arrayContaining(["/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"]),
    );
  });

  it("keeps an existing PATH first and appends missing Unix dirs", () => {
    const env = hostExecEnv("linux", { PATH: "/opt/custom/bin" });
    expect(env.PATH?.startsWith("/opt/custom/bin:")).toBe(true);
    expect(env.PATH).toContain("/bin");
  });

  it("strips vault and token env from host exec", () => {
    const env = hostExecEnv("linux", {
      PATH: "/usr/bin",
      LOCUS_MASTER_KEY: "abc",
      GIT_TOKEN: "gho_x",
      OPENAI_API_KEY: "sk-x",
      SSH_AUTH_SOCK: "/tmp/ssh",
      LOCUS_SHELL: "/bin/bash",
    });
    expect(env.LOCUS_MASTER_KEY).toBeUndefined();
    expect(env.GIT_TOKEN).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/ssh");
    expect(env.LOCUS_SHELL).toBe("/bin/bash");
  });

  it("drops the AppImage mount so host shells do not resolve locus to the GUI", () => {
    const env = hostExecEnv("linux", {
      PATH: "/tmp/.mount_Locus-C1G4Tu:/usr/bin",
      APPDIR: "/tmp/.mount_Locus-C1G4Tu",
    });
    expect(env.PATH).not.toContain("/tmp/.mount_Locus-C1G4Tu");
    expect(env.PATH?.startsWith("/usr/bin:")).toBe(true);
  });

  it("adds Git usr/bin next to sh.exe on Windows", () => {
    const env = hostExecEnv("win32", {}, "C:\\Program Files\\Git\\bin\\sh.exe");
    expect(env.PATH?.split(";")).toEqual(
      expect.arrayContaining([
        "C:\\Program Files\\Git\\bin",
        "C:\\Program Files\\Git\\usr\\bin",
        "C:\\Program Files\\Git\\mingw64\\bin",
      ]),
    );
  });
});

describe("hostGitAuthEnv", () => {
  it("overlays the Locus token on leftover GitHub env tokens for git tools", () => {
    expect(hostGitAuthEnv({ name: "exec", args: { token: "gho_x" } })).toBeUndefined();
    expect(hostGitAuthEnv({ name: "git_clone", args: {} })).toEqual({
      GCM_INTERACTIVE: "Never",
      GIT_TERMINAL_PROMPT: "0",
    });
    expect(
      hostGitAuthEnv({
        name: "git_clone",
        args: { url: "https://github.com/acme/app.git", token: "gho_oauth" },
      }),
    ).toEqual({
      GCM_INTERACTIVE: "Never",
      GIT_TERMINAL_PROMPT: "0",
      GIT_TOKEN: "gho_oauth",
      GITHUB_TOKEN: "gho_oauth",
      GH_TOKEN: "gho_oauth",
    });
  });
});

describe("windowsHide", () => {
  it("hides the Windows console for every guest-agent host spawn", () => {
    for (const file of ["host.ts", "docker.ts", "ssh.ts", "tunnel.ts", "keys.ts"]) {
      const src = readFileSync(join(here, file), "utf8");
      expect(src, file).toContain("windowsHide: true");
    }
  });
});

describe("hostSpawnErrorOutput", () => {
  it("rewrites spawn sh ENOENT into a host-shell hint", () => {
    const err = Object.assign(new Error("spawn sh ENOENT"), { code: "ENOENT" });
    expect(hostSpawnErrorOutput(err, "sh", "/tmp/proj")).toMatch(/POSIX shell/);
    expect(hostSpawnErrorOutput(err, "sh", "/tmp/proj")).toContain("/tmp/proj");
    expect(hostSpawnErrorOutput(new Error("EACCES"), "/bin/sh", "/tmp/proj")).toBe("EACCES");
  });
});
