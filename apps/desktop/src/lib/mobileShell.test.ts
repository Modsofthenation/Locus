import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, ToolCall } from "@locus/shared";
import { clearPhoneAuth, initPhoneAuth } from "./phoneAuth";
import {
  bindMobileViewport,
  canvasFitScale,
  clipOnWords,
  compactRelativeTime,
  groupMobileRows,
  initUiShell,
  lastChatSnippet,
  mobileDesigns,
  mobileGames,
  mobileAssets,
  mobileIdeWorkspaces,
  mobileSessions,
  pendingApprovals,
  resolveUiShell,
  sessionMetaLine,
  sessionNeedsYou,
  sessionShowsBrowser,
  sessionShowsVnc,
  sessionStatusLabel,
  UI_SHELL_KEY,
} from "./mobileShell";

afterEach(() => {
  clearPhoneAuth();
  sessionStorage.clear();
});

const call = (partial: Partial<ToolCall> = {}): ToolCall => ({
  id: "c1",
  name: "git_push",
  arguments: { branch: "main" },
  startedAt: "t",
  approval: "needed",
  ...partial,
});

const session = (partial: Partial<AgentSession> = {}): AgentSession => ({
  id: "s1",
  title: "Nightly",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  ...partial,
});

function memoryStore() {
  const storage = new Map<string, string>();
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  };
}

describe("resolveUiShell", () => {
  it("uses the pairing token for the mobile shell", () => {
    expect(resolveUiShell({ token: "ph_secret" })).toBe("mobile");
    expect(resolveUiShell({ token: undefined })).toBe("desktop");
  });

  it("lets an explicit shell override win over the pairing token", () => {
    const storage = new Map<string, string>([[UI_SHELL_KEY, "desktop"]]);
    expect(
      resolveUiShell({
        token: "ph_secret",
        storage: { getItem: (key) => storage.get(key) ?? null },
      }),
    ).toBe("desktop");
  });

  it("reads the stored shell from sessionStorage by default", () => {
    sessionStorage.setItem(UI_SHELL_KEY, "desktop");
    expect(resolveUiShell({ token: "ph_secret" })).toBe("desktop");
  });

  it("consumes ?shell= from the URL and persists it", () => {
    const storage = memoryStore();
    const replaceState = vi.fn();
    const shell = initUiShell(
      { pathname: "/", search: "?shell=mobile&tab=chats", hash: "" },
      { replaceState },
      storage,
    );
    expect(shell).toBe("mobile");
    expect(storage.getItem(UI_SHELL_KEY)).toBe("mobile");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/?tab=chats");
  });

  it("pairs a phone token into mobile when no shell query is set", () => {
    const storage = memoryStore();
    initPhoneAuth(
      { pathname: "/", search: "?token=ph_secret", hash: "" },
      { replaceState: vi.fn() },
      storage,
    );
    expect(
      initUiShell({ pathname: "/", search: "", hash: "" }, { replaceState: vi.fn() }, storage),
    ).toBe("mobile");
  });
});

