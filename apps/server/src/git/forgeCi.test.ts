import { describe, expect, it } from "vitest";
import type { GitForgeAccount } from "@locus/shared";
import { ForgeClient } from "./forge.js";
import { githubCheckRunStatus, readTextTail } from "./forgeCi.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

function account(kind: GitForgeAccount["kind"], apiBaseUrl: string): GitForgeAccount {
  return { id: kind, kind, name: kind, apiBaseUrl, token: `${kind}-token` };
}

type Call = { url: string; init?: RequestInit };

function client(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  };
  return { forge: new ForgeClient(fetchFn), calls };
}

const VITEST_LOG = [
  "2026-11-14T10:00:00.0000000Z ##[group]Run npm test",
  "2026-11-14T10:00:01.0000000Z  FAIL  src/cart.test.ts > cart > applies discount",
  "2026-11-14T10:00:01.0000000Z AssertionError: expected 90 to be 80",
  "2026-11-14T10:00:02.0000000Z ##[error]Process completed with exit code 1.",
].join("\n");

describe("GitHub CI report", () => {
  const gh = account("github", "https://api.github.com");

  it("lists failing check runs and statuses and follows the Actions log redirect without the token", async () => {
    const { forge, calls } = client((url, init) => {
      if (
        url ===
        "https://api.github.com/repos/acme/app/commits/sha1/check-runs?filter=latest&per_page=100"
      ) {
        return json({
          check_runs: [
            {
              id: 11,
              name: "test",
              status: "completed",
              conclusion: "failure",
              app: { slug: "github-actions" },
              html_url: "https://github.com/acme/app/runs/11",
            },
            {
              id: 12,
              name: "lint",
              status: "completed",
              conclusion: "success",
              app: { slug: "github-actions" },
            },
            {
              id: 13,
              name: "e2e",
              status: "in_progress",
              conclusion: null,
              app: { slug: "github-actions" },
            },
            {
              id: 14,
              name: "codecov/patch",
              status: "completed",
              conclusion: "failure",
              app: { slug: "codecov" },
              output: { title: "60% of diff hit", summary: "Coverage dropped" },
            },
          ],
        });
      }
      if (url === "https://api.github.com/repos/acme/app/commits/sha1/status") {
        return json({
          statuses: [
            {
              context: "ci/circleci",
              state: "error",
              target_url: "https://circleci.com/x",
              description: "Build errored",
            },
          ],
        });
      }
      if (url === "https://api.github.com/repos/acme/app/actions/jobs/11/logs") {
        expect(init?.redirect).toBe("manual");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer github-token");
        return new Response(null, {
          status: 302,
          headers: { location: "https://pipelines.actions.githubusercontent.com/blob/11?sig=x" },
        });
      }
      if (url.startsWith("https://pipelines.actions.githubusercontent.com/blob/11")) {
        expect(new Headers(init?.headers).get("authorization")).toBeNull();
        return text(VITEST_LOG);
      }
      if (url === "https://api.github.com/repos/acme/app/check-runs/14") {
        return json({
          id: 14,
          name: "codecov/patch",
          output: {
            title: "60% of diff hit",
            summary: "Coverage dropped",
            text: "src/cart.ts not covered",
          },
        });
      }
      if (url === "https://api.github.com/repos/acme/app/check-runs/14/annotations?per_page=50") {
        return json([
          {
            path: "src/cart.ts",
            start_line: 12,
            annotation_level: "warning",
            message: "Line not covered",
          },
        ]);
      }
      return json({ message: "not found" }, 404);
    });

    const report = await forge.ciReport(gh, "acme", "app", {
      number: 7,
      headSha: "sha1",
      checks: [],
    });
    expect(report.headSha).toBe("sha1");
    expect(report.pending).toEqual(["e2e"]);
    expect(report.failures.map((row) => [row.name, row.source, row.status])).toEqual([
      ["test", "actions", "failure"],
      ["codecov/patch", "check_run", "failure"],
      ["ci/circleci", "status", "error"],
    ]);
    const test = report.failures[0]!;
    expect(test.log?.text).toContain("AssertionError: expected 90 to be 80");
    expect(test.log?.failingTests).toEqual(["src/cart.test.ts > cart > applies discount"]);
    expect(test.log?.exitCode).toBe(1);
    const codecov = report.failures[1]!;
    expect(codecov.log?.text).toContain("src/cart.ts not covered");
    expect(codecov.log?.text).toContain("src/cart.ts:12: warning: Line not covered");
    const status = report.failures[2]!;
    expect(status.log).toBeUndefined();
    expect(status.summary).toBe("Build errored");
    expect(status.note).toMatch(/not available/i);
    expect(calls.some((call) => call.url.includes("/actions/jobs/12/logs"))).toBe(false);
  });

  it("falls back to check output when the Actions log is gone, and filters by check name", async () => {
    const { forge } = client((url) => {
      if (url.includes("/check-runs?filter=latest")) {
        return json({
          check_runs: [
            {
              id: 21,
              name: "build (ubuntu)",
              status: "completed",
              conclusion: "failure",
              app: { slug: "github-actions" },
            },
            {
              id: 22,
              name: "test (ubuntu)",
              status: "completed",
              conclusion: "timed_out",
              app: { slug: "github-actions" },
            },
          ],
        });
      }
      if (url.endsWith("/commits/sha2/status")) return json({ statuses: [] });
      if (url.endsWith("/actions/jobs/22/logs")) return json({ message: "gone" }, 410);
      if (url.endsWith("/check-runs/22")) {
        return json({
          id: 22,
          output: { title: "Timed out", summary: "The job exceeded 60 minutes" },
        });
      }
      if (url.includes("/check-runs/22/annotations")) {
        return json([
          {
            annotation_level: "failure",
            message: "The job running on runner X has exceeded the maximum execution time",
          },
        ]);
      }
      return json({}, 404);
    });
    const report = await forge.ciReport(gh, "acme", "app", {
      number: 7,
      headSha: "sha2",
      checks: [],
      check: "TEST",
    });
    expect(report.failures).toHaveLength(1);
    const row = report.failures[0]!;
    expect(row.name).toBe("test (ubuntu)");
    expect(row.note).toMatch(/expired or not found/);
    expect(row.log?.text).toContain("exceeded the maximum execution time");
  });

  it("reads the head SHA from the pull when it is not given", async () => {
    const { forge, calls } = client((url) => {
      if (url.includes("/pulls?") || url.includes("/graphql")) return json([]);
      if (url.endsWith("/pulls/9"))
        return json({
          number: 9,
          title: "x",
          head: { ref: "f", sha: "sha9" },
          base: { ref: "main" },
          state: "open",
        });
      if (url.includes("/check-runs?filter=latest")) return json({ check_runs: [] });
      if (url.endsWith("/status")) return json({ statuses: [{ context: "ci", state: "failure" }] });
      return json([]);
    });
    const report = await forge.ciReport(gh, "acme", "app", { number: 9 });
    expect(report.headSha).toBe("sha9");
    expect(report.failures.map((row) => row.name)).toEqual(["ci"]);
    expect(calls.some((call) => call.url.includes("/commits/sha9/check-runs"))).toBe(true);
  });

  it("maps check-run conclusions", () => {
    expect(githubCheckRunStatus("queued", null)).toBe("queued");
    expect(githubCheckRunStatus("completed", "action_required")).toBe("failure");
    expect(githubCheckRunStatus("completed", "skipped")).toBe("neutral");
    expect(githubCheckRunStatus("completed", "cancelled")).toBe("cancelled");
  });
});

