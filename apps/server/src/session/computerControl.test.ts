import { expect, it } from "vitest";
import { ComputerControl } from "./computerControl.js";

it("drains current work and rejects queued actions across takeover and handback", async () => {
  const control = new ComputerControl();
  const events: string[] = [];
  let release!: () => void;
  const running = control.run("a", async () => {
    events.push("start");
    await new Promise<void>((r) => {
      release = r;
    });
    events.push("finish");
  });
  await Promise.resolve();
  await Promise.resolve();
  const stale = control.run("a", async () => events.push("stale"));
  const rejected = expect(stale).rejects.toThrow("control changed");
  const takeover = control.handoff("a", async () => events.push("human"));
  release();
  await running;
  await rejected;
  await takeover;
  expect(events).toEqual(["start", "finish", "human"]);
  for (let i = 0; i < 3; i++) control.failed("a", false);
  expect(control.stalled("a")).toBe(true);
  await control.handoff("a", async () => undefined);
  expect(control.stalled("a")).toBe(false);
});
