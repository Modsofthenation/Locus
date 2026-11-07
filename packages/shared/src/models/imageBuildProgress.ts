import { LOCUS_AGENT_IMAGE } from "./vm.js";

export interface ImageBuildProgress {
  percent: number;
  phase: string;
  done?: boolean;
  step?: number;
  total?: number;
  cached?: boolean;
  detail?: string;
}

export const IMAGE_BUILD_BLURB = "git, Node, Chromium/Xvfb, ffmpeg, code-server";
export const IMAGE_BUILD_WAIT_STATUS = "Building the agent image…";
export const IMAGE_BUILD_WAIT_HINT =
  "The agent is waiting for this image build before it starts. First start can take several minutes.";

const STEP_RE = /^#\d+\s+\[(\d+)\/(\d+)\]\s+(.+)$/;
const INTERNAL_RE = /^#\d+\s+\[internal\]\s+(.+)$/;
const CLASSIC_RE = /^Step\s+(\d+)\/(\d+)\s*:\s*(.+)$/i;
const EXPORT_RE = /^#\d+\s+exporting to image/i;
const NAMING_RE = /naming to\s+\S+/i;
const CACHED_RE = /^#\d+\s+CACHED$/;
const DOWNLOAD_RE = /downloading\s+([\d.]+)\s*([KMGT]i?B)\/([\d.]+)\s*([KMGT]i?B)/i;

export function imageBuildStartNote(image = LOCUS_AGENT_IMAGE): string {
  return `Building ${image} (${IMAGE_BUILD_BLURB})…`;
}

export function imageBuildDoneNote(image = LOCUS_AGENT_IMAGE): string {
  return `Built ${image}. Starting the container.`;
}

export function isImageBuildStartNote(content: string): boolean {
  return /^Building \S+ \(git, Node/.test(content);
}

export function latestImageBuildStartMessageId(
  messages: Array<{ id: string; role: string; content: string }>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "system" && isImageBuildStartNote(message.content)) return message.id;
  }
  return undefined;
}

export function imageBuildStartProgress(): ImageBuildProgress {
  return { percent: 0, phase: "Starting" };
}

export function imageBuildDoneProgress(): ImageBuildProgress {
  return { percent: 100, phase: "Done", done: true };
}

export function isImageBuildWaiting(progress: ImageBuildProgress | undefined): boolean {
  return Boolean(progress && !progress.done);
}

export function sameImageBuildProgress(
  prev: ImageBuildProgress,
  next: ImageBuildProgress,
): boolean {
  return (
    prev.percent === next.percent &&
    prev.phase === next.phase &&
    Boolean(prev.done) === Boolean(next.done) &&
    prev.step === next.step &&
    prev.total === next.total &&
    Boolean(prev.cached) === Boolean(next.cached) &&
    (prev.detail ?? "") === (next.detail ?? "")
  );
}

