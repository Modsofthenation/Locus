import { sessionDisplayName } from "./persona.js";
import { sessionKind, type SessionKind } from "./session.js";
import type { ExtraToolDef } from "./mcp.js";
import { slugifyAssetTitle, uniqueAssetSlug } from "./assetPack.js";

export const HOST_SESSIONS_TOOL_NAME = "host_sessions";

export const HOST_SESSION_PEER_KINDS = [
  "agent",
  "game",
  "assets",
  "design",
  "review",
  "setup",
  "ide",
] as const;
export type HostSessionPeerKind = (typeof HOST_SESSION_PEER_KINDS)[number];

export const HOST_SESSIONS_ACTIONS = ["list", "read", "grep", "copy"] as const;
export type HostSessionsAction = (typeof HOST_SESSIONS_ACTIONS)[number];

export type HostSessionMentionItem = {
  id: string;
  token: string;
  label: string;
  hint: string;
  kind: HostSessionPeerKind;
  previewUrl?: string;
};

export type HostSessionPeerSummary = {
  id: string;
  kind: HostSessionPeerKind;
  title: string;
  slug: string;
  token: string;
  runtime?: string;
  files?: string[];
  brief?: string;
};

const MENTION_RE =
  /(?:^|[\s(])@(game|asset|assets|design|agent|review|setup|ide|session):([A-Za-z0-9_-]+)/g;

const KIND_PREFIX: Record<HostSessionPeerKind, string> = {
  agent: "agent",
  game: "game",
  assets: "asset",
  design: "design",
  review: "review",
  setup: "setup",
  ide: "ide",
};

export const HOST_SESSIONS_TOOL: ExtraToolDef = {
  name: HOST_SESSIONS_TOOL_NAME,
  description:
    "List or inspect other Locus chats whose workspaces are on this machine (Games, Assets, Design, coding agents). Use this when the operator asks you to look at, reuse, or combine those agents. list with kind/query first. read a text file. grep a pattern. copy a file or folder into this /workspace (default peers/<slug>/). Read-only on the peer; writes stay here. Do not exec into other session folders.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "list (default), read, grep, or copy.",
        enum: [...HOST_SESSIONS_ACTIONS],
      },
      query: {
        type: "string",
        description: "Filter list/grep by title, id, or kind (game, assets, agent, design).",
      },
      kind: {
        type: "string",
        description: "Limit to one session kind.",
        enum: [...HOST_SESSION_PEER_KINDS],
      },
      session: {
        type: "string",
        description: "Peer id, title, or @game/@asset/@agent slug. Required for read/copy.",
      },
      path: {
        type: "string",
        description: "Workspace-relative path to read or copy (GAME.md, index.html, vendor/).",
      },
      dest: {
        type: "string",
        description: "copy destination inside this /workspace. Default peers/<slug>/<path>.",
      },
      pattern: {
        type: "string",
        description: "grep pattern (min 2 chars).",
      },
    },
  },
};

export function isHostSessionsToolName(name: string): boolean {
  return name === HOST_SESSIONS_TOOL_NAME;
}

export function isHostSessionsAction(value: unknown): value is HostSessionsAction {
  return typeof value === "string" && (HOST_SESSIONS_ACTIONS as readonly string[]).includes(value);
}

export function isHostSessionPeerKind(value: unknown): value is HostSessionPeerKind {
  return (
    typeof value === "string" && (HOST_SESSION_PEER_KINDS as readonly string[]).includes(value)
  );
}

/** Host runtime chats (not Board/Project coordinators) may inspect peer workspaces. */
export function sessionOffersHostSessions(session: {
  runtime?: string;
  kind?: SessionKind;
}): boolean {
  if (session.runtime !== "host") return false;
  const kind = sessionKind(session);
  return kind !== "board" && kind !== "project";
}

export function isHostSessionPeer(session: { kind?: SessionKind; archived?: boolean }): boolean {
  if (session.archived) return false;
  return isHostSessionPeerKind(sessionKind(session));
}

export function hostSessionKindPrefix(kind: HostSessionPeerKind): string {
  return KIND_PREFIX[kind];
}

export function parseHostSessionKindToken(raw: string): HostSessionPeerKind | undefined {
  const token = raw.trim().toLowerCase().replace(/s$/, "");
  if (token === "asset") return "assets";
  if (token === "game") return "game";
  if (token === "design") return "design";
  if (token === "agent" || token === "session") return "agent";
  if (token === "review") return "review";
  if (token === "setup") return "setup";
  if (token === "ide") return "ide";
  return undefined;
}

