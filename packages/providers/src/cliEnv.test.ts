import { describe, expect, it } from "vitest";
import { isSecretEnvName, scrubCliEnv } from "./cliEnv.js";
import { buildClaudeCodeArgv } from "./claudeCode.js";
import type { AiProvider } from "@locus/shared";

describe("scrubCliEnv", () => {
  it("drops credential-looking variables and keeps the rest", () => {
    const env = {
      GITHUB_TOKEN: "x",
      GH_TOKEN: "x",
      AWS_SECRET_ACCESS_KEY: "x",
      AWS_PROFILE: "x",
      OPENAI_API_KEY: "x",
      ANTHROPIC_API_KEY: "x",
      SSH_AUTH_SOCK: "x",
      NPM_TOKEN: "x",
      DATABASE_URL: "x",
      SENTRY_DSN: "x",
      SLACK_BOT_TOKEN: "x",
      KUBECONFIG: "x",
      GIT_ASKPASS: "x",
      OP_SERVICE_ACCOUNT_TOKEN: "x",
      DBUS_SESSION_BUS_ADDRESS: "x",
      my_db_password: "x",
      PATH: "/usr/bin",
      Path: "C:\\Windows",
      HOME: "/home/me",
      USER: "me",
      HTTPS_PROXY: "http://proxy:8080",
      HTTP_PROXY: "http://proxy:8080",
      NO_PROXY: "localhost",
      LANG: "en_US.UTF-8",
      TERM: "xterm",
      TMPDIR: "/tmp",
      NODE_EXTRA_CA_CERTS: "/ca.pem",
      SSL_CERT_FILE: "/ca.pem",
      XDG_CONFIG_HOME: "/home/me/.config",
      XDG_SESSION_TYPE: "wayland",
      APPDATA: "x",
      LOCALAPPDATA: "x",
      USERPROFILE: "x",
      SystemRoot: "C:\\Windows",
      ComSpec: "cmd.exe",
      GIT_AUTHOR_NAME: "Me",
      LOCUS_CLAUDE_CODE: "claude",
    };
    const out = scrubCliEnv(env);
    expect(Object.keys(out).sort()).toEqual(
      [
        "PATH",
        "Path",
        "HOME",
        "USER",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "NO_PROXY",
        "LANG",
        "TERM",
        "TMPDIR",
        "NODE_EXTRA_CA_CERTS",
        "SSL_CERT_FILE",
        "XDG_CONFIG_HOME",
        "XDG_SESSION_TYPE",
        "APPDATA",
        "LOCALAPPDATA",
        "USERPROFILE",
        "SystemRoot",
        "ComSpec",
        "GIT_AUTHOR_NAME",
        "LOCUS_CLAUDE_CODE",
      ].sort(),
    );
    expect(env.GITHUB_TOKEN).toBe("x");
  });

  it("matches names case-insensitively", () => {
    expect(isSecretEnvName("github_token")).toBe(true);
    expect(isSecretEnvName("Aws_Region")).toBe(true);
    expect(isSecretEnvName("https_proxy")).toBe(false);
  });

  it("still lets the argv builder add the provider's own key", () => {
    const provider = {
      id: "cc",
      name: "Claude Code",
      kind: "claude-code",
      baseUrl: "claude-code://local",
      apiKey: "sk-ant-own",
      models: [],
      enabled: true,
      extraHeaders: {},
    } as unknown as AiProvider;
    const argv = buildClaudeCodeArgv({
      provider,
      prompt: "p",
      workspace: "/tmp",
      env: scrubCliEnv({ PATH: "/usr/bin", GITHUB_TOKEN: "x", ANTHROPIC_API_KEY: "server" }),
    });
    expect(argv.env.ANTHROPIC_API_KEY).toBe("sk-ant-own");
    expect(argv.env.GITHUB_TOKEN).toBeUndefined();
    expect(argv.env.PATH).toBe("/usr/bin");
  });
});
