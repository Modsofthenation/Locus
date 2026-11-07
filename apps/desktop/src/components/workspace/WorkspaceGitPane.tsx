import { useEffect, useState } from "react";
import {
  api,
  type WorkspaceGitHunk,
  type WorkspaceGitRebaseTodo,
  type WorkspaceGitStash,
  type WorkspaceGitStatus,
} from "@/lib/api";

export function WorkspaceGitPane({
  sessionId,
  git,
  branches,
  remotes,
  commitMsg,
  onCommitMsg,
  onGit,
  onError,
  onOpenFile,
  onOpenPull,
  onDestChange,
}: {
  sessionId: string;
  git: WorkspaceGitStatus;
  branches: string[];
  remotes: string[];
  commitMsg: string;
  onCommitMsg: (value: string) => void;
  onGit: (next: WorkspaceGitStatus) => void;
  onError: (message: string) => void;
  onOpenFile: (path: string, line?: number) => void;
  onOpenPull?: (info: { repoId: string; number: number }) => void;
  onDestChange?: (dest: string) => void;
}) {
  const [hunks, setHunks] = useState<WorkspaceGitHunk[]>([]);
  const [openHunk, setOpenHunk] = useState<string | null>(null);
  const [stashes, setStashes] = useState<WorkspaceGitStash[]>([]);
  const [newBranch, setNewBranch] = useState("");
  const [rebaseOpen, setRebaseOpen] = useState(false);
  const [todos, setTodos] = useState<WorkspaceGitRebaseTodo[]>([]);
  const [onto, setOnto] = useState("");
  const [prBusy, setPrBusy] = useState(false);
  const [mergeBranch, setMergeBranch] = useState("");
  const [gitMore, setGitMore] = useState(false);
  const dest = git.dest;
  const destArg = dest ? ([dest] as const) : [];
  const destFields = dest ? { dest } : {};
  const guestPath = dest || undefined;
  const dests = git.dests ?? [];

  function catchGit(err: unknown, fallback: string) {
    onError(err instanceof Error ? err.message : fallback);
  }

  function openGitFile(rel: string, line?: number) {
    onOpenFile(dest ? `${dest}/${rel}` : rel, line);
  }

  async function refreshHunks() {
    if (typeof api.workspaceGitHunks !== "function") return;
    try {
      const res = await api.workspaceGitHunks(sessionId, undefined, ...destArg);
      setHunks(res.items ?? []);
    } catch {
      setHunks([]);
    }
  }

  async function refreshStash() {
    if (typeof api.workspaceGitStashList !== "function") return;
    try {
      const res = await api.workspaceGitStashList(sessionId, ...destArg);
      setStashes(res.items ?? []);
    } catch {
      setStashes([]);
    }
  }

  useEffect(() => {
    void refreshHunks();
    void refreshStash();
    // Refresh when the working tree identity changes, not on every status poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, git.files.length, git.branch, git.dest]);

  const all = git.files.map((row) => row.path);

  return (
    <div className="workspace-git">
      <div className="workspace-git-branch-row">
        {dests.length > 1 ? (
          <select
            className="workspace-git-select workspace-git-dest"
            aria-label="Git repository"
            value={dest ?? dests[0]?.dest ?? ""}
            onChange={(event) => {
              const next = event.target.value;
              if (!next || next === dest) return;
              onDestChange?.(next);
            }}
          >
            {dests.map((row) => (
              <option key={row.dest} value={row.dest} title={row.url ?? row.name}>
                {row.dest || row.name}
              </option>
            ))}
          </select>
        ) : null}
        {branches.length ? (
          <select
            className="workspace-git-select"
            aria-label="Git branch"
            value={git.branch}
            onChange={(event) => {
              const branch = event.target.value;
              if (!branch || branch === git.branch) return;
              void api
                .workspaceGitCheckout(sessionId, branch, false, ...destArg)
                .then(onGit)
                .catch((err) => catchGit(err, "Checkout failed"));
            }}
          >
            {git.branch && !branches.includes(git.branch) ? (
              <option value={git.branch}>{git.branch}</option>
            ) : null}
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
            {remotes.map((branch) => (
              <option key={`remote-${branch}`} value={branch}>
                origin/{branch}
              </option>
            ))}
          </select>
        ) : git.branch ? (
          <p className="workspace-git-branch">{git.branch}</p>
        ) : null}
        {git.ahead || git.behind ? (
          <span className="workspace-git-branch">
            {git.ahead ? `↑${git.ahead}` : ""}
            {git.behind ? ` ↓${git.behind}` : ""}
          </span>
        ) : null}
        <button
          type="button"
          className="btn small ghost"
          onClick={() =>
            void api
              .workspaceGitFetch(sessionId, ...destArg)
              .then(onGit)
              .catch((err) => catchGit(err, "Fetch failed"))
          }
        >
          Fetch
        </button>
        <button
          type="button"
          className="btn small ghost"
          onClick={() =>
            void api
              .workspaceGitPull(sessionId, ...destArg)
              .then(onGit)
              .catch((err) => catchGit(err, "Pull failed"))
          }
        >
          Pull
        </button>
        <button
          type="button"
          className="btn small ghost"
          aria-expanded={gitMore || rebaseOpen}
          data-testid="workspace-git-more"
          onClick={() => setGitMore((open) => !open)}
        >
          {gitMore || rebaseOpen ? "Less git" : "More git"}
        </button>
      </div>
      {gitMore || rebaseOpen ? (
        <div className="workspace-git-branch-row">
          <input
            className="workspace-git-message"
            value={newBranch}
            placeholder="New branch"
            aria-label="New branch"
            onChange={(event) => setNewBranch(event.target.value)}
          />
          <button
            type="button"
            className="btn small ghost"
            disabled={!newBranch.trim()}
            onClick={() => {
              const name = newBranch.trim();
              void api
                .workspaceGitCheckout(sessionId, name, true, ...destArg)
                .then((next) => {
                  setNewBranch("");
                  onGit(next);
                })
                .catch((err) => catchGit(err, "Could not create branch"));
            }}
          >
            Create
          </button>
        </div>
      ) : null}
      {git.merging || gitMore || rebaseOpen ? (
        <div className="workspace-git-branch-row" data-testid="workspace-git-merge">
          {git.merging ? (
            <>
              <span className="workspace-git-branch">Merging</span>
              <button
                type="button"
                className="btn small"
                onClick={() =>
                  void api
                    .workspaceGitMerge(sessionId, { action: "continue", ...destFields })
                    .then(onGit)
                    .catch((err) => catchGit(err, "Continue failed"))
                }
              >
                Continue
              </button>
              <button
                type="button"
                className="btn small ghost"
                onClick={() =>
                  void api
                    .workspaceGitMerge(sessionId, { action: "abort", ...destFields })
                    .then(onGit)
                    .catch((err) => catchGit(err, "Abort failed"))
                }
              >
                Abort
              </button>
            </>
          ) : (
            <>
              <input
                className="workspace-git-message"
                value={mergeBranch}
                placeholder="Merge branch"
                aria-label="Merge branch"
                onChange={(event) => setMergeBranch(event.target.value)}
              />
              <button
                type="button"
                className="btn small ghost"
                disabled={!mergeBranch.trim()}
                onClick={() => {
                  const name = mergeBranch.trim();
                  void api
                    .workspaceGitMerge(sessionId, { branch: name, ...destFields })
                    .then((next) => {
                      setMergeBranch("");
                      onGit(next);
                    })
                    .catch((err) => catchGit(err, "Merge failed"));
                }}
              >
                Merge
              </button>
            </>
          )}
        </div>
      ) : null}
      {git.files.length ? (
        <ul>
          {git.files.map((row) => {
            const fileHunks = hunks.filter((hunk) => hunk.path === row.path);
            return (
              <li key={row.path}>
                <div className="workspace-tree-row">
                  <button
                    type="button"
                    className="workspace-tree-open"
                    data-path={row.path}
                    onClick={() => void openGitFile(row.path)}
                  >
                    <span className="workspace-tree-name">{row.path}</span>
                    <span className="workspace-git-flag">
                      {row.conflicted
                        ? "C"
                        : row.staged
                          ? "S"
                          : row.worktree === "?"
                            ? "U"
                            : row.worktree.trim() || "M"}
                    </span>
                  </button>
                  {row.conflicted ? (
                    <>
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={() =>
                          void api
                            .workspaceGitConflict(sessionId, row.path, "ours", ...destArg)
                            .then(onGit)
                            .catch((err) => catchGit(err, "Take ours failed"))
                        }
                      >
                        Take ours
                      </button>
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={() =>
                          void api
                            .workspaceGitConflict(sessionId, row.path, "theirs", ...destArg)
                            .then(onGit)
                            .catch((err) => catchGit(err, "Take theirs failed"))
                        }
                      >
                        Take theirs
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={() =>
                          void api
                            .workspaceGitStage(sessionId, [row.path], row.staged, ...destArg)
                            .then(onGit)
                            .catch((err) => catchGit(err, "Git failed"))
                        }
                      >
                        {row.staged ? "Unstage" : "Stage"}
                      </button>
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={() =>
                          void api
                            .workspaceGitDiscard(sessionId, [row.path], ...destArg)
                            .then(onGit)
                            .catch((err) => catchGit(err, "Discard failed"))
                        }
                      >
                        Discard
                      </button>
                    </>
                  )}
                </div>
                {fileHunks.length ? (
                  <button
                    type="button"
                    className="btn small ghost workspace-git-hunks-toggle"
                    onClick={() => setOpenHunk((cur) => (cur === row.path ? null : row.path))}
                  >
                    {openHunk === row.path
                      ? "Hide hunks"
                      : `${fileHunks.length} hunk${fileHunks.length === 1 ? "" : "s"}`}
                  </button>
                ) : null}
                {openHunk === row.path
                  ? fileHunks.map((hunk, i) => (
                      <div key={`${hunk.header}:${i}`} className="workspace-git-hunk">
                        <pre>
                          {hunk.lines
                            .slice(0, 12)
                            .map(
                              (line) =>
                                `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "} ${line.text}`,
                            )
                            .join("\n")}
                        </pre>
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() =>
                            void api
                              .workspaceGitHunk(sessionId, hunk.patch, hunk.staged, ...destArg)
                              .then((next) => {
                                onGit(next);
                                void refreshHunks();
                              })
                              .catch((err) => catchGit(err, "Hunk failed"))
                          }
                        >
                          {hunk.staged ? "Unstage hunk" : "Stage hunk"}
                        </button>
                      </div>
                    ))
                  : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hint">Working tree clean.</p>
      )}
      <div className="workspace-git-branch-row">
        <button
          type="button"
          className="btn small ghost"
          disabled={!all.length}
          onClick={() =>
            void api
              .workspaceGitStage(sessionId, ["."], false, ...destArg)
              .then(onGit)
              .catch((err) => catchGit(err, "Stage all failed"))
          }
        >
          Stage all
        </button>
        <button
          type="button"
          className="btn small ghost"
          disabled={!git.files.some((row) => row.staged)}
          onClick={() =>
            void api
              .workspaceGitStage(sessionId, ["."], true, ...destArg)
              .then(onGit)
              .catch((err) => catchGit(err, "Unstage all failed"))
          }
        >
          Unstage all
        </button>
      </div>
      {gitMore || rebaseOpen ? (
        <>
          <div className="workspace-git-branch-row" data-testid="workspace-git-stash">
            <button
              type="button"
              className="btn small ghost"
              disabled={!all.length}
              onClick={() =>
                void api
                  .workspaceGitStash(
                    sessionId,
                    "push",
                    commitMsg.trim() || "locus stash",
                    undefined,
                    ...destArg,
                  )
                  .then((next) => {
                    onGit(next);
                    void refreshStash();
                  })
                  .catch((err) => catchGit(err, "Stash failed"))
              }
            >
              Stash
            </button>
            {stashes[0] ? (
              <button
                type="button"
                className="btn small ghost"
                onClick={() =>
                  void api
                    .workspaceGitStash(sessionId, "pop", undefined, undefined, ...destArg)
                    .then((next) => {
                      onGit(next);
                      void refreshStash();
                    })
                    .catch((err) => catchGit(err, "Stash pop failed"))
                }
              >
                Pop
              </button>
            ) : null}
          </div>
          {stashes.length ? (
            <p className="hint workspace-git-stash-meta">
              {stashes.length} stash{stashes.length === 1 ? "" : "es"}
            </p>
          ) : null}
        </>
      ) : null}
      <div className="workspace-git-branch-row">
        {gitMore || rebaseOpen ? (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              setRebaseOpen((open) => !open);
              if (!rebaseOpen && typeof api.workspaceGitRebasePreview === "function") {
                void api.workspaceGitRebasePreview(sessionId, ...destArg).then((preview) => {
                  setTodos(preview.todos);
                  setOnto(preview.onto);
                });
              }
            }}
          >
            Rebase
          </button>
        ) : null}
        <button
          type="button"
          className="btn small ghost"
          disabled={prBusy}
          onClick={() => {
            setPrBusy(true);
            void (async () => {
              try {
                const info =
                  typeof api.workspaceGitPullInfo === "function"
                    ? await api.workspaceGitPullInfo(sessionId, ...destArg)
                    : { pull: null, repoId: null };
                if (info.pull && info.repoId && onOpenPull) {
                  onOpenPull({ repoId: info.repoId, number: info.pull.number });
                  return;
                }
                await api.execTool(sessionId, "git_pr", {
                  title: commitMsg.trim() || git.branch || "Locus changes",
                  ...(guestPath ? { path: guestPath } : {}),
                });
              } catch (err) {
                catchGit(err, "Open pull request needs approval");
              } finally {
                setPrBusy(false);
              }
            })();
          }}
        >
          {prBusy ? "Opening…" : "Open PR"}
        </button>
      </div>
      {rebaseOpen ? (
        <div className="workspace-git-rebase" data-testid="workspace-git-rebase">
          {git.rebasing ? (
            <div className="workspace-git-actions">
              <button
                type="button"
                className="btn small"
                onClick={() =>
                  void api
                    .workspaceGitRebase(sessionId, { action: "continue", ...destFields })
                    .then(onGit)
                    .catch((err) => catchGit(err, "Continue failed"))
                }
              >
                Continue
              </button>
              <button
                type="button"
                className="btn small ghost"
                onClick={() =>
                  void api
                    .workspaceGitRebase(sessionId, { action: "abort", ...destFields })
                    .then(onGit)
                    .catch((err) => catchGit(err, "Abort failed"))
                }
              >
                Abort
              </button>
            </div>
          ) : (
            <>
              <p className="hint">onto {onto || "upstream"}</p>
              {todos.map((todo, index) => (
                <div key={todo.sha} className="workspace-git-rebase-row">
                  <select
                    aria-label={`Rebase action ${todo.sha.slice(0, 7)}`}
                    value={todo.action}
                    onChange={(event) => {
                      const action = event.target.value as WorkspaceGitRebaseTodo["action"];
                      setTodos((current) =>
                        current.map((row, i) => (i === index ? { ...row, action } : row)),
                      );
                    }}
                  >
                    <option value="pick">pick</option>
                    <option value="reword">reword</option>
                    <option value="squash">squash</option>
                    <option value="fixup">fixup</option>
                    <option value="drop">drop</option>
                  </select>
                  <span title={todo.sha}>{todo.message}</span>
                </div>
              ))}
              <button
                type="button"
                className="btn small"
                disabled={!todos.length}
                onClick={() =>
                  void api
                    .workspaceGitRebase(sessionId, { onto, todos, ...destFields })
                    .then((next) => {
                      onGit(next);
                      setRebaseOpen(false);
                    })
                    .catch((err) => catchGit(err, "Rebase failed"))
                }
              >
                Start rebase
              </button>
            </>
          )}
        </div>
      ) : null}
      <div className="workspace-git-commit">
        <input
          className="workspace-git-message"
          value={commitMsg}
          placeholder="Commit message"
          aria-label="Commit message"
          onChange={(event) => onCommitMsg(event.target.value)}
        />
        <div className="workspace-git-actions">
          <button
            type="button"
            className="btn small"
            disabled={!commitMsg.trim() || !git.files.some((row) => row.staged)}
            onClick={() =>
              void api
                .workspaceGitCommit(sessionId, commitMsg.trim(), ...destArg)
                .then((next) => {
                  onGit(next);
                  onCommitMsg("");
                })
                .catch((err) => catchGit(err, "Commit failed"))
            }
          >
            Commit
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={() =>
              void api
                .execTool(sessionId, "git_push", guestPath ? { path: guestPath } : {})
                .catch((err) => catchGit(err, "Push needs approval"))
            }
          >
            Push
          </button>
        </div>
      </div>
    </div>
  );
}
