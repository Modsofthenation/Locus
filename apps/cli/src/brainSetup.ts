import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  BRAIN_HOOK_REL,
  brainHookCommand,
  brainHookExcludeBlock,
  brainIngestScript,
  mergeClaudeHooks,
  mergeCodexHooks,
  mergeCursorHooks,
} from "@locus/shared";

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function writeMerged(
  root: string,
  rel: string,
  merge: (existing: string | undefined, command: string) => string,
  command: string,
): Promise<void> {
  const path = join(root, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, merge(await readOptional(path), command), "utf8");
}

/** Write personal Cursor, Claude Code, and Codex hooks plus a git exclude. */
export async function applyBrainSetup(root: string, port = 7420): Promise<string[]> {
  const written: string[] = [];
  const scriptPath = join(root, BRAIN_HOOK_REL);
  await mkdir(dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, brainIngestScript(port), "utf8");
  written.push(BRAIN_HOOK_REL);
  await writeMerged(root, ".cursor/hooks.json", mergeCursorHooks, brainHookCommand("cursor"));
  written.push(".cursor/hooks.json");
  await writeMerged(
    root,
    ".claude/settings.local.json",
    mergeClaudeHooks,
    brainHookCommand("claude"),
  );
  written.push(".claude/settings.local.json");
  await writeMerged(root, ".codex/hooks.json", mergeCodexHooks, brainHookCommand("codex"));
  written.push(".codex/hooks.json");
  try {
    await stat(join(root, ".git"));
  } catch {
    return written;
  }
  const excludePath = join(root, ".git", "info", "exclude");
  await mkdir(dirname(excludePath), { recursive: true });
  const exclude = (await readOptional(excludePath)) ?? "";
  if (!exclude.includes(".locus/hooks/")) {
    const block = brainHookExcludeBlock();
    const next =
      exclude.length === 0 || exclude.endsWith("\n")
        ? `${exclude}${block}`
        : `${exclude}\n${block}`;
    await writeFile(excludePath, next, "utf8");
  }
  written.push(".git/info/exclude");
  return written;
}
