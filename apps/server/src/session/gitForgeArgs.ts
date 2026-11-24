import { parseRepoUrl, type ForgeKind, type RepoCheckout } from "@locus/shared";

/**
 * Fill token / forge / url for a git tool from the resolved checkout and forge account.
 * `target` is the attached checkout, or (for a host folder with no attached repo) the
 * clone's origin. A token is only passed to a remote of the same forge, so a GitHub token
 * never goes to a Bitbucket push.
 */
export function fillGitForgeArgs(
  name: string,
  args: Record<string, unknown>,
  target: Pick<RepoCheckout, "forge" | "url"> | undefined,
  account: { kind?: ForgeKind; token?: string } | undefined,
): Record<string, unknown> {
  const next = { ...args };
  const argUrl = typeof next.url === "string" ? next.url : undefined;
  const targetForge = target?.forge ?? (argUrl ? parseRepoUrl(argUrl)?.forge : undefined);
  const tokenFits = !targetForge || !account?.kind || account.kind === targetForge;
  if (account?.token && tokenFits && !next.token) next.token = account.token;
  if (!next.forge) {
    if (targetForge) next.forge = targetForge;
    else if (account?.kind) next.forge = account.kind;
  }
  // fetch/push use this URL for the call only; origin is never rewritten.
  if ((name === "git_push" || name === "git_fetch") && target?.url && !next.url) {
    next.url = target.url;
  }
  return next;
}
