export function printJson(write: (line: string) => void, value: unknown): void {
  write(JSON.stringify(value, null, 2));
}

export function pad(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value + " ".repeat(width - value.length);
}

export function shortId(id: string, n = 8): string {
  return id.length <= n ? id : id.slice(0, n);
}

export function truncate(value: string, n = 48): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= n) return text;
  return `${text.slice(0, Math.max(0, n - 1))}…`;
}

export interface Column<T> {
  key: string;
  header: string;
  width?: number;
  value: (row: T) => string;
}

export function formatTable<T>(rows: T[], columns: Column<T>[]): string {
  if (!rows.length) return "(none)";
  const widths = columns.map((col) => {
    const min = col.width ?? col.header.length;
    return Math.max(min, col.header.length, ...rows.map((row) => col.value(row).length));
  });
  const header = columns.map((col, i) => pad(col.header, widths[i]!)).join("  ");
  const rule = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows.map((row) =>
    columns.map((col, i) => pad(col.value(row), widths[i]!)).join("  "),
  );
  return [header, rule, ...body].join("\n");
}

export function formatKv(rows: Array<[string, string | undefined | number | boolean]>): string {
  const present = rows.filter(([, v]) => v !== undefined && v !== "");
  const width = Math.max(0, ...present.map(([k]) => k.length));
  return present.map(([k, v]) => `${pad(k, width)}  ${String(v)}`).join("\n");
}

export function yn(value: boolean | undefined): string {
  return value ? "yes" : "no";
}
