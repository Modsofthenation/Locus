import { readFile } from "node:fs/promises";
import { parseProcNetTcp, uniquePreviewPorts } from "@locus/shared";

const HTTPISH = new Set([80, 443, 3000, 3001, 4000, 4173, 4321, 5000, 5173, 8000, 8080]);

export function isLikelyHttpListenPort(port: number): boolean {
  if (HTTPISH.has(port)) return true;
  if (port >= 3000 && port < 4000) return true;
  if (port >= 4000 && port < 5000) return true;
  if (port >= 5000 && port < 6000) return true;
  if (port >= 8000 && port < 9000) return true;
  return false;
}

export async function listHostHttpPorts(): Promise<number[]> {
  const ports = new Set<number>();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      const text = await readFile(file, "utf8");
      for (const port of parseProcNetTcp(text)) {
        if (isLikelyHttpListenPort(port)) ports.add(port);
      }
    } catch {
      /* not Linux, or unreadable */
    }
  }
  return uniquePreviewPorts([...ports]);
}
