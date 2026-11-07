/** Overlay scrollbar for the chat thread: a dashed thumb on the left edge. */

export const CHAT_SCROLL_MIN_THUMB = 56;

export function chatScrollOverflow(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight > 1;
}

export function chatScrollThumb(input: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  trackHeight: number;
}): { y: number; height: number } {
  const trackHeight = Math.max(0, input.trackHeight);
  const clientHeight = Math.max(0, input.clientHeight);
  const scrollHeight = Math.max(clientHeight, input.scrollHeight);
  const height = Math.min(
    trackHeight,
    Math.max(
      Math.min(CHAT_SCROLL_MIN_THUMB, trackHeight),
      Math.round((clientHeight / Math.max(1, scrollHeight)) * trackHeight),
    ),
  );
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  const maxY = Math.max(0, trackHeight - height);
  const y = maxScroll <= 0 || maxY <= 0 ? 0 : Math.round((input.scrollTop / maxScroll) * maxY);
  return { y: Math.min(maxY, Math.max(0, y)), height };
}

export function chatScrollGrabOffset(
  pointerY: number,
  thumbY: number,
  thumbHeight: number,
): number {
  if (pointerY >= thumbY && pointerY <= thumbY + thumbHeight) return pointerY - thumbY;
  return thumbHeight / 2;
}

export function chatScrollFromPointer(input: {
  pointerY: number;
  trackHeight: number;
  scrollHeight: number;
  clientHeight: number;
  grabOffset: number;
}): number {
  const thumb = chatScrollThumb({
    scrollTop: 0,
    clientHeight: input.clientHeight,
    scrollHeight: input.scrollHeight,
    trackHeight: input.trackHeight,
  });
  const maxScroll = Math.max(0, input.scrollHeight - input.clientHeight);
  const maxY = Math.max(1, input.trackHeight - thumb.height);
  const t = Math.min(1, Math.max(0, (input.pointerY - input.grabOffset) / maxY));
  return t * maxScroll;
}
