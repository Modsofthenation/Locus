/** Stable pin for MCP tool descriptions. Not cryptographic; detects unexpected description edits. */
export function mcpDescriptionPin(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function mcpToolDescriptionAllowed(
  description: string,
  pinned?: Record<string, string>,
  toolName?: string,
): boolean {
  if (!pinned || !Object.keys(pinned).length) return true;
  if (!toolName) return false;
  const expected = pinned[toolName];
  if (!expected) return false;
  return expected === mcpDescriptionPin(description);
}
