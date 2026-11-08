import { clipNamedEnvName } from "@locus/shared";
import { askPrompt } from "@/lib/dialog";

/** Default label when capturing a guest or Docker workspace image. */
export function defaultGoldenName(title?: string, kind: "golden" | "workspace" = "golden"): string {
  const trimmed = title?.trim();
  if (trimmed) return `${trimmed} image`;
  return kind === "workspace" ? "workspace image" : "golden image";
}

/** Default label when saving a setup session as a named environment. */
export function defaultEnvironmentName(title?: string): string {
  const trimmed = title?.trim();
  return clipNamedEnvName(trimmed ? `${trimmed} env` : "product env");
}

/** Prompt for a golden image name. Cancel returns null; blank keeps the fallback. */
export async function promptGoldenName(fallback: string): Promise<string | null> {
  const next = await askPrompt({ title: "Name this golden image", value: fallback });
  if (next == null) return null;
  return next.trim() || fallback;
}

/** Prompt for a named environment. Cancel returns null; blank keeps the fallback. */
export async function promptEnvironmentName(fallback: string): Promise<string | null> {
  const next = await askPrompt({ title: "Name this environment", value: fallback });
  if (next == null) return null;
  return next.trim() || fallback;
}
