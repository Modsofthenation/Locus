import { parseWorkerPlaneId, WORKER_PLANE_HEADER } from "@locus/shared";

export function planeFromHeaders(headers: {
  get?(name: string): string | undefined | null;
  header?(name: string): string | undefined | null;
}): string | undefined {
  const read = (name: string) => headers.header?.(name) ?? headers.get?.(name) ?? undefined;
  return parseWorkerPlaneId(read(WORKER_PLANE_HEADER) ?? read("X-Locus-Plane"));
}

export function planeFromRecord(body: { planeId?: unknown } | undefined): string | undefined {
  return parseWorkerPlaneId(body?.planeId);
}
