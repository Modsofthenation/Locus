import { SEARCH_WANDER_NUDGE, VERIFY_NUDGE } from "./codingLoop.js";
import { OPS_ROUTING_NUDGE } from "./opsRouting.js";
import { REVIEW_ROUTING_NUDGE } from "./reviewRouting.js";
import { REVIEW_VERDICT_NUDGE } from "./verdict.js";
import { isAdherenceNudge } from "./models/designAdherence.js";
import { DESIGN_QUALITY_NUDGE } from "./models/designQuality.js";

export const MAX_SELF_CORRECTS_PER_TURN = 2;
export const MAX_CANVAS_NUDGES = 2;

export const SELF_CORRECT_NUDGE =
  "The last tool failed with a diagnosable error. Do not bounce this to the operator. Read the output, form a hypothesis, and retry a focused fix. Update task_list if the plan changed.";

export const SELF_CORRECT_PATCH_NUDGE =
  "The patch did not apply. Re-read the target span with file_read offset/limit, then apply_patch with matching context. Do not rewrite the whole file unless the patch is impossible. Delete leftover .orig/.rej.";

export const SELF_CORRECT_TEST_NUDGE =
  "Tests failed. Read the FAIL lines, form one hypothesis, apply_patch the focused fix, and re-run the same command. Do not start a new approach until this failure is gone. Do not retry git_push / git_pr until the same tests pass.";

export const SELF_CORRECT_MISSING_NUDGE =
  "The path or command was not found. glob or file_list for the real path, then retry. Do not invent directories.";

export const SELF_CORRECT_CORS_NUDGE =
  "The canvas was tainted by a cross-origin image. Set img.crossOrigin='anonymous' before src, wrap pixel reads in try/catch, and screenshot once. Do not iterate flood-fill or click Wireframe in a loop.";

export const DESIGN_LOOK_NUDGE =
  "You wrote the canvas but did not look at it. Call playwright once (screenshot the page; click a primary control if any). Then patch visual bugs — overflow, contrast, overlapping text, empty states, generic purple gradients. Do not stop after the first paint.";

export const HOST_FALLBACK_NUDGE =
  "The live canvas is a last-resort host stub, not a model draft. Rewrite /workspace/index.html as a real distinctive Design page, playable juicy game, or wired 3D studio for this brief. Cosmetic edits that keep the stub body still fail. Do not polish type, juice, or orbit on the stub. Then playwright-click and screenshot.";

export function canvasQualityNudge(hostFallback: boolean): string {
  return hostFallback ? HOST_FALLBACK_NUDGE : DESIGN_QUALITY_NUDGE;
}

export type FixableFailureKind = "patch" | "test" | "missing" | "cors" | "generic";

export function classifyFixableFailure(output: string): FixableFailureKind {
  const text = output ?? "";
  if (/tainted by cross-origin/i.test(text)) return "cors";
  if (
    /failed to apply|does not apply|hunks? failed|corrupt patch|ApplyPatch|fuzz \d+|patch did not apply/i.test(
      text,
    )
  ) {
    return "patch";
  }
  if (
    /Harness blocked git_(?:push|pr): tests failed|\bAssertionError\b|\bFAIL\b.{0,80}(test|spec)|tests? failed/i.test(
      text,
    )
  ) {
    return "test";
  }
  if (/\bENOENT\b|No such file or directory|not found|EACCES/i.test(text)) return "missing";
  return "generic";
}

export function selfCorrectNudge(error: string): string {
  switch (classifyFixableFailure(error)) {
    case "patch":
      return SELF_CORRECT_PATCH_NUDGE;
    case "test":
      return SELF_CORRECT_TEST_NUDGE;
    case "missing":
      return SELF_CORRECT_MISSING_NUDGE;
    case "cors":
      return SELF_CORRECT_CORS_NUDGE;
    default:
      return SELF_CORRECT_NUDGE;
  }
}

export const EMPTY_CANVAS_NUDGE =
  "The canvas is still empty — /workspace/index.html was not written. Do not claim the page is live. If the brief names a public product, company, or site, websearch then file_write. If audience, outcome, or tone is still unclear after that, you may ask_user once. Otherwise call file_write now with path /workspace/index.html and a complete self-contained HTML document. Do not only describe the design.";

export const DESIGN_MUTATE_NUDGE =
  "You have not changed /workspace/index.html this turn. Call apply_patch or file_write now. Do not only describe the change.";

export const INCOMPLETE_CANVAS_NUDGE =
  "/workspace/index.html is truncated or unfinished (missing </html>, an unclosed <script>, or a placeholder like /*__GAME__*/). The live canvas only renders that file — sidecar files such as parts/ are not shown. Continue the same document with apply_patch, or file_write a smaller complete HTML page that closes </html> and includes the real script (not a stub). Keep the next draft short enough to finish in one call (a playable skeleton first). Do not split the page into other files.";

