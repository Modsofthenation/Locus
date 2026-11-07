import { describe, expect, it } from "vitest";
import { OPS_ROUTING_NUDGE } from "./opsRouting.js";
import { REVIEW_ROUTING_NUDGE } from "./reviewRouting.js";
import { REVIEW_VERDICT_NUDGE } from "./verdict.js";
import { ADHERENCE_NUDGE_PREFIX } from "./models/designAdherence.js";
import { DESIGN_QUALITY_NUDGE } from "./models/designQuality.js";
import {
  DESIGN_MUTATE_NUDGE,
  EMPTY_CANVAS_NUDGE,
  INCOMPLETE_CANVAS_NUDGE,
  UNPLAYABLE_GAME_NUDGE,
  GAME_JUICE_NUDGE,
  GAME_PLAYWRIGHT_NUDGE,
  GAME_CANVAS_WIPE_NUDGE,
  GAME_CANVAS_RESTORE_NOTE,
  GAME_MUTATE_NUDGE,
  LOCUS_CANVAS_CHANGED_ON_DISK,
  GAME_CANVAS_IFRAME_NUDGE,
  UNWIRED_ASSET_NUDGE,
  ASSET_SCULPT_NUDGE,
  ASSET_PLAYWRIGHT_NUDGE,
  ASSET_CANVAS_WIPE_NUDGE,
  ASSET_CANVAS_IFRAME_NUDGE,
  UNUSED_LINKED_ASSETS_PREFIX,
  isHiddenChatMessage,
  looksLikeFixableFailure,
  classifyFixableFailure,
  selfCorrectNudge,
  MAX_SELF_CORRECTS_PER_TURN,
  MAX_CANVAS_NUDGES,
  PROCESS_DONE_NUDGE,
  SELF_CORRECT_NUDGE,
  SELF_CORRECT_PATCH_NUDGE,
  SELF_CORRECT_TEST_NUDGE,
  SELF_CORRECT_MISSING_NUDGE,
  SELF_CORRECT_CORS_NUDGE,
  DESIGN_LOOK_NUDGE,
  HOST_FALLBACK_NUDGE,
  canvasQualityNudge,
} from "./selfCorrect.js";
import { SEARCH_WANDER_NUDGE, VERIFY_NUDGE } from "./codingLoop.js";

