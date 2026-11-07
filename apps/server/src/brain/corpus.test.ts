import { describe, expect, it } from "vitest";
import { parseJiraCorpus } from "./corpus.js";

describe("parseJiraCorpus", () => {
  it("reads issue keys and summaries from a Jira search payload", () => {
    const rows = parseJiraCorpus(
      JSON.stringify({
        issues: [
          { key: "BILL-12", fields: { summary: "Charge cards only from API" } },
          { key: "BILL-13", fields: { summary: "Idempotency keys" } },
          { key: "", fields: { summary: "skip" } },
        ],
      }),
      "2026-01-01T00:00:00.000Z",
    );
    expect(rows).toEqual([
      {
        id: "jira:BILL-12",
        text: "BILL-12: Charge cards only from API",
        source: "jira:BILL-12",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "jira:BILL-13",
        text: "BILL-13: Idempotency keys",
        source: "jira:BILL-13",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("returns nothing for non-JSON output", () => {
    expect(parseJiraCorpus("not json")).toEqual([]);
  });
});