describe("mobile session helpers", () => {
  it("hides archived and design sessions from the phone list", () => {
    const rows = mobileSessions([
      session({ id: "a" }),
      session({ id: "b", archived: true }),
      session({ id: "d", kind: "design", title: "Canvas" }),
      session({ id: "g", kind: "game", title: "Arcade" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("hides IDE workspaces from the phone agent list", () => {
    const rows = mobileSessions([
      session({ id: "a" }),
      session({ id: "ide", kind: "ide", title: "App" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["a"]);
    expect(
      mobileIdeWorkspaces([session({ id: "ide", kind: "ide", title: "App" })]).map((row) => row.id),
    ).toEqual(["ide"]);
  });

  it("hides project coordinators from the phone agent list", () => {
    const rows = mobileSessions([
      session({ id: "a" }),
      session({ id: "p", kind: "project", title: "Auth" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("lists unarchived design canvases for the Design tab", () => {
    const rows = mobileDesigns([
      session({ id: "a" }),
      session({ id: "b", archived: true, kind: "design", title: "Old" }),
      session({ id: "d", kind: "design", title: "Canvas" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["d"]);
  });

  it("lists unarchived game canvases for More → Games", () => {
    const rows = mobileGames([
      session({ id: "a" }),
      session({ id: "b", archived: true, kind: "game", title: "Old" }),
      session({ id: "g", kind: "game", title: "Arcade" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["g"]);
  });

  it("lists unarchived asset studios for More → Assets", () => {
    const rows = mobileAssets([
      session({ id: "a" }),
      session({ id: "b", archived: true, kind: "assets", title: "Old" }),
      session({ id: "as", kind: "assets", title: "Hero" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["as"]);
  });

  it("offers Browser watch on Docker coding guests only", () => {
    expect(sessionShowsBrowser(session({ runtime: "docker" }))).toBe(true);
    expect(sessionShowsBrowser(session({ runtime: "host" }))).toBe(false);
    expect(sessionShowsBrowser(session({ runtime: "docker", kind: "design" }))).toBe(false);
    expect(sessionShowsBrowser(session({ runtime: "docker", kind: "game" }))).toBe(false);
    expect(sessionShowsBrowser(session({ runtime: "docker", kind: "assets" }))).toBe(false);
  });

  it("offers view-only VNC on QEMU guests with a vmId", () => {
    expect(sessionShowsVnc(session({ runtime: "vm", vmId: "vm1" }))).toBe(true);
    expect(sessionShowsVnc(session({ runtime: "vm" }))).toBe(false);
    expect(sessionShowsVnc(session({ runtime: "docker", vmId: "c1" }))).toBe(false);
  });

  it("collects pending approvals once per tool call", () => {
    const needed = call();
    const rows = pendingApprovals([
      session({
        messages: [
          {
            id: "m1",
            role: "assistant",
            content: "",
            createdAt: "t",
            toolCalls: [needed, { ...needed, id: "c2", approval: "approved", finishedAt: "t" }],
          },
          {
            id: "m2",
            role: "tool",
            content: "",
            createdAt: "t",
            toolCallId: "c1",
            toolCalls: [needed],
          },
        ],
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.call.id).toBe("c1");
    expect(rows[0]?.title).toBe("Nightly");
  });

  it("labels a session that is waiting on the operator", () => {
    const row = session({
      status: "running",
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "",
          createdAt: "t",
          toolCalls: [call()],
        },
      ],
    });
    expect(sessionNeedsYou(row)).toBe(true);
    expect(sessionStatusLabel(row)).toBe("Needs you");
    expect(lastChatSnippet(row)).toBe("No messages yet");
    expect(sessionNeedsYou(session({ needsHuman: "Protected branch main" }))).toBe(true);
    expect(sessionStatusLabel(session({ needsHuman: "Protected branch main" }))).toBe("Needs you");
  });

  it("summarizes the last visible chat line", () => {
    expect(
      lastChatSnippet(
        session({
          messages: [
            { id: "u", role: "user", content: "  Ship the fix  ", createdAt: "t" },
            { id: "a", role: "assistant", content: "On it.", createdAt: "t" },
          ],
        }),
      ),
    ).toBe("Ship the fix");
  });

  it("hides review verdict JSON from the mobile snippet", () => {
    expect(
      lastChatSnippet(
        session({
          messages: [
            {
              id: "a",
              role: "assistant",
              content: 'On it.{"verdict":"FAIL","reasons":["stale rows"],"risk":"low"}',
              createdAt: "t",
            },
          ],
        }),
      ),
    ).toBe("On it.");
  });

  it("clips snippets on a word boundary", () => {
    const words = Array.from({ length: 40 }, (_, i) => `diagram${i}`).join(" ");
    const snippet = lastChatSnippet(
      session({
        messages: [{ id: "a", role: "assistant", content: words, createdAt: "t" }],
      }),
    );
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toMatch(/diagram\d+…$/);
    expect(snippet.length).toBeLessThanOrEqual(97);
  });

  it("puts project and runtime on a quiet meta line", () => {
    expect(
      sessionMetaLine(
        session({
          runtime: "docker",
          repo: { forge: "github", url: "https://github.com/acme/widgets.git" },
        }),
      ),
    ).toEqual({
      text: "widgets / docker",
      waiting: false,
    });
    expect(clipOnWords("Looking through the codebase for existing helpers", 24)).toBe(
      "Looking through the…",
    );
    expect(compactRelativeTime(new Date(Date.now() - 2 * 3600_000).toISOString())).toBe("2h");
  });
});

describe("bindMobileViewport", () => {
  it("writes the visual viewport into CSS variables so the tab bar stays on screen", () => {
    const props: Record<string, string> = {};
    const target = {
      setProperty: (name: string, value: string) => {
        props[name] = value;
      },
      removeProperty: (name: string) => {
        delete props[name];
        return "";
      },
    };
    const listeners = new Map<string, () => void>();
    const viewport = {
      height: 640.4,
      offsetTop: 12.2,
      addEventListener: (type: "resize" | "scroll", listener: () => void) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: "resize" | "scroll") => {
        listeners.delete(type);
      },
    };
    const stop = bindMobileViewport(target, viewport, () => 800);
    expect(props["--mobile-vh"]).toBe("640px");
    expect(props["--mobile-vt"]).toBe("12px");
    viewport.height = 500;
    viewport.offsetTop = 0;
    listeners.get("resize")?.();
    expect(props["--mobile-vh"]).toBe("500px");
    expect(props["--mobile-vt"]).toBe("0px");
    stop();
    expect(props["--mobile-vh"]).toBeUndefined();
    expect(props["--mobile-vt"]).toBeUndefined();
  });
});

describe("phone shell CSS", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../styles/phone.css"),
    "utf8",
  );

  it("keeps the chat list from pushing the tab bar off screen", () => {
    expect(css).toMatch(
      /\.mobile-shell \{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto/,
    );
    expect(css).toMatch(/\.mobile-shell \{[\s\S]*?height:\s*var\(--mobile-vh/);
    expect(css).toMatch(/\.mobile-body \{[\s\S]*?overflow:\s*auto/);
    expect(css).toMatch(/\.mobile-tabbar \{[\s\S]*?grid-template-columns:\s*repeat\(6,/);
  });

  it("keeps phone thread markdown inside the viewport width", () => {
    expect(css).toMatch(/\.mobile-shell \{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.mobile-screen \{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.mobile-msg \{[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/\.mobile-msg \{[\s\S]*?max-width:\s*100%/);
    expect(css).toMatch(/\.mobile-bubble \{[\s\S]*?overflow-wrap:\s*anywhere/);
    expect(css).toMatch(
      /\.mobile-bubble pre,\s*\.mobile-bubble \.md-code \{[\s\S]*?white-space:\s*pre-wrap/,
    );
    expect(css).toMatch(/\.mobile-fit \{[\s\S]*?overflow-x:\s*hidden/);
    expect(css).toMatch(/\.mobile-bubble \.md-table \{[\s\S]*?table-layout:\s*fixed/);
    expect(css).toMatch(/\.mobile-chat-tabs \{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/\.mobile-composer\.is-thread \{[\s\S]*?flex-direction:\s*column/);
    expect(css).toMatch(/\.mobile-screen \.patch-ln \{[\s\S]*?display:\s*none/);
    expect(css).toMatch(
      /\.mobile-send-as button \{[\s\S]*?background:\s*color-mix\(in srgb, var\(--text\) 16%/,
    );
    expect(css).toMatch(/\.mobile-composer\.is-slack \{[\s\S]*?flex-direction:\s*column/);
    expect(css).toMatch(/\.mobile-composer\.is-slack \{[\s\S]*?gap:\s*var\(--space-3\)/);
    expect(css).toMatch(/\.mobile-composer\.is-slack \.mobile-send-as \{[\s\S]*?flex:\s*none/);
  });

  it("fills the phone viewport without a shell scrollbar gutter", () => {
    expect(css).toMatch(/html\[data-shell="mobile"\][\s\S]*?overflow-x:\s*clip/);
    expect(css).toMatch(/\.mobile-shell \{[^}]*\bwidth:\s*100%;/);
    expect(css).toMatch(/\.mobile-shell \{[^}]*\boverflow:\s*hidden;/);
    expect(css).toMatch(/\.mobile-screen \{[^}]*\boverflow:\s*hidden;/);
    expect(css).not.toMatch(/\.mobile-shell \{[^}]*max-width:\s*100%;/);
  });

  it("styles phone thoughts and tool calls as distinct compact rows", () => {
    expect(css).toMatch(/\.mobile-msg \.thinking-trace \{[\s\S]*?border-left:\s*2px solid/);
    expect(css).toMatch(
      /\.mobile-msg \.thinking-trace-body \{[\s\S]*?font-family:\s*var\(--font\)/,
    );
    expect(css).toMatch(/\.mobile-tool \{[\s\S]*?flex-direction:\s*column/);
    expect(css).toMatch(/\.mobile-tool-name \{[\s\S]*?text-transform:\s*uppercase/);
    expect(css).toMatch(/\.mobile-working \{[\s\S]*?font-style:\s*italic/);
    expect(css).toMatch(/\.mobile-working-label \{[\s\S]*?text-transform:\s*none/);
    expect(css).toMatch(/\.mobile-msg \.thinking-trace > summary \{[\s\S]*?text-transform:\s*none/);
  });

  it("places list row copy in the flexible main track so inbox rows fill the phone", () => {
    expect(css).toMatch(/\.mobile-row \{[\s\S]*?grid-template-areas:\s*"main"/);
    expect(css).toMatch(
      /\.mobile-row:has\(\.mobile-status-dot\),\s*\.mobile-row:has\(\.mobile-avatar\),\s*\.mobile-row\.is-design \{[\s\S]*?grid-template-areas:\s*"mark main extra"/,
    );
    expect(css).toMatch(/\.mobile-row-main \{[\s\S]*?grid-area:\s*main/);
    expect(css).toMatch(/\.mobile-status-dot \{[\s\S]*?grid-area:\s*mark/);
    expect(css).toMatch(/\.mobile-row \{[\s\S]*?min-height:\s*56px/);
  });
});

describe("groupMobileRows", () => {
  it("keeps incoming order within a day instead of sorting by updatedAt", () => {
    const now = new Date(2026, 8, 9, 15, 0, 0);
    const todayMorning = new Date(2026, 8, 9, 9, 0, 0).toISOString();
    const todayNoon = new Date(2026, 8, 9, 12, 0, 0).toISOString();
    const yesterday = new Date(2026, 8, 8, 18, 0, 0).toISOString();
    const groups = groupMobileRows(
      [
        { id: "prompted-first", updatedAt: todayNoon },
        { id: "prompted-second", updatedAt: todayMorning },
        { id: "older", updatedAt: yesterday },
      ],
      "calendar",
      now,
    );
    expect(groups.map((g) => [g.label, g.items.map((s) => s.id)])).toEqual([
      ["TODAY", ["prompted-first", "prompted-second"]],
      ["8 SEP", ["older"]],
    ]);
  });

  it("still puts Today above older days when the first row is from yesterday", () => {
    const now = new Date(2026, 8, 9, 15, 0, 0);
    const groups = groupMobileRows(
      [
        { id: "yday", updatedAt: new Date(2026, 8, 8, 18, 0, 0).toISOString() },
        { id: "today", updatedAt: new Date(2026, 8, 9, 9, 0, 0).toISOString() },
      ],
      "calendar",
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["TODAY", "8 SEP"]);
  });
});

describe("canvasFitScale", () => {
  it("stays at 1 when content already fits", () => {
    expect(canvasFitScale(390, 390)).toBe(1);
    expect(canvasFitScale(390, 200)).toBe(1);
    expect(canvasFitScale(0, 800)).toBe(1);
  });

  it("zooms out until wide content fits, and never below the floor", () => {
    expect(canvasFitScale(390, 600)).toBeCloseTo(0.65);
    expect(canvasFitScale(390, 2000)).toBe(0.55);
    expect(canvasFitScale(390, 2000, 0.4)).toBe(0.4);
  });
});
