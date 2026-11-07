import { normalizeWorkerUrl, parseWorkerFingerprint } from "./worker.js";

const ADD_PREFIX = "locus-worker:add";

/** One-shot pairing line printed by locus-worker. Token is optional (first create only). */
export interface WorkerAddBlob {
  url: string;
  fingerprint?: string;
  token?: string;
  name?: string;
}

export function formatWorkerAddBlob(input: WorkerAddBlob): string {
  const params = new URLSearchParams();
  params.set("url", input.url);
  if (input.fingerprint) params.set("fp", input.fingerprint);
  if (input.name?.trim()) params.set("name", input.name.trim());
  if (input.token?.trim()) params.set("token", input.token.trim());
  return `${ADD_PREFIX}?${params.toString()}`;
}

export function parseWorkerAddBlob(raw: string): WorkerAddBlob | undefined {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return undefined;
  if (trimmed.startsWith(ADD_PREFIX)) {
    const q = trimmed.indexOf("?");
    if (q < 0) return undefined;
    return blobFromParams(new URLSearchParams(trimmed.slice(q + 1)));
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const hostUrl = normalizeWorkerUrl(`${parsed.protocol}//${parsed.host}`);
      if (
        parsed.searchParams.has("fp") ||
        parsed.searchParams.has("token") ||
        parsed.searchParams.has("name")
      ) {
        return blobFromParams(parsed.searchParams, hostUrl);
      }
      return hostUrl ? { url: hostUrl } : undefined;
    } catch {
      return undefined;
    }
  }
  return parseWorkerAddLines(trimmed);
}

function blobFromParams(params: URLSearchParams, urlFallback?: string): WorkerAddBlob | undefined {
  const url = normalizeWorkerUrl(params.get("url") ?? urlFallback ?? "");
  if (!url) return undefined;
  const fingerprint = parseWorkerFingerprint(
    params.get("fp") ?? params.get("fingerprint") ?? undefined,
  );
  const token = params.get("token")?.trim() || undefined;
  const name = params.get("name")?.trim() || undefined;
  return { url, fingerprint, token, name };
}

function parseWorkerAddLines(raw: string): WorkerAddBlob | undefined {
  const fields: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(url|tls|fp|fingerprint|token|name)\s*[:=]\s*(.+)\s*$/i.exec(line);
    if (!match) continue;
    fields[match[1]!.toLowerCase()] = match[2]!.trim();
  }
  const url = normalizeWorkerUrl(fields.url ?? "");
  if (!url) return undefined;
  return {
    url,
    fingerprint: parseWorkerFingerprint(fields.tls ?? fields.fp ?? fields.fingerprint),
    token: fields.token || undefined,
    name: fields.name || undefined,
  };
}
