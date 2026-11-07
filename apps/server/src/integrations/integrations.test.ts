import { describe, expect, it } from "vitest";
import {
  IntegrationsClient,
  CONFLUENCE_CLOUD_TOKEN_HINT,
  JIRA_CLOUD_TOKEN_HINT,
  JIRA_HEADER_TOO_LARGE_HINT,
} from "./integrations.js";

describe("IntegrationsClient", () => {
  it("searches Jira with a vaulted token", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      calls.push({
        url: String(url),
        auth: new Headers(init?.headers).get("Authorization"),
      });
      return new Response(
        JSON.stringify({ issues: [{ key: "OPS-1", fields: { summary: "Down" } }] }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    const result = await client.call("jira_search", { jql: "project = OPS" }, [
      {
        id: "j1",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://acme.atlassian.net",
        token: "mail:tok",
      },
    ]);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("OPS-1");
    expect(calls[0]?.url).toContain("acme.atlassian.net/rest/api/3/search/jql");
    expect(calls[0]?.auth).toBe(`Basic ${Buffer.from("mail:tok").toString("base64")}`);
  });

  it("refuses a raw Jira Cloud API token before calling Atlassian", async () => {
    let called = false;
    const client = new IntegrationsClient(async () => {
      called = true;
      return new Response("should not run");
    });
    const result = await client.call("jira_search", { jql: "project = SUP" }, [
      {
        id: "j1",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://acme.atlassian.net",
        token: "ATATT3x-raw-scoped-token",
      },
    ]);
    expect(called).toBe(false);
    expect(result).toEqual({ ok: false, output: JIRA_CLOUD_TOKEN_HINT });
  });

  it("sends a Data Center PAT as Bearer", async () => {
    const auths: string[] = [];
    const client = new IntegrationsClient(async (_url, init) => {
      auths.push(new Headers(init?.headers).get("Authorization") ?? "");
      return new Response(JSON.stringify({ issues: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await client.call("jira_search", { jql: "project = OPS" }, [
      {
        id: "j1",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://jira.example.internal",
        token: "NjE2MDgzNTAtZj...",
      },
    ]);
    expect(result.ok).toBe(true);
    expect(auths).toEqual(["Bearer NjE2MDgzNTAtZj..."]);
  });

  it("rewrites Atlassian's Connect session token error", async () => {
    const client = new IntegrationsClient(async () => {
      return new Response(JSON.stringify({ error: "Failed to parse Connect Session Auth Token" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await client.call("jira_search", { jql: "project = SUP" }, [
      {
        id: "j1",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://api.atlassian.com/ex/jira/cloud-id",
        token: "ATATT3x-oauth-style",
      },
    ]);
    expect(result).toEqual({ ok: false, output: JIRA_CLOUD_TOKEN_HINT });
  });

  it("refuses a giant Jira token that would 494 on proxies", async () => {
    let called = false;
    const client = new IntegrationsClient(async () => {
      called = true;
      return new Response("should not run");
    });
    const result = await client.call("jira_search", { jql: "project = SUP" }, [
      {
        id: "j1",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://acme.atlassian.net",
        token: `user@acme.com:${"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.".repeat(80)}`,
      },
    ]);
    expect(called).toBe(false);
    expect(result).toEqual({ ok: false, output: JIRA_HEADER_TOO_LARGE_HINT });
  });

  it("rewrites nginx 494 header-too-large responses", async () => {
    const client = new IntegrationsClient(async () => {
      return new Response("494 Bad Request", { status: 494 });
    });
    const result = await client.call("jira_search", { jql: "project = SUP" }, [
      {
        id: "j1",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://acme.atlassian.net",
        token: "mail:tok",
      },
    ]);
    expect(result).toEqual({ ok: false, output: JIRA_HEADER_TOO_LARGE_HINT });
  });

  it("treats Jira 400 project-does-not-exist as likely anonymous auth", async () => {
    const client = new IntegrationsClient(async () => {
      return new Response(
        JSON.stringify({
          errorMessages: ["The value 'SUP' does not exist for the field 'project'."],
          errors: {},
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    });
    const result = await client.call("jira_search", { jql: "project = SUP" }, [
      {
        id: "j1",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://acme.atlassian.net",
        token: "mail:tok",
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/HTTP 400/);
    expect(result.output).toMatch(/anonymous/);
    expect(result.output).toContain("email:api-token");
  });

  it("creates a Jira issue and transitions by name", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const account = {
      id: "j1",
      kind: "jira" as const,
      name: "Jira",
      enabled: true,
      baseUrl: "https://acme.atlassian.net",
      token: "mail:tok",
    };
    const client = new IntegrationsClient(async (url, init) => {
      const href = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: href, body });
      if (href.endsWith("/rest/api/3/issue") && init?.method === "POST") {
        return new Response(JSON.stringify({ key: "OPS-9", id: "10001" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.endsWith("/transitions") && !init?.method) {
        return new Response(
          JSON.stringify({
            transitions: [
              { id: "11", name: "To Do" },
              { id: "21", name: "In Progress" },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.endsWith("/transitions") && init?.method === "POST") {
        return new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected ${href}`);
    });
    const created = await client.call(
      "jira_create",
      { project: "OPS", summary: "Cart 500", description: "checkout failed", issuetype: "Bug" },
      [account],
    );
    expect(created).toEqual({ ok: true, output: "Created OPS-9" });
    expect(calls[0]?.body).toMatchObject({
      fields: {
        project: { key: "OPS" },
        summary: "Cart 500",
        issuetype: { name: "Bug" },
      },
    });
    const moved = await client.call(
      "jira_transition",
      { issue: "OPS-9", transition: "In Progress" },
      [account],
    );
    expect(moved).toEqual({ ok: true, output: "Transitioned OPS-9 via In Progress" });
    expect(calls.at(-1)?.body).toEqual({ transition: { id: "21" } });
  });

  it("creates a Jira issue under a parent epic", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      const href = String(url);
      calls.push({
        url: href,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (href.endsWith("/rest/api/3/field")) {
        return new Response(
          JSON.stringify([
            {
              id: "customfield_10500",
              name: "Epic Link",
              schema: { custom: "com.pyxis.greenhopper.jira:gh-epic-link", type: "any" },
            },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.endsWith("/rest/api/3/issue") && init?.method === "POST") {
        return new Response(JSON.stringify({ key: "SUP-840" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected ${href}`);
    });
    const created = await client.call(
      "jira_create",
      { project: "SUP", summary: "Checkout 500", parent: "SUP-846" },
      [
        {
          id: "j1",
          kind: "jira",
          name: "Jira",
          enabled: true,
          baseUrl: "https://acme.atlassian.net",
          token: "mail:tok",
        },
      ],
    );
    expect(created).toEqual({ ok: true, output: "Created SUP-840" });
    expect(calls.at(-1)?.body).toMatchObject({
      fields: {
        project: { key: "SUP" },
        summary: "Checkout 500",
        parent: { key: "SUP-846" },
        customfield_10500: "SUP-846",
      },
    });
  });

  it("bulk-sets parent and Epic Link on existing issues", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      const href = String(url);
      calls.push({
        url: href,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (href.endsWith("/rest/api/3/field")) {
        return new Response(
          JSON.stringify([
            {
              id: "customfield_10500",
              name: "Epic Link",
              schema: { custom: "com.pyxis.greenhopper.jira:gh-epic-link", type: "any" },
            },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/rest/api/3/issue/") && init?.method === "PUT") {
        return new Response("{}", { headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected ${init?.method} ${href}`);
    });
    const result = await client.call(
      "jira_update",
      { issues: ["SUP-840", "SUP-841", "SUP-842", "SUP-843"], parent: "SUP-846" },
      [
        {
          id: "j1",
          kind: "jira",
          name: "Jira",
          enabled: true,
          baseUrl: "https://acme.atlassian.net",
          token: "mail:tok",
        },
      ],
    );
    expect(result).toEqual({
      ok: true,
      output: "Updated SUP-840, SUP-841, SUP-842, SUP-843. parent SUP-846",
    });
    const puts = calls.filter((row) => row.method === "PUT");
    expect(puts).toHaveLength(4);
    expect(puts[0]?.url).toContain("/rest/api/3/issue/SUP-840");
    expect(puts[0]?.body).toEqual({
      fields: {
        parent: { key: "SUP-846" },
        customfield_10500: "SUP-846",
      },
    });
  });

  it("retries Jira update without parent when Epic Link is the editable field", async () => {
    const bodies: unknown[] = [];
    const client = new IntegrationsClient(async (url, init) => {
      const href = String(url);
      if (href.endsWith("/rest/api/3/field")) {
        return new Response(
          JSON.stringify([
            {
              id: "customfield_10500",
              name: "Epic Link",
              schema: { custom: "com.pyxis.greenhopper.jira:gh-epic-link", type: "any" },
            },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        bodies.push(body);
        if (body.fields?.parent) {
          return new Response(
            JSON.stringify({
              errorMessages: [],
              errors: {
                parent:
                  "Field 'parent' cannot be set. It is not on the appropriate screen, or unknown.",
              },
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("{}", { headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`unexpected ${href}`);
    });
    const result = await client.call("jira_update", { issue: "SUP-840", epic: "SUP-846" }, [
      {
        id: "j1",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://acme.atlassian.net",
        token: "mail:tok",
      },
    ]);
    expect(result).toEqual({ ok: true, output: "Updated SUP-840. parent SUP-846" });
    expect(bodies).toEqual([
      { fields: { parent: { key: "SUP-846" }, customfield_10500: "SUP-846" } },
      { fields: { customfield_10500: "SUP-846" } },
    ]);
  });

  it("rejects a Jira transition id that is not on the issue", async () => {
    const client = new IntegrationsClient(async (url) => {
      if (String(url).endsWith("/transitions")) {
        return new Response(JSON.stringify({ transitions: [{ id: "21", name: "In Progress" }] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const result = await client.call("jira_transition", { issue: "OPS-9", transition: "99" }, [
      {
        id: "j1",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://acme.atlassian.net",
        token: "mail:tok",
      },
    ]);
    expect(result).toEqual({ ok: false, output: "Unknown transition 99" });
  });

  it("posts Slack messages and lists Grafana dashboards", async () => {
    const client = new IntegrationsClient(async (url, init) => {
      if (String(url).includes("chat.postMessage")) {
        expect(JSON.parse(String(init?.body))).toEqual({ channel: "C1", text: "hello" });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify([{ uid: "abc", title: "Checkout" }]), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const slack = await client.call("slack_post", { channel: "C1", text: "hello" }, [
      {
        id: "s1",
        kind: "slack",
        name: "Slack",
        enabled: true,
        baseUrl: "https://slack.com/api",
        token: "xoxb-1",
      },
    ]);
    expect(slack).toEqual({ ok: true, output: expect.stringMatching(/^Posted to C1/) });
    const grafana = await client.call("grafana_search", { query: "check" }, [
      {
        id: "g1",
        kind: "grafana",
        name: "Grafana",
        enabled: true,
        baseUrl: "http://127.0.0.1:3000",
        token: "glsa",
      },
    ]);
    expect(grafana.ok).toBe(true);
    expect(grafana.output).toContain("Checkout");
  });

  it("does not silently slice Grafana JSON to 8k", async () => {
    const title = "CheckoutDashboard".repeat(600);
    const client = new IntegrationsClient(async () => {
      return new Response(JSON.stringify([{ uid: "abc", title }]), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const grafana = await client.call("grafana_search", { query: "check" }, [
      {
        id: "g1",
        kind: "grafana",
        name: "Grafana",
        enabled: true,
        baseUrl: "http://127.0.0.1:3000",
        token: "glsa",
      },
    ]);
    expect(grafana.ok).toBe(true);
    expect(grafana.output.length).toBeGreaterThan(8_000);
    expect(grafana.output).toContain(title);
  });

  it("posts Slack as the bot when as=bot and both tokens are present", async () => {
    const auths: string[] = [];
    const client = new IntegrationsClient(async (url, init) => {
      if (String(url).includes("chat.postMessage")) {
        const headers = init?.headers as Record<string, string> | undefined;
        auths.push(headers?.Authorization ?? headers?.authorization ?? "");
        return new Response(
          JSON.stringify({
            ok: true,
            ts: "1.1",
            channel: "C1",
            message: { ts: "1.1", text: "hello", user: "U_BOT", username: "Locus" },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${String(url)}`);
    });
    const account = {
      id: "s1",
      kind: "slack" as const,
      name: "Slack",
      enabled: true,
      baseUrl: "https://slack.com/api",
      token: "xoxb-bot",
      userToken: "xoxp-user",
    };
    const asUser = await client.call("slack_post", { channel: "C1", text: "hello" }, [account]);
    expect(asUser.ok).toBe(true);
    const asBot = await client.call("slack_post", { channel: "C1", text: "hello", as: "bot" }, [
      account,
    ]);
    expect(asBot.ok).toBe(true);
    expect(auths).toEqual(["Bearer xoxp-user", "Bearer xoxb-bot"]);
  });

  it("uploads Slack files from UTF-8 content", async () => {
    const client = new IntegrationsClient();
    const slack = await client.call(
      "slack_upload",
      { channel: "C1", filename: "notes.txt", content: "hello" },
      [
        {
          id: "s1",
          kind: "slack",
          name: "Slack",
          enabled: true,
          baseUrl: "https://slack.com/api",
          userToken: "xoxp-mock",
        },
      ],
    );
    expect(slack.ok).toBe(true);
    expect(slack.output).toMatch(/^Uploaded notes.txt to C1/);
  });

  it("rejects Slack writes outside the channel allowlist", async () => {
    const account = {
      id: "s1",
      kind: "slack" as const,
      name: "Slack",
      enabled: true,
      baseUrl: "https://slack.com/api",
      userToken: "xoxp-mock",
      allowedSlackChannelIds: ["C_ENG"],
    };
    const denied = await new IntegrationsClient().call(
      "slack_post",
      { channel: "C_OPS", text: "nope" },
      [account],
    );
    expect(denied).toEqual({ ok: false, output: "This channel is not on the Slack allowlist" });
  });

  it("queries Grafana Elasticsearch logs with a vaulted API key", async () => {
    const client = new IntegrationsClient(async (url, init) => {
      const href = String(url);
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer glsa_test");
      if (href.endsWith("/api/health")) {
        return new Response(JSON.stringify({ version: "8.5.27" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.endsWith("/api/datasources")) {
        return new Response(
          JSON.stringify([
            {
              id: 2,
              uid: "es-logs",
              name: "application_logs",
              type: "elasticsearch",
              database: "filebeat-*",
              jsonData: { timeField: "@timestamp", esVersion: "7.10.0" },
            },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/_msearch")) {
        return new Response(
          JSON.stringify({
            responses: [
              {
                hits: {
                  total: { value: 1, relation: "eq" },
                  hits: [
                    {
                      _source: {
                        message: "checkout failed",
                        logger: { level: "error" },
                      },
                    },
                  ],
                },
                aggregations: { "2": { buckets: [{ key: 1, doc_count: 1 }] } },
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("unexpected", { status: 404 });
    });
    const grafana = await client.call("grafana_query", { query: "logger.level:error" }, [
      {
        id: "g1",
        kind: "grafana",
        name: "Grafana",
        enabled: true,
        baseUrl: "https://grafana.example.com",
        token: "glsa_test",
      },
    ]);
    expect(grafana.ok).toBe(true);
    expect(grafana.output).toContain("lucene");
    expect(grafana.output).toContain("explore_url");
    expect(grafana.output).toContain("logger.level:error");
    expect(grafana.output).toContain("checkout failed");
  });

  it("refuses when the integration is missing", async () => {
    const client = new IntegrationsClient();
    const result = await client.call("jira_get", { issue: "OPS-1" }, []);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Integrations/);
  });

  it("searches, gets, and updates Sentry issues with a vaulted token", async () => {
    const calls: Array<{ url: string; method: string; auth: string | null; body?: unknown }> = [];
    const issue = {
      id: "451",
      shortId: "WEB-12",
      title: "TypeError: Cannot read properties of undefined",
      culprit: "checkout.ts in pay",
      status: "unresolved",
      level: "error",
      count: "18",
      userCount: 4,
      permalink: "https://sentry.io/organizations/acme/issues/451/",
      project: { slug: "web", name: "Web" },
      metadata: { type: "TypeError", value: "Cannot read properties of undefined" },
    };
    const latest = {
      eventID: "abc123",
      dateCreated: "2026-10-20T10:00:00Z",
      platform: "javascript",
      title: issue.title,
      tags: [{ key: "environment", value: "prod" }],
      user: { email: "buyer@example.com" },
      entries: [
        {
          type: "exception",
          data: {
            values: [
              {
                type: "TypeError",
                value: "Cannot read properties of undefined",
                stacktrace: {
                  frames: [
                    { filename: "node_modules/react/index.js", function: "render", lineNo: 1 },
                    {
                      filename: "checkout.ts",
                      function: "pay",
                      lineNo: 42,
                      inApp: true,
                    },
                  ],
                },
              },
            ],
          },
        },
        { type: "request", data: { method: "POST", url: "/pay" } },
      ],
    };
    const client = new IntegrationsClient(async (url, init) => {
      const href = String(url);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      calls.push({
        url: href,
        method,
        auth: headers.get("Authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (href.endsWith("/api/0/organizations/")) {
        return new Response(JSON.stringify([{ slug: "acme", name: "Acme" }]), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.includes("/organizations/acme/projects/")) {
        return new Response(
          JSON.stringify([{ id: "1", slug: "web", name: "Web", platform: "javascript" }]),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/organizations/acme/issues/")) {
        return new Response(JSON.stringify([issue]), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.includes("/organizations/acme/shortids/WEB-12/")) {
        return new Response(JSON.stringify({ group: { id: "451", shortId: "WEB-12" } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.endsWith("/api/0/issues/451/") && method === "PUT") {
        return new Response(JSON.stringify({ ...issue, status: "resolved" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.endsWith("/api/0/issues/451/") && method === "GET") {
        return new Response(JSON.stringify(issue), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.endsWith("/api/0/issues/451/events/latest/")) {
        return new Response(JSON.stringify(latest), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected ${method} ${href}`);
    });
    const account = {
      id: "s1",
      kind: "sentry" as const,
      name: "Sentry",
      enabled: true,
      baseUrl: "https://sentry.io",
      token: "sntryu_test",
    };
    const listed = await client.call("sentry_projects", {}, [account]);
    expect(listed.ok).toBe(true);
    expect(listed.output).toContain("acme");
    expect(listed.output).toContain("web");
    const searched = await client.call("sentry_search", { query: "is:unresolved" }, [account]);
    expect(searched.ok).toBe(true);
    expect(searched.output).toContain("WEB-12");
    expect(searched.output).toContain("is:unresolved");
    expect(calls.some((row) => row.url.includes("/organizations/acme/issues/"))).toBe(true);
    expect(calls.every((row) => row.auth === "Bearer sntryu_test")).toBe(true);
    const got = await client.call("sentry_get", { issue: "WEB-12" }, [account]);
    expect(got.ok).toBe(true);
    expect(got.output).toContain("checkout.ts");
    expect(got.output).toContain("pay");
    expect(got.output).toContain("POST");
    expect(got.output).not.toContain("node_modules/react");
    const updated = await client.call(
      "sentry_update",
      { issue: "https://sentry.io/organizations/acme/issues/451/", status: "resolved" },
      [account],
    );
    expect(updated).toEqual({
      ok: true,
      output: expect.stringMatching(/Updated 451.*status resolved/),
    });
    expect(
      calls.some(
        (row) =>
          row.method === "PUT" &&
          row.url.endsWith("/api/0/issues/451/") &&
          (row.body as { status?: string })?.status === "resolved",
      ),
    ).toBe(true);
    const doubled = await client.call("sentry_search", { org: "acme" }, [
      { ...account, baseUrl: "https://sentry.io/api/0" },
    ]);
    expect(doubled.ok).toBe(true);
    expect(calls.some((row) => row.url.includes("/api/0/api/0/"))).toBe(false);
  });

  it("asks for org when the Sentry token sees more than one organization", async () => {
    const client = new IntegrationsClient(async (url) => {
      if (String(url).endsWith("/api/0/organizations/")) {
        return new Response(
          JSON.stringify([
            { slug: "acme", name: "Acme" },
            { slug: "other", name: "Other" },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${String(url)}`);
    });
    const result = await client.call("sentry_search", { query: "is:unresolved" }, [
      {
        id: "s1",
        kind: "sentry",
        name: "Sentry",
        enabled: true,
        baseUrl: "https://sentry.io",
        token: "sntryu_test",
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Pass org \(one of acme, other\)/);
  });

  it("lists, imports, and exports Miro boards", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      const href = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: href, method, body });
      if ((href.includes("/v2/boards?") || href.endsWith("/v2/boards")) && method === "GET") {
        const offset = Number(new URL(href).searchParams.get("offset") ?? "0");
        const data =
          offset === 0
            ? [
                { id: "u123", name: "Sprint", viewLink: "https://miro.com/app/board/u123/" },
                ...Array.from({ length: 49 }, (_, i) => ({
                  id: `p${i}`,
                  name: `Page ${i}`,
                })),
              ]
            : [{ id: "u999", name: "Later" }];
        return new Response(JSON.stringify({ data }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.endsWith("/v2/boards") && method === "POST") {
        return new Response(
          JSON.stringify({
            id: "u-new",
            name: body?.name,
            viewLink: "https://miro.com/app/board/u-new/",
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/items")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "m-s",
                type: "sticky_note",
                data: { content: "<p>Hello</p>" },
                position: { x: 0, y: 0, origin: "center" },
                geometry: { width: 160, height: 140 },
                style: { fillColor: "light_yellow" },
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/connectors") && method === "GET") {
        return new Response(JSON.stringify({ data: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.includes("/sticky_notes") && method === "POST") {
        return new Response(JSON.stringify({ id: "new-s" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected ${method} ${href}`);
    });
    const account = {
      id: "m1",
      kind: "miro" as const,
      name: "Miro",
      enabled: true,
      baseUrl: "https://api.miro.com",
      token: "miro-token",
    };
    const listed = await client.call("miro_list", {}, [account]);
    expect(listed.ok).toBe(true);
    expect(listed.output).toContain("u123 Sprint https://miro.com/app/board/u123/");
    expect(listed.output).toContain("u999 Later");
    const imported = await client.call("miro_import", { board: "u123" }, [account]);
    expect(imported.ok).toBe(true);
    expect(imported.output).toContain("Hello");
    const exported = await client.call(
      "miro_export",
      {
        board: "u123",
        objects: [
          { id: "s1", type: "sticky", x: 0, y: 0, w: 160, h: 140, text: "Ship it", color: "amber" },
        ],
      },
      [account],
    );
    expect(exported).toEqual({ ok: true, output: "Exported 1 items to Miro u123" });
    expect(calls.some((row) => row.url.includes("/sticky_notes") && row.method === "POST")).toBe(
      true,
    );
    const minted = await client.call(
      "miro_export",
      {
        name: "From Locus",
        objects: [
          { id: "s2", type: "sticky", x: 0, y: 0, w: 160, h: 140, text: "Hello", color: "mint" },
        ],
      },
      [account],
    );
    expect(minted.ok).toBe(true);
    expect(minted.output).toContain("Miro u-new");
    expect(minted.output).toContain("https://miro.com/app/board/u-new/");
    expect(calls.some((row) => row.url.endsWith("/v2/boards") && row.method === "POST")).toBe(true);
  });

  it("lists, reads, renders, and comments on Figma files", async () => {
    const calls: Array<{
      url: string;
      method?: string;
      token: string | null;
      body?: Record<string, unknown>;
    }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      const href = String(url);
      const method = init?.method ?? "GET";
      const token = new Headers(init?.headers).get("X-Figma-Token");
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ url: href, method, token, body });
      if (href.endsWith("/v1/me")) {
        return new Response(JSON.stringify({ id: "u1", handle: "ada", email: "ada@example.com" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.includes("/v1/teams/123/projects")) {
        return new Response(
          JSON.stringify({ name: "Acme", projects: [{ id: 99, name: "Product" }] }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/v1/projects/99/files")) {
        return new Response(
          JSON.stringify({
            name: "Product",
            files: [{ key: "AbCdEfGhIjKlMnOpQrStUv", name: "Home", last_modified: "2026-01-01" }],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/v1/files/AbCdEfGhIjKlMnOpQrStUv/nodes")) {
        return new Response(
          JSON.stringify({
            name: "Home",
            nodes: {
              "12:34": {
                document: {
                  id: "12:34",
                  name: "Hero",
                  type: "FRAME",
                  children: [{ id: "12:35", name: "Title", type: "TEXT", characters: "Hello" }],
                },
              },
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/v1/files/AbCdEfGhIjKlMnOpQrStUv/comments") && method === "POST") {
        return new Response(JSON.stringify({ id: "c1" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.includes("/v1/images/AbCdEfGhIjKlMnOpQrStUv")) {
        return new Response(
          JSON.stringify({ images: { "12:34": "https://s3.example/hero.png" } }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${method} ${href}`);
    });
    const account = {
      id: "f1",
      kind: "figma" as const,
      name: "Figma",
      enabled: true,
      baseUrl: "https://api.figma.com",
      token: "figd-secret",
    };
    const who = await client.call("figma_list", {}, [account]);
    expect(who.ok).toBe(true);
    expect(who.output).toContain("ada");
    expect(who.output).toContain("figma_get");
    const projects = await client.call("figma_list", { team: "123" }, [account]);
    expect(projects.output).toContain("99 Product");
    const files = await client.call("figma_list", { project: "99" }, [account]);
    expect(files.output).toContain("AbCdEfGhIjKlMnOpQrStUv Home");
    const got = await client.call(
      "figma_get",
      { file: "https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/Home?node-id=12-34" },
      [account],
    );
    expect(got.ok).toBe(true);
    expect(got.output).toContain("Hero");
    expect(got.output).toContain("Hello");
    const images = await client.call(
      "figma_images",
      { file: "AbCdEfGhIjKlMnOpQrStUv", ids: "12-34" },
      [account],
    );
    expect(images.ok).toBe(true);
    expect(images.output).toContain("https://s3.example/hero.png");
    const commented = await client.call(
      "figma_comment",
      { file: "AbCdEfGhIjKlMnOpQrStUv", message: "Ship this", node: "12-34" },
      [account],
    );
    expect(commented).toEqual({
      ok: true,
      output: "Commented on AbCdEfGhIjKlMnOpQrStUv node 12:34 id=c1",
    });
    expect(calls.every((row) => row.token === "figd-secret")).toBe(true);
    expect(calls.some((row) => row.method === "POST" && row.body?.message === "Ship this")).toBe(
      true,
    );
  });

  const incidentio = {
    id: "i1",
    kind: "incidentio" as const,
    name: "incident.io",
    enabled: true,
    baseUrl: "https://api.incident.io",
    token: "inc_test",
  };

  it("lists incident.io incidents with a vaulted Bearer token", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      calls.push({
        url: String(url),
        auth: new Headers(init?.headers).get("Authorization"),
      });
      return new Response(
        JSON.stringify({
          incidents: [
            {
              id: "01FCNDV6P870EA6S7TK1DSYD5H",
              reference: "INC-123",
              name: "Database is sad",
              summary: "Writes are failing",
              permalink: "https://app.incident.io/incidents/INC-123",
              incident_status: { name: "Investigating", category: "live" },
              severity: { name: "Major" },
            },
            {
              id: "01OTHERINCIDENT00000000001",
              reference: "INC-124",
              name: "Cache miss storm",
              incident_status: { name: "Closed", category: "closed" },
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    const listed = await client.call("incidentio_search", { status_category: "active" }, [
      incidentio,
    ]);
    expect(listed.ok).toBe(true);
    expect(listed.output).toContain("INC-123");
    expect(listed.output).toContain("Database is sad");
    expect(listed.output).toContain("Investigating");
    expect(calls[0]?.auth).toBe("Bearer inc_test");
    expect(calls[0]?.url).toContain("api.incident.io/v2/incidents");
    expect(calls[0]?.url).toContain("status_category");
    const filtered = await client.call("incidentio_search", { query: "cache" }, [incidentio]);
    expect(filtered.ok).toBe(true);
    expect(filtered.output).toContain("INC-124");
    expect(filtered.output).not.toContain("INC-123");
  });

  it("gets, creates, updates, and comments on incident.io incidents", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      const href = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: href, method, body });
      if (href.includes("/v1/incident_statuses")) {
        return new Response(
          JSON.stringify({
            incident_statuses: [{ id: "01STATUSINVESTIGATE00001", name: "Investigating" }],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/v1/severities")) {
        return new Response(
          JSON.stringify({ severities: [{ id: "01SEVMAJOR0000000000001", name: "Major" }] }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/v2/incidents?") || href.endsWith("/v2/incidents")) {
        if (method === "POST") {
          return new Response(
            JSON.stringify({
              incident: {
                id: "01NEWINCIDENT000000000001",
                reference: "INC-200",
                name: body?.name,
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            incidents: [
              {
                id: "01FCNDV6P870EA6S7TK1DSYD5H",
                reference: "INC-123",
                name: "Database is sad",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/actions/edit")) {
        return new Response(
          JSON.stringify({
            incident: { id: "01FCNDV6P870EA6S7TK1DSYD5H", reference: "INC-123" },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/v2/incident_updates")) {
        return new Response(JSON.stringify({ incident_update: { id: "u1" } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.includes("/v2/incidents/")) {
        return new Response(
          JSON.stringify({
            incident: {
              id: "01FCNDV6P870EA6S7TK1DSYD5H",
              reference: "INC-123",
              name: "Database is sad",
              summary: "Writes are failing",
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("unexpected", { status: 404 });
    });

    const got = await client.call("incidentio_get", { incident: "INC-123" }, [incidentio]);
    expect(got.ok).toBe(true);
    expect(got.output).toContain("Database is sad");

    const created = await client.call(
      "incidentio_create",
      { name: "API latency", summary: "p99 is high", status: "Investigating", severity: "Major" },
      [incidentio],
    );
    expect(created).toEqual({
      ok: true,
      output: "Created INC-200 id=01NEWINCIDENT000000000001",
    });
    const createCall = calls.find(
      (row) => row.method === "POST" && row.url.endsWith("/v2/incidents"),
    );
    expect(createCall?.body).toMatchObject({
      name: "API latency",
      summary: "p99 is high",
      visibility: "public",
      incident_status_id: "01STATUSINVESTIGATE00001",
      severity_id: "01SEVMAJOR0000000000001",
    });

    const updated = await client.call(
      "incidentio_update",
      { incident: "01FCNDV6P870EA6S7TK1DSYD5H", summary: "Mitigated" },
      [incidentio],
    );
    expect(updated).toEqual({ ok: true, output: "Updated INC-123" });

    const commented = await client.call(
      "incidentio_comment",
      { incident: "INC-123", body: "Rolling back now" },
      [incidentio],
    );
    expect(commented).toEqual({ ok: true, output: "Posted update on INC-123" });
  });

  it("refuses incident.io tools without a token", async () => {
    const client = new IntegrationsClient();
    const result = await client.call("incidentio_search", { query: "down" }, []);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Integrations/);
  });

  it("lists Portainer environments and acts on containers with an access token", async () => {
    const calls: Array<{
      url: string;
      method: string;
      apiKey: string | null;
      auth: string | null;
    }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      const href = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      calls.push({
        url: href,
        method,
        apiKey: headers.get("X-API-Key"),
        auth: headers.get("Authorization"),
      });
      if (href.endsWith("/api/endpoints") && method === "GET") {
        return new Response(
          JSON.stringify([
            { Id: 1, Name: "local", Type: 1, Status: 1 },
            { Id: 2, Name: "k8s", Type: 5, Status: 1 },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/docker/containers/json")) {
        return new Response(
          JSON.stringify([
            {
              Id: "abcdef1234567890",
              Names: ["/web"],
              Image: "nginx:latest",
              State: "running",
              Ports: [{ PublicPort: 80, PrivatePort: 80, Type: "tcp" }],
            },
            {
              Id: "bbbbbb1234567890",
              Names: ["/worker"],
              Image: "app:1",
              State: "exited",
              Ports: [],
            },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/docker/containers/web/json")) {
        return new Response(
          JSON.stringify({
            Id: "abcdef1234567890",
            Name: "/web",
            State: { Status: "running", Running: true, ExitCode: 0 },
            Config: { Image: "nginx:latest", Env: ["FOO=1"], Cmd: ["nginx"] },
            HostConfig: { RestartPolicy: { Name: "unless-stopped" } },
            NetworkSettings: { Ports: { "80/tcp": [{ HostPort: "80" }] } },
            Created: "2026-01-01T00:00:00Z",
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/docker/containers/web/logs")) {
        const payload = Buffer.alloc(8 + 5);
        payload[0] = 1;
        payload.writeUInt32BE(5, 4);
        payload.write("hello", 8);
        return new Response(payload);
      }
      if (href.includes("/docker/containers/web/restart") && method === "POST") {
        return new Response(null, { status: 204 });
      }
      if (href.endsWith("/api/stacks") && method === "GET") {
        return new Response(
          JSON.stringify([{ Id: 9, Name: "web", Type: 2, EndpointId: 1, Status: 1 }]),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/api/stacks/9/file")) {
        return new Response(
          JSON.stringify({ StackFileContent: "services:\n  web:\n    image: nginx\n" }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (href.includes("/api/stacks/9/stop") && method === "POST") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${method} ${href}`);
    });
    const account = {
      id: "p1",
      kind: "portainer" as const,
      name: "Portainer",
      enabled: true,
      baseUrl: "http://127.0.0.1:9000",
      token: "ptr_test",
    };
    const listed = await client.call("portainer_endpoints", {}, [account]);
    expect(listed.ok).toBe(true);
    expect(listed.output).toContain("1 local up docker");
    expect(listed.output).toContain("2 k8s up kubernetes");
    expect(calls[0]?.apiKey).toBe("ptr_test");
    expect(calls[0]?.auth).toBeNull();

    const containers = await client.call("portainer_containers", { endpoint: "local" }, [account]);
    expect(containers.ok).toBe(true);
    expect(containers.output).toContain("abcdef123456 web running nginx:latest 80:80/tcp");
    expect(containers.output).toContain("worker");

    const filtered = await client.call("portainer_containers", { endpoint: "1", name: "web" }, [
      account,
    ]);
    expect(filtered.ok).toBe(true);
    expect(filtered.output).toContain("web");
    expect(filtered.output).not.toContain("worker");

    const inspect = await client.call(
      "portainer_inspect",
      { endpoint: "local", container: "web" },
      [account],
    );
    expect(inspect.ok).toBe(true);
    expect(inspect.output).toContain("nginx:latest");
    expect(inspect.output).toContain("unless-stopped");
    expect(inspect.output).not.toContain("FOO=1");
    expect(inspect.output).toContain("EnvCount");

    const logs = await client.call("portainer_logs", { container: "web", endpoint: "1" }, [
      account,
    ]);
    expect(logs).toEqual({ ok: true, output: "hello" });

    const restarted = await client.call(
      "portainer_container_action",
      { container: "web", action: "restart", endpoint: "local" },
      [account],
    );
    expect(restarted).toEqual({ ok: true, output: "restart web on endpoint 1" });

    const k8s = await client.call("portainer_containers", { endpoint: "k8s" }, [account]);
    expect(k8s.ok).toBe(false);
    expect(k8s.output).toMatch(/not Docker/);

    const stacks = await client.call("portainer_stacks", {}, [account]);
    expect(stacks.ok).toBe(true);
    expect(stacks.output).toContain("9 web active compose endpoint=1");

    const stack = await client.call("portainer_stacks", { stack: "web" }, [account]);
    expect(stack.ok).toBe(true);
    expect(stack.output).toContain("image: nginx");

    const stopped = await client.call("portainer_stack_action", { stack: "web", action: "stop" }, [
      account,
    ]);
    expect(stopped).toEqual({ ok: true, output: "stop stack web on endpoint 1" });
    expect(calls.some((row) => row.url.includes("endpointId=1") && row.method === "POST")).toBe(
      true,
    );
  });

  it("sends a Portainer JWT as Bearer", async () => {
    const auths: string[] = [];
    const keys: string[] = [];
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig";
    const client = new IntegrationsClient(async (_url, init) => {
      const headers = new Headers(init?.headers);
      auths.push(headers.get("Authorization") ?? "");
      keys.push(headers.get("X-API-Key") ?? "");
      return new Response(JSON.stringify([{ Id: 1, Name: "local", Type: 1, Status: 1 }]), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await client.call("portainer_endpoints", {}, [
      {
        id: "p1",
        kind: "portainer",
        name: "Portainer",
        enabled: true,
        baseUrl: "https://portainer.example.com",
        token: jwt,
      },
    ]);
    expect(result.ok).toBe(true);
    expect(auths).toEqual([`Bearer ${jwt}`]);
    expect(keys).toEqual([""]);
  });

  it("searches Gmail, lists calendar events, and uploads Drive files", async () => {
    const calls: Array<{ url: string; method?: string; auth?: string | null }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      const href = String(url);
      calls.push({
        url: href,
        method: init?.method ?? "GET",
        auth: new Headers(init?.headers).get("Authorization"),
      });
      if (
        href.includes("/gmail/v1/users/me/messages?") ||
        href.endsWith("/gmail/v1/users/me/messages")
      ) {
        return new Response(JSON.stringify({ messages: [{ id: "m1", threadId: "t1" }] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.includes("/gmail/v1/users/me/messages/m1")) {
        return new Response(
          JSON.stringify({
            id: "m1",
            threadId: "t1",
            snippet: "Site is down",
            payload: {
              headers: [
                { name: "From", value: "ops@acme.com" },
                { name: "Subject", value: "Outage" },
                { name: "Date", value: "Tue, 20 Oct 2026 09:00:00 +0000" },
              ],
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/gmail/v1/users/me/messages/send")) {
        return new Response(JSON.stringify({ id: "m9", threadId: "t9" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.includes("/calendar/v3/calendars/primary/events")) {
        if ((init?.method ?? "GET") === "POST") {
          return new Response(
            JSON.stringify({
              id: "evt1",
              summary: "Standup",
              htmlLink: "https://calendar.google.com/event?eid=evt1",
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "evt0",
                summary: "Standup",
                start: { dateTime: "2026-10-20T09:00:00Z" },
                end: { dateTime: "2026-10-20T09:15:00Z" },
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/drive/v3/files?") || href.includes("/upload/drive/v3/files")) {
        if ((init?.method ?? "GET") === "POST") {
          return new Response(
            JSON.stringify({
              id: "f1",
              name: "notes.md",
              webViewLink: "https://drive.google.com/file/d/f1",
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            files: [{ id: "f0", name: "spec.md", mimeType: "text/markdown", size: "12" }],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("unexpected", { status: 404 });
    });
    const gmailAccount = {
      id: "gm1",
      kind: "gmail" as const,
      name: "Gmail",
      enabled: true,
      baseUrl: "https://gmail.googleapis.com",
      token: "ya29.test",
    };
    const search = await client.call("gmail_search", { q: "subject:outage" }, [gmailAccount]);
    expect(search.ok).toBe(true);
    expect(search.output).toContain("Outage");
    expect(search.output).toContain("ops@acme.com");
    expect(calls[0]?.auth).toBe("Bearer ya29.test");
    const sent = await client.call(
      "gmail_send",
      { to: "ops@acme.com", subject: "Ack", body: "Looking" },
      [gmailAccount],
    );
    expect(sent).toEqual({ ok: true, output: "Sent m9 thread=t9" });
    const calAccount = {
      id: "cal1",
      kind: "gcal" as const,
      name: "Google Calendar",
      enabled: true,
      baseUrl: "https://www.googleapis.com",
      token: "ya29.test",
    };
    const events = await client.call("calendar_list", {}, [calAccount]);
    expect(events.ok).toBe(true);
    expect(events.output).toContain("Standup");
    const created = await client.call(
      "calendar_create",
      {
        summary: "Standup",
        start: "2026-10-21T09:00:00Z",
        end: "2026-10-21T09:15:00Z",
      },
      [calAccount],
    );
    expect(created.ok).toBe(true);
    expect(created.output).toContain("evt1");
    const driveAccount = {
      id: "dr1",
      kind: "gdrive" as const,
      name: "Google Drive",
      enabled: true,
      baseUrl: "https://www.googleapis.com",
      token: "ya29.test",
    };
    const files = await client.call("drive_list", {}, [driveAccount]);
    expect(files.ok).toBe(true);
    expect(files.output).toContain("spec.md");
    const uploaded = await client.call("drive_upload", { name: "notes.md", content: "# notes\n" }, [
      driveAccount,
    ]);
    expect(uploaded.ok).toBe(true);
    expect(uploaded.output).toContain("notes.md");
    expect(uploaded.output).toContain("f1");
  });

  it("refreshes an expired Google access token then retries", async () => {
    const calls: string[] = [];
    const persisted: Array<{ id: string; token?: string }> = [];
    const client = new IntegrationsClient(
      async (url, init) => {
        const href = String(url);
        calls.push(`${init?.method ?? "GET"} ${href}`);
        if (href.includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "ya29.fresh", expires_in: 3600 }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        const auth = new Headers(init?.headers).get("Authorization");
        if (auth === "Bearer ya29.stale") {
          return new Response(JSON.stringify({ error: { message: "Invalid Credentials" } }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ files: [{ id: "f2", name: "ok.md" }] }), {
          headers: { "Content-Type": "application/json" },
        });
      },
      async (id, patch) => {
        persisted.push({ id, token: patch.token });
      },
    );
    const result = await client.call("drive_list", {}, [
      {
        id: "dr1",
        kind: "gdrive",
        name: "Google Drive",
        enabled: true,
        baseUrl: "https://www.googleapis.com",
        token: "ya29.stale",
        refreshToken: "1//refresh",
        oauthClientId: "cid",
        oauthClientSecret: "csecret",
      },
    ]);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("ok.md");
    expect(calls.some((row) => row.includes("oauth2.googleapis.com/token"))).toBe(true);
    expect(persisted).toEqual([expect.objectContaining({ id: "dr1", token: "ya29.fresh" })]);
  });
  it("searches Confluence with a vaulted token and prefixes /wiki on Cloud", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      calls.push({
        url: String(url),
        auth: new Headers(init?.headers).get("Authorization"),
      });
      return new Response(
        JSON.stringify({
          size: 1,
          results: [
            {
              id: "123",
              type: "page",
              title: "Checkout runbook",
              space: { key: "ENG" },
              version: { number: 4 },
              _links: { webui: "/spaces/ENG/pages/123" },
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    const account = {
      id: "c1",
      kind: "confluence" as const,
      name: "Confluence",
      enabled: true,
      baseUrl: "https://acme.atlassian.net",
      token: "mail:tok",
    };
    const result = await client.call("confluence_search", { query: "checkout" }, [account]);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Checkout runbook");
    expect(result.output).toContain("123");
    expect(calls[0]?.url).toContain("acme.atlassian.net/wiki/rest/api/content/search");
    expect(calls[0]?.url).toContain("type%3Dpage");
    expect(calls[0]?.auth).toBe(`Basic ${Buffer.from("mail:tok").toString("base64")}`);
    const cql = await client.call("confluence_search", { cql: "space=ENG AND type=page" }, [
      account,
    ]);
    expect(cql.ok).toBe(true);
    expect(calls[1]?.url).toContain("space%3DENG");
  });

  it("refuses a raw Confluence Cloud API token before calling Atlassian", async () => {
    let called = false;
    const client = new IntegrationsClient(async () => {
      called = true;
      return new Response("should not run");
    });
    const result = await client.call("confluence_search", { cql: "type=page" }, [
      {
        id: "c1",
        kind: "confluence",
        name: "Confluence",
        enabled: true,
        baseUrl: "https://acme.atlassian.net",
        token: "ATATT3x-raw-scoped-token",
      },
    ]);
    expect(called).toBe(false);
    expect(result).toEqual({ ok: false, output: CONFLUENCE_CLOUD_TOKEN_HINT });
  });

  it("does not double /wiki when the Confluence base URL already includes it", async () => {
    const urls: string[] = [];
    const client = new IntegrationsClient(async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ id: "9", title: "Runbook", version: { number: 1 } }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    await client.call("confluence_get", { id: "9" }, [
      {
        id: "c1",
        kind: "confluence",
        name: "Confluence",
        enabled: true,
        baseUrl: "https://acme.atlassian.net/wiki",
        token: "mail:tok",
      },
    ]);
    expect(urls[0]).toContain("https://acme.atlassian.net/wiki/rest/api/content/9");
    expect(urls[0]).not.toContain("/wiki/wiki/");
  });

  it("prefixes /wiki on api.atlassian.com/ex/confluence", async () => {
    const urls: string[] = [];
    const client = new IntegrationsClient(async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ results: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    await client.call("confluence_search", { cql: "type=page" }, [
      {
        id: "c1",
        kind: "confluence",
        name: "Confluence",
        enabled: true,
        baseUrl: "https://api.atlassian.com/ex/confluence/cloud-id",
        token: "mail:tok",
      },
    ]);
    expect(urls[0]).toContain(
      "https://api.atlassian.com/ex/confluence/cloud-id/wiki/rest/api/content/search",
    );
  });

  it("sends a Confluence Data Center PAT as Bearer", async () => {
    const auths: string[] = [];
    const urls: string[] = [];
    const client = new IntegrationsClient(async (url, init) => {
      urls.push(String(url));
      auths.push(new Headers(init?.headers).get("Authorization") ?? "");
      return new Response(JSON.stringify({ results: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await client.call("confluence_search", { cql: "type=page" }, [
      {
        id: "c1",
        kind: "confluence",
        name: "Confluence",
        enabled: true,
        baseUrl: "https://confluence.example.internal",
        token: "NjE2MDgzNTAtZj...",
      },
    ]);
    expect(result.ok).toBe(true);
    expect(auths).toEqual(["Bearer NjE2MDgzNTAtZj..."]);
    expect(urls[0]).toContain("https://confluence.example.internal/rest/api/content/search");
    expect(urls[0]).not.toContain("/wiki/");
  });

  it("gets, creates, updates, and comments on Confluence pages", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      const href = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: href, method, body });
      if (href.includes("/rest/api/content?") && method === "GET") {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: "321",
                type: "page",
                title: "Runbook",
                space: { key: "ENG" },
                version: { number: 2 },
                body: { storage: { value: "<p>old</p>", representation: "storage" } },
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/rest/api/content/321/child/comment") && method === "POST") {
        return new Response(JSON.stringify({ id: "c1" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (href.includes("/rest/api/content/321") && method === "PUT") {
        return new Response(
          JSON.stringify({ id: "321", title: "Runbook v2", version: { number: 3 } }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.includes("/rest/api/content/321") && method === "GET") {
        return new Response(
          JSON.stringify({
            id: "321",
            type: "page",
            title: "Runbook",
            space: { key: "ENG" },
            version: { number: 2 },
            body: { storage: { value: "<p>hello</p>", representation: "storage" } },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (href.endsWith("/rest/api/content") && method === "POST") {
        return new Response(JSON.stringify({ id: "400", title: "Incident" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected ${method} ${href}`);
    });
    const account = {
      id: "c1",
      kind: "confluence" as const,
      name: "Confluence",
      enabled: true,
      baseUrl: "https://acme.atlassian.net",
      token: "mail:tok",
    };
    const got = await client.call("confluence_get", { id: "321" }, [account]);
    expect(got.ok).toBe(true);
    expect(got.output).toContain("hello");
    expect(got.output).toContain("321");
    const byTitle = await client.call("confluence_get", { title: "Runbook", space: "ENG" }, [
      account,
    ]);
    expect(byTitle.ok).toBe(true);
    expect(byTitle.output).toContain("old");
    const created = await client.call(
      "confluence_create",
      { space: "ENG", title: "Incident", body: "checkout failed", parent: "100" },
      [account],
    );
    expect(created).toEqual({ ok: true, output: 'Created page 400 "Incident"' });
    expect(
      calls.find((row) => row.method === "POST" && row.url.endsWith("/rest/api/content"))?.body,
    ).toMatchObject({
      type: "page",
      title: "Incident",
      space: { key: "ENG" },
      ancestors: [{ id: "100" }],
      body: { storage: { representation: "storage", value: "<p>checkout failed</p>" } },
    });
    const updated = await client.call("confluence_update", { id: "321", body: "<p>next</p>" }, [
      account,
    ]);
    expect(updated).toEqual({ ok: true, output: 'Updated page 321 "Runbook v2" (version 3)' });
    expect(calls.find((row) => row.method === "PUT")?.body).toMatchObject({
      id: "321",
      version: { number: 3 },
      body: { storage: { value: "<p>next</p>", representation: "storage" } },
    });
    const commented = await client.call(
      "confluence_comment",
      { title: "Runbook", space: "ENG", body: "see Grafana" },
      [account],
    );
    expect(commented).toEqual({ ok: true, output: "Commented on page 321" });
  });

  it("refuses Confluence when the integration is missing", async () => {
    const client = new IntegrationsClient();
    const result = await client.call("confluence_get", { id: "1" }, []);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Integrations/);
  });
});
