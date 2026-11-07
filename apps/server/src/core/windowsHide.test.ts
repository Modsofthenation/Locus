import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const files = [
  "core/hooks.ts",
  "core/sockets.ts",
  "integrations/mcp.ts",
  "integrations/mcpCode.ts",
  "session/checkpoint.ts",
  "session/sessions.ts",
  "workspace/gitWorkspaceChanges.ts",
  "workspace/grepIndex.ts",
  "workspace/hostShell.ts",
  "workspace/repoIndex.ts",
  "workspace/workspaceDap.ts",
  "workspace/workspaceDebug.ts",
  "workspace/workspaceGit.ts",
  "workspace/workspaceGrep.ts",
  "workspace/workspaceLsp.ts",
  "workspace/workspacePython.ts",
];

describe("windowsHide", () => {
  it("hides the Windows console for host child processes used during a turn", () => {
    for (const rel of files) {
      const src = readFileSync(join(root, rel), "utf8");
      expect(src, rel).toContain("windowsHide: true");
    }
  });
});
