import { describe, expect, it } from "vitest";
import { formatKv, formatTable, shortId, truncate } from "./format.js";

describe("format", () => {
  it("pads a table", () => {
    const text = formatTable(
      [
        { id: "a", name: "one" },
        { id: "bb", name: "two" },
      ],
      [
        { key: "id", header: "ID", value: (row) => row.id },
        { key: "name", header: "NAME", value: (row) => row.name },
      ],
    );
    expect(text).toContain("ID");
    expect(text).toContain("one");
    expect(text.split("\n")).toHaveLength(4);
  });

  it("returns (none) for empty tables", () => {
    expect(formatTable([], [{ key: "id", header: "ID", value: () => "" }])).toBe("(none)");
  });

  it("formats key/value rows", () => {
    expect(
      formatKv([
        ["id", "abc"],
        ["empty", undefined],
      ]),
    ).toBe("id  abc");
  });

  it("shortens ids and titles", () => {
    expect(shortId("abcdefghij")).toBe("abcdefgh");
    expect(truncate("hello world", 8)).toBe("hello w…");
  });
});
