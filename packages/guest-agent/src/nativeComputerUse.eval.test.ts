import { describe, expect, it } from "vitest";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandFor } from "./commands.js";
import type { ToolRequest } from "./types.js";

const exec = promisify(execFile);
const windows = process.platform === "win32";
const enabled =
  process.env.LOCUS_NATIVE_DESKTOP === "1" && (windows || process.platform === "linux");
describe.skipIf(!enabled)("interactive native desktop tasks", () => {
  it("fills a native control and saves the document through the OS file dialog", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-native-eval-"));
    const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/computer-use");
    let child: ChildProcess | undefined;
    const run = async (req: ToolRequest) => {
      const command = commandFor(windows ? "windows-11" : "ubuntu", req);
      try {
        const result = await exec(
          windows ? "powershell.exe" : "sh",
          windows ? ["-NoProfile", "-Command", command] : ["-c", command],
          { timeout: 15000, maxBuffer: 2_000_000 },
        );
        return result.stdout;
      } catch (error) {
        const e = error as { stdout?: string; stderr?: string; message?: string };
        throw new Error(
          `Native accessibility command failed: ${e.stdout ?? ""} ${e.stderr ?? ""} ${e.message?.slice(0, 100) ?? ""}`,
        );
      }
    };
    type Node = { ref: string; name: string; role: string };
    async function find(name: string): Promise<Node> {
      let last = "";
      for (let i = 0; i < 40; i++) {
        last = await run({ name: windows ? "uia_tree" : "a11y_tree", args: {} });
        const nodes = (JSON.parse(last) as { nodes: Node[] }).nodes;
        const node = nodes.find((n) => n.name === name);
        if (node) return node;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`No accessible control ${name}: ${last}`);
    }
    try {
      child = windows
        ? spawn(
            "powershell.exe",
            ["-NoProfile", "-STA", "-File", join(fixtures, "desktop.ps1"), dir],
            { stdio: "ignore" },
          )
        : spawn(
            process.env.LOCUS_DESKTOP_PYTHON ?? "/usr/bin/python3",
            [join(fixtures, "desktop.py"), dir],
            { stdio: "ignore" },
          );
      const field = await find("Document text");
      expect(
        JSON.parse(
          await run({
            name: "desktop_action",
            args: { ...field, action: "fill", value: "saved by agent" },
          }),
        ).ok,
      ).toBe(true);
      const save = await find("Save document");
      expect(
        JSON.parse(await run({ name: "desktop_action", args: { ...save, action: "invoke" } })).ok,
      ).toBe(true);
      const confirm = await find("Save");
      expect(
        JSON.parse(await run({ name: "desktop_action", args: { ...confirm, action: "invoke" } }))
          .ok,
      ).toBe(true);
      let content = "";
      for (let i = 0; i < 40; i++) {
        try {
          content = await readFile(join(dir, "result.txt"), "utf8");
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      expect(content).toBe("saved by agent");
    } finally {
      if (child && child.exitCode === null) {
        const exited = new Promise((r) => child!.once("exit", r));
        child.kill();
        await exited;
      }
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});
