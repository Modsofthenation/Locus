export function locusWindowTitle(input: { needsYou: number; unread: number }): string {
  if (input.needsYou > 0) return `(${input.needsYou}) Needs you · Locus`;
  if (input.unread > 0) return `(${input.unread}) Locus`;
  return "Locus";
}
