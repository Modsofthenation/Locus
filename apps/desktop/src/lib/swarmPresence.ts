import {
  guestLabel,
  isHumanDriving,
  lastAssistantText,
  sessionDisplayName,
  sessionRuntime,
  type AgentSession,
} from "@locus/shared";
import { sessionHasNeedsYou } from "@/lib/needsYou";

export function clipSwarmPreview(text: string, max = 64): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

/** Roster subtitle for a Swarm teammate. */
export function swarmRosterMeta(session: AgentSession): string {
  const preview = lastAssistantText(session.messages);
  if (preview) return clipSwarmPreview(preview, 64);
  if (sessionHasNeedsYou(session)) return "Needs you";
  if (session.persona?.hubRole) return session.persona.hubRole;
  if (session.archived) return "Archived";
  return "No messages yet";
}

export function formatSwarmListWhen(iso: string, now = new Date()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d = new Date(t);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (t >= dayStart) return time;
  if (t >= dayStart - 24 * 60 * 60 * 1000) return "Yesterday";
  if (t >= dayStart - 6 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function swarmComputerStatus(
  session: AgentSession,
  vmStatus?: string,
): { title: string; detail: string } {
  const name = sessionDisplayName(session);
  if (session.error) {
    return { title: "Needs attention", detail: clipSwarmPreview(session.error, 96) };
  }
  if (isHumanDriving(session)) {
    return { title: "You are driving", detail: `${name}'s screen is under your control` };
  }
  if (sessionRuntime(session) === "host") {
    return {
      title: "Host workspace",
      detail: [session.model, session.status].filter(Boolean).join(" · "),
    };
  }
  const guest = session.os ? guestLabel(session.os) : "Guest";
  const status = vmStatus ?? session.status;
  return {
    title: `${guest} — ${status}`,
    detail: [session.model, session.persona?.hubRole].filter(Boolean).join(" · "),
  };
}