describe("GitLab CI report", () => {
  it("reads the head pipeline's jobs and the failing job trace", async () => {
    const gl = account("gitlab", "https://gitlab.example.com/api/v4");
    const { forge, calls } = client((url, init) => {
      expect(new Headers(init?.headers).get("private-token")).toBe("gitlab-token");
      if (
        url ===
        "https://gitlab.example.com/api/v4/projects/group%2Fsub%2Fsvc/merge_requests/3/pipelines"
      ) {
        return json([
          { id: 900, sha: "new", status: "failed" },
          { id: 800, sha: "old", status: "success" },
        ]);
      }
      if (
        url ===
        "https://gitlab.example.com/api/v4/projects/group%2Fsub%2Fsvc/pipelines/900/jobs?per_page=100"
      ) {
        return json([
          {
            id: 1,
            name: "pytest",
            stage: "test",
            status: "failed",
            failure_reason: "script_failure",
            web_url: "https://gitlab/j/1",
          },
          { id: 2, name: "lint", stage: "test", status: "failed", allow_failure: true },
          { id: 3, name: "build", stage: "build", status: "success" },
          { id: 4, name: "deploy", stage: "deploy", status: "created" },
        ]);
      }
      if (url === "https://gitlab.example.com/api/v4/projects/group%2Fsub%2Fsvc/jobs/1/trace") {
        return text(
          "section_start:1:step_script\r\u001b[0KRunning pytest\nFAILED tests/test_api.py::test_create_user - assert 500 == 201\nERROR: Job failed: exit code 1\n",
        );
      }
      return json({}, 404);
    });
    const report = await forge.ciReport(gl, "group/sub", "svc", {
      number: 3,
      headSha: "new",
      checks: [],
    });
    expect(report.failures.map((row) => row.name)).toEqual(["pytest"]);
    expect(report.pending).toEqual(["deploy"]);
    const row = report.failures[0]!;
    expect(row).toMatchObject({
      source: "gitlab_job",
      stage: "test",
      summary: "failure_reason: script_failure",
    });
    expect(row.log?.failingTests).toEqual(["tests/test_api.py::test_create_user"]);
    expect(row.log?.text).not.toContain("section_start");
    expect(calls.filter((call) => call.url.endsWith("/trace"))).toHaveLength(1);
  });
});

describe("Forges without job logs", () => {
  it("lists check names and status with a logs-not-available note", async () => {
    const bb = account("bitbucket", "https://api.bitbucket.org/2.0");
    const { forge, calls } = client(() => json({}, 500));
    const report = await forge.ciReport(bb, "team", "repo", {
      number: 4,
      headSha: "abc",
      checks: [
        { name: "Pipeline #12", status: "failure", url: "https://bitbucket.org/x" },
        { name: "Sonar", status: "success" },
      ],
    });
    expect(calls).toHaveLength(0);
    expect(report.failures).toEqual([
      expect.objectContaining({
        name: "Pipeline #12",
        source: "other",
        note: expect.stringMatching(/Logs not available on Bitbucket/),
      }),
    ]);
  });
});

describe("readTextTail", () => {
  it("keeps the head and the tail of a long body", async () => {
    const body = `${"h".repeat(70 * 1024)}${"m".repeat(200 * 1024)}END`;
    const out = await readTextTail(new Response(body), 100 * 1024);
    expect(out.startsWith("hhhh")).toBe(true);
    expect(out.endsWith("END")).toBe(true);
    expect(out).toMatch(/bytes of log omitted/);
    expect(out.length).toBeLessThan(140 * 1024);
  });
});
