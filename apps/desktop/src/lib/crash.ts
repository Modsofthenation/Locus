export type CrashError = {
  id: string;
  title: string;
  stack?: string;
};

let crashSeq = 0;

export function crashFromUnknown(err: unknown): CrashError {
  crashSeq += 1;
  const id = `crash-${crashSeq}`;
  if (err instanceof Error) {
    const title = err.message.trim() || err.name || "Unknown error";
    const stack = err.stack?.trim();
    return { id, title, stack: stack || undefined };
  }
  if (typeof err === "string" && err.trim()) {
    return { id, title: err.trim() };
  }
  try {
    return { id, title: JSON.stringify(err) };
  } catch {
    return { id, title: "Unknown error" };
  }
}

export function sameCrash(a: CrashError, b: CrashError): boolean {
  return a.title === b.title && (a.stack ?? "") === (b.stack ?? "");
}

const IGNORE_MESSAGE = /ResizeObserver loop|Script error\.?$/i;
const IGNORE_FILE = /^(chrome|moz|safari)-extension:/i;

export function crashFromWindowError(event: {
  message?: string;
  error?: unknown;
  filename?: string;
}): CrashError | null {
  if (event.filename && IGNORE_FILE.test(event.filename)) return null;
  const message = event.message?.trim() ?? "";
  if (IGNORE_MESSAGE.test(message)) return null;
  if (event.error instanceof Error) return crashFromUnknown(event.error);
  // Resource loads fire `error` with no Error object; skip those.
  if (!event.error) return null;
  if (message) return crashFromUnknown(message);
  return crashFromUnknown(event.error);
}

export function mergeCrash(errors: CrashError[], next: CrashError, cap = 8): CrashError[] {
  if (errors.some((row) => sameCrash(row, next))) return errors;
  return [...errors, next].slice(-cap);
}

export function restartFrontend(loc: Pick<Location, "reload"> = window.location): void {
  loc.reload();
}
