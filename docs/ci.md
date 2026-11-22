# Headless CI, budgets, audit log, and telemetry

Controls for running Locus agents unattended and accounting for what they did.

## `locus ci run`

Runs one agent to completion without a person in the loop and exits with a code your CI can gate on.

```bash
npx locus ci run --recipe pr-reviewer --pr https://github.com/acme/web/pull/42 --out result.json
npx locus ci run --recipe repo-fixer --repo . --runtime host --allow "git_push(branch:locus/*)" --allow git_pr
npx locus ci run --prompt "Bump lodash and run the tests" --repo https://github.com/acme/web --max-usd 2
```

| Exit | Meaning |
| --- | --- |
| `0` | Pass: review verdict PASS (risk low), or a non-review run that ended without Needs you and with green tests |
| `1` | Fail: verdict FAIL or risk high, no verdict, Needs you (including **Budget reached**), or the last test run failed |
| `2` | Stopped waiting for approval (`--no-auto-deny`) |
| `3` | Error: control plane unreachable, session error, or `--timeout` |

### Control plane

- `--api URL` uses that control plane and fails with `3` if it is down.
- Without `--api`, a running control plane (desktop app or `locus serve`) is reused.
- Otherwise (or with `--ephemeral`) an ephemeral control plane starts on a free loopback port with `LOCUS_HOME` in a temp directory (`--home DIR` to pick one, `--keep-home` to keep it). It is stopped when the run ends.
- An ephemeral plane reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` and `GITHUB_TOKEN` (or `GH_TOKEN`) from the environment and stores them in its own vault. A shared plane is never modified.

### Approvals

Anything that would wait for Approve / Deny is **denied** unless an `--allow` rule matches. Rules use the same param-permission syntax as Always allow and the approval policy: `git_push(branch:locus/*)`, `git_pr`, `mcp`, `exec(command:npm test)`. Rules match the tool-call arguments as the agent sent them. With `--no-auto-deny` the run stops at the first unmatched approval and exits `2`.

Protected-branch walls (push to `main` / `master` / `trunk`, force-push) still refuse even when a rule matches.

### Inputs

| Flag | |
| --- | --- |
| `--recipe pr-reviewer\|repo-fixer` | Recipe playbook, tools, and image. Defaults to `pr-reviewer` when `--pr` is set and no `--prompt` |
| `--prompt TEXT` | Task text (or positional text) |
| `--repo PATH\|URL` | A local directory runs on `--runtime host`; a clone URL is linked and cloned into Docker |
| `--pr URL` | GitHub `/pull/N`, GitLab `/-/merge_requests/N`, Bitbucket `/pull-requests/N` |
| `--runtime host\|docker` | Default from the recipe (or host for a local path) |
| `--provider ID`, `--model ID` | Default: first provider with a key, its default model |
| `--max-usd N` | Per-turn spend cap for this agent |
| `--post-comment` | Post the review verdict on the PR (review recipes) |
| `--out FILE` | JSON result (below) |
| `--timeout SECONDS` | Default 1800 |
| `--json` | Print the result JSON on stdout; progress goes to stderr |

Progress (tool starts and finishes, system notes, allow/deny decisions, the final reply) streams to stdout.

### Result

```json
{
  "outcome": "fail",
  "exitCode": 1,
  "verdict": "FAIL",
  "reasons": ["null dereference in cart.ts when the basket is empty"],
  "risk": "low",
  "sessionId": "8c1f…",
  "recipe": "pr-reviewer",
  "model": "claude-sonnet-4-5",
  "costUsd": 0.0421,
  "tokens": { "input": 11893, "output": 1204 },
  "tests": { "ran": 1, "passed": true, "last": "npm test" },
  "deniedApprovals": [],
  "allowedApprovals": [],
  "pr": "https://github.com/acme/web/pull/42",
  "startedAt": "2026-11-14T10:00:00.000Z",
  "finishedAt": "2026-11-14T10:03:12.000Z"
}
```

## GitHub Action

`.github/actions/locus-ci` installs Node, installs Locus (this checkout, or the ref in `version`), and runs `npx locus ci run`. The job fails with the run's exit code; the step summary shows the verdict.

```yaml
name: locus-review
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Modsofthenation/Locus/.github/actions/locus-ci@v0.20.0
        with:
          recipe: pr-reviewer
          version: v0.20.0
          model: claude-sonnet-4-5
          max-usd: "1.50"
          post-comment: "true"
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

A fixer that may push its own branch and open a PR:

```yaml
      - uses: Modsofthenation/Locus/.github/actions/locus-ci@v0.20.0
        with:
          recipe: repo-fixer
          runtime: host
          prompt: "Fix the failing tests on this branch."
          allow: |
            git_push(branch:locus/*)
            git_pr
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Outputs: `outcome`, `verdict`, `exit-code`, `result` (path of the JSON file, default `locus-result.json`). Host runtime runs tools on the runner itself; use it only on ephemeral runners.

## Daily budgets

Server-enforced caps on top of the per-turn spend cap:

```bash
locus budget                                   # today's spend vs caps
locus budget set --daily-usd 25 --daily-tokens 5000000
locus budget set --automation <id> --daily-usd 5
locus budget set --project <id> --daily-tokens 500000
locus budget set --daily-usd 0                 # clear
locus budget override --reason "release day"   # audited, lasts until local midnight
```

Config keys: `budgets.dailyUsd`, `budgets.dailyTokens`, `budgets.automations.<id>.dailyUsd|dailyTokens`, `budgets.projects.<id>.dailyUsd|dailyTokens`. Settings → Advanced → Budgets edits the global caps and shows today's spend; the chat composer shows `Today $x / $cap` when a cap is set.

Every provider usage delta (native and CLI turns) is added to a ledger under `~/.locus/budgets/spend.json`, keyed by the local calendar day. A turn checks the global, automation, and project caps before its first model call and between native rounds. When a cap is reached the agent posts **Budget reached: …**, sets Needs you, and stops; the stop is written to the audit log. CLI-provider turns (Cursor / Claude Code / Codex / Kiro) are checked at turn start only. USD uses published or override rates; models without rates only count against token caps.

## Audit log

Append-only JSONL under `~/.locus/audit/audit-YYYY-MM-DD.jsonl` (UTC days) plus `HEAD.json`. Each record carries `seq`, `prevHash`, and `hash` = sha256 of its canonical JSON (sorted keys, no whitespace, without `hash`). The first record of a day links to the last record of the previous day.

Recorded: approvals and denials (Always allow with its rule), blocked actions, `git_push` / `git_pr` / `git_pr_merge` results, Settings changes to approval policy, autonomy, caps, telemetry, and budgets, budget stops and overrides, and credential / integration / MCP / plugin changes. Records name what changed; secret values never appear.

```bash
locus audit verify            # exit 0, or 1 with file, line, seq, and reason of the first broken record
locus audit verify --local    # read ~/.locus/audit directly (also used when the server is down)
locus audit export --since 7d --format csv --out audit.csv
```

HTTP (loopback only): `GET /api/audit/log?since=&format=jsonl|csv`, `GET /api/audit/verify`. `GET /api/audit/approvals` still exports the trace-derived approvals list.

Tamper-evident, not tamper-proof: anyone who can write `~/.locus` can rewrite the whole chain. Ship exports or the `HEAD.json` hash somewhere else when that matters.

## OpenTelemetry export

Off by default. Settings → Advanced → Telemetry, or:

```bash
locus config telemetry enable --endpoint http://127.0.0.1:4318 \
  [--protocol http/json|http/protobuf] [--header x-honeycomb-team=KEY] \
  [--service-name locus] [--sample 0.25] [--no-traces] [--no-metrics] [--include-content]
locus config telemetry test
locus config telemetry disable
```

Config keys: `telemetry.enabled`, `endpoint`, `protocol`, `headers` (values vaulted in `secrets.enc`), `serviceName`, `sampleRatio`, `traces`, `metrics`, `includeContent`.

- **Spans:** `invoke_agent locus` per turn (session id, turn id, model, provider, runtime, kind, tokens, cost, tool/approval/blocked counts) with `execute_tool <name>` children (ok, duration, approval decision and wait, blocked reason category).
- **Metrics** (delta sums): `locus.tokens.input`, `locus.tokens.output`, `locus.cost.usd`, `locus.tool.calls`, `locus.blocked.actions`, `locus.publish_gate.failures`, `locus.turns`, and the `locus.approval.wait` histogram (ms).
- **Content:** prompts, replies, tool arguments, tool output, and blocked messages are not exported. `includeContent` adds clipped prompt text, blocked messages, and tool output previews.
- Spans and metrics batch every 5 seconds. A failed export drops that batch; turns never wait on the collector.

The exporter is a small hand-rolled OTLP/HTTP encoder (JSON and protobuf) fed by the session trace stream, so the Electron server bundle does not carry the OpenTelemetry SDK, exporters, and protobuf runtime.
