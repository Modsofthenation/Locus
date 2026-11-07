import { describe, expect, it } from "vitest";
import { scoreCodingEval } from "./codingEval.js";

describe("coding eval score", () => {
  it("passes only when tests ran, passed, and the source matches", () => {
    expect(
      scoreCodingEval({
        id: "fix-add",
        testsRan: true,
        testsOk: true,
        source: "return a + b;",
        expectSource: /a \+ b/,
      }),
    ).toMatchObject({ passed: true, reason: "tests passed" });
    expect(
      scoreCodingEval({
        id: "fix-add",
        testsRan: true,
        testsOk: false,
        source: "return a + b;",
        expectSource: /a \+ b/,
      }).reason,
    ).toBe("tests failed");
    expect(
      scoreCodingEval({
        id: "fix-add",
        testsRan: true,
        testsOk: true,
        source: "return a;",
        expectSource: "a + b",
      }).reason,
    ).toBe("source did not match the expected fix");
    expect(scoreCodingEval({ id: "fix-add", testsRan: false, testsOk: false }).reason).toBe(
      "tests did not run",
    );
  });
});
