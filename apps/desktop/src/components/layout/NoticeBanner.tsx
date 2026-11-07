import { useEffect, useState } from "react";
import { dismissNotice, subscribeNotice } from "@/lib/notice";

export function NoticeBanner() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => subscribeNotice(setMessage), []);
  if (!message) return null;
  return (
    <div className="app-notices" data-testid="app-notice" role="status" aria-live="polite">
      <div className="app-notice">
        <p>{message}</p>
        <button
          type="button"
          className="app-notice-dismiss"
          aria-label="Dismiss"
          onClick={dismissNotice}
        >
          ×
        </button>
      </div>
    </div>
  );
}
