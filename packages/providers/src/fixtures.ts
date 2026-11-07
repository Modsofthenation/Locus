import type { AiProvider, ChatMessage, GuestOs } from "@locus/shared";
import type { ChatTurnOptions } from "./loop.js";

/**
 * Recorded OpenAI-compatible / OpenCode stream quirks.
 * Add a fixture here when a new model edge case shows up instead of a one-off hotfix.
 */
export interface StreamFixture {
  id: string;
  /** The model / provider behavior this pins. */
  quirk: string;
  providerKind?: AiProvider["kind"];
  baseUrl?: string;
  model?: string;
  guestOs?: GuestOs;
  messages?: ChatMessage[];
  /** One HTTP response per attempt. Objects are JSON SSE payloads; strings are raw `data:` lines. */
  attempts: Array<{
    frames?: Array<string | Record<string, unknown>>;
    json?: Record<string, unknown>;
  }>;
  loop?: Pick<ChatTurnOptions, "idleMs" | "timeoutMs" | "delaysMs">;
  expect: {
    text?: string;
    toolCalls?: Array<{ id?: string; name: string; arguments: Record<string, unknown> }>;
    error?: "unknown_stop";
    retryable?: boolean;
    calls?: number;
    maxTokens?: number | null;
    activity?: boolean;
    reasoning?: string[];
    openaiAssistantCount?: number;
  };
}

const USER: ChatMessage = { id: "1", role: "user", content: "hi", createdAt: "" };
const DESIGN: ChatMessage = { id: "1", role: "user", content: "design it", createdAt: "" };
const OPENCODE = {
  providerKind: "opencode" as const,
  baseUrl: "https://opencode.ai/zen/v1",
  model: "x-preview-f-free",
};

