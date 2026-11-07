import { describe, expect, it } from "vitest";
import { isCompletionShell, renderCompletion } from "./completion.js";

describe("completion", () => {
  it("emits bash / zsh / fish scripts from the route table", () => {
    const commands = ["agent list", "agent new", "board list", "status"];
    expect(isCompletionShell("bash")).toBe(true);
    expect(isCompletionShell("powershell")).toBe(false);
    expect(renderCompletion("bash", commands)).toContain("agent list");
    expect(renderCompletion("zsh", commands)).toContain("#compdef locus");
    expect(renderCompletion("fish", commands)).toContain("complete -c locus");
    expect(renderCompletion("fish", commands)).toContain("board");
  });
});
