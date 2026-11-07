export type ConflictSide = "ours" | "theirs";

const START = /^<<<<<<<[^\n]*\n/;
const MID = /^=======\n/;
const END = /^>>>>>>>[^\n]*\n?/;

export function hasConflictMarkers(text: string): boolean {
  return text.includes("<<<<<<<") && text.includes("=======") && text.includes(">>>>>>>");
}

/** Keep ours or theirs for every `<<<<<<<` / `=======` / `>>>>>>>` hunk. */
export function resolveConflictMarkers(text: string, side: ConflictSide): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i]?.startsWith("<<<<<<<")) {
      out.push(lines[i] ?? "");
      i += 1;
      continue;
    }
    i += 1;
    const ours: string[] = [];
    while (i < lines.length && !lines[i]?.startsWith("=======")) {
      ours.push(lines[i] ?? "");
      i += 1;
    }
    if (i < lines.length && lines[i]?.startsWith("=======")) i += 1;
    const theirs: string[] = [];
    while (i < lines.length && !lines[i]?.startsWith(">>>>>>>")) {
      theirs.push(lines[i] ?? "");
      i += 1;
    }
    if (i < lines.length && lines[i]?.startsWith(">>>>>>>")) i += 1;
    out.push(...(side === "ours" ? ours : theirs));
  }
  return out.join("\n");
}

export { START as CONFLICT_START, MID as CONFLICT_MID, END as CONFLICT_END };
