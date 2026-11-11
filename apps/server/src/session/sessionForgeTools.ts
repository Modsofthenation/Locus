import type { ToolResult } from "@locus/guest-agent";
import {
  buildLoadPath,
  formatIssueCard,
  formatIssueComments,
  formatPrCard,
  formatPullComments,
  formatPullFiles,
  isForgeToolName,
  isOwnPullReviewRejected,
  ownPullReviewFallbackNote,
  parseGitIssueGetInclude,
  parseGitPrGetInclude,
  parseIssueListState,
  parsePullListState,
  wrapUntrusted,
  type AgentSession,
  type GitForgeAccount,
  type SessionPull,
} from "@locus/shared";
import type { ForgeClient } from "../git/forge.js";
import type { JsonStore } from "../core/store.js";

export type ForgeReady = { account: GitForgeAccount; owner: string; repo: string };

export type SessionForgeDeps = {
  forge: ForgeClient;
  attachPull: (sessionId: string, pull: SessionPull) => Promise<void>;
  requireForge: (
    session: AgentSession,
    args?: Record<string, unknown>,
  ) => Promise<ForgeReady | ToolResult>;
  resolveGitHeadBranch: (
    session: AgentSession,
    args?: Record<string, unknown>,
  ) => Promise<string | undefined>;
  loadLoadPathNotes: JsonStore["loadLoadPathNotes"];
};

function failed(ready: ForgeReady | ToolResult): ready is ToolResult {
  return "output" in ready;
}

export { isForgeToolName };

const FENCED_FORGE_LISTS = new Set(["git_pr_list", "git_pr_loadpath", "git_issue_list"]);

export async function executeSessionForgeTool(
  deps: SessionForgeDeps,
  session: AgentSession,
  req: { name: string; args: Record<string, unknown> },
  fenceHostile: (name: string, output: string) => string,
): Promise<ToolResult | undefined> {
  if (!isForgeToolName(req.name)) return undefined;
  return executeForgeTool(deps, session, req.name, req.args, fenceHostile);
}

export async function executeForgeTool(
  deps: SessionForgeDeps,
  session: AgentSession,
  name: string,
  args: Record<string, unknown>,
  fenceHostile?: (name: string, output: string) => string,
): Promise<ToolResult> {
  const result = await runForgeTool(deps, session, name, args);
  if (fenceHostile && FENCED_FORGE_LISTS.has(name)) {
    return { ...result, output: fenceHostile(name, result.output) };
  }
  return result;
}

async function runForgeTool(
  deps: SessionForgeDeps,
  session: AgentSession,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "git_pr":
      return openPullRequest(deps, session, args);
    case "git_pr_review":
      return reviewPullRequest(deps, session, args);
    case "git_pr_list":
      return listPullRequests(deps, session, args);
    case "git_pr_get":
      return getPullRequestTool(deps, session, args);
    case "git_pr_loadpath":
      return loadPathPullRequest(deps, session, args);
    case "git_pr_comment":
      return commentPullRequest(deps, session, args);
    case "git_pr_checks":
      return checksPullRequest(deps, session, args);
    case "git_pr_merge":
      return mergePullRequest(deps, session, args);
    case "git_issue_list":
      return listIssues(deps, session, args);
    case "git_issue_get":
      return getIssueTool(deps, session, args);
    case "git_issue_comment":
      return commentIssue(deps, session, args);
    default:
      return { ok: false, output: `Unknown forge tool ${name}` };
  }
}

async function openPullRequest(
  deps: SessionForgeDeps,
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const ready = await deps.requireForge(session, args);
  if (failed(ready)) return ready;
  const { account, owner, repo } = ready;
  const title = typeof args.title === "string" ? args.title : "Locus changes";
  const body = typeof args.body === "string" ? args.body : "";
  const head = (await deps.resolveGitHeadBranch(session, args))?.trim() ?? "";
  if (!head || head === "HEAD") {
    return {
      ok: false,
      output: "Could not determine the current branch. Create a named branch before opening a PR.",
    };
  }
  const base =
    typeof args.base === "string" && args.base.trim()
      ? args.base.trim()
      : session.repo?.ref || "main";
  try {
    const created = await deps.forge.createPull(account, owner, repo, {
      title,
      body,
      head,
      base,
      draft: args.draft === true,
    });
    await deps.attachPull(session.id, {
      number: created.number,
      url: created.url,
      title: created.title,
      state: created.state === "draft" ? "draft" : "open",
      headRef: head,
      baseRef: base,
    });
    return { ok: true, output: formatPrCard(created) };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "PR failed" };
  }
}

