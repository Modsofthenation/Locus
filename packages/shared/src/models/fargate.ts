/** Fargate vCPU-GB pairs Locus will run. Empty allowlist cannot provision. */
export const FARGATE_SIZE_IDS = ["0.25-0.5", "0.5-1", "1-2", "2-4"] as const;

export type FargateSizeId = (typeof FARGATE_SIZE_IDS)[number];

export const DEFAULT_FARGATE_SIZE: FargateSizeId = "0.25-0.5";
export const DEFAULT_FARGATE_REGION = "us-east-1";
export const DEFAULT_FARGATE_CLUSTER = "locus";

export function isFargateSizeId(value: string): value is FargateSizeId {
  return (FARGATE_SIZE_IDS as readonly string[]).includes(value);
}

export function parseWorkerAllowedSizes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (typeof row !== "string") continue;
    const size = row.trim();
    if (!isFargateSizeId(size) || seen.has(size)) continue;
    seen.add(size);
    out.push(size);
  }
  return out;
}
