import { timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export function workerTokenPath(dataDir: string): string {
  return join(dataDir, "token");
}

export async function loadOrCreateWorkerToken(
  dataDir: string,
): Promise<{ token: string; created: boolean }> {
  const fromEnv = process.env.LOCUS_WORKER_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, created: false };
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const path = workerTokenPath(dataDir);
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing) return { token: existing, created: false };
  } catch {
    /* create */
  }
  const token = randomBytes(24).toString("base64url");
  await writeFile(path, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
  return { token, created: true };
}

export function workerTokenMatches(provided: string | undefined, expected: string): boolean {
  const got = Buffer.from(provided ?? "");
  const want = Buffer.from(expected);
  if (got.length !== want.length) {
    timingSafeEqual(want, want);
    return false;
  }
  return timingSafeEqual(got, want);
}
