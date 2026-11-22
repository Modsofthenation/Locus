import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { visualDifference } from "./visualReview.js";

describe("visual review pixel differences", () => {
  it("keeps an unchanged snapshot clear and highlights changed pixels", () => {
    const before = new PNG({ width: 4, height: 4 });
    before.data.fill(255);
    const after = new PNG({ width: 4, height: 4 });
    after.data.fill(255);
    after.data[0] = 0;
    after.data[1] = 0;
    after.data[2] = 0;
    const original = PNG.sync.write(before);
    expect(visualDifference(original, original).percentage).toBe(0);
    const diff = visualDifference(original, PNG.sync.write(after));
    expect(diff.percentage).toBe(6.25);
    expect([...PNG.sync.read(diff.highlight).data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  });
});
