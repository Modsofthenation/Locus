import type { ExtraToolDef } from "./mcp.js";

export interface RepoMemory {
  id: string;
  text: string;
  repo?: string;
  createdAt: string;
  /** Automation run that saved this fact. */
  runId?: string;
}

export const MAX_MEMORIES = 40;
export const MAX_MEMORY_CHARS = 400;
export const REMEMBER_TOOL_NAME = "remember";

const REMEMBER_HINT = "Call remember to add or forget short facts for later. Do not store secrets.";

export const WORKSPACE_REMEMBER_HINT =
  "Call remember to save short durable facts in this workspace (.locus/memories.json). Do not store secrets.";

/** Hint when the shared brain is available (coding sessions). */
export const BRAIN_REMEMBER_HINT =
  "Call remember with action=add to save into the shared brain. list / forget / clear edit the workspace override list (.locus/memories.json). Do not store secrets.";

export function isRememberToolName(name: string): boolean {
  return name === REMEMBER_TOOL_NAME;
}

export function parseRepoMemory(raw: unknown): RepoMemory | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : undefined;
  const text = typeof value.text === "string" ? value.text.trim().slice(0, MAX_MEMORY_CHARS) : "";
  if (!id || !text) return undefined;
  const repo = typeof value.repo === "string" && value.repo.trim() ? value.repo.trim() : undefined;
  const createdAt =
    typeof value.createdAt === "string" && value.createdAt.trim()
      ? value.createdAt
      : new Date().toISOString();
  const runId =
    typeof value.runId === "string" && value.runId.trim() ? value.runId.trim() : undefined;
  return { id, text, repo, createdAt, ...(runId ? { runId } : {}) };
}

export function normalizeMemories(raw: unknown): RepoMemory[] {
  if (!Array.isArray(raw)) return [];
  const out: RepoMemory[] = [];
  for (const row of raw) {
    const memory = parseRepoMemory(row);
    if (memory) out.push(memory);
    if (out.length >= MAX_MEMORIES) break;
  }
  return out;
}

export function memoriesForRepo(memories: RepoMemory[], repoUrl?: string): RepoMemory[] {
  if (!repoUrl) return memories.slice(-12);
  const key = repoUrl.toLowerCase().replace(/\.git$/, "");
  const matched = memories.filter(
    (row) => !row.repo || row.repo.toLowerCase().replace(/\.git$/, "") === key,
  );
  return (matched.length ? matched : memories).slice(-12);
}

export function formatMemoriesPrompt(memories: RepoMemory[]): string {
  if (!memories.length) return "";
  return ["Known facts from earlier runs:", ...memories.map((row) => `- ${row.text}`)].join("\n");
}

export function formatAutomationMemoryPrompt(memories: RepoMemory[]): string {
  const facts = formatMemoriesPrompt(memories);
  return facts
    ? `${facts}\n${REMEMBER_HINT}`
    : `No saved facts from earlier runs.\n${REMEMBER_HINT}`;
}

export function mergeMemoryPrompts(...chunks: Array<string | undefined>): string {
  return chunks
    .map((chunk) => chunk?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

export function newMemoryId(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function replaceMemoryText(
  current: RepoMemory[],
  id: string,
  text: string,
): { memories: RepoMemory[]; output: string } {
  const memories = normalizeMemories(current);
  const next = text.trim().slice(0, MAX_MEMORY_CHARS);
  if (!next) return { memories, output: "text is required" };
  if (looksLikeRememberedSecret(next)) {
    return { memories, output: "Refusing to store a secret. Keep tokens in Settings." };
  }
  const idx = memories.findIndex((row) => row.id === id);
  if (idx < 0) return { memories, output: "No matching fact." };
  if (memories.some((row, i) => i !== idx && row.text === next)) {
    return { memories, output: "That fact is already saved." };
  }
  memories[idx] = { ...memories[idx]!, text: next };
  return { memories, output: `Updated: ${next}` };
}

export function applyRemember(
  current: RepoMemory[],
  args: Record<string, unknown>,
  opts: { id?: string; repo?: string; createdAt?: string; runId?: string } = {},
): { memories: RepoMemory[]; output: string } {
  const action = typeof args.action === "string" ? args.action.trim().toLowerCase() : "list";
  const memories = normalizeMemories(current);
  if (action === "list" || !action) {
    return { memories, output: formatMemoriesPrompt(memories) || "No saved facts." };
  }
  if (action === "clear") {
    return { memories: [], output: "Cleared all saved facts." };
  }
  if (action === "add") {
    const text = typeof args.text === "string" ? args.text.trim().slice(0, MAX_MEMORY_CHARS) : "";
    if (!text) return { memories, output: "text is required to add a fact" };
    if (looksLikeRememberedSecret(text)) {
      return { memories, output: "Refusing to store a secret. Keep tokens in Settings." };
    }
    if (memories.some((row) => row.text === text)) {
      return { memories, output: "That fact is already saved." };
    }
    if (memories.length >= MAX_MEMORIES) memories.shift();
    const row = parseRepoMemory({
      id: opts.id || `m${memories.length + 1}`,
      text,
      repo: typeof args.repo === "string" && args.repo.trim() ? args.repo.trim() : opts.repo,
      createdAt: opts.createdAt,
      runId: opts.runId,
    });
    if (!row) return { memories, output: "Could not save that fact." };
    memories.push(row);
    return { memories, output: `Saved (${memories.length}/${MAX_MEMORIES}): ${row.text}` };
  }
  if (action === "forget") {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    const text = typeof args.text === "string" ? args.text.trim() : "";
    const idx = memories.findIndex((row) => (id && row.id === id) || (text && row.text === text));
    if (idx < 0) {
      return { memories, output: id || text ? "No matching fact." : "id or text is required" };
    }
    const [removed] = memories.splice(idx, 1);
    return { memories, output: `Forgot: ${removed?.text ?? id}` };
  }
  return { memories, output: `Unknown remember action: ${action}` };
}

export function sessionOffersRemember(session: {
  kind?: string;
  automationId?: string;
  persistMemory?: boolean;
  runtime?: string;
}): boolean {
  if (
    session.kind === "design" ||
    session.kind === "game" ||
    session.kind === "assets" ||
    session.kind === "review" ||
    session.kind === "setup" ||
    session.kind === "project"
  )
    return false;
  if (session.automationId) return session.persistMemory === true;
  return session.runtime !== "vm";
}

export const REMEMBER_TOOL: ExtraToolDef = {
  name: REMEMBER_TOOL_NAME,
  description:
    "Save durable conclusions into the shared brain (action=add). list / forget / clear edit the workspace override list (.locus/memories.json). Do not store secrets.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "list, add, forget, or clear",
        enum: ["list", "add", "forget", "clear"],
      },
      text: { type: "string", description: "Fact text for add, or the exact text to forget." },
      id: { type: "string", description: "Fact id for forget." },
      repo: { type: "string", description: "Optional repo URL this fact belongs to." },
    },
    required: ["action"],
  },
};

export function looksLikeRememberedSecret(text: string): boolean {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return true;
  if (
    /\b(sk-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|ph_[a-f0-9]{32}|cx_[a-f0-9]{32}|ATATT[A-Za-z0-9_\-=]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/.test(
      text,
    )
  ) {
    return true;
  }
  return /\b(api[_-]?key|secret|token|password|passwd|authorization)\b\s*[:=]\s*\S{8,}/i.test(text);
}
