import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { sanitizeWorkspaceRel } from "./workspaceFiles.js";

export type EditorConfigIndent = {
  indent: string;
  tabSize: number;
};

function parseEditorConfig(
  text: string,
): Array<{ glob: string; indent?: string; tabSize?: number }> {
  const sections: Array<{ glob: string; indent?: string; tabSize?: number }> = [];
  let current: { glob: string; indent?: string; tabSize?: number } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      current = { glob: section[1] ?? "*" };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^(indent_style|indent_size|tab_width)\s*=\s*(.+)$/i);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const value = kv[2]!.trim();
    if (key === "indent_style" && value === "tab") current.indent = "\t";
    if (key === "indent_style" && value === "space") current.indent ??= "  ";
    if (key === "indent_size" || key === "tab_width") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0 && n <= 8) {
        current.tabSize = n;
        if (current.indent !== "\t") current.indent = " ".repeat(n);
      }
    }
  }
  return sections;
}

function globMatch(glob: string, rel: string): boolean {
  if (glob === "*" || glob === "**") return true;
  const escaped = glob
    .replace(/[.+^$()|\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*")
    .replace(/\{([^}]+)\}/g, (_, inner: string) => `(?:${inner.split(",").join("|")})`);
  return new RegExp(`^${escaped}$`).test(rel) || new RegExp(`(^|/)${escaped}$`).test(rel);
}

export function indentFromEditorConfig(root: string, rel: string): EditorConfigIndent | null {
  const path = sanitizeWorkspaceRel(rel);
  if (!path) return null;
  let dir = join(root, dirname(path.split("/").join(sep)));
  const stop = root;
  const collected: Array<{ glob: string; indent?: string; tabSize?: number }> = [];
  for (let i = 0; i < 12; i += 1) {
    try {
      const text = readFileSync(join(dir, ".editorconfig"), "utf8");
      collected.unshift(...parseEditorConfig(text));
      if (/^root\s*=\s*true/im.test(text)) break;
    } catch {
      /* missing */
    }
    if (dir === stop) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  let indent: string | undefined;
  let tabSize: number | undefined;
  for (const section of collected) {
    if (!globMatch(section.glob, path)) continue;
    if (section.indent) indent = section.indent;
    if (section.tabSize) tabSize = section.tabSize;
  }
  if (!indent && !tabSize) return null;
  const size = tabSize ?? (indent === "\t" ? 4 : (indent?.length ?? 2));
  return { indent: indent ?? " ".repeat(size), tabSize: size };
}

export function relativeWorkspacePath(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}
