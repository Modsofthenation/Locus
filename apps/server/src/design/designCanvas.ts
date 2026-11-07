import { mkdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import type {
  AgentSession,
  AssetBuild,
  AssetPackFile,
  AssetPackManifest,
  AssetStyle,
  GameStyle,
  ChatImage,
  ChatMessage,
  CreateSessionInput,
  GoldenImage,
  LinkedAssetPrompt,
  SessionAssetRef,
} from "@locus/shared";
import {
  DESIGN_CANVAS_PATH,
  EXPLORE_DIRECTION_IDS,
  MISPLACED_DESIGN_CANVAS_RELS,
  canvasHtmlFromToolCall,
  exploreDirectionsPrompt,
  exploreGameLoopsPrompt,
  exploreAssetDirectionsPrompt,
  fallbackDesignCanvasHtml,
  fallbackGameCanvasHtml,
  fallbackAssetCanvasHtml,
  formatDesignComment,
  htmlDocumentFromText,
  htmlFromStreamingToolArgs,
  applyDesignTune,
  composePersonaInstructions,
  isBuiltinDesignSystemId,
  isCanvasSession,
  isGameSession,
  isAssetSession,
  formatPromoteGameBrief,
  formatPromoteAssetBrief,
  GAME_BRIEF_PATH,
  ASSET_BRIEF_PATH,
  ASSET_SOURCE_FILE,
  ASSET_SIDE_SOURCE_FILE,
  ASSET_BACK_SOURCE_FILE,
  ASSET_RECONSTRUCT_FILE,
  ASSET_RECONSTRUCT_JS,
  feelFromTune,
  tuneFromFeel,
  isKitGameBrief,
  mergeKitNotesIntoBrief,
  livingGameBrief,
  livingAssetBrief,
  describeAssetStudioStyle,
  lastAssetLookPrompt,
  resolveAssetStyle,
  upsertAssetStyleSection,
  resolveAssetBuild,
  upsertAssetBuildSection,
  parseGameControls,
  resolveGameKit,
  resolveAssetKit,
  lastUserPrompt,
  looksLikeHtml,
  paintDesignCanvasHtml,
  parseDesignComment,
  replaceElementText,
  resolveDesignPalette,
  resolveDesignSystem,
  sanitizePreviewPath,
  sessionRuntime,
  shouldReplaceCanvasHtml,
  GAME_FEEL_PRESETS,
  GAME_CONTENT_DEFAULTS,
  GAME_CONTENT_FILES,
  GAME_GDD_PATH,
  GAME_GENERATE_CHIPS,
  GAME_STUDIO_PATH,
  emptyGameStudio,
  formatGameStudio,
  parseBoothPayload,
  playLinkScores,
  parseGameStudio,
  splitLiveGameHtml,
  withBoothNote,
  livingGameGdd,
  generateGameAssetPrompt,
  isGameGenerateKind,
  recipeById,
  ASSET_PLAYBOOK,
  ASSET_TOOLS,
  describeGameCanvasStyle,
  upsertGameStyleSection,
  resolveGameStyle,
  ASSET_PACK_DIR,
  ASSET_PACK_MANIFEST,
  ASSET_PACK_PREVIEW,
  LINKED_ASSETS_INDEX,
  MAX_ASSET_PACK_FILE_BYTES,
  MAX_LINKED_ASSETS,
  assetPackRoleForName,
  inferAssetClips,
  inferAssetPackKind,
  linkedAssetDir,
  mimeForAssetRole,
  parseSessionAssetRefs,
  summarizeAssetPack,
  uniqueAssetSlug,
  upsertLinkedAssetsSection,
} from "@locus/shared";
import { dockerWorkspaceDir } from "@locus/hypervisor";
import type { Hub } from "../core/hub.js";
import type { JsonStore } from "../core/store.js";
import { copyDesignKitToWorkspace } from "./designKits.js";
import { addAssetStyle } from "./assetStyles.js";
import { addGameStyle } from "./gameStyles.js";
import { gameVendorDest, readGameVendorLib } from "./gameVendor.js";
import {
  formatPromoteBrief,
  parsePromoteScaffold,
  promotePlaybook,
  writePromoteBrief,
  writePromoteScaffold,
  PROMOTE_DOCKER_IMAGE,
  PROMOTE_TOOLS,
} from "./promote.js";
import {
  activateDesignVariant as applyDesignVariant,
  deleteDesignVariant as removeDesignVariantFile,
  diskDesignFiles,
  parseDesignVariants,
  registerVariantHtml,
  renameDesignVariant as renameDesignVariantMeta,
  snapshotDesignVariant,
  variantRel,
  type DesignFiles,
} from "./designVariants.js";
import { hideHarvestedCanvasChat } from "../session/agentTurn.js";
import { canvasAssetResponse, serveStaticPreview } from "../runtime/preview.js";
import type { SessionWorkspace } from "../workspace/sessionWorkspace.js";
import { collectStudioZipFiles, packStudioZip, studioZipKind } from "./studioZip.js";

export const EMPTY_CANVAS_NOTE =
  "The canvas is still empty — nothing was written to /workspace/index.html this turn. Send a follow-up to try again, or check the provider and model in Settings.";

export type DesignCanvasPorts = {
  require: (sessionId: string) => Promise<AgentSession>;
  get: (sessionId: string) => Promise<AgentSession | undefined>;
  patch: (
    sessionId: string,
    body: Partial<
      Pick<
        AgentSession,
        | "designVariants"
        | "activeVariantId"
        | "assetStyleId"
        | "gameStyleId"
        | "playToken"
        | "designTune"
        | "palette"
        | "assetPack"
        | "assetRefs"
      >
    >,
  ) => Promise<AgentSession>;
  appendMessage: (sessionId: string, message: ChatMessage) => Promise<AgentSession>;
  sendChat: (sessionId: string, content: string) => Promise<unknown>;
  workspace: SessionWorkspace;
  hub: Hub;
  store: JsonStore;
  isWorker: (session: { placement?: AgentSession["placement"] }) => boolean;
  hostRoot: (session: AgentSession) => string;
  dataDir: string;
  create: (input: CreateSessionInput) => Promise<AgentSession>;
  captureImage: (sessionId: string, name: string) => Promise<GoldenImage>;
};

function lastUserMessageIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

function now(): string {
  return new Date().toISOString();
}

/** Kit writes retry once, then throw — swallowing them left the model with no GAME.md / reconstruct / tokens. */
async function retryOnce<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch {
    return await op();
  }
}

export class DesignCanvas {
  private paints = new Map<string, Promise<void>>();
  private canvasWrites = new Map<string, Promise<void>>();
  private paintLatest = new Map<string, string>();
  private paintTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private paintedHtml = new Map<string, string>();

