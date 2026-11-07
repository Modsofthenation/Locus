import { WebSocket as WsWebSocket } from "ws";

export type WsLike = {
  on?(type: string, fn: (data?: unknown) => void): void;
  addEventListener?(type: string, fn: (event?: { data?: unknown }) => void): void;
  send(data: string): void;
  close(): void;
};

export type WsCtor = new (url: string) => WsLike;

export type CdpSession = {
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  wait: (method: string) => Promise<Record<string, unknown>>;
};

export async function cdpCall(
  wsUrl: string,
  method: string,
  params: Record<string, unknown>,
  wsCtor: WsCtor = WsWebSocket as unknown as WsCtor,
  timeoutMs = 8000,
): Promise<unknown> {
  return withCdpSession(wsUrl, wsCtor, (session) => session.call(method, params), timeoutMs);
}

export async function withCdpSession<T>(
  wsUrl: string,
  wsCtor: WsCtor,
  fn: (session: CdpSession) => Promise<T>,
  timeoutMs = 8000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new wsCtor(wsUrl);
    let nextId = 1;
    const pending = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (err: Error) => void }
    >();
    const waiters: Array<{ method: string; resolve: (value: Record<string, unknown>) => void }> =
      [];
    const timer = setTimeout(() => fail(new Error(`CDP timeout: ${timeoutMs}ms`)), timeoutMs);
    const fail = (err: Error) => {
      clearTimeout(timer);
      ws.close();
      reject(err);
    };
    const session: CdpSession = {
      call(method, params) {
        const id = nextId;
        nextId += 1;
        return new Promise((res, rej) => {
          pending.set(id, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      wait(method) {
        return new Promise((res) => {
          waiters.push({ method, resolve: res });
        });
      },
    };
    bindWs(ws, "open", () => {
      fn(session)
        .then((value) => {
          clearTimeout(timer);
          ws.close();
          resolve(value);
        })
        .catch(fail);
    });
    bindWs(ws, "message", (data) => {
      try {
        const payload = JSON.parse(wsPayload(data)) as {
          id?: number;
          method?: string;
          result?: unknown;
          error?: { message?: string };
          params?: Record<string, unknown>;
        };
        if (payload.id != null) {
          const waiter = pending.get(payload.id);
          if (!waiter) return;
          pending.delete(payload.id);
          if (payload.error?.message) waiter.reject(new Error(payload.error.message));
          else waiter.resolve(payload.result ?? {});
          return;
        }
        if (payload.method) {
          const idx = waiters.findIndex((row) => row.method === payload.method);
          if (idx >= 0) {
            const [row] = waiters.splice(idx, 1);
            row?.resolve(payload.params ?? {});
          }
        }
      } catch (err) {
        fail(err instanceof Error ? err : new Error("CDP parse failed"));
      }
    });
    bindWs(ws, "error", () => fail(new Error("CDP socket failed")));
  });
}

export function bindWs(ws: WsLike, type: string, fn: (data?: unknown) => void): void {
  if (typeof ws.on === "function") {
    ws.on(type, fn);
    return;
  }
  ws.addEventListener?.(type, (event) => fn(event?.data ?? event));
}

export function wsPayload(data: unknown): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString();
  if (data && typeof data === "object" && "data" in data)
    return String((data as { data: unknown }).data);
  return String(data);
}

export class LiveCdp {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private events: Array<(method: string, params: Record<string, unknown>) => void> = [];
  private closeHandlers: Array<() => void> = [];
  private closed = false;

  private constructor(private readonly ws: WsLike) {
    bindWs(ws, "message", (data) => {
      try {
        const payload = JSON.parse(wsPayload(data)) as {
          id?: number;
          method?: string;
          result?: unknown;
          error?: { message?: string };
          params?: Record<string, unknown>;
        };
        if (payload.id != null) {
          const waiter = this.pending.get(payload.id);
          if (!waiter) return;
          this.pending.delete(payload.id);
          if (payload.error?.message) waiter.reject(new Error(payload.error.message));
          else waiter.resolve(payload.result ?? {});
          return;
        }
        if (payload.method) {
          for (const fn of this.events) fn(payload.method, payload.params ?? {});
        }
      } catch {
        /* ignore a bad frame; keep the screencast socket */
      }
    });
    bindWs(ws, "error", () => this.fail(new Error("CDP socket failed")));
    bindWs(ws, "close", () => this.fail(new Error("CDP closed")));
  }

  static connect(wsUrl: string, wsCtor: WsCtor): Promise<LiveCdp> {
    return new Promise((resolve, reject) => {
      const ws = new wsCtor(wsUrl);
      const timer = setTimeout(() => reject(new Error("CDP timeout: 8000ms")), 8000);
      bindWs(ws, "open", () => {
        clearTimeout(timer);
        resolve(new LiveCdp(ws));
      });
      bindWs(ws, "error", () => {
        clearTimeout(timer);
        reject(new Error("CDP socket failed"));
      });
    });
  }

  onEvent(fn: (method: string, params: Record<string, unknown>) => void): void {
    this.events.push(fn);
  }

  onClose(fn: () => void): void {
    this.closeHandlers.push(fn);
  }

  call(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("CDP closed"));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.fail(new Error("CDP closed"));
    this.ws.close();
  }

  private fail(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.pending.values()) waiter.reject(err);
    this.pending.clear();
    for (const fn of this.closeHandlers) fn();
  }
}
