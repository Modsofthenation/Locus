import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { matchesMobileQuery } from "@/lib/mobileShell";
import { useStore } from "@/state/store";
import { IconChevron } from "@/components/layout/Icons";

export function MobileProjectList(props: {
  onOpen: (id: string) => void;
  onBack: () => void;
  query?: string;
}) {
  const { state, dispatch } = useStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.projects().then(
      (projects) => {
        if (!cancelled) dispatch({ type: "projects", projects });
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load projects");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const rows = (state.projects ?? []).filter(
    (row) => !row.archived && matchesMobileQuery(row.title, props.query ?? ""),
  );

  return (
    <div className="mobile-more">
      <button type="button" className="mobile-back" onClick={props.onBack}>
        <IconChevron /> Back
      </button>
      <section className="mobile-settings-block">
        <h2>Projects</h2>
        {error ? <p className="error-text">{error}</p> : null}
        {rows.length ? (
          rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className="mobile-setting-row"
              onClick={() => props.onOpen(row.id)}
            >
              <span>{row.title}</span>
              <span className="mobile-setting-value">
                {row.starter ?? "project"} · {row.memberCount}{" "}
                {row.memberCount === 1 ? "member" : "members"}
              </span>
            </button>
          ))
        ) : (
          <p className="mobile-row-mono">
            {props.query ? "No matching projects" : "No projects yet. Create one on the desktop."}
          </p>
        )}
      </section>
    </div>
  );
}
