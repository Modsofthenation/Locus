import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  ASSET_ATTACK_VARIANT_CLIPS,
  ASSET_CLIPS,
  ASSET_CLIP_LINE,
  ASSET_CORE_CLIPS,
  ASSET_ITERATE_CHIPS,
  ASSET_KITS,
  ASSET_POSE_PRESETS,
  formatAssetClipLabel,
  ASSET_RASTER_READ,
  ASSET_SOURCE_FILE,
  ASSET_ZOOM_DEFAULT,
  ASSET_ZOOM_MAX,
  ASSET_ZOOM_MIN,
  ASSET_ZOOM_TARGET_SELECTOR,
  ASSET_STAGE_FILL_SELECTOR,
  applyAssetBriefPrompt,
  assetCanvasBrokenPrompt,
  clampAssetZoom,
  exploreAssetDirectionsPrompt,
  formatAssetCanvasSnapshot,
  formatAssetZoom,
  formatPromoteAssetBrief,
  isAssetRasterPath,
  iterateAssetPrompt,
  looksLikeAssetIterateRequest,
  assetIterateUnchangedNeedsHuman,
  ASSET_ITERATE_UNCHANGED_NEEDS_HUMAN,
  keepPosePrompt,
  livingAssetBrief,
  looksLikeHudOnlyAssetPlaytest,
  looksPlaceholderAsset,
  looksSculptedAsset,
  looksUnwiredAsset,
  looksWiredAsset,
  MAX_ASSET_SCULPT_NUDGES,
  parseAssetStudioStats,
  formatAssetStudioStats,
  assetStudioStatsFailReason,
  parseCanvasPoseAttrs,
  poseFromTune,
  resolveAssetKit,
  stepAssetZoom,
  tuneFromPose,
  withAssetChromeHook,
  withAssetPoseCss,
  parseAssetExportProgress,
  parseAssetExportFile,
  parseAssetExportBytes,
  formatAssetExportTitle,
  assetExportFileName,
  withAssetExportExtension,
  assetExportPhaseCopy,
  assetExportMissingMessage,
  ASSET_EXPORT_FORMATS,
  ASSET_EXPORT_MISSING_FILE,
} from "./assetCanvas.js";

