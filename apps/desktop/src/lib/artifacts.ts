import {
  patchFilesFromTool,
  rewindTargets,
  workspaceChangesFromMessages,
  workspaceFollowFromTool,
  type AgentSession,
  type ChatMessage,
  type PatchFile,
  type SessionCheckpoint,
} from "@locus/shared";
import { prUrlFromToolOutput } from "./markdown";

export type SessionArtifact =
  | {
      kind: "screenshot";
      id: string;
      at: string;
      messageId: string;
      screenshotBase64?: string;
      screenshotName?: string;
    }
  | {
      kind: "recording";
      id: string;
      at: string;
      messageId: string;
      recordingName: string;
    }
  | {
      kind: "patch";
      id: string;
      at: string;
      messageId: string;
      tool: string;
      files: PatchFile[];
    }
  | {
      kind: "pr";
      id: string;
      at: string;
      messageId: string;
      url: string;
    }
  | {
      kind: "pdf" | "trace" | "download";
      id: string;
      at: string;
      messageId: string;
      artifactName: string;
    };

function callOutput(
  message: ChatMessage,
  call: NonNullable<ChatMessage["toolCalls"]>[number],
): string | undefined {
  return call.result ?? (message.role === "tool" ? message.content : undefined);
}

export function sessionArtifacts(messages: ChatMessage[]): SessionArtifact[] {
  const out: SessionArtifact[] = [];
  const seen = new Set<string>();
  const push = (item: SessionArtifact) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  };

  for (const message of messages) {
    if (message.screenshotBase64 || message.screenshotName) {
      push({
        kind: "screenshot",
        id: `shot:${message.id}`,
        at: message.createdAt,
        messageId: message.id,
        screenshotBase64: message.screenshotBase64,
        screenshotName: message.screenshotName,
      });
    }
    if (message.recordingName) {
      push({
        kind: "recording",
        id: `rec:${message.id}:${message.recordingName}`,
        at: message.createdAt,
        messageId: message.id,
        recordingName: message.recordingName,
      });
    }
    if (
      message.artifactName &&
      (message.artifactKind === "pdf" ||
        message.artifactKind === "trace" ||
        message.artifactKind === "download")
    ) {
      push({
        kind: message.artifactKind,
        id: `art:${message.id}:${message.artifactName}`,
        at: message.createdAt,
        messageId: message.id,
        artifactName: message.artifactName,
      });
    }
    for (const call of message.toolCalls ?? []) {
      const files = patchFilesFromTool(call.name, call.arguments, callOutput(message, call));
      if (files.length) {
        push({
          kind: "patch",
          id: `patch:${call.id}`,
          at: message.createdAt,
          messageId: message.id,
          tool: call.name,
          files,
        });
      }
      if (call.name === "git_pr") {
        const url = prUrlFromToolOutput(callOutput(message, call) ?? "");
        if (url) {
          push({
            kind: "pr",
            id: `pr:${call.id}`,
            at: message.createdAt,
            messageId: message.id,
            url,
          });
        }
      }
    }
  }
  return out;
}

/** Checkpoints that have a previous git ref, so `checkpointDiff` can return a turn patch. */
export function turnDiffCheckpoints(
  session: Pick<AgentSession, "checkpoint" | "checkpoints">,
): SessionCheckpoint[] {
  return rewindTargets(session).filter((row, index, rows) => {
    if (!row.gitRef) return false;
    return index > 0 && Boolean(rows[index - 1]?.gitRef);
  });
}

/** Prefer `git diff --stat` (“N files changed”), then unique `diff --git` paths. */
export function countChangedFiles(diff: string): number {
  const stat = /(?:^|\n)\s*(\d+) files? changed\b/.exec(diff);
  if (stat) return Number(stat[1]);
  const paths = new Set<string>();
  for (const match of diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    paths.add(match[2] || match[1] || "");
  }
  paths.delete("");
  return paths.size;
}

export function filesChangedLabel(count: number): string {
  if (count <= 0) return "Files changed";
  return count === 1 ? "1 file changed" : `${count} files changed`;
}

export function turnDiffByAssistantId(
  session: Pick<AgentSession, "messages" | "checkpoint" | "checkpoints">,
): Map<string, { checkpointId: string; fileCount: number; path?: string; line?: number }> {
  const out = new Map<
    string,
    { checkpointId: string; fileCount: number; path?: string; line?: number }
  >();
  const targets = rewindTargets(session);
  for (const turn of turnDiffCheckpoints(session)) {
    const index = targets.findIndex((row) => row.id === turn.id);
    const prev = index > 0 ? targets[index - 1] : undefined;
    const slice = session.messages.slice(prev?.messageCount ?? 0, turn.messageCount);
    let lastAssistantId: string | undefined;
    for (let i = slice.length - 1; i >= 0; i--) {
      if (slice[i]?.role === "assistant") {
        lastAssistantId = slice[i]!.id;
        break;
      }
    }
    if (!lastAssistantId) continue;
    const changed = workspaceChangesFromMessages(slice);
    let line: number | undefined;
    scan: for (const message of slice) {
      for (const call of message.toolCalls ?? []) {
        const follow = workspaceFollowFromTool(call.name, call.arguments, call.result);
        if (follow && follow.path === changed[0]?.path) {
          line = follow.line;
          break scan;
        }
      }
    }
    out.set(lastAssistantId, {
      checkpointId: turn.id,
      fileCount: changed.length,
      path: changed[0]?.path,
      line,
    });
  }
  return out;
}

export function artifactSummary(items: SessionArtifact[]): string {
  const shots = items.filter((i) => i.kind === "screenshot").length;
  const recordings = items.filter((i) => i.kind === "recording").length;
  const pdfs = items.filter((i) => i.kind === "pdf").length;
  const traces = items.filter((i) => i.kind === "trace").length;
  const downloads = items.filter((i) => i.kind === "download").length;
  const patches = items.filter((i) => i.kind === "patch").length;
  const prs = items.filter((i) => i.kind === "pr").length;
  const parts: string[] = [];
  if (shots) parts.push(`${shots} shot${shots === 1 ? "" : "s"}`);
  if (recordings) parts.push(`${recordings} recording${recordings === 1 ? "" : "s"}`);
  if (pdfs) parts.push(`${pdfs} PDF${pdfs === 1 ? "" : "s"}`);
  if (traces) parts.push(`${traces} DevTools trace${traces === 1 ? "" : "s"}`);
  if (downloads) parts.push(`${downloads} download${downloads === 1 ? "" : "s"}`);
  if (patches) parts.push(`${patches} patch${patches === 1 ? "" : "es"}`);
  if (prs) parts.push(`${prs} PR${prs === 1 ? "" : "s"}`);
  return parts.join(" · ") || "No artifacts";
}
