import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { E2BTemplateBuilder } from "@locus/compute";
import type { E2BTemplateBuildView, E2BTemplateSize } from "@locus/shared";
import { resolveAgentImageContext } from "@locus/hypervisor";

const WORKER_BUNDLE = "locus-worker.mjs";
const LOG_LINES = 200;
const FINISHED_KEEP_MS = 60 * 60 * 1000;

/**
 * Where the single-file worker lives: `LOCUS_WORKER_BUNDLE`, then `<resources>/worker` in a
 * packaged app (the control plane's cwd is the resources dir), else undefined.
 */
export function packagedWorkerBundle(
  opts: { env?: NodeJS.ProcessEnv; resourcesPath?: string; cwd?: string } = {},
): string | undefined {
  const env = (opts.env ?? process.env).LOCUS_WORKER_BUNDLE?.trim();
  const candidates = [
    env ? resolve(env) : "",
    opts.resourcesPath ? join(opts.resourcesPath, "worker", WORKER_BUNDLE) : "",
    join(opts.cwd ?? process.cwd(), "worker", WORKER_BUNDLE),
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path));
}

/**
 * The worker bundle for an E2B template build. A packaged app ships it; a repo checkout builds
 * it on demand with the desktop bundling script so it always matches the running source.
 */
export async function resolveWorkerBundle(opts: {
  dataDir: string;
  resourcesPath?: string;
  cwd?: string;
  moduleDir?: string;
}): Promise<string> {
  const shipped = packagedWorkerBundle(opts);
  if (shipped) return shipped;
  const moduleDir = opts.moduleDir ?? dirname(fileURLToPath(import.meta.url));
  const script = resolve(moduleDir, "../../../desktop/scripts/bundle-worker.mjs");
  if (!existsSync(script)) {
    throw new Error("The Locus worker bundle is missing from this install. Reinstall Locus.");
  }
  const { bundleWorker } = (await import(pathToFileURL(script).href)) as {
    bundleWorker: (outfile: string) => Promise<string>;
  };
  return bundleWorker(join(opts.dataDir, "cache", WORKER_BUNDLE));
}

export function resolveCredentialHelper(): string {
  const context = resolveAgentImageContext();
  const helper = context ? join(context, "git-credential-locus") : "";
  if (!helper || !existsSync(helper)) {
    throw new Error("git-credential-locus is missing. Set LOCUS_IMAGES or reinstall Locus.");
  }
  return helper;
}

export interface E2BTemplateBuildStart {
  workerId: string;
  apiKey: string;
  size: E2BTemplateSize;
  agentClis: boolean;
}

/**
 * In-memory E2B template builds started from Settings. One build per worker at a time; the
 * desktop polls a build by id and copies the template ID into the worker when it succeeds.
 */
export class E2BTemplateBuilds {
  private readonly builds = new Map<string, E2BTemplateBuildView>();

  constructor(
    private readonly deps: {
      builder: E2BTemplateBuilder;
      workerBundle: () => Promise<string>;
      credentialHelper: () => string;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private prune(): void {
    const cutoff = this.now() - FINISHED_KEEP_MS;
    for (const [id, build] of this.builds) {
      if (build.finishedAt && build.finishedAt < cutoff) this.builds.delete(id);
    }
  }

  running(workerId: string): E2BTemplateBuildView | undefined {
    return [...this.builds.values()].find(
      (build) => build.workerId === workerId && build.state === "running",
    );
  }

  /** Newest build for a worker, so a reopened Settings card can resume or show it. */
  latest(workerId: string): E2BTemplateBuildView | undefined {
    this.prune();
    const newest = [...this.builds.values()]
      .filter((build) => build.workerId === workerId)
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    return newest ? this.get(newest.id) : undefined;
  }

  get(id: string): E2BTemplateBuildView | undefined {
    const build = this.builds.get(id);
    return build ? { ...build, logs: [...build.logs] } : undefined;
  }

  /** Starts a build and returns at once; `done` settles when it finishes (tests await it). */
  start(input: E2BTemplateBuildStart): { view: E2BTemplateBuildView; done: Promise<void> } {
    this.prune();
    if (!input.apiKey.trim()) throw new Error("Enter the E2B API key first");
    if (this.running(input.workerId)) {
      throw new Error("A template build is already running for this worker");
    }
    const build: E2BTemplateBuildView = {
      id: randomUUID(),
      workerId: input.workerId,
      state: "running",
      startedAt: this.now(),
      logs: [],
    };
    this.builds.set(build.id, build);
    const log = (line: string) => {
      const text = line.replace(/\s+$/, "");
      if (!text) return;
      build.logs.push(text);
      if (build.logs.length > LOG_LINES) build.logs.splice(0, build.logs.length - LOG_LINES);
    };
    const done = (async () => {
      try {
        log("Preparing the Locus worker bundle");
        const workerBundle = await this.deps.workerBundle();
        const credentialHelper = this.deps.credentialHelper();
        log("Uploading to E2B and building the template");
        const result = await this.deps.builder.build({
          apiKey: input.apiKey,
          workerBundle,
          credentialHelper,
          size: input.size,
          agentClis: input.agentClis,
          onLog: log,
        });
        build.templateId = result.templateId;
        build.state = "succeeded";
        log(`Template ${result.name} ready (${result.templateId})`);
      } catch (err) {
        build.state = "failed";
        build.error = err instanceof Error ? err.message : "Template build failed";
        log(build.error);
      } finally {
        build.finishedAt = this.now();
      }
    })();
    return { view: this.get(build.id)!, done };
  }
}
