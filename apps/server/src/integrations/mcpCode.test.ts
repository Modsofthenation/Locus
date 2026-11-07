import { describe, expect, it } from "vitest";
import { runMcpCode } from "./mcpCode.js";

describe("runMcpCode", () => {
  it("runs Python that calls MCP through the host bridge", async () => {
    const calls: Array<{ server: string; tool: string; args: Record<string, unknown> }> = [];
    const result = await runMcpCode({
      code: `
from mcp_client import call_tool
print(call_tool("echo", "echo", {"text": "from-python"}))
`,
      callTool: async (server, tool, args) => {
        calls.push({ server, tool, args });
        return { ok: true, output: `echoed:${String(args.text ?? "")}` };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("echoed:from-python");
    expect(calls).toEqual([{ server: "echo", tool: "echo", args: { text: "from-python" } }]);
  });

  it("does not put LOCUS_ secrets into the Python process", async () => {
    const previous = process.env.LOCUS_MASTER_KEY;
    process.env.LOCUS_MASTER_KEY = "should-not-leak";
    try {
      const result = await runMcpCode({
        code: `
import os
print("leaked" if os.environ.get("LOCUS_MASTER_KEY") else "clean")
`,
        callTool: async () => ({ ok: true, output: "" }),
      });
      expect(result.ok).toBe(true);
      expect(result.output).toContain("clean");
    } finally {
      if (previous === undefined) delete process.env.LOCUS_MASTER_KEY;
      else process.env.LOCUS_MASTER_KEY = previous;
    }
  });
});
