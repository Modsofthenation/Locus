import { useMemo, useRef, useState } from "react";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { Skeleton } from "@/components/layout/Skeleton";
import { canShowTimeline, parseUnifiedDiff, type AgentSession } from "@locus/shared";
import {
  artifactSummary,
  countChangedFiles,
  filesChangedLabel,
  sessionArtifacts,
  turnDiffCheckpoints,
  type SessionArtifact,
} from "@/lib/artifacts";
import { screenshotSrc } from "./GuestTimeline";
import { useStore } from "@/state/store";
import { api } from "@/lib/api";
import { PatchStackCard } from "./PatchStackCard";

export async function loadTurnDiff(sessionId: string, checkpointId: string): Promise<string> {
  try {
    const next = await api.checkpointDiff(sessionId, checkpointId);
    return next.diff || "(no changes)";
  } catch {
    return "Could not load turn diff.";
  }
}

function TurnChangeStack({
  sessionId,
  checkpointId,
  diff,
  onOpenPath,
}: {
  sessionId: string;
  checkpointId: string;
  diff: string;
  onOpenPath?: (path: string, line?: number) => void;
}) {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);
  if (!files.length) return null;
  return (
    <PatchStackCard
      files={files}
      patchText={diff}
      meta={{ repoId: sessionId, number: 1, headSha: checkpointId }}
      onOpenPath={onOpenPath}
      onRevealFolder={(path) => {
        void api.revealWorkspace(sessionId, path).catch(() => undefined);
      }}
    />
  );
}

export function TurnDiffChip({
  sessionId,
  checkpointId,
  fileCount,
  path,
  line,
  onOpenPath,
}: {
  sessionId: string;
  checkpointId: string;
  fileCount: number;
  path?: string;
  line?: number;
  onOpenPath?: (path: string, line?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [count, setCount] = useState(fileCount);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || text !== null) return;
    setLoading(true);
    const diff = await loadTurnDiff(sessionId, checkpointId);
    const n = countChangedFiles(diff);
    if (n) setCount(n);
    setText(diff);
    setLoading(false);
  }

  return (
    <div className="turn-diff">
      <button
        type="button"
        className="turn-diff-chip"
        aria-expanded={open}
        data-testid="turn-diff-chip"
        title="Show the unified diff for this turn"
        onClick={() => {
          if (path) onOpenPath?.(path, line);
          void toggle();
        }}
      >
        {filesChangedLabel(count)}
      </button>
      {open ? (
        <>
          {text ? (
            <TurnChangeStack
              sessionId={sessionId}
              checkpointId={checkpointId}
              diff={text}
              onOpenPath={onOpenPath}
            />
          ) : null}
          <pre className="artifact-diff" data-testid="checkpoint-diff">
            {loading && !text ? <Skeleton lines={2} label="Loading diff" /> : text}
          </pre>
        </>
      ) : null}
    </div>
  );
}

export function ArtifactDrawer({ session }: { session: AgentSession }) {
  const { dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<{ id: string; text: string } | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const items = useMemo(() => sessionArtifacts(session.messages), [session.messages]);
  const gitTurns = turnDiffCheckpoints(session);
  useDialogFocus(open, () => setOpen(false), drawerRef, { trap: false });
  if (!items.length && !gitTurns.length) return null;

  async function loadDiff(checkpointId: string) {
    const text = await loadTurnDiff(session.id, checkpointId);
    setDiff({ id: checkpointId, text });
  }

  function onShot(item: Extract<SessionArtifact, { kind: "screenshot" }>) {
    if (!canShowTimeline(session)) return;
    dispatch({ type: "seekTimeline", seek: { sessionId: session.id, stopId: item.messageId } });
  }

  return (
    <aside
      ref={drawerRef}
      className={`artifact-drawer ${open ? "open" : ""}`}
      aria-label="Thread artifacts"
    >
      <button
        type="button"
        className="artifact-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Artifacts · {artifactSummary(items)}
        {gitTurns.length
          ? ` · ${gitTurns.length} turn diff${gitTurns.length === 1 ? "" : "s"}`
          : ""}
      </button>
      {open ? (
        <div className="artifact-track" role="group" aria-label="Thread artifacts">
          {items.map((item) => {
            if (item.kind === "screenshot") {
              const src = screenshotSrc(session.id, item);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="artifact-card"
                  title={canShowTimeline(session) ? "Preview on the guest timeline" : "Screenshot"}
                  onClick={() => onShot(item)}
                >
                  {src ? <img alt="" src={src} /> : <span>Shot</span>}
                  <span>Screenshot</span>
                </button>
              );
            }
            if (item.kind === "recording") {
              return (
                <a
                  key={item.id}
                  className="artifact-card"
                  href={`/api/sessions/${session.id}/recordings/${encodeURIComponent(item.recordingName)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="artifact-kind">Rec</span>
                  <span>{item.recordingName}</span>
                </a>
              );
            }
            if (item.kind === "pdf" || item.kind === "trace" || item.kind === "download") {
              const label =
                item.kind === "pdf" ? "PDF" : item.kind === "trace" ? "DevTools trace" : "File";
              return (
                <a
                  key={item.id}
                  className="artifact-card"
                  href={`/api/sessions/${session.id}/artifacts/${encodeURIComponent(item.artifactName)}?kind=${item.kind}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="artifact-kind">{label}</span>
                  <span>{item.artifactName}</span>
                </a>
              );
            }
            if (item.kind === "patch") {
              return (
                <div key={item.id} className="artifact-card static">
                  <span className="artifact-kind">Patch</span>
                  <span>{item.files.map((file) => file.path).join(", ")}</span>
                </div>
              );
            }
            if (item.kind === "pr") {
              return (
                <a
                  key={item.id}
                  className="artifact-card"
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="artifact-kind">PR</span>
                  <span>{item.url.replace(/^https?:\/\//, "")}</span>
                </a>
              );
            }
            return null;
          })}
          {gitTurns.map((row) => (
            <button
              key={row.id}
              type="button"
              className="artifact-card"
              title="Git diff for this turn"
              onClick={() => void loadDiff(row.id)}
            >
              <span className="artifact-kind">Diff</span>
              <span>{new Date(row.createdAt).toLocaleTimeString()}</span>
            </button>
          ))}
        </div>
      ) : null}
      {diff ? (
        <>
          <TurnChangeStack sessionId={session.id} checkpointId={diff.id} diff={diff.text} />
          <pre className="artifact-diff" data-testid="checkpoint-diff">
            {diff.text}
          </pre>
        </>
      ) : null}
    </aside>
  );
}
