import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, ChatMessage } from "@locus/shared";
import { SELF_CORRECT_NUDGE } from "@locus/shared";
import {
  canExportChat,
  chatExportFileName,
  downloadTextFile,
  exportChatHtml,
  exportSessionChat,
  formatExportStamp,
  printHtmlDocument,
} from "./chatExport";

function session(over: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "Fix login",
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    runtime: "docker",
    dockerImage: "locus/agent",
    providerId: "p",
    model: "grok-4",
    status: "idle",
    messages: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:01.000Z",
    ...over,
  };
}

function msg(over: Partial<ChatMessage> & Pick<ChatMessage, "role" | "content">): ChatMessage {
  return {
    id: over.id ?? `${over.role}-${over.content.slice(0, 8)}`,
    createdAt: over.createdAt ?? "2020-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("chatExportFileName", () => {
  it("sanitizes titles and falls back", () => {
    expect(chatExportFileName("Fix login / auth", "html")).toBe("Fix-login-auth.html");
    expect(chatExportFileName("???", "pdf")).toBe("chat.pdf");
  });
});

describe("formatExportStamp", () => {
  it("formats UTC instants", () => {
    expect(formatExportStamp("2020-01-01T00:00:00.000Z")).toBe("2020-01-01 00:00:00 UTC");
  });
});

describe("canExportChat", () => {
  it("ignores hidden nudges and empty threads", () => {
    expect(canExportChat([])).toBe(false);
    expect(canExportChat([msg({ role: "system", content: SELF_CORRECT_NUDGE })])).toBe(false);
    expect(canExportChat([msg({ role: "user", content: "hi" })])).toBe(true);
  });
});

describe("exportChatHtml", () => {
  it("renders a self-contained transcript with markdown, tools, and extras", () => {
    const html = exportChatHtml(
      session({
        messages: [
          msg({
            id: "u1",
            role: "user",
            content: "Please **fix** login",
            steer: true,
            attachments: [
              { name: "notes.md", mime: "text/markdown", bytes: 12, storedName: "notes.md" },
            ],
          }),
          msg({
            id: "a1",
            role: "assistant",
            content: "Looking at `src/login.ts`.",
            thinking: "Check the auth middleware first.",
            createdAt: "2020-01-01T00:00:01.000Z",
            toolCalls: [
              {
                id: "t1",
                name: "exec",
                arguments: { command: "npm test" },
                result: "ok\n(exit 0)",
                startedAt: "2020-01-01T00:00:01.000Z",
                finishedAt: "2020-01-01T00:00:02.000Z",
              },
            ],
            screenshotName: "fail.png",
            artifactName: "report.pdf",
          }),
          msg({ id: "hide", role: "system", content: SELF_CORRECT_NUDGE }),
          msg({
            id: "blank",
            role: "assistant",
            content: "   ",
            createdAt: "2020-01-01T00:00:03.000Z",
          }),
        ],
      }),
      { exportedAt: "2026-08-26T12:00:00.000Z" },
    );
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Fix login</title>");
    expect(html).toContain("grok-4 · locus/agent");
    expect(html).toContain("Exported 2026-08-26 12:00:00 UTC");
    expect(html).toContain("<strong>fix</strong>");
    expect(html).toContain("<code>src/login.ts</code>");
    expect(html).toContain("Thought");
    expect(html).toContain("Check the auth middleware first.");
    expect(html).toContain("Steer");
    expect(html).toContain("exec · npm test");
    expect(html).toContain("Attached · notes.md");
    expect(html).toContain("Screenshot · fail.png");
    expect(html).toContain("Artifact · report.pdf");
    expect(html).not.toContain(SELF_CORRECT_NUDGE);
    expect(html.match(/class="msg assistant"/g)?.length).toBe(1);
  });

  it("omits thought traces from a Swarm chat export", () => {
    const html = exportChatHtml(
      session({
        surface: "swarm",
        messages: [
          msg({
            id: "a1",
            role: "assistant",
            content: "I'll gather the sources.",
            thinking: "Search INDEX.md then summarize.",
          }),
        ],
      }),
      { exportedAt: "2026-08-26T12:00:00.000Z" },
    );
    expect(html).toContain("I'll gather the sources.");
    expect(html).not.toContain("Thought");
    expect(html).not.toContain("Search INDEX.md then summarize.");
  });

  it("chips @mentions in exported chat HTML", () => {
    const html = exportChatHtml(
      session({
        surface: "swarm",
        messages: [
          msg({
            id: "u1",
            role: "user",
            content: "Hey @Nova and @everyone",
          }),
        ],
      }),
      { exportedAt: "2026-08-26T12:00:00.000Z" },
    );
    expect(html).toContain('<span class="md-mention">@Nova</span>');
    expect(html).toContain('<span class="md-mention">@everyone</span>');
    expect(html).toContain(".md-mention {");
  });

  it("hides review verdict JSON from exported assistant bubbles", () => {
    const html = exportChatHtml(
      session({
        messages: [
          msg({
            id: "a1",
            role: "assistant",
            content:
              'Posted the hunk note.{"verdict":"FAIL","reasons":["stale rows"],"risk":"low"}',
          }),
        ],
      }),
      { exportedAt: "2026-08-26T12:00:00.000Z" },
    );
    expect(html).toContain("Posted the hunk note.");
    expect(html).not.toContain('"verdict"');
    expect(html).not.toContain("stale rows");
  });

  it("escapes session titles and skips empty chats", () => {
    const html = exportChatHtml(
      session({ title: `A <script>alert(1)</script> chat`, messages: [] }),
      { exportedAt: "2026-08-26T12:00:00.000Z" },
    );
    expect(html).toContain("A &lt;script&gt;alert(1)&lt;/script&gt; chat");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("No messages in this chat.");
  });

  it("omits a blank model from the header", () => {
    const html = exportChatHtml(
      session({
        model: "",
        messages: [msg({ role: "user", content: "hi" })],
      }),
    );
    expect(html).toContain("locus/agent");
    expect(html).not.toMatch(/<p class="meta"> · /);
  });

  it("embeds in-memory screenshots as data URLs", () => {
    const html = exportChatHtml(
      session({
        runtime: "host",
        messages: [
          msg({
            role: "assistant",
            content: "shot",
            screenshotBase64: "AAAA",
            screenshotMime: "image/png",
            screenshotName: "frame.png",
          }),
        ],
      }),
    );
    expect(html).toContain("Host");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("Content-Security-Policy");
  });

  it("does not interpolate unsafe screenshot payloads into img src", () => {
    const html = exportChatHtml(
      session({
        messages: [
          msg({
            role: "assistant",
            content: "shot",
            screenshotBase64: `AAAA" onerror="alert(1)`,
            screenshotMime: `image/png" onerror="alert(1)`,
            screenshotName: `frame.png" onerror="alert(1)`,
          }),
        ],
      }),
    );
    expect(html).not.toMatch(/<img[^>]*\sonerror=/i);
    expect(html).not.toContain(`src="data:`);
    expect(html).toContain("Screenshot · frame.png&quot; onerror=&quot;alert(1)");
  });
});

