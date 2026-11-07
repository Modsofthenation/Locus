import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_CONTROLS,
  GAME_KITS,
  GAME_RECORD_MS,
  GAME_BALANCE_RUNS,
  GAME_PWA_FILES,
  GAME_SFX_BANK_JS,
  defaultGamePlaytestSteps,
  livingGameGdd,
  gamePwaFiles,
  withGamePwaShell,
  feelFromTune,
  GAME_FEEL_PRESETS,
  exploreGameLoopsPrompt,
  fixFromPlaytestPrompt,
  formatGameLastRun,
  formatGameTapeEvent,
  gameKeyFromCode,
  generateGameAssetPrompt,
  iterateGamePrompt,
  isKitGameBrief,
  livingGameBrief,
  looksPlayableGame,
  looksJuicyGame,
  looksDryGame,
  MAX_GAME_JUICE_NUDGES,
  mergeKitNotesIntoBrief,
  canvasLooksWiped,
  canvasHtmlUnchanged,
  formatGameCanvasSnapshot,
  gameCanvasBrokenPrompt,
  looksLikeFakeGamePlaytest,
  looksLikeHudOnlyGamePlaytest,
  gameFollowUpMissingFromCanvas,
  gameFollowUpNeedsHuman,
  GAME_FOLLOW_UP_NEEDS_HUMAN,
  GAME_ITERATE_UNCHANGED_NEEDS_HUMAN,
  gameIterateUnchangedNeedsHuman,
  looksLikeGameIterateRequest,
  looksLikeStudioAck,
  looksLikeStudioChangeRequest,
  looksLikeStudioQuestion,
  parseGameLastRun,
  parseGameTape,
  parsePlaytestStats,
  playtestLooksPlayable,
  tapeEventCode,
  tuneFromFeel,
  formatPromoteGameBrief,
  parseCanvasFeelAttrs,
  parseGameControls,
  resolveGameKit,
  withGameChromeHook,
  withGameFeelCss,
  defaultGameScaffold,
} from "./gameCanvas.js";

