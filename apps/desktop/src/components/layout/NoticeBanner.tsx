import { useEffect, useState } from "react";
import { dismissNotice, subscribeNotices, type Notice } from "@/lib/notice";

export function NoticeBanner() {
  const [items, setItems] = useState<Notice[]>([]);
  useEffect(() => subscribeNotices(setItems), []);
  useEffect(() => {
    if (!items.length) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      const latest = items[items.length - 1];
      if (latest) dismissNotice(latest.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items]);
  if (!items.length) return null;
  return (
    <div className="app-notices" data-testid="app-notice" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className="app-notice" data-testid="app-notice-item">
          <p>{item.message}</p>
          {item.actionLabel && item.onAction ? (
            <button
              type="button"
              className="btn small ghost app-notice-action"
              onClick={() => {
                item.onAction?.();
                dismissNotice(item.id);
              }}
            >
              {item.actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="app-notice-dismiss"
            aria-label="Dismiss"
            onClick={() => dismissNotice(item.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
