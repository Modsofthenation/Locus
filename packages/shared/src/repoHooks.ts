/** Repo-defined harness hooks in `.locus/hooks.json`. Prompt text is not a substitute. */

export const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "Stop"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface RepoHook {
  event: HookEvent;
  matcher?: string;
  command: string;
}

export interface RepoHooks {
  PreToolUse: RepoHook[];
  PostToolUse: RepoHook[];
  Stop: RepoHook[];
}

const EMPTY: RepoHooks = { PreToolUse: [], PostToolUse: [], Stop: [] };

export function parseRepoHooks(raw: unknown): RepoHooks {
  if (!raw || typeof raw !== "object") return EMPTY;
  const value = raw as Record<string, unknown>;
  return {
    PreToolUse: parseHookList("PreToolUse", value.PreToolUse ?? value.preToolUse),
    PostToolUse: parseHookList("PostToolUse", value.PostToolUse ?? value.postToolUse),
    Stop: parseHookList("Stop", value.Stop ?? value.stop),
  };
}

function parseHookList(event: HookEvent, raw: unknown): RepoHook[] {
  if (!Array.isArray(raw)) return [];
  const out: RepoHook[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const command = typeof row.command === "string" ? row.command.trim() : "";
    if (!command) continue;
    const matcher =
      typeof row.matcher === "string" && row.matcher.trim() ? row.matcher.trim() : undefined;
    out.push({ event, command, matcher });
  }
  return out;
}

export function hooksForTool(
  hooks: RepoHooks,
  event: "PreToolUse" | "PostToolUse",
  tool: string,
): RepoHook[] {
  return hooks[event].filter((hook) => hookMatches(hook.matcher, tool));
}

export function hookMatches(matcher: string | undefined, tool: string): boolean {
  if (!matcher) return true;
  try {
    return new RegExp(matcher, "i").test(tool);
  } catch {
    return matcher.toLowerCase() === tool.toLowerCase();
  }
}
