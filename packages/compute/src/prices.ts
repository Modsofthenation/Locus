import { isFargateSizeId, type FargateSizeId } from "@locus/shared";

/** Fargate Linux/x86 list prices, US East (N. Virginia). Not a live quote. */
export const FARGATE_PRICING_AS_OF = "2026-08";
export const FARGATE_VCPU_USD_PER_HOUR = 0.04048;
export const FARGATE_GB_USD_PER_HOUR = 0.004445;

const SIZE_RESOURCES: Record<
  FargateSizeId,
  { cpu: string; memory: string; vcpu: number; gb: number }
> = {
  "0.25-0.5": { cpu: "256", memory: "512", vcpu: 0.25, gb: 0.5 },
  "0.5-1": { cpu: "512", memory: "1024", vcpu: 0.5, gb: 1 },
  "1-2": { cpu: "1024", memory: "2048", vcpu: 1, gb: 2 },
  "2-4": { cpu: "2048", memory: "4096", vcpu: 2, gb: 4 },
};

export function fargateResources(size: string): { cpu: string; memory: string } {
  if (!isFargateSizeId(size)) throw new Error(`Unknown Fargate size ${size}`);
  const row = SIZE_RESOURCES[size];
  return { cpu: row.cpu, memory: row.memory };
}

export function fargateUsdPerHour(size: string): number {
  if (!isFargateSizeId(size)) throw new Error(`Unknown Fargate size ${size}`);
  const row = SIZE_RESOURCES[size];
  return row.vcpu * FARGATE_VCPU_USD_PER_HOUR + row.gb * FARGATE_GB_USD_PER_HOUR;
}
