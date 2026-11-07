import { describe, expect, it } from "vitest";
import {
  ASSET_BUILD_DEFAULTS,
  applyAssetBuildPrompt,
  assetBuildEquals,
  assetFaceCount,
  assetFacesOverBudget,
  formatAssetBuildBrief,
  formatAssetBuildLabel,
  formatAssetBuildPrompt,
  formatAssetQualityLabel,
  formatAssetResolutionLabel,
  formatAssetRestPoseLabel,
  formatAssetRestPosePrompt,
  formatAssetTopologyLabel,
  parseAssetBuild,
  resolveAppliedAssetBuild,
  resolveAssetBuild,
  upsertAssetBuildSection,
} from "./models/assetBuild.js";

describe("asset build settings", () => {
  it("parses aliases and ignores empty objects", () => {
    expect(parseAssetBuild(undefined)).toBeUndefined();
    expect(parseAssetBuild({})).toBeUndefined();
    expect(
      parseAssetBuild({
        topology: "High Detail",
        quality: "precise",
        resolution: "ultra-4x",
        restPose: "tpose",
        texture: "off",
        split: 1,
        multiView: "yes",
        enhance: "0",
        printable: true,
        polyBudget: "20k",
      }),
    ).toEqual({
      topology: "high-detail",
      quality: "flagship",
      resolution: "4x",
      restPose: "t-pose",
      polyBudget: "20k",
      texture: false,
      split: true,
      multiView: true,
      enhance: false,
      printable: true,
    });
    expect(resolveAssetBuild(undefined)).toEqual(ASSET_BUILD_DEFAULTS);
    expect(resolveAssetBuild({ topology: "smart" } as never)).toMatchObject({
      topology: "smart",
      quality: "standard",
    });
  });

  it("labels a compact toolbar summary", () => {
    expect(formatAssetTopologyLabel("high-detail")).toBe("High detail");
    expect(formatAssetQualityLabel("flagship")).toBe("Flagship");
    expect(formatAssetResolutionLabel("2x")).toBe("Ultra 2x");
    expect(formatAssetRestPoseLabel("a-pose")).toBe("A-Pose");
    expect(formatAssetBuildLabel(ASSET_BUILD_DEFAULTS)).toBe("Smart topology · Standard");
    expect(
      formatAssetBuildLabel({
        ...ASSET_BUILD_DEFAULTS,
        topology: "high-detail",
        quality: "flagship",
        resolution: "4x",
      }),
    ).toBe("High detail · Flagship · Ultra 4x");
    expect(assetBuildEquals(ASSET_BUILD_DEFAULTS, { ...ASSET_BUILD_DEFAULTS })).toBe(true);
    expect(
      assetBuildEquals(ASSET_BUILD_DEFAULTS, { ...ASSET_BUILD_DEFAULTS, printable: true }),
    ).toBe(false);
    expect(assetFaceCount({ faces: 12_000, tris: 8_000 })).toBe(12_000);
    expect(assetFaceCount({ tris: 8_000 })).toBe(8_000);
    expect(assetFacesOverBudget({ faces: 12_000 }, "8k")).toBe(true);
    expect(assetFacesOverBudget({ faces: 8_000 }, "8k")).toBe(false);
    expect(assetFacesOverBudget(undefined, "8k")).toBe(false);
    expect(
      resolveAppliedAssetBuild({
        assetBuild: { ...ASSET_BUILD_DEFAULTS, split: true },
        assetAppliedBuild: ASSET_BUILD_DEFAULTS,
      }),
    ).toEqual(ASSET_BUILD_DEFAULTS);
    expect(
      resolveAppliedAssetBuild({ assetBuild: { ...ASSET_BUILD_DEFAULTS, split: true } }),
    ).toMatchObject({ split: true });
    expect(formatAssetRestPosePrompt("a-pose")).toMatch(/prop/);
    expect(formatAssetRestPosePrompt("a-pose")).toMatch(/do not invent a skeleton/);
    expect(formatAssetRestPosePrompt("t-pose")).toMatch(/character/);
  });

  it("writes a living brief section and a generation prompt", () => {
    const build = {
      ...ASSET_BUILD_DEFAULTS,
      topology: "high-detail" as const,
      printable: true,
      split: true,
    };
    const brief = formatAssetBuildBrief(build);
    expect(brief).toMatch(/## Build/);
    expect(brief).toMatch(/High detail/);
    expect(brief).toMatch(/Printability: on/);
    const prompt = formatAssetBuildPrompt(build);
    expect(prompt).toMatch(/Operator build settings/);
    expect(prompt).toMatch(/watertight/);
    expect(prompt).toMatch(/8,?000 faces/);
    expect(prompt).toMatch(/Standard texture maps/);
    expect(prompt).not.toMatch(/low-poly hull|denser hull/);
    expect(prompt).toMatch(/On a prop/);
    expect(prompt).toMatch(/do not invent a skeleton/);
    expect(prompt).toMatch(/sibling meshes/);
    expect(prompt).toMatch(/__locusAsset\.stats/);
    expect(prompt).toMatch(/vendor\/reconstruct\.js/);
    expect(prompt).toMatch(/punch out the backdrop/);
    expect(prompt).toMatch(/Do not billboard/);
    expect(prompt).toMatch(/Photo contour budget/);
    expect(applyAssetBuildPrompt(build)).toMatch(/Patch \/workspace\/index\.html/);
    const next = upsertAssetBuildSection("# Hero\n\n## Export\n\nPNG.\n", build);
    expect(next).toMatch(/## Build/);
    expect(next.indexOf("## Build")).toBeLessThan(next.indexOf("## Export"));
    const replaced = upsertAssetBuildSection(next, ASSET_BUILD_DEFAULTS);
    expect(replaced).toMatch(/Smart topology/);
    expect(replaced.match(/## Build/g)).toHaveLength(1);
  });
});
