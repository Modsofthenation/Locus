import type { ClientEvent } from "@locus/shared";
import { EVENTS_CONNECT_TIMEOUT_MS, reconnectDelayMs } from "./net";
import { withPhoneToken } from "./phoneAuth";

export function displayWsUrl(
  vmId: string,
  loc: Pick<Location, "protocol" | "host"> = location,
): string {
  const proto = loc.protocol === "https:" ? "wss" : "ws";
  return withPhoneToken(`${proto}://${loc.host}/ws/display/${encodeURIComponent(vmId)}`);
}

export function browserWsUrl(
  sessionId: string,
  loc: Pick<Location, "protocol" | "host"> = location,
): string {
  const proto = loc.protocol === "https:" ? "wss" : "ws";
  return withPhoneToken(`${proto}://${loc.host}/ws/browser/${encodeURIComponent(sessionId)}`);
}

export function terminalWsUrl(
  vmId: string,
  loc: Pick<Location, "protocol" | "host"> = location,
): string {
  const proto = loc.protocol === "https:" ? "wss" : "ws";
  return withPhoneToken(`${proto}://${loc.host}/ws/terminal/${encodeURIComponent(vmId)}`);
}

export function workspaceTerminalWsUrl(
  sessionId: string,
  loc: Pick<Location, "protocol" | "host"> = location,
  cwd?: string,
  terminalId?: string,
): string {
  const proto = loc.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams();
  if (cwd?.trim()) params.set("cwd", cwd.trim());
  if (terminalId?.trim()) params.set("terminal", terminalId.trim());
  const query = params.size ? `?${params.toString()}` : "";
  return withPhoneToken(
    `${proto}://${loc.host}/ws/workspace-terminal/${encodeURIComponent(sessionId)}${query}`,
  );
}

export type ConnectEventsOptions = {
  WebSocketImpl?: typeof WebSocket;
  retryDelayMs?: (attempt: number) => number;
  loc?: Pick<Location, "protocol" | "host">;
  subscribeNetwork?: boolean;
  connectTimeoutMs?: number;
};

export function eventsWsUrl(loc: Pick<Location, "protocol" | "host"> = location): string {
  const proto = loc.protocol === "https:" ? "wss" : "ws";
  return withPhoneToken(`${proto}://${loc.host}/ws`);
}

let eventsRetry: (() => void) | null = null;

/** Open the events socket now instead of waiting for the backoff timer. */
export function retryEvents(): void {
  eventsRetry?.();
}

export function connectEvents(
  onEvent: (event: ClientEvent) => void,
  onStatus?: (connected: boolean) => void,
  options?: ConnectEventsOptions,
): () => void {
  const WS = options?.WebSocketImpl ?? WebSocket;
  const delayFor = options?.retryDelayMs ?? ((attempt) => reconnectDelayMs(attempt));
  const loc = options?.loc ?? location;
  const subscribeNetwork = options?.subscribeNetwork !== false;
  const connectTimeoutMs = options?.connectTimeoutMs ?? EVENTS_CONNECT_TIMEOUT_MS;
  let stopped = false;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let lastStatus: boolean | undefined;

  const setStatus = (connected: boolean) => {
    if (lastStatus === connected) return;
    lastStatus = connected;
    onStatus?.(connected);
  };

  const open = () => {
    if (stopped) return;
    let next: WebSocket;
    try {
      next = new WS(eventsWsUrl(loc));
    } catch {
      schedule();
      return;
    }
    socket = next;
    connectTimer = setTimeout(() => {
      connectTimer = undefined;
      if (stopped || socket !== next || next.readyState !== 0) return;
      socket = null;
      setStatus(false);
      next.close();
      if (!stopped) schedule();
    }, connectTimeoutMs);
    next.onopen = () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = undefined;
      }
      attempt = 0;
      setStatus(true);
    };
    next.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(String(ev.data)) as ClientEvent);
      } catch {
        /* ignore */
      }
    };
    next.onerror = () => {
      /* close follows; avoid a double status flicker */
    };
    next.onclose = () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = undefined;
      }
      if (socket !== next) return;
      socket = null;
      setStatus(false);
      if (!stopped) schedule();
    };
  };

  const schedule = () => {
    if (stopped || timer) return;
    const delay = delayFor(attempt);
    attempt += 1;
    timer = setTimeout(() => {
      timer = undefined;
      if (stopped || socket) return;
      open();
    }, delay);
  };

  const poke = () => {
    if (stopped) return;
    const state = socket?.readyState;
    if (state === 1) return;
    if (state === 0 && socket) {
      const stuck = socket;
      socket = null;
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = undefined;
      }
      stuck.close();
    }
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    attempt = 0;
    open();
  };

  eventsRetry = poke;

  const onOnline = () => poke();
  const onVisible = () => {
    if (document.visibilityState === "visible") poke();
  };

  open();
  if (subscribeNetwork && typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
  }

  return () => {
    stopped = true;
    if (eventsRetry === poke) eventsRetry = null;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = undefined;
    if (subscribeNetwork && typeof window !== "undefined") {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    }
    const current = socket;
    socket = null;
    current?.close();
  };
}
