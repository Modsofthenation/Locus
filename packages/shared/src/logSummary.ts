const KNOWN: { test: RegExp; summary: string }[] = [
  {
    test: /no option group ['"]fsdev['"]|fsdev support is disabled/i,
    summary: "This QEMU build has fsdev/9p disabled, so the guest could not start.",
  },
  {
    test: /OVMF firmware not found/i,
    summary: "QEMU cannot start: OVMF firmware is missing.",
  },
  {
    test: /swtpm not found/i,
    summary: "QEMU cannot start: swtpm is missing (needed for TPM).",
  },
  {
    test: /ISO, cloud image, or golden image path is not set|ISO or disk image path is not set/i,
    summary: "No ISO or cloud image is set for this guest.",
  },
  {
    test: /Image not found:/i,
    summary: "The guest image path does not exist.",
  },
  {
    test: /Golden image not found:/i,
    summary: "The golden image path does not exist.",
  },
  {
    test: /Guest SSH did not become ready/i,
    summary: "Guest SSH did not become ready.",
  },
  {
    test: /Guest did not become ready over SSH or WinRM/i,
    summary: "The Windows guest did not become ready over SSH or WinRM.",
  },
  {
    test: /QEMU exited with code/i,
    summary: "QEMU exited before the guest was ready.",
  },
];

const PLAIN_STATUS = /^\[\d{4}-\d{2}-\d{2}T[^\]]+\] [a-z]+$/i;

export interface LogBlob {
  summary: string;
  detail: string | null;
}

export function summarizeLogBlob(text: string): LogBlob {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return { summary: "", detail: null };
  const summary = knownSummary(trimmed) ?? fallbackSummary(trimmed);
  if (!shouldExpand(trimmed, summary)) return { summary: oneLine(trimmed), detail: null };
  return { summary, detail: trimmed };
}

export function partitionBootLog(text: string): LogBlob[] {
  const parts: LogBlob[] = [];
  let blob: string[] = [];
  const flush = () => {
    if (!blob.length) return;
    parts.push(summarizeLogBlob(blob.join("\n")));
    blob = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (PLAIN_STATUS.test(line.trim())) {
      flush();
      parts.push({ summary: line.trim(), detail: null });
    } else {
      blob.push(line);
    }
  }
  flush();
  return parts;
}

function knownSummary(text: string): string | undefined {
  return KNOWN.find((row) => row.test.test(text))?.summary;
}

function fallbackSummary(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => stripStamp(line).trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^(creating|booting|installing|ready|running|paused|stopping|stopped)$/i.test(line),
    );
  const qemu = [...lines].reverse().find((line) => /qemu-system|error:/i.test(line));
  return truncate(oneLine(qemu ?? lines[lines.length - 1] ?? text));
}

function shouldExpand(text: string, summary: string): boolean {
  if (text === summary) return false;
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  return lines.length > 2 || text.length > 180 || (text.includes("\n") && text.length > 80);
}

function stripStamp(line: string): string {
  return line.replace(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s*(?:[a-z]+:\s*)?/i, "");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, max = 140): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
