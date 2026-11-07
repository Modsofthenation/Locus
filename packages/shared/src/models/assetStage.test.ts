import { describe, expect, it } from "vitest";
import { ASSET_BUILD_DEFAULTS } from "./assetBuild.js";
import {
  ASSET_VIEW_FILES,
  assetCanvasFileUrl,
  assetShowsPose,
  assetShowsStage3d,
  assetVisibleClips,
  assetVisibleIterateChips,
  assetWorkingChip,
  dropAssetPhotoPrompt,
  formatAssetBackgroundHint,
  formatAssetCameraHint,
  formatAssetCameraLabel,
  formatAssetLightsHint,
  formatAssetMaterialHint,
  formatAssetMeshHealth,
  generateAssetPrompt,
  inferAssetPipeline,
  inferAssetSubject,
  viewSlotForAssetName,
} from "./assetStage.js";

describe("asset stage helpers", () => {
  it("maps view slots and canvas-files URLs", () => {
    expect(ASSET_VIEW_FILES.front).toBe("source.png");
    expect(ASSET_VIEW_FILES.side).toBe("source-side.png");
    expect(viewSlotForAssetName("side.png", 0, 1)).toBe("side");
    expect(viewSlotForAssetName("back-view.webp", 0, 1)).toBe("back");
    expect(viewSlotForAssetName("photo.png", 1, 3)).toBe("side");
    expect(viewSlotForAssetName("photo.png", 2, 3)).toBe("back");
    expect(assetCanvasFileUrl("s1", "source.png")).toBe("/api/sessions/s1/canvas-files/source.png");
    expect(formatAssetCameraLabel("reset")).toBe("Reset");
    expect(formatAssetCameraHint("front")).toMatch(/front/);
    expect(formatAssetCameraHint("reset")).toMatch(/orientation/);
    expect(formatAssetMaterialHint("clay")).toMatch(/form/);
    expect(formatAssetLightsHint("rim")).toMatch(/silhouette/);
    expect(formatAssetBackgroundHint("checkered")).toMatch(/silhouette/);
  });

  it("infers pipeline, subject, clips, and pose visibility", () => {
    expect(inferAssetPipeline("")).toBe("silhouette");
    expect(inferAssetPipeline("<div style='preserve-3d'>css-3d</div>")).toBe("silhouette");
    expect(inferAssetPipeline("<canvas></canvas><script>THREE.Mesh</script>")).toBe("hull");
    expect(
      inferAssetPipeline(
        `<canvas></canvas><script>import * as THREE from "./vendor/three.module.js"; const SRC="./source.png"</script>`,
      ),
    ).toBe("texture");
    expect(
      inferAssetPipeline(
        `<html data-tune="head:-45-45"><canvas></canvas><script>window.__locusAsset={play(){}}</script></html>`,
      ),
    ).toBe("rig");
    expect(inferAssetSubject({ title: "Clay vase", html: "<canvas></canvas>" })).toBe("prop");
    expect(
      inferAssetSubject({
        title: "Hero mesh",
        html: '<html data-tune="head:-45-45"><div id="rig"></div></html>',
      }),
    ).toBe("character");
    expect(inferAssetSubject({ recipeId: "cutout", html: "<div>sprite</div>" })).toBe("sprite");
    expect(assetShowsStage3d("sprite")).toBe(false);
    expect(assetShowsStage3d("character")).toBe(true);
    expect(assetVisibleIterateChips("sprite")).toEqual(["texture", "low-poly"]);
    expect(assetVisibleIterateChips("character")).toContain("retopo");
    expect(formatAssetMeshHealth({ holes: 2, openEdges: 4 })).toMatch(/2 holes/);
    expect(formatAssetMeshHealth({ printable: true })).toBe("Clean");
    expect(
      assetShowsPose("character", '<html data-tune="head:-45-45"><div id="rig"></div></html>'),
    ).toBe(true);
    expect(assetShowsPose("prop", "<canvas></canvas>")).toBe(false);
    expect(assetVisibleClips({ title: "Clay vase", html: "<canvas></canvas>" })).toEqual([]);
    expect(
      assetVisibleClips({
        title: "Hero mesh",
        html: '<html data-tune="head:-45-45"><div id="rig"></div></html>',
      }),
    ).toContain("walk");
    expect(
      assetVisibleClips({
        title: "Hero mesh",
        html: '<html data-tune="head:-45-45"><div id="rig"></div></html>',
      }),
    ).not.toContain("attack-heavy");
    expect(assetVisibleClips({ recipeId: "attacks", html: "<div data-tune></div>" })).toContain(
      "attack-ranged",
    );
  });

  it("writes generate and drop prompts plus working chips", () => {
    const first = generateAssetPrompt(ASSET_BUILD_DEFAULTS, false);
    expect(first).toMatch(/first viewable/);
    expect(first).toMatch(/silhouette/);
    expect(first).toMatch(/vendor\/reconstruct\.js/);
    expect(first).toMatch(/albedo on the subject only/);
    expect(first).toMatch(/exportStl/);
    expect(first).not.toMatch(/Saved asset style/);
    expect(generateAssetPrompt(ASSET_BUILD_DEFAULTS, true)).toMatch(
      /Patch \/workspace\/index.html/,
    );
    expect(generateAssetPrompt(ASSET_BUILD_DEFAULTS, true)).toMatch(/already in the system prompt/);
    expect(generateAssetPrompt(ASSET_BUILD_DEFAULTS, true)).toMatch(/Smart topology/);
    expect(generateAssetPrompt(ASSET_BUILD_DEFAULTS, true)).not.toMatch(
      /Photo contour budget|punch out the backdrop/,
    );
    expect(
      generateAssetPrompt(ASSET_BUILD_DEFAULTS, true, {
        name: "Clay hero",
        summary: "Chunky terracotta",
        guidelines: "Rounded silhouettes.",
      }),
    ).toMatch(/Saved asset style "Clay hero"/);
    expect(dropAssetPhotoPrompt("side", true)).toMatch(/source-side\.png/);
    expect(dropAssetPhotoPrompt("side", true)).toMatch(/already at/);
    expect(dropAssetPhotoPrompt("front", false)).toMatch(/source\.png/);
    expect(dropAssetPhotoPrompt("front", false)).toMatch(/landed by the host/);
    expect(dropAssetPhotoPrompt("front", false)).toMatch(/reconstruct\.js/);
    expect(dropAssetPhotoPrompt("front", false)).not.toMatch(/Copy it/);
    expect(assetWorkingChip({ working: true })).toBe("Tracing silhouette…");
    expect(
      assetWorkingChip({
        working: true,
        html: "<canvas></canvas><script>THREE.Mesh</script>",
      }),
    ).toBe("Building hull…");
  });
});
