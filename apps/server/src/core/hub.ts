import type { ServerCommand, ClientEvent } from "@locus/shared";
import type { WebSocket } from "ws";

type Socket = WebSocket & { send(data: string): void };

export class Hub {
  private clients = new Set<Socket>();
  private listeners = new Set<(event: ClientEvent) => void>();

  add(ws: Socket): void {
    this.clients.add(ws);
    const drop = () => this.clients.delete(ws);
    ws.on("close", drop);
    ws.on("error", drop);
  }

  /** In-process observers of every broadcast (e.g. kill agent terminals on `session.deleted`). */
  subscribe(listener: (event: ClientEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  broadcast(event: ClientEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* an observer must not break the broadcast */
      }
    }
    const payload = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === 1) ws.send(payload);
    }
  }

  onCommand(_handler: (cmd: ServerCommand) => void): void {
    // Wired in index when sockets connect.
  }
}
