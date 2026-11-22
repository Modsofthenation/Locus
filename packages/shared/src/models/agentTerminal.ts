/** Agent Terminal: an interactive coding-agent CLI (or shell) in a PTY inside the agent's workspace. */

export type SessionViewMode = "chat" | "terminal";

export function isSessionViewMode(value: unknown): value is SessionViewMode {
  return value === "chat" || value === "terminal";
}

export type AgentTerminalPreset = {
  id: string;
  label: string;
  /** Command line to run. `null` is the user's interactive shell. */
  command: string | null;
};

export const AGENT_TERMINAL_SHELL = "shell";

export const AGENT_TERMINAL_PRESETS: readonly AgentTerminalPreset[] = [
  { id: "claude", label: "Claude Code", command: "claude" },
  { id: "codex", label: "Codex", command: "codex" },
  { id: "gemini", label: "Gemini", command: "gemini" },
  { id: "opencode", label: "opencode", command: "opencode" },
  { id: "aider", label: "Aider", command: "aider" },
  { id: "cursor-agent", label: "Cursor Agent", command: "cursor-agent" },
  { id: "kiro-cli", label: "Kiro", command: "kiro-cli" },
  { id: AGENT_TERMINAL_SHELL, label: "Shell", command: null },
];

/** Concurrent agent terminals per session. */
export const AGENT_TERMINAL_MAX = 4;

/** How long output must stay quiet before a prompt-looking tail counts as Needs you. */
export const AGENT_TERMINAL_QUIET_MS = 8_000;

const NEEDS_YOU_PREFIX = "Terminal: ";

/** `needsHuman` text the terminal registry sets, so it only clears its own flag. */
export function agentTerminalNeedsYou(line: string): string {
  const text = line.trim().replace(/\s+/g, " ");
  const clipped = text.length > 120 ? `${text.slice(0, 119)}…` : text;
  return `${NEEDS_YOU_PREFIX}${clipped || "waiting for input"}`;
}

export function isAgentTerminalNeedsYou(value: string | undefined): boolean {
  return Boolean(value?.startsWith(NEEDS_YOU_PREFIX));
}

export function agentTerminalPreset(id: string | undefined): AgentTerminalPreset | undefined {
  return AGENT_TERMINAL_PRESETS.find((row) => row.id === id);
}

/** Session provider → the CLI the Terminal tab opens by default. */
export function defaultAgentTerminalPresetId(
  provider: { kind?: string; baseUrl?: string } | undefined,
): string {
  const kind = provider?.kind ?? "";
  let scheme = "";
  try {
    scheme = provider?.baseUrl ? new URL(provider.baseUrl.trim()).protocol : "";
  } catch {
    scheme = "";
  }
  if (kind === "claude-code" || scheme === "claude-code:") return "claude";
  if (kind === "codex-cli" || scheme === "codex-cli:") return "codex";
  if (kind === "cursor-cli" || scheme === "cursor-cli:") return "cursor-agent";
  if (kind === "kiro-cli" || scheme === "kiro-cli:") return "kiro-cli";
  return AGENT_TERMINAL_SHELL;
}

export type AgentTerminalCommand = { label: string; command: string | null };

/**
 * A preset id or a raw command line. Empty falls back to `fallbackId`.
 * Returns null for input that cannot be a single command line.
 */
export function resolveAgentTerminalCommand(
  raw: string | undefined | null,
  fallbackId: string = AGENT_TERMINAL_SHELL,
): AgentTerminalCommand | null {
  const text = (raw ?? "").trim();
  if (!text) {
    const preset = agentTerminalPreset(fallbackId) ?? agentTerminalPreset(AGENT_TERMINAL_SHELL)!;
    return { label: preset.label, command: preset.command };
  }
  const preset = agentTerminalPreset(text);
  if (preset) return { label: preset.label, command: preset.command };
  // eslint-disable-next-line no-control-regex
  if (text.length > 512 || /[\u0000-\u0008\u000a-\u001f\u007f]/.test(text)) return null;
  return { label: text.length > 40 ? `${text.slice(0, 39)}…` : text, command: text };
}

export type AgentTerminalInfo = {
  id: string;
  label: string;
  command: string | null;
  startedAt: string;
  /** Quiet on a prompt-looking line. */
  waiting?: boolean;
};

export type AgentTerminalStatus = {
  /** False for runtimes that cannot host a PTY (VM, worker, stopped container). */
  available: boolean;
  reason?: string;
  defaultPreset: string;
  terminals: AgentTerminalInfo[];
};

const ANSI =
  // eslint-disable-next-line no-control-regex -- terminal escape codes are control characters
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[PX^_][^\u001b]*\u001b\\|[@-Z\\-_])/g;

/** Remove terminal escape sequences and resolve carriage-return overwrites per line. */
export function stripTerminalAnsi(text: string): string {
  return (
    text
      .replace(ANSI, "")
      .split("\n")
      .map((line) => {
        const parts = line.split("\r").filter((part) => part.length);
        return parts.length ? parts[parts.length - 1]! : "";
      })
      .join("\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
  );
}

const BOX_EDGE_END = /[\s│┃║╰╯╭╮─━═]+$/u;
const BOX_EDGE_START = /^[\s│┃║╰╯╭╮─━═]+/u;

/** Last non-blank line of terminal output, ANSI stripped. */
export function lastTerminalLine(output: string): string {
  const lines = stripTerminalAnsi(output).split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.replace(BOX_EDGE_END, "").replace(BOX_EDGE_START, "");
    if (line) return line;
  }
  return "";
}

const PROMPT_TAIL = /[?>❯›»]\s*$/u;
const PROMPT_YES_NO = /(\(y\/n\)|\[y\/n\]|\(yes\/no\)|\[yes\/no\])\s*:?\s*$/i;
const PROMPT_WORDS = /\b(do you want|would you like|allow|approve|press enter)\b/i;

/**
 * Whether the tail of quiet terminal output looks like the CLI is waiting on the person:
 * a question, a `>` / `❯` prompt, a y/n choice, or an approval line.
 */
export function looksLikeTerminalPrompt(output: string): boolean {
  const line = lastTerminalLine(output);
  if (!line) return false;
  if (PROMPT_YES_NO.test(line)) return true;
  if (PROMPT_WORDS.test(line)) return true;
  return PROMPT_TAIL.test(line);
}
