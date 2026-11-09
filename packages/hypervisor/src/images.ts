import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  imageBuildDoneProgress,
  imageBuildStartNote,
  imageBuildStartProgress,
  isLocusAgentImage,
  LOCUS_AGENT_IMAGE,
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

/** Build locus/agent:0.1 when a first-party alias is requested and the tag is missing. */
export async function ensureLocusAgentImage(
  runner: CommandRunner,
  dockerBin: string,
  image: string,
  log?: (chunk: string) => void,
  context = resolveAgentImageContext(),
  onProgress?: (progress: ImageBuildProgress) => void,
): Promise<void> {
  if (!isLocusAgentImage(image)) return;
  if (await imageExists(runner, dockerBin, LOCUS_AGENT_IMAGE)) return;
  if (!context || !existsSync(join(context, "Dockerfile"))) {
    throw new Error(
      "Locus agent Dockerfile is missing. Expected images/agent next to the repo, or set LOCUS_IMAGES.",
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
