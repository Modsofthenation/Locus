import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OPERATOR_TOKEN_FILE } from "@locus/shared";

/** True when `LOCUS_OPERATOR_AUTH=off` asks for the old "any loopback client is the operator" model. */
export function operatorAuthDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.LOCUS_OPERATOR_AUTH?.trim().toLowerCase();
  return raw === "off" || raw === "0" || raw === "false";
}

export function operatorTokenPath(dataDir: string): string {
  return join(dataDir, OPERATOR_TOKEN_FILE);
}

function validToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  return token && token.length >= 32 && /^[A-Za-z0-9_-]+$/.test(token) ? token : undefined;
}

/**
 * The operator token for this data dir. `LOCUS_OPERATOR_TOKEN` wins (and is
 * written to the file so the CLI and desktop find it); otherwise the file is
 * reused, or created once with a fresh random token. The file is 0600 and
 * survives restarts, so a respawned control plane keeps the desktop's cookie valid.
 * Returns undefined when operator auth is turned off.
 */
export async function loadOrCreateOperatorToken(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  if (operatorAuthDisabled(env)) return undefined;
  const file = operatorTokenPath(dataDir);
  const fromEnv = validToken(env.LOCUS_OPERATOR_TOKEN);
  if (!fromEnv) {
    const existing = validToken(await readFile(file, "utf8").catch(() => undefined));
    if (existing) {
      await chmod(file, 0o600).catch(() => undefined);
      return existing;
    }
  }
  const token = fromEnv ?? `op_${randomBytes(32).toString("hex")}`;
  await mkdir(dataDir, { recursive: true });
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => undefined);
  return token;
}
