import { describe, expect, it } from "vitest";
import {
  contradictMemory,
  consolidateObservations,
  emptyBrain,
  formatBrainIssueBrief,
  parseBrainBriefIssue,
  issueFieldsFromToolOutput,
  applyBrainBriefApprovalBody,
  extractBrainClaims,
  extractHttpRoutes,
  findEntities,
  formatFindEntities,
  getEntity,
  memoryEntersOrient,
  queueBrainCorrection,
  rememberObservation,
  renderOrientDoc,
  resolveBrainCorrection,
  searchKnowledge,
  sessionOffersBrain,
  upsertEdge,
  upsertNode,
  distillSessionText,
  sessionDistillTail,
  brainSummary,
  brainClaimsForRepo,
  filterBrainGraph,
  filterBrainMemories,
  filterBrainActivity,
  brainIndexedRepoLabel,
  BRAIN_DISTILL_TAIL_CHARS,
} from "./brain.js";

describe("brain issue briefing", () => {
  it("parses a Jira URL and formats owning service, evidence, and decisions", () => {
    expect(parseBrainBriefIssue("https://acme.atlassian.net/browse/eng-12")).toEqual({
      issue: "ENG-12",
      target: "jira",
    });
    expect(
      issueFieldsFromToolOutput(
        JSON.stringify({ fields: { summary: "Charge retries", description: "timeouts" } }),
      ),
    ).toEqual({ title: "Charge retries", summary: "timeouts" });
    const doc = emptyBrain();
    doc.nodes.push({
      id: "service:billing",
      type: "Service",
      name: "billing",
      description: "Owns charges",
      evidence: "apps/billing/src/app.ts:12",
      createdBy: "indexer:test",
      updatedBy: "indexer:test",
      createdAt: doc.updatedAt,
      updatedAt: doc.updatedAt,
    });
    doc.memories.push({
      id: "mem:1",
      claim: "billing retries stay in the gateway",
      kind: "decision",
      source: "user_stated",
      ambient: true,
      evidenceCount: 1,
      contradictionCount: 0,
      createdAt: doc.updatedAt,
    });
    const text = formatBrainIssueBrief({
      issue: "ENG-12",
      title: "Charge retries",
      summary: "billing timeouts",
      doc,
    });
    expect(text).toMatch(/Owning service/);
    expect(text).toMatch(/billing — Owns charges \(apps\/billing\/src\/app.ts:12\)/);
    expect(text).toMatch(/billing retries stay in the gateway/);
    expect(
      applyBrainBriefApprovalBody("brain_brief", { issue: "ENG-12", body: "old" }, "edited"),
    ).toMatchObject({ body: "edited" });
  });
});

