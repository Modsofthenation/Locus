import { useEffect, useRef, useState } from "react";
import {
  assetBuildEquals,
  resolveAssetBuild,
  type AgentSession,
  type AssetBuild,
  type PatchSessionInput,
} from "@locus/shared";
import { api } from "@/lib/api";

/**
 * Build settings shown on a live Assets canvas. Edits apply locally at once and patch the
 * session one at a time, so quick toggles never send a stale base and Generate sees the
 * latest pick before the server answers.
 */
export function useAssetBuild(
  session: Pick<AgentSession, "id" | "assetBuild"> | undefined,
  dispatch: (action: { type: "session"; session: AgentSession }) => void,
): {
  build: AssetBuild;
  change: (next: AssetBuild) => void;
  markApplied: (next: AssetBuild) => Promise<void>;
} {
  const sessionId = session?.id;
  const saved = session?.assetBuild;
  const [build, setBuild] = useState(() => resolveAssetBuild(saved));
  const pending = useRef(0);
  const epoch = useRef(0);
  const queue = useRef(Promise.resolve());
  const savedRef = useRef(saved);
  savedRef.current = saved;

  useEffect(() => {
    epoch.current += 1;
    pending.current = 0;
    queue.current = Promise.resolve();
  }, [sessionId]);

  useEffect(() => {
    if (pending.current) return;
    const next = resolveAssetBuild(saved);
    setBuild((current) => (assetBuildEquals(current, next) ? current : next));
  }, [saved, sessionId]);

  function enqueue(patch: PatchSessionInput, local?: AssetBuild): Promise<void> {
    if (!sessionId) return Promise.resolve();
    if (local) {
      pending.current += 1;
      setBuild(local);
    }
    const id = sessionId;
    const at = epoch.current;
    return new Promise((resolve) => {
      queue.current = queue.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const updated = await api.patchSession(id, patch);
            if (epoch.current !== at) return;
            dispatch({ type: "session", session: updated });
          } catch {
            if (local && epoch.current === at && pending.current === 1) {
              setBuild(resolveAssetBuild(savedRef.current));
            }
          } finally {
            if (local && epoch.current === at) pending.current -= 1;
            resolve();
          }
        });
    });
  }

  return {
    build,
    change: (next) => {
      void enqueue({ assetBuild: next }, next);
    },
    markApplied: (next) => enqueue({ assetAppliedBuild: next }),
  };
}
