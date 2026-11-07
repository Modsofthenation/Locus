import { createConnection, type Socket } from "node:net";

export function attachSerialLog(opts: {
  host?: string;
  port: number;
  onData: (chunk: string) => void;
  signal: AbortSignal;
  retryMs?: number;
}): void {
  const host = opts.host ?? "127.0.0.1";
  const retryMs = opts.retryMs ?? 250;
  let socket: Socket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = opts.signal.aborted;

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    socket?.destroy();
    socket = undefined;
  };
  opts.signal.addEventListener("abort", stop, { once: true });
  if (stopped) return;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(connect, retryMs);
    timer.unref?.();
  };

  const connect = () => {
    if (stopped) return;
    const sock = createConnection({ host, port: opts.port });
    let done = false;
    sock.setEncoding("utf8");
    sock.on("connect", () => {
      if (stopped) {
        sock.destroy();
        return;
      }
      socket = sock;
    });
    sock.on("data", (chunk: string | Buffer) => {
      if (stopped) return;
      opts.onData(typeof chunk === "string" ? chunk : chunk.toString());
    });
    const retry = () => {
      if (done || stopped) return;
      done = true;
      if (socket === sock) socket = undefined;
      sock.destroy();
      schedule();
    };
    sock.on("error", retry);
    sock.on("close", retry);
  };

  connect();
}
