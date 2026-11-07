import { describe, expect, it } from "vitest";
import { parseDuckDuckGoHtml, parseDuckDuckGoLite, runWebSearch, unwrapUrl } from "./websearch.js";

const HTML = `
<div class="result results_links web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fqemu.org%2Fdocs">QEMU docs</a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fqemu.org%2Fdocs">Official QEMU documentation</a>
</div>
<div class="result results_links web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="https://example.com/guide">A guide</a>
  </h2>
  <div class="result__snippet">How to run guests</div>
</div>
`;

const LITE = `
<tr>
  <td>
    <a class="result-link" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org">Node.js</a>
  </td>
  <td class="result-snippet">JavaScript runtime</td>
</tr>
`;

describe("websearch", () => {
  it("unwraps DuckDuckGo redirect URLs and drops DDG hosts", () => {
    expect(unwrapUrl("https://duckduckgo.com/l/?uddg=https%3A%2F%2Fqemu.org%2Fdocs")).toBe(
      "https://qemu.org/docs",
    );
    expect(unwrapUrl("https://html.duckduckgo.com/html/")).toBeUndefined();
    expect(unwrapUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("parses html.duckduckgo.com result cards", () => {
    const hits = parseDuckDuckGoHtml(HTML, 8);
    expect(hits).toEqual([
      { title: "QEMU docs", url: "https://qemu.org/docs", snippet: "Official QEMU documentation" },
      { title: "A guide", url: "https://example.com/guide", snippet: "How to run guests" },
    ]);
  });

  it("parses lite.duckduckgo.com result rows", () => {
    expect(parseDuckDuckGoLite(LITE, 3)).toEqual([
      { title: "Node.js", url: "https://nodejs.org/", snippet: "JavaScript runtime" },
    ]);
  });

  it("ignores generic https nav links when DDG markup is missing", () => {
    const html = `
      <a href="https://spreadprivacy.com">Privacy</a>
      <a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fqemu.org">QEMU</a>
    `;
    expect(parseDuckDuckGoHtml(html, 8)).toEqual([
      { title: "QEMU", url: "https://qemu.org/", snippet: undefined },
    ]);
  });

  it("requires a query", async () => {
    const result = await runWebSearch("   ");
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/query is required/);
  });

  it("falls through HTML, lite, instant answer, then Wikipedia", async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("html.duckduckgo.com"))
        return new Response("no results here", { status: 200 });
      if (url.includes("lite.duckduckgo.com"))
        return new Response("still nothing", { status: 200 });
      if (url.includes("api.duckduckgo.com")) {
        return new Response(
          JSON.stringify({
            Heading: "QEMU",
            AbstractText: "A machine emulator.",
            AbstractURL: "https://www.qemu.org/",
            RelatedTopics: [{ FirstURL: "https://wiki.qemu.org/", Text: "QEMU wiki - docs" }],
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    const result = await runWebSearch("qemu", { fetchFn, maxResults: 2 });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Web search: qemu");
    expect(result.output).toContain("<untrusted-data");
    expect(result.output).toContain("https://www.qemu.org/");
    expect(result.output).toContain("https://wiki.qemu.org/");
    expect(calls.some((url) => url.includes("html.duckduckgo.com"))).toBe(true);
    expect(calls.some((url) => url.includes("en.wikipedia.org"))).toBe(false);
  });

  it("uses Wikipedia when DuckDuckGo returns nothing", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("wikipedia.org")) {
        return new Response(
          JSON.stringify(["qemu", ["QEMU"], ["Emulator"], ["https://en.wikipedia.org/wiki/QEMU"]]),
          {
            status: 200,
          },
        );
      }
      return new Response("{}", { status: 200 });
    };
    const result = await runWebSearch("qemu", { fetchFn });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("https://en.wikipedia.org/wiki/QEMU");
    expect(result.output).toContain("<untrusted-data");
    expect(result.output).toContain("Emulator");
  });

  it("ignores fetches to hosts outside the search allowlist", async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("evil.example")) throw new Error("should not fetch");
      return new Response("{}", { status: 200 });
    };
    const result = await runWebSearch("qemu", { fetchFn });
    expect(result.ok).toBe(false);
  });
});
