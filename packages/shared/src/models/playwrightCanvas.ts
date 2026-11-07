export type PlaywrightStepKind = "click" | "fill" | "expect" | "wait" | "key" | "seed";

export type PlaywrightStep =
  | { kind: "click"; locator: string }
  | { kind: "fill"; locator: string; text: string }
  | { kind: "expect"; text: string }
  | { kind: "wait"; locator: string; ms?: number }
  | { kind: "key"; key: string }
  | { kind: "seed"; value: number };

export type PlaywrightViewportName = "desktop" | "tablet" | "phone" | "landscape";

export const PLAYWRIGHT_VIEWPORTS: Record<
  PlaywrightViewportName,
  { width: number; height: number }
> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  phone: { width: 390, height: 844 },
  landscape: { width: 844, height: 390 },
};

export const PLAYWRIGHT_CHROME_MISSING = "Install Chrome, Edge, or Chromium, or set LOCUS_CHROME";
export const PLAYWRIGHT_EMPTY_CANVAS =
  "The canvas is empty — write /workspace/index.html before calling playwright.";
export const PLAYWRIGHT_MISSING_URL =
  "Pass url, or call preview first, so playwright has a page to open.";
export const PLAYWRIGHT_BAD_URL = "url must be an http or https page to open.";

export function isPlaywrightPageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function parsePlaywrightViewport(value: unknown): PlaywrightViewportName {
  if (value === "tablet" || value === "phone" || value === "landscape") return value;
  return "desktop";
}

function strArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

export function parsePlaywrightStepLine(line: string): PlaywrightStep | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  const click = trimmed.match(/^click\s+(.+)$/i);
  if (click?.[1]) return { kind: "click", locator: click[1].trim() };
  const fill = trimmed.match(/^fill\s+(\S+)\s+([\s\S]+)$/i);
  if (fill?.[1]) return { kind: "fill", locator: fill[1].trim(), text: (fill[2] ?? "").trim() };
  const expect = trimmed.match(/^expect\s+([\s\S]+)$/i);
  if (expect?.[1]) return { kind: "expect", text: expect[1].trim() };
  const waitMs = trimmed.match(/^wait\s+(\d+)\s*(ms|s)$/i);
  if (waitMs?.[1]) {
    const n = Number(waitMs[1]);
    const ms = waitMs[2]?.toLowerCase() === "s" ? n * 1000 : n;
    return { kind: "wait", locator: `${ms}ms`, ms };
  }
  const wait = trimmed.match(/^wait\s+(.+)$/i);
  if (wait?.[1]) return { kind: "wait", locator: wait[1].trim() };
  const seed = trimmed.match(/^seed\s+(-?\d+)$/i);
  if (seed?.[1]) return { kind: "seed", value: Number(seed[1]) };
  const key = trimmed.match(/^(?:press|key)\s+(.+)$/i);
  if (key?.[1]) return { kind: "key", key: key[1].trim() };
  return { kind: "click", locator: trimmed };
}

export function parsePlaywrightSteps(args: Record<string, unknown> = {}): PlaywrightStep[] {
  const steps: PlaywrightStep[] = [];
  if (Array.isArray(args.steps)) {
    for (const item of args.steps) {
      if (typeof item !== "string") continue;
      const parsed = parsePlaywrightStepLine(item);
      if (parsed) steps.push(parsed);
    }
  }
  const click = strArg(args, "click");
  if (click) steps.push({ kind: "click", locator: click });
  if (Array.isArray(args.clicks)) {
    for (const item of args.clicks) {
      if (typeof item === "string" && item.trim()) {
        steps.push({ kind: "click", locator: item.trim() });
      }
    }
  }
  const fillSelector = strArg(args, "fill_selector");
  if (fillSelector) {
    steps.push({
      kind: "fill",
      locator: fillSelector,
      text: typeof args.fill_text === "string" ? args.fill_text : "",
    });
  }
  const expectText = strArg(args, "expect_text");
  if (expectText) steps.push({ kind: "expect", text: expectText });
  const waitFor = strArg(args, "wait_for");
  if (waitFor) steps.push({ kind: "wait", locator: waitFor });
  const press = strArg(args, "key") || strArg(args, "press");
  if (press) steps.push({ kind: "key", key: press });
  return steps;
}

export function playwrightStepNeedsLive(step: PlaywrightStep): boolean {
  return (
    step.kind === "click" ||
    step.kind === "fill" ||
    step.kind === "wait" ||
    step.kind === "key" ||
    step.kind === "seed"
  );
}

/** PNG after a live run, unless the model passes screenshot=false. */
export function playwrightWantsScreenshot(args: Record<string, unknown> = {}): boolean {
  return args.screenshot !== false;
}

/** Launch Chrome for click/fill/wait, or when screenshot=true forces a live capture. */
export function playwrightWantsLive(
  args: Record<string, unknown> = {},
  steps: PlaywrightStep[] = parsePlaywrightSteps(args),
): boolean {
  return args.screenshot === true || steps.some(playwrightStepNeedsLive);
}

export function locatorText(locator: string): string | undefined {
  const trimmed = locator.trim();
  if (trimmed.toLowerCase().startsWith("text=")) return trimmed.slice(5);
  return undefined;
}

