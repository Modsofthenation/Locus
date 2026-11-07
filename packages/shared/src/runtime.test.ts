import { describe, expect, it } from "vitest";
import {
  foldOldTurns,
  formatLlmCompactNote,
  buildLlmCompactUserPrompt,
  shouldAttemptLlmCompact,
  LLM_COMPACT_MIN_DROPPED,
  LLM_COMPACT_SYSTEM,
  mergeInspectedFiles,
  MAX_INSPECTED_FILES,
  openOperationStart,
  openToolCallIds,
} from "./compact.js";
import {
  checkBudget,
  formatProgressReport,
  providerRoundTimeoutMs,
  taskSpendNow,
} from "./governor.js";
import {
  appendVolatileConversationTail,
  assemblePrompt,
  joinCachedSystem,
  markLastPromptCacheBreakpoint,
  promptCacheBlocks,
} from "./promptCache.js";
import {
  buildRepoMap,
  extractSymbolLocations,
  extractSymbols,
  formatRepoMap,
  fuzzyScore,
  pickSymbolFiles,
  parseCtagsXOutput,
  repoMapPromptQuery,
  searchRepoMap,
  wordStarts,
} from "./repoMap.js";
import {
  debugLogId,
  evalCaseFromTrace,
  formatTraceLine,
  parseDebugLogId,
  replayTrace,
  summarizeTrace,
  redactedTraceArgs,
  TRACE_ARG_CHARS,
} from "./trace.js";
import {
  applyScratchpad,
  applyTaskList,
  formatWorkingState,
  isRuntimeToolName,
  previewTaskItems,
  RUNTIME_TOOLS,
  taskListDoneCount,
  taskListFromPlan,
} from "./models/workingState.js";
import { toolCallsRunInParallel, toolsRunInParallel } from "./models/tools.js";
import {
  backgroundKillCommand,
  parseBackgroundPoll,
  parseStartProcessPid,
  type ChatMessage,
} from "./models/session.js";

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">): ChatMessage {
  return { content: "", createdAt: "", ...partial };
}

