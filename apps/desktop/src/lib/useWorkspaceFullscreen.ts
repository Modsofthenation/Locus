import { useCallback, useEffect, useState } from "react";

/** Cover the app window with a pane (files, canvas). Escape or the toggle exits. */
export function useWorkspaceFullscreen() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!on) return;
    let pending = 0;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Full screen is the outermost layer: let menus, play mode and canvas tools
      // that also listen on window claim this Escape first, whatever order they
      // registered in, and only exit when nothing else handled it.
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        if (!event.defaultPrevented) setOn(false);
      }, 0);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(pending);
      window.removeEventListener("keydown", onKey);
    };
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
