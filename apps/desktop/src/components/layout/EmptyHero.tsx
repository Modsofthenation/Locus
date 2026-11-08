import type { ReactNode } from "react";
import { Mascot, type MascotPose } from "./Mascot";

/** Shared empty-state heading: mascot, one title, one sentence. */
export function EmptyHero(props: {
  title: string;
  lead: string;
  eyebrow?: string;
  pose?: MascotPose;
  followCursor?: boolean;
  hideMascot?: boolean;
  compact?: boolean;
  size?: number;
  children?: ReactNode;
}) {
  return (
    <header className={`empty-hero${props.compact ? " compact" : ""}`}>
      {props.hideMascot ? null : (
        <Mascot
          pose={props.pose ?? "idle"}
          size={props.size ?? (props.compact ? 36 : 48)}
          followCursor={props.followCursor}
        />
      )}
      <div>
        {props.eyebrow ? <p className="eyebrow">{props.eyebrow}</p> : null}
        <h2>{props.title}</h2>
        <p>{props.lead}</p>
        {props.children}
      </div>
    </header>
  );
}

/** Compact in-pane empty copy (lists, rails, filters). */
export function EmptyHint(props: {
  title: string;
  lead?: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="empty-hint" data-testid={props.testId ?? "empty-hint"} role="status">
      <p className="empty-hint-title">{props.title}</p>
      {props.lead ? <p className="empty-hint-lead">{props.lead}</p> : null}
      {props.action}
    </div>
  );
}

/** Sidebar / catalog empty row with the rest mascot. */
export function EmptyListNote({ children }: { children: ReactNode }) {
  return (
    <div className="empty-list">
      <Mascot pose="rest" size={36} />
      <div className="empty-list-body">{children}</div>
    </div>
  );
}
