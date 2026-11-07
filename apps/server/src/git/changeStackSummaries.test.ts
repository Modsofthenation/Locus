import { describe, expect, it } from "vitest";
import { applyChangeStackSummaries, type ChangeStack } from "@locus/shared";
import { changeStackCompletionProvider, summarizeChangeStack } from "./changeStackSummaries.js";
import type { AiProvider, LocusConfig } from "@locus/shared";

const stack: ChangeStack = {
  repoId: "11111111-1111-1111-1111-111111111111",
  number: 12,
  headSha: "abcdef123456",
  generatedAt: "2026-09-04T00:00:00.000Z",
  source: "heuristic",
  cohorts: [
    {
      id: "c1",
      title: "API (1 file)",
      summary: "1 file",
      layers: [
        {
          id: "c1-l1",
          title: "API",
          intent: "contract",
          fileCount: 1,
          commentCount: 0,
          ranges: [
            {
              path: "a.ts",
              startLine: 1,
              endLine: 2,
              side: "RIGHT",
              header: "@@ -1 +1 @@",
              summary: "Update a.ts",
            },
          ],
        },
      ],
    },
  ],
  files: [{ path: "a.ts", cohortId: "c1", layerId: "c1-l1" }],
  markdown: "## Change stack",
};

function provider(partial: Partial<AiProvider> = {}): AiProvider {
  return {
    id: "p1",
    name: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    models: ["gpt-4.1"],
    defaultModel: "gpt-4.1",
    enabled: true,
    extraHeaders: {},
    ...partial,
  };
}

describe("changeStackCompletionProvider", () => {
  it("skips Cursor Cloud / CLI / Claude Code / Kiro CLI and providers without keys", () => {
    expect(
      changeStackCompletionProvider({
        providers: [
          provider({ kind: "cursor", apiKey: "sk-cursor" }),
          provider({ kind: "cursor-cli", id: "cli", apiKey: undefined }),
          provider({ kind: "claude-code", id: "cc" }),
          provider({ kind: "kiro-cli", id: "kiro" }),
          provider({ id: "empty", apiKey: "" }),
          provider({ id: "ok", apiKey: "sk-ok" }),
        ],
      })?.id,
    ).toBe("ok");
    expect(changeStackCompletionProvider({ providers: [] })).toBeUndefined();
    expect(
      changeStackCompletionProvider({
        providers: [provider({ id: "off", enabled: false, apiKey: "sk-off" })],
      }),
    ).toBeUndefined();
  });
});

describe("summarizeChangeStack", () => {
  it("applies a JSON completion and leaves the stack alone without a provider", async () => {
    const config = { providers: [provider()] } as LocusConfig;
    const next = await summarizeChangeStack({
      stack,
      files: [{ path: "a.ts", patch: "@@ -1 +1 @@\n-old\n+new\n" }],
      config,
      complete: async function* () {
        yield {
          type: "text",
          text: JSON.stringify({
            cohorts: [
              { id: "c1", title: "Rename the helper", summary: "The helper now returns new." },
            ],
          }),
        };
      },
    });
    expect(next.source).toBe("heuristic+model");
    expect(next.cohorts[0]!.title).toBe("Rename the helper");
    expect(applyChangeStackSummaries(stack, undefined).source).toBe("heuristic");
    const skipped = await summarizeChangeStack({
      stack,
      files: [],
      config: { providers: [] } as unknown as LocusConfig,
    });
    expect(skipped).toBe(stack);
  });
});
