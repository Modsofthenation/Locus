import { describe, expect, it } from "vitest";
import {
  formatDesignComment,
  parseDesignComment,
  pickSelector,
  replaceElementText,
} from "./models/designComment.js";

describe("design comments", () => {
  it("builds a selector and a structured event body", () => {
    expect(pickSelector({ tag: "H1", id: "", className: "hero title" })).toBe("h1.hero");
    expect(pickSelector({ tag: "button", id: "save", className: "" })).toBe("button#save");
    const comment = parseDesignComment({
      selector: "h1.hero",
      text: "Hello",
      viewport: "tablet",
    });
    expect(comment).toEqual({ selector: "h1.hero", text: "Hello", viewport: "tablet" });
    expect(formatDesignComment(comment!)).toContain("selector: h1.hero");
    expect(formatDesignComment(comment!, "preview")).toContain("Preview comment on the live app");
    expect(parseDesignComment({ selector: "h1", viewport: "wide" })).toBeUndefined();
  });

  it("replaces the inner text of a simple selector", () => {
    const html = `<body><h1 class="hero">Old</h1><p>Keep</p></body>`;
    expect(replaceElementText(html, "h1.hero", "Hello & hi")).toContain("Hello &amp; hi");
    expect(replaceElementText(html, "h1.hero", "Hello & hi")).toContain("<p>Keep</p>");
    expect(replaceElementText(html, "div.missing", "x")).toBeUndefined();
  });

  it("matches a class token, not a hyphenated prefix, and accepts unquoted attrs", () => {
    expect(replaceElementText(`<button class="btn-primary">Go</button>`, "button.btn", "X")).toBe(
      undefined,
    );
    expect(replaceElementText(`<button class="btn primary">Go</button>`, "button.btn", "X")).toBe(
      `<button class="btn primary">X</button>`,
    );
    expect(replaceElementText(`<h1 id=hero>Hi</h1>`, "h1#hero", "X")).toBe(`<h1 id=hero>X</h1>`);
    expect(replaceElementText(`<h1 class=hero>Hi</h1>`, "h1.hero", "X")).toBe(
      `<h1 class=hero>X</h1>`,
    );
  });

  it("refuses to flatten nested markup", () => {
    const html = `<div class="card"><h1>Title</h1><p>Body</p></div>`;
    expect(replaceElementText(html, "div.card", "Hello")).toBeUndefined();
    expect(replaceElementText(html, ".card", "Hello")).toBeUndefined();
    expect(replaceElementText(html, "h1", "Hello")).toContain("<h1>Hello</h1>");
    expect(replaceElementText(html, "h1", "Hello")).toContain("<p>Body</p>");
  });
});
