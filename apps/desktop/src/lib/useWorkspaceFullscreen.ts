import { useCallback, useEffect, useState } from "react";

/** Cover the app window with the files pane (explorer + editor). */
export function useWorkspaceFullscreen() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!on) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      setOn(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);

  const toggle = useCallback(() => {
    setOn((current) => !current);
  }, []);

  return {
    isFullscreen: on,
    toggle,
    className: on ? "workspace-fs" : "",
  };
}