describe("summarize-and-prune compaction", () => {
  it("does not prune an unfinished tool round", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "first task ".repeat(30) }),
      msg({
        id: "a1",
        role: "assistant",
        content: "working",
        toolCalls: [{ id: "c1", name: "grep", arguments: {}, startedAt: "" }],
      }),
      msg({ id: "t1", role: "tool", content: "hits ".repeat(40), toolCallId: "c1" }),
      msg({ id: "u2", role: "user", content: "now patch it" }),
      msg({
        id: "a2",
        role: "assistant",
        content: "applying",
        toolCalls: [{ id: "c2", name: "apply_patch", arguments: {}, startedAt: "" }],
      }),
    ];
    expect([...openToolCallIds(messages)]).toEqual(["c2"]);
    expect(openOperationStart(messages)).toBe(3);
    const folded = foldOldTurns(messages, 20);
    expect(folded.messages.some((row) => row.id === "a2")).toBe(true);
    expect(folded.messages.some((row) => row.id === "u2")).toBe(true);
    expect(folded.messages[0]?.id).not.toBe("a2");
  });

  it("preserves decisions, open threads, and working state in the compact note", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "Can you also keep the public API stable?" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "Decision: use summarize-and-prune. I will keep the public API stable.",
        toolCalls: [{ id: "c1", name: "grep", arguments: {}, startedAt: "" }],
      }),
      msg({ id: "t1", role: "tool", content: "hits", toolCallId: "c1" }),
      msg({ id: "u2", role: "user", content: "now this" }),
      msg({ id: "a2", role: "assistant", content: "ok" }),
    ];
    const folded = foldOldTurns(messages, 20, {
      workingState: {
        scratchpad: "keep API",
        tasks: [{ id: "t1", text: "land prune", status: "in_progress" }],
        plan: [{ id: "p1", text: "land prune without dropping the plan", status: "running" }],
      },
    });
    expect(folded.note).toMatch(/omitted/);
    expect(folded.note).toMatch(/Decision:/);
    expect(folded.note).toMatch(/public API/);
    expect(folded.note).toMatch(/grep/);
    expect(folded.note).toMatch(/Continue from the scratchpad/);
    expect(folded.note).toMatch(/If tests failed in omitted rounds/);
    expect(folded.note).toMatch(/land prune/);
    expect(folded.note).not.toMatch(/Preserved task state/);
    expect(folded.note).toMatch(/In-progress \(do not drop\)/);
    expect(folded.messages[0]?.id).toBe("u2");
    expect(folded.dropped?.some((row) => row.id === "u1")).toBe(true);
    expect(folded.beforeTokens).toBeGreaterThan(folded.afterTokens);
  });

  it("accepts a structured LLM compact note and rejects junk", () => {
    expect(
      formatLlmCompactNote("## Goal\nFix compact.\n## Decisions\n- Keep the API\n", {
        scratchpad: "keep API",
        tasks: [{ id: "t1", text: "land prune", status: "in_progress" }],
      }),
    ).toMatch(/summarized to save context/);
    expect(formatLlmCompactNote("nope")).toBeUndefined();
  });

  it("folds older tool rounds inside a single user turn and lists inspected files", () => {
    const messages = [
      msg({ id: "u", role: "user", content: "fix the stream loop" }),
      ...[0, 1, 2, 3, 4, 5].flatMap((n) => [
        msg({
          id: `a${n}`,
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: `c${n}`,
              name: "file_read",
              arguments: { path: `/workspace/packages/providers/src/file${n}.ts` },
              startedAt: "",
            },
          ],
        }),
        msg({
          id: `t${n}`,
          role: "tool",
          toolCallId: `c${n}`,
          content: `body${n} `.repeat(400),
          toolCalls: [
            {
              id: `c${n}`,
              name: "file_read",
              arguments: { path: `/workspace/packages/providers/src/file${n}.ts` },
              startedAt: "",
            },
          ],
        }),
      ]),
    ];
    const folded = foldOldTurns(messages, 800);
    expect(folded.note).toMatch(/Earlier tool rounds this turn/);
    expect(folded.note).toMatch(/file_read · \/workspace\/packages\/providers\/src\/file0\.ts/);
    expect(folded.note).toMatch(/do not re-read/i);
    expect(folded.note).toMatch(/apply_patch or file_write/);
    expect(folded.messages[0]?.id).toBe("u");
    expect(folded.messages.some((row) => row.id === "t0")).toBe(false);
    expect(folded.messages.some((row) => row.id === "t5")).toBe(true);
  });

  it("keeps persisted inspected files when a later fold drops those messages", () => {
    const firstMessages = [
      msg({ id: "u1", role: "user", content: "read the parser ".repeat(40) }),
      msg({
        id: "a1",
        role: "assistant",
        content: "reading",
        toolCalls: [
          {
            id: "c1",
            name: "file_read",
            arguments: { path: "/workspace/src/parse.ts" },
            startedAt: "",
          },
        ],
      }),
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "c1",
        content: "export function parse() {}\n".repeat(80),
        toolCalls: [
          {
            id: "c1",
            name: "file_read",
            arguments: { path: "/workspace/src/parse.ts" },
            startedAt: "",
          },
        ],
      }),
      msg({ id: "u2", role: "user", content: "now implement the next slice ".repeat(20) }),
      msg({ id: "a2", role: "assistant", content: "on it" }),
    ];
    const first = foldOldTurns(firstMessages, 80);
    expect(first.messages.some((row) => row.id === "u1")).toBe(false);
    expect(first.inspectedFiles).toContain("/workspace/src/parse.ts");
    expect(first.note).toMatch(/\/workspace\/src\/parse\.ts/);

    const later = [
      msg({ id: "u3", role: "user", content: "keep going on the writer ".repeat(40) }),
      msg({ id: "a3", role: "assistant", content: "writing" }),
      msg({ id: "u4", role: "user", content: "and then the tests ".repeat(40) }),
      msg({ id: "a4", role: "assistant", content: "ok" }),
    ];
    const second = foldOldTurns(later, 80, { inspectedFiles: first.inspectedFiles });
    expect(second.messages.some((row) => row.id === "u3")).toBe(false);
    expect(second.messages.some((row) => row.id === "t1")).toBe(false);
    expect(second.note).toMatch(/\/workspace\/src\/parse\.ts/);
    expect(second.inspectedFiles).toContain("/workspace/src/parse.ts");
  });

  it("does not persist exec commands as inspected files", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "run the build ".repeat(40) }),
      msg({
        id: "a1",
        role: "assistant",
        content: "running",
        toolCalls: [
          { id: "c1", name: "exec", arguments: { command: "cat src/parse.ts" }, startedAt: "" },
        ],
      }),
      msg({
        id: "t1",
        role: "tool",
        toolCallId: "c1",
        content: "ok ".repeat(80),
        toolCalls: [
          { id: "c1", name: "exec", arguments: { command: "cat src/parse.ts" }, startedAt: "" },
        ],
      }),
      msg({ id: "u2", role: "user", content: "next" }),
      msg({ id: "a2", role: "assistant", content: "ok" }),
    ];
    const folded = foldOldTurns(messages, 80);
    expect(folded.inspectedFiles ?? []).toEqual([]);
  });

  it("caps the durable inspected-file set", () => {
    const paths = Array.from({ length: MAX_INSPECTED_FILES + 10 }, (_, i) => `f${i}.ts`);
    expect(mergeInspectedFiles(paths)).toHaveLength(MAX_INSPECTED_FILES);
    expect(mergeInspectedFiles([" a.ts ", "a.ts", "b.ts"], ["b.ts", "c.ts"])).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
  });

  it("keeps persisted inspected files on an LLM compact note", () => {
    expect(
      formatLlmCompactNote("## Goal\nFix compact.\n## Decisions\n- Keep the API\n", undefined, [
        "/workspace/src/parse.ts",
      ]),
    ).toMatch(/\/workspace\/src\/parse\.ts/);
  });

  it("attempts an LLM compact only after a few dropped rounds", () => {
    expect(shouldAttemptLlmCompact(undefined)).toBe(false);
    expect(shouldAttemptLlmCompact([])).toBe(false);
    expect(
      shouldAttemptLlmCompact(
        Array.from({ length: LLM_COMPACT_MIN_DROPPED - 1 }, (_, i) =>
          msg({ id: `m${i}`, role: "user", content: "x" }),
        ),
      ),
    ).toBe(false);
    expect(
      shouldAttemptLlmCompact(
        Array.from({ length: LLM_COMPACT_MIN_DROPPED }, (_, i) =>
          msg({ id: `m${i}`, role: "user", content: "x" }),
        ),
      ),
    ).toBe(true);
  });

  it("builds a compact-model prompt with inspected files and working state", () => {
    const dropped = [
      msg({ id: "u1", role: "user", content: "fix compact" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "Decision: keep the heuristic fallback.",
        toolCalls: [
          {
            id: "c1",
            name: "file_read",
            arguments: { path: "/workspace/src/compact.ts" },
            startedAt: "",
          },
        ],
      }),
    ];
    const prompt = buildLlmCompactUserPrompt({
      dropped,
      workingState: {
        scratchpad: "keep API",
        tasks: [{ id: "t1", text: "land prune", status: "in_progress" }],
      },
      inspectedFiles: ["/workspace/src/parse.ts"],
    });
    expect(prompt).toContain("User: fix compact");
    expect(prompt).toContain("/workspace/src/compact.ts");
    expect(prompt).toContain("/workspace/src/parse.ts");
    expect(prompt).toContain("keep API");
    expect(prompt).toContain("land prune");
    expect(LLM_COMPACT_SYSTEM).toMatch(/## Goal/);
    expect(LLM_COMPACT_SYSTEM).toMatch(/retry that failure/);
  });

  it("drops only enough stale rounds to fit instead of collapsing to three", () => {
    const messages = [
      msg({ id: "u", role: "user", content: "fix the stream loop" }),
      ...[0, 1, 2, 3, 4, 5].flatMap((n) => [
        msg({
          id: `a${n}`,
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: `c${n}`,
              name: "file_read",
              arguments: { path: `/workspace/file${n}.ts` },
              startedAt: "",
            },
          ],
        }),
        msg({
          id: `t${n}`,
          role: "tool",
          toolCallId: `c${n}`,
          content: `body${n} `.repeat(400),
          toolCalls: [
            {
              id: `c${n}`,
              name: "file_read",
              arguments: { path: `/workspace/file${n}.ts` },
              startedAt: "",
            },
          ],
        }),
      ]),
    ];
    const folded = foldOldTurns(messages, 2_800);
    expect(folded.note).toMatch(/Earlier tool rounds this turn/);
    expect(folded.note).toMatch(/Already inspected/);
    expect(folded.messages[0]?.id).toBe("u");
    expect(folded.messages.some((row) => row.id === "t5")).toBe(true);
    expect(folded.messages.filter((row) => row.role === "tool").length).toBeGreaterThan(3);
    expect(folded.messages.some((row) => row.id === "t0")).toBe(false);
  });

  it("does not pin compaction to an abandoned tool call from an earlier round", () => {
    const messages = [
      msg({ id: "u", role: "user", content: "continue" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "stale", name: "file_read", arguments: { path: "old.ts" }, startedAt: "" },
        ],
      }),
      msg({
        id: "a2",
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c2", name: "grep", arguments: { pattern: "runChatTurn" }, startedAt: "" },
        ],
      }),
      msg({ id: "t2", role: "tool", content: "hit", toolCallId: "c2" }),
    ];
    expect([...openToolCallIds(messages)]).toEqual([]);
    expect(openOperationStart(messages)).toBe(-1);
  });

  it("keeps tool results with the assistant that opened them", () => {
    const messages = [
      msg({ id: "u", role: "user", content: "fix the stream" }),
      msg({
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "grep", arguments: { pattern: "fold" }, startedAt: "" }],
      }),
      msg({
        id: "a2",
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c2", name: "file_read", arguments: { path: "a.ts" }, startedAt: "" }],
      }),
      msg({ id: "t1", role: "tool", toolCallId: "c1", content: "hits ".repeat(500) }),
      msg({ id: "t2", role: "tool", toolCallId: "c2", content: "file ".repeat(500) }),
      msg({
        id: "a3",
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c3", name: "file_read", arguments: { path: "b.ts" }, startedAt: "" }],
      }),
      msg({ id: "t3", role: "tool", toolCallId: "c3", content: "file ".repeat(500) }),
      msg({
        id: "a4",
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c4", name: "file_read", arguments: { path: "c.ts" }, startedAt: "" }],
      }),
      msg({ id: "t4", role: "tool", toolCallId: "c4", content: "file ".repeat(500) }),
    ];
    const folded = foldOldTurns(messages, 1_200);
    const ids = new Set(folded.messages.map((row) => row.id));
    if (ids.has("t1")) expect(ids.has("a1")).toBe(true);
    if (ids.has("t2")) expect(ids.has("a2")).toBe(true);
    expect(ids.has("t4")).toBe(true);
    expect(ids.has("a4")).toBe(true);
    expect(ids.has("t1")).toBe(false);
  });

  it("folds when measured usage is over budget even if the char estimate is not", () => {
    const messages = [
      msg({ id: "u1", role: "user", content: "first" }),
      msg({ id: "a1", role: "assistant", content: "ok" }),
      msg({ id: "u2", role: "user", content: "second" }),
      msg({ id: "a2", role: "assistant", content: "done" }),
    ];
    expect(foldOldTurns(messages, 50_000).note).toBeUndefined();
    const folded = foldOldTurns(messages, 100, { measuredInputTokens: 500 });
    expect(folded.note).toMatch(/omitted/);
    expect(folded.messages[0]?.id).toBe("u2");
  });
});

