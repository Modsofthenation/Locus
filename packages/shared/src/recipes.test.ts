import { describe, expect, it } from "vitest";
import {
  AGENT_RECIPES,
  DESIGN_DOCKER_IMAGE,
  DESIGN_PLAYBOOK,
  CURSOR_CODING_ROUTING_CARD,
  CURSOR_DESIGN_ROUTING_CARD,
  CURSOR_GAME_ROUTING_CARD,
  CURSOR_ASSET_ROUTING_CARD,
  ASSET_MCP_INSTRUCTIONS,
  DESIGN_MCP_INSTRUCTIONS,
  DESIGN_RECIPES,
  DESIGN_TOOLS,
  GAME_PLAYBOOK,
  GAME_RECIPES,
  GAME_REMIX_PROMPTS,
  GAME_TOOLS,
  composeGameLaunchPrompt,
  kitForGameDimension,
  looksGameImageFile,
  recipeShortcut,
  ASSET_PLAYBOOK,
  ASSET_RECIPES,
  ASSET_TOOLS,
  FIRST_TASKS,
  REVIEW_TOOLS,
  exploreDirectionsPrompt,
  formatStartingPointPrompt,
  recipeById,
  showFirstTaskPills,
  visibleRecipes,
} from "./models/recipes.js";
import { isCanvasSession } from "./models/session.js";
import { parseDockerImage } from "./models/vm.js";
import { parseToolAllowlist } from "./models/tools.js";

