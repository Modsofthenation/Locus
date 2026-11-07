import { describe, expect, it } from "vitest";
import {
  SshGuestRuntime,
  scpGetArgv,
  scpPutArgv,
  sshArgv,
  waitForSsh,
  type SshExec,
} from "./ssh.js";

describe("sshArgv", () => {
  it("includes BatchMode and -i when an identity file is set", () => {
    const argv = sshArgv(
      { host: "127.0.0.1", port: 2200, username: "locus", identityFile: "/tmp/id_ed25519" },
      "true",
    );
    expect(argv).toContain("BatchMode=yes");
    expect(argv).toContain("IdentitiesOnly=yes");
    expect(argv).toContain("-i");
    expect(argv).toContain("/tmp/id_ed25519");
    expect(argv).toContain("locus@127.0.0.1");
  });

  it("builds scp put and get argv with the SSH port flag", () => {
    const target = { host: "127.0.0.1", port: 2201, username: "locus", identityFile: "/tmp/id" };
    const put = scpPutArgv(target, "/data/share/a.txt", "C:/host/a.txt");
    expect(put[0]).toBe("scp");
    expect(put).toContain("-P");
    expect(put).toContain("2201");
    expect(put).toContain("/data/share/a.txt");
    expect(put.at(-1)).toBe("locus@127.0.0.1:C:/host/a.txt");
    const get = scpGetArgv(target, "C:/host/a.txt", "/data/share/a.txt");
    expect(get.at(-2)).toBe("locus@127.0.0.1:C:/host/a.txt");
    expect(get.at(-1)).toBe("/data/share/a.txt");
  });
});

