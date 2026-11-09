/** Control-plane id sent as `X-Locus-Plane` so one worker token can namespace guests. */
export const WORKER_PLANE_HEADER = "x-locus-plane";

const PLANE_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export function parseWorkerPlaneId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const id = raw.trim();
  return PLANE_ID_RE.test(id) ? id : undefined;
}

export function createWorkerPlaneId(): string {
  return crypto.randomUUID();
}

export function guestVisibleToPlane(
  guest: { planeId?: string },
  planeId: string | undefined,
): boolean {
  if (!guest.planeId) return true;
  if (!planeId) return false;
  return guest.planeId === planeId;
}
