import { describe, expect, it } from "vitest";
import { posixShellQuote, sshCliEnv, sshRemoteCommand, sshTargetFromInstance } from "./sshCli.js";

describe("ssh CLI spawn helpers", () => {
  it("quotes values for POSIX ssh remote commands", () => {
    expect(posixShellQuote("a b")).toBe("'a b'");
    expect(posixShellQuote("it's")).toBe("'it'\\''s'");
    expect(
      sshRemoteCommand({
        command: "agent",
        args: ["-p", "hi there"],
        cwd: "/home/locus/workspace",
      }),
    ).toBe("cd '/home/locus/workspace' && 'agent' '-p' 'hi there'");
  });

  it("forwards only env that differs from this process", () => {
    const env = sshCliEnv({
      ...process.env,
      CURSOR_API_KEY: "secret",
      "BAD=KEY": "nope",
      EMPTY: "",
    });
    expect(env.CURSOR_API_KEY).toBe("secret");
    expect(env["BAD=KEY"]).toBeUndefined();
    expect(env.EMPTY).toBeUndefined();
    expect(env.PATH).toBeUndefined();
    expect(
      sshRemoteCommand({
        command: "claude",
        args: [],
        env: { CURSOR_API_KEY: "secret" },
      }),
    ).toBe("CURSOR_API_KEY='secret' 'claude'");
  });

  it("reads SSH from a VM instance", () => {
    expect(sshTargetFromInstance({})).toBeUndefined();
    expect(
      sshTargetFromInstance({
        ssh: { host: "127.0.0.1", port: 2222, username: "locus", identityFile: "/keys/id" },
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 2222,
      username: "locus",
      identityFile: "/keys/id",
    });
  });
});