describe("game canvas", () => {
  it("resolves asset kits and default controls", () => {
    expect(GAME_KITS.map((row) => row.id)).toEqual([
      "pixel-pack",
      "three-starter",
      "phaser",
      "sfx-pack",
    ]);
    expect(resolveGameKit("three-starter")?.vendorLib).toBe("three");
    expect(resolveGameKit("three-starter")?.files["vendor/boot-three.js"]).toContain(
      'from "./three.module.js"',
    );
    expect(resolveGameKit("phaser")?.files["vendor/boot-phaser.js"]).toContain(
      'from "./phaser.esm.js"',
    );
    expect(resolveGameKit("pixel-pack")?.title).toBe("Pixel pack");
    expect(resolveGameKit("nope")).toBeUndefined();
    expect(defaultGameScaffold({ designSystemId: "three-starter" })).toBe("three-vite");
    expect(defaultGameScaffold({ designSystemId: "phaser" })).toBe("phaser");
    expect(defaultGameScaffold({})).toBe("canvas-vite");
    expect(parseGameControls("<html>")).toBe(DEFAULT_GAME_CONTROLS);
    expect(parseGameControls('<html data-controls="WASD: move · F: fire">')).toBe(
      "WASD: move · F: fire",
    );
  });

  it("parses feel ranges and paints CSS vars from tune", () => {
    const ranges = parseCanvasFeelAttrs(
      '<html data-tune="gravity:40-120,jump:8-24,fire:4-16,shake:0-12,hit-stop:0-8,volume:0-100">',
    );
    expect(ranges.find((row) => row.key === "gravity")).toEqual({
      key: "gravity",
      min: 40,
      max: 120,
    });
    expect(feelFromTune({ gravity: 90, fireRate: 12 })).toMatchObject({
      gravity: 90,
      fire: 12,
      jump: 16,
    });
    const html = withGameFeelCss("<html><head></head><body></body></html>", {
      gravity: 100,
      seed: 42,
    });
    expect(html).toContain("data-locus-game-feel");
    expect(html).toContain("--gravity: 100");
    expect(html).toContain("--seed: 42");
    expect(tuneFromFeel(GAME_FEEL_PRESETS.floaty).gravity).toBe(40);
    expect(exploreGameLoopsPrompt(true)).toMatch(/distinct playable loops/);
    expect(exploreGameLoopsPrompt(true)).toContain("rooms.json");
    expect(livingGameBrief({ title: "Arcade" })).toContain("rooms.json");
    expect(livingGameBrief({ title: "Arcade" })).toContain("GDD.md");
    expect(livingGameGdd({ title: "Arcade" })).toContain("one-page GDD");
    expect(GAME_RECORD_MS).toBe(15_000);
    expect(GAME_BALANCE_RUNS).toBe(3);
    expect(GAME_PWA_FILES["manifest.webmanifest"]).toContain("standalone");
    expect(GAME_PWA_FILES[".itch.toml"]).toContain("[itch]");
    expect(gamePwaFiles({ title: "Neon crawl" })["manifest.webmanifest"]).toContain("Neon crawl");
    expect(withGamePwaShell("<html><head></head><body></body></html>")).toContain(
      "data-locus-game-pwa",
    );
    expect(GAME_SFX_BANK_JS).toContain("decodeAudioData");
    expect(resolveGameKit("sfx-pack")?.files["vendor/sfx/bank.js"]).toContain("decodeAudioData");
    expect(looksPlayableGame("<html><body>hello</body></html>")).toBe(false);
    expect(
      looksPlayableGame(
        "<html><body><script>window.addEventListener('keydown', () => {});</script>Score 0<button>Restart</button></body></html>",
      ),
    ).toBe(true);
    expect(
      looksPlayableGame(
        `<html class="in-menu"><body><script>window.addEventListener('keydown', () => {});</script>Score 0<button>Restart</button></body></html>`,
      ),
    ).toBe(false);
    expect(
      looksPlayableGame(
        `<html class="in-menu"><body><div id="menu"></div><script>window.addEventListener('keydown', () => {});</script>Score 0<button type="button">Restart</button></body></html>`,
      ),
    ).toBe(true);
    expect(
      looksPlayableGame(
        "<html><head><style>#menu { display: none }</style></head><body><script>window.addEventListener('keydown', () => {});</script>Score 0<button>Restart</button></body></html>",
      ),
    ).toBe(true);
    expect(
      looksPlayableGame(
        "<html><body><script>const namespace = {};</script>Score 0<button>Restart</button></body></html>",
      ),
    ).toBe(false);
    const dry =
      "<html><body><script>window.addEventListener('keydown', () => {});</script>Score 0<button>Restart</button></body></html>";
    expect(looksDryGame(dry)).toBe(true);
    expect(looksJuicyGame(dry)).toBe(false);
    expect(
      looksJuicyGame(
        `${dry}<script>const ctx = new AudioContext(); function beep(){ ctx.createOscillator(); }</script>`,
      ),
    ).toBe(true);
    expect(looksDryGame(`${dry}<script>function beep(){ new AudioContext(); }</script>`)).toBe(
      false,
    );
    expect(looksJuicyGame(withGameChromeHook(dry))).toBe(false);
    expect(looksDryGame(withGameChromeHook(dry))).toBe(true);
    expect(looksDryGame(`${dry}<div class="particle">dust</div><!-- particles later -->`)).toBe(
      true,
    );
    expect(looksJuicyGame(`${dry}<script>function hit(){ spawnParticles(12); }</script>`)).toBe(
      true,
    );
    expect(MAX_GAME_JUICE_NUDGES).toBe(2);
    const brief = livingGameBrief({ title: "Dodge", seed: 7 });
    expect(brief).toContain("# Dodge");
    expect(brief).toContain("seed: 7");
    const run = parseGameLastRun({ seed: 3, tape: ["Space"], keys: ["Space"], playtest: "ok" });
    expect(run?.seed).toBe(3);
    expect(formatGameLastRun(run!)).toContain("Space");
    expect(generateGameAssetPrompt({ kind: "sprite", title: "Arena" })).toContain("sprite");
    expect(generateGameAssetPrompt({ kind: "sfx", title: "Arena" })).toContain(
      "vendor/sfx/bank.js",
    );
    expect(generateGameAssetPrompt({ kind: "sfx", title: "Arena" })).toContain("WAV");
    expect(iterateGamePrompt("soften", { feel: feelFromTune(), seed: 0, lastRun: run })).toMatch(
      /Soften pass/,
    );
    expect(
      iterateGamePrompt("balance", {
        feel: feelFromTune(),
        seed: 0,
        lastRun: run,
        balanceRuns: [run!, { ...run!, seed: 4 }],
      }),
    ).toMatch(/Seeded playtests \(2\)/);
    expect(
      fixFromPlaytestPrompt({ report: "died", feel: feelFromTune(), seed: 1, tape: ["KeyR"] }),
    ).toMatch(/Fix from playtest/);
  });

  it("injects operator chrome once and writes a GAME.md brief", () => {
    const hooked = withGameChromeHook("<html><body><canvas></canvas></body></html>");
    expect(hooked).toContain("data-locus-game-chrome");
    expect(hooked).toContain('type="button"');
    expect(hooked).toContain("locus-game-reset");
    expect(hooked).toContain("locus-game-mute");
    expect(hooked).toContain("locus-game-clear");
    expect(hooked).toContain("locus-game-input");
    expect(hooked).toContain("locus-game-unlock");
    expect(hooked).toContain("locus-game-replay");
    expect(hooked).toContain("locus-game-gamepad");
    expect(hooked).toContain("getGamepads");
    expect(hooked).toContain("gamepadconnected");
    expect(withGameChromeHook(hooked)).toBe(hooked);
    expect(
      defaultGamePlaytestSteps("<html><body>Score 0<button>Restart</button></body></html>"),
    ).toEqual([
      "press ArrowRight",
      "press ArrowRight",
      "press Space",
      "press KeyR",
      "click text=Restart",
      "expect Score",
    ]);
    const brief = formatPromoteGameBrief({
      title: "Dodge",
      designSystemId: "pixel-pack",
      designPins: [{ viewport: "landscape", selector: "canvas", text: "Bigger flash" }],
      palette: { primary: "#e08a4c", bg: "#111", text: "#fff" },
    });
    expect(brief).toContain("# Game brief");
    expect(brief).toContain("Kit: pixel-pack");
    expect(brief).toContain("locus-game");
    expect(brief).toContain("`canvas`: Bigger flash");
  });
});

