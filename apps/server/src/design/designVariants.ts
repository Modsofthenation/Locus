import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSession, DesignVariant } from "@locus/shared";
import { readWorkspaceFile, writeWorkspaceFile } from "../workspace/workspaceFiles.js";

export const MAX_DESIGN_VARIANTS = 12;
export const VARIANT_DIR = ".locus-variants";

export interface DesignFiles {
  read(rel: string): Promise<{ content: string } | undefined>;
  write(rel: string, content: string): Promise<void>;
  remove(rel: string): Promise<void>;
}

export function diskDesignFiles(root: string): DesignFiles {
  return {
    read: (rel) => readWorkspaceFile(root, rel),
    write: async (rel, content) => {
      await writeWorkspaceFile(root, rel, content);
    },
    remove: async (rel) => {
      await unlink(join(root, rel)).catch(() => undefined);
    },
  };
}

export function sanitizeVariantName(raw?: string): string {
  const cleaned = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  return cleaned || "Variant";
}

export function parseDesignVariants(raw: unknown): DesignVariant[] {
  if (!Array.isArray(raw)) return [];
  const out: DesignVariant[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const name = sanitizeVariantName(typeof value.name === "string" ? value.name : "");
    if (!id || !/^[A-Za-z0-9._-]+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
    if (out.length >= MAX_DESIGN_VARIANTS) break;
  }
  return out;
}

export function variantRel(id: string): string {
  return `${VARIANT_DIR}/${id}.html`;
}

export async function registerVariantHtml(
  files: DesignFiles,
  session: AgentSession,
  html: string,
  name: string,
  id: string,
): Promise<{ variants: DesignVariant[]; activeVariantId: string }> {
  const variants = parseDesignVariants(session.designVariants);
  if (!html.trim()) throw new Error("Canvas is empty");
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error("Invalid variant id");
  const existing = variants.find((row) => row.id === id);
  if (!existing && variants.length >= MAX_DESIGN_VARIANTS)
    throw new Error(`At most ${MAX_DESIGN_VARIANTS} variants`);
  await files.write(variantRel(id), html);
  const next = existing
    ? variants.map((row) => (row.id === id ? { ...row, name: sanitizeVariantName(name) } : row))
    : [...variants, { id, name: sanitizeVariantName(name) }];
  return { variants: next, activeVariantId: id };
}

export async function snapshotDesignVariant(
  files: DesignFiles,
  session: AgentSession,
  name?: string,
  opts?: { id?: string; keepActive?: boolean },
): Promise<{ variants: DesignVariant[]; activeVariantId?: string }> {
  const canvas = await files.read("index.html");
  if (!canvas?.content.trim()) throw new Error("Canvas is empty");
  const variants = parseDesignVariants(session.designVariants);
  const requested = opts?.id?.trim() ?? "";
  const id =
    requested && /^[A-Za-z0-9._-]+$/.test(requested) ? requested : randomUUID().slice(0, 8);
  const existing = variants.find((row) => row.id === id);
  if (!existing && variants.length >= MAX_DESIGN_VARIANTS)
    throw new Error(`At most ${MAX_DESIGN_VARIANTS} variants`);
  await files.write(variantRel(id), canvas.content);
  const label = sanitizeVariantName(name) || existing?.name || `Variant ${variants.length + 1}`;
  const next = existing
    ? variants.map((row) => (row.id === id ? { ...row, name: label } : row))
    : [...variants, { id, name: label }];
  return {
    variants: next,
    activeVariantId: opts?.keepActive ? session.activeVariantId : id,
  };
}

export async function activateDesignVariant(
  files: DesignFiles,
  session: AgentSession,
  variantId: string,
): Promise<{ variants: DesignVariant[]; activeVariantId: string }> {
  const variants = parseDesignVariants(session.designVariants);
  const found = variants.find((row) => row.id === variantId);
  if (!found) throw new Error("Unknown variant");
  const file = await files.read(variantRel(found.id));
  if (!file?.content) throw new Error("Variant file is missing");
  await files.write("index.html", file.content);
  return { variants, activeVariantId: found.id };
}

export function renameDesignVariant(
  session: AgentSession,
  variantId: string,
  name: string,
): { variants: DesignVariant[]; activeVariantId?: string } {
  const variants = parseDesignVariants(session.designVariants);
  const found = variants.find((row) => row.id === variantId);
  if (!found) throw new Error("Unknown variant");
  found.name = sanitizeVariantName(name);
  return { variants, activeVariantId: session.activeVariantId };
}

export async function deleteDesignVariant(
  files: DesignFiles,
  session: AgentSession,
  variantId: string,
): Promise<{ variants: DesignVariant[]; activeVariantId?: string }> {
  const variants = parseDesignVariants(session.designVariants).filter(
    (row) => row.id !== variantId,
  );
  if (variants.length === parseDesignVariants(session.designVariants).length)
    throw new Error("Unknown variant");
  await files.remove(variantRel(variantId));
  const activeVariantId =
    session.activeVariantId === variantId ? variants[0]?.id : session.activeVariantId;
  return { variants, activeVariantId };
}
