import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlacementToggle } from "./RuntimePicker";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    workersStatus: vi.fn(async () => []),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const workers = [
  { id: "w1", name: "Studio PC", url: "https://192.168.1.8:7421" },
  { id: "w2", name: "Lab", url: "https://10.0.0.4:7421" },
];

describe("PlacementToggle", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("hides Where when no workers are registered", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<PlacementToggle workers={[]} value="" onChange={() => undefined} />);
    });
    expect(host.querySelector(".where-picker")).toBeNull();
    expect(host.textContent).not.toContain("This machine");
  });

  it("shows live and unreachable next to Where hosts", async () => {
    vi.mocked(api.workersStatus).mockResolvedValue([
      { id: "w1", live: true, name: "studio" },
      { id: "w2", live: false, error: "Worker did not respond within 8s" },
    ]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<PlacementToggle workers={workers} value="" onChange={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const studio = host.querySelector('[data-worker-id="w1"]');
    const lab = host.querySelector('[data-worker-id="w2"]');
    expect(studio?.textContent).toContain("Studio PC");
    expect(studio?.textContent).toContain("live");
    expect(lab?.textContent).toContain("unreachable");
  });
});
