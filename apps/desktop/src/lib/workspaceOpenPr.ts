export const WORKSPACE_OPEN_PR_EVENT = "locus:workspace-open-pr";

export type WorkspacePrCommentMark = {
  path: string;
  line: number;
  body: string;
  author?: string;
  side?: "LEFT" | "RIGHT";
};

export type WorkspaceOpenPrDetail = {
  sessionId: string;
  files: string[];
  comments: WorkspacePrCommentMark[];
  focus?: { path: string; line?: number };
};

let pendingOpenPr: WorkspaceOpenPrDetail | null = null;

export function requestWorkspaceOpenPr(detail: WorkspaceOpenPrDetail): void {
  pendingOpenPr = detail;
  window.dispatchEvent(new CustomEvent(WORKSPACE_OPEN_PR_EVENT, { detail }));
}

export function consumeWorkspaceOpenPr(sessionId: string): WorkspaceOpenPrDetail | null {
  if (!pendingOpenPr || pendingOpenPr.sessionId !== sessionId) return null;
  const next = pendingOpenPr;
  pendingOpenPr = null;
  return next;
}

export function firstHunkLine(patch?: string): number | undefined {
  const match = patch?.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
  if (!match) return undefined;
  const line = Number(match[1]);
  return Number.isFinite(line) && line > 0 ? line : undefined;
}

export function prCommentMarks(
  comments: Array<{
    path?: string;
    line?: number;
    body: string;
    author?: string;
    side?: "LEFT" | "RIGHT";
  }>,
): WorkspacePrCommentMark[] {
  const out: WorkspacePrCommentMark[] = [];
  for (const row of comments) {
    if (!row.path || !row.line) continue;
    if (row.side === "LEFT") continue;
    out.push({
      path: row.path,
      line: row.line,
      body: row.body,
      author: row.author,
      side: row.side,
    });
  }
  return out;
}
