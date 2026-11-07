import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolResult } from "@locus/guest-agent";
import type { AgentCanvasRef, AgentSession } from "@locus/shared";
import {
  prepareAgentCanvasWrite,
  resolveAgentCanvasId,
  sessionOffersAgentCanvas,
  upsertAgentCanvas,
} from "@locus/shared";

const ID_RE = /^[a-z0-9-]{1,40}$/;

export class AgentCanvases {
  constructor(private readonly dataDir: string) {}

  private dir(sessionId: string): string {
    return join(this.dataDir, "agent-canvases", sessionId);
  }

  private file(sessionId: string, id: string): string {
    return join(this.dir(sessionId), `${id}.html`);
  }

  async writeHtml(sessionId: string, id: string, html: string): Promise<void> {
    if (!ID_RE.test(id)) throw new Error("Invalid canvas id");
    await mkdir(this.dir(sessionId), { recursive: true });
    await writeFile(this.file(sessionId, id), html, "utf8");
  }

  async readHtml(sessionId: string, id: string): Promise<string | undefined> {
    if (!ID_RE.test(id)) return undefined;
    try {
      return await readFile(this.file(sessionId, id), "utf8");
    } catch {
      return undefined;
    }
  }

  async copy(fromId: string, toId: string): Promise<void> {
    try {
      await cp(this.dir(fromId), this.dir(toId), { recursive: true });
    } catch {
      /* source chat had no canvas files */
    }
  }

  async remove(sessionId: string): Promise<void> {
    await rm(this.dir(sessionId), { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function runAgentCanvasTool(
  files: AgentCanvases,
  session: AgentSession,
  name: string,
  args: Record<string, unknown>,
  save: (canvases: AgentCanvasRef[]) => Promise<void>,
): Promise<ToolResult> {
  if (!sessionOffersAgentCanvas(session)) {
    return {
      ok: false,
      output:
        "canvas_write is for coding and review agents. Design, Games, and Assets write /workspace/index.html.",
    };
  }
  if (name === "canvas_read") {
    const ref = resolveAgentCanvasId(session.agentCanvases, args.id);
    if (!ref) return { ok: true, output: "No canvas yet. Call canvas_write with title and html." };
    const html = await files.readHtml(session.id, ref.id);
    if (!html) return { ok: false, output: `Canvas ${ref.id} is missing on disk.` };
    return {
      ok: true,
      output: `Canvas ${ref.title} (${ref.id}), updated ${ref.updatedAt}\n\n${html}`,
    };
  }
  if (name !== "canvas_write") return { ok: false, output: `Unknown canvas tool ${name}` };
  const prepared = prepareAgentCanvasWrite(args);
  if (!prepared.ok) return { ok: false, output: prepared.error };
  const updatedAt = new Date().toISOString();
  const applied = upsertAgentCanvas(session.agentCanvases, {
    id: prepared.id,
    title: prepared.title,
    updatedAt,
  });
  if (!applied.ok) return { ok: false, output: applied.error };
  await files.writeHtml(session.id, prepared.id, prepared.html);
  await save(applied.canvases);
  return {
    ok: true,
    output: `Canvas "${prepared.title}" (${prepared.id}) is open beside the chat. Tell the operator the title. To change it, canvas_write again with id ${prepared.id} and the full html.`,
  };
}
