import type { AgentSession } from "@locus/shared";
import {
  ASSET_BACK_SOURCE_FILE,
  ASSET_BRIEF_PATH,
  ASSET_MASK_FILE,
  ASSET_SIDE_SOURCE_FILE,
  ASSET_SOURCE_FILE,
  GAME_BRIEF_PATH,
  GAME_GDD_PATH,
  GAME_LAST_RUN_PATH,
  GAME_STUDIO_PATH,
  formatReleaseNotes,
  gamePwaFiles,
  gameReleaseChecklist,
  isAssetSession,
  isGameSession,
  itchBlurbFromGdd,
  resolveAssetKit,
  resolveGameKit,
  withGameFeelCss,
  withGamePwaShell,
} from "@locus/shared";
import { zipStore } from "../media/unzip.js";

export type StudioZipWorkspace = {
  listWorkspace: (
    sessionId: string,
    dir: string,
    depth: string,
  ) => Promise<{ entries: Array<{ type: string; path: string }> }>;
  readWorkspace: (sessionId: string, rel: string) => Promise<{ content?: string | null }>;
  readWorkspaceRaw: (sessionId: string, rel: string) => Promise<{ bytes?: Buffer | null }>;
};

const ZIP_MAX_BYTES = 64 * 1024 * 1024;

async function addListedExtras(
  files: Record<string, string | Buffer>,
  workspace: StudioZipWorkspace,
  sessionId: string,
  extras: string[],
  allowTextFallback: boolean,
): Promise<void> {
  const seen = new Set<string>();
  for (const rel of extras) {
    const path = rel.replace(/^\.\//, "");
    if (!path || seen.has(path) || path === "index.html" || files[path]) continue;
    seen.add(path);
    try {
      const raw = await workspace.readWorkspaceRaw(sessionId, path);
      if (raw.bytes?.length) {
        files[path] = raw.bytes;
        continue;
      }
    } catch {
      if (!allowTextFallback) continue;
    }
    if (!allowTextFallback) continue;
    try {
      const text = await workspace.readWorkspace(sessionId, path);
      if (text.content) files[path] = text.content;
    } catch {
      /* skip missing extra */
    }
  }
}

/** Collect Games/Assets export files. Packing stays a thin zip adapter. */
export async function collectStudioZipFiles(input: {
  sessionId: string;
  session: AgentSession;
  html: string | null;
  promoteBrief: () => string | Promise<string>;
  workspace: StudioZipWorkspace;
}): Promise<Record<string, string | Buffer>> {
  const { sessionId, session, workspace } = input;
  const files: Record<string, string | Buffer> = {};
  const asset = isAssetSession(session);
  files["index.html"] = asset
    ? input.html?.trim() || "<!doctype html><title>Asset</title><body></body>"
    : withGamePwaShell(
        withGameFeelCss(
          input.html?.trim() || "<!doctype html><title>Game</title><body></body>",
          session.designTune,
        ),
      );
  const briefName = asset ? ASSET_BRIEF_PATH : GAME_BRIEF_PATH;
  try {
    const brief = await workspace.readWorkspace(sessionId, briefName);
    files[briefName] = brief.content?.trim() || (await input.promoteBrief());
  } catch {
    files[briefName] = await input.promoteBrief();
  }
  const kit = asset
    ? resolveAssetKit(session.designSystemId)
    : resolveGameKit(session.designSystemId);
  if (kit) {
    for (const [rel, content] of Object.entries(kit.files)) {
      if (rel === "GAME.md" || rel === "ASSET.md") continue;
      files[rel] = content;
    }
  }
  try {
    const listed = await workspace.listWorkspace(sessionId, "vendor", "3");
    for (const row of listed.entries) {
      if (row.type === "dir" || !row.path.startsWith("vendor/")) continue;
      try {
        const text = await workspace.readWorkspace(sessionId, row.path);
        if (text.content) files[row.path] = text.content;
      } catch {
        try {
          const raw = await workspace.readWorkspaceRaw(sessionId, row.path);
          if (raw.bytes) files[row.path] = raw.bytes;
        } catch {
          /* skip missing vendor file */
        }
      }
    }
  } catch {
    /* vendor listing is optional */
  }
  if (asset) {
    const extras = [
      ASSET_SOURCE_FILE,
      ASSET_SIDE_SOURCE_FILE,
      ASSET_BACK_SOURCE_FILE,
      ASSET_MASK_FILE,
      "export.glb",
      "export.stl",
      "model.glb",
      "model.stl",
      "albedo.png",
    ];
    try {
      const listed = await workspace.listWorkspace(sessionId, ".", "1");
      for (const row of listed.entries) {
        if (row.type === "dir") continue;
        if (/\.(glb|stl|png)$/i.test(row.path)) extras.push(row.path);
      }
    } catch {
      /* root listing is optional */
    }
    await addListedExtras(files, workspace, sessionId, extras, false);
  } else {
    const extras = [GAME_LAST_RUN_PATH, GAME_GDD_PATH, GAME_STUDIO_PATH];
    let gddText = "";
    try {
      gddText = (await workspace.readWorkspace(sessionId, GAME_GDD_PATH)).content ?? "";
    } catch {
      /* GDD is optional until the first brief */
    }
    const blurb = itchBlurbFromGdd(gddText);
    const checks = gameReleaseChecklist({ html: input.html ?? "", gdd: gddText });
    files["RELEASE.md"] = formatReleaseNotes(checks, blurb);
    for (const [rel, content] of Object.entries(
      gamePwaFiles({ title: session.title, description: blurb }),
    )) {
      if (!files[rel]) files[rel] = content;
    }
    const dirs = [".", "assets", "sprites", "img"];
    for (const dir of dirs) {
      try {
        const listed = await workspace.listWorkspace(sessionId, dir, dir === "." ? "1" : "2");
        for (const row of listed.entries) {
          if (row.type === "dir") continue;
          if (/\.(png|svg|json|css|js|mp3|ogg|wav)$/i.test(row.path)) extras.push(row.path);
        }
      } catch {
        /* listing is optional */
      }
    }
    await addListedExtras(files, workspace, sessionId, extras, true);
  }
  return files;
}

export function packStudioZip(
  files: Record<string, string | Buffer>,
  title: string,
  kind: "asset" | "game",
): { filename: string; zipBase64: string } {
  const totalBytes = Object.values(files).reduce(
    (sum, value) => sum + (typeof value === "string" ? Buffer.byteLength(value) : value.length),
    0,
  );
  if (totalBytes > ZIP_MAX_BYTES) throw new Error("Export is too large");
  const zip = zipStore(files);
  const slug = (title || kind).replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || kind;
  return { filename: `${slug}.zip`, zipBase64: zip.toString("base64") };
}

export function studioZipKind(session: AgentSession): "asset" | "game" | undefined {
  if (isAssetSession(session)) return "asset";
  if (isGameSession(session)) return "game";
  return undefined;
}
