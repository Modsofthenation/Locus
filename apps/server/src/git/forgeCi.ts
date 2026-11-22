/**
 * CI checks and job logs for a pull request head, per forge.
 *
 * GitHub: check-runs (+ legacy commit statuses). Actions jobs read `/actions/jobs/{id}/logs`
 * (302 to a signed blob URL, fetched without the token); other check runs fall back to their
 * output text and annotations. GitLab: the head pipeline's jobs and `/jobs/{id}/trace`.
 * Other forges list check names/status from the pull and say logs are not available.
 */
import {
  CI_LOG_DEFAULT_MAX_CHARS,
  CI_LOG_FETCH_MAX_BYTES,
  condenseCiLog,
  forgeLabel,
  isFailingCheckStatus,
  type CiCheckRun,
  type CiFailure,
  type CiFailureReport,
  type GitForgeAccount,
  type PullCheck,
} from "@locus/shared";
import {
  apiRoot,
  forgeJson,
  giteaAuthHeaders,
  githubAuthHeaders,
  gitlabAuthHeaders,
  gitlabProject,
  type ForgeFetcher,
} from "./forgeHttp.js";

export interface CheckLog {
  text?: string;
  note?: string;
}

// ---------------------------------------------------------------------------------------------
// Raw text with a byte cap that keeps the head and the (more useful) tail.

const HEAD_BYTES = 64 * 1024;

export async function readTextTail(
  res: Response,
  maxBytes = CI_LOG_FETCH_MAX_BYTES,
): Promise<string> {
  const body = res.body;
  if (!body) return (await res.text()).slice(-maxBytes);
  const reader = body.getReader();
  const head: Uint8Array[] = [];
  let headBytes = 0;
  const tail: Uint8Array[] = [];
  let tailBytes = 0;
  let dropped = 0;
  const tailCap = Math.max(1024, maxBytes - HEAD_BYTES);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    let chunk = value;
    if (headBytes < HEAD_BYTES) {
      const take = chunk.subarray(0, HEAD_BYTES - headBytes);
      head.push(take);
      headBytes += take.length;
      chunk = chunk.subarray(take.length);
      if (!chunk.length) continue;
    }
    tail.push(chunk);
    tailBytes += chunk.length;
    while (tailBytes > tailCap && tail.length) {
      const first = tail[0]!;
      const excess = tailBytes - tailCap;
      if (first.length <= excess) {
        tail.shift();
        tailBytes -= first.length;
        dropped += first.length;
      } else {
        tail[0] = first.subarray(excess);
        tailBytes -= excess;
        dropped += excess;
      }
    }
  }
  const decoder = new TextDecoder();
  const headText = head.map((chunk) => decoder.decode(chunk, { stream: true })).join("");
  const tailText = new TextDecoder().decode(concat(tail));
  return dropped
    ? `${headText}\n… ${dropped} bytes of log omitted …\n${tailText}`
    : headText + tailText;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// GitHub (and Gitea/Forgejo, which only have commit statuses)

interface GithubCheckRunRow {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  details_url?: string;
  app?: { slug?: string } | null;
  output?: { title?: string | null; summary?: string | null; text?: string | null } | null;
}

function githubCompatible(account: GitForgeAccount): boolean {
  return account.kind === "gitea" || account.kind === "forgejo";
}

function ghHeaders(account: GitForgeAccount) {
  return githubCompatible(account) ? giteaAuthHeaders : githubAuthHeaders;
}

export function githubCheckRunStatus(
  status?: string,
  conclusion?: string | null,
): PullCheck["status"] {
  if (status && status !== "completed") return status === "queued" ? "queued" : "in_progress";
  switch (conclusion) {
    case "success":
      return "success";
    case "failure":
    case "timed_out":
    case "action_required":
    case "startup_failure":
      return "failure";
    case "cancelled":
      return "cancelled";
    default:
      return "neutral";
  }
}

