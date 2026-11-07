import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  BOARD_CHAT_TOOLS,
  BOARD_IMAGE_MIMES,
  BOARD_PLAYBOOK,
  boardAssetExt,
  boardStarterObjects,
  boardSummary,
  boardTitleFromStarter,
  clusterBoardStickies,
  dropBoardObjects,
  formatBoardSlice,
  formatFrameBrief,
  isBoardAssetId,
  isBoardRunTarget,
  isBoardStarter,
  parseBoardComment,
  parseBoardDocument,
  parseBoardObject,
  hydrateBoardObject,
  pinPlanObjectsToFrame,
  type BoardComment,
  type BoardDocument,
  type BoardObject,
  type BoardRunTarget,
  type BoardStarter,
  type BoardSummary,
  type CreateBoardInput,
  type CreateSessionInput,
  type PatchBoardInput,
} from "@locus/shared";
import type { ToolResult } from "@locus/guest-agent";
import { replaceFile } from "../core/atomic.js";
import type { Hub } from "../core/hub.js";
import type { JsonStore } from "../core/store.js";
import type { SessionService } from "../session/sessions.js";

function stamp(date = new Date()): string {
  return date.toISOString();
}

function remapStarter(starter: BoardStarter): BoardObject[] {
  const seed = boardStarterObjects(starter);
  const ids = new Map<string, string>();
  for (const obj of seed) ids.set(obj.id, randomUUID());
  return seed.map((obj) => ({
    ...obj,
    id: ids.get(obj.id) ?? randomUUID(),
    frameId: obj.frameId ? ids.get(obj.frameId) : undefined,
    fromId: obj.fromId ? ids.get(obj.fromId) : undefined,
    toId: obj.toId ? ids.get(obj.toId) : undefined,
  }));
}

export class BoardService {
  constructor(
    private readonly store: JsonStore,
    private readonly hub: Hub,
    private readonly sessions: SessionService,
  ) {}

  private root(): string {
    return join(this.store.dataDir, "boards");
  }

  private dir(id: string): string {
    return join(this.root(), id);
  }

  private path(id: string): string {
    return join(this.dir(id), "board.json");
  }

  private assetsDir(id: string): string {
    return join(this.dir(id), "assets");
  }

  async list(): Promise<BoardSummary[]> {
    await mkdir(this.root(), { recursive: true, mode: 0o700 });
    let names: string[] = [];
    try {
      names = await readdir(this.root());
    } catch {
      return [];
    }
    const rows: BoardSummary[] = [];
    for (const name of names) {
      const board = await this.get(name);
      if (board && !board.archived) rows.push(boardSummary(board));
    }
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return rows;
  }

  async get(id: string): Promise<BoardDocument | undefined> {
    const key = id.trim();
    if (!key || key.includes("..") || key.includes("/") || key.includes("\\")) return undefined;
    try {
      const raw = JSON.parse(await readFile(this.path(key), "utf8")) as unknown;
      return parseBoardDocument(raw);
    } catch {
      return undefined;
    }
  }

  async require(id: string): Promise<BoardDocument> {
    const board = await this.get(id);
    if (!board) throw new Error("Board not found");
    return board;
  }

  private async write(board: BoardDocument): Promise<BoardDocument> {
    await mkdir(this.dir(board.id), { recursive: true, mode: 0o700 });
    const next = { ...board, updatedAt: stamp() };
    await replaceFile(this.path(next.id), JSON.stringify(next, null, 2));
    this.hub.broadcast({ type: "board.updated", board: next });
    return next;
  }

  async create(input: CreateBoardInput = {}): Promise<BoardDocument> {
    const starter = isBoardStarter(input.starter) ? input.starter : undefined;
    const title = input.title?.trim() || boardTitleFromStarter(starter);
    const board: BoardDocument = {
      id: randomUUID(),
      title,
      createdAt: stamp(),
      updatedAt: stamp(),
      objects: starter ? remapStarter(starter) : remapStarter("blank"),
      comments: [],
      starter: starter ?? "blank",
    };
    const saved = await this.write(board);
    const prompt = input.prompt?.trim();
    if (prompt) {
      await this.ensureChat(saved.id, prompt);
      return (await this.get(saved.id)) ?? saved;
    }
    return saved;
  }

