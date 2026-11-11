import { execFileSync, execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commandFor,
  isSupported,
  decorateRemoteToolResult,
  parseRecordScreenResult,
  RECORDING_MARKER,
  windowsCommand,
} from "./commands.js";
import { authenticatedCloneUrl, gitAuthHeader } from "./git.js";
import { MockGuestRuntime } from "./mock.js";
import { HostGuestRuntime, hostCommand } from "./host.js";

describe("MockGuestRuntime", () => {
  it("clones a repo into the in-guest workspace", async () => {
    const guest = new MockGuestRuntime("ubuntu");
    const result = await guest.execute({
      name: "git_clone",
      args: { url: "https://github.com/acme/app.git", dest: "/home/locus/workspace/app" },
    });
    expect(result.ok).toBe(true);
    const read = await guest.execute({
      name: "file_read",
      args: { path: "/home/locus/workspace/app/README.md" },
    });
    expect(read.output).toContain("github.com/acme/app.git");
  });

  it("forwards git clone progress to onOutput", async () => {
    const guest = new MockGuestRuntime("ubuntu");
    const chunks: string[] = [];
    const result = await guest.execute(
      { name: "git_clone", args: { url: "https://github.com/acme/app.git", dest: "/workspace" } },
      undefined,
      (chunk) => chunks.push(chunk),
    );
    expect(result.ok).toBe(true);
    expect(chunks.join("")).toContain("Receiving objects:  45%");
    expect(chunks.join("")).toContain("Resolving deltas:  97%");
  });

  it("keeps powershell Windows-only", () => {
    expect(isSupported("ubuntu", "powershell")).toBe(false);
    expect(isSupported("debian", "powershell")).toBe(false);
    expect(isSupported("omarchy", "powershell")).toBe(false);
    expect(isSupported("windows-10", "powershell")).toBe(true);
    expect(isSupported("windows-11", "powershell")).toBe(true);
    expect(isSupported("ubuntu", "a11y_tree")).toBe(true);
    expect(isSupported("windows-11", "a11y_tree")).toBe(false);
    expect(isSupported("ubuntu", "uia_tree")).toBe(false);
    expect(isSupported("windows-11", "uia_tree")).toBe(true);
    expect(isSupported("ubuntu", "browser_tabs")).toBe(true);
    expect(isSupported("windows-11", "browser_tabs")).toBe(false);
    expect(isSupported("ubuntu", "browser_snapshot")).toBe(true);
    expect(isSupported("ubuntu", "browser_click")).toBe(true);
    expect(isSupported("windows-11", "browser_snapshot")).toBe(false);
  });

  it("does not execute Forge PR tools on the Guest", async () => {
    expect(commandFor("ubuntu", { name: "git_pr", args: {} })).toContain("unsupported:git_pr");
    expect(commandFor("windows-11", { name: "git_pr_merge", args: {} })).toContain(
      "unsupported:git_pr_merge",
    );
    const guest = new MockGuestRuntime("ubuntu");
    const result = await guest.execute({ name: "git_pr", args: {} });
    expect(result.ok).toBe(false);
    expect(result.output).toBe("unknown tool git_pr");
  });

  it("tracks start/save/discard on the mock guest", async () => {
    const guest = new MockGuestRuntime("ubuntu");
    expect(
      (await guest.execute({ name: "record_screen", args: { mode: "SAVE_RECORDING" } })).ok,
    ).toBe(false);
    expect(
      (await guest.execute({ name: "record_screen", args: { mode: "START_RECORDING" } })).output,
    ).toBe("recording started");
    expect(
      (await guest.execute({ name: "record_screen", args: { mode: "START_RECORDING" } })).ok,
    ).toBe(false);
    const saved = await guest.execute({
      name: "record_screen",
      args: { mode: "SAVE_RECORDING", save_as_filename: "settings_theme" },
    });
    expect(saved.ok).toBe(true);
    expect(saved.recordingName).toBe("settings_theme.mp4");
    const pdf = await guest.execute({ name: "browser_pdf", args: { save_as_filename: "invoice" } });
    expect(pdf.artifactName).toBe("invoice.pdf");
    await guest.execute({ name: "browser_trace", args: { action: "start" } });
    const trace = await guest.execute({ name: "browser_trace", args: { action: "stop" } });
    expect(trace.artifactName).toBe("trace.json");
    const download = await guest.execute({ name: "browser_download", args: { action: "latest" } });
    expect(download.artifactName).toBe("report.csv");
    const snap = await guest.execute({ name: "browser_snapshot", args: {} });
    expect(snap.output).toContain('@e1 button "Submit"');
    expect((await guest.execute({ name: "browser_click", args: { ref: "@e1" } })).ok).toBe(true);
    expect((await guest.execute({ name: "browser_click", args: { ref: "@e9" } })).ok).toBe(false);
    expect(
      (await guest.execute({ name: "browser_navigate", args: { url: "https://example.com" } }))
        .output,
    ).toBe("opened https://example.com");
    const again = new MockGuestRuntime("windows-10");
    await again.execute({ name: "record_screen", args: { mode: "START_RECORDING" } });
    expect(
      (await again.execute({ name: "record_screen", args: { mode: "DISCARD_RECORDING" } })).output,
    ).toBe("recording discarded");
    expect(again.recording).toBe(false);
  });

  it("echoes exec cwd and timeout on the mock guest", async () => {
    const guest = new MockGuestRuntime("ubuntu");
    const result = await guest.execute({
      name: "exec",
      args: { command: "pwd", cwd: "/tmp", timeout_ms: 2000 },
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("pwd");
    expect(result.output).toContain("cwd=/tmp");
    expect(result.output).toContain("timeout_ms=2000");
    const scroll = await guest.execute({ name: "mouse_scroll", args: { delta: -1, x: 3, y: 4 } });
    expect(scroll.ok).toBe(true);
    expect(scroll.output).toContain("mouse_scroll");
  });

  it("slices file_read and searches files on the mock guest", async () => {
    const guest = new MockGuestRuntime("ubuntu");
    await guest.execute({
      name: "file_write",
      args: { path: "/home/locus/workspace/a.ts", content: "one\ntwo\nthree" },
    });
    const sliced = await guest.execute({
      name: "file_read",
      args: { path: "/home/locus/workspace/a.ts", offset: 2, limit: 1 },
    });
    expect(sliced.output).toBe("two");
    const grep = await guest.execute({
      name: "grep",
      args: { pattern: "two", path: "/home/locus/workspace" },
    });
    expect(grep.output).toContain("a.ts:2:two");
    expect(grep.output).toContain("a.ts-1-one");
    expect(grep.output).toContain("a.ts-3-three");
    const grepExact = await guest.execute({
      name: "grep",
      args: { pattern: "two", path: "/home/locus/workspace", context: 0 },
    });
    expect(grepExact.output).toBe("/home/locus/workspace/a.ts:2:two");
    await guest.execute({
      name: "file_write",
      args: { path: "/home/locus/workspace/node_modules/pkg/x.ts", content: "two in vendor" },
    });
    const grepIgnored = await guest.execute({
      name: "grep",
      args: { pattern: "two", path: "/home/locus/workspace", context: 0 },
    });
    expect(grepIgnored.output).toBe("/home/locus/workspace/a.ts:2:two");
    expect(grepIgnored.output).not.toContain("node_modules");
    const relative = await guest.execute({
      name: "file_read",
      args: { path: "a.ts" },
    });
    expect(relative.ok).toBe(true);
    expect(relative.output).toBe("one\ntwo\nthree");
    const patch = await guest.execute({
      name: "apply_patch",
      args: {
        patch: [
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,3 +1,3 @@",
          " one",
          "-two",
          "+TWO",
          " three",
        ].join("\n"),
      },
    });
    expect(patch.ok).toBe(true);
    const after = await guest.execute({
      name: "file_read",
      args: { path: "/home/locus/workspace/a.ts" },
    });
    expect(after.output).toBe("one\nTWO\nthree");
    const again = await guest.execute({
      name: "apply_patch",
      args: {
        path: "/home/locus/workspace/a.ts",
        patch: [
          "--- a/a.ts",
          "+++ b/a.ts",
          "@@ -1,3 +1,3 @@",
          " one",
          "-TWO",
          "+two",
          " three",
        ].join("\n"),
      },
    });
    expect(again.ok, again.output).toBe(true);
    const restored = await guest.execute({
      name: "file_read",
      args: { path: "/home/locus/workspace/a.ts" },
    });
    expect(restored.output).toBe("one\ntwo\nthree");
    await guest.execute({
      name: "file_write",
      args: { path: "/home/locus/workspace/b.ts", content: "beta" },
    });
    const batched = await guest.execute({
      name: "file_read",
      args: { paths: ["/home/locus/workspace/a.ts", "/home/locus/workspace/b.ts"] },
    });
    expect(batched.output).toContain("=== /home/locus/workspace/a.ts ===");
    expect(batched.output).toContain("one\ntwo\nthree");
    expect(batched.output).toContain("beta");
    const diff = await guest.execute({ name: "git_diff", args: {} });
    expect(diff.output).toContain("diff --git");
  });

  it("persists docker git_clone onto the host bind mount", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-guest-clone-"));
    try {
      const guest = new MockGuestRuntime("ubuntu", { cwd: "/workspace", root: dir });
      const cloned = await guest.execute({
        name: "git_clone",
        args: { url: "https://github.com/acme/app.git", dest: "/workspace" },
      });
      expect(cloned.ok).toBe(true);
      expect(await readFile(join(dir, "README.md"), "utf8")).toContain("github.com/acme/app.git");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists docker workspace writes onto the host bind mount", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-guest-"));
    try {
      const guest = new MockGuestRuntime("ubuntu", { cwd: "/workspace", root: dir });
      await guest.execute({
        name: "file_write",
        args: { path: "/workspace/index.html", content: "<html><body>Hi</body></html>" },
      });
      expect(await readFile(join(dir, "index.html"), "utf8")).toContain("Hi");
      const escape = await guest.execute({
        name: "file_write",
        args: { path: "/workspace/../passwd", content: "nope" },
      });
      expect(escape.ok).toBe(false);
      await expect(readFile(join(dir, "passwd"), "utf8")).rejects.toThrow();
      await expect(readFile(join(dir, "index.html"), "utf8")).resolves.toContain("Hi");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "refuses mock persist through file and directory symlinks",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-guest-"));
      const outside = await mkdtemp(join(tmpdir(), "locus-guest-out-"));
      try {
        await writeFile(join(outside, "secret"), "outside");
        await symlink(join(outside, "secret"), join(dir, "link"));
        await symlink(outside, join(dir, "out"));
        const guest = new MockGuestRuntime("ubuntu", { cwd: "/workspace", root: dir });
        const fileLink = await guest.execute({
          name: "file_write",
          args: { path: "/workspace/link", content: "pwn" },
        });
        expect(fileLink.ok).toBe(false);
        expect(await readFile(join(outside, "secret"), "utf8")).toBe("outside");
        const dirLink = await guest.execute({
          name: "file_write",
          args: { path: "/workspace/out/secret", content: "pwn" },
        });
        expect(dirLink.ok).toBe(false);
        expect(await readFile(join(outside, "secret"), "utf8")).toBe("outside");
        expect(guest.files.has("/workspace/link")).toBe(false);
        expect(guest.files.has("/workspace/out/secret")).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    },
  );
});

describe("commandFor", () => {
  it("uses xdotool on Ubuntu and SendKeys on Windows", () => {
    const linuxKey = commandFor("ubuntu", { name: "key", args: { key: "ctrl+c" } });
    expect(linuxKey).toContain("xdotool");
    expect(linuxKey).toContain("DISPLAY=");
    expect(linuxKey).toContain("WAYLAND_DISPLAY=");
    expect(linuxKey).toContain("XAUTHORITY");
    expect(linuxKey).toContain("gdm/Xauthority");
    expect(commandFor("debian", { name: "clipboard_get", args: {} })).toContain("xclip");
    expect(commandFor("debian", { name: "key", args: { key: "ctrl+c" } })).toContain("xdotool");
    expect(commandFor("omarchy", { name: "screenshot", args: {} })).toContain("grim");
    expect(commandFor("windows-10", { name: "key", args: { key: "^c" } })).toContain("SendKeys");
    expect(commandFor("windows-11", { name: "mouse_click", args: { button: 1 } })).toContain(
      "mouse_event",
    );
    expect(
      commandFor("windows-11", { name: "window_focus", args: { title: "Notepad" } }),
    ).toContain("AppActivate");
  });

  it("moves to click coordinates, repeats clicks, and scrolls the wheel", () => {
    const linuxClick = commandFor("ubuntu", {
      name: "mouse_click",
      args: { button: 1, x: 40, y: 80, count: 2 },
    });
    expect(linuxClick).toContain("mousemove 40 80");
    expect(linuxClick).toContain("click --repeat 2 1");
    const linuxDrag = commandFor("debian", {
      name: "mouse_drag",
      args: { x1: 1, y1: 2, x2: 30, y2: 40 },
    });
    expect(linuxDrag).toContain("mousemove 1 2");
    expect(linuxDrag).toContain("mousemove 30 40");
    const linuxScroll = commandFor("ubuntu", {
      name: "mouse_scroll",
      args: { x: 10, y: 20, delta: -3 },
    });
    expect(linuxScroll).toContain("mousemove 10 20");
    expect(linuxScroll).toContain("click --repeat 3 5");
    const winClick = commandFor("windows-11", {
      name: "mouse_click",
      args: { button: 1, x: 5, y: 6, count: 2 },
    });
    expect(winClick).toContain("Drawing.Point 5,6");
    expect(winClick).toContain("1..2");
    const winScroll = commandFor("windows-10", {
      name: "mouse_scroll",
      args: { delta: 2, axis: "vertical" },
    });
    expect(winScroll).toContain("mouse_event");
    expect(winScroll).toContain("240");
  });

  it("wraps exec with cwd and timeout and dumps OS accessibility trees", () => {
    const linux = commandFor("ubuntu", {
      name: "exec",
      args: { command: "npm test", cwd: "/home/locus/workspace", timeout_ms: 1500 },
    });
    expect(linux).toContain("timeout --kill-after=2s 2s");
    expect(linux).toContain("cd --");
    expect(linux).toContain("/home/locus/workspace");
    expect(linux).toContain("npm test");
    const batched = commandFor("ubuntu", {
      name: "exec",
      args: { commands: ["git show a", "git grep foo"], cwd: "/workspace" },
    });
    expect(batched).toContain("set +e");
    expect(batched).toContain("=== 1: git show a ===");
    expect(batched).toContain("=== 2: git grep foo ===");
    expect(batched).toContain("git show a");
    expect(batched).toContain("git grep foo");
    expect(batched).toContain("sh -c");
    const win = commandFor("windows-11", {
      name: "exec",
      args: { command: "dir", cwd: "C:\\Users\\locus\\workspace", timeout_ms: 5000 },
    });
    expect(win).toContain("Start-Job");
    expect(win).toContain("Wait-Job");
    expect(win).toContain("C:\\Users\\locus\\workspace");
    const a11y = commandFor("ubuntu", { name: "a11y_tree", args: { title: "Terminal" } });
    expect(a11y).toContain("wmctrl -lG");
    expect(a11y).toContain("wmctrl -lx");
    expect(a11y).toContain("getwindowfocus");
    expect(a11y).toContain("Terminal");
    const uia = commandFor("windows-11", { name: "uia_tree", args: { title: "Notepad" } });
    expect(uia).toContain("UIAutomationClient");
    expect(uia).toContain("TreeWalker");
    expect(uia).toContain("Notepad");
    expect(uia).not.toContain("Get-Process");
    expect(
      commandFor("ubuntu", {
        name: "file_read",
        args: { path: "/tmp/a.ts", offset: 2, limit: 10 },
      }),
    ).toContain("sed -n '2,11p'");
    expect(
      commandFor("ubuntu", {
        name: "grep",
        args: { pattern: "TODO", path: "/home/locus/workspace" },
      }),
    ).toContain("-C 3");
    const linuxGrep = commandFor("ubuntu", {
      name: "grep",
      args: { pattern: "two", path: "/home/locus/workspace" },
    });
    expect(linuxGrep).toContain("command -v rg");
    expect(linuxGrep).toContain("rg -n --hidden");
    expect(linuxGrep).toContain("-e");
    expect(linuxGrep).toContain("grep -R -n -E");
    expect(linuxGrep).toContain("!.locus-chrome/**");
    expect(linuxGrep).toContain("!.*/**");
    expect(linuxGrep).not.toContain(".github/**");
    const linuxGlob = commandFor("ubuntu", {
      name: "glob",
      args: { pattern: "**/*.ts", path: "/workspace" },
    });
    expect(linuxGlob).toContain("rg --files");
    expect(linuxGlob).toContain("-g");
    expect(linuxGlob).toContain("command -v rg");
    expect(linuxGlob).toContain("!.locus-chrome/**");
    const winGrep = commandFor("windows-11", {
      name: "grep",
      args: { pattern: "TODO", path: "C:\\Users\\locus\\workspace" },
    });
    expect(winGrep).toContain("Get-Command rg");
    expect(winGrep).toContain("Select-String");
    expect(
      commandFor("ubuntu", {
        name: "file_read",
        args: { paths: ["/tmp/a.ts", "/tmp/b.ts"] },
      }),
    ).toContain("=== 1:");
    expect(commandFor("ubuntu", { name: "git_diff", args: { staged: true } })).toContain(
      "--cached",
    );
    expect(
      commandFor("ubuntu", { name: "git_diff", args: { path: "/workspace/src/a.ts" } }),
    ).toContain("dirname");
    expect(
      commandFor("ubuntu", { name: "exec", args: { command: "git commit -m wip" } }),
    ).toContain("GIT_AUTHOR_NAME");
    const apply = commandFor("ubuntu", {
      name: "apply_patch",
      args: { patch: "--- a/x\n+++ b/x\n" },
    });
    expect(apply).toContain("git -C");
    expect(apply).toContain("mktemp");
    expect(apply).toContain("patch -d");
    const applyFile = commandFor("ubuntu", {
      name: "apply_patch",
      args: { patch: "--- a/x\n+++ b/x\n", path: "/workspace/index.html" },
    });
    expect(applyFile).toContain('git -C "$d"');
    expect(applyFile).toContain("'/workspace'");
    expect(applyFile).not.toContain("'/workspace/index.html'");
    expect(
      commandFor("windows-11", { name: "apply_patch", args: { patch: "--- a/x\n+++ b/x\n" } }),
    ).toContain("-p0");
  });

  it.skipIf(process.platform === "win32")(
    "keeps a heredoc delimiter off the commands[] batch footer",
    () => {
      const script = commandFor("ubuntu", {
        name: "exec",
        args: {
          commands: ["cat <<'EOF'\nhello-from-heredoc\nEOF", "echo second"],
          cwd: "/tmp",
        },
      });
      expect(script).toContain("sh -c");
      expect(script).not.toMatch(/EOF; printf/);
      const out = execSync(script, { encoding: "utf8", shell: "/bin/bash" });
      expect(out).toContain("hello-from-heredoc");
      expect(out).toContain("second");
      expect(out).toMatch(/\(exit 0\)/);
    },
  );

  it("records the Linux X11 desktop and the Windows GDI desktop with ffmpeg", () => {
    const linuxStart = commandFor("ubuntu", {
      name: "record_screen",
      args: { mode: "START_RECORDING" },
    });
    expect(linuxStart).toContain("ffmpeg");
    expect(linuxStart).toContain("x11grab");
    expect(linuxStart).toContain("DISPLAY=");
    expect(linuxStart).toContain("nohup");
    const linuxSave = commandFor("debian", {
      name: "record_screen",
      args: { mode: "SAVE_RECORDING", save_as_filename: "../walk through" },
    });
    expect(linuxSave).toContain("/tmp/locus-recordings/walk_through.mp4");
    expect(linuxSave).toContain(RECORDING_MARKER);
    expect(linuxSave).not.toContain("..");
    const linuxDiscard = commandFor("ubuntu", {
      name: "record_screen",
      args: { mode: "DISCARD_RECORDING" },
    });
    expect(linuxDiscard).toContain("recording discarded");
    const winStart = commandFor("windows-11", {
      name: "record_screen",
      args: { mode: "START_RECORDING" },
    });
    expect(winStart).toContain("gdigrab");
    expect(winStart).toContain("ffmpeg");
    expect(winStart).toContain("Start-Process");
    const winSave = commandFor("windows-10", {
      name: "record_screen",
      args: { mode: "SAVE_RECORDING", save_as_filename: "login-flow" },
    });
    expect(winSave).toContain("login-flow.mp4");
    expect(winSave).toContain(RECORDING_MARKER);
    expect(commandFor("ubuntu", { name: "record_screen", args: { mode: "NOPE" } })).toContain(
      "unsupported record_screen mode",
    );
  });

  it("parses a guest recording marker", () => {
    expect(
      parseRecordScreenResult(`ok\n${RECORDING_MARKER}C:\\Temp\\locus-recordings\\demo.mp4\n`),
    ).toEqual({
      recordingGuestPath: "C:/Temp/locus-recordings/demo.mp4",
      recordingName: "demo.mp4",
    });
    expect(parseRecordScreenResult("recording started")).toEqual({});
    expect(
      decorateRemoteToolResult("screenshot", { code: 0, stdout: "a".repeat(81) }),
    ).toMatchObject({
      ok: true,
      output: "screenshot captured",
      screenshotBase64: "a".repeat(81),
    });
    expect(
      decorateRemoteToolResult("record_screen", {
        code: 0,
        stdout: `ok\n${RECORDING_MARKER}/tmp/demo.mp4`,
      }),
    ).toMatchObject({
      ok: true,
      recordingName: "demo.mp4",
    });
    expect(decorateRemoteToolResult("exec", { code: 1, stderr: "boom" })).toEqual({
      ok: false,
      output: "boom",
    });
  });

  it("clones a named ref with --branch instead of a post-clone checkout", () => {
    const linux = commandFor("ubuntu", {
      name: "git_clone",
      args: {
        url: "https://github.com/acme/app.git",
        dest: "/workspace",
        ref: "cursor/model-selector-cramped-d2c0",
      },
    });
    expect(linux).toContain(
      "clone --progress --depth 1 --branch 'cursor/model-selector-cramped-d2c0'",
    );
    expect(linux).toContain("rev-parse --verify HEAD");
    expect(linux).toContain("https://github.com/acme/app.git");
    expect(linux).not.toContain("checkout");
    const win = commandFor("windows-11", {
      name: "git_clone",
      args: {
        url: "https://github.com/acme/app.git",
        dest: "C:\\Users\\locus\\workspace",
        ref: "feat",
      },
    });
    expect(win).toContain("clone --progress --depth 1 --branch 'feat'");
    expect(win).toContain("rev-parse --verify HEAD");
    expect(win).toContain("GIT_PROGRESS_DELAY='0'");
    expect(win).not.toContain("checkout");
  });

  it.skipIf(process.platform === "win32")(
    "reuses dest when HEAD already exists instead of failing git clone",
    () => {
      const dest = mkdtempSync(join(tmpdir(), "locus-clone-reuse-"));
      try {
        const env = {
          ...process.env,
          GIT_AUTHOR_NAME: "Locus",
          GIT_AUTHOR_EMAIL: "locus@local",
          GIT_COMMITTER_NAME: "Locus",
          GIT_COMMITTER_EMAIL: "locus@local",
        };
        execFileSync("git", ["init", "-b", "main", dest], { stdio: "pipe" });
        writeFileSync(join(dest, "README.md"), "present\n");
        execFileSync("git", ["-C", dest, "add", "README.md"], { stdio: "pipe" });
        execFileSync(
          "git",
          [
            "-C",
            dest,
            "-c",
            "user.email=locus@local",
            "-c",
            "user.name=Locus",
            "commit",
            "-m",
            "init",
          ],
          { env, stdio: "pipe" },
        );
        const cmd = commandFor("ubuntu", {
          name: "git_clone",
          args: { url: "https://example.invalid/nope.git", dest },
        });
        expect(cmd).toContain("rev-parse --verify HEAD");
        const reused = spawnSync("/bin/sh", ["-lc", cmd], { encoding: "utf8" });
        expect(reused.status).toBe(0);
        expect(reused.stdout).toMatch(/already cloned at /);
        expect(readFileSync(join(dest, "README.md"), "utf8")).toBe("present\n");
      } finally {
        rmSync(dest, { recursive: true, force: true });
      }
    },
  );

  it("still clones into an empty destination", () => {
    const dest = mkdtempSync(join(tmpdir(), "locus-clone-empty-"));
    try {
      const cmd = commandFor("ubuntu", {
        name: "git_clone",
        args: { url: "https://example.invalid/nope.git", dest },
      });
      const result = spawnSync("/bin/sh", ["-lc", cmd], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/already cloned/);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it("clones into the OS workspace path", () => {
    expect(
      commandFor("ubuntu", { name: "git_clone", args: { url: "https://example.com/a.git" } }),
    ).toContain("/home/locus/workspace");
    expect(
      commandFor("debian", { name: "git_clone", args: { url: "https://example.com/a.git" } }),
    ).toContain("/home/locus/workspace");
    expect(
      commandFor("windows-11", { name: "git_clone", args: { url: "https://example.com/a.git" } }),
    ).toContain("C:\\Users\\locus\\workspace");
    expect(
      commandFor("windows-10", { name: "git_clone", args: { url: "https://example.com/a.git" } }),
    ).toContain("C:\\Users\\locus\\workspace");
  });

  it("fetches a remote ref instead of checking out a local pathspec", () => {
    const linux = commandFor("ubuntu", {
      name: "git_clone",
      args: {
        url: "https://github.com/acme/app.git",
        dest: "/workspace/app",
        ref: "cursor/model-selector-cramped-d2c0",
        pull_number: 165,
      },
    });
    expect(linux).toContain(
      "fetch --progress --depth 1 origin 'cursor/model-selector-cramped-d2c0'",
    );
    expect(linux).toContain("fetch --progress --depth 1 origin 'refs/pull/165/head'");
    expect(linux).toContain("checkout -B 'cursor/model-selector-cramped-d2c0' FETCH_HEAD");
    expect(linux).not.toMatch(/clone --progress --depth 1 .* && git -C .* checkout /);
    const gitlab = commandFor("ubuntu", {
      name: "git_clone",
      args: { url: "https://gitlab.com/acme/app.git", dest: "/workspace/app", pull_number: 12 },
    });
    expect(gitlab).toContain("refs/merge-requests/12/head");
    const githubPathLooksLikeGitlab = commandFor("ubuntu", {
      name: "git_clone",
      args: {
        url: "https://github.com/acme/gitlab-runner.git",
        dest: "/workspace/app",
        pull_number: 3,
      },
    });
    expect(githubPathLooksLikeGitlab).toContain("refs/pull/3/head");
    expect(githubPathLooksLikeGitlab).not.toContain("merge-requests/");
    const bitbucket = commandFor("ubuntu", {
      name: "git_clone",
      args: { url: "https://bitbucket.org/acme/app.git", dest: "/workspace/app", pull_number: 9 },
    });
    expect(bitbucket).toContain("refs/pull-requests/9/from");
    const win = commandFor("windows-11", {
      name: "git_clone",
      args: {
        url: "https://github.com/acme/app.git",
        dest: "C:\\Users\\locus\\workspace\\app",
        ref: "feat",
      },
    });
    expect(win).toContain("--branch 'feat'");
    expect(win).not.toContain("checkout 'feat'");
  });

  it.skipIf(process.platform === "win32")(
    "clones a remote PR branch that was never checked out locally",
    () => {
      const root = mkdtempSync(join(tmpdir(), "locus-clone-ref-"));
      try {
        const src = join(root, "src");
        const origin = join(root, "origin.git");
        const shallow = join(root, "host");
        const dest = join(root, "review");
        const env = {
          ...process.env,
          GIT_AUTHOR_NAME: "Locus",
          GIT_AUTHOR_EMAIL: "locus@local",
          GIT_COMMITTER_NAME: "Locus",
          GIT_COMMITTER_EMAIL: "locus@local",
        };
        mkdirSync(src);
        execFileSync("git", ["init", "-b", "main", src], { stdio: "pipe" });
        writeFileSync(join(src, "README.md"), "main\n");
        execFileSync("git", ["-C", src, "add", "README.md"], { stdio: "pipe" });
        execFileSync(
          "git",
          [
            "-C",
            src,
            "-c",
            "user.email=locus@local",
            "-c",
            "user.name=Locus",
            "commit",
            "-m",
            "main",
          ],
          {
            env,
            stdio: "pipe",
          },
        );
        execFileSync("git", ["-C", src, "checkout", "-b", "cursor/model-selector-cramped-d2c0"], {
          stdio: "pipe",
        });
        writeFileSync(join(src, "pr.txt"), "from-pr\n");
        execFileSync("git", ["-C", src, "add", "pr.txt"], { stdio: "pipe" });
        execFileSync(
          "git",
          [
            "-C",
            src,
            "-c",
            "user.email=locus@local",
            "-c",
            "user.name=Locus",
            "commit",
            "-m",
            "pr",
          ],
          {
            env,
            stdio: "pipe",
          },
        );
        execFileSync("git", ["-C", src, "update-ref", "refs/pull/165/head", "HEAD"], {
          stdio: "pipe",
        });
        execFileSync("git", ["-C", src, "checkout", "main"], { stdio: "pipe" });
        execFileSync("git", ["clone", "--bare", src, origin], { stdio: "pipe" });
        const prSha = execFileSync("git", ["-C", src, "rev-parse", "refs/pull/165/head"], {
          encoding: "utf8",
        }).trim();
        execFileSync("git", ["--git-dir", origin, "update-ref", "refs/pull/165/head", prSha], {
          stdio: "pipe",
        });
        execFileSync("git", ["clone", "--depth", "1", origin, shallow], { stdio: "pipe" });
        try {
          execFileSync("git", ["-C", shallow, "checkout", "cursor/model-selector-cramped-d2c0"], {
            stdio: "pipe",
          });
          throw new Error("expected missing local branch to fail");
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
          expect(String((err as { stderr?: Buffer }).stderr ?? err)).toMatch(
            /pathspec 'cursor\/model-selector-cramped-d2c0' did not match/,
          );
        }
        const cmd = commandFor("ubuntu", {
          name: "git_clone",
          args: { url: origin, dest, ref: "cursor/model-selector-cramped-d2c0", pull_number: 165 },
        });
        execSync(cmd, { stdio: "pipe", shell: "/bin/bash" });
        expect(readFileSync(join(dest, "pr.txt"), "utf8")).toBe("from-pr\n");
        expect(
          execFileSync("git", ["-C", dest, "rev-parse", "--abbrev-ref", "HEAD"], {
            encoding: "utf8",
          }).trim(),
        ).toBe("cursor/model-selector-cramped-d2c0");
        const destFork = join(root, "fork-review");
        execSync(
          commandFor("ubuntu", {
            name: "git_clone",
            args: { url: origin, dest: destFork, ref: "from-a-fork", pull_number: 165 },
          }),
          { stdio: "pipe", shell: "/bin/bash" },
        );
        expect(readFileSync(join(destFork, "pr.txt"), "utf8")).toBe("from-pr\n");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("commits, branches, and pushes in the guest workspace", () => {
    const linux = commandFor("ubuntu", {
      name: "git_commit",
      args: { path: "/home/locus/workspace", message: "feat: done" },
    });
    expect(linux).toContain("git -C");
    expect(linux).toContain("commit -m");
    expect(linux).toContain("feat: done");
    expect(commandFor("ubuntu", { name: "git_branch", args: { name: "cursor/work" } })).toContain(
      "checkout -B",
    );
    expect(commandFor("ubuntu", { name: "git_push", args: { token: "ghs_x" } })).toContain(
      "push -u origin HEAD",
    );
    expect(commandFor("ubuntu", { name: "git_stash", args: {} })).toContain("stash push");
    expect(commandFor("ubuntu", { name: "git_revert", args: { commit: "abc" } })).toContain(
      "revert",
    );
    const bitbucketPush = commandFor("ubuntu", {
      name: "git_push",
      args: { token: "bb_x", url: "https://bitbucket.org/acme/app.git" },
    });
    expect(bitbucketPush).toContain("credential.helper");
    expect(bitbucketPush).toContain("$GIT_TOKEN");
    expect(bitbucketPush).not.toContain("bb_x");
    expect(bitbucketPush).not.toContain("http.extraHeader");
    expect(commandFor("windows-11", { name: "git_commit", args: { message: "w" } })).toContain(
      "commit -m",
    );
  });
});

describe("windowsCommand injection", () => {
  it("encodes clipboard, file, patch, and start_process payloads as base64", () => {
    const payload = "'@\ncalc.exe\nhello";
    const clip = windowsCommand({ name: "clipboard_set", args: { text: payload } });
    expect(clip).toContain("FromBase64String");
    expect(clip).not.toContain(payload);
    const write = windowsCommand({
      name: "file_write",
      args: { path: "C:\\Users\\locus\\workspace\\a.txt", content: payload },
    });
    expect(write).toContain("FromBase64String");
    expect(write).not.toContain(payload);
    const start = windowsCommand({
      name: "start_process",
      args: { command: "calc.exe & notepad" },
    });
    expect(start).toContain("FromBase64String");
    expect(start).toContain("cmd.exe");
    expect(start).not.toContain("calc.exe & notepad");
    const status = windowsCommand({
      name: "git_status",
      args: { path: "C:\\Users\\locus\\workspace'; calc.exe; '" },
    });
    expect(status).toContain("''");
    expect(status).not.toMatch(/workspace'; calc/);
  });
});

describe("authenticatedCloneUrl", () => {
  it("authenticates GitHub and Bitbucket via env GIT_TOKEN, not argv or the URL", () => {
    expect(authenticatedCloneUrl("https://github.com/acme/app.git", "ghs_x")).toContain(
      "x-access-token:ghs_x@",
    );
    expect(authenticatedCloneUrl("https://github.com/acme/app.git", "gho_oauth")).toContain(
      "git:gho_oauth@",
    );
    expect(authenticatedCloneUrl("https://bitbucket.org/acme/app.git", "bb_x")).toContain(
      "x-token-auth:bb_x@",
    );
    expect(authenticatedCloneUrl("git@github.com:acme/app.git", "ghs_x")).toContain(
      "x-access-token:ghs_x@github.com/acme/app.git",
    );
    expect(gitAuthHeader("https://github.com/acme/app.git", "ghs_x")).toMatch(
      /^AUTHORIZATION: Basic /,
    );
    expect(gitAuthHeader("https://bitbucket.org/acme/app.git", "bb_x")).toMatch(
      /^AUTHORIZATION: Basic /,
    );
    const linux = commandFor("ubuntu", {
      name: "git_clone",
      args: {
        url: "https://github.com/acme/app.git",
        dest: "/home/locus/workspace/app",
        token: "ghs_x",
      },
    });
    expect(linux).not.toContain("http.extraHeader");
    expect(linux).toContain("credential.helper=");
    expect(linux).toContain("$GIT_TOKEN");
    expect(linux).not.toContain("ghs_x");
    expect(linux).toContain("GIT_CONFIG_GLOBAL=");
    expect(linux).toContain("GIT_CONFIG_NOSYSTEM=1");
    expect(linux).toContain("GCM_INTERACTIVE=Never");
    expect(linux).not.toContain("ghs_x@github");
    expect(linux).toContain("https://github.com/acme/app.git");
    const oauth = commandFor("ubuntu", {
      name: "git_clone",
      args: {
        url: "https://github.com/acme/app.git",
        dest: "/home/locus/workspace/app",
        token: "gho_oauth",
      },
    });
    expect(oauth).toContain("$GIT_TOKEN");
    expect(oauth).not.toContain("gho_oauth");
    expect(oauth).toContain("username=git");
    const patHeader = gitAuthHeader("https://github.com/acme/app.git", "ghp_classic")!;
    expect(Buffer.from(patHeader.slice("AUTHORIZATION: Basic ".length), "base64").toString()).toBe(
      "git:ghp_classic",
    );
    const appHeader = gitAuthHeader("https://github.com/acme/app.git", "ghs_x")!;
    expect(Buffer.from(appHeader.slice("AUTHORIZATION: Basic ".length), "base64").toString()).toBe(
      "x-access-token:ghs_x",
    );
  });

  it("does not isolate git config when cloning without a token", () => {
    const linux = commandFor("ubuntu", {
      name: "git_clone",
      args: { url: "https://github.com/acme/app.git", dest: "/workspace/app" },
    });
    expect(linux).not.toContain("http.extraHeader");
    expect(linux).not.toContain("GIT_CONFIG_GLOBAL=");
    expect(linux).toContain("GIT_TERMINAL_PROMPT=0");
  });

  it("clones SSH remotes over HTTPS when a token is set", () => {
    const linux = commandFor("ubuntu", {
      name: "git_clone",
      args: { url: "git@github.com:acme/app.git", dest: "/workspace/app", token: "ghs_x" },
    });
    expect(linux).toContain("https://github.com/acme/app.git");
    expect(linux).not.toContain("git@github.com");
    expect(linux).toContain("credential.helper=");
    expect(linux).toContain("$GIT_TOKEN");
    expect(linux).not.toContain("ghs_x");
    expect(linux).toContain("GIT_TERMINAL_PROMPT=0");
    expect(linux).toContain("GIT_PROGRESS_DELAY=0");
  });

  it("fetches a branch or pull request with the token", () => {
    const branch = commandFor("ubuntu", {
      name: "git_clone",
      args: {
        url: "https://github.com/acme/app.git",
        dest: "/workspace/app",
        ref: "feat/login",
        token: "ghs_x",
      },
    });
    expect(branch).toContain("--branch 'feat/login'");
    const pr = commandFor("ubuntu", {
      name: "git_clone",
      args: {
        url: "https://github.com/acme/app.git",
        dest: "/workspace/app",
        pull: 12,
        token: "ghs_x",
      },
    });
    expect(pr).toContain("refs/pull/12/head");
    expect(pr).toContain("checkout 'pr-12'");
    const gitlab = commandFor("ubuntu", {
      name: "git_fetch",
      args: {
        path: "/workspace",
        url: "https://gitlab.com/acme/api.git",
        pull: 4,
        token: "glpat_x",
      },
    });
    expect(gitlab).toContain("refs/merge-requests/4/head");
    expect(gitlab).toContain("credential.helper=");
    expect(gitlab).toContain("$GIT_TOKEN");
    expect(gitlab).not.toContain("glpat_x");
    const win = commandFor("windows-11", {
      name: "git_fetch",
      args: {
        path: "C:\\Users\\locus\\workspace",
        ref: "main",
        token: "ghs_x",
        url: "https://github.com/acme/app.git",
      },
    });
    expect(win).toContain("fetch --progress --depth 1 origin 'main'");
    expect(win).toContain("credential.helper=");
    expect(win).toContain("$GIT_TOKEN");
    expect(win).not.toContain("ghs_x");
    expect(win).toContain("GIT_CONFIG_GLOBAL");
    expect(win).toContain("GCM_INTERACTIVE");
  });

  it("quotes /workspace as a Git Bash path so backslashes survive sh -lc", () => {
    const root = "C:\\Users\\locus\\.locus\\host-workspaces\\b1349594-52a4-47a5-8c4f-9bb51c8f9257";
    const posix = "/c/Users/locus/.locus/host-workspaces/b1349594-52a4-47a5-8c4f-9bb51c8f9257";
    const listed = hostCommand({ name: "exec", args: { command: "ls -la /workspace" } }, root);
    expect(listed).toContain(`ls -la '${posix}'`);
    expect(listed).not.toContain("\\");
    const cd = hostCommand(
      { name: "exec", args: { command: "cd /workspace && grep -n x js/engine.js" } },
      root,
    );
    expect(cd).toContain(`cd '${posix}' && grep -n x js/engine.js`);
    const nested = hostCommand(
      { name: "exec", args: { command: "cd /workspace/js && ls" } },
      "C:\\Users\\me\\ws",
    );
    expect(nested).toContain("cd '/c/Users/me/ws/js' && ls");
    const spaced = hostCommand(
      { name: "exec", args: { command: 'cd "/workspace/my files"' } },
      "C:\\Users\\locus smith\\ws",
    );
    expect(spaced).toContain('cd "/c/Users/locus smith/ws/my files"');
    const untouched = hostCommand(
      { name: "exec", args: { command: "echo /workspacefoo /workspace" } },
      "/tmp/host-ws",
    );
    expect(untouched).toContain("echo /workspacefoo '/tmp/host-ws'");
    const grep = hostCommand({ name: "grep", args: { pattern: "TODO", path: "/workspace" } }, root);
    expect(grep).toContain(`'${posix}'`);
    expect(grep).not.toMatch(/C:[\\/]Users/);
  });

  it("honors numeric-string file_read offset and limit", () => {
    const cmd = commandFor("ubuntu", {
      name: "file_read",
      args: { path: "/workspace/js/engine.js", offset: "325", limit: "40" },
    });
    expect(cmd).toContain("sed -n '325,364p'");
  });

  it("rewrites /workspace dest and keeps the forge token on host clone", () => {
    const cmd = hostCommand(
      {
        name: "git_clone",
        args: {
          url: "https://github.com/acme/app.git",
          dest: "/workspace",
          token: "ghs_x",
        },
      },
      "/tmp/host-ws",
    );
    expect(cmd).toContain("/tmp/host-ws");
    expect(cmd).toContain("credential.helper=");
    expect(cmd).toContain("$GIT_TOKEN");
    expect(cmd).not.toContain("ghs_x");
    expect(cmd).toContain("GIT_CONFIG_GLOBAL='/dev/null'");
    expect(cmd).toContain("GCM_INTERACTIVE=Never");
  });

  it("ignores host url.insteadOf when a clone token isolates gitconfig", () => {
    const home = mkdtempSync(join(tmpdir(), "locus-git-iso-"));
    try {
      writeFileSync(
        join(home, ".gitconfig"),
        '[url "https://x-access-token:bad@github.com/"]\n\tinsteadOf = https://github.com/\n',
      );
      const seen = spawnSync("git", ["config", "--get-regexp", String.raw`url\..*\.insteadof`], {
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1" },
      });
      expect(seen.stdout).toMatch(/github\.com/);
      const isolated = spawnSync(
        "git",
        ["config", "--get-regexp", String.raw`url\..*\.insteadof`],
        {
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            HOME: home,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
          },
        },
      );
      expect(isolated.stdout.trim()).toBe("");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("DockerGuestRuntime", () => {
  it("execs into the container workspace and routes Chromium tools", async () => {
    const { DockerGuestRuntime, dockerCommand } = await import("./docker.js");
    const guest = new MockGuestRuntime("ubuntu", { cwd: "/workspace" });
    expect(guest.cwd).toBe("/workspace");
    const cloned = await guest.execute({
      name: "git_clone",
      args: { url: "https://github.com/acme/app.git" },
    });
    expect(cloned.output).toContain("/workspace/repo");

    expect(dockerCommand({ name: "git_status", args: {} })).toContain("/workspace");
    expect(dockerCommand({ name: "git_status", args: {} })).toContain(".locus-chrome");
    expect(dockerCommand({ name: "git_fetch", args: {} })).toContain("/workspace");
    expect(dockerCommand({ name: "start_process", args: { command: "sleep 1" } })).toContain(
      "nohup",
    );
    expect(dockerCommand({ name: "start_process", args: { command: "sleep 1" } })).toContain(
      "sh -c",
    );
    expect(dockerCommand({ name: "start_process", args: { command: "sleep 1" } })).not.toContain(
      "DISPLAY",
    );

    const calls: string[][] = [];
    const runtime = new DockerGuestRuntime(
      {
        id: "v1",
        sessionId: "s1",
        templateId: "docker",
        os: "ubuntu",
        name: "c",
        status: "running",
        diskPath: "",
        runtime: "docker",
        dockerImage: "ubuntu:24.04",
        containerId: "abc",
        createdAt: "",
        updatedAt: "",
      },
      async (argv) => {
        calls.push(argv);
        return { code: 0, stdout: "ok\n", stderr: "" };
      },
      {
        handle: async (req) => ({ ok: true, output: `${req.name} chromium` }),
        navigate: async (url) => ({ ok: true, output: `opened ${url}` }),
      },
    );
    const exec = await runtime.execute({ name: "exec", args: { command: "pwd" } });
    expect(exec.ok).toBe(true);
    expect(calls[0]).toEqual([
      "docker",
      "exec",
      "-w",
      "/workspace",
      "abc",
      "sh",
      "-lc",
      expect.any(String),
    ]);
    const shot = await runtime.execute({ name: "screenshot", args: {} });
    expect(shot.ok).toBe(true);
    expect(shot.output).toContain("chromium");
    const opened = await runtime.execute({
      name: "exec",
      args: { command: "https://example.com" },
    });
    expect(opened.ok).toBe(true);
    expect(opened.output).toContain("https://example.com");
    const record = await runtime.execute({
      name: "record_screen",
      args: { mode: "START_RECORDING" },
    });
    expect(record.ok).toBe(true);
    expect(calls.at(-1)?.join(" ")).toMatch(/ffmpeg|record/i);
  });

  it("applies a patch on the host workspace without git or patch in the image", async () => {
    const { DockerGuestRuntime, dockerCommand } = await import("./docker.js");
    const dir = await mkdtemp(join(tmpdir(), "locus-patch-"));
    await writeFile(join(dir, "index.html"), "<h1>old</h1>\n");
    const calls: string[][] = [];
    const runtime = new DockerGuestRuntime(
      {
        id: "v1",
        sessionId: "s1",
        templateId: "docker",
        os: "ubuntu",
        name: "c",
        status: "running",
        diskPath: dir,
        runtime: "docker",
        dockerImage: "ubuntu:24.04",
        containerId: "abc",
        createdAt: "",
        updatedAt: "",
      },
      async (argv) => {
        calls.push(argv);
        return { code: 1, stdout: "", stderr: "sh: 1: git: not found\n" };
      },
    );
    const patched = await runtime.execute({
      name: "apply_patch",
      args: {
        path: "/workspace/index.html",
        patch: [
          "--- a/index.html",
          "+++ b/index.html",
          "@@ -1 +1 @@",
          "-<h1>old</h1>",
          "+<h1>new</h1>",
          "",
        ].join("\n"),
      },
    });
    expect(patched.ok, patched.output).toBe(true);
    expect(patched.output).toContain("updated");
    expect(await readFile(join(dir, "index.html"), "utf8")).toBe("<h1>new</h1>\n");
    expect(calls).toEqual([]);
    expect(
      dockerCommand({
        name: "apply_patch",
        args: { patch: "--- a/x\n+++ b/x\n", path: "/workspace/index.html" },
      }),
    ).toContain("'/workspace'");
  });

  it("replaces a read-only bind-mount file without shelling out to git", async () => {
    const { DockerGuestRuntime } = await import("./docker.js");
    const dir = await mkdtemp(join(tmpdir(), "locus-patch-ro-"));
    await writeFile(join(dir, "hello.txt"), "hello\n");
    await chmod(join(dir, "hello.txt"), 0o444);
    const calls: string[][] = [];
    const runtime = new DockerGuestRuntime(
      {
        id: "v1",
        sessionId: "s1",
        templateId: "docker",
        os: "ubuntu",
        name: "c",
        status: "running",
        diskPath: dir,
        runtime: "docker",
        dockerImage: "alpine:3.21",
        containerId: "abc",
        createdAt: "",
        updatedAt: "",
      },
      async (argv) => {
        calls.push(argv);
        return { code: 1, stdout: "", stderr: "sh: 1: git: not found\n" };
      },
    );
    const patched = await runtime.execute({
      name: "apply_patch",
      args: {
        patch: [
          "--- a/hello.txt",
          "+++ b/hello.txt",
          "@@ -1 +1 @@",
          "-hello",
          "+hello world",
          "",
        ].join("\n"),
      },
    });
    expect(patched.ok, patched.output).toBe(true);
    expect(await readFile(join(dir, "hello.txt"), "utf8")).toBe("hello world\n");
    expect(calls).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "keeps the executable bit when docker apply_patch replaces a script",
    async () => {
      const { DockerGuestRuntime } = await import("./docker.js");
      const dir = await mkdtemp(join(tmpdir(), "locus-patch-exec-"));
      const script = join(dir, "bin.sh");
      await writeFile(script, "echo old\n", { mode: 0o755 });
      const runtime = new DockerGuestRuntime(
        {
          id: "v1",
          sessionId: "s1",
          templateId: "docker",
          os: "ubuntu",
          name: "c",
          status: "running",
          diskPath: dir,
          runtime: "docker",
          dockerImage: "alpine:3.21",
          containerId: "abc",
          createdAt: "",
          updatedAt: "",
        },
        async () => ({ code: 1, stdout: "", stderr: "sh: 1: git: not found\n" }),
      );
      const patched = await runtime.execute({
        name: "apply_patch",
        args: {
          patch: ["--- a/bin.sh", "+++ b/bin.sh", "@@ -1 +1 @@", "-echo old", "+echo new", ""].join(
            "\n",
          ),
        },
      });
      expect(patched.ok, patched.output).toBe(true);
      expect(await readFile(script, "utf8")).toBe("echo new\n");
      expect((await stat(script)).mode & 0o111).toBeTruthy();
    },
  );

  it("returns a host apply_patch failure instead of shelling out to git apply", async () => {
    const { DockerGuestRuntime } = await import("./docker.js");
    const dir = await mkdtemp(join(tmpdir(), "locus-patch-fail-"));
    await writeFile(join(dir, "index.js"), "export default 1;\n");
    const calls: string[][] = [];
    const runtime = new DockerGuestRuntime(
      {
        id: "v1",
        sessionId: "s1",
        templateId: "docker",
        os: "ubuntu",
        name: "c",
        status: "running",
        diskPath: dir,
        runtime: "docker",
        dockerImage: "ubuntu:24.04",
        containerId: "abc",
        createdAt: "",
        updatedAt: "",
      },
      async (argv) => {
        calls.push(argv);
        return { code: 1, stdout: "can't find file to patch\n", stderr: "" };
      },
    );
    const patched = await runtime.execute({
      name: "apply_patch",
      args: {
        path: "/workspace",
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
    expect(patched.ok).toBe(false);
    expect(patched.output).not.toContain("can't find file to patch");
    expect(patched.output.toLowerCase()).toMatch(/hunk|context|mismatch|failed|not found/);
    expect(await readFile(join(dir, "index.js"), "utf8")).toBe("export default 1;\n");
    expect(calls).toEqual([]);
  });

  it("copies a guest clone onto the host workspace directory", async () => {
    const { DockerGuestRuntime } = await import("./docker.js");
    const dir = await mkdtemp(join(tmpdir(), "locus-clone-host-"));
    try {
      const calls: string[][] = [];
      const runtime = new DockerGuestRuntime(
        {
          id: "v1",
          sessionId: "s1",
          templateId: "docker",
          os: "ubuntu",
          name: "c",
          status: "running",
          diskPath: dir,
          runtime: "docker",
          dockerImage: "locus/agent:0.1",
          containerId: "abc",
          createdAt: "",
          updatedAt: "",
        },
        async (argv) => {
          calls.push(argv);
          return { code: 0, stdout: "Cloning into /workspace\n", stderr: "" };
        },
      );
      const cloned = await runtime.execute({
        name: "git_clone",
        args: { url: "https://github.com/acme/app.git", dest: "/workspace" },
      });
      expect(cloned.ok).toBe(true);
      expect(calls[0]?.slice(0, 6)).toEqual(["docker", "exec", "-w", "/workspace", "abc", "sh"]);
      expect(calls[1]).toEqual(["docker", "cp", "abc:/workspace/.", `${dir}/`]);
      const st = statSync(dir);
      expect(calls[2]).toEqual([
        "docker",
        "exec",
        "abc",
        "chown",
        "-R",
        `${st.uid}:${st.gid}`,
        "/workspace",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("forwards git clone stderr to onOutput", async () => {
    const { DockerGuestRuntime } = await import("./docker.js");
    const chunks: string[] = [];
    const runtime = new DockerGuestRuntime(
      {
        id: "v1",
        sessionId: "s1",
        templateId: "docker",
        os: "ubuntu",
        name: "c",
        status: "running",
        diskPath: "",
        runtime: "docker",
        dockerImage: "locus/agent:0.1",
        containerId: "abc",
        createdAt: "",
        updatedAt: "",
      },
      async (_argv, opts) => {
        opts?.onOutput?.("Receiving objects:  45% (90/200)\r");
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

  it("runs npm install as the workspace owner so host vitest can write .vite-temp", async () => {
    const { DockerGuestRuntime, dockerExecNeedsRoot, DOCKER_AGENT_HOME } =
      await import("./docker.js");
    expect(dockerExecNeedsRoot("npm install")).toBe(false);
    expect(dockerExecNeedsRoot("npm test")).toBe(false);
    expect(dockerExecNeedsRoot("apt-get update")).toBe(true);
    expect(dockerExecNeedsRoot("apk add git")).toBe(true);
    expect(dockerExecNeedsRoot("sudo apt install build-essential")).toBe(true);
    expect(dockerExecNeedsRoot("npm install -g typescript")).toBe(true);

    const dir = await mkdtemp(join(tmpdir(), "locus-npm-owner-"));
    try {
      const calls: string[][] = [];
      const runtime = new DockerGuestRuntime(
        {
          id: "v1",
          sessionId: "s1",
          templateId: "docker",
          os: "ubuntu",
          name: "c",
          status: "running",
          diskPath: dir,
          runtime: "docker",
          dockerImage: "locus/agent:0.1",
          containerId: "abc",
          createdAt: "",
          updatedAt: "",
        },
        async (argv) => {
          calls.push(argv);
          return { code: 0, stdout: "", stderr: "" };
        },
      );
      const st = statSync(dir);
      const installed = await runtime.execute({
        name: "exec",
        args: { command: "npm install" },
      });
      expect(installed.ok).toBe(true);
      expect(calls[0]).toEqual([
        "docker",
        "exec",
        "-w",
        "/workspace",
        "-u",
        `${st.uid}:${st.gid}`,
        "-e",
        `HOME=${DOCKER_AGENT_HOME}`,
        "abc",
        "sh",
        "-lc",
        expect.stringContaining(`mkdir -p ${DOCKER_AGENT_HOME}`),
      ]);
      expect(calls[0]?.at(-1)).toContain("npm install");

      calls.length = 0;
      const apt = await runtime.execute({
        name: "exec",
        args: { command: "apt-get update" },
      });
      expect(apt.ok).toBe(true);
      expect(calls[0]).toEqual([
        "docker",
        "exec",
        "-w",
        "/workspace",
        "abc",
        "sh",
        "-lc",
        expect.any(String),
      ]);
      expect(calls[0]?.includes("-u")).toBe(false);
      expect(calls[1]).toEqual([
        "docker",
        "exec",
        "abc",
        "chown",
        "-R",
        `${st.uid}:${st.gid}`,
        "/workspace",
      ]);

      calls.length = 0;
      await runtime.prepareHostWorkspace();
      expect(calls).toEqual([
        ["docker", "exec", "abc", "chown", "-R", `${st.uid}:${st.gid}`, "/workspace"],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("copies host chat attachments into the guest workspace", async () => {
    const { DockerGuestRuntime } = await import("./docker.js");
    const dir = await mkdtemp(join(tmpdir(), "locus-attach-guest-"));
    try {
      await writeFile(join(dir, "shot.png"), "png");
      const calls: string[][] = [];
      const runtime = new DockerGuestRuntime(
        {
          id: "v1",
          sessionId: "s1",
          templateId: "docker",
          os: "ubuntu",
          name: "c",
          status: "running",
          diskPath: dir,
          runtime: "docker",
          dockerImage: "locus/agent:0.1",
          containerId: "abc",
          createdAt: "",
          updatedAt: "",
        },
        async (argv) => {
          calls.push(argv);
          return { code: 0, stdout: "", stderr: "" };
        },
      );
      await runtime.syncHostDirToGuest(dir, "/workspace/.locus-attachments");
      expect(calls).toEqual([
        ["docker", "exec", "abc", "mkdir", "-p", "/workspace/.locus-attachments"],
        ["docker", "cp", `${dir}/.`, "abc:/workspace/.locus-attachments/"],
      ]);
      calls.length = 0;
      await runtime.syncHostDirToGuest(dir, "/workspace/../etc");
      expect(calls).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("HostGuestRuntime", () => {
  it("overlays forge tokens onto host git spawn env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-gitenv-"));
    try {
      let extraEnv: NodeJS.ProcessEnv | undefined;
      const runtime = new HostGuestRuntime(
        "ubuntu",
        dir,
        async (_argv, _cwd, _signal, _onOutput, env) => {
          extraEnv = env;
          return { code: 0, stdout: "cloned", stderr: "" };
        },
      );
      const result = await runtime.execute({
        name: "git_clone",
        args: {
          url: "https://github.com/acme/app.git",
          dest: "/workspace",
          token: "gho_oauth",
        },
      });
      expect(result.ok).toBe(true);
      expect(extraEnv?.GITHUB_TOKEN).toBe("gho_oauth");
      expect(extraEnv?.GH_TOKEN).toBe("gho_oauth");
      expect(extraEnv?.GIT_TOKEN).toBe("gho_oauth");
      expect(extraEnv?.GCM_INTERACTIVE).toBe("Never");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "writes and patches files under /workspace and rejects paths outside it",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-host-"));
      const secretDir = await mkdtemp(join(tmpdir(), "locus-host-secret-"));
      try {
        const runtime = new HostGuestRuntime("ubuntu", dir);
        const wrote = await runtime.execute({
          name: "file_write",
          args: { path: "/workspace/a.ts", content: "one\ntwo\nthree\n" },
        });
        expect(wrote.ok).toBe(true);
        expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("one\ntwo\nthree\n");
        const relative = await runtime.execute({
          name: "file_read",
          args: { path: "a.ts" },
        });
        expect(relative.ok).toBe(true);
        expect(relative.output).toBe("one\ntwo\nthree\n");
        const escaped = await runtime.execute({
          name: "file_write",
          args: { path: "/etc/passwd", content: "nope" },
        });
        expect(escaped.ok).toBe(false);
        expect(escaped.output).toMatch(/outside \/workspace/);
        const traversal = await runtime.execute({
          name: "file_read",
          args: { path: "/workspace/../etc/passwd" },
        });
        expect(traversal.ok).toBe(false);
        const patch = await runtime.execute({
          name: "apply_patch",
          args: {
            patch: [
              "--- a/a.ts",
              "+++ b/a.ts",
              "@@ -1,3 +1,3 @@",
              " one",
              "-two",
              "+TWO",
              " three",
            ].join("\n"),
          },
        });
        expect(patch.ok).toBe(true);
        expect(await readFile(join(dir, "a.ts"), "utf8")).toBe("one\nTWO\nthree\n");
        const listed = await runtime.execute({ name: "file_list", args: {} });
        expect(listed.ok).toBe(true);
        expect(listed.output).toContain("a.ts");
        const dotted = await runtime.execute({
          name: "file_read",
          args: { path: "./a.ts" },
        });
        expect(dotted.ok).toBe(true);
        expect(dotted.output).toBe("one\nTWO\nthree\n");
        const leaked = join(secretDir, "secret.txt");
        await writeFile(leaked, "secret");
        await symlink(leaked, join(dir, "leak"));
        const viaLink = await runtime.execute({
          name: "file_read",
          args: { path: "/workspace/leak" },
        });
        expect(viaLink.ok).toBe(false);
        expect(viaLink.output).toMatch(/outside \/workspace/);
        await symlink("/tmp", join(dir, "out"));
        const writeOut = await runtime.execute({
          name: "file_write",
          args: { path: "/workspace/out/escaped.txt", content: "nope" },
        });
        expect(writeOut.ok).toBe(false);
        const exec = await runtime.execute({ name: "exec", args: { command: "pwd" } });
        expect(exec.ok).toBe(true);
        expect(exec.output).toContain(dir);
        const origPath = process.env.PATH;
        process.env.PATH = "";
        try {
          const emptyPath = await runtime.execute({ name: "exec", args: { command: "pwd && ls" } });
          expect(emptyPath.ok).toBe(true);
          expect(emptyPath.output).toContain(dir);
        } finally {
          process.env.PATH = origPath;
        }
        const gone = new HostGuestRuntime(
          "ubuntu",
          join(tmpdir(), `locus-host-missing-${Date.now()}`),
        );
        const missing = await gone.execute({ name: "exec", args: { command: "pwd" } });
        expect(missing.ok).toBe(false);
        expect(missing.output).toMatch(/does not exist/);
        const throwing = new HostGuestRuntime("ubuntu", dir, async () => {
          throw Object.assign(new Error("spawn sh ENOENT"), { code: "ENOENT" });
        });
        const spawned = await throwing.execute({ name: "exec", args: { command: "pwd" } });
        expect(spawned.ok).toBe(false);
        expect(spawned.output).toMatch(/POSIX shell/);
        const leakedExec = await runtime.execute({
          name: "exec",
          args: { command: "cat /etc/passwd" },
        });
        expect(leakedExec.ok).toBe(false);
        expect(leakedExec.output).toMatch(/outside \/workspace/);
        const ac = new AbortController();
        const pending = runtime.execute({ name: "exec", args: { command: "sleep 20" } }, ac.signal);
        ac.abort();
        const aborted = await pending;
        expect(aborted.ok).toBe(false);
        const shot = await runtime.execute({ name: "screenshot", args: {} });
        expect(shot.ok).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
        await rm(secretDir, { recursive: true, force: true });
      }
    },
  );
});