function githubStatusState(state?: string): PullCheck["status"] {
  if (state === "success") return "success";
  if (state === "failure") return "failure";
  if (state === "error") return "error";
  if (state === "pending") return "in_progress";
  return "neutral";
}

function checkRunSummary(row: GithubCheckRunRow): string | undefined {
  const parts = [row.output?.title, row.output?.summary]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length ? parts.join("\n").slice(0, 2_000) : undefined;
}

export async function listGithubCheckRuns(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  headSha: string,
): Promise<CiCheckRun[]> {
  if (!headSha) return [];
  const headers = ghHeaders(account);
  const [runs, statuses] = await Promise.all([
    githubCompatible(account)
      ? Promise.resolve(undefined)
      : forgeJson<{ check_runs?: GithubCheckRunRow[] }>(
          fetchFn,
          account,
          `/repos/${owner}/${repo}/commits/${headSha}/check-runs?filter=latest&per_page=100`,
          undefined,
          headers,
        ).catch(() => undefined),
    forgeJson<{
      statuses?: Array<{
        context?: string;
        state?: string;
        target_url?: string;
        description?: string;
      }>;
    }>(
      fetchFn,
      account,
      `/repos/${owner}/${repo}/commits/${headSha}/status`,
      undefined,
      headers,
    ).catch(() => undefined),
  ]);
  const out: CiCheckRun[] = [];
  for (const row of runs?.ok ? (runs.json.check_runs ?? []) : []) {
    if (!row.name) continue;
    const actions = row.app?.slug === "github-actions";
    const hasOutput = Boolean(row.output?.text?.trim() || row.output?.summary?.trim());
    out.push({
      ...(row.id !== undefined ? { id: String(row.id) } : {}),
      name: row.name,
      status: githubCheckRunStatus(row.status, row.conclusion),
      url: row.html_url || row.details_url,
      source: actions ? "actions" : "check_run",
      summary: checkRunSummary(row),
      logAvailable: actions || hasOutput || row.id !== undefined,
    });
  }
  const seen = new Set(out.map((row) => row.name));
  for (const row of statuses?.ok ? (statuses.json.statuses ?? []) : []) {
    const name = row.context || "status";
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      status: githubStatusState(row.state),
      url: row.target_url,
      source: "status",
      summary: row.description?.trim() || undefined,
      logAvailable: false,
    });
  }
  return out;
}

async function githubAnnotations(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  id: string,
): Promise<string[]> {
  const res = await forgeJson<
    Array<{
      path?: string;
      start_line?: number;
      annotation_level?: string;
      message?: string;
      title?: string;
    }>
  >(
    fetchFn,
    account,
    `/repos/${owner}/${repo}/check-runs/${id}/annotations?per_page=50`,
    undefined,
    githubAuthHeaders,
  ).catch(() => undefined);
  if (!res?.ok || !Array.isArray(res.json)) return [];
  return res.json.map((row) => {
    const where = row.path ? `${row.path}${row.start_line ? `:${row.start_line}` : ""}: ` : "";
    const level = row.annotation_level === "failure" ? "error" : (row.annotation_level ?? "notice");
    return `${where}${level}: ${[row.title, row.message].filter(Boolean).join(" — ")}`;
  });
}

