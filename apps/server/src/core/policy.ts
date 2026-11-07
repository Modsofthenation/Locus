import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applyManagedPolicy,
  inactiveManagedPolicyStatus,
  parseManagedPolicy,
  type LocusConfig,
  type ManagedPolicyStatus,
} from "@locus/shared";

const ETC_POLICY = "/etc/locus/policy.json";
const ETC_KEY = "/etc/locus/policy.key";

export function managedPolicyPaths(dataDir: string): string[] {
  const env = process.env.LOCUS_POLICY_PATH?.trim();
  if (env) return [env];
  if (process.env.VITEST) return [join(dataDir, "policy.json")];
  return [ETC_POLICY, join(dataDir, "policy.json")];
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function hmacHex(body: string, key: string): string {
  return createHmac("sha256", key).update(body).digest("hex");
}

function signaturesMatch(actual: string, expected: string): boolean {
  const left = Buffer.from(actual.trim().toLowerCase());
  const right = Buffer.from(expected.trim().toLowerCase());
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Signing key for `~/.locus/policy.json`. Operator-writable keys
 * (`~/.locus/policy.key`) are ignored so the operator cannot self-sign a
 * permissive policy. Admins put the key in `/etc/locus/policy.key` (mode 0600,
 * root) or inject `LOCUS_POLICY_KEY`.
 */
async function policyHmacKey(): Promise<string | undefined> {
  const env = process.env.LOCUS_POLICY_KEY?.trim();
  if (env) return env;
  const fromEtc = await readText(ETC_KEY);
  return fromEtc?.trim() || undefined;
}

function isEtcPolicy(path: string): boolean {
  return path === ETC_POLICY;
}

export async function loadManagedPolicy(dataDir: string): Promise<ManagedPolicyStatus> {
  const key = await policyHmacKey();
  for (const path of managedPolicyPaths(dataDir)) {
    const body = await readText(path);
    if (!body?.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      continue;
    }
    const policy = parseManagedPolicy(parsed);
    if (!policy) continue;
    const envPath = process.env.LOCUS_POLICY_PATH?.trim();
    const needsSignature = !isEtcPolicy(path) && path !== envPath;
    if (needsSignature) {
      if (!key) continue;
      const sig = (await readText(`${path}.sig`))?.trim();
      if (!sig || !signaturesMatch(hmacHex(body, key), sig)) continue;
      return {
        active: true,
        source: path,
        signed: true,
        policy,
        locked: [],
      };
    }
    return {
      active: true,
      source: path,
      signed: false,
      policy,
      locked: [],
    };
  }
  return inactiveManagedPolicyStatus();
}

export async function configWithManagedPolicy(
  config: LocusConfig,
  dataDir: string,
): Promise<LocusConfig> {
  const status = await loadManagedPolicy(dataDir);
  return applyManagedPolicy(config, status);
}