describe("working state tools", () => {
  it("writes a scratchpad and mutates a task list", () => {
    const wrote = applyScratchpad(undefined, { action: "write", content: "use repo map" });
    expect(wrote.text).toBe("use repo map");
    const added = applyTaskList([], { action: "add", text: "index symbols" });
    expect(added.tasks[0]?.id).toBe("t1");
    const done = applyTaskList(added.tasks, { action: "complete", id: "t1" });
    expect(done.tasks[0]?.status).toBe("done");
    expect(formatWorkingState({ scratchpad: wrote.text, tasks: done.tasks })).toContain(
      "index symbols",
    );
    expect(
      formatWorkingState({ plan: [{ id: "p1", text: "ship it", status: "running" }] }),
    ).toContain("Session plan");
    expect(
      taskListFromPlan({ items: [{ id: "p1", text: "land it", status: "running" }] })[0],
    ).toEqual({
      id: "t1",
      text: "land it",
      status: "in_progress",
    });
    expect(RUNTIME_TOOLS.map((tool) => tool.name)).toEqual([
      "scratchpad",
      "task_list",
      "repo_map",
      "spawn_agent",
    ]);
    expect(isRuntimeToolName("spawn_agent")).toBe(true);
    expect(isRuntimeToolName("host_sessions")).toBe(true);
    expect(isRuntimeToolName("docker_swarm")).toBe(true);
    expect(isRuntimeToolName("remember")).toBe(true);
    expect(isRuntimeToolName("orient")).toBe(true);
    expect(isRuntimeToolName("find_entity")).toBe(true);
    expect(isRuntimeToolName("subscribe")).toBe(true);
    expect(isRuntimeToolName("unsubscribe")).toBe(true);
    expect(isRuntimeToolName("exec")).toBe(false);
  });

  it("windows a long task list around the current item", () => {
    const tasks = [
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `d${i}`,
        text: `done ${i}`,
        status: "done" as const,
      })),
      { id: "p", text: "current", status: "in_progress" as const },
      ...Array.from({ length: 26 }, (_, i) => ({
        id: `n${i}`,
        text: `next ${i}`,
        status: "pending" as const,
      })),
    ];
    expect(taskListDoneCount(tasks)).toBe(12);
    expect(previewTaskItems(tasks).map((item) => item.id)).toEqual([
      "d11",
      "p",
      "n0",
      "n1",
      "n2",
      "n3",
    ]);
    expect(previewTaskItems(tasks, true)).toHaveLength(39);
    expect(previewTaskItems(tasks.slice(-4)).map((item) => item.id)).toEqual([
      "n22",
      "n23",
      "n24",
      "n25",
    ]);
  });
});

