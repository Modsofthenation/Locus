import { describe, expect, it } from "vitest";
import { fileMentionQuery, fileMentions, insertFileMention } from "./fileMention.js";

describe("fileMentions", () => {
  it("extracts workspace paths and ignores emails", () => {
    expect(fileMentions("Look at @src/app.ts and @packages/shared/src/compact.ts")).toEqual([
      "src/app.ts",
      "packages/shared/src/compact.ts",
    ]);
    expect(fileMentions("ping a@b.com then @README.md")).toEqual(["README.md"]);
    expect(fileMentions("no mentions here")).toEqual([]);
  });
});

describe("fileMentionQuery", () => {
  it("reads the @query at the caret", () => {
    expect(fileMentionQuery("see @src/ap", 11)).toEqual({ start: 4, query: "src/ap" });
    expect(fileMentionQuery("see @src/app.ts please", 22)).toBeNull();
    expect(fileMentionQuery("a@b.com", 7)).toBeNull();
    expect(fileMentionQuery("hello ", 6)).toBeNull();
    expect(fileMentionQuery("@", 0)).toEqual({ start: 0, query: "" });
    expect(fileMentionQuery("@No", 0)).toEqual({ start: 0, query: "No" });
  });
});

describe("insertFileMention", () => {
  it("replaces the in-progress @query", () => {
    expect(insertFileMention("see @src", 8, "src/app.ts")).toEqual({
      text: "see @src/app.ts ",
      cursor: 16,
    });
    expect(insertFileMention("@src", 0, "src/app.ts")).toEqual({
      text: "@src/app.ts ",
      cursor: 12,
    });
  });
});
