import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => !node.hasAttribute("disabled") && node.getAttribute("aria-hidden") !== "true",
  );
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
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = dialogRef.current;
    const first = trap && root ? focusableIn(root)[0] : undefined;
    if (trap) queueMicrotask(() => first?.focus());

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (!trap || event.key !== "Tab" || !root) return;
      const nodes = focusableIn(root);
      if (!nodes.length) return;
      event.preventDefault();
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
      prev?.focus();
    };
  }, [open, onClose, dialogRef, trap]);
}
