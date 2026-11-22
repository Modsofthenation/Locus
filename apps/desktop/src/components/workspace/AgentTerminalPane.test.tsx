import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTerminalStatus } from "@locus/shared";
import { AgentTerminalPane } from "./AgentTerminalPane";

const status = vi.fn<(id: string) => Promise<AgentTerminalStatus>>();
const closeTerminal = vi.fn(async (_id: string, _terminalId: string) => ({
  ok: true,
  closed: true,
}));

vi.mock("@/lib/api", () => ({
  api: {
    agentTerminals: (id: string) => status(id),
    closeAgentTerminal: (id: string, terminalId: string) => closeTerminal(id, terminalId),
  },
  agentTerminalWsUrl: (sessionId: string, terminalId: string, command?: string) =>
    `ws://127.0.0.1/ws/sessions/${sessionId}/terminal?terminal=${terminalId}&command=${command ?? ""}`,
  workspaceTerminalWsUrl: () => "ws://127.0.0.1/ws/workspace-terminal/s1",
}));

/** The xterm wiring is WorkspaceTerminal's (see its test); here a stub opens the socket. */
vi.mock("./WorkspaceTerminal", async () => {
  const { useEffect } = await import("react");
  return {
    WorkspaceTerminal: (props: {
      url?: string;
      active?: boolean;
      onClose?: (event: { code: number; reason: string }) => void;
    }) => {
      const { url, onClose } = props;
      useEffect(() => {
        const ws = new WebSocket(url ?? "");
        (ws as unknown as FakeWebSocket).onclose = (ev) => onClose?.(ev);
        return () => ws.close();
      }, [url, onClose]);
      return <div data-testid="workspace-terminal" data-active={props.active ? "1" : "0"} />;
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sockets: FakeWebSocket[] = [];

class FakeWebSocket {
  binaryType = "arraybuffer";
  readyState = 1;
  onclose?: (ev: { code: number; reason: string }) => void;
  closed = false;
  constructor(readonly url: string) {
    sockets.push(this);
  }
  send() {}
  close() {
    this.closed = true;
  }
}

function running(ids: string[]): AgentTerminalStatus {
  return {
    available: true,
    defaultPreset: "claude",
    terminals: ids.map((id) => ({
      id,
      label: "Codex",
      command: "codex",
      startedAt: "2026-11-13T00:00:00.000Z",
    })),
  };
}

describe("AgentTerminalPane", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;
  const previousWs = globalThis.WebSocket;

  beforeEach(() => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    const current = root;
    if (current) act(() => current.unmount());
    host?.remove();
    sockets.length = 0;
    status.mockReset();
    closeTerminal.mockClear();
    globalThis.WebSocket = previousWs;
    host = undefined;
    root = undefined;
  });

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function render() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<AgentTerminalPane sessionId="s1" />);
    });
    await flush();
  }

  function button(label: string): HTMLButtonElement {
    const found = host!.querySelector(`button[aria-label='${label}']`);
    if (!found) throw new Error(`no ${label}`);
    return found as HTMLButtonElement;
  }

  it("explains why a runtime has no terminal", async () => {
    status.mockResolvedValue({
      available: false,
      reason: "Terminal mode is not available for VM sessions.",
      defaultPreset: "shell",
      terminals: [],
    });
    await render();
    expect(host!.textContent).toContain("Terminal not available.");
    expect(host!.textContent).toContain("VM sessions");
    expect(sockets).toHaveLength(0);
  });

  it("starts the provider's CLI when nothing is running", async () => {
    status.mockResolvedValue(running([]));
    await render();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toMatch(/\/ws\/sessions\/s1\/terminal\?terminal=t\w+&command=claude$/);
    expect(host!.querySelector("[role='tab']")?.textContent).toBe("Claude Code");
  });

  it("reattaches to terminals that are still running", async () => {
    status.mockResolvedValue(running(["a", "b"]));
    await render();
    expect(sockets.map((ws) => ws.url)).toEqual([
      "ws://127.0.0.1/ws/sessions/s1/terminal?terminal=a&command=codex",
      "ws://127.0.0.1/ws/sessions/s1/terminal?terminal=b&command=codex",
    ]);
    expect(host!.querySelectorAll("[role='tab']")).toHaveLength(2);
  });

  it("caps new terminals at four", async () => {
    status.mockResolvedValue(running(["a", "b", "c"]));
    await render();
    expect(button("New terminal").disabled).toBe(false);
    act(() => button("New terminal").click());
    await flush();
    expect(host!.querySelectorAll("[role='tab']")).toHaveLength(4);
    expect(sockets.at(-1)!.url).toMatch(/command=claude$/);
    expect(button("New terminal").disabled).toBe(true);
  });

  it("closes the active terminal on the server", async () => {
    status.mockResolvedValue(running(["a", "b"]));
    await render();
    act(() => button("Close terminal").click());
    await flush();
    expect(closeTerminal).toHaveBeenCalledWith("s1", "a");
    expect(host!.querySelectorAll("[role='tab']")).toHaveLength(1);
    expect(sockets[0]!.closed).toBe(true);
  });

  it("restarts by killing the process and reconnecting", async () => {
    status.mockResolvedValue(running(["a"]));
    await render();
    act(() => button("Restart terminal").click());
    await flush();
    expect(closeTerminal).toHaveBeenCalledWith("s1", "a");
    expect(sockets).toHaveLength(2);
    expect(sockets[0]!.closed).toBe(true);
    // The picker defaults to the provider preset, so Restart switches this tab to it.
    expect(sockets[1]!.url).toMatch(/terminal=a&command=claude$/);
  });

  it("marks a tab ended when the process exits", async () => {
    status.mockResolvedValue(running(["a"]));
    await render();
    act(() => sockets[0]!.onclose?.({ code: 1000, reason: "exited" }));
    expect(host!.querySelector("[role='tab']")?.textContent).toBe("Codex · ended");
  });

  it("only takes keys in the active tab while the pane is visible", async () => {
    status.mockResolvedValue(running(["a", "b"]));
    await render();
    const panes = [...host!.querySelectorAll("[data-testid='workspace-terminal']")];
    expect(panes.map((el) => el.getAttribute("data-active"))).toEqual(["1", "0"]);
    act(() => {
      root!.render(<AgentTerminalPane sessionId="s1" visible={false} />);
    });
    expect(host!.querySelector("[data-active='1']")).toBeNull();
  });
});