  async patch(id: string, input: PatchBoardInput): Promise<BoardDocument> {
    const board = await this.require(id);
    if (typeof input.title === "string" && input.title.trim()) board.title = input.title.trim();
    if (Array.isArray(input.objects)) {
      board.objects = input.objects
        .map(parseBoardObject)
        .filter((row): row is BoardObject => Boolean(row))
        .map(hydrateBoardObject);
    }
    if (Array.isArray(input.comments)) {
      board.comments = input.comments
        .map(parseBoardComment)
        .filter((row): row is BoardComment => Boolean(row));
    }
    if (input.chatSessionId === null) delete board.chatSessionId;
    else if (typeof input.chatSessionId === "string" && input.chatSessionId.trim())
      board.chatSessionId = input.chatSessionId.trim();
    if (typeof input.archived === "boolean") board.archived = input.archived || undefined;
    return this.write(board);
  }

  async duplicate(id: string): Promise<BoardDocument> {
    const src = await this.require(id);
    const copy: BoardDocument = {
      ...src,
      id: randomUUID(),
      title: `${src.title} copy`,
      createdAt: stamp(),
      updatedAt: stamp(),
      chatSessionId: undefined,
      comments: src.comments.map((row) => ({ ...row, id: randomUUID() })),
    };
    const saved = await this.write(copy);
    try {
      await cp(this.assetsDir(id), this.assetsDir(copy.id), { recursive: true });
    } catch {
      /* no assets */
    }
    return saved;
  }

  async putAsset(
    id: string,
    input: { bytes: Uint8Array; mime?: string; name?: string },
  ): Promise<{ assetId: string; mime: string }> {
    await this.require(id);
    const offered = (input.mime ?? "").trim().toLowerCase();
    const fromName = (input.name ?? "").toLowerCase();
    const mime = BOARD_IMAGE_MIMES.includes(offered as (typeof BOARD_IMAGE_MIMES)[number])
      ? offered
      : fromName.endsWith(".png")
        ? "image/png"
        : fromName.endsWith(".jpg") || fromName.endsWith(".jpeg")
          ? "image/jpeg"
          : fromName.endsWith(".gif")
            ? "image/gif"
            : fromName.endsWith(".webp")
              ? "image/webp"
              : "";
    const ext = boardAssetExt(mime);
    if (!ext) throw new Error("Paste a PNG, JPEG, GIF, or WebP");
    if (!input.bytes.byteLength) throw new Error("file is empty");
    if (input.bytes.byteLength > 10 * 1024 * 1024) throw new Error("Image is larger than 10 MiB");
    const assetId = `${randomUUID()}.${ext}`;
    await mkdir(this.assetsDir(id), { recursive: true, mode: 0o700 });
    await writeFile(join(this.assetsDir(id), assetId), input.bytes, { mode: 0o600 });
    return { assetId, mime };
  }

  async getAsset(id: string, assetId: string): Promise<{ bytes: Buffer; mime: string }> {
    await this.require(id);
    if (!isBoardAssetId(assetId)) throw new Error("Not found");
    try {
      const bytes = await readFile(join(this.assetsDir(id), assetId));
      const mime = assetId.endsWith(".png")
        ? "image/png"
        : assetId.endsWith(".gif")
          ? "image/gif"
          : assetId.endsWith(".webp")
            ? "image/webp"
            : "image/jpeg";
      return { bytes, mime };
    } catch {
      throw new Error("Not found");
    }
  }

  async remove(id: string): Promise<void> {
    const board = await this.get(id);
    if (!board) return;
    await rm(this.dir(id), { recursive: true, force: true });
    this.hub.broadcast({ type: "board.deleted", id });
  }

