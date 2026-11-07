import { execCommandsFromArgs } from "./execGuard.js";

const UNSAFE =
  /\b(git\s+(commit|push|checkout|switch|merge|rebase|reset|clean|stash|branch|tag|remote|config|filter-branch)|npm\s+i(nstall)?\b|pnpm\s+i(nstall)?\b|yarn\s+add\b|pip\s+install\b|rm\b|mv\b|cp\b|chmod\b|chown\b|mkdir\b|touch\b|tee\b|sed\s+-i\b|apply_patch|file_write|docker\b|ssh\b|scp\b|npm\s+publish\b)\b/i;

const REDIRECT_WRITE = /(?:^|[^*])>{1,2}\s*(?!\/dev\/null\b)/;
const SHELL_EXPAND = /[`$]|\$\(/;
const FIND_MUTATE = /\bfind\b/i;
const FIND_MUTATE_FLAG = /-(?:delete|exec|ok)\b/i;

const SAFE = [
  /^(npm|pnpm|yarn)\s+(test|run\s+test|run\s+lint)\b/i,
  /^(npx|pnpm\s+exec|yarn\s+dlx)\s+(vitest|jest|eslint)\b(?!.*--fix)/i,
  /^vitest\b/i,
  /^pytest\b/i,
  /^cargo\s+test\b/i,
  /^go\s+test\b/i,
  /^make\s+test\b/i,
  /^tsc\b.*--noEmit\b/i,
  /^eslint\b(?!.*--fix)/i,
  /^git\s+(status|diff|log|show|blame|rev-parse|ls-files)\b/i,
  /^(ls|pwd|rg|grep|find|wc|cat|head|tail|file|stat|test|\[)\b/i,
];

/** Plan mode may run tests and read-only exec. Mutation stays on the checklist. */
export function isPlanSafeExec(command: string): boolean {
  const text = command.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (SHELL_EXPAND.test(text)) return false;
  const parts = text
    .split(/\s*(?:&&|\|\||;|\||&)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every(isPlanSafeExecPart);
}

function isPlanSafeExecPart(text: string): boolean {
  if (!text) return false;
  if (UNSAFE.test(text) || REDIRECT_WRITE.test(text)) return false;
  if (FIND_MUTATE.test(text) && FIND_MUTATE_FLAG.test(text)) return false;
  return SAFE.some((re) => re.test(text));
}

export function planExecCommandsAreSafe(args?: Record<string, unknown>): boolean {
  const commands = execCommandsFromArgs(args ?? {});
  return commands.length > 0 && commands.every(isPlanSafeExec);
}