export const UNPLAYABLE_GAME_NUDGE =
  "The canvas HTML is complete but the loop is not playable yet (missing input, a score/win/lose, or restart). Read GAME.md and .locus-game/last-run.json if they exist. Patch /workspace/index.html so the first minute has a goal, keyboard/pointer input, a score or win/lose, and a restart. Expose window.__locusGame = { reset, pause, resume, debug, stats, mute, seed, replay }. Honor feel CSS vars. Do not rewrite the whole page if a small patch will do.";

export const GAME_JUICE_NUDGE =
  "The loop is playable but dry (no hit flash, screenshake, particles, or Web Audio). Patch /workspace/index.html with a juice pass only: hit flash, screenshake, particles, or a beep. Do not change the win condition. Keep it playable. Then playwright-click and drive until stats.time moves.";

export const GAME_PLAYWRIGHT_NUDGE =
  "You changed the game canvas (or only ran a Node syntax check or HUD expect). That is not a playtest. Call playwright against the live canvas, click the new control (or Restart / the first type=button), drive (press / autodrive) until stats.time moves, then screenshot. Do not npm install Playwright, do not write a spec file, and do not treat .locus-game/_chk.mjs, new Function(html), or expect of road # / bumps as proof the iframe works.";

export const GAME_CANVAS_WIPE_NUDGE =
  "index.html just shrank or lost </html>. A StrReplace fragment is not the live canvas — do not Write overlay snippets. The host restores the last good document. Continue with apply_patch / StrReplace, not Write.";

export const GAME_CANVAS_RESTORE_NOTE =
  "Restored /workspace/index.html from the last good canvas after a wipe. Continue with apply_patch / StrReplace, not Write. Locus does not paint searchReplace streamContent as the whole file. If Cursor said the file changed on disk, re-read and retry the patch.";

export const GAME_MUTATE_NUDGE =
  "You have not changed the playable canvas for this request. Patch /workspace/index.html in place (apply_patch / StrReplace) so the operator's new control exists — do not only playtest Restart or HUD labels. Do not Write a snippet. Then playwright-click the new control (not only Restart) and drive until stats.time moves.";

export const LOCUS_CANVAS_CHANGED_ON_DISK =
  "Locus live-paint/restore wrote the canvas; re-read index.html and retry with apply_patch. This is not a model Write.";

export const GAME_CANVAS_IFRAME_NUDGE =
  "The operator preview is a sandboxed iframe (unique origin, sandbox=allow-scripts). Clicks stay inside that document — there is no parent DOM. Play mode only forwards keys. Do not guess with z-index or click retargeting. Call playwright to click the visible control and screenshot. Keep HUD/menu above the game canvas; buttons need type=button; do not let a full-size canvas eat pointer events.";

export const UNWIRED_ASSET_NUDGE =
  "The studio claims 3D but index.html has no mesh (no <canvas>, WebGL, or vendored Three). CSS preserve-3d, a photo on a div, and HUD labels such as css-3d or 3D mesh are not a wired 3D model. This turn failed the first-viewable contract. Patch in place: punch out ./source.png with ./vendor/reconstruct.js (reconstructFromPhoto) → a hull with orbit and albedo on the subject only → texture if Texture is on. Skip the rig until the hull is on the canvas. Write ASSET.md after the first viewable mesh. Do not rewrite the whole page if a small patch will do.";

export const ASSET_SCULPT_NUDGE =
  "The studio is a placeholder 3D mesh (empty Three scene, BoxGeometry grey cube, or a photo billboard — not a subject). Patch /workspace/index.html with a sculpt pass only: reconstructFromPhoto on ./source.png, GLTFLoader on a linked model, or a distinctive ExtrudeGeometry / BufferGeometry hull — not an import-only canvas or a primitive grey box. Keep orbit and window.__locusAsset. Then playwright-click #btnWire or the mesh and screenshot.";

export const ASSET_PLAYWRIGHT_NUDGE =
  "You changed the asset studio (or only checked HUD text). That is not a playtest. Call playwright against the live canvas once, click #btnWire or the mesh (not only Walk/Idle), and screenshot. The PNG is returned as an image. If the shot or page error is SecurityError / tainted canvas, set img.crossOrigin='anonymous' before src — relative photos switch the operator iframe to canvas-files HTTP automatically. Do not treat expect_text of css-3d, 3D mesh, verts, or tris as proof the mesh exists. Do not click Wireframe in a loop, do not file_read PNGs, do not npm install Playwright, and do not write a spec file.";

export const ASSET_CANVAS_WIPE_NUDGE =
  "index.html just shrank or lost </html> — a snippet Write replaced the studio. Stop. Restore the previous document (rewind, or rewrite the full HTML that closes </html>). Do not keep patching a one-line file. Later edits must use apply_patch / StrReplace, not Write.";

export const UNUSED_LINKED_ASSETS_PREFIX =
  "You linked operator assets but /workspace/index.html does not load them.";