describe("downloadTextFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("clicks a temporary download link", () => {
    const create = vi.fn(() => "blob:chat");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    downloadTextFile("<html></html>", "Fix-login.html", "text/html;charset=utf-8");
    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:chat");
  });
});

describe("printHtmlDocument", () => {
  it("writes the document and prints", () => {
    const print = vi.fn();
    const focus = vi.fn();
    const addEventListener = vi.fn();
    const write = vi.fn();
    const open = vi.fn();
    const close = vi.fn();
    const iframe = {
      setAttribute: vi.fn(),
      style: { cssText: "" },
      contentWindow: { print, focus, addEventListener },
      contentDocument: { open, write, close },
      remove: vi.fn(),
    };
    const create = vi
      .spyOn(document, "createElement")
      .mockReturnValue(iframe as unknown as HTMLIFrameElement);
    const append = vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
    printHtmlDocument("<html><title>Fix login</title></html>");
    expect(append).toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith("<html><title>Fix login</title></html>");
    expect(print).toHaveBeenCalled();
    create.mockRestore();
    append.mockRestore();
  });
});

describe("exportSessionChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("downloads HTML and prints PDF", () => {
    const create = vi.fn(() => "blob:chat");
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    exportSessionChat(session({ messages: [msg({ role: "user", content: "hi" })] }), "html");
    expect(create).toHaveBeenCalled();

    const print = vi.fn();
    const iframe = {
      setAttribute: vi.fn(),
      style: { cssText: "" },
      contentWindow: { print, focus: vi.fn(), addEventListener: vi.fn() },
      contentDocument: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
      remove: vi.fn(),
    };
    vi.spyOn(document, "createElement").mockReturnValue(iframe as unknown as HTMLIFrameElement);
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
    exportSessionChat(session({ messages: [msg({ role: "user", content: "hi" })] }), "pdf");
    expect(print).toHaveBeenCalled();
  });
});
