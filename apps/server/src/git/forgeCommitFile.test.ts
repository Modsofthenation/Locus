import { describe, expect, it } from "vitest";
import type { GitForgeAccount } from "@locus/shared";
import { ForgeClient } from "./forge.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const gh: GitForgeAccount = {
  id: "gh",
  kind: "github",
  name: "GitHub",
  token: "t",
  apiBaseUrl: "https://api.github.com",
};
const gl: GitForgeAccount = {
  id: "gl",
  kind: "gitlab",
  name: "GitLab",
  token: "t",
  apiBaseUrl: "https://gitlab.com/api/v4",
};

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

function client(handler: (call: Call) => Response): { forge: ForgeClient; calls: Call[] } {
  const calls: Call[] = [];
  const forge = new ForgeClient(async (input, init) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(input),
      ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
    };
    calls.push(call);
    return handler(call);
  });
  return { forge, calls };
}

const input = {
  branch: "locus/review-conventions-2026-11-22",
  base: "main",
  path: "REVIEW.md",
  content: "# Review\n",
  message: "Add review conventions learned from dismissals",
};

describe("commitFileToNewBranch", () => {
  it("GitHub: cuts the branch from base and replaces an existing file by its blob sha", async () => {
    const { forge, calls } = client((call) => {
      if (call.url.endsWith("/git/ref/heads/main")) return json({ object: { sha: "base123" } });
      if (call.url.includes("/contents/REVIEW.md?ref=base123")) {
        return json({ type: "file", sha: "blob9" });
      }
      if (call.url.endsWith("/git/refs")) return json({ ref: "x" }, 201);
      if (call.method === "PUT") return json({ content: {} }, 200);
      return json({}, 404);
    });
    await forge.commitFileToNewBranch(gh, "acme", "api", input);
    const ref = calls.find((row) => row.url.endsWith("/git/refs"))!;
    expect(ref.body).toEqual({ ref: `refs/heads/${input.branch}`, sha: "base123" });
    const put = calls.find((row) => row.method === "PUT")!;
    expect(put.url).toBe("https://api.github.com/repos/acme/api/contents/REVIEW.md");
    expect(put.body).toMatchObject({ branch: input.branch, sha: "blob9", message: input.message });
    expect(Buffer.from(String(put.body!.content), "base64").toString("utf8")).toBe("# Review\n");

    // The caller couldn't read a file that exists: stop before creating the branch.
    calls.length = 0;
    await expect(
      forge.commitFileToNewBranch(gh, "acme", "api", { ...input, expectNew: true }),
    ).rejects.toThrow("exists on main");
    expect(calls.some((row) => row.url.endsWith("/git/refs"))).toBe(false);
  });

  it("GitLab: one commit that starts the branch from base, create or update", async () => {
    let exists = false;
    const { forge, calls } = client((call) => {
      if (call.method === "HEAD") return new Response(null, { status: exists ? 200 : 404 });
      if (call.url.endsWith("/repository/commits")) return json({ id: "c1" }, 201);
      return json({}, 404);
    });
    await forge.commitFileToNewBranch(gl, "group/sub", "svc", input);
    const commit = calls.find((row) => row.url.endsWith("/repository/commits"))!;
    expect(commit.url).toBe(
      "https://gitlab.com/api/v4/projects/group%2Fsub%2Fsvc/repository/commits",
    );
    expect(commit.body).toMatchObject({
      branch: input.branch,
      start_branch: "main",
      actions: [{ action: "create", file_path: "REVIEW.md", content: "# Review\n" }],
    });
    exists = true;
    await forge.commitFileToNewBranch(gl, "group/sub", "svc", input);
    expect(calls.at(-1)!.body).toMatchObject({ actions: [{ action: "update" }] });
  });

  it("is not offered on other forges", async () => {
    const { forge } = client(() => json({}));
    await expect(
      forge.commitFileToNewBranch({ ...gh, kind: "bitbucket" }, "acme", "api", input),
    ).rejects.toThrow("not supported on bitbucket");
    await expect(
      forge.commitFileToNewBranch(
        { ...gh, kind: "gitea", apiBaseUrl: "https://git.example/api/v1" },
        "acme",
        "api",
        input,
      ),
    ).rejects.toThrow("not supported on gitea");
  });
});

describe("pull labels", () => {
  it("maps labels on GitHub and GitLab pulls", async () => {
    const { forge } = client((call) => {
      if (call.url.endsWith("/repos/acme/api/pulls/7")) {
        return json({
          number: 7,
          title: "t",
          state: "open",
          head: { ref: "f", sha: "abc" },
          base: { ref: "main" },
          labels: [{ name: "no-review" }, { name: "bug" }],
        });
      }
      if (call.url.endsWith("/merge_requests/3")) {
        return json({ iid: 3, title: "t", state: "opened", labels: ["skip-review"] });
      }
      if (call.url.includes("graphql")) return json({ data: {} });
      return json(call.url.includes("/status") || call.url.includes("check-runs") ? {} : []);
    });
    expect((await forge.getPull(gh, "acme", "api", 7)).labels).toEqual(["no-review", "bug"]);
    expect((await forge.getPull(gl, "acme", "svc", 3)).labels).toEqual(["skip-review"]);
  });
});
