import { basename, relative, resolve } from "node:path";
import { qemuPathUnsafe } from "@locus/shared";

/** Reject session ids that would escape the data-dir tree. */
export function requireSafeSessionId(sessionId: string): string {
  const session = basename(sessionId);
  if (
    !session ||
    session !== sessionId ||
    session === "." ||
    session === ".." ||
    qemuPathUnsafe(session)
  ) {
    throw new Error("Invalid session");
  }
  return session;
}

/** Resolve a leaf file under a session directory. `accept` is the kind adapter (ext). */
export function resolveSafeSessionFile(
  dir: string,
  sessionId: string,
  filename: string,
  error: string,
  accept?: (name: string) => boolean,
): string {
  const session = requireSafeSessionId(sessionId);
  const name = basename(filename.replaceAll("\\", "/"));
  if (
    !name ||
    name !== filename.replaceAll("\\", "/") ||
    name === "." ||
    name === ".." ||
    qemuPathUnsafe(name) ||
    (accept && !accept(name))
  ) {
    throw new Error(error);
  }
  const dest = resolve(dir, session, name);
  const rel = relative(resolve(dir, session), dest);
  if (!rel || rel.startsWith("..") || rel.includes("/") || rel.includes("\\")) {
    throw new Error(error);
  }
  return dest;
}