export const ASSET_CANVAS_IFRAME_NUDGE =
  "The operator preview is a sandboxed iframe (unique origin) until relative photos or scripts switch it to canvas-files HTTP. Relative photos (./source.png, .locus-attachments) taint canvas getImageData / toDataURL unless img.crossOrigin='anonymous' is set before src. Wrap pixel reads in try/catch. Catch SecurityError — do not iterate flood-fill if pixels cannot be read. Do not call preview. One playwright screenshot is enough unless it shows a real defect.";

export const PROVIDER_TURN_RECOVERY =
  "The provider dropped this round, but workspace files are unchanged. Send another message to continue from the current diff — do not restart the investigation or decode screenshots with Python.";

export const PROCESS_DONE_NUDGE =
  "A background process started with start_process has exited. Read the tail, then continue or restart it. Do not ignore a dead server or a finished test job.";

export function isHiddenChatMessage(message: {
  hidden?: boolean;
  role?: string;
  content?: string;
}): boolean {
  if (message.hidden) return true;
  return (
    message.role === "system" &&
    (message.content === SELF_CORRECT_NUDGE ||
      message.content === SELF_CORRECT_PATCH_NUDGE ||
      message.content === SELF_CORRECT_TEST_NUDGE ||
      message.content === SELF_CORRECT_MISSING_NUDGE ||
      message.content === SELF_CORRECT_CORS_NUDGE ||
      message.content === EMPTY_CANVAS_NUDGE ||
      message.content === DESIGN_MUTATE_NUDGE ||
      message.content === DESIGN_LOOK_NUDGE ||
      message.content === DESIGN_QUALITY_NUDGE ||
      message.content === HOST_FALLBACK_NUDGE ||
      message.content === GAME_MUTATE_NUDGE ||
      message.content === INCOMPLETE_CANVAS_NUDGE ||
      message.content === UNPLAYABLE_GAME_NUDGE ||
      message.content === GAME_JUICE_NUDGE ||
      message.content === GAME_PLAYWRIGHT_NUDGE ||
      message.content === GAME_CANVAS_WIPE_NUDGE ||
      message.content === GAME_CANVAS_RESTORE_NOTE ||
      message.content === GAME_CANVAS_IFRAME_NUDGE ||
      message.content === UNWIRED_ASSET_NUDGE ||
      message.content === ASSET_SCULPT_NUDGE ||
      message.content === ASSET_PLAYWRIGHT_NUDGE ||
      message.content === ASSET_CANVAS_WIPE_NUDGE ||
      message.content === ASSET_CANVAS_IFRAME_NUDGE ||
      message.content?.startsWith(UNUSED_LINKED_ASSETS_PREFIX) ||
      message.content === OPS_ROUTING_NUDGE ||
      message.content === REVIEW_ROUTING_NUDGE ||
      message.content === REVIEW_VERDICT_NUDGE ||
      message.content === SEARCH_WANDER_NUDGE ||
      message.content === VERIFY_NUDGE ||
      message.content?.startsWith(PROCESS_DONE_NUDGE) ||
      isAdherenceNudge(message.content))
  );
}

const NON_FIXABLE =
  /Denied by user|^Cancelled$|is denied by policy|not allowed for this|Refusing .+ protected branch|Refusing git push|Refusing recursive delete|Refusing outbound fetch|Refusing a command that names|missing required argument|A provider key is required|credential file|SENSITIVE_PATH|Needs a human|No repository is attached|Harness blocked git_push|Harness blocked git_pr|PreToolUse hook failed/i;

/** ESLint / Prettier reports are expected nonzero exits, not a crashed tool. */
const LINT_OR_FORMAT_REPORT =
  /✖\s+\d+\s+problems?|\bCode style issues found in \d+ files\b|:\d+:\d+:\s+error\b/;

export function looksLikeFixableFailure(output: string, ok?: boolean): boolean {
  if (ok === true) return false;
  const text = (output ?? "").trim();
  if (!text) return false;
  if (/Harness blocked git_(?:push|pr): tests failed/i.test(text)) return true;
  if (NON_FIXABLE.test(text)) return false;
  if (looksLikeLintOrFormatReport(text)) return false;
  if (/^\(exit\s+[12]\)$/.test(text)) return false;
  if (/\(exit\s+[1-9]\d*\)/.test(text)) return true;
  if (/exit code[: ]+[1-9]/i.test(text)) return true;
  if (
    /\b(Error|Exception|Traceback|AssertionError|TypeError|ReferenceError|SyntaxError|SecurityError|ENOENT|EACCES|ECONNREFUSED|npm ERR!|error TS\d+|FAILED)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (/tainted by cross-origin/i.test(text)) return true;
  return ok === false && text.length >= 8;
}

function looksLikeLintOrFormatReport(text: string): boolean {
  if (!LINT_OR_FORMAT_REPORT.test(text)) return false;
  return !/\b(SyntaxError|ENOENT|EACCES|ECONNREFUSED)\b/.test(text);
}
