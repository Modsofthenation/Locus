import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CloneProgressCard, ImageBuildCard } from "./CloneProgressCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CloneProgressCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(node);
    });
  }

  it("shows the percent, git-native phase detail, and that the agent is waiting", () => {
    render(
      <CloneProgressCard
        title="Cloning https://github.com/acme/demo.git into the guest at /workspace"
        progress={{
          percent: 36,
          phase: "Receiving objects",
          phasePercent: 45,
          received: 90,
          total: 200,
          size: "1.20 MiB",
          rate: "800.00 KiB/s",
        }}
      />,
    );
    const card = host.querySelector("[data-testid=clone-progress]");
    expect(card?.textContent).toContain("36%");
    expect(card?.textContent).toContain("Receiving objects 45%");
    expect(card?.textContent).toContain("90/200");
    expect(card?.textContent).toContain("800.00 KiB/s");
    expect(card?.textContent).toMatch(/waiting for this clone/i);
    expect(card?.getAttribute("data-waiting")).toBe("true");
    expect(card?.getAttribute("aria-label")).toMatch(/36%/);
    expect(card?.getAttribute("aria-label")).toMatch(/waiting for this clone/i);
    expect(host.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("36");
  });

  it("waits without a value when still at 0%", () => {
    render(
      <CloneProgressCard
        title="Cloning https://github.com/acme/demo.git into the guest at /workspace"
        progress={{ percent: 0, phase: "Starting" }}
      />,
    );
    expect(host.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBeNull();
    expect(host.querySelector(".clone-card-bar")?.className).toContain("is-wait");
    expect(host.querySelector("[data-testid=clone-progress]")?.textContent).toMatch(
      /waiting for this clone/i,
    );
  });
});

describe("ImageBuildCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(node);
    });
  }

  it("shows the docker step and that the agent is waiting on the image", () => {
    render(
      <ImageBuildCard
        title="Building locus/agent:0.1 (git, Node, Chromium/Xvfb, ffmpeg, code-server)…"
        progress={{ percent: 30, phase: "RUN apt-get update", step: 2, total: 6 }}
      />,
    );
    const card = host.querySelector("[data-testid=image-build-progress]");
    expect(card?.textContent).toContain("30%");
    expect(card?.textContent).toContain("RUN apt-get update · 2/6");
    expect(card?.textContent).toMatch(/waiting for this image build/i);
    expect(card?.getAttribute("data-waiting")).toBe("true");
    expect(host.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("30");
  });
});
