import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { clusterChatThread, type AgentSession, type ChatMessage } from "@locus/shared";
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

function Shell(props: {
  hostChat?: boolean;
  docker?: boolean;
  swarmMode?: boolean;
  messages?: ChatMessage[];
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  const messages = props.messages ?? [];
  return withStore(
    <ChatThread
      threadRef={threadRef}
      onScroll={noop}
      followLatest
      session={{ ...session, messages }}
      clusters={clusterChatThread(messages)}
      messages={messages}
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

  it("renders markdown blocks without empty rows between them and the label on its own line", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
      "utf8",
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Shell
          docker
          messages={[
            {
              id: "a1",
              role: "assistant",
              content: "First paragraph.\n\n## Plan\n\n- one\n- two\n\nLast line.",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ]}
        />,
      );
    });
    const bubble = host.querySelector(".msg.assistant .bubble") as HTMLElement;
    expect(bubble.classList.contains("md-bubble")).toBe(true);
    // Block boundaries are plain newline text nodes; they must not paint as rows.
    expect(css).toMatch(/\.msg \.bubble\.md-bubble \{\s*white-space:\s*normal;/);
    expect(css).toMatch(/\.msg \.bubble\.md-bubble \.md-plain \{\s*white-space:\s*pre-wrap;/);
    const who = host.querySelector(".msg.assistant .who") as HTMLElement;
    expect(who.nextElementSibling).toBe(bubble);
    expect(css).toMatch(/\.msg \.who \{[\s\S]*?width:\s*100%;[\s\S]*?min-height:\s*24px;/);
  });
});
