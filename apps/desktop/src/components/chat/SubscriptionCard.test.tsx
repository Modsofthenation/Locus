import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionSubscription } from "@locus/shared";
import { SubscriptionCard, SubscriptionList } from "./SubscriptionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rows: SessionSubscription[] = [
  {
    id: "s1",
    kind: "slack_channel",
    title: "#eng",
    createdAt: "2026-08-29T12:00:00.000Z",
    channelId: "C1",
  },
  {
    id: "t1",
    kind: "timer",
    title: "check CI",
    createdAt: "2026-08-29T12:00:00.000Z",
    name: "check-ci",
    nextFireAt: "2026-08-29T12:05:00.000Z",
  },
];

describe("SubscriptionCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("lists active subscriptions and removes one", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onRemove = vi.fn();
    const node: ReactNode = <SubscriptionCard subscriptions={rows} onRemove={onRemove} />;
    act(() => {
      root.render(node);
    });
    expect(host.querySelector("[data-testid='subscription-card']")?.textContent).toMatch(
      /2 subscriptions/,
    );
    expect(host.textContent).toMatch(/#eng/);
    expect(host.textContent).toMatch(/check CI/);
    act(() => {
      host.querySelector<HTMLButtonElement>("[data-testid='subscription-remove-s1']")?.click();
    });
    expect(onRemove).toHaveBeenCalledWith("s1");
  });

  it("hides when there are no subscriptions", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<SubscriptionCard subscriptions={[]} onRemove={() => undefined} />);
    });
    expect(host.querySelector("[data-testid='subscription-card']")).toBeNull();
  });

  it("shows the empty hint in the settings list", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<SubscriptionList subscriptions={[]} onRemove={() => undefined} />);
    });
    expect(host.querySelector("[data-testid='subscription-empty']")?.textContent).toMatch(
      /Ask this agent to subscribe/,
    );
  });
});
