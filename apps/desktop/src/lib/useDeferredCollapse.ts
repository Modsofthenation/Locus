import { useEffect, useState } from "react";

/** Keep full pane content mounted while the grid eases to the rail. */
export const PANE_MOTION_MS = 400;

export function useDeferredCollapse(collapsed: boolean, ms = PANE_MOTION_MS): boolean {
  const [deferred, setDeferred] = useState(collapsed);
  useEffect(() => {
    if (!collapsed) {
      setDeferred(false);
      return;
    }
    const id = window.setTimeout(() => setDeferred(true), ms);
    return () => window.clearTimeout(id);
  }, [collapsed, ms]);
  return deferred;
}
