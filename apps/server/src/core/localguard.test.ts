import { describe, expect, it } from "vitest";
import { controlPlaneCorsOrigin, loopbackCorsOrigin } from "./localguard.js";

describe("controlPlaneCorsOrigin", () => {
  it("allows the operator UI origin", () => {
    expect(controlPlaneCorsOrigin("http://127.0.0.1:7420")).toBe("http://127.0.0.1:7420");
    expect(controlPlaneCorsOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    expect(loopbackCorsOrigin("http://127.0.0.1:7420")).toBe("http://127.0.0.1:7420");
  });

  it("does not CORS-reflect the isolated canvas origin", () => {
    expect(controlPlaneCorsOrigin("http://locus-canvas.localhost:7420")).toBeUndefined();
    expect(controlPlaneCorsOrigin("http://locus-canvas.localhost:5173")).toBeUndefined();
  });
});