describe("game canvas loop guards", () => {
  it("treats a snippet overwrite as a wipe", () => {
    const prev = `<!doctype html>\n<html>${"x".repeat(2000)}</html>`;
    expect(canvasLooksWiped(prev, `<html class="in-menu">`)).toBe(true);
    expect(canvasLooksWiped(prev, "")).toBe(true);
    expect(canvasLooksWiped(prev, `${prev.slice(0, 4000)}</html>`)).toBe(false);
    expect(canvasLooksWiped("<p>tiny</p>", "<p>x</p>")).toBe(false);
    expect(canvasHtmlUnchanged(prev, prev)).toBe(true);
    expect(canvasHtmlUnchanged(prev, `${prev} `)).toBe(true);
    expect(canvasHtmlUnchanged(prev, `${prev}<p>x</p>`)).toBe(false);
  });

  it("does not treat a Node syntax check as a playtest", () => {
    expect(
      looksLikeFakeGamePlaytest({
        name: "exec",
        arguments: { command: "node .locus-game/_chk.mjs" },
        result: "ok 62477 replay true skirmish true",
      }),
    ).toBe(true);
    expect(
      looksLikeFakeGamePlaytest({
        name: "shell",
        arguments: { command: "node -e 'new Function(html)'" },
      }),
    ).toBe(true);
    expect(
      looksLikeFakeGamePlaytest({
        name: "exec",
        arguments: { command: "echo hi" },
        result: "ok 62477 replay true skirmish true",
      }),
    ).toBe(true);
    expect(
      looksLikeFakeGamePlaytest({
        name: "playwright",
        arguments: { click: "text=Skirmish" },
      }),
    ).toBe(false);
    expect(
      looksLikeFakeGamePlaytest({
        name: "playwright",
        arguments: { steps: ["click #bRestart", "expect road #", "expect bumps"] },
      }),
    ).toBe(true);
    expect(
      looksLikeHudOnlyGamePlaytest({
        name: "CallMcpTool",
        arguments: { name: "playwright", args: { click: "#bRestart", expect_text: "trip" } },
      }),
    ).toBe(true);
    expect(
      looksLikeHudOnlyGamePlaytest({
        name: "playwright",
        arguments: { steps: ["click #bMode", "press ArrowUp"] },
      }),
    ).toBe(false);
  });

  it("flags a follow-up whose named control is still missing from the canvas", () => {
    const cruise = `<html><button type="button" id="bRestart">Restart</button></html>`;
    expect(gameFollowUpMissingFromCanvas("add #bMode for race", cruise)).toBe(true);
    expect(
      gameFollowUpMissingFromCanvas(
        "add #bMode",
        `<html><button type="button" id="bMode">Mode: Race</button></html>`,
      ),
    ).toBe(false);
    expect(gameFollowUpMissingFromCanvas("please add race mode and takedowns", cruise)).toBe(true);
    expect(
      gameFollowUpMissingFromCanvas(
        "is race mode added yet?",
        `<html><button type="button" id="bMode">Mode: Race</button></html>`,
      ),
    ).toBe(false);
    expect(gameFollowUpMissingFromCanvas("", cruise)).toBe(false);
    expect(gameFollowUpNeedsHuman("add #bMode for race", cruise)).toBe(GAME_FOLLOW_UP_NEEDS_HUMAN);
    expect(
      gameFollowUpNeedsHuman(
        "add #bMode",
        `<html><button type="button" id="bMode">Mode: Race</button></html>`,
      ),
    ).toBeUndefined();
    expect(gameFollowUpNeedsHuman("add #bMode for race", "")).toBeUndefined();
    expect(gameFollowUpNeedsHuman("add #bMode for race", null)).toBeUndefined();
  });

  it("gates an iterate chip that never changed the canvas", () => {
    const cruise = `<html><button type="button" id="bRestart">Restart</button></html>`;
    const soften = iterateGamePrompt("soften", { feel: feelFromTune(), seed: 0 });
    expect(looksLikeGameIterateRequest(soften)).toBe(true);
    expect(looksLikeGameIterateRequest("add #bMode for race")).toBe(false);
    expect(looksLikeGameIterateRequest("how do I play?")).toBe(false);
    expect(looksLikeGameIterateRequest("Build a playable arcade loop")).toBe(false);
    expect(looksLikeGameIterateRequest("make it faster")).toBe(false);
    expect(looksLikeStudioChangeRequest(soften)).toBe(true);
    expect(looksLikeStudioChangeRequest("make it faster")).toBe(true);
    expect(looksLikeStudioChangeRequest("make it juicier")).toBe(true);
    expect(looksLikeStudioChangeRequest("add #bMode for race")).toBe(true);
    expect(looksLikeStudioChangeRequest("Build a playable arcade loop")).toBe(true);
    expect(looksLikeStudioChangeRequest("how do I play?")).toBe(false);
    expect(looksLikeStudioChangeRequest("looks good")).toBe(false);
    expect(looksLikeStudioQuestion("how do I play?")).toBe(true);
    expect(looksLikeStudioQuestion("What does Restart do")).toBe(true);
    expect(looksLikeStudioAck("looks good")).toBe(true);
    expect(looksLikeStudioAck("make it look good")).toBe(false);
    expect(
      looksLikeGameIterateRequest(
        fixFromPlaytestPrompt({ report: "died", feel: feelFromTune(), seed: 1, tape: ["KeyR"] }),
      ),
    ).toBe(true);
    expect(
      gameIterateUnchangedNeedsHuman({
        userText: soften,
        html: cruise,
        turnStartHtml: cruise,
      }),
    ).toBe(GAME_ITERATE_UNCHANGED_NEEDS_HUMAN);
    expect(
      gameIterateUnchangedNeedsHuman({
        userText: soften,
        html: `${cruise}<span>easier</span>`,
        turnStartHtml: cruise,
      }),
    ).toBeUndefined();
    expect(
      gameIterateUnchangedNeedsHuman({
        userText: "add #bMode for race",
        html: cruise,
        turnStartHtml: cruise,
      }),
    ).toBe(GAME_ITERATE_UNCHANGED_NEEDS_HUMAN);
    expect(
      gameIterateUnchangedNeedsHuman({
        userText: "make it faster",
        html: cruise,
        turnStartHtml: cruise,
      }),
    ).toBe(GAME_ITERATE_UNCHANGED_NEEDS_HUMAN);
    expect(
      gameIterateUnchangedNeedsHuman({
        userText: "how do I play?",
        html: cruise,
        turnStartHtml: cruise,
      }),
    ).toBeUndefined();
    expect(
      gameIterateUnchangedNeedsHuman({
        userText: "looks good",
        html: cruise,
        turnStartHtml: cruise,
      }),
    ).toBeUndefined();
    expect(
      gameIterateUnchangedNeedsHuman({ userText: soften, html: cruise, turnStartHtml: "" }),
    ).toBeUndefined();
    expect(
      gameIterateUnchangedNeedsHuman({ userText: soften, html: "", turnStartHtml: cruise }),
    ).toBeUndefined();
    expect(
      gameIterateUnchangedNeedsHuman({
        userText: soften,
        html: `<style data-locus-palette>:root{--bg:#111}</style>${cruise}`,
        turnStartHtml: cruise,
      }),
    ).toBe(GAME_ITERATE_UNCHANGED_NEEDS_HUMAN);
  });

  it("detects broken-canvas operator prompts and formats a live snapshot", () => {
    expect(gameCanvasBrokenPrompt("doesn't work in the locus canvas")).toBe(true);
    expect(gameCanvasBrokenPrompt("None of the buttons work")).toBe(true);
    expect(gameCanvasBrokenPrompt("make it juicier")).toBe(false);
    const snap = formatGameCanvasSnapshot({
      html: `<html><div id="menu"></div><button type="button" id="btnOpenSkirmish">Skirmish</button><script>window.__locusGame = { reset, pause, resume, debug, stats, mute, seed, replay };</script></html>`,
      lastRun: {
        at: "now",
        seed: 3,
        score: 12,
        deaths: 1,
        time: 8,
        keys: ["Space"],
        tape: ["Space"],
      },
    });
    expect(snap).toMatch(/index\.html \d+ bytes/);
    expect(snap).toMatch(/<\/html> yes/);
    expect(snap).toMatch(
      /__locusGame keys: reset, pause, resume, debug, stats, mute, seed, replay/,
    );
    expect(snap).toMatch(/overlays: menu/);
    expect(snap).toMatch(/type=button/);
    expect(snap).toMatch(/last-run: score 12/);
    expect(snap).toMatch(/Call playwright/);
    expect(snap).toMatch(/stats\.time/);
    expect(snap).toMatch(/HUD expect/);
    expect(snap).toMatch(/host fallback: no/);
    expect(
      formatGameCanvasSnapshot({
        html: `<html lang="en" data-locus-host-fallback="game"><button type="button">Restart</button></html>`,
      }),
    ).toMatch(/host fallback: yes/);
  });
});

