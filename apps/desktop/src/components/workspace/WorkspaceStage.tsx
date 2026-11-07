import { useLayoutEffect, useState, type ReactNode } from "react";
import type { UiSection } from "@/state/store";

export function WorkspaceStage(props: {
  section: UiSection;
  enter: "forward" | "back" | null;
  children: ReactNode;
}) {
  const [entering, setEntering] = useState(false);

  useLayoutEffect(() => {
    if (!props.enter) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntering(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [props.enter]);

  return (
    <div
      className={entering ? "workspace-stage is-entering" : "workspace-stage"}
      data-section={props.section}
      data-enter={props.enter ?? undefined}
    >
      {props.children}
    </div>
  );
}