describe("agent recipes", () => {
  it("ships PR reviewer, installer QA, and repo fixer", () => {
    expect(AGENT_RECIPES.map((r) => r.id)).toEqual([
      "pr-reviewer",
      "installer-qa",
      "repo-fixer",
      "env-setup",
      "web-qa",
      "ops-loop",
    ]);
    expect(recipeById("pr-reviewer")?.playbook).toMatch(/clipped unified diffs/i);
    expect(recipeById("pr-reviewer")?.playbook).toMatch(/already cloned at the PR head/);
    expect(recipeById("pr-reviewer")?.playbook).toMatch(/locus MCP/);
    expect(recipeById("pr-reviewer")?.playbook).toMatch(/include=\["files"\]/);
    expect(recipeById("pr-reviewer")?.playbook).toMatch(/Do not spawn zoom-out/);
    expect(recipeById("pr-reviewer")?.playbook).toMatch(/own-PR REQUEST_CHANGES/);
    expect(recipeById("pr-reviewer")?.kind).toBe("review");
    expect(recipeById("pr-reviewer")?.allowedTools).toEqual(REVIEW_TOOLS);
    expect(recipeById("pr-reviewer")?.allowedTools).toEqual(
      expect.arrayContaining(["canvas_write", "canvas_read"]),
    );
    expect(recipeById("pr-reviewer")?.allowedTools).not.toContain("file_write");
    expect(recipeById("pr-reviewer")?.allowedTools).not.toContain("git_push");
    expect(recipeById("installer-qa")?.runtime).toBe("vm");
    expect(recipeById("repo-fixer")?.dockerImage).toBe("locus/agent");
    expect(recipeById("env-setup")?.kind).toBe("setup");
    expect(recipeById("env-setup")?.dockerImage).toBe("locus/agent");
    expect(recipeById("env-setup")?.playbook).toMatch(/\.locus\/environment\.json/);
    expect(recipeById("env-setup")?.playbook).toMatch(/Locus\.md/);
    expect(recipeById("env-setup")?.playbook).toMatch(/Do not change application code/);
    expect(recipeById("env-setup")?.allowedTools).toContain("start_process");
    expect(recipeById("env-setup")?.allowedTools).toContain("preview");
    expect(recipeById("env-setup")?.allowedTools).toContain("playwright");
    expect(recipeById("env-setup")?.playbook).toMatch(/playwright click\/expect/);
    expect(recipeById("web-qa")?.dockerImage).toBe("locus/web-qa");
    expect(recipeById("web-qa")?.vision).toBe("latest");
    expect(recipeById("web-qa")?.playbook).toMatch(/browser_snapshot/);
    expect(recipeById("web-qa")?.playbook).toMatch(/take it over/);
    expect(recipeById("web-qa")?.allowedTools).toContain("playwright");
    expect(recipeById("web-qa")?.playbook).toMatch(/call playwright/);
    expect(recipeById("web-qa")?.playbook).toMatch(/screenshot into chat/);
    expect(recipeById("ops-loop")?.playbook).toMatch(/grafana_query/);
    expect(recipeById("ops-loop")?.playbook).toMatch(/incidentio_search/);
    expect(recipeById("ops-loop")?.playbook).toMatch(/portainer_containers/);
    expect(recipeById("ops-loop")?.allowedTools).toContain("jira_comment");
    expect(recipeById("ops-loop")?.allowedTools).toContain("jira_update");
    expect(recipeById("ops-loop")?.allowedTools).toContain("linear_search");
    expect(recipeById("ops-loop")?.allowedTools).toContain("linear_update");
    expect(recipeById("ops-loop")?.playbook).toMatch(/linear_search/);
    expect(recipeById("ops-loop")?.allowedTools).toContain("incidentio_search");
    expect(recipeById("ops-loop")?.allowedTools).toContain("incidentio_create");
    expect(recipeById("ops-loop")?.playbook).toMatch(/sentry_search/);
    expect(recipeById("ops-loop")?.allowedTools).toContain("jira_comment");
    expect(recipeById("ops-loop")?.allowedTools).toContain("jira_update");
    expect(recipeById("ops-loop")?.allowedTools).toContain("sentry_get");
    expect(recipeById("ops-loop")?.allowedTools).toContain("slack_post");
    expect(recipeById("ops-loop")?.allowedTools).toContain("portainer_container_action");
    expect(recipeById("ops-loop")?.allowedTools).toContain("k8s_logs");
    expect(recipeById("ops-loop")?.allowedTools).toContain("k8s_apply");
    expect(recipeById("ops-loop")?.playbook).toMatch(/k8s_logs/);
  });

  it("hides the Windows VM recipe until that ISO is configured", () => {
    expect(visibleRecipes([]).map((r) => r.id)).toEqual([
      "pr-reviewer",
      "repo-fixer",
      "env-setup",
      "web-qa",
      "ops-loop",
    ]);
    expect(visibleRecipes(["ubuntu"]).map((r) => r.id)).toEqual([
      "pr-reviewer",
      "repo-fixer",
      "env-setup",
      "web-qa",
      "ops-loop",
    ]);
    expect(visibleRecipes(["windows-10"]).map((r) => r.id)).toEqual([
      "pr-reviewer",
      "installer-qa",
      "repo-fixer",
      "env-setup",
      "web-qa",
      "ops-loop",
    ]);
    expect(visibleRecipes(["windows-11"]).map((r) => r.id)).toEqual([
      "pr-reviewer",
      "installer-qa",
      "repo-fixer",
      "env-setup",
      "web-qa",
      "ops-loop",
    ]);
  });

  it("uses allowlists and images the guest can actually take", () => {
    for (const recipe of AGENT_RECIPES) {
      expect(recipe.playbook.length).toBeGreaterThan(20);
      expect(recipe.prompt.length).toBeGreaterThan(10);
      if (recipe.dockerImage) expect(parseDockerImage(recipe.dockerImage)).toBeTruthy();
      if (recipe.allowedTools?.length) {
        expect(parseToolAllowlist(recipe.os, recipe.allowedTools, recipe.runtime)).toEqual(
          recipe.allowedTools,
        );
        if (isCanvasSession(recipe)) {
          expect(recipe.allowedTools).not.toContain("canvas_write");
        } else {
          expect(recipe.allowedTools).toEqual(
            expect.arrayContaining(["canvas_write", "canvas_read"]),
          );
        }
      }
    }
  });
});

