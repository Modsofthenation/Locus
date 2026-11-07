import { describe, expect, it, vi } from "vitest";
import type { AgentSession, LocusConfig } from "@locus/shared";
import {
  bindSlackToolArgs,
  executeIntegrationTool,
  slackToolLastPostTs,
} from "./sessionIntegrationTools.js";

function session(patch: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "One",
    os: "ubuntu",
    templateId: "t",
    providerId: "p",
    model: "m",
    status: "idle",
    messages: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...patch,
  };
}

const config: LocusConfig = {
  theme: "ember",
  providers: [],
  templates: [],
  hardwareProfiles: [],
  forges: [],
  integrations: [
    {
      id: "slack",
      kind: "slack",
      name: "Slack",
      enabled: true,
      baseUrl: "https://slack.com/api",
      token: "xoxb-test",
    },
  ],
  advanced: {
    dataDir: "/tmp",
    qemuBinary: "qemu",
    swtpmBinary: "swtpm",
    ovmfCodePath: "",
    ovmfVarsPath: "",
    maxConcurrentVms: 4,
    defaultAcceleratorAuto: true,
    logLevel: "info",
    bindHost: "127.0.0.1",
    bindPort: 7420,
    openBrowserOnStart: true,
    hostSharePath: "",
  },
};

describe("bindSlackToolArgs", () => {
  const slack = { teamId: "T1", channelId: "C1", threadTs: "171.1" };

  it("fills channel and thread for a bound Slack Turn", () => {
    expect(bindSlackToolArgs(slack, "slack_post", { text: "hi" })).toEqual({
      text: "hi",
      channel: "C1",
      thread_ts: "171.1",
    });
  });

  it("does not override a different channel", () => {
    expect(bindSlackToolArgs(slack, "slack_post", { channel: "C2", text: "hi" })).toEqual({
      channel: "C2",
      text: "hi",
    });
  });

  it("leaves non-write Slack tools alone", () => {
    expect(bindSlackToolArgs(slack, "slack_history", {})).toEqual({});
  });
});

describe("slackToolLastPostTs", () => {
  it("reads ts= from a successful write", () => {
    expect(slackToolLastPostTs("slack_upload", { ok: true, output: "ok ts=171.9" })).toBe("171.9");
    expect(slackToolLastPostTs("slack_post", { ok: false, output: "ts=171.9" })).toBeUndefined();
  });
});

describe("executeIntegrationTool", () => {
  it("binds the thread, calls the adapter, and stamps lastPostTs", async () => {
    const call = vi.fn(async () => ({ ok: true, output: "posted ts=171.2" }));
    const noteSlackPost = vi.fn(async () => undefined);
    const result = await executeIntegrationTool(
      { call, noteSlackPost },
      session({ slack: { teamId: "T1", channelId: "C1", threadTs: "171.1" } }),
      "slack_post",
      { text: "hi" },
      config,
      (_name, output) => `fenced:${output}`,
    );
    expect(call).toHaveBeenCalledWith(
      "slack_post",
      { text: "hi", channel: "C1", thread_ts: "171.1" },
      config.integrations,
    );
    expect(noteSlackPost).toHaveBeenCalledWith("s1", "171.2");
    expect(result.output).toBe("fenced:posted ts=171.2");
  });

  it("rejects a missing integration token", async () => {
    await expect(
      executeIntegrationTool(
        { call: async () => ({ ok: true, output: "" }), noteSlackPost: async () => undefined },
        session(),
        "jira_search",
        { jql: "project = OPS" },
        { ...config, integrations: [] },
        (name, output) => output,
      ),
    ).rejects.toThrow(/jira token/);
  });

  it("rejects a missing Confluence token", async () => {
    await expect(
      executeIntegrationTool(
        { call: async () => ({ ok: true, output: "" }), noteSlackPost: async () => undefined },
        session(),
        "confluence_search",
        { cql: "type=page" },
        { ...config, integrations: [] },
        (name, output) => output,
      ),
    ).rejects.toThrow(/confluence token/);
  });
});
