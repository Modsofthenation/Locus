# Workspace performance on real repositories (2026-11-12, v0.20.0)

Raw numbers: [`results-2026-11-12.json`](results-2026-11-12.json) (before) and [`results-2026-11-12-after.json`](results-2026-11-12-after.json) (after the fixes). Harness: [`repoPerf.ts`](repoPerf.ts), [`editGrepLoop.ts`](editGrepLoop.ts).

## After the fixes

The fixes for the findings below landed on this branch. Same machine, same clones, 3 runs, median ms / worst event-loop stall ms:

| Operation | react | django | vscode | kubernetes |
|---|---:|---:|---:|---:|
| Agent grep, next call after one file edit | 3,472 → **32** | – | 18,040 → **91** | – |
| VM guest listing script | – | – | 31,570 → **~60** | – |
| Files search without rg (walk fallback) | 3,525 / 2,439 → **80 / 22** | 1,677 / 534 → **88 / 19** | 12,037 / 7,751 → **147 / 53** | 9,516 / 5,998 → **199 / 61** |
| Agent grep with index, selective literal | 139 / 99 → **33 / 9** | 133 / 133 → **45 / 10** | 414 / 263 → **100 / 25** | 391 / 219 → **126 / 48** |
| Agent grep with index, no match | 142 / 104 → **34 / 8** | 116 / 61 → **39 / 6** | 414 / 295 → **82 / 15** | 349 / 227 → **96 / 14** |
| Grep index load (now once per process) | 113 / 102 → **30 / 17** | 82 / 74 → **17 / 13** | 325 / 278 → **87 / 45** | 246 / 207 → **48 / 35** |
| Grep index on disk | 12.2 → **9.2 MB** | 9.3 → **7.6 MB** | 56.9 → **40.1 MB** | 41.5 → **30.2 MB** |
| Repo index, warm rebuild | 358 → **125** | 542 → **275** | 1,053 → **374** | 1,135 → **535** |
| Repo index, rebuild after 50 edits | 386 → **157** | 438 → **296** | 1,066 → **409** | 1,201 → **584** |
| Per-turn ranked repo map | 12 → **4** | 8 → **4** | 78 → **13** | 64 → **13** |
| Quick Open, 6 keystrokes | 91 → 91 | 44 → **28** | 253 → **169** | 228 → 208 |
| Git status, 250 changes | 34 → **23** | 46 → **36** | 85 → **70** | 113 → **97** |

Notes:
- The grep index is now built in the background, and the grep that triggers the build uses plain ripgrep. Building still takes 3–17 s, but it yields every 16 files, so the worst stall dropped from 389 ms to about 100 ms on vscode.
- After this run, indexed grep was changed to skip `git status` when the index can't narrow the pattern. A spot check put a common word on kubernetes at 13–16 ms indexed versus 9 ms plain, where it was ~115 ms before that change.
- On a warm file cache the index now roughly breaks even with plain ripgrep for rare tokens: 81–98 ms versus 99–125 ms. `git status` (70–90 ms on these repos) is most of what remains. Cold disks were not measured.
- The bundled `@vscode/ripgrep` is a static musl build and ran ~1.5× slower than the distro `rg` 14.1. `rg` on `PATH` is preferred, and the bundled copy is the fallback that keeps search off the JS walk.
- Files tree, git dirty stats, and repo index cold builds are unchanged within noise. The listing change mainly adds the `truncated` flag.

## Setup

- Linux container, 4 vCPU, 16 GB RAM, Node 22.23, ripgrep on `PATH`, **no ctags**. The file cache was warm, so cold-disk numbers will be worse.
- Each operation ran 3 times. Tables show the median. **Stall** is the worst event-loop delay seen while the operation ran. The control plane is single-threaded, so a stall freezes every HTTP request, WebSocket stream and agent turn for that long.
- Repos (shallow clones at `HEAD`):

| Repo | Tracked files | Indexed files | Checkout |
|---|---:|---:|---:|
| expressjs/express | 216 | 216 | 0.7 MB |
| pallets/flask | 236 | 231 | 1.7 MB |
| facebook/react | 7,276 | 7,195 | 39 MB |
| django/django | 7,100 | 5,602 | 44 MB |
| microsoft/vscode | 21,212 | 19,666 | 339 MB |
| kubernetes/kubernetes | 31,757 | 18,975 | 270 MB |

## Headline numbers (median ms / worst stall ms)

