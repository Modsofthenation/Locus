let pending = "";

/** Seed Settings find when the command palette jumps to a settings row. */
export function setPendingSettingsQuery(query: string): void {
  pending = query.trim();
}

export function takePendingSettingsQuery(): string {
  const value = pending;
  pending = "";
  return value;
}
