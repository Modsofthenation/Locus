type NoticeListener = (message: string | null) => void;

let current: string | null = null;
const listeners = new Set<NoticeListener>();
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showNotice(message: string) {
  current = message.trim() || null;
  for (const listener of listeners) listener(current);
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    current = null;
    for (const listener of listeners) listener(null);
  }, 5000);
}

export function dismissNotice() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  current = null;
  for (const listener of listeners) listener(null);
}

export function subscribeNotice(listener: NoticeListener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
