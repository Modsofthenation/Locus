import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { containedPath } from "@locus/guest-agent";
import type { ToolResult } from "@locus/guest-agent";
import {
  defaultHostSessionCopyDest,
  formatHostSessionList,
  formatHostSessionMentionsNote,
  hostSessionMentionToken,
  hostSessionSlug,
  isHostSessionPeer,
  isHostSessionPeerKind,
  isHostSessionsAction,
  isSensitivePath,
  parseHostSessionKindToken,
  parseHostSessionMentions,
  resolveHostSessionMention,
  sessionKind,
  sessionOffersHostSessions,
  type AgentSession,
  type HostSessionPeerKind,
  type HostSessionPeerSummary,
} from "@locus/shared";
import {
  grepWorkspace,
  listWorkspace,
  readWorkspaceFile,
  sanitizeWorkspaceRel,
  writeWorkspaceBytes,
} from "../workspace/workspaceFiles.js";

const BRIEF_FILES = ["GAME.md", "ASSET.md", "DESIGN.md", "README.md"];
const NOTABLE_FILES = [...BRIEF_FILES, "index.html", "package.json"];
const NOTABLE_DIRS = ["vendor", ".locus-asset", ".locus-game", ".locus-attachments"];
const MAX_LIST_PEERS = 40;
const MAX_LIST_FILES = 24;
const MAX_READ_CHARS = 24_000;
const MAX_COPY_FILES = 40;
const MAX_COPY_BYTES = 25 * 1024 * 1024;

export type HostSessionsPorts = {
  loadSessions: () => Promise<AgentSession[]>;
  workspaceRoot: (session: AgentSession) => string | undefined;
};

export async function executeHostSessions(
  caller: AgentSession,
  args: Record<string, unknown>,
  ports: HostSessionsPorts,
): Promise<ToolResult> {
  if (!sessionOffersHostSessions(caller)) {
    return {
      ok: false,
      output:
        "host_sessions is only available on host agents. Start a Host chat to inspect Games, Assets, and other local workspaces.",
    };
  }
  const callerRoot = ports.workspaceRoot(caller);
  const action = isHostSessionsAction(args.action) ? args.action : "list";
  const peers = await loadPeerSummaries(caller, args, ports);
  if (action === "list") {
    return { ok: true, output: formatHostSessionList(peers) };
  }
  const target = await resolveTarget(caller, args, ports);
  if (!target) {
    return {
      ok: false,
      output:
        "session is required. Pass an id, title, or @game/@asset/@agent token from host_sessions list.",
    };
  }
  const root = ports.workspaceRoot(target.session);
  if (!root) {
    return {
      ok: false,
      output: `${target.summary.title} has no workspace on this machine yet.`,
    };
  }
  if (action === "grep") {
    const pattern =
      typeof args.pattern === "string"
        ? args.pattern
        : typeof args.query === "string"
          ? args.query
          : "";
    if (pattern.trim().length < 2) {
      return { ok: false, output: "pattern must be at least 2 characters." };
    }
    const rawPath = typeof args.path === "string" ? args.path : "";
    const rel = rawPath ? sanitizeWorkspaceRel(rawPath, root) : "";
    if (rel && (isSensitivePath(rel) || isSensitivePath(rawPath))) {
      return { ok: false, output: "Refusing to search a credential file from another session." };
    }
    const glob = rel
      ? rel.includes("*")
        ? rel
        : (await existsFile(root, rel))
          ? rel
          : `${rel.replace(/\/$/, "")}/**`
      : undefined;
    if (glob && (isSensitivePath(glob) || glob.split("/").some((part) => isSensitivePath(part)))) {
      return { ok: false, output: "Refusing to search a credential file from another session." };
    }
    const found = await grepWorkspace(root, pattern, 80, glob ? { glob } : {});
    if (found.error) return { ok: false, output: found.error };
    const items = found.items.filter((hit) => !isSensitivePath(hit.path));
    if (!items.length) return { ok: true, output: `No matches in ${target.summary.token}.` };
    const lines = items.map(
      (hit) => `${hit.path}:${hit.line}: ${hit.text.replace(/\s+/g, " ").trim()}`,
    );
    return {
      ok: true,
      output: [`${items.length} hit(s) in @${target.summary.token}`, ...lines].join("\n"),
    };
  }
  const rel = typeof args.path === "string" ? args.path.trim() : "";
  if (action === "read") {
    const path = rel || (await defaultReadPath(root, target.summary.kind));
    if (!path) {
      return {
        ok: false,
        output: "path is required (for example GAME.md, ASSET.md, or index.html).",
      };
    }
    return readPeerFile(root, path, target.summary);
  }
  if (!callerRoot) {
    return { ok: false, output: "This host chat has no workspace to copy into." };
  }
  const from = rel || "";
  const destRaw =
    typeof args.dest === "string" && args.dest.trim()
      ? args.dest.trim()
      : defaultHostSessionCopyDest(target.summary.slug, from);
  return copyPeerPath(root, from, callerRoot, destRaw, target.summary);
}

