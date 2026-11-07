import { LOCUS_CANVAS_CHANGED_ON_DISK } from "@locus/shared";

/** Cursor CLI "changed on disk" means Locus (or the operator) wrote index.html, not a model Write. */
export function annotateCanvasChangedOnDisk(result: string): string {
  if (!/changed on disk/i.test(result) || result.includes(LOCUS_CANVAS_CHANGED_ON_DISK)) {
    return result;
  }
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.error === "string") {
        parsed.error = `${parsed.error}\n${LOCUS_CANVAS_CHANGED_ON_DISK}`;
      }
      if (typeof parsed.modelVisibleError === "string") {
        parsed.modelVisibleError = `${parsed.modelVisibleError}\n${LOCUS_CANVAS_CHANGED_ON_DISK}`;
      }
      return JSON.stringify(parsed);
    }
  } catch {
    /* plain text */
  }
  return `${result}\n${LOCUS_CANVAS_CHANGED_ON_DISK}`;
}

/** Completed Cursor CLI tools are ok unless the payload is structured as a failure. */
export function cursorCliToolCallOk(status: string, result?: string): boolean | undefined {
  if (status !== "completed") return undefined;
  if (!result?.trim()) return true;
  try {
    if (structuredToolFailure(JSON.parse(result))) return false;
  } catch {
    /* plain text, including comments that mention "fail" */
  }
  return true;
}

export function structuredToolFailure(value: unknown, depth = 0): boolean {
  if (depth > 5 || value == null) return false;
  if (Array.isArray(value)) return value.some((item) => structuredToolFailure(item, depth + 1));
  if (typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (row.isError === true || row.is_error === true || row.ok === false) return true;
  if (row.status === "failed" || row.status === "blocked" || row.status === "error") return true;
  if (row.success == null) {
    if (typeof row.error === "string" && row.error.trim()) return true;
    if (typeof row.failure === "string" && row.failure.trim()) return true;
  }
  if (typeof row.exitCode === "number" && row.exitCode !== 0) return true;
  if (typeof row.exit_code === "number" && row.exit_code !== 0) return true;
  for (const key of ["structuredContent", "structured_content", "details", "result"]) {
    if (structuredToolFailure(row[key], depth + 1)) return true;
  }
  const content = row.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (structuredToolFailure(item, depth + 1)) return true;
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { text?: unknown }).text === "string" &&
        /^Harness blocked\b/m.test((item as { text: string }).text.trim())
      ) {
        return true;
      }
    }
  }
  return false;
}
