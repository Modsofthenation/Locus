import { WebSocket, type RawData } from "ws";

export interface SlackSocketEnvelope {
  envelope_id?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

export type SlackSocketConnect = (url: string) => SlackSocketHandle;

export interface SlackSocketHandle {
  send(data: string): void;
  close(): void;
  onMessage(handler: (raw: string) => void): void;
  onClose(handler: () => void): void;
  onOpen?(handler: () => void): void;
}

export function slackSocketAck(envelopeId: string): string {
  return JSON.stringify({ envelope_id: envelopeId });
}

/** Outbound Socket Mode client. App token opens the URL; this talks to the WSS. */
export function slackSocketConnect(url: string): SlackSocketHandle {
  const ws = new WebSocket(url);
  return {
    send(data) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close() {
      ws.close();
    },
    onMessage(handler) {
      ws.on("message", (raw) => {
        handler(socketRawToString(raw));
      });
    },
    onClose(handler) {
      ws.on("close", handler);
      ws.on("error", () => handler());
    },
    onOpen(handler) {
      if (ws.readyState === WebSocket.OPEN) handler();
      else ws.once("open", handler);
    },
  };
}

export class SlackSocket {
  private handle: SlackSocketHandle | undefined;
  private closed = false;

  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly connectFn?: SlackSocketConnect,
  ) {}

  async start(
    appToken: string,
    onEnvelope: (envelope: SlackSocketEnvelope) => void,
  ): Promise<void> {
    this.closed = false;
    const token = appToken.trim();
    if (!token) throw new Error("Slack app token is required for Socket Mode");
    const res = await this.fetchFn("https://slack.com/api/apps.connections.open", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    const body = (await res.json()) as { ok?: boolean; error?: string; url?: string };
    if (!body.ok || !body.url) {
      throw new Error(body.error || "Slack Socket Mode open failed");
    }
    const connect = this.connectFn;
    if (!connect) {
      /* Tests may skip the WSS hop; production always passes slackSocketConnect. */
      return;
    }
    this.handle = connect(body.url);
    this.handle.onMessage((raw) => {
      let envelope: SlackSocketEnvelope;
      try {
        envelope = JSON.parse(raw) as SlackSocketEnvelope;
      } catch {
        return;
      }
      if (envelope.envelope_id) this.handle?.send(slackSocketAck(envelope.envelope_id));
      onEnvelope(envelope);
    });
    await waitForOpen(this.handle);
    this.handle.onClose(() => {
      if (!this.closed) {
        /* caller restarts */
      }
    });
  }

  stop(): void {
    this.closed = true;
    this.handle?.close();
    this.handle = undefined;
  }
}

function waitForOpen(handle: SlackSocketHandle): Promise<void> {
  const onOpen = handle.onOpen;
  if (!onOpen) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error("Slack Socket Mode connect timeout")), 10_000);
    handle.onClose?.(() => finish(new Error("Slack Socket Mode closed")));
    onOpen(() => finish());
  });
}

function socketRawToString(raw: RawData): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return raw.toString("utf8");
}
