import semver from 'semver';

/** Return true when `range` is a valid npm-style semver range (including exact pins). */
export function isValidVersionRange(range: string): boolean {
  if (!range.trim()) return false;
  return semver.validRange(range) != null;
}

/** Normalize a pin or caret/tilde range for storage. */
export function normalizeVersionRange(range: string): string | null {
  const trimmed = range.trim();
  if (!trimmed) return null;
  const valid = semver.validRange(trimmed);
  return valid;
}

/**
 * Resolve the highest satisfying version for a range.
 * Returns null when the range is invalid or no candidate matches.
 */
export function resolveVersion(
  availableVersions: string[],
  range: string,
): string | null {
  const validRange = semver.validRange(range.trim());
  if (!validRange) return null;
  const cleaned = availableVersions
    .map((v) => semver.clean(v) ?? (semver.valid(v) ? v : null))
    .filter((v): v is string => Boolean(v));
  return semver.maxSatisfying(cleaned, validRange);
}

/** Convert an exact version into a caret range (`^1.2.3`). */
export function toCaretRange(version: string): string {
  const clean = semver.clean(version) ?? version;
  if (!semver.valid(clean)) return version;
  return `^${clean}`;
}

/** Pin a range to an exact version string. */
export function pinVersion(version: string): string {
  const clean = semver.clean(version);
  if (!clean) return version;
  return clean;
}

export interface SkillVersionRef {
  skillId: string;
  /** Semver range such as `^1.2.0`, `~1.0.0`, or exact `1.2.3`. */
  versionRange: string;
  /** Optional resolved/pinned version that currently satisfies the range. */
  pinnedVersion?: string;
}

export function resolveSkillRef(
  ref: SkillVersionRef,
  availableVersions: string[],
): { ok: true; version: string } | { ok: false; reason: string } {
  if (!isValidVersionRange(ref.versionRange)) {
    return { ok: false, reason: `Invalid version range "${ref.versionRange}"` };
  }
  if (ref.pinnedVersion) {
    const pin = semver.clean(ref.pinnedVersion) ?? ref.pinnedVersion;
    if (semver.satisfies(pin, ref.versionRange)) {
      return { ok: true, version: pin };
    }
    return {
      ok: false,
      reason: `Pinned ${ref.pinnedVersion} does not satisfy ${ref.versionRange}`,
    };
  }
  const resolved = resolveVersion(availableVersions, ref.versionRange);
  if (!resolved) {
    return {
      ok: false,
      reason: `No published version satisfies ${ref.versionRange}`,
    };
  }
  return { ok: true, version: resolved };
}
