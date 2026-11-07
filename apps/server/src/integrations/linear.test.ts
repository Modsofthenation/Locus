import { describe, expect, it } from "vitest";
import { IntegrationsClient } from "./integrations.js";

const account = {
  id: "l1",
  kind: "linear" as const,
  name: "Linear",
  enabled: true,
  baseUrl: "https://api.linear.app",
  token: "lin_api_testtokenvalue0000000001",
};

const issue = {
  id: "issue-uuid",
  identifier: "ENG-12",
  title: "Cart 500",
  description: "checkout failed",
  url: "https://linear.app/acme/issue/ENG-12",
  priority: 2,
  updatedAt: "2026-01-01T00:00:00.000Z",
  state: { id: "state-progress", name: "In Progress", type: "started" },
  assignee: { id: "user-1", name: "Ada", email: "ada@acme.com" },
  team: { id: "team-uuid", key: "ENG", name: "Engineering" },
  labels: { nodes: [{ id: "lab-1", name: "bug" }] },
  parent: null,
};

function clientFor(
  handler: (input: {
    url: string;
    auth: string | null;
    query: string;
    variables: Record<string, unknown>;
  }) => unknown,
) {
  return new IntegrationsClient(async (url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      query?: string;
      variables?: Record<string, unknown>;
    };
    const data = handler({
      url: String(url),
      auth: new Headers(init?.headers).get("Authorization"),
      query: body.query ?? "",
      variables: body.variables ?? {},
    });
    if (data instanceof Response) return data;
    return new Response(JSON.stringify({ data }), {
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("Linear integration", () => {
  it("searches issues with a vaulted Bearer token", async () => {
    const calls: Array<{ url: string; auth: string | null; query: string; term?: unknown }> = [];
    const client = clientFor(({ url, auth, query, variables }) => {
      calls.push({ url, auth, query, term: variables.term });
      return { searchIssues: { nodes: [issue] } };
    });
    const result = await client.call("linear_search", { query: "cart" }, [account]);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("ENG-12");
    expect(result.output).toContain("Cart 500");
    expect(calls[0]?.url).toBe("https://api.linear.app/graphql");
    expect(calls[0]?.auth).toBe("Bearer lin_api_testtokenvalue0000000001");
    expect(calls[0]?.query).toContain("searchIssues");
    expect(calls[0]?.term).toBe("cart");
  });

  it("fetches an identifier as a single issue", async () => {
    const client = clientFor(({ query, variables }) => {
      expect(query).toContain("issue(id:");
      expect(variables.id).toBe("ENG-12");
      return { issue };
    });
    const result = await client.call("linear_search", { query: "ENG-12" }, [account]);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("ENG-12");
    expect(JSON.parse(result.output).issues).toHaveLength(1);
  });

  it("lists a team's issues when query is omitted", async () => {
    const client = clientFor(({ query, variables }) => {
      if (query.includes("teams(")) {
        return { teams: { nodes: [{ id: "team-uuid", key: "ENG", name: "Engineering" }] } };
      }
      expect(query).toContain("issues(");
      expect(variables.filter).toEqual({ team: { id: { eq: "team-uuid" } } });
      return { issues: { nodes: [issue] } };
    });
    const result = await client.call("linear_search", { team: "ENG" }, [account]);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("ENG-12");
  });

  it("gets an issue with comments", async () => {
    const client = clientFor(() => ({
      issue: {
        ...issue,
        comments: {
          nodes: [
            {
              id: "c1",
              body: "looking",
              createdAt: "2026-01-01T00:00:00.000Z",
              user: { name: "Ada" },
            },
          ],
        },
      },
    }));
    const result = await client.call("linear_get", { issue: "ENG-12" }, [account]);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("checkout failed");
    expect(result.output).toContain("looking");
  });

  it("creates, updates state, and comments", async () => {
    const queries: string[] = [];
    const client = clientFor(({ query, variables }) => {
      queries.push(query.replace(/\s+/g, " ").trim());
      if (query.includes("teams(")) {
        return { teams: { nodes: [{ id: "team-uuid", key: "ENG" }] } };
      }
      if (query.includes("states")) {
        return {
          team: {
            states: {
              nodes: [
                { id: "state-todo", name: "Todo", type: "unstarted" },
                { id: "state-progress", name: "In Progress", type: "started" },
              ],
            },
          },
        };
      }
      if (query.includes("issueCreate")) {
        expect(variables.input).toMatchObject({
          teamId: "team-uuid",
          title: "Cart 500",
          description: "checkout failed",
          stateId: "state-todo",
        });
        return { issueCreate: { success: true, issue: { identifier: "ENG-13", url: issue.url } } };
      }
      if (query.includes("issueUpdate")) {
        expect(variables.input).toEqual({ stateId: "state-progress" });
        return { issueUpdate: { success: true, issue: { identifier: "ENG-12" } } };
      }
      if (query.includes("commentCreate")) {
        expect(variables.input).toEqual({ issueId: "issue-uuid", body: "on it" });
        return { commentCreate: { success: true, comment: { id: "c1" } } };
      }
      if (query.includes("issue(id:")) return { issue };
      throw new Error(`unexpected ${query.slice(0, 80)}`);
    });
    const created = await client.call(
      "linear_create",
      { team: "ENG", title: "Cart 500", description: "checkout failed", state: "Todo" },
      [account],
    );
    expect(created).toEqual({
      ok: true,
      output: "Created ENG-13 https://linear.app/acme/issue/ENG-12",
    });
    const moved = await client.call("linear_update", { issue: "ENG-12", state: "In Progress" }, [
      account,
    ]);
    expect(moved).toEqual({ ok: true, output: "Updated ENG-12" });
    const commented = await client.call("linear_comment", { issue: "ENG-12", body: "on it" }, [
      account,
    ]);
    expect(commented).toEqual({ ok: true, output: "Commented on ENG-12" });
    expect(queries.some((row) => row.includes("issueCreate"))).toBe(true);
  });

  it("surfaces GraphQL errors", async () => {
    const client = new IntegrationsClient(async () => {
      return new Response(JSON.stringify({ errors: [{ message: "Authentication required" }] }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await client.call("linear_search", { query: "cart" }, [account]);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Authentication required");
  });

  it("refuses Linear tools without a token", async () => {
    const client = new IntegrationsClient();
    const result = await client.call("linear_search", { query: "cart" }, []);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Integrations/);
  });
});
