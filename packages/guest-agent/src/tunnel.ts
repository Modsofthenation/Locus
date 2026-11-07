import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo, type Socket } from "node:net";

export interface GuestLoopbackTunnel {
  host: string;
  port: number;
  close: () => void;
}

const CONTAINER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function guestLoopbackRelayScript(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid guest port");
  return [
    `PORT=${port}`,
    'if command -v bash >/dev/null 2>&1; then exec bash -c "exec 3<>/dev/tcp/127.0.0.1/$PORT; cat <&3 & cat >&3; wait"; fi',
    'if command -v nc >/dev/null 2>&1; then exec nc 127.0.0.1 "$PORT"; fi',
    "echo LOCUS_NO_RELAY >&2",
    "exit 1",
  ].join("\n");
}

export function listenGuestLoopbackTunnel(
  containerId: string,
  port: number,
): Promise<GuestLoopbackTunnel> {
  if (!CONTAINER_ID.test(containerId)) throw new Error("Invalid container");
  const script = guestLoopbackRelayScript(port);
  const children = new Set<ChildProcess>();
  const server = createServer((socket: Socket) => {
    const child = spawn("docker", ["exec", "-i", containerId, "sh", "-lc", script], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    children.add(child);
    if (child.stdout) child.stdout.pipe(socket);
    if (child.stdin) socket.pipe(child.stdin);
    const stop = () => {
      children.delete(child);
      child.kill();
      socket.destroy();
    };
    socket.on("close", stop);
    child.on("exit", stop);
    child.on("error", stop);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        host: "127.0.0.1",
        port: addr.port,
        close: () => {
          server.close();
          for (const child of children) child.kill();
        },
      });
    });
  });
}
