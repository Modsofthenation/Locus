import { useEffect, type ReactNode } from "react";
import { Mascot } from "./Mascot";
import { Skeleton } from "./Skeleton";
import { useStore } from "@/state/store";

export function BootScreen(props: { onRetry?: () => void }) {
  const { state } = useStore();
  const error = state.error;
  return (
    <div
      className="boot-screen"
      role="status"
      aria-live="polite"
      aria-busy={!error}
      data-testid="boot-screen"
    >
      <div className="boot-screen-card">
        <Mascot
          pose={error ? "rest" : "think"}
          size={76}
          title={error ? "Locus could not load" : "Locus is loading"}
        />
        {error ? (
          <p className="boot-screen-error">{error}</p>
        ) : (
          <Skeleton lines={1} label="Loading…" />
        )}
        {error && props.onRetry ? (
          <button
            type="button"
            className="btn small"
            data-testid="boot-retry"
            onClick={props.onRetry}
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Marks the lazy shell/pane tree as painted so the boot mascot can leave. */
export function BootReveal(props: { onReady: () => void; children: ReactNode }) {
  useEffect(() => {
    props.onReady();
  }, [props.onReady]);
  return props.children;
}
