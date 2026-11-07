export function shouldMarkUnread(sessionId: string, selectedId: string | null): boolean {
  return sessionId !== selectedId;
}

export function shouldNotifyTurn(
  sessionId: string,
  selectedId: string | null,
  hidden: boolean,
  enabled = true,
): boolean {
  return enabled && (hidden || sessionId !== selectedId);
}

export function isFinishedAutomationRun(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "skipped";
}

export function shouldMarkAutomationUnread(
  automationId: string,
  selectedAutomationId: string | null,
  section: string,
): boolean {
  return section !== "automations" || selectedAutomationId !== automationId;
}

export function shouldNotifyAutomationRun(
  automationId: string,
  selectedAutomationId: string | null,
  section: string,
  hidden: boolean,
  enabled = true,
): boolean {
  return (
    enabled && (hidden || shouldMarkAutomationUnread(automationId, selectedAutomationId, section))
  );
}

export function shouldNotifyNeedsYou(
  sessionId: string,
  selectedId: string | null,
  hidden: boolean,
  enabled = true,
): boolean {
  return shouldNotifyTurn(sessionId, selectedId, hidden, enabled);
}

export function notifyTurnDone(title: string, body = "Turn finished", enabled = true): void {
  if (!enabled) return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "denied") return;
  const show = () => {
    try {
      new Notification(title, { body, silent: false });
    } catch {
      /* ignore missing Notification support */
    }
  };
  if (Notification.permission === "granted") {
    show();
    return;
  }
  void Notification.requestPermission().then((permission) => {
    if (permission === "granted") show();
  });
}