describe("SshGuestRuntime", () => {
  it("passes -i to ssh when identityFile is set", async () => {
    let captured: string[] = [];
    const exec: SshExec = async (argv) => {
      captured = argv;
      return { code: 0, stdout: "ok", stderr: "" };
    };
    const runtime = new SshGuestRuntime(
      "ubuntu",
      { host: "127.0.0.1", port: 2200, username: "locus", identityFile: "/data/ssh/id_ed25519" },
      exec,
    );
    const result = await runtime.execute({ name: "exec", args: { command: "uname -a" } });
    expect(result.ok).toBe(true);
    expect(captured).toContain("-i");
    expect(captured).toContain("/data/ssh/id_ed25519");
    expect(captured.at(-1)).toBe("uname -a");
  });

  it("forwards git clone stderr to onOutput", async () => {
    const chunks: string[] = [];
    const runtime = new SshGuestRuntime(
      "ubuntu",
      { host: "127.0.0.1", port: 2200, username: "locus" },
      async (_argv, _signal, _stdin, onOutput) => {
        onOutput?.("Receiving objects:  45% (90/200)\r");
        return { code: 0, stdout: "", stderr: "Receiving objects:  45% (90/200)\r" };
      },
    );
    const cloned = await runtime.execute(
      { name: "git_clone", args: { url: "https://github.com/acme/app.git", dest: "/workspace" } },
      undefined,
      (chunk) => chunks.push(chunk),
    );
    expect(cloned.ok).toBe(true);
    expect(chunks.join("")).toContain("Receiving objects:  45%");
  });

  it("sends Windows commands as EncodedCommand", async () => {
    let remote = "";
    const runtime = new SshGuestRuntime(
      "windows-11",
      { host: "127.0.0.1", port: 2201, username: "locus" },
      async (argv) => {
        remote = argv.at(-1) ?? "";
        return { code: 0, stdout: "ok", stderr: "" };
      },
    );
    await runtime.execute({ name: "exec", args: { command: "hostname" } });
    expect(remote).toContain("-EncodedCommand");
    const b64 = remote.split(" ").at(-1)!;
    expect(Buffer.from(b64, "base64").toString("utf16le")).toContain("hostname");
  });

  it("parses a saved recording from guest stdout", async () => {
    const runtime = new SshGuestRuntime(
      "ubuntu",
      { host: "127.0.0.1", port: 2200, username: "locus" },
      async () => ({
        code: 0,
        stdout: "LOCUS_RECORDING:/tmp/locus-recordings/demo.mp4\nrecording saved: demo.mp4\n",
        stderr: "",
      }),
    );
    const result = await runtime.execute({
      name: "record_screen",
      args: { mode: "SAVE_RECORDING", save_as_filename: "demo" },
    });
    expect(result.ok).toBe(true);
    expect(result.recordingName).toBe("demo.mp4");
    expect(result.recordingGuestPath).toBe("/tmp/locus-recordings/demo.mp4");
    expect(result.output).toBe("recording saved: demo.mp4");
    expect(result.output).not.toContain("LOCUS_RECORDING");
  });

  it("applies a unified diff over SSH without git apply", async () => {
    const files = new Map([["/home/locus/workspace/index.js", "export default 1;\n"]]);
    const calls: string[] = [];
    const runtime = new SshGuestRuntime(
      "ubuntu",
      { host: "127.0.0.1", port: 2200, username: "locus" },
      mockGuestFs(files, calls),
    );
    const result = await runtime.execute({
      name: "apply_patch",
      args: {
        patch: [
          "--- a/index.js",
          "+++ b/index.js",
          "@@ -1 +1 @@",
          "-export default 1;",
          "+export default 2;",
          "",
        ].join("\n"),
      },
    });
    expect(result.ok, result.output).toBe(true);
    expect(result.output).toContain("updated");
    expect(files.get("/home/locus/workspace/index.js")).toBe("export default 2;\n");
    expect(calls.some((c) => c.includes("git apply") || c.includes("patch -d"))).toBe(false);
    expect(calls.some((c) => c.includes("printf %s"))).toBe(false);
    expect(calls.some((c) => c.startsWith("cat > "))).toBe(true);
  });

  it("treats an extensionless path as a file when test -f succeeds", async () => {
    const files = new Map([["/home/locus/workspace/Makefile", "all:\n\techo hi\n"]]);
    const calls: string[] = [];
    const runtime = new SshGuestRuntime(
      "ubuntu",
      { host: "127.0.0.1", port: 2200, username: "locus" },
      mockGuestFs(files, calls),
    );
    const result = await runtime.execute({
      name: "apply_patch",
      args: {
        path: "/home/locus/workspace/Makefile",
        patch: [
          "--- a/Makefile",
          "+++ b/Makefile",
          "@@ -1,2 +1,2 @@",
          " all:",
          "-\techo hi",
          "+\techo ok",
          "",
        ].join("\n"),
      },
    });
    expect(result.ok, result.output).toBe(true);
    expect(files.get("/home/locus/workspace/Makefile")).toBe("all:\n\techo ok\n");
    expect(files.has("/home/locus/workspace/Makefile/Makefile")).toBe(false);
    expect(calls.some((c) => c.startsWith("test -f -- "))).toBe(true);
  });

  it("adds and deletes files over SSH without putting bodies on argv", async () => {
    const files = new Map([
      ["/home/locus/workspace/a.ts", "one\ntwo\nthree\n"],
      ["/home/locus/workspace/gone.ts", "bye\n"],
    ]);
    const calls: string[] = [];
    const runtime = new SshGuestRuntime(
      "ubuntu",
      { host: "127.0.0.1", port: 2200, username: "locus" },
      mockGuestFs(files, calls),
    );
    const result = await runtime.execute({
      name: "apply_patch",
      args: {
        patch: [
          "diff --git a/a.ts b/a.ts",
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,3 +1,3 @@",
          " one",
          "-two",
          "+TWO",
          " three",
          "diff --git a/new.ts b/new.ts",
          "new file mode 100644",
          "--- /dev/null",
          "+++ b/new.ts",
          "@@ -0,0 +1,2 @@",
          "+hello",
          "+world",
          "diff --git a/gone.ts b/gone.ts",
          "--- a/gone.ts",
          "+++ /dev/null",
          "@@ -1 +0,0 @@",
          "-bye",
        ].join("\n"),
      },
    });
    expect(result.ok, result.output).toBe(true);
    expect(files.get("/home/locus/workspace/a.ts")).toBe("one\nTWO\nthree\n");
    expect(files.get("/home/locus/workspace/new.ts")).toBe("hello\nworld\n");
    expect(files.has("/home/locus/workspace/gone.ts")).toBe(false);
    expect(calls.some((c) => c.includes("printf %s"))).toBe(false);
    expect(calls.filter((c) => c.startsWith("cat > ")).every((c) => !c.includes("hello"))).toBe(
      true,
    );
  });

  it("returns a hunk mismatch instead of guest patch(1) noise", async () => {
    const files = new Map([["/home/locus/workspace/index.js", "export default 1;\n"]]);
    const calls: string[] = [];
    const runtime = new SshGuestRuntime(
      "ubuntu",
      { host: "127.0.0.1", port: 2200, username: "locus" },
      mockGuestFs(files, calls),
    );
    const result = await runtime.execute({
      name: "apply_patch",
      args: {
        path: "/home/locus/workspace",
        patch: [
          "--- a/index.js",
          "+++ b/index.js",
          "@@ -1,3 +1,3 @@",
          " export default 1;",
          "-this line is not in the file",
          "+export default 2;",
          "",
        ].join("\n"),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.output).not.toContain("can't find file to patch");
    expect(result.output.toLowerCase()).toMatch(/hunk|context|mismatch|failed|not found/);
    expect(files.get("/home/locus/workspace/index.js")).toBe("export default 1;\n");
    expect(calls.some((c) => c.includes("git apply") || c.includes("patch -d"))).toBe(false);
  });
});

function unquote(quoted: string): string {
  const trimmed = quoted.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/'\\''/g, "'");
  }
  return trimmed;
}

function mockGuestFs(files: Map<string, string>, calls: string[]): SshExec {
  return async (argv, _signal, stdin) => {
    const remote = argv.at(-1) ?? "";
    calls.push(remote);
    if (remote.startsWith("test -f -- ")) {
      const path = unquote(remote.slice("test -f -- ".length));
      return { code: files.has(path) ? 0 : 1, stdout: "", stderr: "" };
    }
    if (remote.startsWith("cat -- ")) {
      const path = unquote(remote.slice("cat -- ".length));
      const content = files.get(path);
      if (content === undefined) return { code: 1, stdout: "", stderr: "No such file" };
      return { code: 0, stdout: content, stderr: "" };
    }
    if (remote.startsWith("mkdir -p -- ")) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (remote.startsWith("cat > ")) {
      const path = unquote(remote.slice("cat > ".length));
      files.set(path, stdin ?? "");
      return { code: 0, stdout: "", stderr: "" };
    }
    if (remote.startsWith("rm -f -- ")) {
      files.delete(unquote(remote.slice("rm -f -- ".length)));
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: `unhandled ${remote}` };
  };
}

describe("waitForSsh", () => {
  it("retries until the ready token appears", async () => {
    let n = 0;
    const exec: SshExec = async () => {
      n += 1;
      if (n < 3) return { code: 255, stdout: "", stderr: "Connection refused" };
      return { code: 0, stdout: "LOCUS_READY\n", stderr: "" };
    };
    const ok = await waitForSsh(
      { host: "127.0.0.1", port: 2200, username: "locus", identityFile: "/tmp/id" },
      { timeoutMs: 2000, intervalMs: 1, exec },
    );
    expect(ok).toBe(true);
    expect(n).toBe(3);
  });

  it("returns false when aborted", async () => {
    const signal = AbortSignal.abort();
    const ok = await waitForSsh(
      { host: "127.0.0.1", port: 2200, username: "locus" },
      {
        timeoutMs: 2000,
        intervalMs: 50,
        signal,
        exec: async () => ({ code: 1, stdout: "", stderr: "refused" }),
      },
    );
    expect(ok).toBe(false);
  });

  it("kills an in-flight probe when aborted", async () => {
    const ac = new AbortController();
    let sawSignal = false;
    const exec: SshExec = (_argv, signal) =>
      new Promise((resolve) => {
        const timer = setTimeout(
          () => resolve({ code: 0, stdout: "LOCUS_READY", stderr: "" }),
          5000,
        );
        signal?.addEventListener("abort", () => {
          sawSignal = true;
          clearTimeout(timer);
          resolve({ code: 1, stdout: "", stderr: "aborted" });
        });
      });
    const pending = waitForSsh(
      { host: "127.0.0.1", port: 2200, username: "locus" },
      { timeoutMs: 8000, intervalMs: 1, signal: ac.signal, exec },
    );
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    expect(await pending).toBe(false);
    expect(sawSignal).toBe(true);
  });
});