export const STREAM_FIXTURES: StreamFixture[] = [
  {
    id: "openai-text-deltas",
    quirk: "Standard OpenAI content deltas assemble in order",
    attempts: [
      {
        frames: [
          { choices: [{ delta: { content: "Hel" } }] },
          { choices: [{ delta: { content: "lo" } }] },
          "[DONE]",
        ],
      },
    ],
    expect: { text: "Hello", maxTokens: null },
  },
  {
    id: "opencode-default-completion-budget",
    quirk: "OpenCode remote streams send a 32k max_tokens completion budget",
    ...OPENCODE,
    attempts: [{ frames: [{ choices: [{ delta: { content: "ok" } }] }, "[DONE]"] }],
    expect: { text: "ok", maxTokens: 32_768 },
  },
  {
    id: "opencode-loop-completion-budget",
    quirk: "runChatTurn forwards the OpenCode completion budget onto the engine request",
    ...OPENCODE,
    loop: { delaysMs: [], idleMs: 0 },
    attempts: [{ frames: [{ choices: [{ delta: { content: "ok" } }] }, "[DONE]"] }],
    expect: { text: "ok", maxTokens: 32_768 },
  },
  {
    id: "opencode-reasoning-then-text",
    quirk: "OpenCode reasoning_content is activity, not assistant text",
    ...OPENCODE,
    attempts: [
      {
        frames: [
          { choices: [{ delta: { role: "assistant", reasoning_content: "think" } }] },
          { choices: [{ delta: { content: "PONG" } }] },
          "[DONE]",
        ],
      },
    ],
    expect: { text: "PONG", activity: true },
  },
  {
    id: "opencode-empty-unknown-stop",
    quirk: "Ox Alpha empty finish_reason unknown is incomplete, not a finished turn",
    ...OPENCODE,
    attempts: [
      {
        frames: [
          { choices: [{ delta: { role: "assistant", reasoning_content: "think" } }] },
          {
            choices: [{ delta: {}, finish_reason: "unknown" }],
            usage: { prompt_tokens: 12, completion_tokens: 0 },
          },
          "[DONE]",
        ],
      },
    ],
    expect: { error: "unknown_stop", retryable: true, text: "", activity: true },
  },
  {
    id: "opencode-empty-unknown-then-text",
    quirk: "Empty unknown finish retries as a JSON completion, then replies",
    ...OPENCODE,
    loop: { delaysMs: [0], idleMs: 0 },
    attempts: [
      {
        frames: [
          { choices: [{ delta: { reasoning_content: "think" } }] },
          {
            choices: [{ message: { role: "assistant", content: null }, finish_reason: "unknown" }],
          },
          "[DONE]",
        ],
      },
      {
        json: {
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        },
      },
    ],
    expect: { text: "ok", calls: 2 },
  },
  {
    id: "opencode-unknown-with-text",
    quirk: "GLM-style unknown stop that already produced text is kept",
    ...OPENCODE,
    attempts: [
      {
        frames: [
          { choices: [{ delta: { content: "done" } }] },
          { choices: [{ delta: {}, finishReason: "unknown" }] },
          "[DONE]",
        ],
      },
    ],
    expect: { text: "done" },
  },
  {
    id: "opencode-unknown-with-tool",
    quirk: "Unknown finish after an assembled tool call is kept",
    ...OPENCODE,
    guestOs: "ubuntu",
    messages: [DESIGN],
    attempts: [
      {
        frames: [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      id: "call_1",
                      function: { name: "exec", arguments: '{"command":"ls"}' },
                    },
                  ],
                },
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: "unknown" }] },
          "[DONE]",
        ],
      },
    ],
    expect: { toolCalls: [{ id: "call_1", name: "exec", arguments: { command: "ls" } }] },
  },
  {
    id: "opencode-message-tool-calls-after-reasoning",
    quirk: "Final message.tool_calls after reasoning_content still assemble",
    ...OPENCODE,
    guestOs: "ubuntu",
    messages: [DESIGN],
    attempts: [
      {
        frames: [
          { choices: [{ delta: { role: "assistant", reasoning_content: "plan the page" } }] },
          {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      function: {
                        name: "file_write",
                        arguments: { path: "/workspace/index.html", content: "<html>Hi</html>" },
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
          "[DONE]",
        ],
      },
    ],
    expect: {
      toolCalls: [
        {
          id: "call_1",
          name: "file_write",
          arguments: { path: "/workspace/index.html", content: "<html>Hi</html>" },
        },
      ],
    },
  },
  {
    id: "opencode-object-tool-args",
    quirk: "Object-shaped tool arguments after reasoning still assemble",
    ...OPENCODE,
    guestOs: "ubuntu",
    messages: [DESIGN],
    attempts: [
      {
        frames: [
          { choices: [{ delta: { reasoning_content: "write it" } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      id: "call_1",
                      function: {
                        name: "file_write",
                        arguments: { path: "/workspace/index.html", content: "<html>Hi</html>" },
                      },
                    },
                  ],
                },
              },
            ],
          },
          "[DONE]",
        ],
      },
    ],
    expect: {
      toolCalls: [
        {
          id: "call_1",
          name: "file_write",
          arguments: { path: "/workspace/index.html", content: "<html>Hi</html>" },
        },
      ],
    },
  },
  {
    id: "opencode-tool-calls-without-index",
    quirk: "tool_calls that omit index still assemble onto slot 0",
    ...OPENCODE,
    guestOs: "ubuntu",
    messages: [DESIGN],
    attempts: [
      {
        frames: [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      id: "call_1",
                      function: {
                        name: "file_write",
                        arguments: '{"path":"/workspace/index.html",',
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ function: { arguments: '"content":"<html>Hi</html>"}' } }],
                },
              },
            ],
          },
          "[DONE]",
        ],
      },
    ],
    expect: {
      toolCalls: [
        {
          id: "call_1",
          name: "file_write",
          arguments: { path: "/workspace/index.html", content: "<html>Hi</html>" },
        },
      ],
    },
  },
  {
    id: "openai-malformed-sse-skipped",
    quirk: "A malformed SSE frame is skipped instead of aborting the turn",
    attempts: [
      {
        frames: ["{not-json", { choices: [{ delta: { content: "ok" } }] }, "[DONE]"],
      },
    ],
    expect: { text: "ok" },
  },
  {
    id: "openai-content-parts",
    quirk: "Content-part arrays join into visible text",
    attempts: [
      {
        frames: [
          {
            choices: [
              {
                delta: {
                  content: [
                    { type: "text", text: "Hel" },
                    { type: "text", text: "lo" },
                  ],
                },
              },
            ],
          },
          "[DONE]",
        ],
      },
    ],
    expect: { text: "Hello" },
  },
  {
    id: "local-openai-no-completion-budget",
    quirk: "Local OpenAI-compatible servers do not get a default max_tokens cap",
    providerKind: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2",
    attempts: [{ frames: [{ choices: [{ delta: { content: "x" } }] }, "[DONE]"] }],
    expect: { text: "x", maxTokens: null },
  },
  {
    id: "blank-assistant-placeholder-dropped",
    quirk: "Blank assistant placeholders are omitted so the user prompt still reaches the model",
    messages: [
      { id: "u", role: "user", content: "Design a one-pager", createdAt: "" },
      { id: "a", role: "assistant", content: "", createdAt: "" },
    ],
    attempts: [{ frames: [{ choices: [{ delta: { content: "ok" } }] }, "[DONE]"] }],
    expect: { text: "ok", openaiAssistantCount: 0 },
  },
  {
    id: "anthropic-default-completion-budget",
    quirk: "Anthropic streams send a 4096 max_tokens completion budget",
    providerKind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
    attempts: [
      {
        frames: [
          { type: "content_block_delta", delta: { type: "text_delta", text: "Hey" } },
          { type: "message_stop" },
        ],
      },
    ],
    expect: { text: "Hey", maxTokens: 4096 },
  },
  {
    id: "opencode-reasoning-only-eof",
    quirk: "Reasoning-only SSE that ends with no finish_reason is incomplete",
    ...OPENCODE,
    attempts: [
      {
        frames: [
          { choices: [{ delta: { role: "assistant", reasoning_content: "plan it" } }] },
          "[DONE]",
        ],
      },
    ],
    expect: { error: "unknown_stop", retryable: true, text: "", activity: true },
  },
  {
    id: "opencode-empty-stop",
    quirk: "Empty finish_reason stop with no text or tools is incomplete",
    ...OPENCODE,
    attempts: [
      {
        frames: [{ choices: [{ delta: {}, finish_reason: "stop" }] }, "[DONE]"],
      },
    ],
    expect: { error: "unknown_stop", retryable: true, text: "" },
  },
  {
    id: "opencode-truncated-file-write",
    quirk: "Truncated file_write JSON still recovers path and content",
    ...OPENCODE,
    guestOs: "ubuntu",
    messages: [DESIGN],
    attempts: [
      {
        frames: [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      id: "call_1",
                      function: {
                        name: "file_write",
                        arguments:
                          '{"path":"/workspace/index.html","content":"<!doctype html><html>Hi</html>"',
                      },
                    },
                  ],
                },
              },
            ],
          },
          "[DONE]",
        ],
      },
    ],
    expect: {
      toolCalls: [
        {
          id: "call_1",
          name: "file_write",
          arguments: {
            path: "/workspace/index.html",
            content: "<!doctype html><html>Hi</html>",
          },
        },
      ],
    },
  },
  {
    id: "ollama-think-tags-then-text",
    quirk: "Ollama / DeepSeek-R1 <think> wrappers are reasoning, not assistant text",
    providerKind: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "deepseek-r1",
    attempts: [
      {
        frames: [
          { choices: [{ delta: { content: "<thi" } }] },
          { choices: [{ delta: { content: "nk>plan the fix" } }] },
          { choices: [{ delta: { content: "</think>PONG" } }] },
          "[DONE]",
        ],
      },
    ],
    expect: { text: "PONG", activity: true, reasoning: ["plan the fix"] },
  },
  {
    id: "ollama-thinking-field-then-text",
    quirk: "Ollama delta.thinking is reasoning, not assistant text",
    providerKind: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3",
    attempts: [
      {
        frames: [
          { choices: [{ delta: { thinking: "consider tools" } }] },
          { choices: [{ delta: { content: "ok" } }] },
          "[DONE]",
        ],
      },
    ],
    expect: { text: "ok", activity: true, reasoning: ["consider tools"] },
  },
];

export const DEFAULT_FIXTURE_MESSAGES: ChatMessage[] = [USER];
