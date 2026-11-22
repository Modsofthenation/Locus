import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "./sessions.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CLI Git tool approvals", () => {
  it("cancels the approval card when the MCP caller disconnects", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cli-git-approval-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const sessions = new SessionService(store, new MockHypervisor(dir), new Hub());
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const execute = vi.spyOn(sessions, "executeTool");
    // An active CLI turn, as hostCliTurn registers it.
    const turn = new AbortController();
    (sessions as unknown as { cliGitTurns: Map<string, AbortSignal> }).cliGitTurns.set(
      created.id,
      turn.signal,
    );

    const caller = new AbortController();
    const pending = sessions.executeCliGitTool(
      created.id,
      "git_push",
      { branch: "feature" },
      caller.signal,
    );
    const neededCard = async () =>
      (await sessions.get(created.id))?.messages
        .flatMap((m) => m.toolCalls ?? [])
        .find((call) => call.name === "git_push");
    for (let i = 0; i < 100 && (await neededCard())?.approval !== "needed"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await neededCard())?.approval).toBe("needed");

    caller.abort();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, output: "Git operation cancelled." });
    expect(execute).not.toHaveBeenCalled();
    const card = await neededCard();
    expect(card?.approval).not.toBe("needed");
    expect(card?.finishedAt).toBeDefined();
  });
});
