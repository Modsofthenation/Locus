import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CURSOR_CODING_ROUTING_CARD,
  CURSOR_DESIGN_ROUTING_CARD,
  CURSOR_GAME_ROUTING_CARD,
  CURSOR_ASSET_ROUTING_CARD,
  CURSOR_REVIEW_FOLLOWUP_CARD,
  CURSOR_REVIEW_ROUTING_CARD,
} from "@locus/shared";
import { excludeLocusCursorWorkspaceFiles } from "./cursorCliMcp.js";

/** Workspace rule Cursor CLI loads as a stable always-on prefix. */
export const LOCUS_CURSOR_RULE_REL = ".cursor/rules/locus.mdc";

export function formatLocusCursorRule(input: {
  review?: boolean;
  design?: boolean;
  game?: boolean;
  assets?: boolean;
  coding?: boolean;
  instructions?: string;
  playbook?: string;
}): string | undefined {
  const sections = [
    input.review ? CURSOR_REVIEW_ROUTING_CARD : "",
    input.review ? CURSOR_REVIEW_FOLLOWUP_CARD : "",
    input.game
      ? CURSOR_GAME_ROUTING_CARD
      : input.assets
        ? CURSOR_ASSET_ROUTING_CARD
        : input.design
          ? CURSOR_DESIGN_ROUTING_CARD
          : input.coding
            ? CURSOR_CODING_ROUTING_CARD
            : "",
    input.instructions?.trim() ? `Operator instructions:\n${input.instructions.trim()}` : "",
    input.playbook?.trim() ? `Playbook:\n${input.playbook.trim()}` : "",
  ].filter(Boolean);
  if (!sections.length) return undefined;
  return [
    "---",
    "description: Locus Cursor CLI session routing",
    "alwaysApply: true",
    "---",
    "",
    ...sections,
    "",
  ].join("\n");
}

export async function writeLocusCursorRule(input: {
  workspace: string;
  review?: boolean;
  design?: boolean;
  game?: boolean;
  assets?: boolean;
  coding?: boolean;
  instructions?: string;
  playbook?: string;
}): Promise<string | undefined> {
  const body = formatLocusCursorRule(input);
  if (!body) return undefined;
  const file = join(input.workspace, ".cursor", "rules", "locus.mdc");
  await mkdir(dirname(file), { recursive: true });
  try {
    if ((await readFile(file, "utf8")) === body) {
      await excludeLocusCursorWorkspaceFiles(input.workspace);
      return file;
    }
  } catch {
    /* missing */
  }
  await writeFile(file, body);
  await excludeLocusCursorWorkspaceFiles(input.workspace);
  return file;
}