async function githubCheckOutput(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  run: CiCheckRun,
): Promise<string | undefined> {
  if (!run.id) return run.summary;
  const detail = await forgeJson<GithubCheckRunRow>(
    fetchFn,
    account,
    `/repos/${owner}/${repo}/check-runs/${run.id}`,
    undefined,
    githubAuthHeaders,
  ).catch(() => undefined);
  const annotations = await githubAnnotations(fetchFn, account, owner, repo, run.id);
  const parts = [
    detail?.ok ? checkRunSummary(detail.json) : run.summary,
    detail?.ok ? detail.json.output?.text?.trim() : undefined,
    annotations.length ? `Annotations:\n${annotations.join("\n")}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join("\n\n") : undefined;
}

export async function fetchGithubCheckLog(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  run: CiCheckRun,
  maxBytes = CI_LOG_FETCH_MAX_BYTES,
): Promise<CheckLog> {
  if (run.source === "status") {
    return { note: "Logs not available for commit statuses; open the check URL." };
  }
  let jobNote: string | undefined;
  if (run.source === "actions" && run.id) {
    try {
      const res = await fetchFn(
        `${apiRoot(account)}/repos/${owner}/${repo}/actions/jobs/${run.id}/logs`,
        {
          headers: githubAuthHeaders(account),
          redirect: "manual",
        },
      );
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        // Signed blob URL: do not forward the token to another host.
        const blob = await fetchFn(location, { redirect: "follow" });
        if (blob.ok) return { text: await readTextTail(blob, maxBytes) };
        jobNote = `Job log download failed (HTTP ${blob.status}).`;
      } else if (res.ok) {
        return { text: await readTextTail(res, maxBytes) };
      } else {
        jobNote =
          res.status === 404 || res.status === 410
            ? "Job log expired or not found."
            : res.status === 403
              ? "Job log needs a token with Actions read access."
              : `Job log request failed (HTTP ${res.status}).`;
      }
    } catch (err) {
      jobNote = `Job log request failed (${err instanceof Error ? err.message : String(err)}).`;
    }
  }
  const output = await githubCheckOutput(fetchFn, account, owner, repo, run);
  if (output) {
    return {
      text: output,
      note: jobNote ? `${jobNote} Showing the check output and annotations instead.` : undefined,
    };
  }
  return { note: jobNote ?? "This check has no log or output text." };
}

// ---------------------------------------------------------------------------------------------
// GitLab

function gitlabJobStatus(status?: string): PullCheck["status"] {
  switch (status) {
    case "success":
      return "success";
    case "failed":
      return "failure";
    case "canceled":
      return "cancelled";
    case "running":
      return "in_progress";
    case "created":
    case "pending":
    case "waiting_for_resource":
    case "preparing":
    case "scheduled":
      return "queued";
    default:
      return "neutral";
  }
}

export async function listGitlabCheckRuns(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  input: { number: number; headSha: string },
): Promise<CiCheckRun[]> {
  const id = gitlabProject(owner, repo);
  const pipelines = await forgeJson<
    Array<{ id?: number; sha?: string; status?: string; web_url?: string }>
  >(
    fetchFn,
    account,
    `/projects/${id}/merge_requests/${input.number}/pipelines`,
    undefined,
    gitlabAuthHeaders,
  );
  const list = pipelines.ok && Array.isArray(pipelines.json) ? pipelines.json : [];
  const pipeline =
    (input.headSha ? list.find((row) => row.sha === input.headSha) : undefined) ?? list[0];
  if (!pipeline?.id) return [];
  const jobs = await forgeJson<
    Array<{
      id?: number;
      name?: string;
      stage?: string;
      status?: string;
      web_url?: string;
      failure_reason?: string;
      allow_failure?: boolean;
    }>
  >(
    fetchFn,
    account,
    `/projects/${id}/pipelines/${pipeline.id}/jobs?per_page=100`,
    undefined,
    gitlabAuthHeaders,
  );
  if (!jobs.ok || !Array.isArray(jobs.json)) {
    return [
      {
        id: String(pipeline.id),
        name: "pipeline",
        status: gitlabJobStatus(pipeline.status === "failed" ? "failed" : pipeline.status),
        url: pipeline.web_url,
        source: "pipeline",
        logAvailable: false,
      },
    ];
  }
  return jobs.json.flatMap((row): CiCheckRun[] => {
    if (!row.name || row.id === undefined) return [];
    // An allowed failure does not fail the pipeline.
    const status =
      row.allow_failure && row.status === "failed" ? "neutral" : gitlabJobStatus(row.status);
    return [
      {
        id: String(row.id),
        name: row.name,
        status,
        url: row.web_url,
        source: "gitlab_job",
        stage: row.stage,
        summary: row.failure_reason ? `failure_reason: ${row.failure_reason}` : undefined,
        logAvailable: true,
      },
    ];
  });
}

export async function fetchGitlabCheckLog(
  fetchFn: ForgeFetcher,
  account: GitForgeAccount,
  owner: string,
  repo: string,
  run: CiCheckRun,
  maxBytes = CI_LOG_FETCH_MAX_BYTES,
): Promise<CheckLog> {
  if (run.source !== "gitlab_job" || !run.id) return { note: "Logs not available for this check." };
  try {
    const res = await fetchFn(
      `${apiRoot(account)}/projects/${gitlabProject(owner, repo)}/jobs/${run.id}/trace`,
      { headers: gitlabAuthHeaders(account) },
    );
    if (!res.ok) return { note: `Job trace request failed (HTTP ${res.status}).` };
    return { text: await readTextTail(res, maxBytes) };
  } catch (err) {
    return {
      note: `Job trace request failed (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Report

export interface CiReportInput {
  headSha: string;
  /** Checks from the pull (fallback for forges without check listing). */
  checks: PullCheck[];
  /** Case-insensitive substring filter on the check name. */
  check?: string;
  /** Total condensed-log budget across failing checks. */
  maxChars?: number;
  /** Most logs to fetch (the rest list name and status). Default 4. */
  maxLogs?: number;
}

export interface CiReportSource {
  kind: GitForgeAccount["kind"];
  listCheckRuns?: (headSha: string) => Promise<CiCheckRun[]>;
  fetchCheckLog?: (run: CiCheckRun) => Promise<CheckLog>;
}

export function checksAsRuns(checks: PullCheck[]): CiCheckRun[] {
  return checks.map((row) => ({
    name: row.name,
    status: row.status,
    url: row.url,
    source: "other" as const,
    logAvailable: false,
  }));
}

/** Failing checks for a head with condensed logs. Never throws for a missing log. */
export async function buildCiReport(
  source: CiReportSource,
  input: CiReportInput,
): Promise<CiFailureReport> {
  let runs: CiCheckRun[] = [];
  if (source.listCheckRuns) {
    try {
      runs = await source.listCheckRuns(input.headSha);
    } catch {
      runs = [];
    }
  }
  if (!runs.length) runs = checksAsRuns(input.checks);
  const wanted = input.check?.trim().toLowerCase();
  const scoped = wanted ? runs.filter((row) => row.name.toLowerCase().includes(wanted)) : runs;
  const failing = scoped.filter((row) => isFailingCheckStatus(row.status));
  const pending = scoped
    .filter((row) => row.status === "queued" || row.status === "in_progress")
    .map((row) => row.name);
  const maxLogs = Math.max(1, input.maxLogs ?? 4);
  const total = input.maxChars ?? CI_LOG_DEFAULT_MAX_CHARS;
  const withLogs = Math.min(failing.length, maxLogs);
  const perCheck = withLogs <= 1 ? total : Math.max(1_500, Math.floor(total / withLogs));
  const label = forgeLabel(source.kind);
  const failures = await Promise.all(
    failing.map(async (run, index): Promise<CiFailure> => {
      if (index >= maxLogs)
        return {
          ...run,
          note: "Log skipped (too many failing checks); call git_ci_logs with check=<name>.",
        };
      if (!run.logAvailable || !source.fetchCheckLog) {
        return {
          ...run,
          note: source.fetchCheckLog
            ? "Logs not available for this check; open the check URL."
            : `Logs not available on ${label}; open the check URL.`,
        };
      }
      try {
        const got = await source.fetchCheckLog(run);
        if (!got.text?.trim()) return { ...run, note: got.note ?? "Empty log." };
        return {
          ...run,
          log: condenseCiLog(got.text, { maxChars: perCheck }),
          ...(got.note ? { note: got.note } : {}),
        };
      } catch (err) {
        return {
          ...run,
          note: `Log fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }),
  );
  return { headSha: input.headSha, failures, pending };
}