export function htmlHasLocator(html: string, locator: string): boolean {
  const loc = locator.trim();
  if (!loc) return false;
  const text = locatorText(loc);
  if (text != null) return html.includes(text);
  const id = loc.match(/^#([A-Za-z_][\w-]*)$/);
  if (id?.[1]) return new RegExp(`\\bid\\s*=\\s*["']${id[1]}["']`, "i").test(html);
  const cls = loc.match(/^\.([A-Za-z_][\w-]*)$/);
  if (cls?.[1]) return new RegExp(`\\bclass\\s*=\\s*["'][^"']*\\b${cls[1]}\\b`, "i").test(html);
  if (/^[A-Za-z][\w-]*$/.test(loc)) return new RegExp(`<${loc}\\b`, "i").test(html);
  return html.includes(loc);
}

export function htmlHasText(html: string, text: string): boolean {
  const needle = text.trim();
  if (!needle) return false;
  return html.includes(needle);
}

export function formatPlaywrightStep(step: PlaywrightStep): string {
  if (step.kind === "fill") return `fill ${step.locator}`;
  if (step.kind === "expect") return `expect ${step.text}`;
  if (step.kind === "wait") return `wait ${step.locator}`;
  if (step.kind === "key") return `press ${step.key}`;
  if (step.kind === "seed") return `seed ${step.value}`;
  return `click ${step.locator}`;
}

export type PlaywrightStepResult = {
  step: PlaywrightStep;
  ok: boolean;
  detail?: string;
};

export function formatPlaywrightReport(input: {
  viewport: PlaywrightViewportName;
  mode: "live" | "static";
  results: PlaywrightStepResult[];
  title?: string;
  console?: string[];
  screenshot?: boolean;
  note?: string;
  stats?: string;
}): string {
  const size = PLAYWRIGHT_VIEWPORTS[input.viewport];
  const lines = [`Playwright ${input.viewport} ${size.width}×${size.height} (${input.mode})`];
  if (input.title) lines.push(`title ${input.title}`);
  if (!input.results.length) lines.push("ok  (loaded canvas)");
  for (const row of input.results) {
    const mark = row.ok ? "ok" : "fail";
    const detail = row.detail ? ` — ${row.detail}` : "";
    lines.push(`${mark}  ${formatPlaywrightStep(row.step)}${detail}`);
  }
  if (input.stats) lines.push(input.stats);
  const logs = playwrightImportantConsole(input.console ?? []);
  if (logs.length) {
    lines.push("console:");
    for (const line of logs) lines.push(`  ${line}`);
  }
  if (input.screenshot) lines.push("screenshot captured");
  if (input.note) lines.push(input.note);
  return lines.join("\n");
}

export const PLAYWRIGHT_TAINTED_CANVAS =
  "Relative photos taint getImageData in a unique-origin iframe. Set img.crossOrigin='anonymous' before src and load ./source.png so canvas-files HTTP is same-origin. Catch SecurityError — do not iterate flood-fill or click Wireframe in a loop. Do not call preview.";

export const PLAYWRIGHT_REPEAT_NOTE =
  "Same live result as the last playwright call. Stop screenshot loops. If the operator canvas is a maroon tainted-canvas overlay, that is CORS (relative photo in a unique-origin iframe) — set img.crossOrigin='anonymous'; canvas-files HTTP is automatic for relative photos. Do not click Wireframe again.";

export function playwrightLooksTainted(text: string): boolean {
  return /tainted by cross-origin|the canvas has been tainted/i.test(text);
}

/** True when a playwright report failed stats, HUD-only checks, or a live step. */
export function playwrightReportFailed(text?: string): boolean {
  if (!text?.trim()) return false;
  if (/verts is 0|verts missing|stats missing|mode is (?!2d\b|3d\b)|not 3d/i.test(text)) {
    return true;
  }
  return /\bfail {2}/.test(text);
}

export function playwrightReportFingerprint(text: string): string {
  return text
    .replace(/screenshot captured/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function playwrightRepeatNote(
  previous: string | undefined,
  next: string,
): string | undefined {
  if (!previous?.trim() || !next.trim()) return undefined;
  if (playwrightReportFingerprint(previous) === playwrightReportFingerprint(next)) {
    return PLAYWRIGHT_REPEAT_NOTE;
  }
}

/** Completed playwright calls after the latest user message. Extra shots fill the context window. */
export function countPlaywrightCallsThisTurn(
  messages: Array<{
    role?: string;
    toolCalls?: Array<{ name?: string; result?: string }>;
  }>,
): { calls: number; lastReport?: string } {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      lastUser = i;
      break;
    }
  }
  const after = lastUser >= 0 ? messages.slice(lastUser + 1) : messages;
  let calls = 0;
  let lastReport: string | undefined;
  for (const message of after) {
    for (const call of message.toolCalls ?? []) {
      if (!call.name || !/playwright/i.test(call.name)) continue;
      if (call.result == null) continue;
      calls += 1;
      lastReport = call.result;
    }
  }
  return { calls, lastReport };
}

const PLAYWRIGHT_CONSOLE_KEEP =
  /404|THREE|WebGL|Failed to load|net::|TypeError|Uncaught|CORS|ERR_|tainted|SecurityError|cross-origin/i;

/** Prefer load/WebGL errors; otherwise the last few console lines. */
export function playwrightImportantConsole(logs: string[], limit = 8): string[] {
  const important = logs.filter((line) => PLAYWRIGHT_CONSOLE_KEEP.test(line));
  const picked = important.length ? important : logs;
  return picked.slice(-limit);
}

export function playwrightChipDetail(args: Record<string, unknown> = {}): string {
  const steps = parsePlaywrightSteps(args);
  if (steps.length > 1) return `${steps.length} steps`;
  if (steps[0]) return formatPlaywrightStep(steps[0]);
  const viewport = strArg(args, "viewport");
  return viewport || "";
}
