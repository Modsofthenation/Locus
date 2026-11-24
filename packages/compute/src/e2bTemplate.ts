import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Template, waitForTimeout, type LogEntry, type TemplateClass } from "e2b";
import { e2bTemplateSize, type E2BTemplateSize } from "@locus/shared";
import { SANDBOX_WORKER_BUNDLE } from "./sandbox.js";

/** Template name Locus builds in the operator's E2B team. Rebuilds replace its default build. */
export const E2B_WORKER_TEMPLATE_NAME = "locus-worker";

// Mirrors images/worker/Dockerfile so a template built here matches one built from the image.
const APT_PACKAGES = [
  "git",
  "patch",
  "ca-certificates",
  "curl",
  "wget",
  "unzip",
  "openssh-client",
  "jq",
  "ripgrep",
  "python3",
  "python3-pip",
  "python3-venv",
  "build-essential",
  "chromium",
  "fonts-liberation",
];
const AGENT_CLIS = ["@anthropic-ai/claude-code", "@openai/codex"];
const CONTEXT_BUNDLE = "locus-worker.mjs";
const CONTEXT_HELPER = "git-credential-locus";

export interface E2BWorkerTemplateInput {
  /** Directory holding `locus-worker.mjs` and `git-credential-locus`. */
  contextDir: string;
  agentClis: boolean;
}

/**
 * The worker template: Node 22 on Debian bookworm, the tools the worker image has, the
 * bundled worker at {@link SANDBOX_WORKER_BUNDLE}, and an idle start command. Locus starts the
 * worker itself after create with a per-sandbox token, so nothing may bind port 7421 here.
 */
export function e2bWorkerTemplate(input: E2BWorkerTemplateInput): TemplateClass {
  let template = Template({ fileContextPath: input.contextDir })
    .fromImage("node:22-bookworm")
    .setUser("root")
    .aptInstall(APT_PACKAGES, { noInstallRecommends: true })
    .runCmd([
      "ln -sf /usr/bin/chromium /usr/local/bin/chromium-browser",
      "ln -sf /usr/bin/chromium /usr/local/bin/google-chrome",
    ])
    .copy(CONTEXT_HELPER, "/usr/local/bin/git-credential-locus", { mode: 0o755 })
    .runCmd([
      "git config --system credential.helper /usr/local/bin/git-credential-locus",
      "git config --system user.email locus@local",
      "git config --system user.name Locus",
    ]);
  if (input.agentClis) template = template.npmInstall(AGENT_CLIS, { g: true });
  return template
    .makeDir("/opt/locus", { mode: 0o755 })
    .copy(CONTEXT_BUNDLE, SANDBOX_WORKER_BUNDLE, { mode: 0o644 })
    .setStartCmd("sleep infinity", waitForTimeout(5_000));
}

export interface E2BTemplateBuildInput {
  apiKey: string;
  workerBundle: string;
  credentialHelper: string;
  size: E2BTemplateSize;
  agentClis: boolean;
  onLog?: (line: string) => void;
}

export interface E2BTemplateBuildResult {
  templateId: string;
  buildId: string;
  name: string;
}

export interface E2BTemplateBuilder {
  build(input: E2BTemplateBuildInput): Promise<E2BTemplateBuildResult>;
}

/** Builds the worker template on E2B's build service. No local Docker or registry. */
export const e2bTemplateBuilder: E2BTemplateBuilder = {
  async build(input) {
    const contextDir = await mkdtemp(join(tmpdir(), "locus-e2b-template-"));
    try {
      await copyFile(input.workerBundle, join(contextDir, CONTEXT_BUNDLE));
      await copyFile(input.credentialHelper, join(contextDir, CONTEXT_HELPER));
      const size = e2bTemplateSize(input.size);
      const info = await Template.build(
        e2bWorkerTemplate({ contextDir, agentClis: input.agentClis }),
        E2B_WORKER_TEMPLATE_NAME,
        {
          apiKey: input.apiKey,
          domain: "e2b.app",
          apiUrl: "https://api.e2b.app",
          cpuCount: size.cpuCount,
          memoryMB: size.memoryMB,
          onBuildLogs: (entry: LogEntry) => input.onLog?.(entry.message),
        },
      );
      return { templateId: info.templateId, buildId: info.buildId, name: info.name };
    } finally {
      await rm(contextDir, { recursive: true, force: true });
    }
  },
};
