import { useEffect, useEffectEvent, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, details > summary:first-of-type, [contenteditable="true"], [tabindex]';

type DialogEntry = { trap: boolean };
const dialogs: DialogEntry[] = [];

function activeDialog() {
  // A non-modal drawer can stay open behind a modal.
  for (let i = dialogs.length - 1; i >= 0; i--) {
    if (dialogs[i]?.trap) return dialogs[i];
  }
  return dialogs.at(-1);
}

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => {
    if (node.matches(":disabled") || node.closest('[hidden], [inert], [aria-hidden="true"]'))
      return false;
    if (node.hasAttribute("tabindex") && node.tabIndex < 0) return false;
    const disclosure = node.parentElement?.closest("details:not([open])");
    if (disclosure && !disclosure.querySelector(":scope > summary")?.contains(node)) return false;
    return node.checkVisibility?.({ visibilityProperty: true }) ?? true;
  });
}

/** Trap Tab, handle Escape, move first focus in, restore the opener on close.
 *  Pass `{ trap: false }` for drawers that should close on Escape without trapping Tab. */
export function useDialogFocus(
  open: boolean,
  onClose: () => void,
  dialogRef: RefObject<HTMLElement | null>,
  opts?: { trap?: boolean },
) {
  const trap = opts?.trap !== false;
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!open) return;
    if (!dialogRef.current) return;
    const root = dialogRef.current;
    const entry = { trap };
    dialogs.push(entry);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (trap) {
      queueMicrotask(() => {
        if (activeDialog() !== entry || root.contains(document.activeElement)) return;
        (focusableIn(root)[0] ?? root).focus();
      });
    }

    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || activeDialog() !== entry) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (!trap || event.key !== "Tab") return;
      event.preventDefault();
      const nodes = focusableIn(root);
      if (!nodes.length) {
        root.focus();
        return;
      }
      const active = document.activeElement;
      const index = nodes.findIndex((node) => node === active);
      if (event.shiftKey) {
        const prev = index <= 0 ? nodes[nodes.length - 1]! : nodes[index - 1]!;
        prev.focus();
        return;
      }
      const next = index === -1 || index === nodes.length - 1 ? nodes[0]! : nodes[index + 1]!;
      next.focus();
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const wasActive = activeDialog() === entry;
      dialogs.splice(dialogs.indexOf(entry), 1);
      const focused = document.activeElement;
      if (wasActive && (focused === document.body || root.contains(focused))) {
        opener?.focus({ preventScroll: true });
      }
    };
  }, [open, dialogRef, trap]);
}