describe("repo map", () => {
  it("indexes symbols instead of stuffing file bodies", () => {
    const map = buildRepoMap([
      {
        path: "/workspace/src/compact.ts",
        content: "export function foldOldTurns() {}\nexport class Compactor {}",
      },
      { path: "src/loop.py", content: "def run_turn():\n    pass\nclass Loop:\n    pass\n" },
      { path: "node_modules/skip.js", content: "export function ignore() {}" },
    ]);
    expect(map.files.map((file) => file.path)).toEqual(["src/compact.ts", "src/loop.py"]);
    expect(extractSymbols("a.ts", "export function assemblePrompt() {}")).toContain(
      "assemblePrompt",
    );
    expect(
      extractSymbols("a.ts", "const foldOldTurns = (n: number) => n;\nexport const keep = 1;\n"),
    ).toContain("foldOldTurns");
    expect(
      extractSymbols("loop.py", "class Loop:\n    def run_turn(self):\n        pass\n"),
    ).toEqual(expect.arrayContaining(["Loop", "run_turn"]));
    const manyDefs = Array.from({ length: 40 }, (_, i) => `def helper_${i}():\n    pass\n`).join(
      "",
    );
    const py = extractSymbolLocations(
      "app.py",
      `${manyDefs}class Flask:\n    def run(self):\n        pass\n`,
      { limit: 200 },
    );
    expect(py.some((row) => row.name === "Flask")).toBe(true);
    expect(py.find((row) => row.name === "Flask")?.line).toBeGreaterThan(40);
    const text = formatRepoMap(map, { query: "fold" });
    expect(text).toContain("src/compact.ts");
    expect(text).toContain("foldOldTurns");
    expect(text).not.toContain("run_turn");
    expect(repoMapPromptQuery("Implement a Docker containers pane with protocol types")).toMatch(
      /Docker/,
    );
    expect(repoMapPromptQuery("Implement a Docker containers pane with protocol types")).toMatch(
      /containers/,
    );
    const ranked = formatRepoMap(map, { query: "fold loop", rank: true });
    expect(ranked).toMatch(/Likely relevant/);
    expect(ranked.indexOf("src/compact.ts")).toBeLessThan(ranked.indexOf("src/loop.py"));
    expect(ranked).toContain("run_turn");
    const focused = formatRepoMap(map, { query: "fold loop", rank: true, focus: "src/loop.py" });
    expect(focused).toMatch(/Open file src\/loop\.py listed first/);
    expect(focused.indexOf("src/loop.py")).toBeLessThan(focused.indexOf("src/compact.ts"));
  });

  it("parses ctags -x lines into file symbol maps", () => {
    const map = parseCtagsXOutput(
      ["foldOldTurns function 1 ./src/compact.ts", "Compactor class 3 src/compact.ts", "junk"].join(
        "\n",
      ),
    );
    expect(map.get("src/compact.ts")?.map((row) => row.name)).toEqual([
      "foldOldTurns",
      "Compactor",
    ]);
  });

  it("searches files and symbols for Quick Open", () => {
    const map = buildRepoMap([
      {
        path: "src/compact.ts",
        content: "export function foldOldTurns() {}\nexport class Compactor {}",
      },
      { path: "src/loop.py", content: "def run_turn():\n    pass\n" },
      { path: "README.md", content: "# hi\n" },
    ]);
    const bySymbol = searchRepoMap(map, "foldOld");
    expect(bySymbol[0]).toMatchObject({
      path: "src/compact.ts",
      kind: "symbol",
      symbol: "foldOldTurns",
    });
    const byPath = searchRepoMap(map, "loop.py");
    expect(byPath.some((hit) => hit.path === "src/loop.py" && hit.kind === "file")).toBe(true);
    const empty = searchRepoMap(map, "");
    expect(empty.map((hit) => hit.path)).toContain("README.md");
    expect(searchRepoMap(map, "zzzzmissing")).toEqual([]);
    expect(wordStarts("foldOldTurns")).toBe("fot");
    expect(wordStarts("forgeOauth.test.ts")).toBe("fo");
    expect(wordStarts("apps/server/src/workspaceGrep.ts")).toBe("wg");
    expect(fuzzyScore("foldOldTurns", "fOT")).toBeGreaterThan(fuzzyScore("README.md", "fOT"));
    expect(searchRepoMap(map, "fOT")[0]).toMatchObject({
      kind: "symbol",
      symbol: "foldOldTurns",
    });
    const mixed = buildRepoMap([
      {
        path: "src/compact.ts",
        content: "export function foldOldTurns() {}\n",
      },
      { path: "src/forgeOauth.ts", content: "export function signIn() {}\n" },
    ]);
    expect(searchRepoMap(mixed, "fOT")[0]).toMatchObject({
      kind: "symbol",
      symbol: "foldOldTurns",
    });
    expect(extractSymbols("app.rb", "class Loop\n  def run_turn\n  end\nend\n")).toEqual(
      expect.arrayContaining(["Loop", "run_turn"]),
    );
    expect(extractSymbols("fold.c", "int foldOld(void) {\n  return 0;\n}\n")).toContain("foldOld");
    expect(
      pickSymbolFiles(
        ["zzz/noise.ts", "src/keep.ts", "tests/keep.test.ts", "packages/shared/src/repoMap.ts"],
        2,
      ),
    ).toEqual(["src/keep.ts", "packages/shared/src/repoMap.ts"]);
  });
});

