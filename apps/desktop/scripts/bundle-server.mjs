import * as esbuild from "esbuild";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_BUNDLE_BANNER =
  "import { createRequire as __locusCreateRequire } from 'node:module'; const require = __locusCreateRequire(import.meta.url);";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(desktopRoot, "..", "..");
const require = createRequire(join(repoRoot, "apps/server/package.json"));

function vscodeEsmEntry(pkgName, file) {
  return join(dirname(require.resolve(`${pkgName}/package.json`)), "lib", "esm", file);
}

export function typescriptPackageDir() {
  return join(dirname(require.resolve("typescript-ls")), "..");
}

function workspaceExportPath(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  if (typeof value.import === "string") return value.import;
  if (typeof value.default === "string") return value.default;
  return null;
}

// esbuild resolves packages only from node_modules. @locus/* entries are
// symlinks (junctions on Windows) created by npm. A stale install, or a
// junction that does not resolve, makes a package such as @locus/alb
// unresolvable even though packages/<name> is in the repo.
export function workspacePackageAliases() {
  const aliases = {};
  for (const group of ["packages", "apps"]) {
    const groupDir = join(repoRoot, group);
    for (const entry of readdirSync(groupDir)) {
      const root = join(groupDir, entry);
      const pkgJsonPath = join(root, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      if (typeof pkg.name !== "string" || !pkg.name.startsWith("@locus/")) continue;
      const exportsField =
        pkg.exports && typeof pkg.exports === "object"
          ? pkg.exports
          : typeof pkg.main === "string"
            ? { ".": pkg.main }
            : null;
      if (!exportsField) continue;
      for (const [key, value] of Object.entries(exportsField)) {
        if (!key.startsWith(".")) continue;
        const rel = workspaceExportPath(value);
        if (!rel) continue;
        const target = resolve(root, rel);
        const relToRoot = relative(root, target);
        if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) continue;
        if (!existsSync(target)) continue;
        const specifier = key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`;
        aliases[specifier] = target;
      }
    }
  }
  return aliases;
}

export function serverEsbuildOptions({ entryPoints, outfile, logLevel = "info" }) {
  return {
    absWorkingDir: repoRoot,
    entryPoints,
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel,
    // Keep the compiler on disk as CJS (it uses __filename). electron-builder's
    // extraResources filter drops a nested node_modules directory, so the copy
    // lives beside build/server and is mapped to server/node_modules/typescript-ls.
    external: ["typescript-ls"],
    // vscode-* ship UMD as "main". Bundling that wraps factory(require, …) and
    // the banner's createRequire then resolves ./parser/cssParser against the
    // outfile instead of the package. Prefer the ESM build so esbuild inlines it.
    alias: {
      ...workspacePackageAliases(),
      "vscode-css-languageservice": vscodeEsmEntry(
        "vscode-css-languageservice",
        "cssLanguageService.js",
      ),
      "vscode-html-languageservice": vscodeEsmEntry(
        "vscode-html-languageservice",
        "htmlLanguageService.js",
      ),
      "vscode-json-languageservice": vscodeEsmEntry(
        "vscode-json-languageservice",
        "jsonLanguageService.js",
      ),
      "jsonc-parser": join(
        dirname(require.resolve("jsonc-parser/package.json")),
        "lib",
        "esm",
        "main.js",
      ),
    },
    banner: { js: SERVER_BUNDLE_BANNER },
  };
}

export async function copyTypescriptPackage(destDir) {
  await mkdir(destDir, { recursive: true });
  await cp(typescriptPackageDir(), destDir, { recursive: true });
  return destDir;
}

export async function bundleControlPlane(
  outfile = join(desktopRoot, "build", "server", "index.mjs"),
) {
  await mkdir(dirname(outfile), { recursive: true });
  await esbuild.build(
    serverEsbuildOptions({
      entryPoints: [join(repoRoot, "apps/server/src/index.ts")],
      outfile,
    }),
  );
  await copyTypescriptPackage(join(desktopRoot, "build", "server-typescript-ls"));
  return outfile;
}

const runningAsScript =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runningAsScript) {
  const outfile = await bundleControlPlane();
  console.log(`Bundled control plane → ${outfile}`);
}