describe("game last-run and feel helpers", () => {
  it("parses timed tape, ignores null scores, and maps key codes", () => {
    const run = parseGameLastRun({
      seed: 2,
      score: null,
      deaths: "3",
      tape: ["Space@40+80", { code: "KeyR", t: 120, hold: 30 }],
    });
    expect(run?.score).toBeUndefined();
    expect(run?.deaths).toBe(3);
    expect(parseGameTape(run?.tape).map((row) => row.code)).toEqual(["Space", "KeyR"]);
    expect(formatGameTapeEvent({ code: "Space", t: 40, hold: 80 })).toBe("Space@40+80");
    expect(tapeEventCode("Space@40+80")).toBe("Space");
    expect(gameKeyFromCode("KeyR")).toBe("r");
    expect(gameKeyFromCode("Digit1")).toBe("1");
    expect(gameKeyFromCode("Space")).toBe(" ");
  });

  it("reads playtest stats and rejects loose playable matches", () => {
    const report =
      "Playwright desktop 1280×800 (live)\nok  press ArrowRight\nstats score=12 deaths=1 time=8";
    expect(parsePlaytestStats(report)).toEqual({
      score: 12,
      deaths: 1,
      time: 8,
      fps: undefined,
    });
    expect(playtestLooksPlayable(report)).toBe(true);
    expect(playtestLooksPlayable("ok  press ArrowRight")).toBe(true);
    expect(playtestLooksPlayable("token window")).toBe(false);
    expect(playtestLooksPlayable("fail  click text=Restart")).toBe(false);
  });

  it("drops feel ranges that invert after clamping and merges kit notes", () => {
    const ranges = parseCanvasFeelAttrs('<html data-tune="gravity:0-10,jump:8-24">');
    expect(ranges.find((row) => row.key === "gravity")).toMatchObject({
      key: "gravity",
      min: 20,
      max: 160,
    });
    expect(isKitGameBrief("# Pixel pack\n\nTile size: 16px.")).toBe(true);
    expect(isKitGameBrief(livingGameBrief({ title: "Dodge" }))).toBe(false);
    const merged = mergeKitNotesIntoBrief(
      livingGameBrief({ title: "Dodge" }),
      "# Pixel pack\n\n16px tiles.",
    );
    expect(merged).toContain("## Kit");
    expect(merged).toContain("16px tiles.");
  });
});

