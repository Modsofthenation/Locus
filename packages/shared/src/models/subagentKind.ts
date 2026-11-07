export const SUBAGENT_KINDS = ["explore", "implement", "review"] as const;
export type SubagentKind = (typeof SUBAGENT_KINDS)[number];
export const DEFAULT_SUBAGENT_KIND: SubagentKind = "explore";

export function isSubagentKind(value: unknown): value is SubagentKind {
  return value === "explore" || value === "review" || value === "implement";
}

export function parseSubagentKind(value: unknown): SubagentKind | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  return isSubagentKind(key) ? key : undefined;
}

export function sessionDefaultSubagent(session?: { defaultSubagent?: SubagentKind }): SubagentKind {
  return parseSubagentKind(session?.defaultSubagent) ?? DEFAULT_SUBAGENT_KIND;
}

export function formatSubagentKind(kind: SubagentKind): string {
  if (kind === "review") return "Review";
  if (kind === "implement") return "Implement";
  return "Explore";
}

export function subagentKindHint(kind: SubagentKind): string {
  if (kind === "review") return "bugs, risks, and missing tests";
  if (kind === "implement") return "patch and test, no push";
  return "read-only research";
}

const KIND = "(explore|implement|review)";

const FROM_PROMPT_RE = new RegExp(
  [
    String.raw`(?:set|change|switch|make)\s+(?:the\s+)?(?:default\s+)?sub-?agents?\s+(?:default\s+)?(?:to|as|=)\s+${KIND}\b`,
    String.raw`default\s+sub-?agents?(?:\s+kind)?\s*(?:to|is|=|:)\s*${KIND}\b`,
    String.raw`(?:always|from now on)\s+(?:use |run |spawn )?(?:the |a |an )?${KIND}\s+sub-?agents?\b`,
    String.raw`(?:use|spawn|run|ask|with)\s+(?:a |an |the )?${KIND}\s+sub-?agents?\b`,
    String.raw`${KIND}\s+sub-?agents?\b`,
    String.raw`sub-?agents?(?:\s+kind)?\s*[:=]\s*${KIND}\b`,
  ].join("|"),
  "gi",
);

const PERSIST_RE = new RegExp(
  [
    String.raw`(?:set|change|switch|make)\s+(?:the\s+)?(?:default\s+)?sub-?agents?\s+(?:default\s+)?(?:to|as|=)\s+${KIND}\b`,
    String.raw`default\s+sub-?agents?(?:\s+kind)?\s*(?:to|is|=|:)\s*${KIND}\b`,
    String.raw`(?:always|from now on)\s+(?:use |run |spawn )?(?:the |a |an )?${KIND}\s+sub-?agents?\b`,
  ].join("|"),
  "gi",
);

function lastCapturedKind(text: string, re: RegExp): SubagentKind | undefined {
  re.lastIndex = 0;
  let found: SubagentKind | undefined;
  for (const match of text.matchAll(re)) {
    const raw = match.slice(1).find((group) => group);
    const kind = parseSubagentKind(raw);
    if (kind) found = kind;
  }
  return found;
}

/** Last explicit kind mention in operator chat (this turn). */
export function subagentKindFromPrompt(text: string): SubagentKind | undefined {
  return lastCapturedKind(text, FROM_PROMPT_RE);
}

/** Operator asked to persist this as the session default. */
export function requestedDefaultSubagent(text: string): SubagentKind | undefined {
  return lastCapturedKind(text, PERSIST_RE);
}

export function resolveSubagentKind(input: {
  toolKind?: unknown;
  prompt?: string;
  sessionDefault?: unknown;
}): SubagentKind {
  return (
    parseSubagentKind(input.toolKind) ??
    subagentKindFromPrompt(input.prompt ?? "") ??
    parseSubagentKind(input.sessionDefault) ??
    DEFAULT_SUBAGENT_KIND
  );
}

export function subagentSystemPrompt(kind: SubagentKind, focus?: string): string {
  const lines =
    kind === "review"
      ? [
          "You are an isolated child agent reviewing code for bugs, risks, and missing tests.",
          "Use read-only tools. Do not edit files, commit, or spawn another agent.",
          "Focus on high-conviction issues: incorrect behavior, missing tests, and risky seams. Skip cosmetic nits.",
          "Return a concise summary of findings, decisions, and open questions. Do not dump a transcript.",
        ]
      : kind === "implement"
        ? [
            "You are an isolated child agent that implements a bounded change.",
            "You may apply_patch, file_write, and run tests via exec. Do not git_push, open a PR, or spawn another agent.",
            "Return a concise summary of what you changed, how you tested it, and open questions. Do not dump a transcript.",
          ]
        : [
            "You are an isolated child agent for bounded research or exploration.",
            "Use read-only tools. Do not edit files, commit, or spawn another agent.",
            "Return a concise summary of findings, decisions, and open questions. Do not dump a transcript.",
          ];
  if (focus?.trim()) lines.push(`Stay inside: ${focus.trim()}`);
  return lines.join("\n");
}

export function spawnAgentKindNote(kind: SubagentKind): string {
  return `Default sub-agent is ${kind} (${subagentKindHint(kind)}). spawn_agent uses that unless you pass kind, or the operator asked for a different kind this turn (explore, implement, or review).`;
}
