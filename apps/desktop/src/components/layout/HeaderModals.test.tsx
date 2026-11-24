import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { ReplayModal } from "@/components/chat/ReplayModal";
import { CompareModal } from "@/components/chat/CompareModal";
import { WorkersModal } from "@/components/settings/WorkersModal";

vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: { config: { providers: [] } }, dispatch: vi.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: AgentSession = {
  id: "sess-1",
  title: "Host chat",
  os: "ubuntu",
  templateId: "host",
  runtime: "host",
  providerId: "p",
  model: "m",
  status: "idle",
  messages: [
    {
      id: "m1",
      role: "assistant",
      content: "ran a tool",
      createdAt: "2020-01-01T00:00:00.000Z",
      toolCalls: [
        { id: "t1", name: "repo_map", arguments: {}, startedAt: "2020-01-01T00:00:00.000Z" },
      ],
    },
  ],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
} as AgentSession;

// The topbar is position: relative with its own z-index, so a modal rendered inside it is
// trapped in that stacking context and shows behind the content panel. Every modal the
// topbar opens must portal to document.body.
describe("modals opened from the topbar", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it.each([
    ["Replay", ReplayModal, "replay-modal-title"],
    ["Compare", CompareModal, "compare-title"],
    ["Workers", WorkersModal, "workers-title"],
  ])("%s renders into document.body, outside the topbar", async (_name, Component, titleId) => {
    host = document.createElement("div");
    host.className = "topbar";
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<Component session={session} onClose={() => undefined} />);
    });
    const dialog = document.querySelector(`[aria-labelledby='${titleId}']`);
    expect(dialog).not.toBeNull();
    expect(dialog!.parentElement!.parentElement).toBe(document.body);
    expect(host.contains(dialog)).toBe(false);
  });
});