export function parseDockerBuildProgress(chunk: string): ImageBuildProgress | undefined {
  if (!chunk) return undefined;
  let last: ImageBuildProgress | undefined;
  let step: number | undefined;
  let total: number | undefined;
  for (const raw of chunk.replace(/\r/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parsed = parseDockerBuildProgressLine(line, step, total);
    if (!parsed) continue;
    step = parsed.step ?? step;
    total = parsed.total ?? total;
    last = {
      ...parsed,
      percent: last ? Math.max(last.percent, parsed.percent) : parsed.percent,
    };
  }
  return last;
}

function parseDockerBuildProgressLine(
  line: string,
  prevStep?: number,
  prevTotal?: number,
): ImageBuildProgress | undefined {
  if (CACHED_RE.test(line) && prevStep != null && prevTotal != null) {
    return {
      percent: stepPercent(prevStep, prevTotal),
      phase: "Cached layer",
      step: prevStep,
      total: prevTotal,
      cached: true,
    };
  }
  const classic = line.match(CLASSIC_RE);
  if (classic) {
    const step = Number(classic[1]);
    const total = Number(classic[2]);
    const instruction = shortInstruction(classic[3] ?? "");
    return {
      percent: stepPercent(step, total),
      phase: instruction,
      step,
      total,
    };
  }
  const stepMatch = line.match(STEP_RE);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    const total = Number(stepMatch[2]);
    return {
      percent: stepPercent(step, total),
      phase: shortInstruction(stepMatch[3] ?? ""),
      step,
      total,
    };
  }
  const internal = line.match(INTERNAL_RE);
  if (internal) {
    return parseInternal(internal[1] ?? "");
  }
  if (EXPORT_RE.test(line)) {
    return { percent: 94, phase: "Exporting image" };
  }
  if (NAMING_RE.test(line)) {
    return { percent: 98, phase: "Tagging image" };
  }
  const download = line.match(DOWNLOAD_RE);
  if (download && prevStep != null && prevTotal != null) {
    const received = Number(download[1]);
    const whole = Number(download[3]);
    const frac = whole > 0 ? Math.min(1, received / whole) : 0;
    const start = stepPercent(Math.max(1, prevStep - 1), prevTotal);
    const span = Math.max(1, stepPercent(prevStep, prevTotal) - start);
    return {
      percent: Math.min(99, Math.round(start + frac * span)),
      phase: "Pulling base image",
      step: prevStep,
      total: prevTotal,
      detail: `${download[1]}${download[2]}/${download[3]}${download[4]}`,
    };
  }
  return undefined;
}

function parseInternal(raw: string): ImageBuildProgress {
  const text = raw.trim();
  if (/load metadata/i.test(text)) {
    const image = text.replace(/^load metadata for\s+/i, "").replace(/^docker\.io\/library\//, "");
    return { percent: 6, phase: "Pulling image metadata", detail: image };
  }
  if (/load build definition/i.test(text)) {
    return { percent: 2, phase: "Loading Dockerfile" };
  }
  if (/load \.dockerignore/i.test(text) || /load build context/i.test(text)) {
    return { percent: 8, phase: "Loading build context" };
  }
  return { percent: 4, phase: shortInstruction(text) };
}

function stepPercent(step: number, total: number): number {
  if (!Number.isFinite(step) || !Number.isFinite(total) || total <= 0) return 10;
  const clamped = Math.min(total, Math.max(0, step));
  return Math.min(92, Math.max(10, Math.round((clamped / total) * 90)));
}

function shortInstruction(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return "Building";
  const match = trimmed.match(
    /^(FROM|RUN|COPY|ADD|ENV|WORKDIR|USER|CMD|ENTRYPOINT|ARG|LABEL)\s+(.+)$/i,
  );
  if (!match) return truncate(trimmed, 72);
  const kind = match[1]!.toUpperCase();
  const rest = match[2]!;
  if (kind === "FROM") {
    const image = rest
      .split("@")[0]!
      .split(" ")[0]!
      .replace(/^docker\.io\/library\//, "");
    return `FROM ${image}`;
  }
  if (kind === "RUN") {
    const cmd = rest
      .replace(/^[(\s]+/, "")
      .split("&&")[0]!
      .trim();
    return `RUN ${truncate(cmd, 48)}`;
  }
  if (kind === "COPY" || kind === "ADD") {
    const src = rest.split(" ")[0] ?? rest;
    return `${kind} ${truncate(src, 40)}`;
  }
  return truncate(`${kind} ${rest}`, 64);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function formatImageBuildPhase(progress: ImageBuildProgress): string {
  if (progress.done) return "Done";
  const parts: string[] = [progress.phase];
  if (progress.step != null && progress.total != null && progress.total > 0) {
    parts.push(`${progress.step}/${progress.total}`);
  }
  if (progress.cached) parts.push("cached");
  if (progress.detail) parts.push(progress.detail);
  return parts.join(" · ");
}