describe("prompt cache assembly", () => {
  it("puts stable prefixes first and volatile content last", () => {
    const assembled = assemblePrompt({
      system: "You are Locus.",
      repoMap: "Repo map (1 files)",
      workingState: "Task list:\n- [pending] t1: ship",
      compactNote: "Earlier in this session (2 messages omitted to save context):",
      messages: [msg({ id: "u", role: "user", content: "hi" })],
    });
    const blocks = promptCacheBlocks(assembled);
    expect(blocks.map((block) => block.cache)).toEqual([true, true, false]);
    expect(blocks[0]?.text).toBe("You are Locus.");
    expect(blocks[1]?.text).toContain("Repo map");
    expect(blocks[2]?.text).toContain("omitted");
    expect(blocks[2]?.text).toContain("Task list");
    expect(joinCachedSystem(assembled)).not.toContain("omitted");
  });

  it("appends volatile notes after a cached user prefix", () => {
    const messages = [{ role: "user", content: "hi" }];
    const marked = markLastPromptCacheBreakpoint(messages);
    expect(JSON.stringify(marked[0])).toContain("cache_control");
    const withTail = appendVolatileConversationTail(marked, "Guest status: running");
    expect(JSON.stringify(withTail[0])).toContain("Guest status: running");
    expect(JSON.stringify(withTail[0]).indexOf("cache_control")).toBeLessThan(
      JSON.stringify(withTail[0]).indexOf("Guest status"),
    );
  });

  it("drops compact boundary messages from the model prompt", () => {
    const assembled = assemblePrompt({
      system: "You are Locus.",
      messages: [
        msg({ id: "u", role: "user", content: "hi" }),
        msg({
          id: "c",
          role: "system",
          content: "Compacted 8 messages",
          compact: { dropped: 8, source: "heuristic" },
        }),
      ],
    });
    expect(assembled.messages.map((row) => row.id)).toEqual(["u"]);
  });
});

