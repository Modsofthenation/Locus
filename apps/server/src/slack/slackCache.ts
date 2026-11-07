import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SLACK_CONVERSATIONS_TTL_MS,
  SLACK_EMOJI_TTL_MS,
  SLACK_MESSAGE_CAP,
  SLACK_MESSAGES_TTL_MS,
  parseSlackConversation,
  parseSlackMessage,
  mergeSlackMessageRows,
  resolveSlackEmojiMap,
  type SlackConversation,
  type SlackEmojiMap,
  type SlackMessage,
} from "@locus/shared";
import { decryptVault, encryptVault, loadOrCreateMasterKey } from "../core/vault.js";

export class SlackCache {
  private key: Buffer | undefined;

  constructor(private readonly dataDir: string) {}

  private root(teamId: string): string {
    return join(this.dataDir, "slack", teamId);
  }

  private async vaultKey(): Promise<Buffer> {
    this.key ??= await loadOrCreateMasterKey(this.dataDir);
    return this.key;
  }

  async loadConversations(teamId: string): Promise<{ rows: SlackConversation[]; stale: boolean }> {
    const raw = await this.readJson<{ cachedAt?: string; rows?: unknown[] }>(
      join(this.root(teamId), "conversations.json"),
    );
    if (!raw) return { rows: [], stale: true };
    const cachedAt = Date.parse(raw.cachedAt ?? "");
    const rows = (raw.rows ?? [])
      .map((row) => parseSlackConversation(row))
      .filter((row): row is SlackConversation => Boolean(row));
    const stale = !Number.isFinite(cachedAt) || Date.now() - cachedAt > SLACK_CONVERSATIONS_TTL_MS;
    return { rows, stale };
  }

  async saveConversations(
    teamId: string,
    rows: SlackConversation[],
    cachedAt = new Date(),
  ): Promise<void> {
    const dir = this.root(teamId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await this.writeJson(join(dir, "conversations.json"), {
      cachedAt: cachedAt.toISOString(),
      rows,
    });
  }

  async loadMessages(
    teamId: string,
    channelId: string,
  ): Promise<{ rows: SlackMessage[]; stale: boolean }> {
    const raw = await this.readJson<{ cachedAt?: string; rows?: unknown[] }>(
      join(this.root(teamId), "messages", `${safeId(channelId)}.json`),
    );
    if (!raw) return { rows: [], stale: true };
    const cachedAt = Date.parse(raw.cachedAt ?? "");
    const rows = (raw.rows ?? [])
      .map((row) => parseSlackMessage(row, channelId))
      .filter((row): row is SlackMessage => Boolean(row));
    const stale = !Number.isFinite(cachedAt) || Date.now() - cachedAt > SLACK_MESSAGES_TTL_MS;
    return { rows, stale };
  }

  async saveMessages(
    teamId: string,
    channelId: string,
    rows: SlackMessage[],
    cachedAt = new Date(),
  ): Promise<void> {
    const dir = join(this.root(teamId), "messages");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const capped = rows.slice(-SLACK_MESSAGE_CAP);
    await this.writeJson(join(dir, `${safeId(channelId)}.json`), {
      cachedAt: cachedAt.toISOString(),
      rows: capped,
    });
  }

  mergeMessages(existing: SlackMessage[], incoming: SlackMessage[]): SlackMessage[] {
    return mergeSlackMessageRows(existing, incoming).slice(-SLACK_MESSAGE_CAP);
  }

  async loadStars(teamId: string): Promise<string[]> {
    const raw = await this.readJson<{ ids?: unknown }>(join(this.root(teamId), "stars.json"));
    return Array.isArray(raw?.ids)
      ? raw.ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
      : [];
  }

  async saveStars(teamId: string, ids: string[]): Promise<void> {
    const dir = this.root(teamId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await this.writeJson(join(dir, "stars.json"), { ids: [...new Set(ids)] });
  }

  applyStars(rows: SlackConversation[], ids: string[]): SlackConversation[] {
    const starred = new Set(ids);
    return rows.map((row) => ({ ...row, starred: starred.has(row.id) || undefined }));
  }

  async loadEmoji(teamId: string): Promise<{ map: SlackEmojiMap; stale: boolean }> {
    const raw = await this.readJson<{ cachedAt?: string; emoji?: Record<string, string> }>(
      join(this.root(teamId), "emoji.json"),
    );
    if (!raw) return { map: {}, stale: true };
    const cachedAt = Date.parse(raw.cachedAt ?? "");
    const map = resolveSlackEmojiMap(raw.emoji ?? {});
    const stale = !Number.isFinite(cachedAt) || Date.now() - cachedAt > SLACK_EMOJI_TTL_MS;
    return { map, stale };
  }

  async saveEmoji(teamId: string, map: SlackEmojiMap, cachedAt = new Date()): Promise<void> {
    const dir = this.root(teamId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await this.writeJson(join(dir, "emoji.json"), { cachedAt: cachedAt.toISOString(), emoji: map });
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    try {
      const raw = await readFile(path, "utf8");
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      if (trimmed.startsWith("locus1.")) {
        return JSON.parse(decryptVault(trimmed, await this.vaultKey())) as T;
      }
      const parsed = JSON.parse(trimmed) as T;
      await this.writeJson(path, parsed).catch(() => undefined);
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await writeFile(path, encryptVault(JSON.stringify(value), await this.vaultKey()), {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "channel";
}
