import { expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { linuxCommand, windowsCommand } from "./commands.js";
import { windowsDesktopCommand } from "./windowsDesktop.js";

it.skipIf(process.platform === "win32")(
  "selects Wayland input and preserves Unicode and shell metacharacters literally",
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "locus-wayland-test-"));
    const log = join(folder, "args");
    try {
      for (const binary of ["wtype", "ydotool", "xdotool"])
        await writeFile(join(folder, binary), `#!/bin/sh\nprintf '%s\\0' "$@" > '${log}'\n`, {
          mode: 0o755,
        });
      const text = "你好 ' $(do-not-execute) ; $TOKEN";
      await promisify(execFile)("sh", ["-c", linuxCommand({ name: "type_text", args: { text } })], {
        env: {
          ...process.env,
          PATH: `${folder}:${process.env.PATH}`,
          WAYLAND_DISPLAY: "wayland-test",
        },
      });
      expect((await readFile(log, "utf8")).split("\0")).toEqual(["--", text, ""]);
      await promisify(execFile)(
        "sh",
        ["-c", linuxCommand({ name: "key", args: { key: "ctrl+a" } })],
        {
          env: {
            ...process.env,
            PATH: `${folder}:${process.env.PATH}`,
            WAYLAND_DISPLAY: "wayland-test",
          },
        },
      );
      expect((await readFile(log, "utf8")).split("\0")).toEqual([
        "-M",
        "ctrl",
        "-k",
        "a",
        "-m",
        "ctrl",
        "",
      ]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);

it("uses the guest user's limited interactive token and cleans temporary desktop tasks", () => {
  const shortcut = windowsCommand({ name: "key", args: { key: "win+r" } });
  expect(shortcut).toContain("keybd_event(91,0,0");
  expect(shortcut).toContain("keybd_event(82,0,0");
  expect(shortcut).toContain("finally");
  const source = "Write-Output 'native task'";
  const script = windowsDesktopCommand("uia_tree", source);
  expect(script).toContain("-LogonType Interactive -RunLevel Limited");
  expect(script).toContain("Unregister-ScheduledTask");
  expect(script).toContain("Remove-Item -LiteralPath $folder");
  expect(script).toContain(Buffer.from(source).toString("base64"));
  expect(script).not.toContain("-Password");
  expect(windowsDesktopCommand("exec", source)).toBe(source);
});