describe("self-correction", () => {
  it("treats stack traces and nonzero exits as fixable", () => {
    expect(
      looksLikeFixableFailure("Error: boom\n    at Object.<anonymous> (a.ts:1:1)", false),
    ).toBe(true);
    expect(
      looksLikeFixableFailure('Traceback (most recent call last):\n  File "a.py"', false),
    ).toBe(true);
    expect(looksLikeFixableFailure("npm ERR! code ELIFECYCLE\n(exit 1)", false)).toBe(true);
    expect(
      looksLikeFixableFailure(
        "SecurityError: Failed to execute 'getImageData' on 'CanvasRenderingContext2D': The canvas has been tainted by cross-origin data.",
        false,
      ),
    ).toBe(true);
    expect(
      looksLikeFixableFailure("src/a.ts:1:1 - error TS2304: Cannot find name 'x'.", false),
    ).toBe(true);
    expect(MAX_SELF_CORRECTS_PER_TURN).toBe(2);
    expect(MAX_CANVAS_NUDGES).toBe(2);
    expect(SELF_CORRECT_NUDGE).toMatch(/hypothesis/);
  });

  it("hides harness nudges from the operator thread", () => {
    expect(isHiddenChatMessage({ role: "system", content: SELF_CORRECT_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: SELF_CORRECT_PATCH_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: SELF_CORRECT_TEST_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: SELF_CORRECT_MISSING_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: SELF_CORRECT_CORS_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: DESIGN_LOOK_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: DESIGN_QUALITY_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: HOST_FALLBACK_NUDGE })).toBe(true);
    expect(canvasQualityNudge(true)).toBe(HOST_FALLBACK_NUDGE);
    expect(canvasQualityNudge(false)).toBe(DESIGN_QUALITY_NUDGE);
    expect(HOST_FALLBACK_NUDGE).not.toMatch(
      /data-locus-host-fallback|drawPlaceholder|First draft|color-mix|40rem|hazards/,
    );
    expect(HOST_FALLBACK_NUDGE).toMatch(/Cosmetic edits that keep the stub body still fail/);
    expect(HOST_FALLBACK_NUDGE).toMatch(/Do not polish/);
    expect(isHiddenChatMessage({ role: "system", content: SEARCH_WANDER_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: VERIFY_NUDGE })).toBe(true);
    expect(DESIGN_LOOK_NUDGE).toMatch(/first paint/);
    expect(classifyFixableFailure("error: patch does not apply")).toBe("patch");
    expect(selfCorrectNudge("error: patch does not apply")).toBe(SELF_CORRECT_PATCH_NUDGE);
    expect(classifyFixableFailure("ENOENT: no such file")).toBe("missing");
    expect(classifyFixableFailure("The canvas has been tainted by cross-origin data.")).toBe(
      "cors",
    );
    expect(isHiddenChatMessage({ role: "system", content: EMPTY_CANVAS_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: DESIGN_MUTATE_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: INCOMPLETE_CANVAS_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: UNPLAYABLE_GAME_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: GAME_JUICE_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: GAME_PLAYWRIGHT_NUDGE })).toBe(true);
    expect(GAME_JUICE_NUDGE).toMatch(/juice pass/);
    expect(isHiddenChatMessage({ role: "system", content: GAME_CANVAS_WIPE_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: GAME_CANVAS_RESTORE_NOTE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: GAME_MUTATE_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: GAME_CANVAS_IFRAME_NUDGE })).toBe(true);
    expect(GAME_PLAYWRIGHT_NUDGE).toMatch(/stats\.time/);
    expect(GAME_PLAYWRIGHT_NUDGE).toMatch(/road #/);
    expect(GAME_CANVAS_WIPE_NUDGE).toMatch(/StrReplace fragment/);
    expect(GAME_CANVAS_RESTORE_NOTE).toMatch(/last good canvas/);
    expect(GAME_MUTATE_NUDGE).toMatch(/Patch \/workspace\/index\.html/);
    expect(LOCUS_CANVAS_CHANGED_ON_DISK).toMatch(/not a model Write/);
    expect(isHiddenChatMessage({ role: "system", content: UNWIRED_ASSET_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: ASSET_SCULPT_NUDGE })).toBe(true);
    expect(ASSET_SCULPT_NUDGE).toMatch(/sculpt pass/);
    expect(ASSET_SCULPT_NUDGE).toMatch(/empty Three/);
    expect(ASSET_SCULPT_NUDGE).toMatch(/photo billboard/);
    expect(isHiddenChatMessage({ role: "system", content: ASSET_PLAYWRIGHT_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: ASSET_CANVAS_WIPE_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: ASSET_CANVAS_IFRAME_NUDGE })).toBe(true);
    expect(
      isHiddenChatMessage({
        role: "system",
        content: `${UNUSED_LINKED_ASSETS_PREFIX} Load @asset:knight from vendor/assets.`,
      }),
    ).toBe(true);
    expect(UNWIRED_ASSET_NUDGE).toMatch(/source\.png/);
    expect(UNWIRED_ASSET_NUDGE).toMatch(/reconstruct\.js/);
    expect(ASSET_PLAYWRIGHT_NUDGE).toMatch(/#btnWire/);
    expect(ASSET_CANVAS_IFRAME_NUDGE).toMatch(/taint/);
    expect(INCOMPLETE_CANVAS_NUDGE).toMatch(/__GAME__/);
    expect(INCOMPLETE_CANVAS_NUDGE).toMatch(/parts\//);
    expect(isHiddenChatMessage({ role: "system", content: OPS_ROUTING_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: REVIEW_ROUTING_NUDGE })).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: REVIEW_VERDICT_NUDGE })).toBe(true);
    expect(
      isHiddenChatMessage({ role: "system", content: `${PROCESS_DONE_NUDGE}\n\nexit 1` }),
    ).toBe(true);
    expect(
      isHiddenChatMessage({
        role: "system",
        content: `${ADHERENCE_NUDGE_PREFIX}\nFix with apply_patch.`,
      }),
    ).toBe(true);
    expect(isHiddenChatMessage({ role: "system", content: "Write HTML now.", hidden: true })).toBe(
      true,
    );
    expect(isHiddenChatMessage({ role: "system", content: "Guest is ready." })).toBe(false);
    expect(isHiddenChatMessage({ role: "user", content: SELF_CORRECT_NUDGE })).toBe(false);
  });

  it("does not retry operator denials or empty output", () => {
    expect(looksLikeFixableFailure("Denied by user", false)).toBe(false);
    expect(looksLikeFixableFailure("Cancelled", false)).toBe(false);
    expect(looksLikeFixableFailure("Tool exec is denied by policy", false)).toBe(false);
    expect(
      looksLikeFixableFailure(
        "No repository is attached to this agent. git_clone a GitHub, GitLab, or Bitbucket URL to check out the code (that attaches this session), or pick a linked repo when creating the agent. git_pr_list and git_issue_list will not work until then.",
        false,
      ),
    ).toBe(false);
    expect(
      looksLikeFixableFailure("Harness blocked git_push: tests failed.\nFAIL src/a.test.ts", false),
    ).toBe(true);
    expect(
      looksLikeFixableFailure("Harness blocked git_pr: tests failed.\nFAIL src/a.test.ts", false),
    ).toBe(true);
    expect(classifyFixableFailure("Harness blocked git_push: tests failed.\nFAIL src/a.ts")).toBe(
      "test",
    );
    expect(selfCorrectNudge("Harness blocked git_push: tests failed.\nFAIL src/a.ts")).toBe(
      SELF_CORRECT_TEST_NUDGE,
    );
    expect(
      looksLikeFixableFailure("Harness blocked file_write: PreToolUse hook failed.\nnope", false),
    ).toBe(false);
    expect(looksLikeFixableFailure("ok", true)).toBe(false);
    expect(looksLikeFixableFailure("", false)).toBe(false);
  });

  it("does not treat linter reports or a bare (exit 1) as a crashed tool", () => {
    expect(
      looksLikeFixableFailure(
        "/workspace/apps/server/src/forge.ts\n  4:8  error  'ForgeKind' is defined but never used\n\n✖ 27 problems (27 errors, 0 warnings)\n\n(exit 1)",
        false,
      ),
    ).toBe(false);
    expect(
      looksLikeFixableFailure(
        "[warn] packages/shared/src/trace.ts\nCode style issues found in 271 files. Run Prettier with --write to fix.\n(exit 1)",
        false,
      ),
    ).toBe(false);
    expect(looksLikeFixableFailure("(exit 2)", false)).toBe(false);
    expect(looksLikeFixableFailure("(exit 1)", false)).toBe(false);
    expect(
      looksLikeFixableFailure(
        "/workspace/apps/desktop/src/lib/api.ts:92:3: error 'pending' is never reassigned. [prefer-const]\n(exit 1)",
        false,
      ),
    ).toBe(false);
  });

  it("still retries a heredoc SyntaxError glued onto the batch footer", () => {
    expect(
      looksLikeFixableFailure(
        `  File "<stdin>", line 31\n    EOF; printf '\\n(exit %s)\\n' "$?"; true\n                ^^^^^^^^^^^^^^^\nSyntaxError: invalid syntax\n(exit 1)`,
        false,
      ),
    ).toBe(true);
  });
});