describe("game chrome hook", () => {
  it("sends each synthetic key once, keeps feel volume, and releases stuck touch", () => {
    const studio = runGameChromeHook(
      "<html><head><style data-locus-game-feel>:root { --volume: 20; }</style></head><body></body></html>",
    );
    expect(studio.volume()).toBe("20");
    studio.post({ type: "locus-game-input", code: "Space", down: true });
    studio.post({ type: "locus-game-input", code: "Space", down: false });
    expect(studio.downs).toEqual([" "]);
    expect(studio.ups).toEqual([" "]);
    expect(studio.tape).toHaveLength(1);
    expect(studio.tape[0]).toMatch(/^Space@/);
    studio.post({ type: "locus-game-input", down: true });
    expect(studio.downs).toEqual([" "]);
    studio.post({ type: "locus-game-touch", on: true });
    expect(studio.touchButtons()).toEqual(["up", "left", "down", "right", "Space", "KeyR"]);
    studio.pressTouch("right", "down");
    expect(studio.held).toEqual(["ArrowRight"]);
    studio.releaseTouch();
    expect(studio.held).toEqual([]);
    const downsBeforeReplay = studio.downs.length;
    studio.post({ type: "locus-game-replay", tape: ["ArrowRight@0+40"] });
    expect(studio.replayCalls).toEqual([["ArrowRight"]]);
    expect(studio.replayEvents).toEqual([[{ code: "ArrowRight", t: 0, hold: 40 }]]);
    expect(studio.downs.length).toBe(downsBeforeReplay);
    studio.post({ type: "locus-game-replay", tape: [{ code: "ArrowLeft", t: 0, hold: 16 }] });
    expect(studio.replayEvents.at(-1)).toEqual([{ code: "ArrowLeft", t: 0, hold: 16 }]);
    studio.post({ type: "locus-game-input", code: "KeyR", down: true });
    studio.post({ type: "locus-game-input", code: "Digit1", down: true });
    expect(studio.downs.slice(-2)).toEqual(["r", "1"]);
    expect(withGameChromeHook("<html></html>")).toContain("^([^@]+)@([0-9]+)(?:[+]([0-9]+))?$");
  });
});