async function reviewPullRequest(
  deps: SessionForgeDeps,
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const ready = await deps.requireForge(session, args);
  if (failed(ready)) return ready;
  const body = typeof args.body === "string" ? args.body.trim() : "";
  if (!body) return { ok: false, output: "body is required" };
  const event =
    args.event === "APPROVE" || args.event === "REQUEST_CHANGES" ? args.event : "COMMENT";
  const number = await pullNumberArg(deps, session, ready, args);
  if (!number) return { ok: false, output: "Could not find an open pull request for this branch" };
  try {
    const posted = await deps.forge.postReview(ready.account, ready.owner, ready.repo, number, {
      body,
      event,
    });
    if (posted.ok || event === "COMMENT" || !isOwnPullReviewRejected(posted.output)) {
      return posted;
    }
    const note = ownPullReviewFallbackNote(event);
    const fallback = await deps.forge.postReview(ready.account, ready.owner, ready.repo, number, {
      body: `${note}\n\n${body}`,
      event: "COMMENT",
    });
    if (!fallback.ok) return posted;
    return { ok: true, output: `${fallback.output}\n\n${note}` };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "Review failed" };
  }
}

async function listPullRequests(
  deps: SessionForgeDeps,
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const ready = await deps.requireForge(session, args);
  if (failed(ready)) return ready;
  const state = parsePullListState(args.state);
  try {
    const rows = await deps.forge.listPulls(ready.account, ready.owner, ready.repo, state);
    if (!rows.length) return { ok: true, output: "No pull requests" };
    return {
      ok: true,
      output: rows
        .map(
          (row) =>
            `#${row.number} ${row.title} (${row.state}) ${row.headRef} → ${row.baseRef}\n${row.url}`,
        )
        .join("\n\n"),
    };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "List failed" };
  }
}

async function getPullRequestTool(
  deps: SessionForgeDeps,
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const ready = await deps.requireForge(session, args);
  if (failed(ready)) return ready;
  const number = await pullNumberArg(deps, session, ready, args);
  if (!number) return { ok: false, output: "Could not find an open pull request for this branch" };
  try {
    const pull = await deps.forge.getPull(ready.account, ready.owner, ready.repo, number);
    const include = parseGitPrGetInclude(args.include);
    const want = (section: "summary" | "files" | "comments" | "checks") =>
      !include || include.includes(section);
    const paths = Array.isArray(args.paths)
      ? args.paths.filter(
          (item): item is string => typeof item === "string" && Boolean(item.trim()),
        )
      : typeof args.paths === "string" && args.paths.trim()
        ? [args.paths.trim()]
        : undefined;
    const stored =
      want("files") && session.repoId
        ? await deps.loadLoadPathNotes(session.repoId, number)
        : undefined;
    const priority =
      want("files") && !paths?.length
        ? buildLoadPath(pull.files, {
            notes: stored?.notes,
            notesUpdatedAt: stored?.updatedAt,
          }).readOrder.map((row) => row.path)
        : undefined;
    const files = want("files") ? formatPullFiles(pull.files, paths, { priority }) : undefined;
    const checks = want("checks")
      ? pull.checks.map((check) => `${check.name}: ${check.status}`).join("\n") || "(no checks)"
      : undefined;
    const comments = want("comments") ? formatPullComments(pull.comments) : undefined;
    const summary = want("summary")
      ? [
          formatPrCard({
            number: pull.number,
            title: pull.title,
            url: pull.url,
            state: pull.state,
          }),
          `${pull.headRef} → ${pull.baseRef} (${pull.headSha.slice(0, 8)})`,
          wrapUntrusted({
            kind: "pr-text",
            source: "body",
            text: pull.body?.trim() || "(no body)",
          }),
        ]
      : [];
    return {
      ok: true,
      output: [
        ...summary,
        files ? `Files:\n${files}` : undefined,
        checks ? `Checks:\n${checks}` : undefined,
        comments ? `Comments:\n${comments}` : undefined,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "Get PR failed" };
  }
}

async function loadPathPullRequest(
  deps: SessionForgeDeps,
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const ready = await deps.requireForge(session, args);
  if (failed(ready)) return ready;
  const number = await pullNumberArg(deps, session, ready, args);
  if (!number) return { ok: false, output: "Could not find an open pull request for this branch" };
  try {
    const pull = await deps.forge.getPull(ready.account, ready.owner, ready.repo, number);
    const stored = session.repoId
      ? await deps.loadLoadPathNotes(session.repoId, number)
      : undefined;
    const review = buildLoadPath(pull.files, {
      notes: stored?.notes,
      notesUpdatedAt: stored?.updatedAt,
    });
    return { ok: true, output: review.markdown };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "Load path failed" };
  }
}

