/** Isolate git from the developer’s global config (gpg signing, aliases, …). */
export function gitTestEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: extra.GIT_AUTHOR_NAME ?? "Locus",
    GIT_AUTHOR_EMAIL: extra.GIT_AUTHOR_EMAIL ?? "locus@test",
    GIT_COMMITTER_NAME: extra.GIT_COMMITTER_NAME ?? extra.GIT_AUTHOR_NAME ?? "Locus",
    GIT_COMMITTER_EMAIL: extra.GIT_COMMITTER_EMAIL ?? extra.GIT_AUTHOR_EMAIL ?? "locus@test",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "commit.gpgsign",
    GIT_CONFIG_VALUE_0: "false",
    ...extra,
  };
}
