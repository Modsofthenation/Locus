import { describe, expect, it } from "vitest";
import { emptyBrain, upsertNode } from "@locus/shared";
import { draftBrainIssueBrief, postBrainIssueBrief } from "./issueBrief.js";

describe("draftBrainIssueBrief", () => {
  it("drafts from a fetched issue and posts only through the comment tool", async () => {
    const created = upsertNode(emptyBrain(), {
      type: "Service",
      name: "billing",
      description: "Owns charges",
      provenance: {
        actor: "indexer:test",
        evidence: "apps/billing/src/app.ts:4",
        confidence: "high",
      },
    });
    expect(created.ok).toBe(true);
    const calls: string[] = [];
    const client = {
      call: async (name: string, args: Record<string, unknown>) => {
        calls.push(name);
        if (name === "jira_get") {
          return {
            ok: true,
            output: JSON.stringify({
              fields: { summary: "Charge retries", description: "billing timeouts" },
            }),
          };
        }
        return { ok: true, output: `posted ${String(args.issue)}` };
      },
    };
    const draft = await draftBrainIssueBrief({
      doc: created.doc,
      issue: "ENG-12",
      target: "jira",
      client,
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.title).toBe("Charge retries");
    expect(draft.body).toMatch(/apps\/billing\/src\/app.ts:4/);
    expect(calls).toEqual(["jira_get"]);
    const posted = await postBrainIssueBrief(client, draft, []);
    expect(posted.ok).toBe(true);
    expect(calls).toEqual(["jira_get", "jira_comment"]);
  });
});
