import type { ServerCommand, ClientEvent } from "@locus/shared";
import type { WebSocket } from "ws";

type Socket = WebSocket & { send(data: string): void };

export class Hub {
  private clients = new Set<Socket>();

  add(ws: Socket): void {
    this.clients.add(ws);
    const drop = () => this.clients.delete(ws);
    ws.on("close", drop);
    ws.on("error", drop);
  }

  broadcast(event: ClientEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === 1) ws.send(payload);
    }
  }

  onCommand(_handler: (cmd: ServerCommand) => void): void {
    // Wired in index when sockets connect.
  }
}
