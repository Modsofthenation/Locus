import * as esbuild from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serverEsbuildOptions } from "./bundle-server.mjs";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(desktopRoot, "..", "..");

/** Default output; electron-builder ships `build/worker` as `<resources>/worker`. */
export const WORKER_BUNDLE_OUTFILE = join(desktopRoot, "build", "worker", "locus-worker.mjs");

/**
 * Bundles `locus-worker` into one ESM file that runs on plain Node 22. Settings → Workers → E2B
 * uploads it into the template it builds, so managed sandboxes need no source tree or registry.
 */
export async function bundleWorker(outfile = WORKER_BUNDLE_OUTFILE) {
  await mkdir(dirname(outfile), { recursive: true });
  await esbuild.build(
    serverEsbuildOptions({
      entryPoints: [join(repoRoot, "packages/worker/src/main.ts")],
      outfile,
      logLevel: "warning",
    }),
  );
  return outfile;
}

const runningAsScript =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runningAsScript) {
  const outfile = await bundleWorker(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log(`Bundled worker → ${outfile}`);
}
