import { describe, expect, it } from "vitest";
import { decideFleetWake, projectKeepsControlPlane, type FleetWakePull } from "./fleetWake.js";

const pull = (patch: Partial<FleetWakePull> = {}): FleetWakePull => ({
  number: 12,
  state: "open",
  headSha: "abc123",
  checkState: "pending",
  checks: [{ name: "test", status: "in_progress" }],
  comments: [{ id: "c1", author: "ada", body: "looks fine" }],
  ...patch,
});

describe("decideFleetWake", () => {
  it("primes on the first snapshot", () => {
    const decision = decideFleetWake(undefined, pull());
    expect(decision.action).toBe("prime");
    expect(decision.entry.commentIds).toEqual(["c1"]);
    expect(decision.task).toBeUndefined();
  });

  it("spawns once when a check newly fails or a comment arrives", () => {
    const primed = decideFleetWake(undefined, pull());
    const failed = decideFleetWake(
      primed.entry,
      pull({
        checkState: "failure",
        checks: [{ name: "test", status: "failure" }],
        comments: [
          { id: "c1", author: "ada", body: "looks fine" },
          { id: "c2", author: "bea", body: "this races" },
        ],
      }),
    );
    expect(failed.action).toBe("spawn");
    expect(failed.task).toMatch(/Do not merge/);
    expect(failed.task).toMatch(/untrusted-data/);
    expect(failed.task).toMatch(/this races/);
    expect(failed.task).toMatch(/test: failure/);
    const again = decideFleetWake(
      failed.entry,
      pull({
        checkState: "failure",
        checks: [{ name: "test", status: "failure" }],
        comments: [
          { id: "c1", author: "ada", body: "looks fine" },
          { id: "c2", author: "bea", body: "this races" },
        ],
      }),
    );
    expect(again.action).toBe("none");
  });

  it("flags ready when CI transitions to success and does not merge", () => {
    const primed = decideFleetWake(
      undefined,
      pull({ checkState: "failure", checks: [{ name: "test", status: "failure" }] }),
    );
    const ready = decideFleetWake(
      primed.entry,
      pull({
        checkState: "success",
        checks: [{ name: "test", status: "success" }],
        headSha: "def456",
      }),
    );
    expect(ready.action).toBe("ready");
    expect(ready.reason).toMatch(/Approve git_pr_merge/);
    expect(ready.reason).not.toMatch(/merged/);
    const repeat = decideFleetWake(
      ready.entry,
      pull({
        checkState: "success",
        checks: [{ name: "test", status: "success" }],
        headSha: "def456",
      }),
    );
    expect(repeat.action).toBe("none");
  });

  it("does not treat an already-green first snapshot as ready", () => {
    const decision = decideFleetWake(
      undefined,
      pull({ checkState: "success", checks: [{ name: "test", status: "success" }] }),
    );
    expect(decision.action).toBe("prime");
  });
});

describe("projectKeepsControlPlane", () => {
  it("keeps the process only for an active keep-alive project", () => {
    expect(projectKeepsControlPlane([{ keepAlive: true }])).toBe(true);
    expect(projectKeepsControlPlane([{ keepAlive: true, paused: true }])).toBe(false);
    expect(projectKeepsControlPlane([{ keepAlive: true, archived: true }])).toBe(false);
    expect(projectKeepsControlPlane([{ paused: false }])).toBe(false);
  });
});
