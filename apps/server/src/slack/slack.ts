import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SEC = 60 * 5;

export function slackSignatureValid(
  secret: string | undefined,
  timestamp: string | undefined,
  raw: string,
  signature: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (!secret?.trim() || !timestamp || !signature?.startsWith("v0=")) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > MAX_SKEW_SEC) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}