describe("asset studio helpers", () => {
  it("resolves kits and pose knobs", () => {
    expect(ASSET_KITS.map((row) => row.id)).toEqual(["sprite-pack", "three-mesh", "rig-kit"]);
    expect(resolveAssetKit("rig-kit")?.title).toBe("Rig kit");
    expect(resolveAssetKit("nope")).toBeUndefined();
    expect(poseFromTune({ head: 12, arms: -4 })).toEqual({
      head: 12,
      arms: -4,
      legs: 0,
      twist: 0,
    });
    expect(tuneFromPose(ASSET_POSE_PRESETS.walk, { seed: 3 })).toMatchObject({
      ...ASSET_POSE_PRESETS.walk,
      seed: 3,
    });
    expect(
      parseCanvasPoseAttrs('<html data-tune="head:-20-20,arms:-80-80">').find(
        (row) => row.key === "head",
      ),
    ).toEqual({
      key: "head",
      min: -20,
      max: 20,
    });
    expect(ASSET_CLIPS).toEqual([
      "idle",
      "walk",
      "jump",
      "pickup",
      "carry",
      "attack",
      "attack-heavy",
      "attack-ranged",
    ]);
    expect(ASSET_CORE_CLIPS).toEqual(["idle", "walk", "jump", "pickup", "carry", "attack"]);
    expect(ASSET_ATTACK_VARIANT_CLIPS).toEqual(["attack-heavy", "attack-ranged"]);
    expect(formatAssetClipLabel("attack-heavy")).toBe("attack heavy");
    expect(ASSET_CLIP_LINE).toMatch(/pickup/);
    expect(ASSET_POSE_PRESETS.pickup.arms).toBe(48);
    expect(ASSET_POSE_PRESETS.carry.arms).toBe(-22);
    expect(clampAssetZoom(Number.NaN)).toBe(ASSET_ZOOM_DEFAULT);
    expect(clampAssetZoom(0)).toBe(ASSET_ZOOM_MIN);
    expect(clampAssetZoom(99)).toBe(ASSET_ZOOM_MAX);
    expect(stepAssetZoom(1, "in")).toBeCloseTo(1.08);
    expect(stepAssetZoom(1, "out")).toBeCloseTo(0.92);
    expect(formatAssetZoom(1.08)).toBe("108%");
    expect(ASSET_ZOOM_TARGET_SELECTOR).toMatch(/data-locus-asset-model/);
    expect(ASSET_ZOOM_TARGET_SELECTOR).toMatch(/#rig/);
    expect(ASSET_ZOOM_TARGET_SELECTOR).not.toMatch(/canvas|#stage/);
    expect(ASSET_STAGE_FILL_SELECTOR).toMatch(/canvas/);
    expect(ASSET_STAGE_FILL_SELECTOR).toMatch(/#stage/);
  });

  it("writes a living brief and iterate prompts", () => {
    const brief = livingAssetBrief({ title: "Hero", mode: "3d", source: "photo.png" });
    expect(brief).toMatch(/# Hero/);
    expect(brief).toMatch(/3D mesh/);
    expect(brief).toMatch(/photo\.png/);
    expect(brief).toMatch(/__locusAsset/);
    expect(iterateAssetPrompt("rig", { pose: ASSET_POSE_PRESETS.idle })).toMatch(/Rig pass/);
    expect(iterateAssetPrompt("rig", { pose: ASSET_POSE_PRESETS.idle })).toMatch(/grasp/);
    expect(iterateAssetPrompt("animate", { pose: ASSET_POSE_PRESETS.walk })).toMatch(/pickup/);
    expect(iterateAssetPrompt("animate", { pose: ASSET_POSE_PRESETS.walk })).toMatch(
      /attack-heavy/,
    );
    expect(brief).toMatch(/pickup/);
    expect(brief).toMatch(/## Build/);
    expect(brief).toMatch(/Smart topology/);
    expect(formatPromoteAssetBrief({ title: "Hero" })).toMatch(/attack-ranged/);
    expect(ASSET_KITS.find((row) => row.id === "rig-kit")?.files["vendor/rig.js"]).toMatch(
      /pickup/,
    );
    expect(ASSET_ITERATE_CHIPS.map((row) => row.id)).toEqual([
      "retopo",
      "texture",
      "rig",
      "animate",
      "low-poly",
      "split",
      "print",
    ]);
    expect(iterateAssetPrompt("print", { pose: ASSET_POSE_PRESETS.idle })).toMatch(/watertight/);
    expect(
      iterateAssetPrompt("retopo", {
        pose: ASSET_POSE_PRESETS.idle,
        style: { name: "Clay hero", summary: "", guidelines: "Rounded silhouettes." },
      }),
    ).toMatch(/Saved asset style "Clay hero"/);
    expect(iterateAssetPrompt("split", { pose: ASSET_POSE_PRESETS.idle })).toMatch(
      /sibling meshes/,
    );
    const studio = `<html><canvas></canvas><script>reconstructFromPhoto("./source.png")</script></html>`;
    const retopo = iterateAssetPrompt("retopo", { pose: ASSET_POSE_PRESETS.idle });
    expect(looksLikeAssetIterateRequest(retopo)).toBe(true);
    expect(looksLikeAssetIterateRequest(applyAssetBriefPrompt("# x"))).toBe(true);
    expect(looksLikeAssetIterateRequest("how do I orbit?")).toBe(false);
    expect(looksLikeAssetIterateRequest("Build a wired 3D hero mesh")).toBe(false);
    expect(looksLikeAssetIterateRequest("make the mesh smoother")).toBe(false);
    expect(
      assetIterateUnchangedNeedsHuman({
        userText: retopo,
        html: studio,
        turnStartHtml: studio,
      }),
    ).toBe(ASSET_ITERATE_UNCHANGED_NEEDS_HUMAN);
    expect(
      assetIterateUnchangedNeedsHuman({
        userText: retopo,
        html: `${studio}<span>cleaner</span>`,
        turnStartHtml: studio,
      }),
    ).toBeUndefined();
    expect(
      assetIterateUnchangedNeedsHuman({
        userText: "make the mesh smoother",
        html: studio,
        turnStartHtml: studio,
      }),
    ).toBe(ASSET_ITERATE_UNCHANGED_NEEDS_HUMAN);
    expect(
      assetIterateUnchangedNeedsHuman({
        userText: "how do I orbit?",
        html: studio,
        turnStartHtml: studio,
      }),
    ).toBeUndefined();
    expect(
      assetIterateUnchangedNeedsHuman({
        userText: "looks good",
        html: studio,
        turnStartHtml: studio,
      }),
    ).toBeUndefined();
    expect(
      assetIterateUnchangedNeedsHuman({
        userText: retopo,
        html: `<script data-locus-asset-chrome>host()</script>${studio}`,
        turnStartHtml: studio,
      }),
    ).toBe(ASSET_ITERATE_UNCHANGED_NEEDS_HUMAN);
    expect(applyAssetBriefPrompt("# x")).toMatch(/ASSET\.md/);
    expect(keepPosePrompt(ASSET_POSE_PRESETS.jump)).toMatch(/head=-8/);
    expect(exploreAssetDirectionsPrompt(false)).toMatch(/direction-1\.html/);
    expect(
      exploreAssetDirectionsPrompt(true, {
        name: "Clay hero",
        summary: "Chunky terracotta",
        guidelines: "Rounded silhouettes.",
      }),
    ).toMatch(/Saved asset style "Clay hero"/);
    expect(formatPromoteAssetBrief({ title: "Hero", designSystemId: "rig-kit" })).toMatch(
      /Kit: rig-kit/,
    );
  });

  it("injects pose CSS and chrome once", () => {
    const html = "<html><head></head><body>studio</body></html>";
    const posed = withAssetPoseCss(html, { head: 9, arms: 2, legs: 1, twist: -3 });
    expect(posed).toMatch(/--head: 9/);
    expect(posed).toMatch(/data-locus-asset-pose/);
    expect(withAssetPoseCss(posed, { head: 4 })).toMatch(/--head: 4/);
    expect(posed.match(/data-locus-asset-pose/g)).toHaveLength(1);
    const hooked = withAssetChromeHook(posed);
    expect(hooked).toMatch(/locus-asset-pose/);
    expect(hooked).toMatch(/__locusAsset/);
    expect(hooked).toMatch(/locus-asset-zoom/);
    expect(hooked).toMatch(/locus-asset-zoom-changed/);
    expect(hooked).toMatch(/locus-asset-stats-request/);
    expect(hooked).toMatch(/locus-asset-stats/);
    expect(hooked).toMatch(/locus-asset-camera/);
    expect(hooked).toMatch(/locus-asset-grid/);
    expect(hooked).toMatch(/locus-asset-material/);
    expect(hooked).toMatch(/locus-asset-background/);
    expect(hooked).toMatch(/locus-asset-isolate/);
    expect(hooked).toMatch(/locus-asset-speed/);
    expect(hooked).toMatch(/locus-asset-scrub/);
    expect(hooked).toMatch(/exportStl/);
    expect(hooked).toMatch(/locus-asset-export-progress/);
    expect(hooked).toMatch(/locus-asset-export-file/);
    expect(hooked).toMatch(/locus-asset-export-bytes/);
    expect(hooked).toMatch(/locus-asset-pack-capture/);
    expect(hooked).toContain(ASSET_ZOOM_TARGET_SELECTOR);
    expect(hooked).toContain(ASSET_STAGE_FILL_SELECTOR);
    expect(hooked).toMatch(/style\.scale/);
    expect(hooked).toMatch(/freezePageZoom/);
    expect(hooked).toMatch(/pinStage/);
    expect(hooked).toMatch(/position:fixed!important;inset:0!important/);
    expect(hooked).toMatch(/#hud,#hint,#ui\{display:none!important\}/);
    expect(hooked).not.toMatch(/document\.documentElement\.style\.zoom = String\(z\)/);
    expect(ASSET_KITS.find((row) => row.id === "rig-kit")?.files["ASSET.md"]).toMatch(
      /never the page, HUD, canvas, or backdrop/,
    );
    expect(ASSET_KITS.find((row) => row.id === "three-mesh")?.files["ASSET.md"]).toMatch(
      /reconstructFromPhoto/,
    );
    expect(withAssetChromeHook(hooked)).toBe(hooked);
    const stale =
      "<html><body>studio<script data-locus-asset-chrome>oldExport()</script></body></html>";
    const upgraded = withAssetChromeHook(stale);
    expect(upgraded).toMatch(/locus-asset-export-progress/);
    expect(upgraded).not.toContain("oldExport()");
    expect(upgraded.match(/data-locus-asset-chrome/g)).toHaveLength(1);
  });

  it("labels export formats and parses progress from the chrome hook", () => {
    expect(ASSET_EXPORT_FORMATS).toEqual(["png", "glb", "stl", "textures"]);
    expect(formatAssetExportTitle("stl")).toBe("Export STL");
    expect(formatAssetExportTitle("textures")).toBe("Export textures");
    expect(assetExportFileName("Hero mesh", "stl")).toBe("hero-mesh.stl");
    expect(withAssetExportExtension("Hero/mesh.png", "stl")).toBe("mesh.stl");
    expect(assetExportPhaseCopy({ format: "stl", phase: "save" })).toBe(
      "Choose a file name and folder.",
    );
    expect(assetExportPhaseCopy({ format: "stl", phase: "prepare" })).toBe("Preparing STL…");
    expect(assetExportPhaseCopy({ format: "glb", phase: "build" })).toBe("Building GLB…");
    expect(assetExportPhaseCopy({ format: "png", phase: "done" })).toBe("PNG export ready");
    expect(assetExportMissingMessage("stl")).toBe("This studio has no STL exporter yet.");
    expect(ASSET_EXPORT_MISSING_FILE).toMatch(/no file was produced/);
    expect(
      parseAssetExportProgress({
        type: "locus-asset-export-progress",
        format: "stl",
        phase: "build",
        percent: 62,
      }),
    ).toEqual({
      type: "locus-asset-export-progress",
      format: "stl",
      phase: "build",
      percent: 62,
    });
    expect(parseAssetExportProgress({ type: "locus-asset-zoom-changed", scale: 1.08 })).toBeNull();
    expect(
      parseAssetExportProgress({
        type: "locus-asset-export-progress",
        format: "obj",
        phase: "done",
        percent: 100,
      }),
    ).toBeNull();
    expect(
      parseAssetExportFile({
        type: "locus-asset-export-file",
        format: "stl",
        filename: "hero.stl",
        mime: "model/stl",
        base64: "c29saWQ=",
      }),
    ).toEqual({
      type: "locus-asset-export-file",
      format: "stl",
      filename: "hero.stl",
      mime: "model/stl",
      base64: "c29saWQ=",
    });
    expect(parseAssetExportFile({ type: "locus-asset-export-progress", format: "stl" })).toBeNull();
  });

  it("snapshots a studio and detects a tainted-canvas operator prompt", () => {
    const html = `<!doctype html><html><body>
<canvas id="view"></canvas>
<script>
window.__locusAsset = { mode, wireframe, orbit, zoom, pose, play, pause, exportGlb, exportPng, stats };
const SRC = "./source.png";
octx.getImageData(0, 0, 8, 8);
</script></html>`;
    const snap = formatAssetCanvasSnapshot(html);
    expect(snap).toMatch(/Asset canvas snapshot/);
    expect(snap).toMatch(/__locusAsset keys: .*stats/);
    expect(snap).toMatch(/relative photo: yes/);
    expect(snap).toMatch(/pixel read \(getImageData\): yes/);
    expect(snap).toMatch(/taint getImageData/);
    expect(
      assetCanvasBrokenPrompt("getImageData: The canvas has been tainted by cross-origin data."),
    ).toBe(true);
    expect(assetCanvasBrokenPrompt("make a swan from this photo")).toBe(false);
    expect(isAssetRasterPath(".locus-attachments/image.png")).toBe(true);
    expect(isAssetRasterPath("C:\\host\\source.png")).toBe(true);
    expect(isAssetRasterPath("index.html")).toBe(false);
    expect(ASSET_RASTER_READ).toMatch(/do not file_read/i);
    expect(ASSET_RASTER_READ).toMatch(/source-side\.png/);
    expect(ASSET_RASTER_READ).toMatch(/already landed/);
    expect(ASSET_RASTER_READ).not.toMatch(/Copy front/);
    expect(ASSET_RASTER_READ).toMatch(/do not call preview/i);
    expect(ASSET_RASTER_READ).toMatch(/reconstruct\.js/);
    expect(ASSET_RASTER_READ).toMatch(/source-mask\.png/);
    expect(ASSET_RASTER_READ).not.toMatch(/call preview with no port/);
    expect(snap).toMatch(/do not call preview/i);
    expect(snap).not.toMatch(/call preview with no port/);
    expect(snap).toMatch(/host fallback: no/);
    expect(
      formatAssetCanvasSnapshot(
        `<html lang="en" data-locus-host-fallback="asset"><canvas></canvas></html>`,
      ),
    ).toMatch(/host fallback: yes/);
  });

  it("zooms the rig and leaves HUD unscaled when zoom() is missing", () => {
    const studio = runAssetChromeHook(
      "<html><body><div id='hud'>Studio</div><div id='rig'></div><div id='hint'>orbit</div></body></html>",
    );
    studio.post({ type: "locus-asset-zoom", scale: 1.08 });
    expect(studio.documentElement.style.zoom).toBe("1");
    expect(studio.body.style.zoom).toBe("1");
    expect(studio.hud.style.scale).toBe("");
    expect(studio.hint.style.scale).toBe("");
    expect(studio.rig.style.scale).toBe("1.08");
    expect(studio.documentElement.style.getProperty("--zoom")).toBe("1.08");
  });

  it("undoes page zoom from zoom() so HUD stays 1x", () => {
    const studio = runAssetChromeHook(
      "<html><body><div id='hud'>Studio</div><div id='rig'></div></body></html>",
      {
        zoom(z) {
          studio.documentElement.style.zoom = String(z);
        },
      },
    );
    studio.post({ type: "locus-asset-zoom", scale: 2 });
    expect(studio.documentElement.style.zoom).toBe("1");
    expect(studio.hud.style.scale).toBe("");
    expect(studio.rig.style.scale).toBe("2");
  });

  it("keeps the WebGL stage unscaled so the backdrop fills at every zoom", () => {
    const zoom = vi.fn();
    const studio = runAssetChromeHook(
      "<html><body><canvas id='stage'></canvas><div id='hud'>Studio</div></body></html>",
      { zoom },
    );
    studio.post({ type: "locus-asset-zoom", scale: 0.61 });
    expect(studio.canvas.style.scale).toBe("1");
    expect(studio.canvas.style.zoom).toBe("1");
    expect(studio.hud.style.scale).toBe("");
    expect(zoom).toHaveBeenCalledWith(0.61);
  });

  it("scales the rig without calling camera or studio zoom()", () => {
    const camera = vi.fn();
    const zoom = vi.fn();
    const studio = runAssetChromeHook(
      "<html><body><div id='hud'>Studio</div><div id='rig'></div></body></html>",
      { camera, zoom },
    );
    studio.rig.style.transform = "rotateY(35deg)";
    studio.post({ type: "locus-asset-camera", view: "side" });
    expect(camera).toHaveBeenCalledWith("side");
    camera.mockClear();
    studio.post({ type: "locus-asset-zoom", scale: 1.08 });
    expect(zoom).not.toHaveBeenCalled();
    expect(camera).not.toHaveBeenCalled();
    expect(studio.rig.style.scale).toBe("1.08");
    expect(studio.rig.style.transform).toBe("rotateY(35deg)");
  });

  it("treats CSS 3D and HUD expects as unwired / fake playtests", () => {
    expect(ASSET_SOURCE_FILE).toBe("source.png");
    expect(
      looksUnwiredAsset(
        `<html><style>#rig{transform-style:preserve-3d}</style><div id="hud">css-3d 3D mesh</div></html>`,
      ),
    ).toBe(true);
    expect(
      looksWiredAsset(
        `<canvas></canvas><script>import * as THREE from "./vendor/three.module.js"</script>`,
      ),
    ).toBe(true);
    const emptyThree = `<canvas></canvas><script>import * as THREE from "./vendor/three.module.js"</script>`;
    expect(looksPlaceholderAsset(emptyThree)).toBe(true);
    expect(looksPlaceholderAsset(withAssetChromeHook(emptyThree))).toBe(true);
    expect(looksUnwiredAsset("<html><body>sprite sheet</body></html>")).toBe(false);
    const cube =
      `<canvas></canvas><script>import * as THREE from "./vendor/three.module.js";` +
      `new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({color:0x888888}));</script>`;
    expect(looksPlaceholderAsset(cube)).toBe(true);
    expect(looksSculptedAsset(cube)).toBe(false);
    expect(looksPlaceholderAsset(withAssetChromeHook(cube))).toBe(true);
    expect(looksSculptedAsset(withAssetChromeHook(cube))).toBe(false);
    expect(
      looksPlaceholderAsset(`${cube}<script>reconstructFromPhoto("./source.png");</script>`),
    ).toBe(false);
    expect(
      looksPlaceholderAsset(
        `${cube}<script>new THREE.TextureLoader().load("./source.png");</script>`,
      ),
    ).toBe(true);
    expect(
      looksPlaceholderAsset(
        `<canvas></canvas><script>new THREE.PlaneGeometry(1,1); new THREE.TextureLoader().load("./source.png");</script>`,
      ),
    ).toBe(true);
    expect(looksSculptedAsset(`${cube}<script>new THREE.BufferGeometry();</script>`)).toBe(false);
    expect(looksPlaceholderAsset(`${cube}<script>new THREE.BufferGeometry();</script>`)).toBe(true);
    const emptyBuffer =
      `<canvas></canvas><script>import * as THREE from "./vendor/three.module.js";` +
      `new THREE.BufferGeometry();</script>`;
    expect(looksSculptedAsset(emptyBuffer)).toBe(false);
    expect(looksPlaceholderAsset(emptyBuffer)).toBe(true);
    expect(
      looksSculptedAsset(`${emptyBuffer}<script>geo.setAttribute("position", verts);</script>`),
    ).toBe(true);
    expect(
      looksPlaceholderAsset(`${emptyBuffer}<script>geo.setAttribute("position", verts);</script>`),
    ).toBe(false);
    expect(
      looksPlaceholderAsset(
        `<canvas></canvas><script>new THREE.TorusKnotGeometry(1, 0.3, 128, 16)</script>`,
      ),
    ).toBe(false);
    expect(looksPlaceholderAsset("<html><body><canvas></canvas>sprite sheet</body></html>")).toBe(
      false,
    );
    expect(MAX_ASSET_SCULPT_NUDGES).toBe(2);
    expect(
      looksLikeHudOnlyAssetPlaytest({
        name: "locus-playwright",
        arguments: { clicks: ["#btnWalk"], expect_text: "css-3d" },
      }),
    ).toBe(true);
    expect(
      looksLikeHudOnlyAssetPlaytest({
        name: "playwright",
        arguments: { clicks: ["#btnPickup"], expect_text: "carry" },
      }),
    ).toBe(true);
    expect(
      looksLikeHudOnlyAssetPlaytest({
        name: "playwright",
        arguments: { click: "text=attack-heavy" },
      }),
    ).toBe(true);
    expect(
      looksLikeHudOnlyAssetPlaytest({
        name: "playwright",
        arguments: { args: { click: "#btnWire", screenshot: true } },
      }),
    ).toBe(false);
    expect(
      looksLikeHudOnlyAssetPlaytest({
        name: "playwright",
        arguments: { click: "#stage", expect_text: "verts" },
      }),
    ).toBe(false);
    expect(parseAssetStudioStats({ mode: "3d", verts: 12, tris: 8 })).toEqual({
      mode: "3d",
      verts: 12,
      tris: 8,
      faces: 8,
    });
    expect(
      parseAssetStudioStats({ mode: "3d", topology: "quad", faces: 40, printable: true }),
    ).toMatchObject({
      topology: "quad",
      faces: 40,
      tris: 40,
      printable: true,
    });
    expect(formatAssetStudioStats({ mode: "3d", verts: 12 })).toBe("stats mode=3d verts=12");
    expect(assetStudioStatsFailReason({ mode: "css-3d", verts: 4 })).toMatch(/not 3d/);
    expect(assetStudioStatsFailReason({ mode: "3d", verts: 0 })).toMatch(/verts is 0/);
    expect(assetStudioStatsFailReason({ mode: "3d" })).toMatch(/verts missing/);
    expect(assetStudioStatsFailReason({ mode: "2d", verts: 0 })).toBeUndefined();
    expect(parseAssetStudioStats({ holes: 1, nonManifold: 2, openEdges: 3 })).toMatchObject({
      holes: 1,
      nonManifold: 2,
      openEdges: 3,
    });
  });

  it("posts export progress from the chrome hook", () => {
    const calls: string[] = [];
    const studio = runAssetChromeHook("<html><body><div id='rig'></div></body></html>", {
      exportStl() {
        calls.push("stl");
      },
    });
    studio.post({ type: "locus-asset-export", format: "stl" });
    expect(calls).toEqual(["stl"]);
    expect(studio.posted.map((row) => row.phase)).toEqual(["start", "prepare", "build", "done"]);
    expect(studio.posted.at(-1)).toMatchObject({
      type: "locus-asset-export-progress",
      format: "stl",
      percent: 100,
    });
  });

  it("posts the exported file from a returned payload", () => {
    const studio = runAssetChromeHook("<html><body><div id='rig'></div></body></html>", {
      exportStl() {
        return { filename: "hero.stl", mime: "model/stl", base64: "c29saWQ=" };
      },
    });
    studio.post({ type: "locus-asset-export", format: "stl", filename: "hero-mesh.stl" });
    expect(studio.posted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "locus-asset-export-file",
          format: "stl",
          filename: "hero.stl",
          mime: "model/stl",
          base64: "c29saWQ=",
        }),
        expect.objectContaining({
          type: "locus-asset-export-progress",
          phase: "done",
          percent: 100,
        }),
      ]),
    );
    const fileAt = studio.posted.findIndex((row) => row.type === "locus-asset-export-file");
    const doneAt = studio.posted.findIndex((row) => row.phase === "done");
    expect(fileAt).toBeGreaterThanOrEqual(0);
    expect(doneAt).toBeGreaterThan(fileAt);
  });

  it("encodes a returned STL string as the export file", () => {
    const studio = runAssetChromeHook("<html><body><div id='rig'></div></body></html>", {
      exportStl() {
        return "solid mesh\nendsolid mesh\n";
      },
    });
    studio.post({ type: "locus-asset-export", format: "stl", filename: "mesh.stl" });
    expect(studio.posted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "locus-asset-export-file",
          format: "stl",
          filename: "mesh.stl",
          base64: Buffer.from("solid mesh\nendsolid mesh\n", "utf8").toString("base64"),
        }),
      ]),
    );
  });

  it("posts export bytes when the studio returns a data URL", () => {
    const studio = runAssetChromeHook("<html><body><canvas></canvas></body></html>", {
      exportPng() {
        return "data:image/png;base64,AAAA";
      },
    });
    studio.post({ type: "locus-asset-export", format: "png" });
    expect(studio.posted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "locus-asset-export-bytes",
          format: "png",
          contentBase64: "AAAA",
        }),
      ]),
    );
    expect(
      parseAssetExportBytes({
        type: "locus-asset-export-bytes",
        format: "png",
        contentBase64: "AAAA",
      }),
    ).toMatchObject({ format: "png", contentBase64: "AAAA" });
  });

  it("reports a missing STL exporter instead of silently exporting GLB", () => {
    const calls: string[] = [];
    const studio = runAssetChromeHook("<html><body><div id='rig'></div></body></html>", {
      exportGlb() {
        calls.push("glb");
      },
    });
    studio.post({ type: "locus-asset-export", format: "stl" });
    expect(calls).toEqual([]);
    expect(studio.posted).toEqual([
      expect.objectContaining({
        type: "locus-asset-export-progress",
        format: "stl",
        phase: "error",
        error: "This studio has no STL exporter yet.",
      }),
    ]);
  });

  it("waits for a thenable exporter before posting done", () => {
    let finish: (() => void) | undefined;
    const studio = runAssetChromeHook("<html><body><div id='rig'></div></body></html>", {
      exportStl() {
        return {
          then(ok: () => void) {
            finish = ok;
          },
        };
      },
    });
    studio.post({ type: "locus-asset-export", format: "stl" });
    expect(studio.posted.map((row) => row.phase)).toEqual(["start", "prepare", "build"]);
    finish?.();
    expect(studio.posted.at(-1)).toMatchObject({ phase: "done", percent: 100 });
  });
});

