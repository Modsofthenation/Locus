export type IgnoreRule = {
  negate: boolean;
  dirOnly: boolean;
  anchored: boolean;
  pattern: string;
  regex: RegExp;
};

export function parseIgnore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trimEnd();
    if (!trimmed.trim() || trimmed.trimStart().startsWith("#")) continue;
    let line = trimmed.trimStart();
    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    let anchored = line.startsWith("/");
    if (anchored) line = line.slice(1);
    if (line.startsWith("**/")) {
      anchored = false;
      line = line.slice(3);
    }
    if (!line) continue;
    rules.push({ negate, dirOnly, anchored, pattern: line, regex: gitignoreGlobToRegExp(line) });
  }
  return rules;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function gitignoreGlobToRegExp(pattern: string): RegExp {
  let i = 0;
  let out = "^";
  while (i < pattern.length) {
    if (pattern.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 3;
      continue;
    }
    if (pattern.slice(i, i + 2) === "**") {
      out += ".*";
      i += 2;
      continue;
    }
    if (pattern[i] === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (pattern[i] === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    out += escapeRegex(pattern[i]!);
    i += 1;
  }
  out += "$";
  return new RegExp(out);
}

function globMatch(rule: IgnoreRule, path: string): boolean {
  return rule.regex.test(path);
}

function ruleMatches(rule: IgnoreRule, path: string, isDir: boolean): boolean {
  if (rule.dirOnly && !isDir && path === rule.pattern) return false;
  const candidates = rule.anchored
    ? [path]
    : [
        path,
        ...path
          .split("/")
          .map((_, i, parts) => parts.slice(i).join("/"))
          .filter(Boolean),
      ];
  for (const candidate of candidates) {
    if (globMatch(rule, candidate)) return true;
    if (rule.dirOnly && candidate.startsWith(`${rule.pattern}/`)) return true;
  }
  return false;
}

export function pathIgnored(rel: string, isDir: boolean, rules: IgnoreRule[]): boolean {
  const path = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path) return false;
  let ignored = false;
  for (const rule of rules) {
    if (ruleMatches(rule, path, isDir)) ignored = !rule.negate;
  }
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const parent = parts.slice(0, i).join("/");
    let parentIgnored = false;
    for (const rule of rules) {
      if (ruleMatches(rule, parent, true)) parentIgnored = !rule.negate;
    }
    if (parentIgnored) return true;
  }
  return ignored;
}
