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

/* ---------- Turn ticks: one mark per user prompt, magnified under the pointer ---------- */

export type ChatTurnMark = {
  id: string;
  /** Scroll offset (px) of the prompt row inside the thread. */
  top: number;
  prompt: string;
  reply: string;
};

type TurnRow = { message: { id: string; role: string; content: string } };

const TURN_SNIPPET_MAX = 220;

/** Plain one-paragraph preview of chat text for the tick tooltip. */
export function chatTurnSnippet(text: string, max = TURN_SNIPPET_MAX): string {
  const plain = text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~]+/g, "");
  const para =
    plain
      .split(/\n\s*\n/)
      .map((chunk) => chunk.replace(/\s+/g, " ").trim())
      .find(Boolean) ?? "";
  return para.length > max ? `${para.slice(0, max - 1).trimEnd()}…` : para;
}

/**
 * One mark per visible user prompt, with the last non-empty assistant reply of that turn.
 * `offsets` is the list-window prefix sum (offsets[i] = top of rows[i]).
 */
export function chatTurnMarks(
  rows: TurnRow[],
  offsets: number[],
  opts: {
    skip?: (id: string) => boolean;
    replyText?: (role: string, content: string) => string;
  } = {},
): ChatTurnMark[] {
  const marks: ChatTurnMark[] = [];
  const replyText = opts.replyText ?? ((_role: string, content: string) => content);
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i]!.message;
    if (opts.skip?.(m.id)) continue;
    if (m.role === "user") {
      const prompt = chatTurnSnippet(m.content);
      if (!prompt) continue;
      marks.push({ id: m.id, top: offsets[i] ?? 0, prompt, reply: "" });
      continue;
    }
    const last = marks[marks.length - 1];
    if (last && m.role === "assistant") {
      const reply = chatTurnSnippet(replyText(m.role, m.content));
      if (reply) last.reply = reply;
    }
  }
  return marks;
}

export const CHAT_TICK_MAX_GAP = 10;
export const CHAT_TICK_MIN_GAP = 3;

/** Evenly spaced tick positions, centred in the track; spacing shrinks to fit long chats. */
export function chatTickPositions(count: number, trackHeight: number): number[] {
  if (count <= 0) return [];
  const usable = Math.max(0, trackHeight);
  if (count === 1) return [Math.round(usable / 2)];
  const gap = Math.max(
    CHAT_TICK_MIN_GAP,
    Math.min(CHAT_TICK_MAX_GAP, usable / Math.max(1, count - 1)),
  );
  const span = gap * (count - 1);
  const start = Math.max(0, (usable - span) / 2);
  return Array.from({ length: count }, (_, i) => Math.round(start + i * gap));
}

/** Dock-style magnification: 1 under the pointer, easing to 0 about four ticks (`radius` px) away. */
export function chatTickMagnify(distance: number, radius = 42): number {
  const d = Math.abs(distance);
  if (d >= radius) return 0;
  return (1 - d / radius) ** 1.5;
}

/** Index of the tick closest to `y`, or -1 when there are none. */
export function chatNearestTick(positions: number[], y: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < positions.length; i++) {
    const d = Math.abs(positions[i]! - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The turn the reader is in: last prompt above the top third of the viewport (last when pinned). */
export function chatActiveTurn(
  tops: number[],
  view: { scrollTop: number; clientHeight: number; scrollHeight: number },
): number {
  if (!tops.length) return -1;
  if (view.scrollTop + view.clientHeight >= view.scrollHeight - 2) return tops.length - 1;
  const anchor = view.scrollTop + view.clientHeight / 3;
  let idx = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! <= anchor) idx = i;
    else break;
  }
  return idx;
}
