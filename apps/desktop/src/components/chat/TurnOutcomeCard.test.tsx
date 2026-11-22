import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TurnOutcome } from "@/lib/turnOutcome";
import { TurnOutcomeCard } from "./TurnOutcomeCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const outcome: TurnOutcome = {
  assistantId: "a1",
  files: [{ path: "src/add.ts", additions: 2, deletions: 1 } as TurnOutcome["files"][number]],
  patches: [],
  commands: 1,
  tests: [{ command: "npm test", passed: true }],
  durationMs: 75_000,
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function render(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
});

describe("TurnOutcomeCard", () => {
  it("shows tokens, cost and time for the turn", () => {
    const el = render(
      <TurnOutcomeCard
        sessionId="s1"
        outcome={outcome}
        usageText="2,200 in · 80 out · $0.01"
        onOpenPath={() => undefined}
        onContinue={() => undefined}
      />,
    );
    expect(el.querySelector("[data-testid=turn-outcome-usage]")?.textContent).toBe(
      "2,200 in · 80 out · $0.01 · 1m 15s",
    );
  });

  it("offers Merge only when given a merge action, and reports failures", async () => {
    const plain = render(
      <TurnOutcomeCard
        sessionId="s1"
        outcome={outcome}
        onOpenPath={() => undefined}
        onContinue={() => undefined}
      />,
    );
    expect([...plain.querySelectorAll("button")].some((b) => b.textContent === "Merge")).toBe(
      false,
    );
    act(() => root?.unmount());
    plain.remove();

    const onMerge = vi.fn().mockRejectedValue(new Error("Merge conflict in src/add.ts"));
    const el = render(
      <TurnOutcomeCard
        sessionId="s1"
        outcome={outcome}
        onOpenPath={() => undefined}
        onContinue={() => undefined}
        onMerge={onMerge}
      />,
    );
    const merge = [...el.querySelectorAll("button")].find((b) => b.textContent === "Merge")!;
    await act(async () => {
      merge.click();
    });
    expect(onMerge).toHaveBeenCalledOnce();
    expect(el.querySelector("[role=alert]")?.textContent).toBe("Merge conflict in src/add.ts");
  });
});
