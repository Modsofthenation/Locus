export type FlagValue = string | boolean;
export type Flags = Record<string, FlagValue>;

export interface ParsedArgs {
  tokens: string[];
  flags: Flags;
}

const BOOLEAN_FLAGS = new Set([
  "json",
  "help",
  "h",
  "version",
  "v",
  "archived",
  "refresh",
  "fresh",
  "remove",
  "steer",
  "plan",
  "no-start",
  "force",
  "foreground",
  "reuse",
  "new",
  "persist-memory",
  "auto-review",
  "enabled",
  "disabled",
  "yes",
  "y",
  "stream",
  "always",
  "wait",
  "accept",
  "dismiss",
  "split",
  "multi-view",
  "printable",
  "no-texture",
  "no-enhance",
]);

const VALUE_FLAGS = new Set([
  "api",
  "url",
  "title",
  "runtime",
  "os",
  "kind",
  "provider",
  "model",
  "repo",
  "image",
  "autonomy",
  "host-dir",
  "dir",
  "recipe",
  "as",
  "thread",
  "gif",
  "name",
  "prompt",
  "schedule",
  "every",
  "otherwise",
  "start",
  "end",
  "hour",
  "minute",
  "weekday",
  "cron",
  "body",
  "path",
  "port",
  "line",
  "side",
  "event",
  "state",
  "selector",
  "text",
  "viewport",
  "scaffold",
  "checkpoint",
  "count",
  "answer",
  "file",
  "arg",
  "client-id",
  "client-secret",
  "confirm",
  "tail",
  "key",
  "base-url",
  "id",
  "account",
  "worker",
  "placement",
  "network",
  "vision",
  "playbook",
  "secret",
  "fingerprint",
  "notify",
  "channel",
  "skill",
  "ref",
  "query",
  "oldest",
  "latest",
  "theme",
  "bind-port",
  "log-level",
  "max-usd",
  "max-ms",
  "docker-image",
  "template",
  "variant",
  "system",
  "style",
  "topology",
  "quality",
  "resolution",
  "rest-pose",
  "poly-budget",
  "summary",
  "guidelines",
  "filename",
  "from",
  "to",
  "datasource",
  "limit",
  "q",
  "timeout",
  "where",
  "starter",
  "notify",
  "node",
  "memory",
]);

const MULTI_VALUE_FLAGS = new Set(["arg", "repo"]);

function appendFlag(prev: FlagValue | undefined, name: string, next: string): string {
  if (MULTI_VALUE_FLAGS.has(name) && typeof prev === "string" && prev.length) {
    return `${prev},${next}`;
  }
  return next;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseArgv(argv: string[]): ParsedArgs {
  const tokens: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    if (raw === "--") {
      tokens.push(...argv.slice(i + 1));
      break;
    }
    if (raw === "-h") {
      flags.help = true;
      continue;
    }
    if (raw === "-v") {
      flags.version = true;
      continue;
    }
    if (raw === "-y") {
      flags.yes = true;
      continue;
    }
    if (!raw.startsWith("--")) {
      tokens.push(raw);
      continue;
    }
    const trimmed = raw.slice(2);
    const eq = trimmed.indexOf("=");
    const name = (eq >= 0 ? trimmed.slice(0, eq) : trimmed).toLowerCase();
    if (!name) throw new UsageError("Empty flag");
    if (eq >= 0) {
      flags[name] = appendFlag(flags[name], name, trimmed.slice(eq + 1));
      continue;
    }
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    if (VALUE_FLAGS.has(name)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        throw new UsageError(`Flag --${name} needs a value`);
      }
      flags[name] = appendFlag(flags[name], name, next);
      i += 1;
      continue;
    }
    throw new UsageError(`Unknown flag --${name}`);
  }
  return { tokens, flags };
}

export function flagBool(flags: Flags, name: string): boolean {
  return flags[name] === true || flags[name] === "true" || flags[name] === "1";
}

export function flagStr(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

export function flagList(flags: Flags, name: string): string[] {
  const raw = flagStr(flags, name);
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function flagNum(flags: Flags, name: string): number | undefined {
  const raw = flagStr(flags, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number`);
  return n;
}

export function need(args: string[], index: number, label: string): string {
  const value = args[index]?.trim();
  if (!value) throw new UsageError(`Missing ${label}`);
  return value;
}

export function restJoin(args: string[], from = 0): string {
  return args.slice(from).join(" ").trim();
}
