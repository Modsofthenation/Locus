export type Notice = {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
};

type NoticeListener = (message: string | null) => void;
type NoticeListListener = (notices: Notice[]) => void;

let notices: Notice[] = [];
const listeners = new Set<NoticeListener>();
const listListeners = new Set<NoticeListListener>();
const hideTimers = new Map<string, ReturnType<typeof setTimeout>>();
let seq = 0;

function emit() {
  const latest = notices[notices.length - 1] ?? null;
  for (const listener of listeners) listener(latest?.message ?? null);
  for (const listener of listListeners) listener(notices);
}

function scheduleHide(notice: Notice) {
  const existing = hideTimers.get(notice.id);
  if (existing) clearTimeout(existing);
  const ms = notice.durationMs ?? 5000;
  hideTimers.set(
    notice.id,
    setTimeout(() => {
      hideTimers.delete(notice.id);
      notices = notices.filter((row) => row.id !== notice.id);
      emit();
    }, ms),
  );
}

export function showNotice(
  message: string,
  opts?: { actionLabel?: string; onAction?: () => void; durationMs?: number },
): string {
  const text = message.trim();
  if (!text) return "";
  const id = `notice-${++seq}`;
  const notice: Notice = {
    id,
    message: text,
    actionLabel: opts?.actionLabel,
    onAction: opts?.onAction,
    durationMs: opts?.durationMs,
  };
  notices = [...notices.filter((row) => row.message !== text), notice].slice(-3);
  scheduleHide(notice);
  emit();
  return id;
}

export function showUndoNotice(message: string, onUndo: () => void): string {
  return showNotice(message, { actionLabel: "Undo", onAction: onUndo, durationMs: 8000 });
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() ? err.message : fallback;
}

/** Surface a failed request in the notice stack, with optional Retry. */
export function showErrorNotice(
  err: unknown,
  fallback: string,
  opts?: { onRetry?: () => void; durationMs?: number },
): string {
  return showNotice(errorMessage(err, fallback), {
    actionLabel: opts?.onRetry ? "Retry" : undefined,
    onAction: opts?.onRetry,
    durationMs: opts?.durationMs,
  });
}

export function dismissNotice(id?: string) {
  if (id) {
    const timer = hideTimers.get(id);
    if (timer) clearTimeout(timer);
    hideTimers.delete(id);
    notices = notices.filter((row) => row.id !== id);
  } else {
    for (const timer of hideTimers.values()) clearTimeout(timer);
    hideTimers.clear();
    notices = [];
  }
  emit();
}

export function subscribeNotice(listener: NoticeListener): () => void {
  listeners.add(listener);
  listener(notices[notices.length - 1]?.message ?? null);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeNotices(listener: NoticeListListener): () => void {
  listListeners.add(listener);
  listener(notices);
  return () => {
    listListeners.delete(listener);
  };
}