  private enqueueIndexWrite<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const prev = this.canvasWrites.get(sessionId) ?? Promise.resolve();
    const next = prev.then(work, work);
    this.canvasWrites.set(
      sessionId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  constructor(private readonly ports: DesignCanvasPorts) {}

  reset(): void {
    this.paints.clear();
    this.paintLatest.clear();
    for (const timer of this.paintTimers.values()) clearTimeout(timer);
    this.paintTimers.clear();
    this.paintedHtml.clear();
  }

  async readCanvas(
    sessionId: string,
  ): Promise<{ html: string | null; path: string; mtime?: string }> {
    const session = await this.ports.require(sessionId);
    if (!isCanvasSession(session)) throw new Error("Not a canvas session");
    await this.syncExploredVariants(sessionId).catch(() => undefined);
    const path = DESIGN_CANVAS_PATH;
    try {
      const file = await this.ports.workspace.readWorkspace(sessionId, "index.html");
      if (file.content.length > 1_500_000) throw new Error("Canvas file is too large");
      return { html: file.content, path, mtime: file.mtime };
    } catch (err) {
      if (err instanceof Error && err.message === "Canvas file is too large") throw err;
      return { html: null, path };
    }
  }

  async serveCanvasFile(
    sessionId: string,
    urlPath: string,
    proxyPrefix: string,
    decorate: { pick?: boolean; edit?: boolean; seq?: number; playToken?: string } = {},
  ): Promise<Response> {
    await this.readCanvas(sessionId);
    const session = await this.ports.require(sessionId);
    const rel = sanitizePreviewPath(urlPath);
    const htmlOpts = {
      ...decorate,
      guard: true as const,
      game: isGameSession(session),
      assets: isAssetSession(session),
      tune: session.designTune,
      pins: session.designPins,
    };
    if (!this.ports.isWorker(session)) {
      return serveStaticPreview(this.canvasDiskRoot(session), rel, proxyPrefix, htmlOpts);
    }
    const filePath = rel === "/" ? "index.html" : rel.replace(/^\/+/, "");
    try {
      const raw = await this.readCanvasAsset(sessionId, filePath);
      return canvasAssetResponse(rel, raw, proxyPrefix, htmlOpts);
    } catch {
      return canvasAssetResponse(rel, undefined, proxyPrefix, htmlOpts);
    }
  }

  private canvasDiskRoot(session: AgentSession): string {
    if (sessionRuntime(session) === "host") return this.ports.hostRoot(session);
    return dockerWorkspaceDir(this.ports.dataDir, session.id);
  }

  private async readCanvasAsset(sessionId: string, rel: string): Promise<Buffer | undefined> {
    try {
      const file = await this.ports.workspace.readWorkspace(sessionId, rel);
      return Buffer.from(file.content, "utf8");
    } catch (err) {
      if (err instanceof Error && err.message.includes("Binary")) {
        const raw = await this.ports.workspace.readWorkspaceRaw(sessionId, rel);
        return raw.bytes;
      }
      try {
        const raw = await this.ports.workspace.readWorkspaceRaw(sessionId, rel);
        return raw.bytes;
      } catch {
        if (err instanceof Error && err.message.includes("not found")) return undefined;
        return undefined;
      }
    }
  }

  async isEmpty(sessionId: string): Promise<boolean> {
    try {
      const canvas = await this.readCanvas(sessionId);
      return !canvas.html?.trim();
    } catch {
      return false;
    }
  }

  private async notifyIfDesignCanvasEmpty(sessionId: string): Promise<void> {
    const session = await this.ports.get(sessionId);
    if (!session || !isCanvasSession(session)) return;
    if (!(await this.isEmpty(sessionId))) return;
    if (
      session.messages.some(
        (message) =>
          message.role === "system" &&
          (message.content === EMPTY_CANVAS_NOTE ||
            message.content.includes("did not become ready")),
      )
    ) {
      return;
    }
    await this.ports
      .appendMessage(sessionId, {
        id: randomUUID(),
        role: "system",
        content: EMPTY_CANVAS_NOTE,
        createdAt: now(),
      })
      .catch(() => undefined);
  }

  async addDesignComment(sessionId: string, raw: unknown): Promise<AgentSession> {
    const session = await this.ports.require(sessionId);
    if (!isCanvasSession(session) && sessionRuntime(session) !== "docker")
      throw new Error("Not a design session");
    const comment = parseDesignComment(raw);
    if (!comment) throw new Error("Invalid design comment");
    const pin = { ...comment, id: comment.id || randomUUID() };
    await this.ports.store.mutateSession(sessionId, (current) => {
      current.designPins = [...(current.designPins ?? []), pin].slice(-24);
    });
    return this.ports.appendMessage(sessionId, {
      id: randomUUID(),
      role: "user",
      content: formatDesignComment(pin, isCanvasSession(session) ? "canvas" : "preview"),
      createdAt: now(),
    });
  }

  async createDesignVariant(
    sessionId: string,
    name?: string,
    opts?: { id?: string; keepActive?: boolean },
  ): Promise<AgentSession> {
    const session = await this.ports.require(sessionId);
    if (!isCanvasSession(session)) throw new Error("Not a canvas session");
    const next = await snapshotDesignVariant(await this.designFiles(session), session, name, opts);
    return this.ports.patch(sessionId, {
      designVariants: next.variants,
      activeVariantId: next.activeVariantId,
    });
  }

  async activateDesignVariant(sessionId: string, variantId: string): Promise<AgentSession> {
    const session = await this.ports.require(sessionId);
    if (!isCanvasSession(session)) throw new Error("Not a canvas session");
    const next = await applyDesignVariant(await this.designFiles(session), session, variantId);
    return this.ports.patch(sessionId, {
      designVariants: next.variants,
      activeVariantId: next.activeVariantId,
    });
  }

  async renameDesignVariant(
    sessionId: string,
    variantId: string,
    name: string,
  ): Promise<AgentSession> {
    const session = await this.ports.require(sessionId);
    if (!isCanvasSession(session)) throw new Error("Not a canvas session");
    const next = renameDesignVariantMeta(session, variantId, name);
    return this.ports.patch(sessionId, {
      designVariants: next.variants,
      activeVariantId: next.activeVariantId,
    });
  }

  async deleteDesignVariant(sessionId: string, variantId: string): Promise<AgentSession> {
    const session = await this.ports.require(sessionId);
    if (!isCanvasSession(session)) throw new Error("Not a canvas session");
    const next = await removeDesignVariantFile(await this.designFiles(session), session, variantId);
    return this.ports.patch(sessionId, {
      designVariants: next.variants,
      activeVariantId: next.activeVariantId,
    });
  }

  async editCanvasText(
    sessionId: string,
    raw: { selector?: string; text?: string },
  ): Promise<AgentSession> {
    const session = await this.ports.require(sessionId);
    if (!isCanvasSession(session)) throw new Error("Not a canvas session");
    if (session.status === "running") throw new Error("Wait for the current turn to finish");
    const selector = typeof raw.selector === "string" ? raw.selector.trim() : "";
    const text = typeof raw.text === "string" ? raw.text : "";
    if (!selector) throw new Error("Pick an element to edit");
    const canvas = await this.readCanvas(sessionId);
    if (!canvas.html?.trim()) throw new Error("Canvas is empty");
    const next = replaceElementText(canvas.html, selector, text.slice(0, 4000));
    if (!next) throw new Error("Could not find that element in the canvas");
    await this.enqueueIndexWrite(sessionId, () =>
      this.ports.workspace.writeWorkspace(sessionId, "index.html", next),
    );
    this.ports.hub.broadcast({ type: "canvas.updated", sessionId, html: next });
    return this.ports.require(sessionId);
  }

  async exploreDesignDirections(sessionId: string): Promise<AgentSession> {
    const session = await this.ports.require(sessionId);
    if (!isCanvasSession(session)) throw new Error("Not a canvas session");
    if (session.status === "running") throw new Error("Wait for the current turn to finish");
    const canvas = await this.readCanvas(sessionId).catch(() => ({ html: null }));
    const prompt = isGameSession(session)
      ? exploreGameLoopsPrompt(Boolean(canvas.html?.trim()))
      : isAssetSession(session)
        ? exploreAssetDirectionsPrompt(
            Boolean(canvas.html?.trim()),
            await this.resolvedAssetStyle(session),
          )
        : exploreDirectionsPrompt(Boolean(canvas.html?.trim()));
    await this.ports.sendChat(sessionId, prompt);
    return this.ports.require(sessionId);
  }

  async exportGameZip(sessionId: string): Promise<{ filename: string; zipBase64: string }> {
    const session = await this.ports.require(sessionId);
    const kind = studioZipKind(session);
    if (!kind) throw new Error("Export zip is for Games and Assets sessions");
    const html = (await this.readCanvas(sessionId).catch(() => ({ html: null }))).html;
    const files = await collectStudioZipFiles({
      sessionId,
      session,
      html,
      promoteBrief: () =>
        kind === "asset" ? this.assetPromoteBrief(session) : formatPromoteGameBrief(session),
      workspace: this.ports.workspace,
    });
    return packStudioZip(files, session.title, kind);
  }

  async finishTurn(sessionId: string): Promise<void> {
    await this.flushStreaming(sessionId).catch(() => undefined);
    await this.syncExploredVariants(sessionId).catch(() => undefined);
    await this.promoteMisplacedCanvas(sessionId).catch(() => undefined);
    await this.ensureDesignCanvas(sessionId);
    await this.ensureGameBrief(sessionId).catch(() => undefined);
    await this.ensureAssetBrief(sessionId).catch(() => undefined);
    const current = await this.ports.get(sessionId);
    if (current) await this.publish(current).catch(() => undefined);
    await this.linkGeneratedAsset(sessionId).catch(() => undefined);
  }

  private async ensureGameBrief(sessionId: string): Promise<void> {
    const session = await this.ports.get(sessionId);
    if (!session || !isGameSession(session)) return;
    let existing = "";
    try {
      existing =
        (await this.ports.workspace.readWorkspace(sessionId, GAME_BRIEF_PATH)).content ?? "";
    } catch {
      /* write a living brief */
    }
    if (existing.trim() && !isKitGameBrief(existing)) {
      await this.landGameContent(sessionId);
      return;
    }
    const canvas = await this.readCanvas(sessionId).catch(() => ({ html: null }));
    const kit = resolveGameKit(session.designSystemId);
    const kitMd = isKitGameBrief(existing) && existing.trim() ? existing : kit?.files["GAME.md"];
    await this.ports.workspace.writeWorkspace(
      sessionId,
      GAME_BRIEF_PATH,
      mergeKitNotesIntoBrief(
        livingGameBrief({
          title: session.title,
          controls: canvas.html ? parseGameControls(canvas.html) : undefined,
          feel: feelFromTune(session.designTune),
          seed: session.designTune?.seed,
        }),
        kitMd,
      ),
    );
    await this.landGameContent(sessionId);
  }

  private async ensureAssetBrief(sessionId: string): Promise<void> {
    const session = await this.ports.get(sessionId);
    if (!session || !isAssetSession(session)) return;
    try {
      const existing = await this.ports.workspace.readWorkspace(sessionId, ASSET_BRIEF_PATH);
      if (existing.content?.trim()) return;
    } catch {
      /* write a living brief */
    }
    await this.ports.workspace.writeWorkspace(
      sessionId,
      ASSET_BRIEF_PATH,
      livingAssetBrief({
        title: session.title,
        source: lastUserPrompt(session.messages)?.trim(),
        style: await this.resolvedAssetStyle(session),
        build: resolveAssetBuild(session.assetBuild),
      }),
    );
  }

  private async ensureDesignCanvas(sessionId: string): Promise<void> {
    if (!(await this.isEmpty(sessionId))) return;
    if (await this.recover(sessionId)) return;
    const session = await this.ports.get(sessionId);
    if (!session || !isCanvasSession(session)) return;
    const brief = lastUserPrompt(session.messages)?.trim();
    if (!brief) {
      await this.notifyIfDesignCanvasEmpty(sessionId);
      return;
    }
    try {
      await this.enqueueIndexWrite(sessionId, () =>
        this.ports.workspace.writeWorkspace(
          sessionId,
          "index.html",
          isGameSession(session)
            ? fallbackGameCanvasHtml(brief, resolveDesignPalette(session.palette))
            : isAssetSession(session)
              ? fallbackAssetCanvasHtml(brief, resolveDesignPalette(session.palette))
              : fallbackDesignCanvasHtml(brief, resolveDesignPalette(session.palette)),
        ),
      );
    } catch {
      await this.notifyIfDesignCanvasEmpty(sessionId);
    }
  }

  private async promoteMisplacedCanvas(sessionId: string): Promise<boolean> {
    const session = await this.ports.get(sessionId);
    if (!session || !isCanvasSession(session)) return false;
    const files = await this.designFiles(session);
    const root = await files.read("index.html");
    let best: string | undefined;
    for (const rel of MISPLACED_DESIGN_CANVAS_RELS) {
      const file = await files.read(rel);
      const candidate = file?.content.trim();
      if (!candidate || !looksLikeHtml(candidate)) continue;
      const html = htmlDocumentFromText(candidate) ?? candidate;
      if (shouldReplaceCanvasHtml(best ?? root?.content, html)) best = html;
    }
    if (!best || !shouldReplaceCanvasHtml(root?.content, best)) return false;
    await this.enqueueIndexWrite(sessionId, () =>
      this.ports.workspace.writeWorkspace(sessionId, "index.html", best),
    );
    return true;
  }

  async recover(sessionId: string): Promise<boolean> {
    if (await this.promoteMisplacedCanvas(sessionId)) return true;
    const session = await this.ports.get(sessionId);
    if (!session || !isCanvasSession(session)) return false;
    const idx = lastUserMessageIndex(session.messages);
    const after = idx >= 0 ? session.messages.slice(idx + 1) : session.messages;
    for (const message of after) {
      if (message.role === "assistant") {
        const html = htmlDocumentFromText(message.content);
        if (html) {
          await this.enqueueIndexWrite(sessionId, () =>
            this.ports.workspace.writeWorkspace(sessionId, "index.html", html),
          );
          const harvested = hideHarvestedCanvasChat(message.content, [{ name: "file_write" }]);
          if (harvested !== message.content) {
            await this.ports.store.mutateSession(sessionId, (current) => {
              const msg = current.messages.find((row) => row.id === message.id);
              if (msg) msg.content = harvested;
            });
          }
          return true;
        }
      }
      for (const call of message.toolCalls ?? []) {
        const html = canvasHtmlFromToolCall({
          name: call.name,
          arguments: call.arguments,
          result: call.result,
        });
        if (html) {
          await this.enqueueIndexWrite(sessionId, () =>
            this.ports.workspace.writeWorkspace(sessionId, "index.html", html),
          );
          return true;
        }
      }
    }
    const files = await this.designFiles(session);
    const variantIds = [
      ...EXPLORE_DIRECTION_IDS,
      ...(session.designVariants ?? []).map((row) => row.id),
    ];
    const seen = new Set<string>();
    for (const id of variantIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const file = await files.read(variantRel(id));
      if (file?.content.trim() && looksLikeHtml(file.content)) {
        await this.enqueueIndexWrite(sessionId, () =>
          this.ports.workspace.writeWorkspace(sessionId, "index.html", file.content),
        );
        return true;
      }
    }
    return false;
  }

  async syncExploredVariants(sessionId: string): Promise<void> {
    const session = await this.ports.get(sessionId);
    if (!session || !isCanvasSession(session)) return;
    const files = await this.designFiles(session);
    let variants = parseDesignVariants(session.designVariants);
    let changed = false;
    for (const [index, id] of EXPLORE_DIRECTION_IDS.entries()) {
      const file = await files.read(variantRel(id));
      if (!file?.content.trim()) continue;
      if (variants.some((row) => row.id === id)) continue;
      try {
        const next = await registerVariantHtml(
          files,
          { ...session, designVariants: variants },
          file.content,
          `Direction ${index + 1}`,
          id,
        );
        variants = next.variants;
        changed = true;
      } catch {
        /* file is already on disk; skip ghost metadata if register fails (cap, write). */
      }
    }
    let activeVariantId = session.activeVariantId;
    if (!activeVariantId || !variants.some((row) => row.id === activeVariantId)) {
      const canvas = await files.read("index.html");
      activeVariantId = variants[0]?.id;
      if (canvas?.content.trim()) {
        for (const row of variants) {
          const html = await files.read(variantRel(row.id));
          if (html?.content.trim() === canvas.content.trim()) {
            activeVariantId = row.id;
            break;
          }
        }
      }
      if (activeVariantId !== session.activeVariantId) changed = true;
    }
    if (!changed) return;
    await this.ports.patch(sessionId, {
      designVariants: variants,
      activeVariantId,
    });
  }

  private async designFiles(session: AgentSession): Promise<DesignFiles> {
    const files: DesignFiles = this.ports.isWorker(session)
      ? {
          read: async (rel) => {
            try {
              return await this.ports.workspace.readWorkspace(session.id, rel);
            } catch {
              return undefined;
            }
          },
          write: async (rel, content) => {
            await this.ports.workspace.writeWorkspace(session.id, rel, content);
          },
          remove: async () => undefined,
        }
      : diskDesignFiles(this.canvasDiskRoot(session));
    return {
      read: files.read,
      write: async (rel, content) => {
        const path = rel.replace(/^\.\//, "");
        if (path === "index.html") {
          await this.enqueueIndexWrite(session.id, () => files.write(rel, content));
          return;
        }
        await files.write(rel, content);
      },
      remove: files.remove,
    };
  }

  paintStreaming(sessionId: string, name: string, raw: string): void {
    const html = htmlFromStreamingToolArgs(name, raw);
    if (!html || html.length < 24) return;
    this.paintLatest.set(sessionId, html);
    const first = !this.paints.has(sessionId) && !this.paintTimers.has(sessionId);
    if (first) {
      this.drainPaint(sessionId);
      return;
    }
    if (this.paintTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.paintTimers.delete(sessionId);
      this.drainPaint(sessionId);
    }, 120);
    this.paintTimers.set(sessionId, timer);
  }

  private drainPaint(sessionId: string): void {
    const html = this.paintLatest.get(sessionId);
    if (html == null) return;
    this.paintLatest.delete(sessionId);
    if (this.paintedHtml.get(sessionId) === html) return;
    this.paintedHtml.set(sessionId, html);
    const prev = this.paints.get(sessionId) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        const session = await this.ports.get(sessionId);
        if (!session || !isCanvasSession(session)) return;
        const written = await this.enqueueIndexWrite(sessionId, () =>
          this.ports.workspace.writeWorkspace(sessionId, "index.html", html),
        );
        this.ports.hub.broadcast({ type: "canvas.updated", sessionId, html, mtime: written.mtime });
      })
      .catch(() => undefined);
    this.paints.set(sessionId, next);
  }

  async flushStreaming(sessionId: string): Promise<void> {
    const timer = this.paintTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.paintTimers.delete(sessionId);
    }
    this.drainPaint(sessionId);
    await this.paints.get(sessionId);
  }

  /** Restyle /workspace/index.html when the operator changes palette off-turn. */
  async paintLive(sessionId: string): Promise<void> {
    const session = await this.ports.get(sessionId);
    if (!session || !isCanvasSession(session)) return;
    try {
      const canvas = await this.readCanvas(sessionId);
      if (!canvas.html?.trim()) return;
      const system = resolveDesignSystem(
        session.designSystemId,
        await this.ports.store.loadDesignSystems(),
      );
      const painted = paintDesignCanvasHtml(
        canvas.html,
        resolveDesignPalette(session.palette),
        system ? applyDesignTune(system, session.designTune) : system,
      );
      if (painted === canvas.html) return;
      await this.enqueueIndexWrite(sessionId, () =>
        this.ports.workspace.writeWorkspace(sessionId, "index.html", painted),
      );
    } catch {
      /* Preview overlay still restyles; a canvas write should not fail the palette save. */
    }
  }

  async landKit(sessionId: string, systemId?: string): Promise<void> {
    if (!systemId || isBuiltinDesignSystemId(systemId)) return;
    const session = await this.ports.get(sessionId);
    if (!session || !isCanvasSession(session)) return;
    const runtime = sessionRuntime(session);
    if (runtime !== "docker" && runtime !== "host") return;
    if (this.ports.isWorker(session)) {
      if (!session.vmId && runtime === "docker") return;
      await retryOnce(() =>
        copyDesignKitToWorkspace(this.ports.dataDir, systemId, "", async (rel, data) => {
          await this.ports.workspace.writeWorkspaceBytes(sessionId, rel, data);
        }),
      );
      return;
    }
    const root =
      runtime === "host"
        ? this.ports.hostRoot(session)
        : dockerWorkspaceDir(this.ports.dataDir, sessionId);
    if (!root) return;
    await mkdir(root, { recursive: true });
    await retryOnce(() => copyDesignKitToWorkspace(this.ports.dataDir, systemId, root));
  }

  async landGameKit(sessionId: string, kitId?: string): Promise<void> {
    const kit = resolveGameKit(kitId);
    const session = await this.ports.get(sessionId);
    if (!session || !isGameSession(session)) return;
    await this.landGameContent(sessionId);
    if (!kit) return;
    for (const [rel, content] of Object.entries(kit.files)) {
      if (rel === GAME_BRIEF_PATH) continue;
      if (await this.workspaceHas(sessionId, rel)) continue;
      await retryOnce(() => this.ports.workspace.writeWorkspace(sessionId, rel, content));
    }
    if (kit.vendorLib) {
      const dest = gameVendorDest(kit.vendorLib);
      if (!(await this.workspaceHas(sessionId, dest))) {
        const bytes = await readGameVendorLib(kit.vendorLib);
        if (bytes) {
          await this.ports.workspace
            .writeWorkspaceBytes(sessionId, dest, bytes)
            .catch(() => undefined);
        }
      }
    }
    if (!(await this.workspaceHas(sessionId, GAME_BRIEF_PATH))) {
      await retryOnce(() =>
        this.ports.workspace.writeWorkspace(
          sessionId,
          GAME_BRIEF_PATH,
          mergeKitNotesIntoBrief(
            livingGameBrief({
              title: session.title,
              feel: feelFromTune(session.designTune),
              seed: session.designTune?.seed,
            }),
            kit.files[GAME_BRIEF_PATH],
          ),
        ),
      );
    }
  }

  private async workspaceHas(sessionId: string, rel: string): Promise<boolean> {
    try {
      const file = await this.ports.workspace.readWorkspace(sessionId, rel);
      if (file.content?.trim()) return true;
    } catch {
      /* try raw */
    }
    try {
      const raw = await this.ports.workspace.readWorkspaceRaw(sessionId, rel);
      return Boolean(raw.bytes?.length);
    } catch {
      return false;
    }
  }

  async landGameContent(sessionId: string): Promise<void> {
    const session = await this.ports.get(sessionId);
    if (!session || !isGameSession(session)) return;
    for (const rel of Object.values(GAME_CONTENT_FILES)) {
      if (await this.workspaceHas(sessionId, rel)) continue;
      const body = GAME_CONTENT_DEFAULTS[rel];
      if (!body) continue;
      await this.ports.workspace.writeWorkspace(sessionId, rel, body).catch(() => undefined);
    }
    if (!(await this.workspaceHas(sessionId, GAME_GDD_PATH))) {
      await this.ports.workspace
        .writeWorkspace(sessionId, GAME_GDD_PATH, livingGameGdd({ title: session.title }))
        .catch(() => undefined);
    }
  }

  async playLink(sessionId: string): Promise<{ token: string; url: string; lanUrls: string[] }> {
    const session = await this.ports.require(sessionId);
    if (!isGameSession(session)) throw new Error("Play link is for Games sessions");
    let token = session.playToken?.trim();
    if (!token) {
      token = `pl_${randomBytes(16).toString("hex")}`;
      await this.ports.patch(sessionId, { playToken: token });
    }
    const config = await this.ports.store.loadConfig();
    const port = config.advanced.bindPort ?? 7420;
    const { listLanAddresses } = await import("../runtime/phoneRemote.js");
    const lan = config.phoneRemote?.enabled ? listLanAddresses() : [];
    return {
      token,
      url: `http://127.0.0.1:${port}/play/${token}/`,
      lanUrls: lan.map((address) => `http://${address}:${port}/play/${token}/`),
    };
  }

  async splitLiveGame(sessionId: string): Promise<AgentSession> {
    const session = await this.ports.require(sessionId);
    if (!isGameSession(session)) throw new Error("Split is for Games sessions");
    const canvas = await this.readCanvas(sessionId);
    const split = splitLiveGameHtml(canvas.html ?? "");
    if (!split) {
      throw new Error(
        "No inline loop to split. The boot already loads game.js, or the script is too small.",
      );
    }
    await this.ports.workspace.writeWorkspace(sessionId, "game.js", split.gameJs);
    await this.enqueueIndexWrite(sessionId, () =>
      this.ports.workspace.writeWorkspace(sessionId, "index.html", split.indexHtml),
    );
    this.ports.hub.broadcast({ type: "canvas.updated", sessionId, html: split.indexHtml });
    return this.ports.require(sessionId);
  }

  async playScores(token: string): Promise<{ scores: ReturnType<typeof playLinkScores> }> {
    const sessionId = await this.sessionIdForPlayToken(token);
    if (!sessionId) throw new Error("Play link not found");
    let studio = emptyGameStudio();
    try {
      const file = await this.ports.workspace.readWorkspace(sessionId, GAME_STUDIO_PATH);
      if (file.content?.trim()) studio = parseGameStudio(JSON.parse(file.content));
    } catch {
      /* empty board until someone posts */
    }
    return { scores: playLinkScores(studio.booth) };
  }

  async appendPlayBooth(sessionId: string, raw: unknown) {
    const session = await this.ports.require(sessionId);
    if (!isGameSession(session)) throw new Error("Play booth is for Games sessions");
    const note = parseBoothPayload({
      ...(raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}),
      at: new Date().toISOString(),
    });
    if (!note) throw new Error("Add a note, a tape, or a score");
    let studio = emptyGameStudio();
    try {
      const file = await this.ports.workspace.readWorkspace(sessionId, GAME_STUDIO_PATH);
      if (file.content?.trim()) studio = parseGameStudio(JSON.parse(file.content));
    } catch {
      /* first booth note creates the studio file */
    }
    const next = withBoothNote(studio, note);
    await this.ports.workspace.writeWorkspace(sessionId, GAME_STUDIO_PATH, formatGameStudio(next));
    return note;
  }

  async sessionIdForPlayToken(token: string): Promise<string | undefined> {
    const key = token.trim();
    if (!key) return undefined;
    const sessions = await this.ports.store.loadSessions();
    return sessions.find((row) => isGameSession(row) && row.playToken === key)?.id;
  }

  async generateGameAsset(
    sessionId: string,
    kindRaw: unknown,
  ): Promise<{ game: AgentSession; asset?: AgentSession }> {
    const kind = isGameGenerateKind(kindRaw) ? kindRaw : undefined;
    if (!kind) throw new Error("kind must be sprite, sheet, mesh, or sfx");
    const game = await this.ports.require(sessionId);
    if (!isGameSession(game)) throw new Error("Generate asset is for Games sessions");
    let brief = "";
    try {
      brief = (await this.ports.workspace.readWorkspace(sessionId, GAME_BRIEF_PATH)).content ?? "";
    } catch {
      /* optional */
    }
    const prompt = generateGameAssetPrompt({ kind, title: game.title, brief });
    const chip = GAME_GENERATE_CHIPS.find((row) => row.id === kind);
    if (kind === "sfx" || !chip?.recipeId) {
      await this.ports.sendChat(sessionId, prompt);
      return { game: (await this.ports.get(sessionId)) ?? game };
    }
    if ((game.assetRefs?.length ?? 0) >= MAX_LINKED_ASSETS) {
      throw new Error(`At most ${MAX_LINKED_ASSETS} linked assets`);
    }
    const recipe = recipeById(chip.recipeId);
    const asset = await this.ports.create({
      title: `${game.title || "Game"} ${chip.title}`,
      os: game.os,
      templateId: game.templateId,
      kind: "assets",
      runtime: sessionRuntime(game) === "host" ? "host" : "docker",
      dockerImage: game.dockerImage,
      providerId: game.providerId,
      model: game.model,
      startVm: true,
      playbook: recipe?.playbook || ASSET_PLAYBOOK,
      allowedTools: recipe?.allowedTools || ASSET_TOOLS,
      designSystemId: recipe?.id === "text-to-3d" ? "three-mesh" : undefined,
      parentSessionId: game.id,
      prompt,
    });
    return { game: (await this.ports.get(sessionId)) ?? game, asset };
  }

  async linkGeneratedAsset(sessionId: string): Promise<void> {
    const session = await this.ports.get(sessionId);
    if (!session || !isAssetSession(session) || !session.parentSessionId) return;
    const parent = await this.ports.get(session.parentSessionId);
    if (!parent || !isGameSession(parent)) return;
    await this.linkAssetPacks(parent.id, [{ sessionId: session.id }]).catch(() => undefined);
  }

  async applyGameStyleBrief(sessionId: string, styleId: string): Promise<void> {
    const session = await this.ports.require(sessionId);
    if (!isGameSession(session)) return;
    const style = resolveGameStyle(styleId, await this.ports.store.loadGameStyles());
    if (!style) return;
    let existing = "";
    try {
      existing =
        (await this.ports.workspace.readWorkspace(sessionId, GAME_BRIEF_PATH)).content ?? "";
    } catch {
      /* write */
    }
    const base =
      existing.trim() && !isKitGameBrief(existing)
        ? existing
        : livingGameBrief({
            title: session.title,
            feel: feelFromTune(session.designTune),
            seed: session.designTune?.seed,
          });
    await this.ports.workspace.writeWorkspace(
      sessionId,
      GAME_BRIEF_PATH,
      upsertGameStyleSection(base, style),
    );
  }

  async saveGameStyleFromSession(
    sessionId: string,
    draft: {
      name?: string;
      summary?: string;
      guidelines?: string;
    } = {},
  ): Promise<GameStyle> {
    const session = await this.ports.require(sessionId);
    if (!isGameSession(session)) throw new Error("Not a game session");
    let brief = "";
    try {
      brief = (await this.ports.workspace.readWorkspace(sessionId, GAME_BRIEF_PATH)).content ?? "";
    } catch {
      /* optional */
    }
    const extracted = describeGameCanvasStyle({
      brief,
      title: session.title,
      prompt: lastUserPrompt(session.messages)?.trim(),
      palette: session.palette,
      juice: session.designTune
        ? session.designTune.gravity && session.designTune.gravity < 60
          ? "floaty"
          : session.designTune.gravity && session.designTune.gravity > 110
            ? "heavy"
            : "crunchy"
        : undefined,
    });
    const style = await addGameStyle(this.ports.store, {
      name: draft.name?.trim() || extracted.name,
      summary: draft.summary?.trim() || extracted.summary,
      guidelines: draft.guidelines?.trim() || extracted.guidelines,
      palette: extracted.palette ?? session.palette,
      tilePx: extracted.tilePx,
      hud: extracted.hud,
      juice: extracted.juice,
      sourceSessionId: session.id,
    });
    await this.ports.patch(sessionId, {
      gameStyleId: style.id,
      palette: style.palette,
      designTune: tuneFromFeel(GAME_FEEL_PRESETS[style.juice], session.designTune),
    });
    await this.applyGameStyleBrief(sessionId, style.id);
    return style;
  }

  async landAssetKit(sessionId: string, kitId?: string): Promise<void> {
    const session = await this.ports.get(sessionId);
    if (!session || !isAssetSession(session)) return;
    const kit = resolveAssetKit(kitId);
    const files: Record<string, string> = {
      ...(kit?.files ?? {}),
      [ASSET_RECONSTRUCT_FILE]: ASSET_RECONSTRUCT_JS,
    };
    for (const [rel, content] of Object.entries(files)) {
      await retryOnce(() => this.ports.workspace.writeWorkspace(sessionId, rel, content));
    }
  }

  async publish(session: AgentSession): Promise<void> {
    if (!isCanvasSession(session)) return;
    try {
      const canvas = await this.readCanvas(session.id);
      if (!canvas.html) return;
      if (this.paintedHtml.get(session.id) === canvas.html) return;
      this.paintedHtml.set(session.id, canvas.html);
      this.ports.hub.broadcast({
        type: "canvas.updated",
        sessionId: session.id,
        html: canvas.html,
        mtime: canvas.mtime,
      });
    } catch {
      /* canvas publish is best-effort */
    }
  }

  async promote(
    sessionId: string,
    input: { scaffold?: unknown } = {},
  ): Promise<{ agent: AgentSession; design: AgentSession }> {
    const session = await this.ports.require(sessionId);
    if (!isCanvasSession(session))
      throw new Error("Promote is for Design, Games, and Assets sessions");
    const game = isGameSession(session);
    const assets = isAssetSession(session);
    const scaffold = parsePromoteScaffold(input.scaffold, { game, assets });
    const systems = await this.ports.store.loadDesignSystems();
    const system = resolveDesignSystem(session.designSystemId, systems);
    const kit = Boolean(system?.kit);
    const image = await this.ports.captureImage(sessionId, `${session.title} promote`);
    await writePromoteScaffold(image.path, scaffold, { kit });
    if (kit && system && !isBuiltinDesignSystemId(system.id)) {
      await retryOnce(() => copyDesignKitToWorkspace(this.ports.dataDir, system.id, image.path));
    }
    const brief = game
      ? formatPromoteGameBrief(session)
      : assets
        ? await this.assetPromoteBrief(session)
        : formatPromoteBrief({ ...session, kit });
    await writePromoteBrief(image.path, brief, { game, assets });
    const agent = await this.ports.create({
      title:
        session.title.trim() &&
        session.title !== "Untitled design" &&
        session.title !== "Untitled game" &&
        session.title !== "Untitled asset"
          ? `${session.title} app`
          : game
            ? "Promoted game"
            : assets
              ? "Promoted asset"
              : "Promoted app",
      os: session.os,
      templateId: session.templateId,
      runtime: "docker",
      dockerImage: PROMOTE_DOCKER_IMAGE,
      providerId: session.providerId,
      model: session.model,
      imageId: image.id,
      playbook: [
        promotePlaybook(scaffold, kit, game, assets),
        game
          ? "Read GAME.md for the loop, controls, persistence, and comments before porting the canvas."
          : assets
            ? "Read ASSET.md for the studio, rig, export, and comments before porting the canvas."
            : "Read DESIGN.md for interview answers, comments, and palette before porting the canvas.",
      ].join("\n"),
      allowedTools: [...PROMOTE_TOOLS],
      network: session.network,
      vision: "off",
      startVm: true,
      repo: session.repo,
      repoId: session.repoId,
      sourceDesignId: session.id,
      pull: session.pull,
      palette: session.palette,
      designSystemId: session.designSystemId,
      instructions: composePersonaInstructions(session.instructions, session.persona, {
        surface: session.surface,
      }),
    });
    await this.ports.store.mutateSession(session.id, (current) => {
      current.promotedAgentId = agent.id;
      if (agent.repoId) current.repoId = current.repoId ?? agent.repoId;
      if (agent.repo) current.repo = current.repo ?? agent.repo;
      if (agent.pull) current.pull = current.pull ?? agent.pull;
    });
    const design = await this.ports.appendMessage(sessionId, {
      id: randomUUID(),
      role: "system",
      content: `Promoted to agent **${agent.title}**. This canvas stays attached to the agent, linked repo, and later PR.`,
      createdAt: now(),
    });
    return {
      agent: await this.ports.require(agent.id),
      design: (await this.ports.get(sessionId)) ?? design,
    };
  }

  async readAssetBrief(sessionId: string): Promise<string> {
    try {
      const file = await this.ports.workspace.readWorkspace(sessionId, ASSET_BRIEF_PATH);
      return file.content ?? "";
    } catch {
      return "";
    }
  }

  async applyAssetBuildBrief(sessionId: string, build: AssetBuild): Promise<void> {
    const session = await this.ports.require(sessionId);
    if (!isAssetSession(session)) return;
    const resolved = resolveAssetBuild(build);
    const existing = (await this.readAssetBrief(sessionId)).trim();
    const style = await this.resolvedAssetStyle(session);
    const base =
      existing ||
      livingAssetBrief({
        title: session.title,
        source: lastUserPrompt(session.messages)?.trim(),
        style,
        build: resolved,
      });
    await this.ports.workspace
      .writeWorkspace(
        sessionId,
        ASSET_BRIEF_PATH,
        existing ? upsertAssetBuildSection(base, resolved) : base,
      )
      .catch(() => undefined);
  }

  async applyAssetStyleBrief(sessionId: string, styleId: string): Promise<void> {
    const session = await this.ports.require(sessionId);
    if (!isAssetSession(session)) return;
    const style = resolveAssetStyle(styleId, await this.ports.store.loadAssetStyles());
    if (!style) return;
    const existing = (await this.readAssetBrief(sessionId)).trim();
    const base =
      existing ||
      livingAssetBrief({
        title: session.title,
        source: lastUserPrompt(session.messages)?.trim(),
        style,
        build: resolveAssetBuild(session.assetBuild),
      });
    await this.ports.workspace
      .writeWorkspace(
        sessionId,
        ASSET_BRIEF_PATH,
        existing ? upsertAssetStyleSection(base, style) : base,
      )
      .catch(() => undefined);
  }

  async saveAssetStyleFromSession(
    sessionId: string,
    draft: {
      name?: string;
      summary?: string;
      guidelines?: string;
    } = {},
  ): Promise<AssetStyle> {
    const session = await this.ports.require(sessionId);
    if (!isAssetSession(session)) throw new Error("Not an assets session");
    const brief = await this.readAssetBrief(sessionId);
    const canvas = await this.readCanvas(sessionId).catch(() => ({ html: null }));
    const extracted = describeAssetStudioStyle({
      brief,
      html: canvas.html,
      title: session.title,
      prompt: lastAssetLookPrompt(session.messages ?? []),
      palette: session.palette,
      build: resolveAssetBuild(session.assetBuild),
    });
    const style = await addAssetStyle(this.ports.store, {
      name: draft.name?.trim() || extracted.name,
      summary: draft.summary?.trim() || extracted.summary,
      guidelines: draft.guidelines?.trim() || extracted.guidelines,
      palette: extracted.palette ?? session.palette,
      sourceSessionId: session.id,
    });
    await this.ports.patch(sessionId, {
      assetStyleId: style.id,
      palette: style.palette,
    });
    await this.applyAssetStyleBrief(sessionId, style.id);
    return style;
  }

  async buildAssetPack(sessionId: string): Promise<AssetPackManifest | null> {
    const session = await this.ports.require(sessionId);
    if (!isAssetSession(session)) return null;
    const html = (await this.readCanvas(sessionId).catch(() => ({ html: null }))).html;
    const taken = new Set<string>();
    const slug =
      session.assetPack?.slug || uniqueAssetSlug(session.title || "asset", session.id, taken);
    const sources: Array<{ from: string; name: string }> = [
      { from: ASSET_SOURCE_FILE, name: "source.png" },
      { from: ASSET_SIDE_SOURCE_FILE, name: "source-side.png" },
      { from: ASSET_BACK_SOURCE_FILE, name: "source-back.png" },
      { from: "sheet.png", name: "sheet.png" },
      { from: "model.glb", name: "model.glb" },
      { from: "export.glb", name: "model.glb" },
      { from: "model.stl", name: "model.stl" },
      { from: "export.stl", name: "model.stl" },
      { from: ASSET_PACK_PREVIEW, name: "preview.png" },
    ];
    for (const row of sources) {
      const dest = `${ASSET_PACK_DIR}/${row.name}`;
      if (await this.workspaceHas(sessionId, dest)) continue;
      await this.copyWorkspaceFile(sessionId, row.from, sessionId, dest);
    }
    return this.persistAssetPack(session, slug, html);
  }

  async ingestAssetExport(
    sessionId: string,
    input: { format: string; mime?: string; filename?: string; contentBase64: string },
  ): Promise<AssetPackManifest> {
    const session = await this.ports.require(sessionId);
    if (!isAssetSession(session)) throw new Error("Asset pack ingest is for Assets sessions");
    const bytes = Buffer.from(String(input.contentBase64).replace(/\s/g, ""), "base64");
    if (!bytes.length) throw new Error("Empty export");
    if (bytes.length > MAX_ASSET_PACK_FILE_BYTES) throw new Error("Export is too large");
    const format = input.format.trim().toLowerCase();
    const dest =
      format === "glb"
        ? `${ASSET_PACK_DIR}/model.glb`
        : format === "stl"
          ? `${ASSET_PACK_DIR}/model.stl`
          : format === "textures"
            ? `${ASSET_PACK_DIR}/textures.zip`
            : `${ASSET_PACK_DIR}/preview.png`;
    await this.ports.workspace.writeWorkspaceBytes(sessionId, dest, bytes);
    if (format === "png" && !(await this.workspaceHas(sessionId, `${ASSET_PACK_DIR}/source.png`))) {
      await this.copyWorkspaceFile(sessionId, dest, sessionId, `${ASSET_PACK_DIR}/source.png`);
    }
    const slug =
      session.assetPack?.slug || uniqueAssetSlug(session.title || "asset", session.id, []);
    const html = (await this.readCanvas(sessionId).catch(() => ({ html: null }))).html;
    const manifest = await this.persistAssetPack(session, slug, html);
    if (!manifest) throw new Error("Could not save asset pack");
    return manifest;
  }

  async linkAssetPacks(
    sessionId: string,
    wanted: Array<{ sessionId: string; slug?: string }>,
  ): Promise<{
    refs: SessionAssetRef[];
    prompts: LinkedAssetPrompt[];
    images: ChatImage[];
  }> {
    const session = await this.ports.require(sessionId);
    if (isAssetSession(session) || !isCanvasSession(session)) {
      return { refs: session.assetRefs ?? [], prompts: [], images: [] };
    }
    const existing = parseSessionAssetRefs(session.assetRefs) ?? [];
    const merged: SessionAssetRef[] = [...existing];
    const seen = new Set(merged.map((row) => row.sessionId));
    for (const row of wanted) {
      const id = row.sessionId.trim();
      if (!id || seen.has(id) || id === sessionId) continue;
      const asset = await this.ports.get(id);
      if (!asset || !isAssetSession(asset) || asset.archived) continue;
      seen.add(id);
      merged.push({
        sessionId: id,
        slug: row.slug || asset.assetPack?.slug || uniqueAssetSlug(asset.title, asset.id, []),
        title: asset.title,
        kind: asset.assetPack?.kind,
      });
      if (merged.length >= MAX_LINKED_ASSETS) break;
    }
    const taken = new Set<string>();
    const refs: SessionAssetRef[] = [];
    const prompts: LinkedAssetPrompt[] = [];
    const images: ChatImage[] = [];
    for (const row of merged) {
      const asset = await this.ports.get(row.sessionId);
      if (!asset || !isAssetSession(asset) || asset.archived) {
        keepLinkedAssetSlug(refs, taken, row);
        continue;
      }
      const pack = (await this.buildAssetPack(asset.id).catch(() => null)) ?? null;
      if (!pack) {
        keepLinkedAssetSlug(refs, taken, row);
        continue;
      }
      const prev = existing.find((item) => item.sessionId === asset.id);
      const slug = prev?.slug || uniqueAssetSlug(pack.slug || asset.title, asset.id, taken);
      taken.add(slug.toLowerCase());
      const dir = linkedAssetDir(slug);
      const packMtime = Date.parse(pack.updatedAt) || Date.now();
      const stale = !prev || prev.slug !== slug || (prev.packMtime ?? 0) < packMtime;
      if (stale) {
        for (const file of pack.files) {
          await this.copyWorkspaceFile(
            asset.id,
            `${ASSET_PACK_DIR}/${file.name}`,
            sessionId,
            `${dir}/${file.name}`,
          );
        }
      }
      const files = pack.files;
      const prompt: LinkedAssetPrompt = {
        slug,
        title: pack.title || asset.title,
        kind: pack.kind,
        dir,
        files,
        clips: pack.clips,
        frameWidth: pack.frameWidth,
        frameHeight: pack.frameHeight,
        columns: pack.columns,
        rows: pack.rows,
      };
      prompts.push(prompt);
      refs.push({
        sessionId: asset.id,
        slug,
        title: prompt.title,
        kind: pack.kind,
        packMtime,
      });
      const preview = files.find(
        (file) => file.role === "preview" || file.role === "source" || file.role === "sheet",
      );
      if (preview) {
        const image = await this.readPackImage(
          asset.id,
          `${ASSET_PACK_DIR}/${preview.name}`,
          preview.mime,
        );
        if (image) images.push(image);
      }
    }
    await this.writeLinkedAssetsIndex(sessionId, prompts);
    if (isGameSession(session)) await this.upsertGameLinkedAssets(sessionId, prompts);
    await this.ports.patch(sessionId, { assetRefs: refs });
    return { refs, prompts, images };
  }

  private async persistAssetPack(
    session: AgentSession,
    slug: string,
    html?: string | null,
  ): Promise<AssetPackManifest | null> {
    const files = await this.listPackFiles(session.id);
    const clips = inferAssetClips(html);
    const kind = inferAssetPackKind({ html, files, clips });
    const style = await this.resolvedAssetStyle(session);
    const manifest: AssetPackManifest = {
      version: 1,
      sessionId: session.id,
      title: session.title?.trim() || slug,
      slug,
      kind,
      clips,
      files,
      styleName: style?.name,
      updatedAt: now(),
    };
    await this.ports.workspace
      .writeWorkspace(session.id, ASSET_PACK_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
      .catch(() => undefined);
    await this.ports
      .patch(session.id, { assetPack: summarizeAssetPack(manifest) })
      .catch(() => undefined);
    return manifest;
  }

  private async listPackFiles(sessionId: string): Promise<AssetPackFile[]> {
    const files: AssetPackFile[] = [];
    const seen = new Set<string>();
    try {
      const listed = await this.ports.workspace.listWorkspace(sessionId, ASSET_PACK_DIR, "2");
      for (const row of listed.entries) {
        if (row.type === "dir") continue;
        const rel = row.path.replace(/^\.\//, "");
        const name = rel.startsWith(`${ASSET_PACK_DIR}/`)
          ? rel.slice(ASSET_PACK_DIR.length + 1)
          : row.name;
        if (!name || name === "manifest.json" || seen.has(name)) continue;
        const role = assetPackRoleForName(name);
        if (!role) continue;
        seen.add(name);
        files.push({ name, role, mime: mimeForAssetRole(role) });
      }
    } catch {
      /* listing is optional */
    }
    return files;
  }

  private async readPackImage(
    sessionId: string,
    rel: string,
    mime: string,
  ): Promise<ChatImage | undefined> {
    try {
      const raw = await this.ports.workspace.readWorkspaceRaw(sessionId, rel);
      if (!raw.bytes?.length) return undefined;
      return {
        mime: mime.startsWith("image/") ? mime : "image/png",
        name: rel.replace(/^.*\//, ""),
        base64: Buffer.from(raw.bytes).toString("base64"),
      };
    } catch {
      return undefined;
    }
  }

  private async copyWorkspaceFile(
    fromId: string,
    fromRel: string,
    toId: string,
    toRel: string,
  ): Promise<boolean> {
    try {
      const raw = await this.ports.workspace.readWorkspaceRaw(fromId, fromRel);
      if (!raw?.bytes?.length || raw.bytes.length > MAX_ASSET_PACK_FILE_BYTES) return false;
      await this.ports.workspace.writeWorkspaceBytes(toId, toRel, raw.bytes);
      return true;
    } catch {
      return false;
    }
  }

  private async writeLinkedAssetsIndex(
    sessionId: string,
    assets: LinkedAssetPrompt[],
  ): Promise<void> {
    const body = {
      assets: assets.map((asset) => ({
        slug: asset.slug,
        title: asset.title,
        kind: asset.kind,
        dir: asset.dir,
        files: asset.files,
        clips: asset.clips,
        frameWidth: asset.frameWidth,
        frameHeight: asset.frameHeight,
        columns: asset.columns,
        rows: asset.rows,
      })),
    };
    await this.ports.workspace
      .writeWorkspace(sessionId, LINKED_ASSETS_INDEX, `${JSON.stringify(body, null, 2)}\n`)
      .catch(() => undefined);
  }

  private async upsertGameLinkedAssets(
    sessionId: string,
    assets: LinkedAssetPrompt[],
  ): Promise<void> {
    try {
      const current = await this.ports.workspace.readWorkspace(sessionId, GAME_BRIEF_PATH);
      const next = upsertLinkedAssetsSection(current.content ?? "", assets);
      if (next !== current.content) {
        await this.ports.workspace.writeWorkspace(sessionId, GAME_BRIEF_PATH, next);
      }
    } catch {
      await this.ports.workspace
        .writeWorkspace(sessionId, GAME_BRIEF_PATH, upsertLinkedAssetsSection("", assets))
        .catch(() => undefined);
    }
  }

  private async resolvedAssetStyle(session: AgentSession) {
    return resolveAssetStyle(session.assetStyleId, await this.ports.store.loadAssetStyles());
  }

  private async assetPromoteBrief(session: AgentSession) {
    const style = await this.resolvedAssetStyle(session);
    return formatPromoteAssetBrief({
      ...session,
      assetStyleName: style?.name,
      assetBuild: resolveAssetBuild(session.assetBuild),
    });
  }
}

function keepLinkedAssetSlug(
  refs: SessionAssetRef[],
  taken: Set<string>,
  row: SessionAssetRef,
): void {
  const slug = row.slug?.trim();
  if (!slug || taken.has(slug.toLowerCase())) return;
  taken.add(slug.toLowerCase());
  refs.push(row);
}