export function hostSessionSlug(
  session: { id: string; title?: string; persona?: { displayName?: string } | null },
  taken: Iterable<string> = [],
): string {
  return uniqueAssetSlug(sessionDisplayName(session), session.id, taken);
}

export function hostSessionMentionToken(kind: HostSessionPeerKind, slug: string): string {
  const prefix = hostSessionKindPrefix(kind);
  const clean = slug.replace(
    /^@?(?:game|asset|assets|design|agent|review|setup|ide|session):/i,
    "",
  );
  return `${prefix}:${slugifyAssetTitle(clean) || clean}`;
}

export function parseHostSessionMentions(
  text: string,
): Array<{ kind: HostSessionPeerKind; slug: string }> {
  const out: Array<{ kind: HostSessionPeerKind; slug: string }> = [];
  const re = new RegExp(MENTION_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const kind = parseHostSessionKindToken(match[1] ?? "");
    const slug = (match[2] ?? "").trim();
    if (!kind || !slug) continue;
    if (out.some((row) => row.kind === kind && row.slug.toLowerCase() === slug.toLowerCase())) {
      continue;
    }
    out.push({ kind, slug });
  }
  return out;
}

export function insertHostSessionMention(
  text: string,
  cursor: number,
  token: string,
  query?: { start: number; query: string } | null,
): { text: string; cursor: number } {
  const clean = token.replace(/^@/, "").trim();
  if (!clean.includes(":")) return { text, cursor };
  const insert = `@${clean} `;
  const start = query?.start ?? cursor;
  const end = query ? Math.max(cursor, start + 1 + query.query.length) : cursor;
  const next = `${text.slice(0, start)}${insert}${text.slice(end)}`;
  return { text: next, cursor: start + insert.length };
}

export function hostSessionMentionItems(input: {
  session: { id: string; runtime?: string; kind?: SessionKind };
  sessions: Array<{
    id: string;
    kind?: SessionKind;
    title: string;
    archived?: boolean;
    runtime?: string;
    persona?: { displayName?: string } | null;
    assetPack?: { slug?: string; kind?: string; files?: string[] };
  }>;
}): HostSessionMentionItem[] {
  if (!sessionOffersHostSessions(input.session)) return [];
  const taken = new Set<string>();
  const items: HostSessionMentionItem[] = [];
  const rows = input.sessions
    .filter((row) => row.id !== input.session.id && isHostSessionPeer(row))
    .sort((a, b) => sessionDisplayName(a).localeCompare(sessionDisplayName(b)));
  for (const row of rows) {
    const kind = sessionKind(row) as HostSessionPeerKind;
    const slug =
      kind === "assets" && row.assetPack?.slug
        ? uniqueAssetSlug(row.assetPack.slug, row.id, taken)
        : hostSessionSlug(row, taken);
    taken.add(slug.toLowerCase());
    const token = hostSessionMentionToken(kind, slug);
    const files = row.assetPack?.files?.length ? row.assetPack.files.join(", ") : undefined;
    items.push({
      id: row.id,
      token,
      label: `@${token}`,
      hint: [sessionDisplayName(row), kind, row.runtime, files].filter(Boolean).join(" · "),
      kind,
    });
  }
  return items;
}

export function filterHostSessionMentions(
  items: HostSessionMentionItem[],
  query: string,
): HostSessionMentionItem[] {
  const q = query.replace(/^@/, "").trim().toLowerCase();
  if (!q) return items;
  return items
    .map((item) => ({ item, score: hostSessionMentionScore(item, q) }))
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.item.label.localeCompare(b.item.label) ||
        a.item.token.localeCompare(b.item.token),
    )
    .map((row) => row.item);
}

function hostSessionMentionScore(item: HostSessionMentionItem, query: string): number {
  const token = item.token.toLowerCase();
  const label = item.label.toLowerCase();
  const hint = item.hint.toLowerCase();
  const kind = item.kind.toLowerCase();
  const prefix = hostSessionKindPrefix(item.kind);
  if (token === query || label === `@${query}` || item.id.toLowerCase().startsWith(query))
    return 500;
  if (token.startsWith(query) || label.startsWith(`@${query}`)) return 400;
  if (prefix === query || kind === query || kind === parseHostSessionKindToken(query)) return 350;
  if (hint.split(/\s+/).some((word) => word.replace(/[^a-z0-9]+/g, "").startsWith(query)))
    return 300;
  if (token.includes(query) || hint.includes(query) || label.includes(query)) return 200;
  return 0;
}