describe("design recipes", () => {
  it("ships landing, dashboard, deck, one-pager, and mobile", () => {
    expect(DESIGN_RECIPES.map((r) => r.id)).toEqual([
      "landing-page",
      "app-dashboard",
      "slide-deck",
      "one-pager",
      "mobile-screen",
    ]);
    expect(recipeById("landing-page")?.kind).toBe("design");
    expect(recipeById("slide-deck")?.dockerImage).toBe(DESIGN_DOCKER_IMAGE);
  });

  it("researches a named public product before interviewing", () => {
    expect(DESIGN_PLAYBOOK).toContain("ask_user");
    expect(DESIGN_PLAYBOOK).toMatch(/websearch \(1–2 queries\)/);
    expect(DESIGN_PLAYBOOK).toMatch(/do not interview to ask what it is/);
    expect(DESIGN_PLAYBOOK).toMatch(/3–5/);
    expect(DESIGN_PLAYBOOK).toContain("Product screens");
    expect(DESIGN_PLAYBOOK).toContain("icon tiles");
    expect(DESIGN_PLAYBOOK).toContain("data-tune");
    expect(DESIGN_PLAYBOOK).toContain("CONTEXT.md");
    expect(DESIGN_PLAYBOOK).toContain("file_write");
    expect(DESIGN_PLAYBOOK).toMatch(/Never paste the page source into chat/);
    expect(DESIGN_PLAYBOOK).toMatch(/Do not claim the canvas is live/);
    expect(DESIGN_PLAYBOOK).toMatch(/Never split the page into parts/);
    expect(DESIGN_PLAYBOOK).toMatch(/Finish with <\/html>/);
    expect(DESIGN_PLAYBOOK).toMatch(/call preview with no port/);
    expect(DESIGN_PLAYBOOK).toMatch(/call playwright/);
    expect(DESIGN_PLAYBOOK).toMatch(/Do not stop after the first paint/);
    expect(DESIGN_PLAYBOOK).toMatch(/screenshot into chat/);
    expect(DESIGN_PLAYBOOK).toMatch(/never tell the operator to run npx serve/);
    expect(DESIGN_PLAYBOOK).toMatch(/process\.cwd\(\)/);
    expect(DESIGN_TOOLS).toContain("preview");
    expect(DESIGN_TOOLS).toContain("playwright");
    expect(DESIGN_TOOLS).toContain("figma_get");
    expect(DESIGN_PLAYBOOK).toMatch(/figma_get/);
    expect(DESIGN_PLAYBOOK).toContain(".locus-variants/direction-1.html");
    expect(CURSOR_CODING_ROUTING_CARD).toMatch(/coding workspace/);
    expect(CURSOR_CODING_ROUTING_CARD).toMatch(/StrReplace or Write/);
    expect(CURSOR_CODING_ROUTING_CARD).toMatch(/Shell the project's tests/);
    expect(CURSOR_CODING_ROUTING_CARD).toMatch(/Do not claim the work is done/);
    expect(CURSOR_CODING_ROUTING_CARD).toMatch(/Do not exec the Locus desktop/);
    expect(CURSOR_DESIGN_ROUTING_CARD).toMatch(/relative path index\.html/);
    expect(CURSOR_DESIGN_ROUTING_CARD).toMatch(/Write tool/);
    expect(CURSOR_DESIGN_ROUTING_CARD).toMatch(/do not split into parts/);
    expect(CURSOR_DESIGN_ROUTING_CARD).toMatch(/Do not write \/workspace\/index\.html/);
    expect(CURSOR_DESIGN_ROUTING_CARD).toMatch(/nested workspace\//);
    expect(CURSOR_DESIGN_ROUTING_CARD).toMatch(/Do not end the turn with only chat/);
    expect(CURSOR_DESIGN_ROUTING_CARD).toMatch(/preview \(no port\)/);
    expect(CURSOR_DESIGN_ROUTING_CARD).toMatch(/call playwright/);
    expect(CURSOR_DESIGN_ROUTING_CARD).toMatch(/Do not stop after the first paint/);
    expect(CURSOR_DESIGN_ROUTING_CARD).toMatch(/npx serve/);
    expect(CURSOR_GAME_ROUTING_CARD).toMatch(/sandboxed iframe/);
    expect(CURSOR_GAME_ROUTING_CARD).toMatch(/Never Write a snippet/);
    expect(CURSOR_GAME_ROUTING_CARD).toMatch(/type=button/);
    expect(CURSOR_GAME_ROUTING_CARD).toMatch(/locus MCP tool playwright/);
    expect(CURSOR_GAME_ROUTING_CARD).toMatch(/stats\.time/);
    expect(CURSOR_GAME_ROUTING_CARD).toMatch(/streamContent/);
    expect(CURSOR_GAME_ROUTING_CARD).toMatch(/_chk\.mjs/);
    expect(CURSOR_GAME_ROUTING_CARD).toMatch(/__locusGame/);
    expect(CURSOR_GAME_ROUTING_CARD).toMatch(/Do not write \/workspace\/index\.html/);
    expect(CURSOR_GAME_ROUTING_CARD).toMatch(/vendor\/assets\/index\.json/);
    expect(CURSOR_GAME_ROUTING_CARD).toMatch(/How to Play overlay/);
    expect(CURSOR_GAME_ROUTING_CARD).toMatch(/style references/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/asset studio root/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/__locusAsset/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/--head --arms --legs --twist/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/taint getImageData/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/crossOrigin/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/Do not file_read attached PNGs/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/never the document, HUD/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/source\.png/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/source-side\.png/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/exportStl/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/silhouette/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/preserve-3d/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/#btnWire/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/do not call orient/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/Never Write a snippet/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/saved asset style/);
    expect(ASSET_MCP_INSTRUCTIONS).toMatch(/canvas-files/);
    expect(ASSET_MCP_INSTRUCTIONS).toMatch(/do not call orient/);
    expect(DESIGN_MCP_INSTRUCTIONS).toMatch(/playwright/);
    expect(DESIGN_MCP_INSTRUCTIONS).toMatch(/first paint/);
  });

  it("prompts kit starting points and three-direction explores", () => {
    expect(formatStartingPointPrompt("Open tickets")).toMatch(/Open tickets/);
    expect(formatStartingPointPrompt("Open tickets")).toContain(
      "do not invent a generic landing page",
    );
    expect(exploreDirectionsPrompt(true)).toContain(".locus-variants/direction-1.html");
    expect(exploreDirectionsPrompt(false)).toContain("three distinct visual directions");
    expect(exploreDirectionsPrompt(false)).toContain("file_write");
    expect(exploreDirectionsPrompt(false)).toContain("do not apply_patch a whole file");
  });

  it("keeps design work in Docker with a canvas allowlist", () => {
    for (const recipe of DESIGN_RECIPES) {
      expect(recipe.kind).toBe("design");
      expect(recipe.runtime).toBe("docker");
      expect(recipe.playbook).toContain("/workspace/index.html");
      expect(parseDockerImage(recipe.dockerImage ?? "")).toBe("locus/agent:0.1");
      expect(parseToolAllowlist(recipe.os, recipe.allowedTools ?? [], recipe.runtime)).toEqual(
        DESIGN_TOOLS,
      );
    }
  });

  it("keeps games in Docker with a playable-canvas playbook", () => {
    expect(recipeById("arcade")?.kind).toBe("game");
    expect(recipeById("juice")?.kind).toBe("game");
    expect(GAME_PLAYBOOK).toMatch(/fully playable web game/i);
    expect(GAME_PLAYBOOK).toMatch(/__locusGame/);
    expect(GAME_PLAYBOOK).toMatch(/locus-game/);
    expect(GAME_PLAYBOOK).toMatch(/stats/);
    expect(GAME_PLAYBOOK).toMatch(/mute/);
    expect(GAME_PLAYBOOK).toMatch(/--seed/);
    expect(GAME_PLAYBOOK).toMatch(/GAME\.md/);
    expect(GAME_PLAYBOOK).toMatch(/last-run/);
    expect(GAME_PLAYBOOK).toMatch(/replay/);
    expect(GAME_PLAYBOOK).toMatch(/sandboxed iframe/i);
    expect(GAME_PLAYBOOK).toMatch(/_chk\.mjs/);
    expect(GAME_PLAYBOOK).toMatch(/stats\.time/);
    expect(GAME_PLAYBOOK).toMatch(/HUD expect of road #/);
    expect(GAME_PLAYBOOK).toMatch(/Play mode only forwards keys/);
    expect(GAME_PLAYBOOK).toMatch(/vendor\/assets/);
    expect(GAME_PLAYBOOK).toMatch(/GDD\.md/);
    expect(GAME_PLAYBOOK).toMatch(/rooms\.json/);
    expect(GAME_PLAYBOOK).toMatch(/How to Play overlay/);
    expect(GAME_PLAYBOOK).toMatch(/locus-attachments are style references/);
    expect(GAME_PLAYBOOK).toMatch(/hotseat/);
    expect(GAME_TOOLS).toContain("record_screen");
    expect(GAME_RECIPES.map((row) => row.id)).toEqual([
      "arcade",
      "platformer",
      "puzzle",
      "card-table",
      "arena",
      "match-3",
      "trivia",
      "tower-defense",
      "racing",
      "maze",
      "juice",
      "hold-move",
      "mobile-touch",
      "speedrun",
      "roguelike",
      "endless-drive",
    ]);
    const letters = GAME_RECIPES.map((row) => recipeShortcut(row));
    expect(new Set(letters).size).toBe(letters.length);
    expect(recipeShortcut(GAME_RECIPES.find((row) => row.id === "match-3")!)).toBe("3");
    expect(GAME_REMIX_PROMPTS.length).toBeGreaterThanOrEqual(6);
    expect(kitForGameDimension("3d")).toBe("three-starter");
    expect(kitForGameDimension("2d", "phaser")).toBe("phaser");
    expect(kitForGameDimension("2d", "three-starter")).toBe("pixel-pack");
    expect(looksGameImageFile({ type: "image/png", name: "hero.png" })).toBe(true);
    expect(looksGameImageFile({ type: "text/plain", name: "notes.txt" })).toBe(false);
    expect(composeGameLaunchPrompt({ prompt: "Arcade dodge", hotseat: true })).toMatch(/hotseat/);
    expect(composeGameLaunchPrompt({ prompt: "Arcade dodge", hasImages: true })).toMatch(
      /style references/,
    );
    for (const recipe of GAME_RECIPES) {
      expect(recipe.kind).toBe("game");
      expect(recipe.runtime).toBe("docker");
      expect(recipe.playbook).toBe(GAME_PLAYBOOK);
      expect(recipe.allowedTools).toEqual(GAME_TOOLS);
    }
  });

  it("keeps assets in Docker with an image-to-3D playbook", () => {
    expect(recipeById("image-to-3d")?.kind).toBe("assets");
    expect(recipeById("rig")?.kind).toBe("assets");
    expect(ASSET_PLAYBOOK).toMatch(/asset artist/i);
    expect(ASSET_PLAYBOOK).toMatch(/__locusAsset/);
    expect(ASSET_PLAYBOOK).toMatch(/zoom/);
    expect(ASSET_PLAYBOOK).toMatch(/never the document, HUD/);
    expect(ASSET_PLAYBOOK).toMatch(/ASSET\.md/);
    expect(ASSET_PLAYBOOK).toMatch(/--head --arms --legs --twist/);
    expect(ASSET_PLAYBOOK).toMatch(/humanoid or quadruped/);
    expect(ASSET_PLAYBOOK).toMatch(/Image-to-3D/);
    expect(ASSET_PLAYBOOK).toMatch(/taint/);
    expect(ASSET_PLAYBOOK).toMatch(/crossOrigin/);
    expect(ASSET_PLAYBOOK).toMatch(/do not click Wireframe in a loop/);
    expect(ASSET_PLAYBOOK).toMatch(/source\.png/);
    expect(ASSET_PLAYBOOK).toMatch(/preserve-3d/);
    expect(ASSET_PLAYBOOK).toMatch(/do not call preview/);
    expect(ASSET_PLAYBOOK).toMatch(/after the first viewable/);
    expect(ASSET_PLAYBOOK).toMatch(/pickup/);
    expect(ASSET_PLAYBOOK).toMatch(/attack-heavy/);
    expect(ASSET_PLAYBOOK).toMatch(/saved asset style/);
    expect(ASSET_PLAYBOOK).toMatch(/High detail/);
    expect(ASSET_PLAYBOOK).toMatch(/printability/i);
    expect(ASSET_PLAYBOOK).toMatch(/A-Pose/);
    expect(ASSET_PLAYBOOK).toMatch(/Ultra 4x/);
    expect(ASSET_PLAYBOOK).toMatch(/exportStl/);
    expect(ASSET_PLAYBOOK).toMatch(/source-side\.png/);
    expect(ASSET_PLAYBOOK).toMatch(/punch out backdrop → silhouette hull/);
    expect(ASSET_PLAYBOOK).toMatch(/vendor\/reconstruct\.js/);
    expect(ASSET_PLAYBOOK).toMatch(/not a billboard/);
    expect(CURSOR_ASSET_ROUTING_CARD).toMatch(/vendor\/reconstruct\.js/);
    expect(recipeById("image-to-3d")?.prompt).toMatch(/reconstruct\.js/);
    expect(recipeById("hold")?.prompt).toMatch(/pickup/);
    expect(recipeById("attacks")?.prompt).toMatch(/attack-ranged/);
    expect(recipeById("walk-cycle")?.prompt).toMatch(/carry/);
    expect(ASSET_TOOLS).toContain("playwright");
    expect(ASSET_RECIPES.map((row) => row.id)).toEqual([
      "image-to-3d",
      "text-to-3d",
      "cutout",
      "sprite-sheet",
      "voxel",
      "low-poly",
      "rig",
      "walk-cycle",
      "hold",
      "attacks",
      "pbr",
    ]);
    const letters = ASSET_RECIPES.map((row) => row.title.match(/[A-Za-z]/)?.[0]?.toUpperCase());
    expect(new Set(letters).size).toBe(letters.length);
    for (const recipe of ASSET_RECIPES) {
      expect(recipe.kind).toBe("assets");
      expect(recipe.runtime).toBe("docker");
      expect(recipe.playbook).toBe(ASSET_PLAYBOOK);
      expect(recipe.allowedTools).toEqual(ASSET_TOOLS);
    }
  });
});

describe("first-task samples", () => {
  it("ships one local workspace prompt, not a repo tour", () => {
    expect(FIRST_TASKS).toHaveLength(2);
    expect(FIRST_TASKS[0]?.title).toMatch(/hello\.txt/);
    expect(FIRST_TASKS[0]?.prompt).toMatch(/\/workspace\/hello\.txt/);
    expect(FIRST_TASKS[0]?.prompt).toMatch(/Do not clone/);
    expect(DESIGN_RECIPES.some((row) => row.id === "landing-page")).toBe(true);
    expect(DESIGN_RECIPES.some((row) => /try a sample landing page/i.test(row.title))).toBe(false);
  });

  it("shows only with a provider and very few agent sessions", () => {
    expect(showFirstTaskPills({ sessions: [], hasProvider: true })).toBe(true);
    expect(showFirstTaskPills({ sessions: [{ kind: "agent" }], hasProvider: true })).toBe(true);
    expect(
      showFirstTaskPills({
        sessions: [{ kind: "agent" }, { kind: "agent" }],
        hasProvider: true,
      }),
    ).toBe(false);
    expect(showFirstTaskPills({ sessions: [], hasProvider: false })).toBe(false);
    expect(
      showFirstTaskPills({
        sessions: [{ kind: "design" }, { kind: "design" }],
        hasProvider: true,
      }),
    ).toBe(true);
    expect(
      showFirstTaskPills({
        sessions: [{ kind: "game" }, { kind: "game" }],
        hasProvider: true,
      }),
    ).toBe(true);
    expect(
      showFirstTaskPills({
        sessions: [{ kind: "assets" }, { kind: "assets" }],
        hasProvider: true,
      }),
    ).toBe(true);
  });
});
