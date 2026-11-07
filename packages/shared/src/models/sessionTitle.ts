import { sessionKind, type SessionKind } from "./session.js";
import {
  guestLabel,
  parseDockerImage,
  sessionRuntime,
  type AgentRuntime,
  type GuestOs,
} from "./vm.js";
import type { SessionPersona } from "./persona.js";

/** Sidebar and command-palette rows clip around this width. */
export const SESSION_PROMPT_TITLE_MAX = 56;

export type SessionTitleSource = {
  title?: string;
  kind?: SessionKind;
  runtime?: AgentRuntime;
  os: GuestOs;
  dockerImage?: string;
  repo?: { url?: string } | null;
  persona?: SessionPersona | null;
  prompt?: string;
};

function firstPromptLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((row) => row.trim())
      .find(Boolean) ?? ""
  );
}

function clipTitle(text: string, max = SESSION_PROMPT_TITLE_MAX): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const clipped = collapsed.slice(0, max);
  const lastSpace = clipped.lastIndexOf(" ");
  const body = (lastSpace > 24 ? clipped.slice(0, lastSpace) : clipped).trimEnd();
  return `${body}…`;
}

/** Strip a leading `/plan ` (or other slash command) so the title is the task. */
function stripLeadingSlash(line: string): string {
  const stripped = line.replace(/^\/[a-z][\w-]*\s+/i, "").trim();
  return stripped || line;
}

export function titleFromPrompt(text: string): string | undefined {
  const line = firstPromptLine(text);
  if (!line) return undefined;
  const title = clipTitle(stripLeadingSlash(line));
  return title || undefined;
}

export function generatedSessionTitle(input: SessionTitleSource): string {
  if (sessionKind(input) === "design") return "Untitled design";
  if (sessionKind(input) === "game") return "Untitled game";
  if (sessionKind(input) === "assets") return "Untitled asset";
  if (sessionKind(input) === "ide") return "Workspace";
  if (sessionKind(input) === "board") return "Board chat";
  if (sessionKind(input) === "project") return "Project coordinator";
  const runtime = sessionRuntime(input);
  const label =
    runtime === "host"
      ? "host"
      : runtime === "docker"
        ? (parseDockerImage(input.dockerImage ?? "") ?? "container")
        : guestLabel(input.os);
  if (input.repo?.url) {
    const name = input.repo.url
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean)
      .at(-1);
    if (name) return `${name} · ${label}`;
  }
  return runtime === "host" ? "Host agent" : `${label} agent`;
}

export function isGeneratedSessionTitle(session: SessionTitleSource): boolean {
  return session.title?.trim() === generatedSessionTitle(session);
}

export function titleFromCreateInput(input: SessionTitleSource): string {
  const explicit = input.title?.trim();
  if (explicit) return explicit;
  const personaName = input.persona?.displayName?.trim();
  if (personaName) return personaName;
  return titleFromPrompt(input.prompt ?? "") ?? generatedSessionTitle(input);
}

export function applyPromptTitle<T extends SessionTitleSource & { title: string }>(
  session: T,
  prompt: string,
): boolean {
  if (!isGeneratedSessionTitle(session)) return false;
  const next = titleFromPrompt(prompt);
  if (!next || next === session.title) return false;
  session.title = next;
  return true;
}
