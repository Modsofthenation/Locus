import { describe, expect, it } from "vitest";
import { indexOfHtmlMarkup, isHtmlMarkupIndex, stripHtmlComments } from "./models/htmlMarkup.js";

describe("html markup scan", () => {
  it("treats a real </head> as markup and ignores one inside a script string", () => {
    const html = `<html><head><script>const s="</head>";</script></head><body></body></html>`;
    const at = indexOfHtmlMarkup(html, /<\/head>/i);
    expect(at).toBe(html.toLowerCase().lastIndexOf("</head>"));
    expect(isHtmlMarkupIndex(html, html.indexOf("</head>"))).toBe(false);
    expect(isHtmlMarkupIndex(html, html.toLowerCase().lastIndexOf("</head>"))).toBe(true);
  });

  it("strips markup comments but keeps comments inside a script", () => {
    const html = `<html><!-- <script> --><body><script>const x="<!-- keep -->";</script></body></html>`;
    const stripped = stripHtmlComments(html);
    expect(stripped).not.toContain("<!-- <script> -->");
    expect(stripped).toContain("<!-- keep -->");
  });
});