  async upsertObjects(id: string, incoming: unknown[]): Promise<BoardDocument> {
    const board = await this.require(id);
    const parsed = incoming.map(parseBoardObject).filter((row): row is BoardObject => Boolean(row));
    if (!parsed.length) throw new Error("No valid objects");
    const byId = new Map(board.objects.map((row) => [row.id, row]));
    for (const obj of parsed) {
      const prev = byId.get(obj.id);
      byId.set(obj.id, prev ? { ...prev, ...obj, id: obj.id } : hydrateBoardObject(obj));
    }
    board.objects = [...byId.values()];
    return this.write(board);
  }

  async deleteObjects(id: string, ids: string[]): Promise<BoardDocument> {
    const board = await this.require(id);
    return this.write(dropBoardObjects(board, ids.map((row) => row.trim()).filter(Boolean)));
  }

  async addComment(
    id: string,
    input: { objectId: string; body: string; author?: "operator" | "agent" },
  ): Promise<BoardDocument> {
    const board = await this.require(id);
    const objectId = input.objectId.trim();
    const body = input.body.trim();
    if (!objectId || !body) throw new Error("object_id and body are required");
    if (!board.objects.some((row) => row.id === objectId)) throw new Error("Object not found");
    board.comments.push({
      id: randomUUID(),
      objectId,
      body,
      author: input.author === "agent" ? "agent" : "operator",
      createdAt: stamp(),
    });
    return this.write(board);
  }

  async resolveComment(id: string, commentId: string): Promise<BoardDocument> {
    const board = await this.require(id);
    const row = board.comments.find((item) => item.id === commentId);
    if (!row) throw new Error("Comment not found");
    row.resolved = true;
    return this.write(board);
  }

  private async defaultCreateFields(): Promise<
    Pick<CreateSessionInput, "os" | "templateId" | "providerId" | "model">
  > {
    const config = await this.store.loadConfig();
    const template =
      config.templates.find((row) => row.os === "ubuntu") ??
      config.templates.find((row) => !row.os.startsWith("windows")) ??
      config.templates[0];
    const provider = config.providers[0];
    if (!template || !provider) throw new Error("Finish setup before running a board");
    return {
      os: template.os,
      templateId: template.id,
      providerId: provider.id,
      model: provider.defaultModel || provider.models[0] || "mock",
    };
  }

  async ensureChat(
    id: string,
    prompt?: string,
  ): Promise<{ board: BoardDocument; sessionId: string }> {
    const board = await this.require(id);
    if (board.chatSessionId) {
      const existing = await this.sessions.get(board.chatSessionId);
      if (existing) {
        if (prompt?.trim()) {
          await this.sessions.sendChat(board.chatSessionId, prompt.trim());
        }
        return { board, sessionId: existing.id };
      }
    }
    const defaults = await this.defaultCreateFields();
    const session = await this.sessions.create({
      ...defaults,
      title: board.title,
      kind: "board",
      runtime: "host",
      startVm: false,
      boardId: board.id,
      playbook: BOARD_PLAYBOOK,
      allowedTools: [...BOARD_CHAT_TOOLS],
      webSearch: true,
      prompt: prompt?.trim() || undefined,
    });
    const next = await this.patch(board.id, { chatSessionId: session.id });
    return { board: next, sessionId: session.id };
  }