export async function hostSessionMentionNote(
  caller: AgentSession,
  content: string,
  ports: HostSessionsPorts,
): Promise<string> {
  if (!sessionOffersHostSessions(caller)) return "";
  const mentioned = parseHostSessionMentions(content);
  if (!mentioned.length) return "";
  const sessions = await ports.loadSessions();
  const summaries: HostSessionPeerSummary[] = [];
  for (const mention of mentioned) {
    const hit = resolveHostSessionMention(mention, sessions);
    if (!hit || hit.id === caller.id) continue;
    const session = sessions.find((row) => row.id === hit.id);
    if (!session) continue;
    summaries.push(await summarizePeer(session, ports, { files: true, brief: false }));
  }
  return formatHostSessionMentionsNote(summaries);
}

async function loadPeerSummaries(
  caller: AgentSession,
  args: Record<string, unknown>,
  ports: HostSessionsPorts,
): Promise<HostSessionPeerSummary[]> {
  const sessions = await ports.loadSessions();
  const kindArg = isHostSessionPeerKind(args.kind)
    ? args.kind
    : parseHostSessionKindToken(String(args.kind ?? args.query ?? ""));
  const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
  const queryKind = parseHostSessionKindToken(query);
  const kind = kindArg ?? queryKind;
  const needle = queryKind && queryKind === kind ? "" : query;
  const out: HostSessionPeerSummary[] = [];
  for (const row of sessions) {
    if (row.id === caller.id || !isHostSessionPeer(row)) continue;
    if (kind && sessionKind(row) !== kind) continue;
    const summary = await summarizePeer(row, ports, { files: true, brief: true });
    if (needle && !peerMatchesQuery(summary, needle)) continue;
    out.push(summary);
    if (out.length >= MAX_LIST_PEERS) break;
  }
  return out.sort((a, b) => a.title.localeCompare(b.title) || a.kind.localeCompare(b.kind));
}

async function resolveTarget(
  caller: AgentSession,
  args: Record<string, unknown>,
  ports: HostSessionsPorts,
): Promise<{ session: AgentSession; summary: HostSessionPeerSummary } | undefined> {
  const raw =
    typeof args.session === "string"
      ? args.session.trim()
      : typeof args.query === "string"
        ? args.query.trim()
        : "";
  if (!raw) return undefined;
  const sessions = await ports.loadSessions();
  const hit = resolveHostSessionMention(raw.replace(/^@/, ""), sessions);
  const session = sessions.find((row) => row.id === (hit?.id ?? raw) || row.id === hit?.id);
  if (!session || session.id === caller.id || !isHostSessionPeer(session)) return undefined;
  return { session, summary: await summarizePeer(session, ports, { files: true, brief: false }) };
}

async function summarizePeer(
  session: AgentSession,
  ports: HostSessionsPorts,
  opts: { files: boolean; brief: boolean },
): Promise<HostSessionPeerSummary> {
  const kind = sessionKind(session) as HostSessionPeerKind;
  const slug = session.assetPack?.slug || hostSessionSlug(session);
  const summary: HostSessionPeerSummary = {
    id: session.id,
    kind,
    title: session.title || slug,
    slug,
    token: hostSessionMentionToken(kind, slug),
    runtime: session.runtime,
  };
  const root = ports.workspaceRoot(session);
  if (!root || (!opts.files && !opts.brief)) return summary;
  const files = await notableFiles(root);
  if (opts.files) summary.files = files;
  if (opts.brief) {
    for (const name of BRIEF_FILES) {
      if (!files.includes(name)) continue;
      const file = await readWorkspaceFile(root, name).catch(() => undefined);
      const text = file?.content?.trim();
      if (text) {
        summary.brief = text.slice(0, 500);
        break;
      }
    }
  }
  return summary;
}

