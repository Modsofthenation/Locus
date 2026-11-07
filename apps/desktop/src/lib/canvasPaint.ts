import {
  applyDesignTune,
  isAssetSession,
  isGameSession,
  paintDesignCanvasHtml,
  resolveDesignPalette,
  resolveDesignSystem,
  withAssetChromeHook,
  withAssetPoseCss,
  withGameChromeHook,
  withGameFeelCss,
  type AgentSession,
  type DesignComment,
  type DesignPalette,
  type DesignSystem,
} from "@locus/shared";
import { prepareCanvasHtml } from "./canvasHtml";

export type CanvasPaintInput = {
  html: string;
  session: Pick<AgentSession, "id" | "kind" | "palette" | "designSystemId" | "designTune">;
  systems: DesignSystem[];
  /** Optimistic operator palette; falls back to the Session palette. */
  palette?: DesignPalette;
};

/** Design paint plus Game feel / Asset pose. */
export function paintCanvasHtml(input: CanvasPaintInput): string {
  const palette = resolveDesignPalette(input.palette ?? input.session.palette);
  const system = resolveDesignSystem(input.session.designSystemId, input.systems);
  const painted = paintDesignCanvasHtml(
    input.html,
    palette,
    system ? applyDesignTune(system, input.session.designTune) : system,
  );
  if (isGameSession(input.session)) return withGameFeelCss(painted, input.session.designTune);
  if (isAssetSession(input.session)) return withAssetPoseCss(painted, input.session.designTune);
  return painted;
}

export type CanvasSrcDocInput = CanvasPaintInput & {
  interaction?: boolean | "comment" | "edit" | "inspect";
  filesBase?: string;
  pins?: DesignComment[];
};

/** Paint, then prepare srcDoc and attach Game / Asset chrome hooks. */
export function paintCanvasSrcDoc(input: CanvasSrcDocInput): string {
  return finishCanvasSrcDoc(paintCanvasHtml(input), input);
}

/** Prepare already-painted HTML for an iframe srcDoc. */
export function finishCanvasSrcDoc(
  paintedHtml: string,
  input: Pick<CanvasSrcDocInput, "session" | "interaction" | "filesBase" | "pins">,
): string {
  const game = isGameSession(input.session);
  const assets = isAssetSession(input.session);
  const prepared = prepareCanvasHtml(
    paintedHtml,
    input.interaction ?? false,
    input.filesBase,
    game || assets,
    input.pins,
  );
  if (game) return withGameChromeHook(prepared);
  if (assets) return withAssetChromeHook(prepared);
  return prepared;
}
