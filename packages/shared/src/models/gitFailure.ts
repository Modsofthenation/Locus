/**
 * Classify a failed git tool (or a shell git command) so the agent gets one remediation
 * line instead of guessing from raw git output.
 */
export type GitFailureCategory =
  | "git-auth"
  | "git-non-fast-forward"
  | "git-diverged"
  | "git-protected-branch"
  | "git-detached-head"
  | "git-not-found"
  | "git-network";

export interface GitFailure {
  category: GitFailureCategory;
  retryable: boolean;
  hint: string;
}

const AUTH =
  /could not read (?:Username|Password)|terminal prompts disabled|Authentication failed|Invalid username or (?:password|token)|HTTP Basic: Access denied|Permission denied \(publickey|Host key verification failed|The requested URL returned error: 40[13]|remote: (?:Unauthorized|Forbidden)|Write access to repository not granted|could not read from remote repository/i;
const NON_FF =
  /\[rejected\][^\n]*\((?:non-fast-forward|fetch first)\)|Updates were rejected because the (?:tip|remote)/i;
const NOT_FOUND =
  /couldn't find remote ref|Repository not found|repository '[^']*' not found|does not appear to be a git repository|The requested URL returned error: 404/i;
const NETWORK =
  /Could not resolve host|Connection timed out|Connection refused|Failed to connect|SSL certificate problem|unable to access '[^']*': (?:SSL|OpenSSL|schannel|gnutls)/i;

export function classifyGitFailure(output: string): GitFailure | undefined {
  if (/Refusing git_push to protected branch/i.test(output)) {
    return {
      category: "git-protected-branch",
      retryable: false,
      hint: "Create a feature branch with git_branch, then git_push and git_pr from it.",
    };
  }
  if (/LOCUS_DETACHED_HEAD/.test(output)) {
    return {
      category: "git-detached-head",
      retryable: false,
      hint: "HEAD is detached. Create a branch with git_branch before pushing.",
    };
  }
  if (/LOCUS_DIVERGED/.test(output)) {
    return {
      category: "git-diverged",
      retryable: false,
      hint: "The remote branch was fetched but the local branch has diverged, so nothing was merged. Rebase or merge origin/<branch> (resolve conflicts), then continue.",
    };
  }
  if (NON_FF.test(output)) {
    return {
      category: "git-non-fast-forward",
      retryable: true,
      hint: "The remote branch has commits you do not have. Run git_fetch for this branch, rebase or merge, then git_push again. Do not force-push.",
    };
  }
  if (AUTH.test(output)) {
    return {
      category: "git-auth",
      retryable: false,
      hint: "Git authentication failed. Shell git has no Locus forge credentials: use git_fetch / git_push / git_pr. If a Locus git tool failed, check the forge token in Settings → Git matches this repository's forge and can read and write it.",
    };
  }
  if (NOT_FOUND.test(output)) {
    return {
      category: "git-not-found",
      retryable: false,
      hint: "The remote, repository, or ref was not found. Check the branch name and that the forge token can see this repository.",
    };
  }
  if (NETWORK.test(output)) {
    return {
      category: "git-network",
      retryable: true,
      hint: "Git could not reach the remote (DNS, proxy, TLS, or timeout). Check network/proxy settings and retry.",
    };
  }
  return undefined;
}

/** Shell output from a git command that failed for lack of forge credentials. */
export function shellGitAuthHint(output: string): string | undefined {
  if (!/(?:^|\n)\s*(?:fatal|error|remote):|could not read Username/i.test(output)) return undefined;
  const failure = classifyGitFailure(output);
  if (failure?.category !== "git-auth") return undefined;
  return "Locus: shell git has no forge credentials. Use the git_fetch tool to fetch/pull, git_push to push, and git_pr to open a pull request.";
}