function peerMatchesQuery(peer: HostSessionPeerSummary, query: string): boolean {
  const q = query.replace(/^@/, "").toLowerCase();
  return (
    peer.id.toLowerCase().startsWith(q) ||
    peer.slug.toLowerCase().includes(q) ||
    peer.title.toLowerCase().includes(q) ||
    peer.token.toLowerCase().includes(q) ||
    peer.kind.toLowerCase().includes(q)
  );
}

async function notableFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of NOTABLE_FILES) {
    if (await existsFile(root, name)) found.push(name);
  }
  for (const dir of NOTABLE_DIRS) {
    const children = await listDirNames(root, dir);
    if (!children.length) continue;
    found.push(`${dir}/`);
    for (const name of children) {
      if (found.length >= MAX_LIST_FILES) break;
      found.push(`${dir}/${name}`);
    }
  }
  if (found.length < 8) {
    const top = await listWorkspace(root, "", 1).catch(() => []);
    for (const child of top) {
      if (found.length >= MAX_LIST_FILES) break;
      if (!found.includes(child.path) && !found.includes(`${child.path}/`)) found.push(child.path);
    }
  }
  return found.slice(0, MAX_LIST_FILES);
}

async function defaultReadPath(root: string, kind: HostSessionPeerKind): Promise<string> {
  const preferred =
    kind === "game"
      ? ["GAME.md", "index.html"]
      : kind === "assets"
        ? ["ASSET.md", "index.html"]
        : kind === "design"
          ? ["DESIGN.md", "index.html"]
          : ["README.md", "index.html", "GAME.md", "ASSET.md"];
  for (const path of preferred) {
    if (await existsFile(root, path)) return path;
  }
  return preferred[0] ?? "index.html";
}

