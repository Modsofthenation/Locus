import { act, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "@locus/shared";
import { ChatThread } from "./ChatThread";
import { Store, initialState } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = {
  id: "s1",
  title: "Fix login",
  os: "ubuntu" as const,
  templateId: "ubuntu-24.04",
  providerId: "p1",
  model: "gpt-4.1",
  status: "idle" as const,
  vmId: "v1",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
} as AgentSession;

const noop = () => undefined;

function withStore(node: ReactNode) {
  return (
    <Store.Provider value={{ state: initialState, dispatch: () => undefined }}>
      {node}
    </Store.Provider>
  );
}

function Shell(props: { hostChat?: boolean; docker?: boolean; swarmMode?: boolean }) {
  const threadRef = useRef<HTMLDivElement>(null);
  return withStore(
    <ChatThread
      threadRef={threadRef}
      onScroll={noop}
      followLatest
      session={session}
      clusters={[]}
      messages={[]}
      viewing={null}
      swarmMode={Boolean(props.swarmMode)}
      thoughtTraces={false}
      hideLifecycleIds={new Set()}
      findHits={[]}
      turnDiffs={new Map()}
      waitingGuest={false}
      waitingStartNote={false}
      showTailWorking={false}
      workingLabel="Thinking"
      thinkingSnippet=""
      turning={false}
      teamMembers={[]}
      hostChat={Boolean(props.hostChat)}
      docker={Boolean(props.docker)}
      onOpenPath={noop}
      onOpenSubagent={noop}
      onEditLast={noop}
      onRetryLast={noop}
      onCopyText={noop}
      onRemoveSubscription={noop}
    />,
  );
}

describe("ChatThread", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the host empty hint", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<Shell hostChat />);
    });
    expect(host.querySelector(".chat-empty-hint")?.textContent).toContain(
      "read and edit files on this machine",
    );
  });

  it("shows the container empty hint", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<Shell docker />);
    });
    expect(host.querySelector(".chat-empty-hint")?.textContent).toContain("runs in a container");
  });
});
