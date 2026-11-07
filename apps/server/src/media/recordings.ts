import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSafeSessionFile } from "../session/sessionPaths.js";

const MOCK_RECORDING_PATH = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../fixtures/mock-recording.mp4",
);

export function recordingsRoot(dataDir: string): string {
  return join(dataDir, "recordings");
}

export function recordingDest(dataDir: string, sessionId: string, filename: string): string {
  return resolveSafeSessionFile(
    recordingsRoot(dataDir),
    sessionId,
    filename,
    "Invalid recording filename",
    (name) => /\.mp4$/i.test(name),
  );
}

export async function writeMockRecording(
  dataDir: string,
  sessionId: string,
  filename: string,
): Promise<string> {
  const dest = recordingDest(dataDir, sessionId, filename);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, await readFile(MOCK_RECORDING_PATH));
  return dest;
}
