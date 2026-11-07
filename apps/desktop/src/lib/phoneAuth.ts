const STORAGE_KEY = "locus.phoneToken";

let memory: string | undefined;

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

export function initPhoneAuth(
  loc: Pick<Location, "pathname" | "search" | "hash"> = location,
  historyApi: Pick<History, "replaceState"> = history,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = defaultStorage(),
): void {
  const params = new URLSearchParams(loc.search);
  const fromQuery = params.get("token")?.trim();
  if (fromQuery) {
    memory = fromQuery;
    try {
      storage?.setItem(STORAGE_KEY, fromQuery);
    } catch {
      /* private mode */
    }
    params.delete("token");
    const search = params.toString();
    try {
      historyApi.replaceState(null, "", `${loc.pathname}${search ? `?${search}` : ""}${loc.hash}`);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    memory = storage?.getItem(STORAGE_KEY)?.trim() || undefined;
  } catch {
    memory = undefined;
  }
}

export function phoneToken(): string | undefined {
  if (memory) return memory;
  try {
    memory = defaultStorage()?.getItem(STORAGE_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
  return memory;
}

export function phoneAuthHeaders(): Record<string, string> {
  const token = phoneToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export function withPhoneToken(url: string): string {
  const token = phoneToken();
  if (!token || url.startsWith("data:")) return url;
  try {
    const relative = url.startsWith("/") || url.startsWith("./");
    const parsed = relative ? new URL(url, "http://locus.invalid") : new URL(url);
    if (!parsed.searchParams.has("token")) parsed.searchParams.set("token", token);
    if (relative) return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return parsed.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}token=${encodeURIComponent(token)}`;
  }
}

export function clearPhoneAuth(
  storage: Pick<Storage, "removeItem"> | undefined = defaultStorage(),
): void {
  memory = undefined;
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
