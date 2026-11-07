/** Personal CLI hooks that post a transcript tail to the loopback brain. */

export const BRAIN_HOOK_REL = ".locus/hooks/brain-ingest.mjs";

export const BRAIN_HOOK_EXCLUDE_PATHS = [
  ".locus/hooks/",
  ".cursor/hooks.json",
  ".claude/settings.local.json",
  ".codex/hooks.json",
] as const;

const SECRET_REDACT =
  /\b(sk-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g;

export function redactHookSecrets(text: string): string {
  return text.replace(SECRET_REDACT, "[redacted]");
}

export function brainIngestScript(port = 7420): string {
  const safePort = Number.isFinite(port) && port > 0 && port < 65536 ? Math.round(port) : 7420;
  return `#!/usr/bin/env node
// Personal Locus brain hook. Fail open. Never block the editor session.
import { readFile } from "node:fs/promises";

const source = process.argv[2] || "hook";
const port = Number(process.env.LOCUS_PORT || ${safePort});
const secret =
  /\\b(sk-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{10,})\\b/g;

function clip(text) {
  const redacted = String(text || "").replace(secret, "[redacted]").trim();
  return redacted.length > 12000 ? redacted.slice(-12000) : redacted;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { text: raw };
  }
}

function textFrom(payload) {
  if (!payload || typeof payload !== "object") return "";
  const direct = ["text", "response", "message", "last_assistant_message", "transcript"]
    .map((key) => payload[key])
    .find((value) => typeof value === "string" && value.trim());
  return typeof direct === "string" ? direct : "";
}

try {
  const payload = await readStdin();
  let text = textFrom(payload);
  const transcriptPath = typeof payload.transcript_path === "string" ? payload.transcript_path : "";
  if (!text && transcriptPath) {
    try {
      text = await readFile(transcriptPath, "utf8");
    } catch {
      text = "";
    }
  }
  text = clip(text);
  if (text) {
    await fetch("http://127.0.0.1:" + port + "/api/brain/transcript", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, source, repo: process.cwd() }),
    }).catch(() => undefined);
  }
} catch {
  /* fail open */
}
process.exit(0);
`;
}

export type BrainHookHarness = "cursor" | "claude" | "codex";

export function brainHookCommand(harness: BrainHookHarness): string {
  return `node ${BRAIN_HOOK_REL} ${harness}`;
}

function parseJson(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function commandListed(value: unknown, command: string): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((row) => {
    if (!row || typeof row !== "object") return false;
    const record = row as Record<string, unknown>;
    if (record.command === command) return true;
    if (Array.isArray(record.hooks)) return commandListed(record.hooks, command);
    return false;
  });
}

export function mergeCursorHooks(existing: string | undefined, command: string): string {
  const parsed = parseJson(existing);
  if (!parsed) throw new Error(".cursor/hooks.json is not a JSON object");
  const hooks =
    parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks)
      ? { ...(parsed.hooks as Record<string, unknown>) }
      : {};
  const current = Array.isArray(hooks.afterAgentResponse) ? [...hooks.afterAgentResponse] : [];
  if (!commandListed(current, command)) current.push({ command });
  return (
    JSON.stringify(
      { ...parsed, version: parsed.version ?? 1, hooks: { ...hooks, afterAgentResponse: current } },
      null,
      2,
    ) + "\n"
  );
}

export function mergeClaudeHooks(existing: string | undefined, command: string): string {
  const parsed = parseJson(existing);
  if (!parsed) throw new Error(".claude/settings.local.json is not a JSON object");
  const hooks =
    parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks)
      ? { ...(parsed.hooks as Record<string, unknown>) }
      : {};
  const current = Array.isArray(hooks.Stop) ? [...hooks.Stop] : [];
  if (!commandListed(current, command)) {
    current.push({ hooks: [{ type: "command", command }] });
  }
  return JSON.stringify({ ...parsed, hooks: { ...hooks, Stop: current } }, null, 2) + "\n";
}

export function mergeCodexHooks(existing: string | undefined, command: string): string {
  const parsed = parseJson(existing);
  if (!parsed) throw new Error(".codex/hooks.json is not a JSON object");
  const hooks =
    parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks)
      ? { ...(parsed.hooks as Record<string, unknown>) }
      : {};
  const current = Array.isArray(hooks.Stop) ? [...hooks.Stop] : [];
  if (!commandListed(current, command)) current.push({ command });
  return JSON.stringify({ ...parsed, hooks: { ...hooks, Stop: current } }, null, 2) + "\n";
}

export function brainHookExcludeBlock(): string {
  return (
    ["# Locus brain hooks (personal, not committed)", ...BRAIN_HOOK_EXCLUDE_PATHS].join("\n") + "\n"
  );
}
