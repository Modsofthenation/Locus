import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Select } from "./Select";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Select", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the selected label and emits onChange from the menu", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let value = "guided";
    function App() {
      return (
        <Select
          ariaLabel="Autonomy"
          value={value}
          options={[
            { value: "guided", label: "Guided", hint: "Ask before push" },
            { value: "supervised", label: "Supervised", hint: "Show every mutating command" },
          ]}
          onChange={(next) => {
            value = next;
          }}
        />
      );
    }
    act(() => {
      root.render(<App />);
    });
    expect(host.querySelector(".ui-select-value")?.textContent).toBe("Guided");
    act(() => {
      host.querySelector("summary")?.click();
    });
    const supervised = [...host.querySelectorAll("[role='menuitem']")].find((row) =>
      row.textContent?.includes("Supervised"),
    );
    expect(supervised?.textContent).toContain("Show every mutating command");
    act(() => {
      supervised?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(value).toBe("supervised");
  });

  it("exposes the value on the trigger and moves with arrow keys", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Select
          ariaLabel="Autonomy"
          value="guided"
          options={[
            { value: "guided", label: "Guided" },
            { value: "supervised", label: "Supervised" },
            { value: "autonomous", label: "Autonomous" },
          ]}
          onChange={() => undefined}
        />,
      );
    });
    const trigger = host.querySelector('[aria-label="Autonomy"]') as HTMLElement;
    expect(trigger.closest("[data-value]")?.getAttribute("data-value")).toBe("guided");
    act(() => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement?.getAttribute("data-value")).toBe("guided");
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement?.getAttribute("data-value")).toBe("supervised");
  });
});