function runGameChromeHook(html: string) {
  const script = withGameChromeHook(html).match(
    /<script data-locus-game-chrome>([\s\S]*?)<\/script>/,
  )?.[1];
  if (!script) throw new Error("missing chrome hook");
  const cssVars: Record<string, string> = {};
  const feel = html.match(/--volume:\s*(\d+)/);
  if (feel) cssVars["--volume"] = feel[1]!;
  const buttons: Array<{ dir?: string; act?: string }> = [];
  const listeners: Record<string, Array<(ev: Record<string, unknown>) => void>> = {};
  const downs: string[] = [];
  const ups: string[] = [];
  const held = new Set<string>();
  const store: Record<string, string> = {};
  function add(type: string, fn: (ev: Record<string, unknown>) => void) {
    (listeners[type] ??= []).push(fn);
  }
  const replayCalls: string[][] = [];
  const replayEvents: Array<Array<{ code?: string; t?: number; hold?: number }>> = [];
  const documentElement = {
    style: {
      setProperty(name: string, value: string) {
        cssVars[name] = String(value);
      },
      getPropertyValue(name: string) {
        return cssVars[name] ?? "";
      },
    },
    classList: {
      toggle() {},
      contains() {
        return false;
      },
    },
  };
  const body = {
    children: [] as unknown[],
    appendChild(node: { innerHTML?: string }) {
      this.children.push(node);
      if (node.innerHTML) {
        for (const match of node.innerHTML.matchAll(/data-(dir|act)="([^"]+)"/g)) {
          buttons.push(match[1] === "dir" ? { dir: match[2] } : { act: match[2] });
        }
      }
    },
  };
  runInNewContext(script, {
    window: {
      __locusGame: {
        replay(codes: string[], events?: Array<{ code?: string; t?: number; hold?: number }>) {
          replayCalls.push(codes);
          replayEvents.push(events ?? []);
        },
        stats() {
          return { score: 4 };
        },
      },
      addEventListener(type: string, fn: (ev: Record<string, unknown>) => void) {
        add(type, fn);
      },
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    },
    KeyboardEvent: class {
      type: string;
      key: string;
      code: string;
      bubbles: boolean;
      constructor(type: string, init: { key?: string; code?: string; bubbles?: boolean }) {
        this.type = type;
        this.key = init.key ?? "";
        this.code = init.code ?? "";
        this.bubbles = Boolean(init.bubbles);
      }
    },
    getComputedStyle() {
      return {
        getPropertyValue(name: string) {
          return cssVars[name] ?? "";
        },
      };
    },
    document: {
      documentElement,
      body,
      querySelector(sel: string) {
        const attr = sel.match(/^\[([^\]]+)\]$/)?.[1];
        if (attr) {
          return (
            body.children.find(
              (node) => (node as { attrs?: Record<string, string> }).attrs?.[attr] != null,
            ) ?? null
          );
        }
        return null;
      },
      dispatchEvent(ev: { type: string; key: string; code: string }) {
        if (ev.type === "keydown") {
          downs.push(ev.key);
          held.add(ev.code);
        }
        if (ev.type === "keyup") {
          ups.push(ev.key);
          held.delete(ev.code);
        }
        return true;
      },
      createElement() {
        return {
          style: { cssText: "" },
          innerHTML: "",
          attrs: {} as Record<string, string>,
          addEventListener: add,
          setAttribute(name: string, value: string) {
            this.attrs[name] = value;
          },
          setPointerCapture() {},
        };
      },
    },
    parent: {
      postMessage() {},
    },
    localStorage: {
      getItem(key: string) {
        return store[key] ?? null;
      },
      setItem(key: string, value: string) {
        store[key] = value;
      },
      removeItem(key: string) {
        delete store[key];
      },
    },
    performance: { now: () => 1 },
    setTimeout(fn: () => void) {
      fn();
      return 0;
    },
    setInterval() {
      return 0;
    },
    requestAnimationFrame() {
      return 0;
    },
  });
  return {
    downs,
    ups,
    replayCalls,
    replayEvents,
    get tape(): string[] {
      try {
        const raw = store["locus-game"];
        const parsed = raw ? (JSON.parse(raw) as { tape?: string[] }) : {};
        return parsed.tape ?? [];
      } catch {
        return [];
      }
    },
    get held() {
      return [...held];
    },
    volume() {
      return cssVars["--volume"];
    },
    touchButtons() {
      return buttons.map((row) => row.dir ?? row.act);
    },
    post(data: unknown) {
      for (const fn of listeners.message ?? []) fn({ data });
    },
    pressTouch(dir: string, phase: "down" | "up") {
      const target = {
        closest() {
          return {
            getAttribute(name: string) {
              return name === "data-dir" ? dir : null;
            },
            setPointerCapture() {},
          };
        },
      };
      if (phase === "down") {
        for (const fn of listeners.pointerdown ?? [])
          fn({ target, pointerId: 1, preventDefault() {} });
      } else {
        for (const fn of listeners.pointerup ?? []) fn({ target, pointerId: 1 });
      }
    },
    releaseTouch() {
      for (const fn of listeners.pointercancel ?? []) fn({ target: {}, pointerId: 1 });
    },
  };
}
