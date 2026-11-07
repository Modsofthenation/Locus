export const STICK_BOTTOM_PX = 80;

export function isStuckToBottom(
  el: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
  slack = STICK_BOTTOM_PX,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
}

export function pinThreadToLatest(
  el: Pick<HTMLElement, "scrollTop" | "scrollHeight"> | null | undefined,
): void {
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

/** Pin now and after the next two frames, once layout/images can change scrollHeight. */
export function schedulePinThreadToLatest(el: HTMLElement | null | undefined): () => void {
  pinThreadToLatest(el);
  if (!el || typeof requestAnimationFrame !== "function") return () => undefined;
  let second = 0;
  const first = requestAnimationFrame(() => {
    pinThreadToLatest(el);
    second = requestAnimationFrame(() => pinThreadToLatest(el));
  });
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
  };
}

/** Keep the thread at latest while its size is still settling (open chat, images, zoom). */
export function observePinThreadToLatest(el: HTMLElement | null | undefined): () => void {
  const stopRaf = schedulePinThreadToLatest(el);
  if (!el || typeof ResizeObserver === "undefined") return stopRaf;
  const pin = () => pinThreadToLatest(el);
  const ro = new ResizeObserver(pin);
  ro.observe(el);
  for (const child of el.children) ro.observe(child);
  return () => {
    stopRaf();
    ro.disconnect();
  };
}