export function resolveHostSessionMention(
  mention: { kind?: string; slug: string } | string,
  sessions: Array<{
    id: string;
    kind?: SessionKind;
    title: string;
    archived?: boolean;
    persona?: { displayName?: string } | null;
    assetPack?: { slug?: string };
  }>,
): { id: string; slug: string; kind: HostSessionPeerKind } | undefined {
  const raw =
    typeof mention === "string"
      ? { slug: mention.replace(/^@/, "") }
      : { kind: mention.kind, slug: mention.slug.replace(/^@/, "") };
  const slugPart = raw.slug.includes(":") ? raw.slug.slice(raw.slug.indexOf(":") + 1) : raw.slug;
  const prefix = raw.slug.includes(":") ? raw.slug.slice(0, raw.slug.indexOf(":")) : raw.kind;
  const kind =
    parseHostSessionKindToken(prefix ?? "") ??
    (isHostSessionPeerKind(raw.kind) ? raw.kind : undefined);
  const q = slugPart.trim().toLowerCase();
  if (!q) return undefined;
  const peers = sessions.filter((row) => isHostSessionPeer(row));
  const ranked = peers.filter((row) => !kind || sessionKind(row) === kind);
  const pool = ranked.length ? ranked : peers;
  const exact = pool.find((row) => {
    const slug = row.assetPack?.slug?.toLowerCase() || slugifyAssetTitle(sessionDisplayName(row));
    return (
      slug === q ||
      row.id.toLowerCase() === q ||
      row.id.toLowerCase().startsWith(q) ||
      sessionDisplayName(row).toLowerCase() === q
    );
  });
  if (!exact) return undefined;
  const resolvedKind = sessionKind(exact) as HostSessionPeerKind;
  return {
    id: exact.id,
    slug: exact.assetPack?.slug || slugifyAssetTitle(sessionDisplayName(exact)),
    kind: resolvedKind,
  };
}

export function defaultHostSessionCopyDest(slug: string, rel: string): string {
  const folder = slugifyAssetTitle(slug) || "peer";
  const path = rel.replace(/^\/+/, "").replace(/\\/g, "/");
  return path ? `peers/${folder}/${path}` : `peers/${folder}`;
}

export function formatHostSessionList(peers: HostSessionPeerSummary[]): string {
  if (!peers.length) {
    return "No other Locus chats with a workspace on this machine. Games, Assets, Design, and coding agents show up here once they exist.";
  }
  const blocks = peers.map((peer) => {
    const files = peer.files?.length
      ? `  files: ${peer.files.join(", ")}`
      : "  files: (empty or not yet written)";
    const brief = peer.brief?.trim() ? `  brief: ${clip(peer.brief.trim(), 400)}` : "";
    return [
      `@${peer.token} — ${peer.title} (${peer.kind}${peer.runtime ? `, ${peer.runtime}` : ""}, id ${peer.id})`,
      files,
      brief,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    "Other Locus chats on this machine. Call host_sessions with action=read or copy and session=<id or @token>. Copy into this /workspace before editing; do not write the peer.",
    ...blocks,
  ].join("\n");
}

export function formatHostSessionMentionsNote(peers: HostSessionPeerSummary[]): string {
  if (!peers.length) return "";
  const lines = peers.map((peer) => {
    const files = peer.files?.length ? ` — ${peer.files.join(", ")}` : "";
    return `- @${peer.token} (${peer.kind}, id ${peer.id})${files}`;
  });
  return [
    "Referenced Locus sessions. Inspect them with host_sessions (read/copy). Load their GAME.md / ASSET.md / index.html / vendor files; copy what you reuse into this /workspace.",
    ...lines,
  ].join("\n");
}

export function hostSessionsMcpTools(): Array<{
  name: string;
  description: string;
  inputSchema: ExtraToolDef["parameters"];
}> {
  return [
    {
      name: HOST_SESSIONS_TOOL.name,
      description: HOST_SESSIONS_TOOL.description,
      inputSchema: HOST_SESSIONS_TOOL.parameters,
    },
  ];
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}
