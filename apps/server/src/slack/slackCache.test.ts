import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SlackCache } from "./slackCache.js";
import { decryptVault, loadOrCreateMasterKey } from "../core/vault.js";

describe("SlackCache", () => {
  it("encrypts cached conversations and messages at rest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-slack-enc-"));
    const cache = new SlackCache(dir);
    await cache.saveConversations("T1", [{ id: "C_ENG", name: "eng", kind: "channel" }]);
    await cache.saveMessages("T1", "C_ENG", [
      { ts: "1.0", channelId: "C_ENG", text: "secret thread about payroll" },
    ]);
    const conversationsPath = join(dir, "slack", "T1", "conversations.json");
    const messagesPath = join(dir, "slack", "T1", "messages", "C_ENG.json");
    const convRaw = await readFile(conversationsPath, "utf8");
    const msgRaw = await readFile(messagesPath, "utf8");
    expect(convRaw.startsWith("locus1.")).toBe(true);
    expect(msgRaw.startsWith("locus1.")).toBe(true);
    expect(convRaw).not.toContain("C_ENG");
    expect(msgRaw).not.toContain("payroll");
    const key = await loadOrCreateMasterKey(dir);
    expect(JSON.parse(decryptVault(convRaw, key))).toMatchObject({
      rows: [{ id: "C_ENG", name: "eng" }],
    });
    const loaded = await cache.loadMessages("T1", "C_ENG");
    expect(loaded.rows[0]?.text).toBe("secret thread about payroll");
    expect(loaded.stale).toBe(false);
  });

  it("migrates plaintext cache files to encrypted on read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-slack-migrate-"));
    const path = join(dir, "slack", "T1", "conversations.json");
    await mkdir(join(dir, "slack", "T1"), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        cachedAt: new Date().toISOString(),
        rows: [{ id: "C_OPS", name: "ops", kind: "channel" }],
      }),
      "utf8",
    );
    const cache = new SlackCache(dir);
    const loaded = await cache.loadConversations("T1");
    expect(loaded.rows.map((row) => row.id)).toEqual(["C_OPS"]);
    const raw = await readFile(path, "utf8");
    expect(raw.startsWith("locus1.")).toBe(true);
    expect(raw).not.toContain("C_OPS");
  });

  it("treats an old cachedAt as stale without dropping rows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-slack-stale-"));
    const cache = new SlackCache(dir);
    await cache.saveMessages(
      "T1",
      "C_ENG",
      [{ ts: "2.0", channelId: "C_ENG", text: "from disk" }],
      new Date(Date.now() - 60 * 60 * 1000),
    );
    const loaded = await cache.loadMessages("T1", "C_ENG");
    expect(loaded.stale).toBe(true);
    expect(loaded.rows[0]?.text).toBe("from disk");
  });

  it("drops deleted messages when merging the cache", () => {
    const cache = new SlackCache("/tmp");
    const rows = cache.mergeMessages(
      [
        { ts: "1.0", channelId: "C1", text: "keep" },
        { ts: "1.1", channelId: "C1", text: "gone" },
      ],
      [{ ts: "1.1", channelId: "C1", text: "", subtype: "message_deleted" }],
    );
    expect(rows.map((row) => row.ts)).toEqual(["1.0"]);
  });
});
