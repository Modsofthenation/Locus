import { offsetsToLines, type AiProvider } from "@locus/shared";
import { collectText, type ChatEngine } from "@locus/providers";

export const INLINE_EDIT_TIMEOUT_MS = 60_000;
export const INLINE_EDIT_NO_COMPLETIONS =
  "Inline edits need an OpenAI-compatible or Anthropic provider. Use Ask to send this to the agent.";

export const INLINE_EDIT_SYSTEM =
  "You perform inline code edits. Reply with the code to insert or substitute only. Do not explain. Do not wrap the answer in markdown fences unless the replacement itself is a markdown document.";

const MAX_SNIPPET = 16_000;
const MAX_CONTEXT = 4_000;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…`;
}

export function parseInlineEditReply(raw: string): string {
  const match = raw.match(/```(?:[\w.+-]+)?\r?\n([\s\S]*?)```/);
  if (match) return match[1]!.replace(/\n$/, "");
  return raw.replace(/^\n/, "").replace(/\n$/, "");
}

export function formatInlineEditPrompt(input: {
  path: string;
  content: string;
  instruction: string;
  start: number;
  end: number;
}): string {
  const content = input.content;
  const from = Math.max(0, Math.min(content.length, Math.min(input.start, input.end)));
  const to = Math.max(0, Math.min(content.length, Math.max(input.start, input.end)));
  const loc = offsetsToLines(content, from, to);
  const instruction = input.instruction.trim();
  const path = input.path.trim() || "untitled";
  if (to > from) {
    return [
      `File: ${path}`,
      `Replace lines ${loc.startLine}-${loc.endLine} according to this instruction:`,
      instruction,
      "",
      "Selected code:",
      "```",
      clip(content.slice(from, to), MAX_SNIPPET),
      "```",
      "",
      "Reply with the replacement code only.",
    ].join("\n");
  }
  return [
    `File: ${path}`,
    `Insert code at line ${loc.startLine} according to this instruction:`,
    instruction,
    "",
    "Context before the cursor:",
    "```",
    clip(content.slice(Math.max(0, from - MAX_CONTEXT), from), MAX_CONTEXT),
    "```",
    "",
    "Context after the cursor:",
    "```",
    clip(content.slice(to, Math.min(content.length, to + MAX_CONTEXT)), MAX_CONTEXT),
    "```",
    "",
    "Reply with the code to insert only.",
  ].join("\n");
}

export async function runWorkspaceInlineEdit(input: {
  provider: AiProvider;
  model: string;
  path: string;
  content: string;
  instruction: string;
  start: number;
  end: number;
  complete: ChatEngine;
  signal?: AbortSignal;
}): Promise<{ text: string }> {
  const instruction = input.instruction.trim();
  if (!instruction) throw new Error("Instruction is required");
  const start = Number.isFinite(input.start) ? input.start : 0;
  const end = Number.isFinite(input.end) ? input.end : start;
  const text = await collectText(
    input.complete({
      provider: input.provider,
      model: input.model,
      system: INLINE_EDIT_SYSTEM,
      messages: [
        {
          id: "inline-edit",
          role: "user",
          content: formatInlineEditPrompt({
            path: input.path,
            content: input.content,
            instruction,
            start,
            end,
          }),
          createdAt: new Date().toISOString(),
        },
      ],
      allowedTools: [],
      stream: false,
      maxTokens: 4096,
      signal: input.signal,
    }),
  );
  const next = parseInlineEditReply(text);
  if (!next.trim() && start === end) throw new Error("The model returned an empty edit");
  return { text: next };
}
