import { useEffect, useState } from "react";

/** At this width the list pane is an overlay drawer beside the rail (see index.css). */
export const DRAWER_SIDEBAR_QUERY = "(max-width: 760px)";

function matchesDrawer(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      Boolean(window.matchMedia(DRAWER_SIDEBAR_QUERY)?.matches)
    );
  } catch {
    return false;
  }
}

export function useDrawerSidebar(): boolean {
  const [drawer, setDrawer] = useState(matchesDrawer);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DRAWER_SIDEBAR_QUERY);
    if (!mq) return;
    const onChange = () => setDrawer(mq.matches);
    onChange();
    if (typeof mq.addEventListener !== "function") return;
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return drawer;
}
