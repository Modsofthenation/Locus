import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

type Message = Record<string, unknown>;
type Result = { ok: boolean; output: string };

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("uses document-scoped refs, invokes once and verifies semantic form actions", () => {
  document.body.innerHTML = '<input aria-label="Name"><button>Save</button>';
  const button = document.querySelector("button")!;
  const input = document.querySelector("input")!;
  const clicked = vi.fn();
  button.addEventListener("click", clicked);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    left: 0,
    top: 0,
    right: 100,
    bottom: 20,
    toJSON: () => ({}),
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => button });
  let handler!: (message: Message, sender: unknown, respond: (result: Result) => void) => void;
  const source = readFileSync(
    resolve(import.meta.dirname, "../../../chrome-extension/content.js"),
    "utf8",
  );
  new Function("chrome", "crypto", source)(
    {
      runtime: {
        onMessage: {
          addListener: (fn: typeof handler) => {
            handler = fn;
          },
        },
      },
    },
    { randomUUID },
  );
  const call = (message: Message): Result => {
    let result!: Result;
    handler(message, {}, (r) => {
      result = r;
    });
    return result;
  };
  const first = call({ type: "snapshot" });
  const ref = first.output
    .split("\n")
    .find((line) => line.includes('button "Save"'))!
    .split(" ")[0]!;
  expect(call({ type: "click", ref }).ok).toBe(true);
  expect(clicked).toHaveBeenCalledTimes(1);
  const second = call({ type: "snapshot" });
  expect(call({ type: "click", ref }).ok).toBe(false);
  const fieldRef = second.output
    .split("\n")
    .find((line) => line.includes('textbox "Name"'))!
    .split(" ")[0]!;
  expect(call({ type: "action", ref: fieldRef, action: "fill", value: "世界" }).ok).toBe(true);
  expect(input.value).toBe("世界");
  input.remove();
  expect(call({ type: "action", ref: fieldRef, action: "fill", value: "stale" }).ok).toBe(false);
});
