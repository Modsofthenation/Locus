import type { AgentSession, DesignSystem } from "@locus/shared";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DesignThumb } from "./DesignThumb";

function variantPath(id: string): string {
  return `.locus-variants/${id}.html`;
}

export function DesignVariantsStrip(props: {
  session: AgentSession;
  html?: string | null;
  systems: DesignSystem[];
  swapping?: boolean;
  onActivate: (id: string) => void;
}) {
  const variants = props.session.designVariants ?? [];
  const active = props.session.activeVariantId ?? "";
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const ids = variants.map((row) => row.id).join("|");

  useEffect(() => {
    let cancelled = false;
    const list = ids.split("|").filter(Boolean);
    if (!list.length) {
      setThumbs((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }
    void Promise.all(
      list.map(async (id) => {
        try {
          const file = await api.workspaceFile(props.session.id, variantPath(id));
          return [id, file?.content ?? ""] as const;
        } catch {
          return [id, ""] as const;
        }
      }),
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [id, html] of rows) {
        if (html.trim()) next[id] = html;
      }
      setThumbs((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (
          prevKeys.length === nextKeys.length &&
          nextKeys.every((key) => prev[key] === next[key])
        ) {
          return prev;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [ids, props.session.id, props.session.updatedAt]);

  if (!variants.length) return null;

  return (
    <div className="design-recents" role="navigation" aria-label="Design variants">
      <span className="asset-cluster-label">History</span>
      <div className="design-recents-row">
        {variants.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`design-recent ${active === item.id ? "on" : ""}`}
            disabled={props.swapping}
            title={item.name}
            onClick={() => props.onActivate(item.id)}
          >
            {thumbs[item.id] || (active === item.id && props.html?.trim()) ? (
              <DesignThumb
                session={props.session}
                html={thumbs[item.id] || props.html || ""}
                systems={props.systems}
              />
            ) : (
              <span className="design-recent-label">{item.name}</span>
            )}
            <span className="design-recent-caption">{item.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