async function readPeerFile(
  root: string,
  rel: string,
  peer: HostSessionPeerSummary,
): Promise<ToolResult> {
  const clean = sanitizeWorkspaceRel(rel, root);
  if (!clean) return { ok: false, output: `path is outside the peer workspace: ${rel}` };
  if (isSensitivePath(clean) || isSensitivePath(rel)) {
    return { ok: false, output: "Refusing to read a credential file from another session." };
  }
  try {
    const file = await readWorkspaceFile(root, clean);
    if (!file) return { ok: false, output: `not found in @${peer.token}: ${clean}` };
    const body =
      file.content.length > MAX_READ_CHARS
        ? `${file.content.slice(0, MAX_READ_CHARS)}\n…[truncated ${file.content.length} chars. copy the file or pass offset via another read of a smaller path]`
        : file.content;
    return { ok: true, output: `=== @${peer.token} ${clean} ===\n${body}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "read failed";
    if (/binary/i.test(message) || /too large/i.test(message)) {
      return {
        ok: false,
        output: `${clean} in @${peer.token} is not a text file (${message}). Use action=copy to bring it into this /workspace.`,
      };
    }
    return { ok: false, output: message };
  }
}

async function copyPeerPath(
  srcRoot: string,
  rel: string,
  destRoot: string,
  destRel: string,
  peer: HostSessionPeerSummary,
): Promise<ToolResult> {
  const from = sanitizeWorkspaceRel(rel || ".", srcRoot);
  const to = sanitizeWorkspaceRel(destRel, destRoot);
  if (!from && rel) return { ok: false, output: `path is outside the peer workspace: ${rel}` };
  if (!to) return { ok: false, output: `dest is outside this /workspace: ${destRel}` };
  if (isSensitivePath(from) || isSensitivePath(to)) {
    return { ok: false, output: "Refusing to copy a credential file from another session." };
  }
  const srcAbs = join(srcRoot, from);
  const srcReal = await containedPath(srcRoot, srcAbs);
  if (!srcReal) return { ok: false, output: `not found in @${peer.token}: ${from || "/"}` };
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(srcReal);
  } catch {
    return { ok: false, output: `not found in @${peer.token}: ${from || "/"}` };
  }
  if (info.isSymbolicLink()) {
    return { ok: false, output: "Refusing to copy a symlink." };
  }
  if (info.isFile()) {
    const copied = await copyOneFile(srcRoot, from, destRoot, to);
    if (!copied.ok) return copied;
    return { ok: true, output: `Copied @${peer.token}:${from} → /workspace/${to}` };
  }
  const entries = from
    ? await listWorkspace(srcRoot, from, 8).catch(() => [])
    : await notableCopyEntries(srcRoot);
  const files = entries.filter((row) => row.type === "file").slice(0, MAX_COPY_FILES);
  if (!files.length) {
    return { ok: false, output: `No files to copy from @${peer.token}:${from || "/"}` };
  }
  let bytes = 0;
  const written: string[] = [];
  for (const file of files) {
    if (isSensitivePath(file.path)) continue;
    const suffix = file.path.slice(from.length).replace(/^\/+/, "") || basename(file.path);
    const dest = [to, suffix].filter(Boolean).join("/");
    const result = await copyOneFile(srcRoot, file.path, destRoot, dest);
    if (!result.ok) continue;
    bytes += result.bytes ?? 0;
    written.push(dest);
    if (bytes > MAX_COPY_BYTES) break;
  }
  if (!written.length) {
    return { ok: false, output: `Could not copy files from @${peer.token}:${from || "/"}` };
  }
  return {
    ok: true,
    output: `Copied ${written.length} file(s) from @${peer.token}:${from || "/"} → /workspace/${to}\n${written
      .slice(0, 20)
      .map((path) => `- ${path}`)
      .join("\n")}`,
  };
}

async function copyOneFile(
  srcRoot: string,
  srcRel: string,
  destRoot: string,
  destRel: string,
): Promise<ToolResult & { bytes?: number }> {
  const from = sanitizeWorkspaceRel(srcRel, srcRoot);
  const to = sanitizeWorkspaceRel(destRel, destRoot);
  if (!from || !to) return { ok: false, output: "Invalid path" };
  if (isSensitivePath(from) || isSensitivePath(to)) {
    return { ok: false, output: "Refusing to copy a credential file from another session." };
  }
  const srcAbs = join(srcRoot, from);
  const srcReal = await containedPath(srcRoot, srcAbs);
  if (!srcReal) return { ok: false, output: `not found: ${from}` };
  try {
    const info = await lstat(srcReal);
    if (info.isSymbolicLink() || !info.isFile())
      return { ok: false, output: `not a file: ${from}` };
    if (info.size > MAX_COPY_BYTES) return { ok: false, output: `too large: ${from}` };
    const bytes = await readFile(srcReal);
    await writeWorkspaceBytes(destRoot, to, bytes);
    return { ok: true, output: to, bytes: bytes.length };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "copy failed" };
  }
}

async function existsFile(root: string, rel: string): Promise<boolean> {
  try {
    const real = await containedPath(root, join(root, rel));
    return Boolean(real && (await lstat(real)).isFile());
  } catch {
    return false;
  }
}

async function notableCopyEntries(root: string): Promise<Array<{ path: string; type: "file" }>> {
  const out: Array<{ path: string; type: "file" }> = [];
  for (const name of NOTABLE_FILES) {
    if (await existsFile(root, name)) out.push({ path: name, type: "file" });
  }
  for (const dir of NOTABLE_DIRS) {
    const listed = await listWorkspace(root, dir, 6).catch(() => []);
    for (const row of listed) {
      if (row.type === "file") out.push({ path: row.path, type: "file" });
    }
    if (!listed.length) {
      const names = await listDirNames(root, dir);
      for (const name of names) {
        const rel = `${dir}/${name}`;
        if (await existsFile(root, rel)) out.push({ path: rel, type: "file" });
      }
    }
  }
  return out;
}

async function listDirNames(root: string, rel: string): Promise<string[]> {
  try {
    const real = await containedPath(root, join(root, rel));
    if (!real) return [];
    const info = await lstat(real);
    if (!info.isDirectory()) return [];
    const names = await readdir(real);
    return names.filter((name) => name && !name.startsWith(".")).slice(0, 12);
  } catch {
    return [];
  }
}
