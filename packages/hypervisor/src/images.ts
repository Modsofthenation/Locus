import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  imageBuildDoneProgress,
  imageBuildStartNote,
  imageBuildStartProgress,
  isLocusAgentImage,
  LOCUS_AGENT_IMAGE,
  LOCUS_AGENT_IMAGE_REVISION,
  LOCUS_AGENT_IMAGE_REVISION_LABEL,
  LOCUS_AGENT_IMAGE_VERSION,
  parseDockerBuildProgress,
  type ImageBuildProgress,
} from "@locus/shared";
import type { CommandRunner } from "./runner.js";

export function resolveAgentImageContext(from = import.meta.url): string | undefined {
  const env = process.env.LOCUS_IMAGES?.trim();
  if (env && existsSync(join(resolve(env), "Dockerfile"))) return resolve(env);
  const nearby = resolve(fileURLToPath(new URL(".", from)), "../../../images/agent");
  if (existsSync(join(nearby, "Dockerfile"))) return nearby;
  return undefined;
}

export async function imageExists(
  runner: CommandRunner,
  dockerBin: string,
  image: string,
): Promise<boolean> {
  const inspect = await runner.exec(dockerBin, ["image", "inspect", image]);
  return inspect.code === 0;
}

/**
 * Revision label of a local image, or undefined when the image is missing.
 * Empty string when the image exists but predates the label.
 */
export async function imageRevision(
  runner: CommandRunner,
  dockerBin: string,
  image: string,
): Promise<string | undefined> {
  const inspect = await runner.exec(dockerBin, [
    "image",
    "inspect",
    "-f",
    `{{ index .Config.Labels "${LOCUS_AGENT_IMAGE_REVISION_LABEL}" }}`,
    image,
  ]);
  if (inspect.code !== 0) return undefined;
  const value = inspect.stdout.trim();
  return value === "<no value>" ? "" : value;
}

/**
 * Build locus/agent:0.1 when a first-party alias is requested and the tag is missing, or when
 * the cached tag was built from an older Dockerfile (e.g. before iptables was added for the
 * restricted jail). The tag itself is stable, so the revision label is what detects staleness.
 */
export async function ensureLocusAgentImage(
  runner: CommandRunner,
  dockerBin: string,
  image: string,
  log?: (chunk: string) => void,
  context = resolveAgentImageContext(),
  onProgress?: (progress: ImageBuildProgress) => void,
): Promise<void> {
  if (!isLocusAgentImage(image)) return;
  const revision = await imageRevision(runner, dockerBin, LOCUS_AGENT_IMAGE);
  if (revision === LOCUS_AGENT_IMAGE_REVISION) return;
  const hasContext = !!context && existsSync(join(context, "Dockerfile"));
  if (revision !== undefined && !hasContext) {
    // No Dockerfile to rebuild from: keep the cached image rather than failing outright.
    log?.(
      `${LOCUS_AGENT_IMAGE} is outdated and images/agent is missing; using the cached image.\n`,
    );
    return;
  }
  if (!context || !existsSync(join(context, "Dockerfile"))) {
    throw new Error(
      "Locus agent Dockerfile is missing. Expected images/agent next to the repo, or set LOCUS_IMAGES.",
    );
  }
  if (revision !== undefined) {
    log?.(
      `${LOCUS_AGENT_IMAGE} is outdated (revision ${revision || "none"}, need ${LOCUS_AGENT_IMAGE_REVISION}); rebuilding.\n`,
    );
  }
  log?.(`${imageBuildStartNote()}\n`);
  onProgress?.(imageBuildStartProgress());
  let streamed = false;
  let acc = "";
  const emitChunk = (chunk: string) => {
    streamed = true;
    log?.(chunk);
    acc = `${acc}${chunk}`;
    if (acc.length > 8000) acc = acc.slice(-4000);
    const parsed = parseDockerBuildProgress(acc);
    if (parsed) onProgress?.(parsed);
  };
  const built = await runner.exec(
    dockerBin,
    [
      "build",
      "--progress=plain",
      "-t",
      LOCUS_AGENT_IMAGE,
      "-t",
      `locus/agent:${LOCUS_AGENT_IMAGE_VERSION}`,
      context,
    ],
    { onOutput: emitChunk },
  );
  if (!streamed) {
    if (built.stdout.trim()) log?.(built.stdout);
    if (built.stderr.trim()) log?.(built.stderr);
    const parsed = parseDockerBuildProgress(`${built.stdout}\n${built.stderr}`);
    if (parsed) onProgress?.(parsed);
  }
  if (built.code !== 0) {
    throw new Error(
      built.stderr.trim() || built.stdout.trim() || `docker build ${LOCUS_AGENT_IMAGE} failed`,
    );
  }
  onProgress?.(imageBuildDoneProgress());
}
