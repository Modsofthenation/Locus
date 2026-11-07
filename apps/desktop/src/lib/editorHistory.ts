export type EditSnapshot = { path: string; text: string; start: number; end: number };

export const EDIT_HISTORY_MAX = 250;
export const TYPING_COALESCE_MS = 500;

export function remapWorkspacePath(path: string, from: string, dest: string): string {
  if (path === from) return dest;
  if (path.startsWith(`${from}/`)) return dest + path.slice(from.length);
  return path;
}

export function remapEditSnapshots(
  stack: EditSnapshot[],
  from: string,
  dest: string,
): EditSnapshot[] {
  return stack.map((snap) => ({ ...snap, path: remapWorkspacePath(snap.path, from, dest) }));
}

/** Undo/redo stacks plus typing coalesce. WorkspaceEditor adapts DOM selection. */
export class EditHistory {
  undo: EditSnapshot[] = [];
  redo: EditSnapshot[] = [];
  typing: { path: string; at: number } | null = null;

  constructor(private readonly max = EDIT_HISTORY_MAX) {}

  clear(): void {
    this.undo = [];
    this.redo = [];
    this.typing = null;
  }

  remapPaths(from: string, dest: string): void {
    this.undo = remapEditSnapshots(this.undo, from, dest);
    this.redo = remapEditSnapshots(this.redo, from, dest);
    if (this.typing) this.typing.path = remapWorkspacePath(this.typing.path, from, dest);
  }

  push(snap: EditSnapshot): void {
    this.undo.push(snap);
    if (this.undo.length > this.max) this.undo.shift();
    this.redo = [];
    this.typing = null;
  }

  recordTyping(snap: EditSnapshot, path: string, now: number): boolean {
    if (!this.typing || this.typing.path !== path || now - this.typing.at > TYPING_COALESCE_MS) {
      this.push(snap);
      this.typing = { path, at: now };
      return true;
    }
    this.typing.at = now;
    return false;
  }

  popUndo(): EditSnapshot | undefined {
    return this.undo.pop();
  }

  pushRedo(snap: EditSnapshot): void {
    this.redo.push(snap);
  }

  popRedo(): EditSnapshot | undefined {
    return this.redo.pop();
  }

  pushUndoKeepRedo(snap: EditSnapshot): void {
    this.undo.push(snap);
  }
}
