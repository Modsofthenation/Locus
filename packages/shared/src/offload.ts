import { TOOL_OUTPUT_UNTRUSTED_MAX } from "./untrusted.js";

/**
 * Offload at the hostile-wrap clip so unsaved bytes are never dropped.
 * ~4k tokens at 4 chars/token.
 */
export const OFFLOAD_RESULT_CHARS = TOOL_OUTPUT_UNTRUSTED_MAX;
/** ~10k tokens — combined parallel-call cap. */
export const OFFLOAD_BATCH_CHARS = 40_000;
export const OFFLOAD_PREVIEW_CHARS = 400;
/** Hard cap on Jira/Grafana JSON before offload still sees a complete-enough dump. */
export const INTEGRATION_JSON_CHARS = 512_000;

export const TOOL_RESULTS_DIR = ".locus/tool-results";

export function guestToolResultPath(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "result";
  return `/workspace/${TOOL_RESULTS_DIR}/${safe}.txt`;
}

export function shouldOffloadToolResult(text: string, limit = OFFLOAD_RESULT_CHARS): boolean {
  return text.length > limit;
}

export function offloadPreview(text: string, keep = OFFLOAD_PREVIEW_CHARS): string {
  if (text.length <= keep * 2 + 20) return text;
  return `${text.slice(0, keep)}\n…\n${text.slice(-keep)}`;
}

export function formatOffloadedResult(path: string, text: string): string {
  return [
    `ok: true. spilled: true. Tool result too large (${text.length} chars). Full output saved to ${path}.`,
    "This is a successful spill, not a failed API. Use file_read, grep, or mcp_code to extract what you need.",
    "Do not re-fetch with exec or curl — this is not a broken API.",
    "",
    `Preview (first and last ${OFFLOAD_PREVIEW_CHARS} chars):`,
    offloadPreview(text),
  ].join("\n");
}

export function encodeIntegrationJson(body: unknown, cap = INTEGRATION_JSON_CHARS): string {
  const text = JSON.stringify(body, null, 2);
  if (text.length <= cap) return text;
  return [
    text.slice(0, cap),
    "",
    `[truncated: ${text.length} chars. Narrow the query or grep the offloaded file. Do not re-fetch with exec or curl.]`,
  ].join("\n");
}

/** Offload largest first until the combined size is under the batch cap. */
export function pickOffloadIndexes(
  texts: string[],
  perResult = OFFLOAD_RESULT_CHARS,
  combined = OFFLOAD_BATCH_CHARS,
): number[] {
  const sizes = texts.map((text, index) => ({ index, size: text.length }));
  const must = new Set(sizes.filter((row) => row.size > perResult).map((row) => row.index));
  let total = texts.reduce((sum, text, index) => (must.has(index) ? sum : sum + text.length), 0);
  const rest = sizes.filter((row) => !must.has(row.index)).sort((a, b) => b.size - a.size);
  for (const row of rest) {
    if (total <= combined) break;
    must.add(row.index);
    total -= row.size;
  }
  return [...must].sort((a, b) => a - b);
}
