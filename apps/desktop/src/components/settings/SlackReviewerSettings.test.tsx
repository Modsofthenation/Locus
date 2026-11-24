import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  newSlackReviewer,
  parseSlackReviewer,
  type AgentSkill,
  type AiProvider,
  type GitForgeAccount,
  type IntegrationAccount,
  type SlackReviewer,
  type SlackReviewRun,
} from "@locus/shared";

const apiMock = vi.hoisted(() => ({
  slackStatus: vi.fn(),
  slackConversations: vi.fn(),
  slackUsers: vi.fn(),
  slackReviewerRuns: vi.fn(),
  slackReviewerReview: vi.fn(),
  slackReviewerTrace: vi.fn(),
  slackReviewerNotes: vi.fn(),
  slackReviewerProposeNotes: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));

import {
  previewReviewerModel,
  SlackReviewerSettings,
  toggleSkillRef,
} from "./SlackReviewerSettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const anthropic = {
  id: "anthropic",
  name: "Anthropic",
  kind: "anthropic",
  baseUrl: "https://api.anthropic.com",
  apiKey: "••••••••",
  models: ["claude-opus-5-5", "claude-sonnet-5-5"],
  defaultModel: "claude-opus-5-5",
  enabled: true,
  extraHeaders: {},
} as unknown as AiProvider;

const openai = {
  ...anthropic,
  id: "openai",
  name: "OpenAI",
  kind: "openai",
  models: ["gpt-a"],
  defaultModel: "gpt-a",
} as unknown as AiProvider;

const claudeCode = {
  ...anthropic,
  id: "claude-code",
  name: "Claude Code",
  kind: "claude-code",
  baseUrl: "claude-code://local",
  apiKey: "",
  models: [],
  defaultModel: "",
} as unknown as AiProvider;

const skills: AgentSkill[] = [
  {
    id: "k1",
    name: "security",
    title: "Security",
    hint: "Authz and secrets",
    body: "Check authz.",
  },
  { id: "k2", name: "perf", title: "Performance", hint: "", body: "Flag N+1 queries." },
];

const slackAccount = {
  id: "slack",
  kind: "slack",
  name: "Slack",
  enabled: true,
  defaultProviderId: "openai",
} as unknown as IntegrationAccount;

