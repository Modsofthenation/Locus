# CI fix loop

How Locus turns a red pull request into a fix, and when it stops.

## Trigger

A coding chat subscribes to a pull request's checks (`subscribe` with `kind: checks`). The poller reads the PR head and its checks every few seconds. A check that turns `failure` / `error` wakes the loop.

## One fix per head and failing set

Each checks subscription remembers the last fix it started as `headSha|check,check` (`ciFix.lastKey`) and a per-check attempt count (`ciFix.attempts`).

| Situation | What happens |
| --- | --- |
| New failing set on a head | Start **Fix with agent** with the CI section (attempt counted for every failing check) |
| Same head and same failing set again (a re-run) | Nothing: no second fix, no wake |
| A failing check already had `review.ciFixMaxAttempts` fixes (default 2) | No fix; Needs you on the subscriber and the PR's bound agent: “CI fix stopped after 2 attempts: … Needs a human.” |
| A check passes | Its count resets |

If starting the fix fails (forge down), no attempt is counted and the subscriber is still woken.

## The fix prompt

`formatCiFixPrompt` leads the prompt; the reviewer verdict and load path follow as context.

1. Check out the PR branch at the head SHA.
2. Reproduce the failure in the guest first: run the failing command or test from the log.
3. Fix the cause (do not skip the test or loosen lint/typecheck config).
4. Re-run until it passes, then the wider test/typecheck command.
5. Commit and push to the same PR branch. Never a new branch, never force-push, never main/master. The git walls and the push test gate still apply.

Below the steps: each failing check, its URL, failing test ids, and a condensed log (default 9k characters across up to three checks). `git_ci_logs` reads any other check.

## Logs per forge

| Forge | Checks | Log |
| --- | --- | --- |
| GitHub | check runs + commit statuses | Actions: `/actions/jobs/{id}/logs` (302 to a signed URL, fetched without the token). Other check runs: output text + annotations. Statuses: none. |
| GitLab | MR pipeline jobs (allowed failures ignored) | `/jobs/{id}/trace` |
| Gitea / Forgejo | commit statuses | none |
| Bitbucket, Azure DevOps | the PR's checks | none (“Logs not available”) |

Raw logs are capped at 4 MB, keeping the first 64 KB and the tail.

## Settings

```json
{ "review": { "requireApprovalAtRisk": "high", "ciFixMaxAttempts": 2 } }
```
