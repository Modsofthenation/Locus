import { LOCUS_CHROME_PROFILE_DIR } from "./models/browser.js";

/** Directories hidden from the Files explorer, git dirty stats, mock grep, and the repo index. */
export const WORKSPACE_SKIP_DIRS = [
  ".git",
  "node_modules",
  "dist",
  ".next",
  "coverage",
  "vendor",
  "target",
  "__pycache__",
  ".venv",
  LOCUS_CHROME_PROFILE_DIR,
] as const;

export const WORKSPACE_SKIP_DIR_SET = new Set<string>(WORKSPACE_SKIP_DIRS);

/**
 * Hidden directories that still get indexed and walked (CI, editor, and
 * container config). Everything else starting with `.` stays in Files as a
 * folder but is not indexed, grepped, or counted in git dirty badges.
 */
export const INDEX_DIR_ALLOWLIST = [
  ".github",
  ".gitlab",
  ".circleci",
  ".buildkite",
  ".vscode",
  ".devcontainer",
  ".husky",
  ".config",
] as const;

export const INDEX_DIR_ALLOWLIST_SET = new Set<string>(INDEX_DIR_ALLOWLIST);

/**
 * Named generated trees (also matched by the hidden-dir heuristic). Kept so
 * find/rg call sites can list examples, and so a future non-hidden cache dir
 * can be added here.
 */
export const REPO_MAP_EXTRA_SKIP_DIRS = [
  ".cache",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".nox",
  ".pre-commit-cache",
  ".agents",
  ".parcel-cache",
  ".turbo",
] as const;

export const REPO_MAP_EXTRA_SKIP_DIR_SET = new Set<string>(REPO_MAP_EXTRA_SKIP_DIRS);

export const REPO_MAP_SKIP_DIR_SET = new Set<string>([
  ...WORKSPACE_SKIP_DIRS,
  ...REPO_MAP_EXTRA_SKIP_DIRS,
]);

export function isWorkspaceSkipDir(name: string): boolean {
  return WORKSPACE_SKIP_DIR_SET.has(name);
}

/** True for folders Files still shows, but the index / grep / dirty walk skip. */
export function isRepoMapExtraSkipDir(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (WORKSPACE_SKIP_DIR_SET.has(name)) return false;
  if (INDEX_DIR_ALLOWLIST_SET.has(name)) return false;
  if (REPO_MAP_EXTRA_SKIP_DIR_SET.has(name)) return true;
  const lower = name.toLowerCase();
  if (lower.includes("cache")) return true;
  return name.startsWith(".");
}

export function isRepoMapSkipDir(name: string): boolean {
  return isWorkspaceSkipDir(name) || isRepoMapExtraSkipDir(name);
}

export function workspacePathSkipped(path: string): boolean {
  return path.split(/[\\/]/).some((part) => isWorkspaceSkipDir(part));
}

export function repoMapPathSkipped(path: string): boolean {
  const parts = path.split(/[\\/]/).filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (isWorkspaceSkipDir(part)) return true;
    const last = i === parts.length - 1;
    if (!last && isRepoMapExtraSkipDir(part)) return true;
  }
  return false;
}

/**
 * True when Files should list this path (the extra-skip folder itself) but not
 * its children — unless `listingRoot` is that folder (or inside it), so the
 * explorer can expand `.cursor` / `.cache` on demand.
 */
export function workspaceListingPathDropped(
  path: string,
  _type: "file" | "dir",
  listingRoot = "",
): boolean {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const rootParts = listingRoot.split(/[\\/]/).filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (part === "." || part === "..") return true;
    if (WORKSPACE_SKIP_DIR_SET.has(part)) return true;
    const last = i === parts.length - 1;
    if (last) continue;
    if (!isRepoMapExtraSkipDir(part)) continue;
    const prefix = parts.slice(0, i + 1).join("/");
    if (i < rootParts.length && prefix === rootParts.slice(0, i + 1).join("/")) continue;
    return true;
  }
  return false;
}
