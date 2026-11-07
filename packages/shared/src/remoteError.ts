const MAX_REMOTE_ERROR = 800;
const UNWRAP_DEPTH = 5;

/** Pull a human sentence out of forge/API JSON dumps. */
export function formatRemoteError(raw: unknown, fallback = "Request failed"): string {
  const text = unwrapRemoteError(raw, UNWRAP_DEPTH).trim();
  if (!text) return fallback;
  return text.length > MAX_REMOTE_ERROR ? `${text.slice(0, MAX_REMOTE_ERROR - 1)}…` : text;
}

export function isForgeAuthError(message: string): boolean {
  return /token|unauthori[sz]ed|bad credentials|invalid_grant|authentication required|expired/i.test(
    message,
  );
}

function unwrapRemoteError(raw: unknown, depth: number): string {
  if (raw == null || depth <= 0) return "";
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (typeof raw === "string") return unwrapRemoteString(raw, depth);
  if (Array.isArray(raw)) {
    return raw
      .map((row) => unwrapRemoteError(row, depth - 1))
      .filter(Boolean)
      .join("; ");
  }
  if (typeof raw !== "object") return "";
  return unwrapRemoteObject(raw as Record<string, unknown>, depth);
}

function unwrapRemoteString(raw: string, depth: number): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const inner = unwrapRemoteError(JSON.parse(trimmed) as unknown, depth - 1);
      if (inner) return inner;
    } catch {
      /* keep the original string */
    }
  }
  return trimmed;
}

function unwrapRemoteObject(obj: Record<string, unknown>, depth: number): string {
  if (obj.error && typeof obj.error === "object") {
    const nested = unwrapRemoteError(obj.error, depth - 1);
    if (nested) return nested;
  }
  for (const key of ["message", "error_description", "detail"] as const) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (obj.errors != null) {
    const listed = unwrapRemoteError(obj.errors, depth - 1);
    if (listed) return listed;
  }
  if (typeof obj.error === "string" && obj.error.trim()) {
    return unwrapRemoteString(obj.error, depth - 1);
  }
  return "";
}
