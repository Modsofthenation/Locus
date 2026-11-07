import { describe, expect, it } from "vitest";
import { parseDistillerResponse } from "./distiller.js";

describe("brain distiller parse", () => {
  it("parses observation JSON and ignores junk", () => {
    const rows = parseDistillerResponse(
      'Sure.\n{"observations":[{"text":"we never bill from the worker","kind":"gotcha","ambient":true}]}\n',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toMatch(/never bill/);
    expect(rows[0]?.kind).toBe("gotcha");
    expect(parseDistillerResponse("not json")).toEqual([]);
  });
});
