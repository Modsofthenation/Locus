export const MAX_VM_LOG = 200_000;

export function appendVmLog(existing: string, chunk: string): string {
  const next = existing + chunk;
  return next.length > MAX_VM_LOG ? next.slice(-MAX_VM_LOG) : next;
}

export function formatStatusLine(status: string, error?: string): string {
  const ts = new Date().toISOString();
  return error ? `[${ts}] ${status}: ${error}\n` : `[${ts}] ${status}\n`;
}
