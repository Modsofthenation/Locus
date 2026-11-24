import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Last observed duration of the git_push / git_pr test gate per repository
 * checkout. Host workspaces are per session, so this is keyed by the repo URL
 * and checkout dest instead of the workspace path: a new session on the same
 * repo knows the suite is slow before it runs it.
 */
const MAX_ENTRIES = 500;

interface Entry {
  ms: number;
  at: string;
}

export class TestGateHistory {
  private entries: Map<string, Entry> | undefined;
  private loading: Promise<Map<string, Entry>> | undefined;

  constructor(private readonly file: string) {}

  private load(): Promise<Map<string, Entry>> {
    if (this.entries) return Promise.resolve(this.entries);
    this.loading ??= readFile(this.file, "utf8")
      .then((text) => {
        const raw = JSON.parse(text) as Record<string, Entry>;
        const map = new Map<string, Entry>();
        for (const [key, value] of Object.entries(raw ?? {})) {
          if (value && typeof value.ms === "number" && Number.isFinite(value.ms)) {
            map.set(key, { ms: value.ms, at: String(value.at ?? "") });
          }
        }
        return map;
      })
      .catch(() => new Map<string, Entry>())
      .then((map) => (this.entries = map));
    return this.loading;
  }

  async lastDurationMs(key: string): Promise<number | undefined> {
    return (await this.load()).get(key)?.ms;
  }

  async record(key: string, ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0) return;
    const map = await this.load();
    map.delete(key);
    map.set(key, { ms: Math.round(ms), at: new Date().toISOString() });
    while (map.size > MAX_ENTRIES) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file, JSON.stringify(Object.fromEntries(map), null, 2), "utf8");
    } catch {
      /* history is advisory */
    }
  }
}

export function testGateHistoryKey(
  repoUrl: string | undefined,
  dest: string | undefined,
  root: string,
): string {
  const repo = repoUrl
    ?.trim()
    .replace(/\.git$/, "")
    .toLowerCase();
  return repo ? `${repo}\u0000${dest ?? ""}` : root;
}
