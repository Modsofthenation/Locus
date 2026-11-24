import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Template } from "e2b";
import { e2bTemplateBuilder, e2bWorkerTemplate, E2B_WORKER_TEMPLATE_NAME } from "./e2bTemplate.js";
import { SANDBOX_WORKER_BUNDLE, SANDBOX_WORKER_SHELL } from "./sandbox.js";

afterEach(() => vi.restoreAllMocks());

describe("e2bWorkerTemplate", () => {
  it("installs the bundled worker with an idle start command", () => {
    const dockerfile = Template.toDockerfile(
      e2bWorkerTemplate({ contextDir: tmpdir(), agentClis: true }),
    );
    expect(dockerfile).toMatch(/^FROM node:22-bookworm/m);
    expect(dockerfile).toContain("chromium");
    expect(dockerfile).toContain("ripgrep");
    expect(dockerfile).toContain("git config --system credential.helper");
    expect(dockerfile).toContain("@anthropic-ai/claude-code");
    expect(dockerfile).toContain(`locus-worker.mjs ${SANDBOX_WORKER_BUNDLE}`);
    expect(dockerfile).toContain("sleep infinity");
    expect(dockerfile).not.toContain("7421");
  });

  it("leaves the agent CLIs out when asked", () => {
    const dockerfile = Template.toDockerfile(
      e2bWorkerTemplate({ contextDir: tmpdir(), agentClis: false }),
    );
    expect(dockerfile).not.toContain("@anthropic-ai/claude-code");
    expect(dockerfile).not.toContain("@openai/codex");
  });
});

describe("sandbox worker launcher", () => {
  it("prefers the bundle and falls back to the image source tree", () => {
    expect(SANDBOX_WORKER_SHELL).toBe(
      "if [ -f /opt/locus/locus-worker.mjs ]; then exec node /opt/locus/locus-worker.mjs; else exec /opt/locus/node_modules/.bin/tsx /opt/locus/packages/worker/src/main.ts; fi",
    );
  });
});

describe("e2bTemplateBuilder", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("stages the bundle and helper, builds at the chosen size, and cleans up", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-e2b-build-test-"));
    dirs.push(dir);
    const bundle = join(dir, "bundle.mjs");
    const helper = join(dir, "helper.sh");
    await writeFile(bundle, "console.log('worker')");
    await writeFile(helper, "#!/bin/sh");
    let staged: string[] = [];
    const build = vi.spyOn(Template, "build").mockImplementation((async (
      template: unknown,
      name: unknown,
      options: { onBuildLogs?: (entry: { message: string }) => void },
    ) => {
      const context = (template as { fileContextPath: string }).fileContextPath;
      staged = [
        await readFile(join(context, "locus-worker.mjs"), "utf8"),
        await readFile(join(context, "git-credential-locus"), "utf8"),
      ];
      options.onBuildLogs?.({ message: "step 1/9" });
      return { templateId: "tpl-123", buildId: "build-1", name: String(name) };
    }) as never);
    const logs: string[] = [];
    const result = await e2bTemplateBuilder.build({
      apiKey: "e2b-key",
      workerBundle: bundle,
      credentialHelper: helper,
      size: "4-4",
      agentClis: false,
      onLog: (line) => logs.push(line),
    });
    expect(result).toEqual({
      templateId: "tpl-123",
      buildId: "build-1",
      name: E2B_WORKER_TEMPLATE_NAME,
    });
    expect(staged).toEqual(["console.log('worker')", "#!/bin/sh"]);
    expect(logs).toEqual(["step 1/9"]);
    expect(build).toHaveBeenCalledWith(
      expect.anything(),
      E2B_WORKER_TEMPLATE_NAME,
      expect.objectContaining({
        apiKey: "e2b-key",
        cpuCount: 4,
        memoryMB: 4096,
        domain: "e2b.app",
      }),
    );
  });
});