async function commentPullRequest(
  deps: SessionForgeDeps,
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const ready = await deps.requireForge(session, args);
  if (failed(ready)) return ready;
  const body = typeof args.body === "string" ? args.body.trim() : "";
  if (!body) return { ok: false, output: "body is required" };
  const number = await pullNumberArg(deps, session, ready, args);
  if (!number) return { ok: false, output: "Could not find an open pull request for this branch" };
  try {
    return await deps.forge.postComment(ready.account, ready.owner, ready.repo, number, {
      body,
      path: typeof args.path === "string" ? args.path : undefined,
      line: typeof args.line === "number" ? args.line : Number(args.line) || undefined,
      side: args.side === "LEFT" || args.side === "RIGHT" ? args.side : undefined,
    });
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "Comment failed" };
  }
}

async function checksPullRequest(
  deps: SessionForgeDeps,
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const ready = await deps.requireForge(session, args);
  if (failed(ready)) return ready;
  const number = await pullNumberArg(deps, session, ready, args);
  if (!number) return { ok: false, output: "Could not find an open pull request for this branch" };
  try {
    const pull = await deps.forge.getPull(ready.account, ready.owner, ready.repo, number);
    if (!pull.checks.length) return { ok: true, output: "No checks" };
    return {
      ok: true,
      output: pull.checks
        .map((check) => `${check.name}: ${check.status}${check.url ? ` ${check.url}` : ""}`)
        .join("\n"),
    };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "Checks failed" };
  }
}

async function mergePullRequest(
  deps: SessionForgeDeps,
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const ready = await deps.requireForge(session, args);
  if (failed(ready)) return ready;
  const number = await pullNumberArg(deps, session, ready, args);
  if (!number) return { ok: false, output: "Could not find an open pull request for this branch" };
  try {
    return await deps.forge.merge(ready.account, ready.owner, ready.repo, number);
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "Merge failed" };
  }
}

async function listIssues(
  deps: SessionForgeDeps,
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const ready = await deps.requireForge(session, args);
  if (failed(ready)) return ready;
  const state = parseIssueListState(args.state);
  try {
    const rows = await deps.forge.listIssues(ready.account, ready.owner, ready.repo, state);
    if (!rows.length) return { ok: true, output: "No issues" };
    return {
      ok: true,
      output: rows
        .map((row) => {
          const labels = row.labels?.length ? ` [${row.labels.join(", ")}]` : "";
          return `#${row.number} ${row.title} (${row.state})${labels}\n${row.url}`;
        })
        .join("\n\n"),
    };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "List failed" };
  }
}

async function getIssueTool(
  deps: SessionForgeDeps,
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const ready = await deps.requireForge(session, args);
  if (failed(ready)) return ready;
  const number = issueNumberArg(args);
  if (!number) return { ok: false, output: "issue_number is required" };
  try {
    const issue = await deps.forge.getIssue(ready.account, ready.owner, ready.repo, number);
    const include = parseGitIssueGetInclude(args.include);
    const want = (section: "summary" | "comments") => !include || include.includes(section);
    const labels = issue.labels?.length ? `Labels: ${issue.labels.join(", ")}` : undefined;
    const comments = want("comments") ? formatIssueComments(issue.comments) : undefined;
    const summary = want("summary")
      ? [
          formatIssueCard({
            number: issue.number,
            title: issue.title,
            url: issue.url,
            state: issue.state,
          }),
          labels,
          wrapUntrusted({
            kind: "issue-text",
            source: "body",
            text: issue.body?.trim() || "(no body)",
          }),
        ]
      : [];
    return {
      ok: true,
      output: [...summary, comments ? `Comments:\n${comments}` : undefined]
        .filter(Boolean)
        .join("\n\n"),
    };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "Get issue failed" };
  }
}

async function commentIssue(
  deps: SessionForgeDeps,
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const ready = await deps.requireForge(session, args);
  if (failed(ready)) return ready;
  const body = typeof args.body === "string" ? args.body.trim() : "";
  if (!body) return { ok: false, output: "body is required" };
  const number = issueNumberArg(args);
  if (!number) return { ok: false, output: "issue_number is required" };
  try {
    return await deps.forge.postIssueComment(ready.account, ready.owner, ready.repo, number, {
      body,
    });
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : "Comment failed" };
  }
}

function issueNumberArg(args: Record<string, unknown>): number | undefined {
  const raw = args.issue_number ?? args.number;
  const number = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(number) || number <= 0) return undefined;
  return number;
}

async function pullNumberArg(
  deps: SessionForgeDeps,
  session: AgentSession,
  ready: ForgeReady,
  args: Record<string, unknown>,
): Promise<number | undefined> {
  const number = typeof args.pull_number === "number" ? args.pull_number : Number(args.pull_number);
  if (Number.isInteger(number) && number > 0) return number;
  if (session.pull?.number) return session.pull.number;
  const head = session.compare?.branch;
  return deps.forge.lookupPullNumber(ready.account, ready.owner, ready.repo, head);
}
