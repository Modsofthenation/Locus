import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { LIST_VIEW_TOOL_CHARS, type AgentSession } from "@locus/shared";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "./sessions.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

describe("GET /api/sessions list view", () => {
  it("omits huge tool dumps from the list but keeps them on GET by id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-session-list-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const hypervisor = new MockHypervisor(dir);
    const hub = new Hub();
    const sessions = new SessionService(store, hypervisor, hub);
    const app = createApp({ store, sessions, hypervisor });
    const dump = `export const n = 1;\n${"x".repeat(12_000)}`;
    const now = "2026-08-19T12:00:00.000Z";
    await store.replaceSession({
      id: "s-heavy",
      title: "Host agent",
      os: "ubuntu",
      templateId: "ubuntu",
      providerId: "openai",
      model: "gpt-4.1",
      status: "idle",
      needsHuman: "Approve git_push",
      messages: [
        {
          id: "u1",
          role: "user",
          content: "unique-search-token-zed",
          createdAt: now,
        },
        {
          id: "a1",
          role: "assistant",
          content: "Pushing.",
          createdAt: now,
          toolCalls: [
            {
              id: "c1",
              name: "git_push",
              arguments: { path: "src/app.ts", content: dump },
              result: dump,
              approval: "needed",
              startedAt: now,
            },
          ],
        },
        { id: "t1", role: "tool", toolCallId: "c1", content: dump, createdAt: now },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const listed = (await (await app.request("/api/sessions")).json()) as AgentSession[];
    const full = (await (await app.request("/api/sessions/s-heavy")).json()) as AgentSession;
    const listRow = listed.find((row) => row.id === "s-heavy");
    expect(listRow?.listView).toBe(true);
    expect(listRow?.needsHuman).toBe("Approve git_push");
    expect(listRow?.messages[0]?.content).toBe("unique-search-token-zed");
    expect(listRow?.messages[1]?.toolCalls?.[0]?.approval).toBe("needed");
    expect(listRow?.messages[2]?.content.length).toBeLessThanOrEqual(LIST_VIEW_TOOL_CHARS);
    expect(full.listView).toBeUndefined();
    expect(full.messages[2]?.content).toBe(dump);
    expect(JSON.stringify(listRow).length).toBeLessThan(JSON.stringify(full).length / 2);
  });
});
