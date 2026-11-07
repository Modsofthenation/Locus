import {
  enumerateDiffRows,
  parseDiffLayout,
  type DiffLayout,
  type NumberedDiffLine,
  type PatchHunk,
} from "@locus/shared";
import { highlightSource } from "./highlight";

export type DiffLineRef = {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
};

/** First paint of a file stops here so a 2k-line add does not mount every row. */
export const PATCH_VISIBLE_ROW_BUDGET = 400;

export function diffLineRef(path: string, row: NumberedDiffLine): DiffLineRef | undefined {
  if (row.kind === "del" && row.oldLine != null) return { path, line: row.oldLine, side: "LEFT" };
  if (row.newLine != null) return { path, line: row.newLine, side: "RIGHT" };
  if (row.oldLine != null) return { path, line: row.oldLine, side: "LEFT" };
  return undefined;
}

export function fileRowCount(file: { hunks: ReadonlyArray<{ rows: readonly unknown[] }> }): number {
  let n = 0;
  for (const hunk of file.hunks) n += hunk.rows.length;
  return n;
}

export function limitPatchHunks<T extends { rows: readonly unknown[] }>(
  hunks: readonly T[],
  budget: number,
): { hunks: T[]; hidden: number } {
  let total = 0;
  for (const hunk of hunks) total += hunk.rows.length;
  if (!Number.isFinite(budget) || budget >= total) return { hunks: hunks.slice(), hidden: 0 };

  const out: T[] = [];
  let left = budget;
  let hidden = 0;
  for (const hunk of hunks) {
    if (left <= 0) {
      hidden += hunk.rows.length;
      continue;
    }
    if (hunk.rows.length <= left) {
      out.push(hunk);
      left -= hunk.rows.length;
      continue;
    }
    out.push({ ...hunk, rows: hunk.rows.slice(0, left) } as T);
    hidden += hunk.rows.length - left;
    left = 0;
  }
  return { hunks: out, hidden };
}

function sign(kind: NumberedDiffLine["kind"]): string {
  if (kind === "add") return "+";
  if (kind === "del") return "-";
  return " ";
}

function lineHtml(
  row: NumberedDiffLine | undefined,
  lang: string,
  clickable: boolean,
  fallbackSide: "LEFT" | "RIGHT",
): string {
  if (!row) {
    return `<span class="patch-line empty" aria-hidden><span class="patch-ln"></span><span class="patch-gutter"></span><span class="patch-text"> </span></span>`;
  }
  const ref = diffLineRef("", row) ?? {
    path: "",
    line: (fallbackSide === "LEFT" ? row.oldLine : row.newLine) ?? 0,
    side: fallbackSide,
  };
  const tag = clickable && ref.line > 0 ? "button" : "span";
  const type = tag === "button" ? ' type="button"' : "";
  const extra = clickable && ref.line > 0 ? " clickable" : "";
  const ln = fallbackSide === "LEFT" ? (row.oldLine ?? "") : (row.newLine ?? "");
  return `<${tag}${type} class="patch-line ${row.kind}${extra}" data-diff-line="1" data-line="${ref.line || ""}" data-side="${ref.side}"><span class="patch-ln" aria-hidden>${ln}</span><span class="patch-gutter" aria-hidden>${sign(row.kind)}</span><span class="patch-text">${highlightSource(row.text || " ", lang)}</span></${tag}>`;
}

function pairSplitRows(rows: NumberedDiffLine[]): Array<{
  left?: NumberedDiffLine;
  right?: NumberedDiffLine;
}> {
  const out: Array<{ left?: NumberedDiffLine; right?: NumberedDiffLine }> = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.kind === "ctx") {
      out.push({ left: row, right: row });
      i += 1;
      continue;
    }
    const dels: NumberedDiffLine[] = [];
    const adds: NumberedDiffLine[] = [];
    while (i < rows.length && rows[i]!.kind === "del") {
      dels.push(rows[i]!);
      i += 1;
    }
    while (i < rows.length && rows[i]!.kind === "add") {
      adds.push(rows[i]!);
      i += 1;
    }
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k += 1) out.push({ left: dels[k], right: adds[k] });
  }
  return out;
}

/** One HTML string per hunk so React does not allocate a node per diff line. */
export function renderPatchHunkHtml(
  hunk: PatchHunk,
  lang: string,
  clickable: boolean,
  layout: DiffLayout = "unified",
): string {
  const rows = enumerateDiffRows(hunk);
  if (parseDiffLayout(layout) === "split") {
    let html = "";
    for (const pair of pairSplitRows(rows)) {
      html += `<span class="patch-split-row">${lineHtml(pair.left, lang, clickable, "LEFT")}${lineHtml(pair.right, lang, clickable, "RIGHT")}</span>`;
    }
    return html;
  }
  let html = "";
  for (const row of rows) {
    const ref = diffLineRef("", row);
    const tag = clickable && ref ? "button" : "span";
    const type = tag === "button" ? ' type="button"' : "";
    const extra = clickable && ref ? " clickable" : "";
    const line = ref?.line ?? "";
    const side = ref?.side ?? "";
    html += `<${tag}${type} class="patch-line ${row.kind}${extra}" data-diff-line="1" data-line="${line}" data-side="${side}"><span class="patch-ln old" aria-hidden>${row.oldLine ?? ""}</span><span class="patch-ln new" aria-hidden>${row.newLine ?? ""}</span><span class="patch-gutter" aria-hidden>${sign(row.kind)}</span><span class="patch-text">${highlightSource(row.text || " ", lang)}</span></${tag}>`;
  }
  return html;
}

export function lineRefFromTarget(
  path: string,
  target: EventTarget | null,
): DiffLineRef | undefined {
  if (!(target instanceof Element)) return undefined;
  const row = target.closest("[data-diff-line]");
  if (!(row instanceof HTMLElement)) return undefined;
  const line = Number(row.dataset.line);
  if (!Number.isFinite(line) || line < 1) return undefined;
  return { path, line, side: row.dataset.side === "LEFT" ? "LEFT" : "RIGHT" };
}

export function symbolFromTarget(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined;
  const node = target.closest("[data-symbol]");
  if (!(node instanceof HTMLElement)) return undefined;
  const name = node.dataset.symbol?.trim();
  return name || undefined;
}
