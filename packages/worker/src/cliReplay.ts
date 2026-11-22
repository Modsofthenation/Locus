export const WORKER_CLI_REPLAY_HEADER = "x-locus-cli-replay";
export const WORKER_CLI_HEARTBEAT = '{"type":"locus_worker_heartbeat"}';
export const WORKER_CLI_STREAM_END = '{"type":"locus_worker_stream_end"}';

const WINDOW_BYTES = 4 * 1024 * 1024;
const LEASE_MS = 5 * 60_000;
const RETAIN_MS = 10 * 60_000;

export class WorkerCliReplay {
  private chunks = new Map<number, Uint8Array>();
  private first = 0;
  private end = 0;
  private readers = 0;
  private notify = new Set<() => void>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  readonly abort = new AbortController();
  active = true;

  constructor(
    readonly id: string,
    private readonly expire: () => void,
  ) {
    this.lease();
    const heartbeat = new TextEncoder().encode(`${WORKER_CLI_HEARTBEAT}\n`);
    this.heartbeat = setInterval(() => this.write(heartbeat), 8000);
    this.heartbeat.unref();
  }

  write(chunk: Uint8Array): void {
    if (!this.active || !chunk.byteLength) return;
    this.chunks.set(this.end, chunk);
    this.end += chunk.byteLength;
    while (this.end - this.first > WINDOW_BYTES && this.chunks.size > 0) {
      const dropped = this.chunks.get(this.first)!;
      this.chunks.delete(this.first);
      this.first += dropped.byteLength;
    }
    this.wake();
  }

  accepts(offset: number): boolean {
    return Number.isSafeInteger(offset) && offset >= this.first && offset <= this.end;
  }

  stream(offset: number): ReadableStream<Uint8Array> {
    this.readers++;
    clearTimeout(this.timeout);
    let closed = false;
    let wake: (() => void) | undefined;
    const detach = () => {
      if (closed) return;
      closed = true;
      if (wake) {
        this.notify.delete(wake);
        wake();
      }
      this.readers--;
      if (this.active && !this.readers) this.lease();
    };
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        while (!closed) {
          if (!this.accepts(offset)) {
            detach();
            controller.error(new Error("Worker output fell outside the replay window"));
            return;
          }
          if (offset < this.end) {
            // Fetch may split an emitted chunk, so the resume cursor can be inside it.
            const start = this.chunks.has(offset)
              ? offset
              : [...this.chunks.keys()].find(
                  (key) => key <= offset && key + this.chunks.get(key)!.byteLength > offset,
                );
            if (start !== undefined) {
              const chunk = this.chunks.get(start)!;
              controller.enqueue(chunk.subarray(offset - start));
              offset = start + chunk.byteLength;
              return;
            }
          }
          if (!this.active) {
            detach();
            controller.close();
            return;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
            this.notify.add(resolve);
          });
          wake = undefined;
        }
      },
      cancel: detach,
    });
  }

  stop(): void {
    this.abort.abort();
  }

  finish(): void {
    if (!this.active) return;
    this.write(new TextEncoder().encode(`${WORKER_CLI_STREAM_END}\n`));
    this.active = false;
    clearInterval(this.heartbeat);
    clearTimeout(this.timeout);
    this.timeout = setTimeout(this.expire, RETAIN_MS);
    this.timeout.unref();
    this.wake();
  }

  private lease(): void {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => this.stop(), LEASE_MS);
    this.timeout.unref();
  }

  private wake(): void {
    for (const resume of this.notify) resume();
    this.notify.clear();
  }
}