| Operation | express | flask | react | django | vscode | kubernetes |
|---|---:|---:|---:|---:|---:|---:|
| Repo index, cold build | 56 / 16 | 51 / 9 | 457 / 35 | 611 / 29 | 1,344 / 128 | 1,225 / 95 |
| Repo index, warm rebuild (nothing changed) | 45 / 10 | 33 / 10 | 358 / 32 | 542 / 37 | 1,053 / 96 | 1,135 / 87 |
| Per-turn ranked repo map | 2 | 1 | 12 | 8 | 78 | 64 |
| Quick Open, 6 keystrokes | 2 | 2 | 91 | 44 | 253 | 228 |
| Trigram grep index build | 79 / 14 | 128 / 22 | 3,311 / 122 | 2,907 / 115 | **17,053 / 389** | **12,044 / 304** |
| Trigram index load (on every grep) | 6 | 11 | 113 / 102 | 82 / 74 | 325 / 278 | 246 / 207 |
| Agent grep, **with** index (selective literal) | 20 | 24 | 139 / 99 | 133 / 133 | 414 / 263 | 391 / 219 |
| Agent grep, **without** index (same function) | 14 | 13 | 58 / 10 | 80 / 10 | 160 / 10 | 106 / 11 |
| Agent grep, next call after one file edit | – | – | **3,472** | – | **18,040** | – |
| Files search with rg | 9 | 10 | 15 | 14 | 15 | 13 |
| Files search without rg (walk fallback) | 58 | 57 | 3,525 / 2,439 | 1,677 / 534 | **12,037 / 7,751** | **9,516 / 5,998** |
| VM guest listing script (`find -exec printf`) | – | – | – | – | **31,570** | – |
| Files tree, full listing | 9 | 9 | 231 / 71 | 261 | 364 | 385 |
| Git status, clean | 13 | 14 | 30 | 48 | 78 | 97 |
| Git dirty stats, 50 modified + 200 untracked | 17 | 21 | 44 | 50 | 100 | 315 |

Small repos are fine everywhere. The problems start at about 5k files and get serious at 20k.

## Where to improve (ranked by user impact, as found before the fixes)

### 1. Any file edit makes the next agent `grep` rebuild the whole trigram index

`file_write` / `apply_patch` call `updateIndexPaths`, which rewrites `files.jsonl`. `ensureGrepIndex` uses that file's mtime and size as its freshness stamp, so the next grep rebuilds every posting list from scratch (`grepIndex.ts` `ensureGrepIndex` → `buildGrepIndex`). Agents edit and grep in a loop, so on a large repo almost every grep pays for a full rebuild:

- react: 167 ms per grep with no edits, **3.5 s** after an edit.
- vscode: 437 ms per grep with no edits, **18 s** after an edit, with stalls up to 389 ms and 140–290 MB of heap churn.

