import { describe, expect, it } from "vitest";
import { UsageError, flagBool, flagStr, parseArgv } from "./args.js";

describe("parseArgv", () => {
  it("splits tokens and boolean flags", () => {
    const parsed = parseArgv(["agent", "list", "--json", "--archived"]);
    expect(parsed.tokens).toEqual(["agent", "list"]);
    expect(flagBool(parsed.flags, "json")).toBe(true);
    expect(flagBool(parsed.flags, "archived")).toBe(true);
  });

  it("accepts --flag=value and --flag value", () => {
    expect(flagStr(parseArgv(["--runtime", "docker"]).flags, "runtime")).toBe("docker");
    expect(flagStr(parseArgv(["--title=Fix tests"]).flags, "title")).toBe("Fix tests");
    expect(flagStr(parseArgv(["asset", "new", "Fox", "--style", "st1"]).flags, "style")).toBe(
      "st1",
    );
    expect(
      flagStr(parseArgv(["asset", "new", "Fox", "--topology", "smart"]).flags, "topology"),
    ).toBe("smart");
    expect(flagBool(parseArgv(["asset", "new", "Fox", "--printable"]).flags, "printable")).toBe(
      true,
    );
  });

  it("keeps positionals after flags", () => {
    const parsed = parseArgv(["agent", "chat", "abc123", "--steer", "please retry"]);
    expect(parsed.tokens).toEqual(["agent", "chat", "abc123", "please retry"]);
    expect(flagBool(parsed.flags, "steer")).toBe(true);
  });

  it("parses --wait and --notify for async chat", () => {
    const parsed = parseArgv([
      "agent",
      "chat",
      "abc123",
      "--wait",
      "--notify",
      "coord-1",
      "please retry",
    ]);
    expect(flagBool(parsed.flags, "wait")).toBe(true);
    expect(flagStr(parsed.flags, "notify")).toBe("coord-1");
    expect(parsed.tokens).toEqual(["agent", "chat", "abc123", "please retry"]);
  });

  it("stops at --", () => {
    const parsed = parseArgv(["agent", "new", "--", "--not-a-flag"]);
    expect(parsed.tokens).toEqual(["agent", "new", "--not-a-flag"]);
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgv(["--nope"])).toThrow(UsageError);
  });

  it("requires values for value flags", () => {
    expect(() => parseArgv(["--title"])).toThrow(/needs a value/);
  });

  it("joins repeated --arg flags", () => {
    const parsed = parseArgv([
      "agent",
      "tool",
      "sess",
      "exec",
      "--arg",
      "cmd=ls",
      "--arg",
      "cwd=/tmp",
    ]);
    expect(flagStr(parsed.flags, "arg")).toBe("cmd=ls,cwd=/tmp");
  });

  it("joins repeated --repo flags", () => {
    const parsed = parseArgv(["agent", "new", "--repo", "r1", "--repo", "r2"]);
    expect(flagStr(parsed.flags, "repo")).toBe("r1,r2");
  });
});
