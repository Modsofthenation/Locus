let dirty = false;
let persistPending: (() => Promise<boolean>) | null = null;

export function setSettingsDirty(next: boolean) {
  dirty = next;
}

export function settingsIsDirty(): boolean {
  return dirty;
}

/** Settings registers its persist so leaving can flush auto-save instead of discarding. */
export function setSettingsPersist(fn: (() => Promise<boolean>) | null) {
  persistPending = fn;
}

/** Returns false only when a pending persist fails validation. */
export function confirmLeaveSettings(): boolean {
  if (!dirty) return true;
  void persistPending?.();
  return true;
}

export function paletteActionLeavesSettings(id: string): boolean {
  if (id.startsWith("settings:")) return false;
  if (id.startsWith("theme:")) return false;
  if (id.startsWith("feature:")) return false;
  if (id === "keyboard-shortcuts") return false;
  if (id.startsWith("workspace-")) return false;
  if (id.startsWith("guest-")) return false;
  if (id.startsWith("chat-")) return false;
  if (id === "docker-stop-running") return false;
  return true;
}
