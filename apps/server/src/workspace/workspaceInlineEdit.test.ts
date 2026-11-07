import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import type { CompleteRequest } from "@locus/providers";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "../session/sessions.js";
import {
  formatInlineEditPrompt,
  INLINE_EDIT_NO_COMPLETIONS,
  parseInlineEditReply,
  runWorkspaceInlineEdit,
} from "./workspaceInlineEdit.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("parseInlineEditReply", () => {
  it("unwraps a fenced block and keeps unfenced code", () => {
    expect(parseInlineEditReply("```ts\nconst y = 1;\n```\n")).toBe("const y = 1;");
    expect(parseInlineEditReply("Here:\n```\nfoo\n```\n")).toBe("foo");
    expect(parseInlineEditReply("const y = 1;\n")).toBe("const y = 1;");
  });
});

describe("formatInlineEditPrompt", () => {
  it("asks to replace a selection and to insert at the cursor", () => {
    const replace = formatInlineEditPrompt({
      path: "src/app.ts",
      content: 'const x = "hi";\n',
      instruction: "rename x to y",
      start: 0,
      end: 15,
    });
    expect(replace).toContain("File: src/app.ts");
    expect(replace).toContain("Replace lines 1-1");
    expect(replace).toContain("rename x to y");
    expect(replace).toContain('const x = "hi";');

    const insert = formatInlineEditPrompt({
      path: "src/app.ts",
      content: "a\nb\n",
      instruction: "add a comment",
      start: 2,
      end: 2,
    });
    expect(insert).toContain("Insert code at line 2");
    expect(insert).toContain("Context before the cursor:");
    expect(insert).toContain("Context after the cursor:");
  });
});

describe("runWorkspaceInlineEdit", () => {
  it("returns the model replacement and rejects an empty insert", async () => {
    const provider = {
      id: "p",
      name: "OpenAI",
      kind: "openai" as const,
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      models: ["gpt-4.1"],
      defaultModel: "gpt-4.1",
      enabled: true,
      extraHeaders: {},
    };
    async function* engine(req: CompleteRequest) {
      expect(req.system).toMatch(/inline code edits/i);
      expect(req.messages[0]?.content).toContain("rename x to y");
      yield { type: "text" as const, text: "```ts\nconst y = 1;\n```" };
    }
    await expect(
      runWorkspaceInlineEdit({
        provider,
        model: "gpt-4.1",
        path: "src/app.ts",
        content: "const x = 1;\n",
        instruction: "rename x to y",
        start: 0,
        end: 12,
        complete: engine,
      }),
    ).resolves.toEqual({ text: "const y = 1;" });

    async function* empty() {
      yield { type: "text" as const, text: "   " };
    }
    await expect(
      runWorkspaceInlineEdit({
        provider,
        model: "gpt-4.1",
        path: "src/app.ts",
        content: "const x = 1;\n",
        instruction: "insert hello",
        start: 0,
        end: 0,
        complete: empty,
      }),
    ).rejects.toThrow(/empty edit/);
  });
});

describe("SessionWorkspace.inlineEditWorkspace", () => {
  it("applies a completions provider and rejects Cursor CLI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-inline-edit-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    async function* engine() {
      yield { type: "text" as const, text: "const y = 1;" };
    }
    const sessions = new SessionService(store, new MockHypervisor(dir), new Hub(), engine);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: false,
    });
    await expect(
      sessions.workspace.inlineEditWorkspace(created.id, {
        path: "src/app.ts",
        content: "const x = 1;\n",
        instruction: "rename x to y",
        start: 0,
        end: 12,
      }),
    ).resolves.toEqual({ text: "const y = 1;" });

    const cursor = config.providers.find((row) => row.kind === "cursor-cli");
    expect(cursor).toBeTruthy();
    const blocked = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: cursor!.id,
      model: cursor!.defaultModel,
      runtime: "host",
      startVm: false,
    });
    await expect(
      sessions.workspace.inlineEditWorkspace(blocked.id, {
        path: "src/app.ts",
        content: "const x = 1;\n",
        instruction: "rename x to y",
        start: 0,
        end: 12,
      }),
    ).rejects.toThrow(INLINE_EDIT_NO_COMPLETIONS);
  });
});
