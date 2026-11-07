export type WorkspaceFilePayload = {
  path: string;
  content: string;
  mtime: string;
  baseline?: string;
};

const MAX_FILES = 64;
const files = new Map<string, WorkspaceFilePayload>();
const inflight = new Map<string, Promise<WorkspaceFilePayload>>();
const generation = new Map<string, number>();

function cacheKey(sessionId: string, path: string): string {
  return `${sessionId}\0${path}`;
}

function sessionPrefix(sessionId: string): string {
  return `${sessionId}\0`;
}

function genOf(key: string): number {
  return generation.get(key) ?? 0;
}

function bump(key: string): number {
  const next = genOf(key) + 1;
  generation.set(key, next);
  return next;
}

export function peekWorkspaceFile(
  sessionId: string,
  path: string,
): WorkspaceFilePayload | undefined {
  if (!sessionId || !path) return undefined;
  return files.get(cacheKey(sessionId, path));
}

export function rememberWorkspaceFile(sessionId: string, file: WorkspaceFilePayload): void {
  if (!sessionId || !file.path) return;
  const key = cacheKey(sessionId, file.path);
  if (files.has(key)) files.delete(key);
  files.set(key, file);
  while (files.size > MAX_FILES) {
    const oldest = files.keys().next().value;
    if (typeof oldest !== "string") break;
    files.delete(oldest);
  }
}

export function forgetWorkspaceFiles(sessionId: string, paths?: string[]): void {
  if (!sessionId) return;
  if (!paths) {
    const prefix = sessionPrefix(sessionId);
    for (const key of [...files.keys(), ...inflight.keys(), ...generation.keys()]) {
      if (!key.startsWith(prefix)) continue;
      bump(key);
      files.delete(key);
      inflight.delete(key);
    }
    return;
  }
  for (const path of paths) {
    const key = cacheKey(sessionId, path);
    bump(key);
    files.delete(key);
    inflight.delete(key);
  }
}

export function loadWorkspaceFile(
  sessionId: string,
  path: string,
  fetcher: () => Promise<WorkspaceFilePayload>,
  opts: { reload?: boolean } = {},
): Promise<WorkspaceFilePayload> {
  const key = cacheKey(sessionId, path);
  if (opts.reload) bump(key);
  if (!opts.reload) {
    const hit = peekWorkspaceFile(sessionId, path);
    if (hit) return Promise.resolve(hit);
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const gen = genOf(key);
  const pending = fetcher()
    .then((file) => {
      if (genOf(key) === gen) rememberWorkspaceFile(sessionId, file);
      return file;
    })
    .finally(() => {
      if (inflight.get(key) === pending) inflight.delete(key);
    });
  inflight.set(key, pending);
  return pending;
}

export function resetWorkspaceFileCache(): void {
  files.clear();
  inflight.clear();
  generation.clear();
}
