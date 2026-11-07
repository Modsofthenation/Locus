import { useEffect, useState } from "react";

/** Narrow windows and portrait monitors put files / canvas in a bottom pane. */
export const STACKED_WORKSPACE_QUERY = "(max-width: 900px), (orientation: portrait)";

function defaultMatchMedia(): ((query: string) => { matches: boolean } | undefined) | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
  return window.matchMedia.bind(window);
}

export function matchesStackedWorkspace(
  matchMedia:
    ((query: string) => { matches: boolean } | undefined) | undefined = defaultMatchMedia(),
): boolean {
  try {
    return Boolean(matchMedia?.(STACKED_WORKSPACE_QUERY)?.matches);
  } catch {
    return false;
  }
}

export function useStackedWorkspace(): boolean {
  const [stacked, setStacked] = useState(matchesStackedWorkspace);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(STACKED_WORKSPACE_QUERY);
    const onChange = () => setStacked(mq.matches);
    onChange();
    if (typeof mq.addEventListener !== "function") return;
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return stacked;
}
