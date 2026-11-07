import { useMemo } from "react";
import { buildChangeStackFromPatch, formatPatchFile, type PatchFile } from "@locus/shared";
import { ChangeStackPanel } from "@/components/codebase/ChangeStackPanel";
import { PatchCard } from "./PatchCard";

/** Cohort/layer walkthrough for an agent tool patch (same heuristic as PR Stack). */
export function PatchStackCard(props: {
  files: PatchFile[];
  meta: { repoId: string; number: number; headSha: string };
  patchText?: string;
  onOpenPath?: (path: string, line?: number) => void;
  onRevealFolder?: (path: string) => void;
}) {
  const unified =
    props.patchText?.trim() ||
    props.files
      .map((file) => `--- a/${file.path}\n+++ b/${file.path}\n${formatPatchFile(file)}`)
      .join("\n");

  const stack = useMemo(
    () => (props.files.length ? buildChangeStackFromPatch(unified, props.meta) : null),
    [props.files.length, unified, props.meta],
  );

  if (!stack || props.files.length < 2) {
    return (
      <PatchCard
        files={props.files}
        onOpenPath={props.onOpenPath}
        onRevealFolder={props.onRevealFolder}
      />
    );
  }

  return (
    <div className="turn-change-stack" data-testid="patch-stack-card">
      <ChangeStackPanel
        compact
        stack={stack}
        stale={false}
        busy={false}
        pullFiles={props.files}
        pullHeadSha={props.meta.headSha}
        commentBody=""
        focused={false}
        onCommentBody={() => undefined}
        onSelectLine={(ref) => props.onOpenPath?.(ref.path, ref.line)}
        onComment={() => undefined}
        onClearComment={() => undefined}
        onUpdate={() => undefined}
        onJumpToFile={(filePath) => props.onOpenPath?.(filePath)}
        onOpenInIde={(focus) => props.onOpenPath?.(focus.path, focus.line)}
        onToggleFocus={() => undefined}
      />
    </div>
  );
}
