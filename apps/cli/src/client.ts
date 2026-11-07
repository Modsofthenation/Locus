import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import WebSocket from "ws";
import type { ClientEvent } from "@locus/shared";

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function defaultApiUrl(): string {
  const env = process.env.LOCUS_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  try {
    const home = process.env.LOCUS_HOME?.trim() || join(homedir(), ".locus");
    const raw = JSON.parse(readFileSync(join(home, "config.json"), "utf8")) as {
      advanced?: { bindHost?: string; bindPort?: number };
    };
    const port = raw.advanced?.bindPort ?? 7420;
    const bind = raw.advanced?.bindHost?.trim() || "127.0.0.1";
    const host = bind === "0.0.0.0" || bind === "::" || bind === "[::]" ? "127.0.0.1" : bind;
    return `http://${host}:${port}`;
  } catch {
    return "http://127.0.0.1:7420";
  }
}

export class LocusClient {
  constructor(readonly baseUrl: string) {}

  url(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  wsUrl(path = "/ws"): string {
    const http = this.url(path);
    return http.replace(/^http/i, "ws");
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };
    let res: Response;
    try {
      res = await fetch(this.url(path), { ...init, headers });
    } catch (err) {
      const hint =
        err instanceof Error && /fetch|ECONNREFUSED|ENOTFOUND/i.test(err.message)
          ? err.message
          : "connection failed";
      throw new Error(
        `Cannot reach Locus at ${this.baseUrl} (${hint}). Start the control plane with \`locus serve\` or \`npm run dev:server\`.`,
      );
    }
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        try {
          const text = await res.text();
          if (text.trim()) message = text.trim();
        } catch {
          /* ignore */
        }
      }
      throw new HttpError(message, res.status);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text.trim()) return undefined as T;
    return JSON.parse(text) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      body: JSON.stringify(body ?? {}),
    });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }

  connectEvents(
    onEvent: (event: ClientEvent) => void,
    onClose?: (err?: Error) => void,
  ): () => void {
    const socket = new WebSocket(this.wsUrl("/ws"));
    let closed = false;
    let sawMessage = false;
    let fail: Error | undefined;
    socket.on("open", () => {
      /* connected */
    });
    socket.on("message", (data) => {
      sawMessage = true;
      try {
        onEvent(JSON.parse(String(data)) as ClientEvent);
      } catch {
        /* ignore malformed hub frames */
      }
    });
    socket.on("close", () => {
      if (!closed) {
        onClose?.(
          fail ??
            (sawMessage
              ? undefined
              : new Error(
                  `Cannot reach Locus at ${this.baseUrl}. Start the control plane with \`locus serve\` or \`npm run dev:server\`.`,
                )),
        );
      }
    });
    socket.on("error", (err) => {
      fail = new Error(
        `Cannot reach Locus at ${this.baseUrl} (${err instanceof Error ? err.message : "connection failed"}). Start the control plane with \`locus serve\` or \`npm run dev:server\`.`,
      );
    });
    return () => {
      closed = true;
      socket.close();
    };
  }
}
