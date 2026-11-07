export type EditorGroup = {
  paths: string[];
  active: string;
};

export type EditorSplit = {
  groups: [EditorGroup, EditorGroup];
  focused: 0 | 1;
  frac: number;
};

export const EDITOR_SPLIT_MIN = 0.28;
export const EDITOR_SPLIT_MAX = 0.72;
export const EDITOR_SPLIT_DEFAULT = 0.5;
export const EDITOR_SPLIT_GUTTER_PX = 6;

function cleanPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const next = path.trim();
  return next ? next : null;
}

function uniquePaths(paths: Iterable<string>, cap = 80): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const item of paths) {
    const path = cleanPath(item);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    next.push(path);
    if (next.length >= cap) break;
  }
  return next;
}

export function clampEditorSplit(value: number, fallback = EDITOR_SPLIT_DEFAULT): number {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value * 100) / 100;
  return Math.min(EDITOR_SPLIT_MAX, Math.max(EDITOR_SPLIT_MIN, rounded));
}

export function editorSplitColumns(frac: number): string {
  const left = clampEditorSplit(frac);
  return `minmax(160px, ${left}fr) ${EDITOR_SPLIT_GUTTER_PX}px minmax(160px, ${1 - left}fr)`;
}

export function normalizeGroup(paths: Iterable<string>, active = ""): EditorGroup {
  const next = uniquePaths(paths);
  const focus = cleanPath(active);
  return {
    paths: next,
    active: focus && next.includes(focus) ? focus : (next.at(-1) ?? ""),
  };
}

export function splitEditor(paths: Iterable<string>, active: string): EditorSplit | null {
  const group = normalizeGroup(paths, active);
  if (!group.active) return null;
  return {
    groups: [group, { paths: [group.active], active: group.active }],
    focused: 1,
    frac: EDITOR_SPLIT_DEFAULT,
  };
}

export function joinEditor(split: EditorSplit): EditorGroup {
  return normalizeGroup(
    [...split.groups[0].paths, ...split.groups[1].paths],
    split.groups[split.focused].active || split.groups[0].active || split.groups[1].active,
  );
}

export function focusedGroup(split: EditorSplit): EditorGroup {
  return split.groups[split.focused];
}

export function otherGroup(split: EditorSplit): EditorGroup {
  return split.groups[split.focused === 0 ? 1 : 0];
}

export function focusedPath(split: EditorSplit): string {
  return focusedGroup(split).active;
}

export function otherPath(split: EditorSplit): string {
  return otherGroup(split).active;
}

export function allSplitPaths(split: EditorSplit): string[] {
  return uniquePaths([...split.groups[0].paths, ...split.groups[1].paths]);
}

export function openInGroup(group: EditorGroup, path: string): EditorGroup {
  const next = cleanPath(path);
  if (!next) return group;
  if (group.paths.includes(next)) {
    return group.active === next ? group : { ...group, active: next };
  }
  return { paths: uniquePaths([...group.paths, next]), active: next };
}

export function focusGroup(split: EditorSplit, index: 0 | 1): EditorSplit {
  const focused = index === 1 ? 1 : 0;
  if (split.focused === focused) return split;
  return { ...split, focused };
}

export function openInFocused(split: EditorSplit, path: string): EditorSplit {
  const next = openInGroup(split.groups[split.focused], path);
  if (next === split.groups[split.focused]) return split;
  const groups: [EditorGroup, EditorGroup] = [split.groups[0], split.groups[1]];
  groups[split.focused] = next;
  return { ...split, groups };
}

export function activateInGroup(split: EditorSplit, index: 0 | 1, path: string): EditorSplit {
  const focused = index === 1 ? 1 : 0;
  const next = openInGroup(split.groups[focused], path);
  if (next === split.groups[focused] && split.focused === focused) return split;
  const groups: [EditorGroup, EditorGroup] = [split.groups[0], split.groups[1]];
  groups[focused] = next;
  return { ...split, groups, focused };
}

export function closeInGroup(
  split: EditorSplit,
  index: 0 | 1,
  path: string,
): { split: EditorSplit | null; dropBuffer: boolean; active: string } {
  const target = index === 1 ? 1 : 0;
  const group = split.groups[target];
  const nextPath = cleanPath(path);
  if (!nextPath || !group.paths.includes(nextPath)) {
    return { split, dropBuffer: false, active: focusedPath(split) };
  }
  const remaining = normalizeGroup(
    group.paths.filter((item) => item !== nextPath),
    group.active === nextPath ? "" : group.active,
  );
  const other = split.groups[target === 0 ? 1 : 0];
  const stillOpen = other.paths.includes(nextPath);
  if (!remaining.paths.length) {
    return { split: null, dropBuffer: !stillOpen, active: other.active };
  }
  const groups: [EditorGroup, EditorGroup] = [split.groups[0], split.groups[1]];
  groups[target] = remaining;
  const focused = split.focused;
  return {
    split: { ...split, groups, focused },
    dropBuffer: !stillOpen,
    active: groups[focused].active,
  };
}

export function closeOthersInFocused(split: EditorSplit): EditorSplit {
  const keep = focusedGroup(split).active;
  if (!keep) return split;
  const groups: [EditorGroup, EditorGroup] = [split.groups[0], split.groups[1]];
  groups[split.focused] = { paths: [keep], active: keep };
  return { ...split, groups };
}

export function closeSavedInFocused(
  split: EditorSplit,
  dirty: ReadonlySet<string>,
): { split: EditorSplit | null; drop: string[]; active: string } {
  const group = focusedGroup(split);
  const keep = group.paths.filter((path) => path === group.active || dirty.has(path));
  const otherPaths = otherGroup(split).paths;
  const drop = group.paths.filter((path) => !keep.includes(path) && !otherPaths.includes(path));
  const next = normalizeGroup(keep, group.active);
  if (!next.paths.length) {
    const other = otherGroup(split);
    return { split: null, drop, active: other.active };
  }
  const groups: [EditorGroup, EditorGroup] = [split.groups[0], split.groups[1]];
  groups[split.focused] = next;
  return { split: { ...split, groups }, drop, active: next.active };
}

export function remapSplitPath(split: EditorSplit, from: string, dest: string): EditorSplit {
  const mapPath = (path: string) => {
    if (path === from) return dest;
    if (path.startsWith(`${from}/`)) return dest + path.slice(from.length);
    return path;
  };
  return {
    ...split,
    groups: [
      normalizeGroup(split.groups[0].paths.map(mapPath), mapPath(split.groups[0].active)),
      normalizeGroup(split.groups[1].paths.map(mapPath), mapPath(split.groups[1].active)),
    ],
  };
}

export function parseEditorSplit(raw: unknown): EditorSplit | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { groups?: unknown; focused?: unknown; frac?: unknown };
  const frac = clampEditorSplit(typeof value.frac === "number" ? value.frac : EDITOR_SPLIT_DEFAULT);
  if (Array.isArray(value.groups) && value.groups.length >= 2) {
    const left = value.groups[0] as { paths?: unknown; active?: unknown };
    const right = value.groups[1] as { paths?: unknown; active?: unknown };
    if (!Array.isArray(left?.paths) || !Array.isArray(right?.paths)) return null;
    const groups: [EditorGroup, EditorGroup] = [
      normalizeGroup(left.paths as string[], typeof left.active === "string" ? left.active : ""),
      normalizeGroup(right.paths as string[], typeof right.active === "string" ? right.active : ""),
    ];
    if (!groups[0].active || !groups[1].active) return null;
    return {
      groups,
      focused: value.focused === 1 ? 1 : 0,
      frac,
    };
  }
  return null;
}