describe("brain verbs", () => {
  it("rejects writes without provenance", () => {
    const doc = emptyBrain();
    const node = upsertNode(doc, { type: "Service", name: "billing" });
    expect(node.ok).toBe(false);
    expect(node.output).toMatch(/provenance\.actor/);
    expect(node.doc.nodes).toHaveLength(0);
    const edge = upsertEdge(doc, { type: "OWNS", from: "a", to: "b" });
    expect(edge.ok).toBe(false);
  });

  it("finds a service by name and alias", () => {
    let doc = emptyBrain();
    const created = upsertNode(doc, {
      type: "Service",
      name: "billing-gateway",
      aliases: ["billing"],
      description: "Owns charge APIs",
      provenance: {
        actor: "indexer:test",
        evidence: "apps/billing/src/app.ts:12",
        confidence: "high",
      },
    });
    expect(created.ok).toBe(true);
    doc = created.doc;
    const byName = findEntities(doc, { q: "billing gateway" });
    expect(formatFindEntities(byName)).toMatch(/billing-gateway/);
    const byAlias = findEntities(doc, { q: "billing" });
    expect(byAlias.matches[0]?.id).toBe("service:billing-gateway");
    expect(getEntity(doc, "service:billing-gateway")).toMatch(/apps\/billing\/src\/app.ts:12/);
  });

  it("remembers verbatim and refuses secrets", () => {
    const added = rememberObservation(emptyBrain(), {
      text: "we never bill from the worker",
      source: "user_stated",
    });
    expect(added.ok).toBe(true);
    expect(added.doc.memories).toHaveLength(1);
    expect(added.output).toMatch(/Queued/);
    const secret = rememberObservation(emptyBrain(), {
      text: "api_key=sk-abcdefghijklmnopqrstuvwxyz",
    });
    expect(secret.ok).toBe(false);
    expect(secret.doc.memories).toHaveLength(0);
  });

  it("includes ambient user memory in orient and excludes contradicted claims", () => {
    let doc = emptyBrain();
    doc = rememberObservation(doc, {
      text: "we never bill from the worker",
      source: "user_stated",
      ambient: true,
    }).doc;
    const agent = rememberObservation(doc, {
      text: "maybe stripe lives in the worker",
      source: "agent",
      kind: "note",
      ambient: false,
    });
    doc = agent.doc;
    const weak = doc.memories.find((row) => row.source === "agent")!;
    expect(memoryEntersOrient(weak)).toBe(false);
    const kept = doc.memories.find((row) => row.source === "user_stated")!;
    expect(memoryEntersOrient(kept)).toBe(true);
    expect(renderOrientDoc(doc)).toMatch(/never bill from the worker/);
    expect(renderOrientDoc(doc)).not.toMatch(/maybe stripe/);
    doc = contradictMemory(doc, kept.id);
    expect(renderOrientDoc(doc)).not.toMatch(/never bill from the worker/);
  });

  it("queues correct_graph into an inbox and applies on accept", () => {
    let doc = emptyBrain();
    const created = upsertNode(doc, {
      type: "Service",
      name: "billing-gateway",
      provenance: { actor: "indexer:test", evidence: "app.ts:1", confidence: "high" },
    });
    doc = created.doc;
    const nodeId = created.doc.nodes[0]!.id;
    const remembered = rememberObservation(doc, {
      text: "We never bill from the worker",
      source: "user_stated",
    });
    doc = remembered.doc;
    const memoryId = doc.memories[0]!.id;
    const queued = queueBrainCorrection(doc, {
      nodeId,
      memoryId,
      reason: "Billing now runs on the worker",
      actor: "session:s1",
    });
    expect(queued.ok).toBe(true);
    expect(queued.doc.corrections?.[0]?.status).toBe("open");
    expect(brainSummary(queued.doc).inboxCount).toBe(1);
    const accepted = resolveBrainCorrection(queued.doc, queued.doc.corrections![0]!.id, "accepted");
    expect(accepted.ok).toBe(true);
    expect(accepted.doc.corrections?.[0]?.status).toBe("accepted");
    expect(accepted.doc.nodes[0]?.confidence).toBe("low");
    expect(accepted.doc.memories[0]?.contradictionCount).toBe(1);
    expect(brainSummary(accepted.doc).inboxCount).toBe(0);
    const missing = queueBrainCorrection(doc, { reason: "no target" });
    expect(missing.ok).toBe(false);
  });
});

describe("brain extract", () => {
  it("extracts a Hono route and package.json service", () => {
    const claims = extractBrainClaims([
      {
        path: "package.json",
        text: JSON.stringify({ name: "@locus/server", description: "control plane" }),
      },
      {
        path: "src/app.ts",
        text: 'export function createApp() {\n  app.get("/api/health", (c) => c.json({ ok: true }));\n}\n',
      },
    ]);
    expect(claims.some((row) => row.type === "Service" && row.name === "@locus/server")).toBe(true);
    const route = claims.find((row) => row.type === "APIEndpoint");
    expect(route?.name).toBe("GET /api/health");
    expect(route?.evidence).toMatch(/src\/app.ts:2/);
    expect(
      extractHttpRoutes("src/app.ts", 'app.post("/api/sessions/:id/chat", handler);\n')[0],
    ).toMatchObject({
      method: "POST",
      path: "/api/sessions/:id/chat",
      line: 1,
    });
  });

  it("extracts Flask, Django, Rails, and chi routes", () => {
    expect(
      extractHttpRoutes("app.py", '@app.get("/api/health")\ndef health():\n  return "ok"\n').some(
        (row) => row.path === "/api/health",
      ),
    ).toBe(true);
    expect(
      extractHttpRoutes("urls.py", 'path("api/charge/", views.charge),\n').some(
        (row) => row.path === "/api/charge/",
      ),
    ).toBe(true);
    expect(
      extractHttpRoutes("routes.rb", 'get "/api/health", to: "health#show"\n').some(
        (row) => row.method === "GET" && row.path === "/api/health",
      ),
    ).toBe(true);
    expect(
      extractHttpRoutes("router.go", 'r.Get("/api/health", handler)\n').some(
        (row) => row.path === "/api/health",
      ),
    ).toBe(true);
  });
});

