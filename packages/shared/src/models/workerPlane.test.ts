import { describe, expect, it } from "vitest";
import {
  createWorkerPlaneId,
  guestVisibleToPlane,
  parseWorkerPlaneId,
  WORKER_PLANE_HEADER,
} from "./workerPlane.js";

describe("worker plane ids", () => {
  it("parses ids and treats untagged guests as visible", () => {
    expect(WORKER_PLANE_HEADER).toBe("x-locus-plane");
    expect(parseWorkerPlaneId("plane-12")).toBe("plane-12");
    expect(parseWorkerPlaneId("short")).toBeUndefined();
    expect(createWorkerPlaneId().length).toBeGreaterThanOrEqual(8);
    expect(guestVisibleToPlane({}, "plane-12")).toBe(true);
    expect(guestVisibleToPlane({ planeId: "plane-12" }, "plane-12")).toBe(true);
    expect(guestVisibleToPlane({ planeId: "plane-12" }, "plane-99")).toBe(false);
    expect(guestVisibleToPlane({ planeId: "plane-12" }, undefined)).toBe(false);
  });
});
