import { describe, expect, it } from "vitest";
import {
  debugState,
  setDebugBreakpoints,
  startWorkspaceDebug,
  toggleDebugBreakpoint,
  stopWorkspaceDebug,
} from "./workspaceDebug.js";

describe("workspace debug", () => {
  it("toggles breakpoints without launching a process", async () => {
    const id = "dbg-1";
    await stopWorkspaceDebug(id);
    expect(debugState(id).breakpoints).toEqual([]);
    expect(toggleDebugBreakpoint(id, "src/app.ts", 12).breakpoints).toEqual([
      { path: "src/app.ts", line: 12 },
    ]);
    expect(toggleDebugBreakpoint(id, "src/app.ts", 12).breakpoints).toEqual([]);
    expect(
      setDebugBreakpoints(id, [
        { path: "src/app.ts", line: 3 },
        { path: "src/app.ts", line: 3 },
        { path: "../secret", line: 1 },
      ]).breakpoints,
    ).toEqual([{ path: "src/app.ts", line: 3 }]);
    await stopWorkspaceDebug(id);
  });

  it("attempts Python DAP launch and reports missing debugpy clearly", async () => {
    const id = "dbg-py";
    await stopWorkspaceDebug(id);
    const state = await startWorkspaceDebug({
      sessionId: id,
      root: "/tmp",
      program: "app.py",
    });
    expect(state.status).toBe("error");
    expect(state.error).toMatch(/debugpy|Python|DAP|exited|ENOENT|not found/i);
    expect(state.error).not.toMatch(/only available for Node/);
    await stopWorkspaceDebug(id);
  });
});