function runAssetChromeHook(
  html: string,
  api?: {
    zoom?: (z: number) => void;
    camera?: (view: string) => void;
    exportStl?: () => unknown;
    exportGlb?: () => unknown;
    exportPng?: () => unknown;
    exportTextures?: () => unknown;
  },
) {
  const script = withAssetChromeHook(html).match(
    /<script data-locus-asset-chrome>([\s\S]*?)<\/script>/,
  )?.[1];
  if (!script) throw new Error("missing chrome hook");
  function box() {
    const props: Record<string, string> = {};
    return {
      zoom: "",
      scale: "",
      transform: "",
      setProperty(name: string, value: string) {
        props[name] = String(value);
        if (name === "zoom") this.zoom = String(value);
      },
      getProperty(name: string) {
        return props[name];
      },
    };
  }
  const hud = { id: "hud", tagName: "DIV", style: box() };
  const rig = { id: "rig", tagName: "DIV", style: box() };
  const hint = { id: "hint", tagName: "DIV", style: box() };
  const canvas = { id: "stage", tagName: "CANVAS", style: box() };
  const documentElement = {
    style: box(),
    classList: { toggle() {} },
    setAttribute() {},
  };
  const hasRig = /id=['"]rig['"]/.test(html);
  const hasCanvas = /<canvas/i.test(html);
  const body = {
    style: box(),
    children: [hasCanvas ? canvas : null, hud, hasRig ? rig : null, hint].filter(Boolean),
  };
  const listeners: Record<string, Array<(ev: { data: unknown }) => void>> = {};
  const posted: Array<Record<string, unknown>> = [];
  const windowObj = {
    __locusAsset: api,
    addEventListener(type: string, fn: (ev: { data: unknown }) => void) {
      (listeners[type] ??= []).push(fn);
    },
    dispatchEvent() {
      return true;
    },
  };
  runInNewContext(script, {
    window: windowObj,
    Event: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
    btoa,
    atob,
    Uint8Array,
    unescape,
    encodeURIComponent,
    document: {
      documentElement,
      body,
      querySelector(sel: string) {
        if (hasRig && (sel.includes("#rig") || sel.includes("[data-locus-asset-model]"))) {
          return rig;
        }
        if (hasCanvas && /canvas|#stage|#view|#viewport|data-locus-asset-stage/.test(sel)) {
          return canvas;
        }
        return null;
      },
      querySelectorAll(sel: string) {
        if (hasCanvas && /canvas|#stage|#view|#viewport|data-locus-asset-stage/.test(sel)) {
          return [canvas];
        }
        return [];
      },
    },
    parent: {
      postMessage(data: unknown) {
        posted.push(data as Record<string, unknown>);
      },
    },
  });
  return {
    hud,
    rig,
    hint,
    canvas,
    body,
    documentElement,
    posted,
    post(data: unknown) {
      for (const fn of listeners.message ?? []) fn({ data });
    },
  };
}
