import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveSafeSessionFile } from "../session/sessionPaths.js";

export function screenshotsRoot(dataDir: string): string {
  return join(dataDir, "screenshots");
}

export function screenshotDest(dataDir: string, sessionId: string, filename: string): string {
  return resolveSafeSessionFile(
    screenshotsRoot(dataDir),
    sessionId,
    filename,
    "Invalid screenshot filename",
    (name) => /\.png$/i.test(name),
  );
}

export async function writeScreenshot(
  dataDir: string,
  sessionId: string,
  filename: string,
  base64: string,
): Promise<string> {
  const dest = screenshotDest(dataDir, sessionId, filename);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(base64.replace(/\s/g, ""), "base64"));
  return dest;
}
