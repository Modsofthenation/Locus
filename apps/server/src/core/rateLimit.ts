export type RateLimiter = {
  allow(key: string): boolean;
};

export function createRateLimiter(opts?: { windowMs?: number; max?: number }): RateLimiter {
  const windowMs = opts?.windowMs ?? 60_000;
  const max = opts?.max ?? 20;
  const hits = new Map<string, number[]>();
  return {
    allow(key: string) {
      const now = Date.now();
      if (hits.size > 4_096) {
        for (const [id, times] of hits) {
          const keep = times.filter((t) => now - t < windowMs);
          if (keep.length) hits.set(id, keep);
          else hits.delete(id);
        }
      }
      const prior = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (prior.length >= max) {
        hits.set(key, prior);
        return false;
      }
      prior.push(now);
      hits.set(key, prior);
      return true;
    },
  };
}

export const phoneAuthLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
