import type { LocusConfig } from "@locus/shared";

export type ConfigListKey = {
  [K in keyof LocusConfig]-?: NonNullable<LocusConfig[K]> extends readonly unknown[] ? K : never;
}[keyof LocusConfig];

export type ConfigListRow<K extends ConfigListKey> = NonNullable<LocusConfig[K]>[number];

function rowsOf<K extends ConfigListKey>(draft: LocusConfig, key: K): ConfigListRow<K>[] {
  return [...((draft[key] as ConfigListRow<K>[] | undefined) ?? [])];
}

/** Patch one Config save draft list row. Missing index is a no-op. */
export function patchConfigList<K extends ConfigListKey>(
  draft: LocusConfig,
  key: K,
  index: number,
  patch: Partial<ConfigListRow<K>> | ((row: ConfigListRow<K>) => ConfigListRow<K>),
): LocusConfig {
  const rows = rowsOf(draft, key);
  const row = rows[index];
  if (!row) return draft;
  rows[index] =
    typeof patch === "function"
      ? (patch as (row: ConfigListRow<K>) => ConfigListRow<K>)(row)
      : { ...row, ...(patch as Partial<ConfigListRow<K>>) };
  return { ...draft, [key]: rows };
}

export function removeConfigList<K extends ConfigListKey>(
  draft: LocusConfig,
  key: K,
  index: number,
): LocusConfig {
  const rows = rowsOf(draft, key);
  if (index < 0 || index >= rows.length) return draft;
  rows.splice(index, 1);
  return { ...draft, [key]: rows };
}

export function appendConfigList<K extends ConfigListKey>(
  draft: LocusConfig,
  key: K,
  row: ConfigListRow<K>,
): LocusConfig {
  return { ...draft, [key]: [...rowsOf(draft, key), row] };
}

export function insertConfigList<K extends ConfigListKey>(
  draft: LocusConfig,
  key: K,
  index: number,
  row: ConfigListRow<K>,
): LocusConfig {
  const rows = rowsOf(draft, key);
  const at = Math.max(0, Math.min(index, rows.length));
  rows.splice(at, 0, row);
  return { ...draft, [key]: rows };
}
