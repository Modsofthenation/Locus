import { describe, expect, it } from "vitest";
import {
  extraWriteScopes,
  inspectIntegrationToken,
  scopesFromToken,
  stampIntegrationToken,
} from "./tokenScope.js";

function jwt(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `eyJhbGciOiJub25lIn0.${b64}.sig`;
}

describe("token scopes", () => {
  it("reads JWT scope and exp", () => {
    const token = jwt({
      scope: "read:jira-work write:jira-work admin:jira",
      exp: 1_800_000_000,
    });
    expect(scopesFromToken(token)).toEqual(["read:jira-work", "write:jira-work", "admin:jira"]);
    expect(extraWriteScopes("jira", scopesFromToken(token), ["jira_search"])).toEqual([
      "write:jira-work",
      "admin:jira",
    ]);
  });

  it("warns on extra Slack admin scopes and stamps savedAt", () => {
    const token = jwt({ scope: "channels:history chat:write admin" });
    const hygiene = inspectIntegrationToken(
      {
        id: "slack",
        kind: "slack",
        name: "Slack",
        enabled: true,
        baseUrl: "https://slack.com/api",
        token,
      },
      { enabledTools: ["slack_history"], now: 1_700_000_000_000 },
    );
    expect(hygiene.extraScopes).toEqual(expect.arrayContaining(["chat:write", "admin"]));
    expect(hygiene.warning).toMatch(/admin/);
    const stamped = stampIntegrationToken(
      {
        id: "slack",
        kind: "slack",
        name: "Slack",
        enabled: true,
        baseUrl: "https://slack.com/api",
        token,
      },
      "2026-11-06T00:00:00.000Z",
    );
    expect(stamped.tokenSavedAt).toBe("2026-11-06T00:00:00.000Z");
    expect(stamped.tokenScopes).toEqual(expect.arrayContaining(["admin"]));
  });
});
