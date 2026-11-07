import { clipNamedEnvName } from "@locus/shared";

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
export function promptGoldenName(fallback: string): string | null {
  const next = window.prompt("Name this golden image", fallback);
  if (next == null) return null;
  return next.trim() || fallback;
}

/** Prompt for a named environment. Cancel returns null; blank keeps the fallback. */
export function promptEnvironmentName(fallback: string): string | null {
  const next = window.prompt("Name this environment", fallback);
  if (next == null) return null;
  return next.trim() || fallback;
}