describe("brain search and distill", () => {
  it("searches graph and memories", () => {
    let doc = emptyBrain();
    doc = upsertNode(doc, {
      type: "APIEndpoint",
      name: "GET /api/health",
      provenance: { actor: "indexer:test", evidence: "src/app.ts:12" },
    }).doc;
    doc = rememberObservation(doc, {
      text: "health check is unauthenticated",
      source: "user_stated",
    }).doc;
    expect(searchKnowledge(doc, "health")).toMatch(/GET \/api\/health/);
    expect(searchKnowledge(doc, "unauthenticated")).toMatch(/health check/);
  });

  it("distills remember-this and never-do lines", () => {
    const rows = distillSessionText(
      "Remember this: we never bill from the worker\nWe decided to keep loopback-only.\nRandom chatter.\n",
    );
    expect(rows.some((row) => /never bill/.test(row.text))).toBe(true);
    expect(rows.some((row) => /loopback-only/.test(row.text))).toBe(true);
  });

  it("keeps earlier turns in the distill tail within the char budget", () => {
    const messages = [
      { role: "user", content: "Remember this: we never call Stripe from the worker" },
      { role: "assistant", content: "Noted. I will avoid Stripe in the worker." },
      { role: "user", content: "Also fix the typo in README." },
      { role: "assistant", content: "Fixed the typo." },
      { role: "tool", content: "huge tool dump that should be ignored" },
    ];
    const blob = sessionDistillTail(messages);
    expect(blob).toMatch(/never call Stripe/);
    expect(blob).toMatch(/fix the typo/);
    expect(blob).not.toMatch(/huge tool dump/);
    expect(blob.startsWith("user:")).toBe(true);

    const early = "user: " + "x".repeat(80);
    const late = "user: " + "y".repeat(80);
    const capped = sessionDistillTail(
      [
        { role: "user", content: "x".repeat(80) },
        { role: "assistant", content: "mid" },
        { role: "user", content: "y".repeat(80) },
      ],
      early.length + 10,
    );
    expect(capped).toContain(late.slice(0, 20));
    expect(capped).not.toContain("x".repeat(40));
    expect(capped.length).toBeLessThanOrEqual(BRAIN_DISTILL_TAIL_CHARS);
  });

  it("consolidates near-duplicates and contradicts never vs always", () => {
    let doc = emptyBrain();
    doc = rememberObservation(doc, {
      text: "we always bill from the worker",
      source: "session",
      kind: "convention",
    }).doc;
    const firstId = doc.memories[0]!.id;
    const consolidated = consolidateObservations(doc, [
      { text: "we never bill from the worker", kind: "gotcha", source: "session", ambient: true },
      { text: "We never bill from the worker!", kind: "gotcha", source: "session", ambient: true },
    ]);
    expect(consolidated.contradicted).toBeGreaterThanOrEqual(1);
    expect(
      consolidated.doc.memories.find((row) => row.id === firstId)?.contradictionCount,
    ).toBeGreaterThan(0);
    const kept = consolidated.doc.memories.filter((row) => /never bill/.test(row.claim));
    expect(kept).toHaveLength(1);
    expect(kept[0]?.evidenceCount).toBeGreaterThanOrEqual(2);
    expect(renderOrientDoc(consolidated.doc)).toMatch(/never bill/);
    expect(renderOrientDoc(consolidated.doc)).not.toMatch(/always bill/);
  });

  it("offers the brain on coding sessions and hides it on design", () => {
    expect(sessionOffersBrain({ kind: "agent" })).toBe(true);
    expect(sessionOffersBrain({})).toBe(true);
    expect(sessionOffersBrain({ kind: "review" })).toBe(true);
    expect(sessionOffersBrain({ kind: "design" })).toBe(false);
    expect(sessionOffersBrain({ kind: "game" })).toBe(false);
    expect(sessionOffersBrain({ kind: "assets" })).toBe(false);
    expect(sessionOffersBrain({ kind: "setup" })).toBe(false);
  });

  it("summarizes claim counts per remote URL", () => {
    let doc = emptyBrain();
    doc = upsertNode(doc, {
      type: "Service",
      name: "billing",
      repo: "https://github.com/acme/billing.git",
      provenance: { actor: "indexer:test" },
    }).doc;
    doc = upsertNode(doc, {
      type: "APIEndpoint",
      name: "GET /charge",
      repo: "https://github.com/acme/billing",
      provenance: { actor: "indexer:test" },
    }).doc;
    doc = rememberObservation(doc, {
      text: "we never bill from the worker",
      source: "user_stated",
      repo: "https://github.com/acme/payments",
    }).doc;
    const summary = brainSummary(doc);
    expect(summary.nodeCount).toBe(2);
    expect(summary.memoryCount).toBe(1);
    expect(brainClaimsForRepo(summary, "https://github.com/acme/billing.git")).toEqual({
      nodeCount: 2,
      memoryCount: 0,
    });
    expect(brainClaimsForRepo(summary, "https://github.com/acme/payments")).toEqual({
      nodeCount: 0,
      memoryCount: 1,
    });
    expect(brainClaimsForRepo(summary, "https://github.com/acme/other")).toEqual({
      nodeCount: 0,
      memoryCount: 0,
    });
  });

  it("filters the graph to one indexed checkout", () => {
    let doc = emptyBrain();
    doc = {
      ...doc,
      repos: [
        {
          url: "https://github.com/acme/billing",
          path: "/tmp/billing",
          indexedAt: doc.updatedAt,
        },
        {
          path: "/tmp/payments",
          indexedAt: doc.updatedAt,
        },
      ],
    };
    doc = upsertNode(doc, {
      type: "Service",
      name: "billing",
      repo: "https://github.com/acme/billing.git",
      provenance: { actor: "indexer:test" },
    }).doc;
    doc = upsertNode(doc, {
      type: "Service",
      name: "payments",
      repo: "/tmp/payments",
      provenance: { actor: "indexer:test" },
    }).doc;
    doc = upsertEdge(doc, {
      type: "CALLS",
      from: "service:billing",
      to: "service:payments",
      provenance: { actor: "indexer:test" },
    }).doc;
    const billing = filterBrainGraph(doc, doc.repos[0]);
    expect(billing.nodes.map((row) => row.id)).toEqual(["service:billing"]);
    expect(billing.edges).toHaveLength(0);
    const payments = filterBrainGraph(doc, doc.repos[1]);
    expect(payments.nodes.map((row) => row.id)).toEqual(["service:payments"]);
    expect(brainIndexedRepoLabel(doc.repos[0]!)).toBe("billing");
    expect(brainIndexedRepoLabel(doc.repos[1]!)).toBe("payments");
    expect(filterBrainGraph(doc, null).nodes).toHaveLength(2);
  });

  it("filters memories and activity by indexed checkout", () => {
    const at = "2020-01-01T00:00:00.000Z";
    const doc = emptyBrain();
    doc.repos = [
      { url: "https://github.com/acme/billing", path: "/tmp/billing", indexedAt: at },
      { path: "/tmp/payments", indexedAt: at },
    ];
    const memories = [
      {
        id: "m1",
        claim: "billing gotcha",
        kind: "gotcha" as const,
        source: "user_stated" as const,
        ambient: true,
        evidenceCount: 1,
        contradictionCount: 0,
        repo: "https://github.com/acme/billing",
        createdAt: at,
      },
      {
        id: "m2",
        claim: "payments note",
        kind: "note" as const,
        source: "agent" as const,
        ambient: false,
        evidenceCount: 0,
        contradictionCount: 0,
        repo: "/tmp/payments",
        createdAt: at,
      },
      {
        id: "m3",
        claim: "global",
        kind: "decision" as const,
        source: "session" as const,
        ambient: true,
        evidenceCount: 0,
        contradictionCount: 0,
        createdAt: at,
      },
    ];
    const activity = [
      {
        id: "a1",
        kind: "index" as const,
        text: "Indexed billing",
        at,
        repo: "https://github.com/acme/billing",
      },
      { id: "a2", kind: "remember" as const, text: "Old unscoped", at },
      { id: "a3", kind: "index" as const, text: "Indexed payments", at, repo: "/tmp/payments" },
    ];
    expect(filterBrainMemories(memories, doc.repos[0]).map((row) => row.id)).toEqual(["m1"]);
    expect(filterBrainMemories(memories, doc.repos[1]).map((row) => row.id)).toEqual(["m2"]);
    expect(filterBrainMemories(memories, null)).toHaveLength(3);
    expect(filterBrainActivity(activity, doc.repos[0]).map((row) => row.id)).toEqual(["a1"]);
    expect(filterBrainActivity(activity, null).map((row) => row.id)).toEqual(["a1", "a2", "a3"]);
    expect(filterBrainActivity(activity, doc.repos[1]).map((row) => row.id)).toEqual(["a3"]);
  });
});