describe("background process poll", () => {
  it("parses start_process pids and exit tails", () => {
    expect(parseStartProcessPid("4321\n")).toBe(4321);
    expect(parseStartProcessPid("nope")).toBeUndefined();
    expect(parseBackgroundPoll("LOCUS_BG_RUNNING")).toEqual({ running: true, tail: "" });
    expect(parseBackgroundPoll("LOCUS_BG_EXITED\nserver stopped")).toEqual({
      running: false,
      tail: "server stopped",
    });
    expect(parseBackgroundPoll("Refusing host exec path outside /workspace")).toEqual({
      running: true,
      tail: "",
    });
    expect(backgroundKillCommand(4321)).toMatch(/kill 4321/);
    expect(backgroundKillCommand(4321)).toMatch(/kill -9 4321/);
    expect(backgroundKillCommand(4321)).not.toMatch(/pkill/);
    expect(backgroundKillCommand(1)).toBe("echo LOCUS_BG_KILLED");
    expect(backgroundKillCommand(0)).toBe("echo LOCUS_BG_KILLED");
  });
});

describe("governors", () => {
  it("warns near the cap and stops with a progress report", () => {
    const warn = checkBudget({ startedAtMs: 0, round: 1, usd: 0.81 }, { maxUsd: 1 }, 0);
    expect(warn.ok).toBe(true);
    if (!warn.ok) throw new Error("expected warn");
    expect(warn.warn).toBe("usd");
    const stop = checkBudget({ startedAtMs: 0, round: 1 }, { maxMs: 1_000 }, 1_500);
    expect(stop.ok).toBe(false);
    if (stop.ok) throw new Error("expected stop");
    expect(stop.reason).toBe("time");
    const roundWarn = checkBudget({ startedAtMs: 0, round: 48 }, { maxRounds: 48 }, 0);
    expect(roundWarn.ok).toBe(true);
    if (!roundWarn.ok) throw new Error("expected rounds to warn, not stop");
    expect(roundWarn.warn).toBe("rounds");
    const withCompute = taskSpendNow({ startedAtMs: 0, round: 1, computeUsd: 0.5 });
    expect(withCompute.usd).toBe(0.5);
    const computeStop = checkBudget(withCompute, { maxUsd: 0.4 }, 0);
    expect(computeStop.ok).toBe(false);
    if (computeStop.ok) throw new Error("expected compute spend to stop");
    expect(computeStop.reason).toBe("usd");
    expect(providerRoundTimeoutMs(180_000, 178_000)).toBe(30_000);
    expect(providerRoundTimeoutMs(180_000, 10_000)).toBe(170_000);
    expect(providerRoundTimeoutMs(10, 2)).toBe(10);
    expect(
      formatProgressReport({
        reason: stop.message,
        tasks: [{ id: "t1", text: "index", status: "in_progress" }],
      }),
    ).toContain("Progress so far");
  });
});

