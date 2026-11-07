import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sanitizeArtifactStem, type BrowserArtifactKind } from "@locus/shared";
import { resolveSafeSessionFile } from "../session/sessionPaths.js";

const KIND_EXT: Record<BrowserArtifactKind, RegExp> = {
  pdf: /\.pdf$/i,
  trace: /\.json$/i,
  download: /\.[A-Za-z0-9]{1,8}$/,
};

export function artifactsRoot(dataDir: string): string {
  return join(dataDir, "artifacts");
}

export function artifactDest(
  dataDir: string,
  sessionId: string,
  filename: string,
  kind: BrowserArtifactKind,
): string {
  return resolveSafeSessionFile(
    artifactsRoot(dataDir),
    sessionId,
    filename,
    "Invalid artifact filename",
    (name) => KIND_EXT[kind].test(name),
  );
}

export function artifactContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".html")) return "text/html";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

export async function writeArtifactBytes(
  dataDir: string,
  sessionId: string,
  filename: string,
  kind: BrowserArtifactKind,
  bytes: Buffer,
): Promise<string> {
  const dest = artifactDest(dataDir, sessionId, filename, kind);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  return dest;
}

export function defaultArtifactName(kind: BrowserArtifactKind, raw?: string): string {
  const stem = sanitizeArtifactStem(
    raw,
    kind === "pdf" ? "page" : kind === "trace" ? "trace" : "download",
  );
  if (kind === "pdf") return `${stem}.pdf`;
  if (kind === "trace") return `${stem}.json`;
  return stem;
}
