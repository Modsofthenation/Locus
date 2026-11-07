import { describe, expect, it } from "vitest";
import {
  GAME_CURVE_SEEDS,
  classifySeedSample,
  createMomentPin,
  extraFeelKeysForRecipe,
  feelKeysForRecipe,
  formatGameStudio,
  formatMomentFix,
  formatReleaseNotes,
  gameReleaseChecklist,
  itchBlurbFromGdd,
  parseBoothPayload,
  parseGameStudio,
  sanitizeInputMap,
  splitLiveGameHtml,
  withBoothNote,
  withMoment,
  withPlayBooth,
  emptyGameStudio,
  playLinkScores,
} from "./gameStudio.js";

const playable = `<!doctype html><html data-controls="Arrows: move"><body>
<canvas></canvas><p>Score 0</p><button type="button">Restart</button>
<script>
addEventListener("keydown", function(e){ if(e.key==="ArrowRight"){} });
var score = 1, mute = false, best = 0;
localStorage.setItem("locus-game", JSON.stringify({ mute: mute, best: best }));
function particles(){}
screenshake();
</script>
</body></html>`;

describe("game studio", () => {
  it("hides feel knobs that the recipe does not use", () => {
    expect(feelKeysForRecipe("")).toEqual([
      "gravity",
      "jump",
      "fire",
      "shake",
      "hit-stop",
      "volume",
    ]);
    expect(feelKeysForRecipe("endless-drive")).toEqual(["shake", "volume"]);
    expect(extraFeelKeysForRecipe("endless-drive")).toEqual(["steer", "grip", "cruise"]);
    expect(extraFeelKeysForRecipe("puzzle")).toEqual(["hint", "undo", "move-budget"]);
    expect(feelKeysForRecipe("unknown-genre")).toHaveLength(6);
  });

  it("pins a moment and round-trips the studio file", () => {
    const pin = createMomentPin({
      seed: 4,
      time: 3.2,
      score: 10,
      deaths: 1,
      tape: ["ArrowRight@0+40", "Space@80+20"],
      note: "died on the cone",
      at: "2026-10-21T12:00:00.000Z",
    });
    const next = withMoment(emptyGameStudio(), pin);
    const parsed = parseGameStudio(JSON.parse(formatGameStudio(next)));
    expect(parsed.moments).toHaveLength(1);
    expect(parsed.moments[0]?.seed).toBe(4);
    expect(formatMomentFix(parsed.moments[0]!)).toMatch(/died on the cone/);
    expect(formatMomentFix(parsed.moments[0]!)).toMatch(/Do not tour the HUD/);
  });

  it("classifies a short seed sample", () => {
    expect(classifySeedSample({ time: 0.1, score: 0, deaths: 0 })).toBe("soft-lock");
    expect(classifySeedSample({ time: 1.2, score: 0, deaths: 1 })).toBe("too-hard");
    expect(classifySeedSample({ time: 9, score: 0, deaths: 0 })).toBe("unwinnable");
    expect(classifySeedSample({ time: 9, score: 20, deaths: 0 })).toBe("too-easy");
    expect(classifySeedSample({ time: 4, score: 3, deaths: 1 })).toBe("playable");
    expect(GAME_CURVE_SEEDS).toHaveLength(5);
  });

  it("keeps a remap inside the control codes", () => {
    expect(sanitizeInputMap({ ArrowLeft: "KeyA", Space: "Space", KeyZ: "ArrowUp" })).toEqual({});
    expect(sanitizeInputMap({ ArrowLeft: "ArrowRight", Space: "KeyR" })).toEqual({
      ArrowLeft: "ArrowRight",
      Space: "KeyR",
    });
  });

  it("appends a booth note and ignores an empty payload", () => {
    expect(parseBoothPayload({ note: "   " })).toBeUndefined();
    const note = parseBoothPayload({
      note: "phone died on wave 2",
      seed: 3,
      tape: ["ArrowUp@0+40"],
      score: 2,
    });
    const studio = withBoothNote(emptyGameStudio(), note!);
    expect(studio.booth[0]?.note).toBe("phone died on wave 2");
    expect(studio.booth[0]?.seed).toBe(3);
    const scored = parseBoothPayload({ score: 40, handle: "Ada" });
    expect(scored?.score).toBe(40);
    expect(scored?.handle).toBe("Ada");
    expect(playLinkScores([note!, scored!]).map((row) => row.score)).toEqual([40, 2]);
  });

  it("splits the loop into game.js and leaves chrome scripts in the boot", () => {
    const html = `<!doctype html><html><body><canvas></canvas>
<script data-locus-game-chrome>var host = 1;</script>
<script>
function loop(){ var score = 0; addEventListener("keydown", function(){ score += 1; }); }
loop();
</script>
</body></html>`;
    const split = splitLiveGameHtml(html);
    expect(split?.gameJs).toContain("function loop");
    expect(split?.gameJs).not.toContain("data-locus-game-chrome");
    expect(split?.indexHtml).toContain('src="./game.js"');
    expect(split?.indexHtml).toContain("data-locus-game-chrome");
    expect(splitLiveGameHtml(split!.indexHtml)).toBeUndefined();
  });

  it("checks a release and writes the itch blurb from the GDD fantasy", () => {
    const gdd = "# Game\n\n## Fantasy\n\nA courier who wants one clean run.\n\n## Verbs\n\nMove.\n";
    const checks = gameReleaseChecklist({ html: playable, gdd });
    expect(checks.find((row) => row.id === "playable")?.ok).toBe(true);
    expect(checks.find((row) => row.id === "juice")?.ok).toBe(true);
    expect(checks.find((row) => row.id === "blurb")?.ok).toBe(true);
    expect(itchBlurbFromGdd(gdd)).toBe("A courier who wants one clean run.");
    expect(itchBlurbFromGdd("## Fantasy\n\nWho the player is and what they want.")).toBe("");
    expect(formatReleaseNotes(checks, itchBlurbFromGdd(gdd))).toContain("## Itch");
    const booth = withPlayBooth("<html><body></body></html>", "pl_abc");
    expect(booth).toContain('action="/play/pl_abc/booth"');
    expect(booth).toContain("Unlisted");
    expect(booth).toContain("data-locus-play-scores");
    expect(booth).toContain("Post score");
    expect(withPlayBooth(booth, "pl_abc")).toBe(booth);
    expect(checks.find((row) => row.id === "how-to-play")?.ok).toBe(false);
  });
});
