import {
  ASSET_LIVE_VARIANT_ID,
  ASSET_UNDO_VARIANT_ID,
  EXPLORE_DIRECTION_IDS,
  type AgentSession,
  type DesignSystem,
} from "@locus/shared";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DesignThumb } from "@/components/design/DesignThumb";

function variantPath(id: string): string {
  return `.locus-variants/${id}.html`;
}

export function AssetRecents(props: {
  session: AgentSession;
  html?: string | null;
  systems: DesignSystem[];
  swapping?: boolean;
  exploring?: boolean;
  turning?: boolean;
  canUndo?: boolean;
  compareOn?: boolean;
  onLive: () => void;
  onActivate: (id: string) => void;
  onSave: () => void;
  onExplore: () => void;
  onUndo: () => void;
  onCompare: () => void;
}) {
  const variants = props.session.designVariants ?? [];
  const active = props.session.activeVariantId ?? "";
  const liveOn = !active || active === ASSET_LIVE_VARIANT_ID;
  const explore = EXPLORE_DIRECTION_IDS.map((id) => variants.find((row) => row.id === id)).filter(
    (row): row is NonNullable<typeof row> => Boolean(row),
  );
  const hideExplore = explore.length === 3;
  const named = variants.filter((row) => {
    if (row.id === ASSET_LIVE_VARIANT_ID || row.id === ASSET_UNDO_VARIANT_ID) return false;
    if (hideExplore && (EXPLORE_DIRECTION_IDS as readonly string[]).includes(row.id)) {
      return false;
    }
    return true;
  });
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const thumbIds = [
    ...named.map((row) => row.id),
    ...explore.map((row) => row.id),
    ...(props.canUndo ? [ASSET_UNDO_VARIANT_ID] : []),
  ]
    .filter((id, index, all) => all.indexOf(id) === index)
    .join("|");

  useEffect(() => {
    let cancelled = false;
    const ids = thumbIds.split("|").filter(Boolean);
    void Promise.all(
      ids.map(async (id) => {
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
      setThumbs(next);
    });
    return () => {
      cancelled = true;
    };
  }, [thumbIds, props.session.id, props.session.updatedAt]);

  if (!named.length && !props.html?.trim() && !explore.length) return null;

  return (
    <div className="asset-recents" role="navigation" aria-label="Recents">
      <span className="asset-cluster-label">Recents</span>
      <div className="asset-recents-row">
        <button
          type="button"
          className={`asset-recent asset-recent-thumb ${liveOn ? "on" : ""}`}
          title="Live studio"
          disabled={props.swapping}
          onClick={() => props.onLive()}
        >
          {props.html?.trim() ? (
            <DesignThumb session={props.session} html={props.html} systems={props.systems} />
          ) : (
            <span className="asset-recent-label">Live</span>
          )}
          <span className="asset-recent-caption">Live</span>
        </button>
        {named.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`asset-recent asset-recent-thumb ${active === item.id ? "on" : ""}`}
            disabled={props.swapping}
            title={item.name}
            onClick={() => props.onActivate(item.id)}
          >
            {thumbs[item.id] ? (
              <DesignThumb session={props.session} html={thumbs[item.id]} systems={props.systems} />
            ) : (
              <span className="asset-recent-label">{item.name}</span>
            )}
            <span className="asset-recent-caption">{item.name}</span>
          </button>
        ))}
        <button
          type="button"
          className="asset-recent ghost"
          disabled={!props.html?.trim()}
          title="Save the live studio as a named variant"
          onClick={() => props.onSave()}
        >
          Save
        </button>
        <button
          type="button"
          className="asset-recent ghost"
          disabled={props.exploring || props.turning}
          title="Generate three alternate directions"
          onClick={() => props.onExplore()}
        >
          {props.exploring ? "Exploring…" : "Explore 3"}
        </button>
        <button
          type="button"
          className="asset-recent ghost"
          disabled={!props.canUndo || props.swapping}
          title="Restore the studio from before the last generate"
          onClick={() => props.onUndo()}
        >
          Undo last
        </button>
        <button
          type="button"
          className={`asset-recent ghost ${props.compareOn ? "on" : ""}`}
          disabled={!props.canUndo}
          aria-pressed={props.compareOn}
          title="Compare live against the previous generate"
          onClick={() => props.onCompare()}
        >
          Compare
        </button>
        {explore.length === 3 ? (
          <div className="asset-explore-grid" role="list" aria-label="Explore 3">
            {explore.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`asset-recent asset-recent-thumb ${active === item.id ? "on" : ""}`}
                disabled={props.swapping}
                title={item.name}
                onClick={() => props.onActivate(item.id)}
              >
                {thumbs[item.id] ? (
                  <DesignThumb
                    session={props.session}
                    html={thumbs[item.id]}
                    systems={props.systems}
                  />
                ) : (
                  <span className="asset-recent-label">{item.name}</span>
                )}
                <span className="asset-recent-caption">
                  {item.name || `Direction ${index + 1}`}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