const run: SlackReviewRun = {
  reviewerId: "r1",
  pr: "acme/api#7",
  url: "https://github.com/acme/api/pull/7",
  outcome: "commented",
  model: "claude-opus-5-5",
  usage: { inputTokens: 1200, outputTokens: 80, cachedInputTokens: 900 },
  usd: 0.0064,
  comments: 2,
  at: "2026-11-21T10:00:00.000Z",
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  apiMock.slackStatus.mockResolvedValue({ connected: true, socket: "up", canPostAsBot: true });
  apiMock.slackConversations.mockResolvedValue([]);
  apiMock.slackUsers.mockResolvedValue([
    { id: "U0123ABCD", name: "alice", realName: "Alice Smith" },
    { id: "U0456EFGH", name: "bob" },
    { id: "U0789IJKL", name: "deploy-bot", isBot: true },
  ]);
  apiMock.slackReviewerRuns.mockResolvedValue({ runs: [run] });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function q<T extends Element = HTMLElement>(selector: string): T {
  const el = host.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

/** Holds the reviewer list like Settings' draft does, and exposes it for assertions. */
function mount(
  initial: SlackReviewer[],
  persist = vi.fn(async () => true),
  opts: { providers?: AiProvider[]; skills?: AgentSkill[]; forges?: GitForgeAccount[] } = {},
) {
  const seen: { rows: SlackReviewer[] } = { rows: initial };
  const onOpenIntegrations = vi.fn();
  const onOpenChat = vi.fn();
  function Harness() {
    const [rows, setRows] = useState(initial);
    const [expanded, setExpanded] = useState<string | null>(initial[0]?.id ?? null);
    seen.rows = rows;
    return (
      <SlackReviewerSettings
        reviewers={rows}
        providers={opts.providers ?? [anthropic, openai]}
        integrations={[slackAccount]}
        skills={opts.skills ?? []}
        expanded={expanded}
        onToggleExpand={(id) => setExpanded((open) => (open === id ? null : id))}
        onAdd={() => setRows((list) => [...list, newSlackReviewer(`n${list.length}`, list.length)])}
        onPatch={(i, patch) =>
          setRows((list) =>
            list.map((row, j) =>
              j !== i ? row : typeof patch === "function" ? patch(row) : { ...row, ...patch },
            ),
          )
        }
        onRemove={(i) => setRows((list) => list.filter((_, j) => j !== i))}
        onPersist={persist}
        onOpenIntegrations={onOpenIntegrations}
        onOpenChat={onOpenChat}
        forges={opts.forges}
      />
    );
  }
  act(() => root.render(<Harness />));
  return { seen, persist, onOpenIntegrations, onOpenChat };
}

const reviewer = (over: Record<string, unknown> = {}) =>
  parseSlackReviewer({ id: "r1", name: "API reviews", channelId: "C1", ...over })!;

describe("SlackReviewerSettings", () => {
  it("lists in-progress reviews, watched review chats and past ones, each opening its thread", async () => {
    apiMock.slackReviewerRuns.mockResolvedValue({
      runs: [
        { ...run, channelId: "C1", threadTs: "101.0" },
        { ...run, pr: "acme/api#6", dryRun: true },
      ],
      active: [
        {
          reviewerId: "r1",
          pr: "acme/api#9",
          url: "https://github.com/acme/api/pull/9",
          kind: "review",
          status: "running",
          since: "2026-11-21T10:05:00.000Z",
          channelId: "C1",
          threadTs: "103.0",
        },
      ],
      threads: [
        {
          reviewerId: "r1",
          pr: "acme/api#7",
          url: "https://github.com/acme/api/pull/7",
          channelId: "C1",
          threadTs: "101.0",
          at: "2026-11-21T10:00:00.000Z",
          answers: 2,
        },
      ],
    });
    const { onOpenChat } = mount([reviewer()]);
    await flush();
    const active = q('[data-testid="slack-reviewer-active"]');
    expect(active.textContent).toContain("Reviewing");
    expect(active.textContent).toContain("acme/api#9");
    const threads = q('[data-testid="slack-reviewer-threads"]');
    expect(threads.textContent).toContain("2 questions answered");
    // The dry run has no thread, so only the real run gets a button.
    expect(
      q('[data-testid="slack-reviewer-runs"]').querySelectorAll(
        '[data-testid="slack-reviewer-open-chat"]',
      ),
    ).toHaveLength(1);
    act(() =>
      active.querySelector<HTMLButtonElement>('[data-testid="slack-reviewer-open-chat"]')!.click(),
    );
    expect(onOpenChat).toHaveBeenLastCalledWith("C1", "103.0");
    act(() =>
      threads.querySelector<HTMLButtonElement>('[data-testid="slack-reviewer-open-chat"]')!.click(),
    );
    expect(onOpenChat).toHaveBeenLastCalledWith("C1", "101.0");
  });

  it("opens a run's trace with its reasoning, tool calls and their output", async () => {
    apiMock.slackReviewerRuns.mockResolvedValue({
      runs: [
        { ...run, traceId: "3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f" },
        { ...run, pr: "acme/api#6" },
      ],
    });
    apiMock.slackReviewerTrace.mockResolvedValue({
      id: "3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f",
      reviewerId: "r1",
      pr: "acme/api#7",
      kind: "review",
      model: "claude-opus-5-5",
      startedAt: "2026-11-21T10:00:00.000Z",
      finishedAt: "2026-11-21T10:01:00.000Z",
      steps: [
        { kind: "prompt", text: "Review acme/api#7", at: "2026-11-21T10:00:00.000Z" },
        { kind: "thinking", text: "Who calls a.b?", at: "2026-11-21T10:00:01.000Z" },
        {
          kind: "tool",
          id: "t1",
          tool: "read_file",
          args: '{"path":"src/b.ts"}',
          output: "9  use(a.b)",
          at: "2026-11-21T10:00:02.000Z",
        },
        {
          kind: "tool",
          id: "t2",
          tool: "run_shell",
          output: "not available",
          refused: true,
          at: "2026-11-21T10:00:03.000Z",
        },
        { kind: "text", text: '{"verdict":"comment"}', at: "2026-11-21T10:00:04.000Z" },
      ],
    });
    mount([reviewer()]);
    await flush();
    const runs = q('[data-testid="slack-reviewer-runs"]');
    // Only the run with a trace gets the toggle.
    const toggles = runs.querySelectorAll<HTMLButtonElement>(
      '[data-testid="slack-reviewer-trace-toggle"]',
    );
    expect(toggles).toHaveLength(1);
    act(() => toggles[0]!.click());
    await flush();
    expect(apiMock.slackReviewerTrace).toHaveBeenCalledWith("3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f");
    const trace = q('[data-testid="slack-reviewer-trace"]');
    expect(trace.textContent).toContain("2 tool calls");
    expect(trace.textContent).toContain("1 refused");
    expect(q('[data-testid="slack-reviewer-trace-thinking"]').textContent).toContain(
      "Who calls a.b?",
    );
    const tools = trace.querySelectorAll('[data-testid="slack-reviewer-trace-tool"]');
    expect(tools[0]!.textContent).toContain("read_file");
    expect(tools[0]!.textContent).toContain("src/b.ts");
    expect(tools[0]!.textContent).toContain("9  use(a.b)");
    expect(tools[1]!.textContent).toContain("refused");
    act(() => toggles[0]!.click());
    expect(host.querySelector('[data-testid="slack-reviewer-trace"]')).toBeNull();
  });

  it("shows the empty state, the Slack sign-in callout, and adds a reviewer", async () => {
    apiMock.slackStatus.mockResolvedValue({ connected: false, socket: "down" });
    apiMock.slackReviewerRuns.mockResolvedValue({ runs: [] });
    const { seen, onOpenIntegrations } = mount([]);
    await flush();
    expect(q('[data-testid="slack-reviewers-empty"]').textContent).toContain("No reviewers yet");
    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewers-signin"] button').click());
    expect(onOpenIntegrations).toHaveBeenCalled();
    expect(q('[data-testid="slack-reviewer-runs-empty"]')).toBeTruthy();

    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-add"]').click());
    expect(seen.rows).toHaveLength(1);
    expect(seen.rows[0]!.channelId).toBe("");
    expect(host.textContent).toContain("Needs a channel");
  });

  it("summarises the reviewer with the channel name and the model it will use", async () => {
    apiMock.slackConversations.mockResolvedValue([
      { id: "C1", name: "pr-reviews", kind: "channel" },
      { id: "D1", name: "bob", kind: "im" },
    ]);
    mount([reviewer()]);
    await flush();
    const card = q('[data-testid="slack-reviewer-r1"]');
    expect(card.textContent).toContain("#pr-reviews · gpt-a · Comment only");
    expect(card.textContent).toContain("Watching");
    expect(card.textContent).toContain("Uses OpenAI · gpt-a (Slack default)");
  });

  it("edits the channel, prompt, and behaviour fields", async () => {
    const { seen } = mount([reviewer({ channelId: "" })]);
    await flush();
    act(() => setValue(q('[data-testid="slack-reviewer-channel-r1"]'), " C9 "));
    expect(seen.rows[0]!.channelId).toBe("C9");

    act(() => setValue(q('[data-testid="slack-reviewer-prompt-r1"]'), "Check auth."));
    expect(seen.rows[0]!.prompt).toBe("Check auth.");

    const repos = q<HTMLTextAreaElement>('[data-testid="slack-reviewer-repos-r1"]');
    act(() => setValue(repos, "acme/api\n acme/web-* , "));
    act(() => repos.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(seen.rows[0]!.repos).toEqual(["acme/api", "acme/web-*"]);
  });

  it("pins and unpins a model", async () => {
    const { seen } = mount([reviewer()]);
    await flush();
    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-pin-model-r1"]').click());
    expect(seen.rows[0]).toMatchObject({ providerId: "openai", model: "gpt-a" });
    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-pin-model-r1"]').click());
    expect(seen.rows[0]!.providerId).toBeUndefined();
    expect(seen.rows[0]!.model).toBeUndefined();
  });

  it("clamps token budget numbers on blur", async () => {
    const { seen } = mount([reviewer()]);
    await flush();
    const input = q<HTMLInputElement>("#reviewer-maxDiffChars");
    act(() => setValue(input, "5"));
    act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(seen.rows[0]!.maxDiffChars).toBe(2_000);
    expect(input.value).toBe("2000");
  });

  it("turns off token limits, disabling the budget fields", async () => {
    const { seen } = mount([reviewer()]);
    await flush();
    expect(q<HTMLInputElement>("#reviewer-maxDiffChars").disabled).toBe(false);
    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-unlimited-r1"]').click());
    expect(seen.rows[0]!.unlimitedTokens).toBe(true);
    expect(q<HTMLInputElement>("#reviewer-maxDiffChars").disabled).toBe(true);
    expect(q<HTMLInputElement>("#reviewer-maxFileChars").disabled).toBe(true);
    expect(q<HTMLInputElement>("#reviewer-maxOutputTokens").disabled).toBe(true);
    expect(q<HTMLInputElement>("#reviewer-contextLines").disabled).toBe(false);
    expect(q('[data-testid="slack-reviewer-unlimited-note-r1"]').textContent).toContain("32,000");
    expect(q('[data-testid="slack-reviewer-r1"]').textContent).toContain("No token limits");
  });

  it("previews and resets status templates", async () => {
    const { seen } = mount([reviewer()]);
    await flush();
    const started = q<HTMLTextAreaElement>('[data-testid="slack-reviewer-status-started"]');
    act(() => setValue(started, "On it: {pr} with {model}"));
    expect(seen.rows[0]!.status.started).toBe("On it: {pr} with {model}");
    const field = started.closest(".slack-reviewer-template")!;
    expect(field.textContent).toContain("On it: acme/api#482 with gpt-a");
    expect(field.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/acme/api/pull/482",
    );
    act(() => (field.querySelector("label button") as HTMLButtonElement).click());
    expect(seen.rows[0]!.status.started).toContain("Looking at {pr} now");
  });

  it("previews the Slack thread this reviewer will post", async () => {
    mount([reviewer()]);
    await flush();
    const preview = q('[data-testid="slack-reviewer-preview-r1"]');
    expect(q('[data-testid="slack-reviewer-preview-request"]').textContent).toContain("alice");
    const started = q('[data-testid="slack-reviewer-preview-reply-started"]');
    expect(started.textContent).toContain("Locus");
    expect(started.textContent).toContain("App");
    expect(started.textContent).toContain("👀 Looking at acme/api#482 now. Model: gpt-a (OpenAI).");
    expect(started.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/acme/api/pull/482",
    );
    expect(started.querySelector("code")?.textContent).toBe("gpt-a");
    const done = q('[data-testid="slack-reviewer-preview-reply-commented"]');
    expect(done.textContent).toContain("📝 Left 3 comments on acme/api#482.");
    expect(done.querySelector("em")?.textContent).toContain("10.2k in (3.1k cached) / 640 out");
    expect(preview.textContent).toContain("2 replies");
    // Comment-only reviewers never approve, so the preview does not offer it.
    expect(
      host.querySelector('[data-testid="slack-reviewer-preview-outcome-approved"]'),
    ).toBeNull();
    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-preview-outcome-clean"]').click());
    expect(q('[data-testid="slack-reviewer-preview-reply-clean"]').textContent).toContain(
      "✅ Looks good, no issues found in acme/api#482.",
    );
  });

  it("previews skips without a started reply, and verdict outcomes in verdict mode", async () => {
    mount([reviewer({ forgeMode: "verdict" })]);
    await flush();
    act(() =>
      q<HTMLButtonElement>('[data-testid="slack-reviewer-preview-outcome-skipped"]').click(),
    );
    expect(host.querySelector('[data-testid="slack-reviewer-preview-reply-started"]')).toBeNull();
    expect(q('[data-testid="slack-reviewer-preview-reply-skipped"]').textContent).toContain(
      "Skipped acme/api#482: it is a draft",
    );
    expect(q('[data-testid="slack-reviewer-preview-r1"]').textContent).toContain("1 reply");
    act(() =>
      q<HTMLButtonElement>(
        '[data-testid="slack-reviewer-preview-outcome-changesRequested"]',
      ).click(),
    );
    expect(
      q('[data-testid="slack-reviewer-preview-reply-changesRequested"]').textContent,
    ).toContain("❌ Requested changes on acme/api#482: 2 comments.");
    expect(host.querySelector('[data-testid="slack-reviewer-preview-outcome-clean"]')).toBeNull();
  });

  it("previews posting as me, reactions, and edited templates live", async () => {
    apiMock.slackStatus.mockResolvedValue({
      connected: true,
      socket: "up",
      userName: "Sam Rivera",
    });
    mount([reviewer({ postAs: "user", reactions: true })]);
    await flush();
    const started = q('[data-testid="slack-reviewer-preview-reply-started"]');
    expect(started.textContent).toContain("Sam Rivera");
    expect(started.textContent).not.toContain("App");
    expect(
      q('[data-testid="slack-reviewer-preview-request"] .slack-reactions').textContent,
    ).toContain("📝");

    act(() =>
      setValue(q('[data-testid="slack-reviewer-status-commented"]'), "*Done* with {pr} :tada:"),
    );
    const done = q('[data-testid="slack-reviewer-preview-reply-commented"]');
    expect(done.querySelector(".slack-md strong")?.textContent).toBe("Done");
    expect(done.textContent).toContain("🎉");
  });

  it("switches the reaction legend and previews its marks", async () => {
    mount([reviewer({ reactions: true })]);
    await flush();
    const legend = q('[data-testid="slack-reviewer-reactions-preset-legend-r1"]');
    expect(
      q('[data-testid="slack-reviewer-reactions-preset-classic-r1"]').getAttribute("aria-pressed"),
    ).toBe("true");
    act(() => (legend as HTMLButtonElement).click());
    await flush();
    expect(
      q('[data-testid="slack-reviewer-reactions-preset-legend-r1"]').getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (q('[data-testid="slack-reviewer-reactions-pickup-r1"]') as HTMLInputElement).value,
    ).toBe("robot_face");
    expect(
      q('[data-testid="slack-reviewer-preview-request"] .slack-reactions').textContent,
    ).toContain("🤖");
  });

  it("offers CLI agents and warns when one reviews untrusted PRs", async () => {
    mount([reviewer()], undefined, { providers: [anthropic, openai, claudeCode] });
    await flush();
    expect(host.querySelector('[data-testid="slack-reviewer-cli-warning-r1"]')).toBeNull();
    expect(host.textContent).toContain("You can also pick a CLI agent");
    act(() => root.unmount());
    host.innerHTML = "";
    root = createRoot(host);
    mount([reviewer({ providerId: "claude-code" })], undefined, {
      providers: [anthropic, openai, claudeCode],
    });
    await flush();
    const warning = q('[data-testid="slack-reviewer-cli-warning-r1"]');
    expect(warning.textContent).toContain("Claude Code is a CLI agent with its own tools");
    expect(warning.textContent).toContain("SSH keys");
    expect(warning.textContent).toContain("inside a sandbox");
    expect(warning.textContent).toContain("still has internet access");
    expect(q('[data-testid="slack-reviewer-r1"]').textContent).toContain("Claude Code default");
    expect(q('[data-testid="slack-reviewer-cli-budget-r1"]').textContent).toContain("command line");
  });

  it("warns when a long prompt leaves a CLI agent little room for the diff", async () => {
    mount([reviewer({ providerId: "claude-code", prompt: "x".repeat(70_000) })], undefined, {
      providers: [anthropic, openai, claudeCode],
    });
    await flush();
    expect(q('[data-testid="slack-reviewer-prompt-cli-warning-r1"]').textContent).toContain(
      "little room for the diff",
    );
    act(() => root.unmount());
    host.innerHTML = "";
    root = createRoot(host);
    mount([reviewer({ prompt: "x".repeat(90_000) })], undefined, {
      providers: [anthropic, openai, claudeCode],
    });
    await flush();
    expect(host.querySelector('[data-testid="slack-reviewer-prompt-cli-warning-r1"]')).toBeNull();
  });

  it("toggles skills into the prompt and reports what is sent", async () => {
    const { seen } = mount([reviewer({ prompt: "Be strict." })], undefined, { skills });
    await flush();
    expect(q('[data-testid="slack-reviewer-skills-summary-r1"]').textContent).toContain(
      "Only named skills are sent",
    );
    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-skill-security"]').click());
    expect(seen.rows[0]!.prompt).toBe("Be strict. /security");
    expect(q('[data-testid="slack-reviewer-skill-security"]').getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(q('[data-testid="slack-reviewer-skills-summary-r1"]').textContent).toContain(
      "Sends 1 skill with every review",
    );
    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-skill-security"]').click());
    expect(seen.rows[0]!.prompt).toBe("Be strict.");

    act(() => setValue(q('[data-testid="slack-reviewer-prompt-r1"]'), "Use /perf and /nope."));
    expect(q('[data-testid="slack-reviewer-skills-unknown-r1"]').textContent).toContain("/nope");
    expect(q('[data-testid="slack-reviewer-skill-perf"]').getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("points to Settings → Skills when there are none", async () => {
    mount([reviewer()]);
    await flush();
    expect(q('[data-testid="slack-reviewer-skills-summary-r1"]').textContent).toContain(
      "Add them in Settings → Skills",
    );
  });

  it("warns when the reviewer can approve PRs", async () => {
    mount([reviewer({ forgeMode: "verdict" })]);
    await flush();
    expect(host.textContent).toContain("This reviewer can approve PRs");
  });

  it("saves, runs a test review, and lists the result", async () => {
    const result = {
      ...run,
      pr: "acme/api#9",
      outcome: "approved" as const,
      at: "2026-11-21T11:00:00.000Z",
    };
    apiMock.slackReviewerReview.mockResolvedValue(result);
    const { persist } = mount([reviewer()]);
    await flush();
    expect(q('[data-testid="slack-reviewer-runs"]').textContent).toContain("acme/api#7");
    expect(q('[data-testid="slack-reviewer-runs"]').textContent).toContain(
      "1,200 in (900 cached) / 80 out",
    );

    act(() =>
      setValue(
        q('[data-testid="slack-reviewer-test-url-r1"]'),
        " https://github.com/acme/api/pull/9 ",
      ),
    );
    await act(async () => {
      q<HTMLButtonElement>('[data-testid="slack-reviewer-test-run-r1"]').click();
    });
    await flush();
    expect(persist).toHaveBeenCalled();
    // Try it is a dry run unless switched off.
    expect(apiMock.slackReviewerReview).toHaveBeenCalledWith(
      "r1",
      "https://github.com/acme/api/pull/9",
      undefined,
      { dryRun: true },
    );
    expect(q('[data-testid="slack-reviewer-test-result-r1"]').textContent).toContain("Approved");
    expect(q('[data-testid="slack-reviewer-runs"]').textContent).toContain("acme/api#9");
  });

  it("shows a test review error", async () => {
    apiMock.slackReviewerReview.mockRejectedValue(new Error("No forge account for github.com"));
    mount([reviewer()]);
    await flush();
    act(() =>
      setValue(
        q('[data-testid="slack-reviewer-test-url-r1"]'),
        "https://github.com/acme/api/pull/9",
      ),
    );
    await act(async () => {
      q<HTMLButtonElement>('[data-testid="slack-reviewer-test-run-r1"]').click();
    });
    await flush();
    expect(host.textContent).toContain("No forge account for github.com");
  });
});

describe("toggleSkillRef", () => {
  it("adds once and removes every reference without touching paths", () => {
    expect(toggleSkillRef("", "perf", true)).toBe("/perf");
    expect(toggleSkillRef("Check src/perf and /perf.", "perf", true)).toBe(
      "Check src/perf and /perf.",
    );
    expect(toggleSkillRef("Check src/perf and /perf, then (/perf)", "perf", false)).toBe(
      "Check src/perf and, then ()",
    );
    expect(toggleSkillRef("line one\n", "perf", true)).toBe("line one /perf");
  });
});

describe("previewReviewerModel with CLI agents", () => {
  it("uses a CLI agent only when named, labelled with its default model", () => {
    expect(
      previewReviewerModel({ providerId: "claude-code" }, [claudeCode, anthropic], undefined),
    ).toMatchObject({
      model: "Claude Code default",
      cli: true,
      source: "reviewer",
    });
    expect(previewReviewerModel({}, [claudeCode, anthropic], undefined)).toMatchObject({
      provider: { id: "anthropic" },
      cli: false,
    });
    expect(previewReviewerModel({}, [claudeCode], undefined)).toBeUndefined();
  });
});

describe("previewReviewerModel", () => {
  it("prefers the reviewer, then the Slack default, then the first API provider", () => {
    expect(
      previewReviewerModel(
        { providerId: "anthropic", model: "claude-sonnet-5-5" },
        [anthropic, openai],
        slackAccount,
      ),
    ).toMatchObject({
      provider: { id: "anthropic" },
      model: "claude-sonnet-5-5",
      source: "reviewer",
    });
    expect(previewReviewerModel({}, [anthropic, openai], slackAccount)).toMatchObject({
      source: "slack",
      model: "gpt-a",
    });
    expect(previewReviewerModel({}, [anthropic, openai], undefined)).toMatchObject({
      source: "first",
      model: "claude-opus-5-5",
    });
    expect(previewReviewerModel({}, [{ ...anthropic, enabled: false }], undefined)).toBeUndefined();
  });

  it("shows dry-run findings, and posts for real with dry run off", async () => {
    apiMock.slackReviewerReview.mockResolvedValue({
      ...run,
      dryRun: true,
      summary: "One bug.",
      findings: [
        {
          id: 1,
          path: "src/a.ts",
          line: 2,
          severity: "major",
          body: "B is wrong",
          suggestion: "b",
        },
      ],
    });
    mount([reviewer()]);
    await flush();
    act(() =>
      setValue(
        q('[data-testid="slack-reviewer-test-url-r1"]'),
        "https://github.com/acme/api/pull/9",
      ),
    );
    await act(async () => {
      q<HTMLButtonElement>('[data-testid="slack-reviewer-test-run-r1"]').click();
    });
    await flush();
    const findings = q('[data-testid="slack-reviewer-test-findings-r1"]').textContent;
    expect(findings).toContain("One bug.");
    expect(findings).toContain("major src/a.ts:2 B is wrong");
    expect(q('[data-testid="slack-reviewer-test-result-r1"]').textContent).toContain("dry run");

    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-test-dry-r1"]').click());
    await act(async () => {
      q<HTMLButtonElement>('[data-testid="slack-reviewer-test-run-r1"]').click();
    });
    await flush();
    expect(apiMock.slackReviewerReview).toHaveBeenLastCalledWith(
      "r1",
      "https://github.com/acme/api/pull/9",
      undefined,
      { dryRun: false },
    );

    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-test-full-r1"]').click());
    await act(async () => {
      q<HTMLButtonElement>('[data-testid="slack-reviewer-test-run-r1"]').click();
    });
    expect(apiMock.slackReviewerReview).toHaveBeenLastCalledWith(
      "r1",
      "https://github.com/acme/api/pull/9",
      undefined,
      { dryRun: false, fullRereview: true },
    );
  });

  it("edits review context, thread options, the author map and the cost cap", async () => {
    const { seen } = mount([reviewer()]);
    await flush();
    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-questions-r1"]').click());
    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-guidelines-r1"]').click());
    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-incremental-r1"]').click());
    expect(seen.rows[0]).toMatchObject({
      answerQuestions: true,
      repoGuidelines: false,
      incrementalRereview: false,
    });
    // The CI approval hold only shows when the reviewer can approve.
    expect(host.querySelector('[data-testid="slack-reviewer-ci-hold-r1"]')).toBeNull();

    const authors = q<HTMLTextAreaElement>('[data-testid="slack-reviewer-authors-r1"]');
    act(() => setValue(authors, "Alice: <@U0123ABC>\nnot a mapping line here"));
    act(() => authors.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(seen.rows[0]!.authorSlackIds).toEqual({ alice: "U0123ABC" });

    const cost = q<HTMLInputElement>('[data-testid="slack-reviewer-cost-r1"]');
    act(() => setValue(cost, "0.333"));
    act(() => cost.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(seen.rows[0]!.maxCostUsd).toBe(0.33);
  });

  it("shows thumbs up and down per run and per reviewer", async () => {
    apiMock.slackReviewerRuns.mockResolvedValue({
      runs: [{ ...run, votes: { up: 3, down: 1 } }],
      feedback: { r1: { up: 5, down: 2, reviews: 4 } },
    });
    mount([reviewer()]);
    await flush();
    expect(q('[data-testid="slack-reviewer-runs"]').textContent).toContain("👍 3 · 👎 1");
    expect(q('[data-testid="slack-reviewer-r1"]').textContent).toContain("👍 5 · 👎 2");
  });

  it("double-checks serious findings by default, optionally on a second model", async () => {
    const { seen } = mount([reviewer({ providerId: "anthropic", model: "claude-opus-5-5" })]);
    await flush();
    const verify = q<HTMLButtonElement>('[data-testid="slack-reviewer-verify-r1"]');
    expect(verify.getAttribute("aria-checked")).toBe("true");

    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-verify-model-r1"]').click());
    expect(seen.rows[0]).toMatchObject({
      verifyProviderId: "anthropic",
      verifyModel: "claude-opus-5-5",
    });
    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-verify-model-r1"]').click());
    expect(seen.rows[0]!.verifyProviderId).toBeUndefined();
    expect(seen.rows[0]!.verifyModel).toBeUndefined();

    act(() => verify.click());
    expect(seen.rows[0]!.verifyFindings).toBe(false);
    expect(host.querySelector('[data-testid="slack-reviewer-verify-model-r1"]')).toBeNull();
  });

  it("shows each reviewer's accuracy over the last 30 days", async () => {
    apiMock.slackReviewerRuns.mockResolvedValue({
      runs: [run],
      stats: {
        r1: {
          days: 30,
          since: "2026-10-23",
          reviews: 6,
          failed: 0,
          answers: 0,
          posted: { major: 5, minor: 5 },
          postedTotal: 10,
          dismissed: { "false-positive": 3, "by-design": 1, "wont-fix": 0 },
          falsePositives: { major: 1, minor: 2 },
          precision: { major: 0.8, minor: 0.6 },
          precisionAll: 0.7,
          resolved: 4,
          resolveRate: 0.4,
          verified: 3,
          rejected: 1,
          downgraded: 0,
          votes: { up: 2, down: 0 },
          tokens: { input: 1, output: 1, cached: 0 },
          usd: 1.2,
          usdPerWeek: 0.28,
        },
      },
    });
    mount([reviewer()]);
    await flush();
    const text = q('[data-testid="slack-reviewer-accuracy-r1"]').textContent;
    expect(text).toContain("6 reviews, 10 findings posted, 3 double-checked (1 dropped");
    expect(text).toContain("Resolve rate 40%");
    expect(text).toContain("$0.28 / week");
    expect(text).toContain("major5180%");
    expect(text).toContain("minor5260%");
    expect(text).toContain("3 false positive, 1 by design, 0 won't fix");
  });

  it("says a reviewer with no usable model needs one, and doesn't show it as on", async () => {
    mount([reviewer({ enabled: true })], undefined, { providers: [] });
    await flush();
    const card = q('[data-testid="slack-reviewer-r1"]');
    expect(card.textContent).toContain("No model");
    const state = q('[data-testid="slack-reviewer-state-r1"]');
    expect(state.textContent).toBe("Needs a model");
    expect(state.classList.contains("warn")).toBe(true);
    expect(card.textContent).not.toContain("Watching");
    const toggle = q<HTMLButtonElement>('[data-testid="slack-reviewer-enabled-r1"]');
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.disabled).toBe(true);
    expect(card.querySelector(".provider-dot.on")).toBeNull();
  });

  it("shows a missing channel as a warning with the switch off", async () => {
    const { seen } = mount([reviewer({ channelId: "", enabled: true })]);
    await flush();
    const state = q('[data-testid="slack-reviewer-state-r1"]');
    expect(state.textContent).toBe("Needs a channel");
    expect(state.classList.contains("warn")).toBe(true);
    expect(q('[data-testid="slack-reviewer-enabled-r1"]').getAttribute("aria-checked")).toBe(
      "false",
    );
    // The saved value is untouched, so it watches once a channel is picked.
    expect(seen.rows[0]!.enabled).toBe(true);
    act(() => setValue(q('[data-testid="slack-reviewer-channel-r1"]'), "C9"));
    expect(q('[data-testid="slack-reviewer-state-r1"]').textContent).toBe("Watching");
    expect(q('[data-testid="slack-reviewer-enabled-r1"]').getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  describe("with a fixed clock", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
      vi.setSystemTime(new Date("2026-11-21T10:09:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows relative times with the full date as a tooltip", async () => {
      apiMock.slackReviewerRuns.mockResolvedValue({
        runs: [run],
        active: [
          {
            reviewerId: "r1",
            pr: "acme/api#9",
            url: "https://github.com/acme/api/pull/9",
            kind: "review",
            status: "running",
            since: "2026-11-21T10:05:00.000Z",
          },
        ],
        threads: [
          {
            reviewerId: "r1",
            pr: "acme/api#7",
            url: "https://github.com/acme/api/pull/7",
            channelId: "C1",
            threadTs: "101.0",
            at: "2026-11-21T09:00:00.000Z",
          },
        ],
      });
      mount([reviewer()]);
      await flush();
      expect(q('[data-testid="slack-reviewer-active"]').textContent).toContain("started 4m ago");
      expect(q('[data-testid="slack-reviewer-threads"]').textContent).toContain(
        "last review 1h ago",
      );
      const runs = q('[data-testid="slack-reviewer-runs"]');
      const time = runs.querySelector<HTMLTimeElement>("time")!;
      expect(time.textContent).toBe("9m ago");
      expect(time.dateTime).toBe(run.at);
      expect(time.title).toBe(new Date(run.at).toLocaleString());
      // Outcome, PR and result on the first line; model, usage, cost and time on the second.
      expect(runs.querySelector(".slack-reviewer-run-primary")!.textContent).toContain(
        "API reviews · 2 comments",
      );
      const secondary = runs.querySelector(".slack-reviewer-run-secondary")!.textContent;
      expect(secondary).toContain("claude-opus-5-5");
      expect(secondary).toContain("~$0.0064");
      expect(secondary).toContain("9m ago");
      const link = runs.querySelector("a")!;
      expect(link.className).toBe("slack-reviewer-pr-link");
    });

    it("polls fast while a review is in progress, slowly otherwise, and stops on unmount", async () => {
      const activeRow = {
        reviewerId: "r1",
        pr: "acme/api#9",
        url: "https://github.com/acme/api/pull/9",
        kind: "review",
        status: "running",
        since: "2026-11-21T10:05:00.000Z",
      };
      apiMock.slackReviewerRuns.mockResolvedValue({ runs: [run], active: [activeRow] });
      mount([reviewer()]);
      await flush();
      expect(apiMock.slackReviewerRuns).toHaveBeenCalledTimes(1);

      act(() => void vi.advanceTimersByTime(5_000));
      await flush();
      expect(apiMock.slackReviewerRuns).toHaveBeenCalledTimes(2);

      // The review finished: back to the slow interval.
      apiMock.slackReviewerRuns.mockResolvedValue({ runs: [run], active: [] });
      act(() => void vi.advanceTimersByTime(5_000));
      await flush();
      expect(apiMock.slackReviewerRuns).toHaveBeenCalledTimes(3);
      act(() => void vi.advanceTimersByTime(25_000));
      await flush();
      expect(apiMock.slackReviewerRuns).toHaveBeenCalledTimes(3);
      act(() => void vi.advanceTimersByTime(5_000));
      await flush();
      expect(apiMock.slackReviewerRuns).toHaveBeenCalledTimes(4);

      act(() => root.unmount());
      act(() => void vi.advanceTimersByTime(60_000));
      expect(apiMock.slackReviewerRuns).toHaveBeenCalledTimes(4);
      // afterEach unmounts again; give it a fresh root.
      root = createRoot(host);
    });
  });
});

describe("opt-outs, scoping, path prompts and REVIEW.md proposals", () => {
  it("edits base branches, skip labels, who can ask and path prompts", async () => {
    const { seen } = mount([reviewer()]);
    await flush();
    const commit = (testId: string, value: string) => {
      const el = q<HTMLTextAreaElement>(`[data-testid="${testId}"]`);
      act(() => setValue(el, value));
      act(() => el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    };
    commit("slack-reviewer-base-branches-r1", "main\nrelease/*");
    commit("slack-reviewer-skip-labels-r1", "wip");
    commit("slack-reviewer-requesters-r1", "u0123abcd\n<@U0456EFGH>\nnope");
    expect(seen.rows[0]).toMatchObject({
      baseBranches: ["main", "release/*"],
      skipLabels: ["wip"],
      allowedRequesters: ["U0123ABCD", "U0456EFGH"],
    });

    act(() => q<HTMLButtonElement>('[data-testid="slack-reviewer-path-prompt-add-r1"]').click());
    commit("slack-reviewer-path-glob-0", "migrations/**");
    // Not saved until both the glob and the text are filled.
    expect(seen.rows[0]!.pathPrompts).toEqual([]);
    commit("slack-reviewer-path-prompt-0", "Check locks.");
    expect(seen.rows[0]!.pathPrompts).toEqual([{ glob: "migrations/**", prompt: "Check locks." }]);
    expect(q('[data-testid="slack-reviewer-path-prompts-r1"]').textContent).toContain("tokens");
  });

  it("picks people to exclude from the Slack member list", async () => {
    const { seen } = mount([reviewer()]);
    await flush();
    const input = q<HTMLInputElement>('[data-testid="slack-reviewer-excluded-r1-input"]');
    act(() => input.focus());
    act(() => input.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    act(() => setValue(input, "smith"));
    expect(
      document.querySelector('[data-testid="slack-reviewer-excluded-r1-option-U0456EFGH"]'),
    ).toBeNull();
    act(() =>
      q<HTMLElement>('[data-testid="slack-reviewer-excluded-r1-option-U0123ABCD"]').click(),
    );
    expect(seen.rows[0]!.excludedUsers).toEqual(["U0123ABCD"]);
    act(() => setValue(input, "bot"));
    act(() =>
      q<HTMLElement>('[data-testid="slack-reviewer-excluded-r1-option-U0789IJKL"]').click(),
    );
    expect(seen.rows[0]!.excludedUsers).toEqual(["U0123ABCD", "U0789IJKL"]);
    expect(q('[data-testid="slack-reviewer-excluded-r1-chip-U0123ABCD"]').textContent).toContain(
      "alice",
    );
    act(() =>
      q<HTMLButtonElement>(
        '[data-testid="slack-reviewer-excluded-r1-chip-U0123ABCD"] button',
      ).click(),
    );
    expect(seen.rows[0]!.excludedUsers).toEqual(["U0789IJKL"]);
  });

  it("proposes remembered dismissals as REVIEW.md, and disables it on other forges", async () => {
    apiMock.slackReviewerNotes.mockResolvedValue({
      "github.com/acme/api": [
        {
          path: "src/a.ts",
          severity: "minor",
          body: "B is wrong",
          reason: "false-positive",
          pr: "acme/api#7",
          at: "2026-11-21T10:00:00.000Z",
        },
      ],
      "bitbucket.org/acme/mobile": [
        {
          path: "src/b.ts",
          severity: "nit",
          body: "Rename",
          reason: "wont-fix",
          pr: "acme/mobile#2",
          at: "2026-11-21T10:00:00.000Z",
        },
      ],
    });
    apiMock.slackReviewerProposeNotes.mockResolvedValue({
      url: "https://github.com/acme/api/pull/12",
      number: 12,
      branch: "locus/review-conventions-2026-11-22",
      notes: 1,
    });
    const forges = [
      {
        id: "gh",
        kind: "github",
        name: "GitHub",
        token: "••••",
        apiBaseUrl: "https://api.github.com",
      },
      {
        id: "bb",
        kind: "bitbucket",
        name: "Bitbucket",
        token: "••••",
        apiBaseUrl: "https://api.bitbucket.org/2.0",
      },
    ] as GitForgeAccount[];
    mount([reviewer()], undefined, { forges });
    await flush();
    const details = q<HTMLDetailsElement>('[data-testid="slack-reviewer-notes-r1"]');
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await flush();
    const bb = q<HTMLButtonElement>(
      '[data-testid="slack-reviewer-notes-propose-bitbucket.org/acme/mobile"]',
    );
    expect(bb.disabled).toBe(true);
    const gh = q<HTMLButtonElement>(
      '[data-testid="slack-reviewer-notes-propose-github.com/acme/api"]',
    );
    expect(gh.disabled).toBe(false);
    await act(async () => gh.click());
    await flush();
    expect(apiMock.slackReviewerProposeNotes).toHaveBeenCalledWith("r1", "github.com/acme/api");
    const done = q('[data-testid="slack-reviewer-notes-proposed-github.com/acme/api"]');
    expect(done.querySelector("a")!.getAttribute("href")).toBe(
      "https://github.com/acme/api/pull/12",
    );
    expect(done.textContent).toContain("Forget all");
  });
});
