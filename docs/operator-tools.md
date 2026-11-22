# Reviewing and recovering agent work

## Verify parallel attempts

Open **Board → Compare → Verify all attempts** after the agents finish. Locus reads the [verification plan](verify.md) from the shared checkout once, then runs its test, lint, and typecheck steps inside each local Host worktree. Expand a step to see its command, output, and any parsed failing tests. A missing command or toolchain appears as skipped. Prepare each worktree's normal dependencies before verification.

## Compare a web preview

Open **Files → Preview** on a Host or Docker agent. If the port was detected automatically, choose **Enable visual review** in the preview toolbar. Open **Artifacts → Visual review**, give the baseline a name, optionally enter a page path, and choose **Save baseline**. After changes, select the baseline and choose **Compare current preview**. The drawer shows baseline, current, and highlighted screenshots at desktop and mobile sizes. It keeps the most recent comparison for each named baseline.

Captures use a fresh, sandboxed Chromium browser with the preview as its only asset source. Start the preview first and use a page that loads its assets from that preview. The capture needs an installed Chromium or Chrome, or a Playwright Chromium installation. Locus also recognizes the `LOCUS_CHROME` executable override.

## Prepare a project for offline use

Open **Offline profile** in the project panel. Select a loopback Ollama provider and a downloaded model, then enter a locally cached Docker image. You can also select a Docker golden workspace containing the project files and dependencies. Choose **Check offline readiness** to verify the model, image, and optional workspace before you disconnect.

Saving the profile applies it to new project agents. The next project coordinator uses the configured local model if its previous coordinator used a different profile. Existing sessions keep their settings. New coding agents run on this machine in Docker with guest networking disabled and use the selected golden workspace or an empty workspace. Cloud models, web search, forge cloning, remote workers, and external tool integrations are unavailable in those sessions.

## Recover a worker turn

The worker status in the agent toolbar shows connectivity and whether a CLI turn is still running when the worker can report it. If the worker connection drops briefly, the control plane reconnects to the same CLI turn and continues reading its output. This requires both the desktop control plane and worker to support replay. The worker keeps a bounded in-memory output window.

Expand the status to open guest logs after reconnecting. For a confirmed interruption with a saved chat checkpoint, **Resume from checkpoint** restores the conversation and resends the interrupted prompt. The agent continues in the worker's current workspace.

## Preview a job trigger

In a new or existing webhook, git-push, or pull-request job, open **Preview trigger**. Paste a JSON payload and supply its event header if needed, or open an existing job and select a recent recorded event. **Check sample** evaluates the trigger and shows the workspace, model, and tool configuration. Live delivery also checks authentication, job availability, and duplication.

## See what's using disk space

Go to **Settings → Advanced → Storage and cleanup → Scan storage**. Expand a category to see sizes and pin entries you want to keep. Select eligible recordings and choose **Preview cleanup** to see estimated reclaimed space. Cleanup removes recordings at least 24 hours old that belong to deleted sessions. The inventory also reports worktrees, VM disks, golden images, and visual reviews.
