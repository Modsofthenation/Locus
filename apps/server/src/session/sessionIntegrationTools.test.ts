import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, LocusConfig } from "@locus/shared";
import { IntegrationsClient } from "../integrations/integrations.js";
import { readWorkspaceUploadBytes } from "../workspace/workspaceFiles.js";
import {
  bindSlackToolArgs,
  executeIntegrationTool,
  resolveSlackUploadPath,
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

describe("slack_upload path= (Playwright report from a job run)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "locus-upload-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const readWorkspaceUpload = (_id: string, path: string, maxBytes: number) =>
    readWorkspaceUploadBytes(root, path, maxBytes);

  it("uploads a multi-MB report straight from the workspace to Slack", async () => {
    // Playwright's HTML reporter inlines its data, so index.html is routinely several MB.
    const html = `<!doctype html><html><body>${"x".repeat(3 * 1024 * 1024)}</body></html>`;
    await mkdir(join(root, "playwright-report"));
    await writeFile(join(root, "playwright-report/index.html"), html);
    const uploadUrl = "https://files.slack.com/upload/v1/abc";
    const seen: { start?: URLSearchParams; body?: Uint8Array; mime?: string; done?: unknown } = {};
    const client = new IntegrationsClient(async (url, init) => {
      const href = String(url);
      if (href.endsWith("/files.getUploadURLExternal")) {
        seen.start = new URLSearchParams(String(init?.body));
        return Response.json({ ok: true, upload_url: uploadUrl, file_id: "F1" });
      }
      if (href === uploadUrl) {
        seen.body = new Uint8Array(init?.body as Uint8Array);
        seen.mime = new Headers(init?.headers).get("content-type") ?? undefined;
        return new Response("OK");
      }
      if (href.endsWith("/files.completeUploadExternal")) {
        seen.done = JSON.parse(String(init?.body));
        return Response.json({ ok: true, files: [{ id: "F1", title: "index.html" }] });
      }
      throw new Error(`Unexpected Slack request: ${href}`);
    });
    const job = session({
      automationId: "auto1",
      allowedMcpTools: ["slack_upload"],
    });
    const result = await executeIntegrationTool(
      {
        call: (name, args, rows) => client.call(name, args, rows),
        noteSlackPost: async () => undefined,
        readWorkspaceUpload,
      },
      job,
      "slack_upload",
      {
        channel: "C_QA",
        path: "/workspace/playwright-report/index.html",
        comment: "Nightly e2e: 42 passed, 1 failed",
      },
      config,
      (_name, output) => output,
    );
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/^Uploaded index\.html to C_QA ts=/);
    expect(seen.start?.get("filename")).toBe("index.html");
    expect(seen.start?.get("length")).toBe(String(Buffer.byteLength(html)));
    expect(seen.mime).toBe("text/html");
    expect(Buffer.from(seen.body!).toString("utf8")).toBe(html);
    expect(seen.done).toMatchObject({
      channel_id: "C_QA",
      initial_comment: "Nightly e2e: 42 passed, 1 failed",
      files: [{ id: "F1", title: "index.html" }],
    });
  });

  it("is refused for a job that did not allow slack_upload", async () => {
    await writeFile(join(root, "report.zip"), "zip");
    await expect(
      executeIntegrationTool(
        { call: vi.fn(), noteSlackPost: async () => undefined, readWorkspaceUpload },
        session({ automationId: "auto1", allowedMcpTools: ["slack_post"] }),
        "slack_upload",
        { channel: "C_QA", path: "report.zip" },
        config,
        (_name, output) => output,
      ),
    ).rejects.toThrow(/not allowed for this automation/);
  });

  it("names a zip and keeps explicit filename / mime", async () => {
    await writeFile(join(root, "report.zip"), Buffer.from([0x50, 0x4b, 3, 4]));
    const zipped = await resolveSlackUploadPath({ readWorkspaceUpload }, "s1", {
      channel: "C1",
      path: "report.zip",
    });
    expect(zipped).toEqual({
      channel: "C1",
      filename: "report.zip",
      mime: "application/zip",
      bytes_base64: Buffer.from([0x50, 0x4b, 3, 4]).toString("base64"),
    });
    const named = await resolveSlackUploadPath({ readWorkspaceUpload }, "s1", {
      channel: "C1",
      path: "report.zip",
      filename: "e2e-2026-11-24.zip",
      mime: "application/x-zip",
    });
    expect(named).toMatchObject({ filename: "e2e-2026-11-24.zip", mime: "application/x-zip" });
  });

  it("leaves inline content alone", async () => {
    const args = { channel: "C1", path: "x.txt", filename: "x.txt", content: "hi" };
    expect(await resolveSlackUploadPath({}, "s1", args)).toBe(args);
  });

  it("refuses folders, traversal, symlinks, missing and oversized files", async () => {
    await mkdir(join(root, "playwright-report"));
    await expect(readWorkspaceUploadBytes(root, "playwright-report", 1024)).rejects.toThrow(
      /is a folder\. Zip it first/,
    );
    await expect(readWorkspaceUploadBytes(root, "../etc/passwd", 1024)).rejects.toThrow(
      /Invalid path|outside/,
    );
    await expect(readWorkspaceUploadBytes(root, "nope.html", 1024)).rejects.toThrow(
      /File not found: nope\.html/,
    );
    await writeFile(join(root, "big.bin"), Buffer.alloc(2 * 1024 * 1024));
    await expect(readWorkspaceUploadBytes(root, "big.bin", 1024 * 1024)).rejects.toThrow(
      /larger than 1 MiB/,
    );
    await symlink("/etc/hostname", join(root, "link.txt"));
    await expect(readWorkspaceUploadBytes(root, "link.txt", 1024)).rejects.toThrow(/Symlinks/);
  });
});