  async runFrame(
    id: string,
    input: { frameId: string; target: BoardRunTarget },
  ): Promise<{ board: BoardDocument; sessionId: string }> {
    if (!isBoardRunTarget(input.target)) throw new Error("Pick agent, design, or plan");
    const board = await this.require(id);
    const frame = board.objects.find((row) => row.id === input.frameId && row.type === "frame");
    if (!frame) throw new Error("Frame not found");
    const brief = formatFrameBrief(board, frame.id);
    const defaults = await this.defaultCreateFields();
    const title = `${frame.text?.trim() || board.title} · ${input.target}`;
    let session;
    if (input.target === "design") {
      session = await this.sessions.create({
        ...defaults,
        title,
        kind: "design",
        startVm: true,
        prompt: brief,
      });
    } else {
      const prompt = input.target === "plan" ? `/plan\n${brief}` : brief;
      session = await this.sessions.create({
        ...defaults,
        title,
        kind: "agent",
        runtime: "docker",
        dockerImage: "locus/agent",
        startVm: true,
        prompt,
      });
    }
    const card: BoardObject = {
      id: randomUUID(),
      type: "card",
      x: frame.x + 16,
      y: frame.y + frame.h - 88,
      w: 220,
      h: 72,
      frameId: frame.id,
      cite: {
        kind: input.target === "design" ? "design" : "agent",
        sessionId: session.id,
        label: session.title,
      },
      text: session.title,
    };
    const next = await this.upsertObjects(board.id, [card]);
    return { board: next, sessionId: session.id };
  }

  async pinPlan(id: string, input: { frameId: string; sessionId: string }): Promise<BoardDocument> {
    const board = await this.require(id);
    const frame = board.objects.find((row) => row.id === input.frameId && row.type === "frame");
    if (!frame) throw new Error("Frame not found");
    const session = await this.sessions.get(input.sessionId);
    if (!session) throw new Error("Session not found");
    const plan = session.plan;
    if (!plan?.items?.length && !plan?.files?.length && !plan?.risks?.length) {
      throw new Error("That session has no plan to pin");
    }
    const objects = pinPlanObjectsToFrame(frame, plan?.items ?? [], {
      files: plan?.files,
      risks: plan?.risks,
    });
    if (!objects.length) throw new Error("Plan had no steps to pin");
    return this.upsertObjects(board.id, objects);
  }

  async executeTool(
    sessionBoardId: string | undefined,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const boardId =
      (typeof args.board_id === "string" && args.board_id.trim()) || sessionBoardId || "";
    if (name === "board_list") {
      const rows = await this.list();
      return { ok: true, output: JSON.stringify(rows, null, 2) };
    }
    if (!boardId) return { ok: false, output: "Pass board_id or use a board chat." };
    if (name === "board_get") {
      const board = await this.require(boardId);
      const frameId = typeof args.frame_id === "string" ? args.frame_id.trim() : "";
      return { ok: true, output: formatBoardSlice(board, frameId ? { frameId } : undefined) };
    }
    if (name === "board_upsert") {
      const objects = Array.isArray(args.objects) ? args.objects : [args];
      const board = await this.upsertObjects(boardId, objects);
      return {
        ok: true,
        output: `Upserted objects on ${board.title} (${board.objects.length} total)`,
      };
    }
    if (name === "board_delete") {
      const ids = Array.isArray(args.ids)
        ? args.ids.filter((row): row is string => typeof row === "string")
        : typeof args.id === "string"
          ? [args.id]
          : [];
      const board = await this.deleteObjects(boardId, ids);
      return { ok: true, output: `Removed ${ids.length} object(s) from ${board.title}` };
    }
    if (name === "board_cluster") {
      const ids = Array.isArray(args.ids)
        ? args.ids.filter((row): row is string => typeof row === "string")
        : [];
      const board = await this.require(boardId);
      const clustered = clusterBoardStickies(board.objects, ids);
      if (!clustered.frameIds.length) {
        return { ok: false, output: "Select at least two stickies to cluster." };
      }
      const next = await this.patch(boardId, { objects: clustered.objects });
      return {
        ok: true,
        output: `Clustered ${ids.length} stickies into ${clustered.frameIds.length} frame(s) on ${next.title}`,
      };
    }
    if (name === "board_comment") {
      const objectId =
        typeof args.object_id === "string" ? args.object_id : String(args.objectId ?? "");
      const body = typeof args.body === "string" ? args.body : String(args.text ?? "");
      const board = await this.addComment(boardId, { objectId, body, author: "agent" });
      return { ok: true, output: `Commented on ${objectId} (${board.comments.length} comments)` };
    }
    return { ok: false, output: `Unknown board tool ${name}` };
  }
}