**Fix:** update postings incrementally for the changed paths, and track freshness per path instead of per file. Or drop the index entirely (see #2).

### 2. VM Files pane: the guest listing forks one `printf` per file

`workspaceFindScript` (used by `listGuestWorkspaceEntries` for VM sessions) runs `find … -exec printf 'f\t%s\n' {} \;`. That starts a new process for every directory and file. After `head -n 16000` closes the pipe, `find` keeps walking and forking until it reaches the end of the tree. On the vscode tree, in this container (no SSH hop), it took **31.6 s**. The same listing with `-printf` took **0.05 s**. Over SSH into a real VM it will be slower still.

**Fix:** use `-printf 'f\t%p\n'` (GNU find, which all supported Linux guests have), or the POSIX batch form `-exec printf 'f\t%s\n' {} +`.

### 3. The trigram index makes agent grep slower than plain ripgrep

Even with no edits, the indexed path is 1.4–3.7× slower than the same function without a cache dir on every repo over 5k files. It also blocks the event loop for 60–300 ms per call. On every call it `JSON.parse`s the whole postings file (12 MB on react, 57 MB on vscode, 41 MB on kubernetes) and runs `git status`. ripgrep alone searches 20k files in 100–235 ms. The index is also skipped for common words, wide regexes, and short literals (kubernetes' selective query fell back too).

**Fix (pick one):**
- Turn `workspaceGrepIndex` off by default and delete the index. This is the simplest option and the fastest in every measurement.
- Or keep the index in memory across calls, store it in a binary or sorted format instead of JSON, and build it off the main thread.

Also, `runAgentRipgrep` passes up to 4,000 candidate paths as argv. That exceeds the 32 KB Windows command-line limit, so on Windows the spawn fails and the call silently falls back. This comes from reading the code; it was not measured.

### 4. ripgrep is not bundled, and the fallback freezes the server for seconds

`resolveRipgrep()` only looks for `rg` on `PATH`. Guests ship rg, but the host-side Files search and the indexed agent grep run on the control-plane host. Most macOS and Windows desktops don't have rg installed. Without it, the Files pane uses `grepByWalk`: **12 s on vscode, with a 7.8 s event-loop stall**, and 3.5 s on react. The indexed agent grep returns `undefined` and falls back to the guest.

**Fix:** ship `@vscode/ripgrep` (or a per-platform binary in `extraResources`) and resolve it before `PATH`. If the walk fallback stays, move it into a worker thread and yield between files.

### 5. A repo index "warm" rebuild costs nearly as much as a cold one

With nothing changed, a forced rebuild costs 78–89% of a cold build (react 358 vs 457 ms, vscode 1,053 vs 1,344 ms). This happens after every `git_clone` / `git_fetch`. Two causes:

- `fillIndexSymbols` treats `symbols: []` as "not extracted yet", so source files with no symbols are re-read on every build: 324 re-reads on react, 298 on django.
- Every listed file is `lstat`ed again (20k calls on vscode) on the main thread, with stalls around 100 ms.

**Fix:** store `symbols: null` vs `[]` (or a `symbolsAt` stamp) so empty results are cached. On rebuild, diff against `git ls-files -s` / `git status` instead of `lstat`ing every file. Also, `ctags -R -x .` runs over the whole tree with an 8 MB buffer and an 8 s timeout. That wasn't measured here because ctags isn't installed, but on a large repo it would overflow and waste up to 8 s before falling back. Pass it the chosen file list instead.

### 6. Quick Open and the per-turn repo map are synchronous O(n) work on the server thread

- `searchRepoMap` fuzzy-scores every path and symbol on each keystroke. It takes 40 ms per query on 20k files, 250 ms for a 6-keystroke burst, all synchronous. **Fix:** reuse the previous result set when the query extends the last one, precompute lowercased paths and basenames, and debounce on the client.
- `formatRepoMap({ rank: true })` runs on every agent turn (cached for 30 s per query). It takes 64–78 ms on 20k-file repos. The cost is `scoped.filter(f => !matched.includes(f))`, which is O(n·m), plus `lines.join("\n")` re-run for every line. **Fix:** use a `Set` and a running length counter. This is a one-line quick win.

### 7. Index memory is never released

`readyIndexes` in `repoIndex.ts` only clears in tests. Each session that touches a 20k-file repo keeps 16–40 MB of heap until the process exits, including deleted sessions and "Keep running" control planes. **Fix:** evict on session delete and put an LRU cap on the map.

### 8. Files tree listing silently truncates and lstats files one at a time

On vscode and kubernetes the full listing hits `WORKSPACE_LIST_MAX_ENTRIES` (16,000) without telling the caller. `captureImage` calls the unbounded listing to copy a worker workspace, so large workspaces lose files without warning. Within each directory, files are `lstat`ed one at a time (`await` in a loop). **Fix:** return a `truncated` flag, batch the `lstat`s per directory, and use `git ls-files` for tracked trees.

### 9. Git status spawns 3–4 processes; dirty stats has a 2 s hard timeout

`workspaceGitStatus` runs `rev-parse --is-inside-work-tree`, `status`, `rev-parse --abbrev-ref`, and `rev-parse @{upstream}` one after another (97 ms clean on kubernetes). `git status --porcelain=v2 --branch -z` returns branch, upstream and ahead/behind in a single process. `gitWorkspaceChanges` reached 315 ms on kubernetes with edits. It runs with a 2 s timeout, and on larger monorepos or cold disks it will time out and silently report no changes. **Fix:** collapse the git calls into one, and raise or adapt the timeout, or surface the timeout instead of returning `[]`.

## Re-running

```bash
npm ci
git clone --depth 200 https://github.com/microsoft/vscode /tmp/repos/vscode
node --expose-gc --import tsx apps/server/bench/repoPerf.ts /tmp/repos/vscode --runs 3 --out results.json
npx tsx apps/server/bench/editGrepLoop.ts /tmp/repos/vscode --edits 3
```

The harness appends to 50 tracked files and creates 200 scratch files in each repo, then restores them with `git checkout` and deletes the scratch files. Point it at throwaway clones only.
