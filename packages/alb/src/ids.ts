/** Stable kebab-case id for skill packs, Cursor folders, and other-repo refs. */
export function toSkillSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'skill';
}

/** Assign unique slugs from a list of names, suffixing `-2`, `-3`, … on collision. */
export function uniqueSlugs(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base = toSkillSlug(name);
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      slug = `${base}-${n++}`;
    }
    used.add(slug);
    return slug;
  });
}

/**
 * Canvas/nanoid port ids mix case (`Ww7GGV`, `E5DV-v`).
 * Semantic handles stay lowercase words (`input`, `sufficient`, `pass`).
 */
export function isOpaqueId(id: string): boolean {
  return /[A-Z]/.test(id);
}

export function portablePortKey(port: { id: string; name: string }): string {
  if (!isOpaqueId(port.id)) return port.id;
  return toSkillSlug(port.name) || port.id;
}