describe("traces", () => {
  it("round-trips jsonl events", () => {
    const line = formatTraceLine({
      t: "2026-08-21T00:00:00.000Z",
      kind: "tool.call",
      sessionId: "s1",
      name: "repo_map",
    });
    const events = replayTrace(`${line}\nnot json\n`);
    expect(events).toHaveLength(1);
    expect(summarizeTrace(events)).toContain("repo_map");
  });

  it("builds an eval fixture from a failed trace", () => {
    const events = replayTrace(
      [
        formatTraceLine({
          t: "2026-08-22T00:00:00.000Z",
          kind: "turn.start",
          sessionId: "s1",
          turnId: "1",
          detail: "fix the type error",
        }),
        formatTraceLine({
          t: "2026-08-22T00:00:01.000Z",
          kind: "tool.call",
          sessionId: "s1",
          turnId: "1",
          id: "c1",
          name: "exec",
        }),
        formatTraceLine({
          t: "2026-08-22T00:00:02.000Z",
          kind: "tool.result",
          sessionId: "s1",
          turnId: "1",
          id: "c1",
          name: "exec",
          ok: false,
          detail: "error TS2304",
        }),
        formatTraceLine({
          t: "2026-08-22T00:00:03.000Z",
          kind: "selfCorrect",
          sessionId: "s1",
          turnId: "1",
          name: "exec",
        }),
        formatTraceLine({
          t: "2026-08-22T00:00:04.000Z",
          kind: "turn.end",
          sessionId: "s1",
          turnId: "1",
          args: { approvals: 0, selfCorrects: 1 },
        }),
      ].join(""),
    );
    const fixture = evalCaseFromTrace(events);
    expect(fixture.prompt).toBe("fix the type error");
    expect(fixture.failed).toBe(true);
    expect(fixture.tools).toEqual([{ name: "exec", ok: false }]);
    expect(fixture.selfCorrects).toBe(1);
    expect(summarizeTrace(events)).toContain("self-corrects");
  });

  it("parses debug log ids and rejects path tricks", () => {
    expect(parseDebugLogId(debugLogId("trace", "s1"))).toEqual({ kind: "trace", key: "s1" });
    expect(parseDebugLogId("guest:vm-1")).toEqual({ kind: "guest", key: "vm-1" });
    expect(parseDebugLogId("trace:../etc/passwd")).toBeUndefined();
    expect(parseDebugLogId("guest:..")).toBeUndefined();
    expect(parseDebugLogId("other:s1")).toBeUndefined();
  });

  it("clips huge write bodies in trace args", () => {
    const html = `<!DOCTYPE html>${"x".repeat(8_000)}`;
    const clipped = redactedTraceArgs({
      path: "/workspace/.locus-variants/direction-1.html",
      streamContent: html,
      token: "gho_secret",
    });
    expect(clipped).not.toHaveProperty("token");
    expect(clipped.path).toBe("/workspace/.locus-variants/direction-1.html");
    expect(typeof clipped.streamContent).toBe("string");
    expect(String(clipped.streamContent).length).toBeLessThanOrEqual(TRACE_ARG_CHARS);
    expect(String(clipped.streamContent)).toContain("…");
  });

  it("pattern-scans tool argument values for known secret formats", () => {
    const redacted = redactedTraceArgs({
      command: "curl -H 'Authorization: Bearer xoxb-123456789012-secret'",
      credential: "should-drop",
    });
    expect(redacted).not.toHaveProperty("credential");
    expect(String(redacted.command)).not.toContain("xoxb-123456789012-secret");
    expect(String(redacted.command)).toContain("••••");
  });
});

describe("parallel tool calls", () => {
  it("runs independent reads including repo_map together", () => {
    expect(toolsRunInParallel(["file_read", "repo_map"])).toBe(true);
    expect(
      toolCallsRunInParallel([
        { name: "file_read", arguments: { path: "a.ts" } },
        { name: "scratchpad", arguments: { action: "read" } },
        { name: "task_list", arguments: { action: "list" } },
      ]),
    ).toBe(true);
    expect(
      toolCallsRunInParallel([
        { name: "file_read", arguments: {} },
        { name: "scratchpad", arguments: { action: "write", content: "x" } },
      ]),
    ).toBe(false);
    expect(
      toolCallsRunInParallel([{ name: "spawn_agent", arguments: { task: "look around" } }]),
    ).toBe(false);
  });
});
