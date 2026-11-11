import { describe, expect, it } from "vitest";
import { formatMarkdown, prUrlFromToolOutput } from "./markdown";

describe("formatMarkdown", () => {
  it("renders fences, lists, links, and emphasis", () => {
    const html = formatMarkdown(
      "See **docs** at https://example.com/pr/1\n```\nconst x = 1;\n```\n- one\n- two",
    );
    expect(html).toContain("<strong>docs</strong>");
    expect(html).toContain('<a href="https://example.com/pr/1"');
    expect(html).toContain('<pre class="md-code">');
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
  });

  it("renders headings, numbered lists, tables, and highlighted fences", () => {
    const html = formatMarkdown(
      "# Title\n## Sub\n1. first\n2. second\n| File | Risk |\n| --- | --- |\n| a.ts | high |\n```ts\nconst x = 1;\n```",
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<h2>Sub</h2>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain('<table class="md-table">');
    expect(html).toContain("<th>File</th>");
    expect(html).toContain("<td>a.ts</td>");
    expect(html).toContain('data-lang="ts"');
    expect(html).toContain('<span class="tok-kw">const</span>');
    expect(formatMarkdown("Use `a | b` then a list\n- keep")).toContain("<code>a | b</code>");
    expect(formatMarkdown("Use `a | b` then a list\n- keep")).not.toContain("<table");
  });

  it("chips clipboard paste tokens and interpolated attachment paths", () => {
    expect(formatMarkdown("See [[paste:clip.png]] please")).toContain(
      '<span class="md-paste-chip">clip.png</span>',
    );
    expect(
      formatMarkdown("See clip.png at /workspace/.locus-attachments/clip.png please"),
    ).toContain('<span class="md-paste-chip">clip.png</span>');
  });

  it("chips @mentions in chat text and skips emails, paths, and code", () => {
    const html = formatMarkdown("Hey @Nova and @everyone — ping me at a@b.com");
    expect(html).toContain('<span class="md-mention">@Nova</span>');
    expect(html).toContain('<span class="md-mention">@everyone</span>');
    expect(html).toContain("a@b.com");
    expect(html).not.toContain('<span class="md-mention">@b</span>');
    expect(formatMarkdown("See @src/app.ts")).not.toContain("md-mention");
    expect(formatMarkdown("Keep `@Nova` literal")).toContain("<code>@Nova</code>");
    expect(formatMarkdown("Keep `@Nova` literal")).not.toContain("md-mention");
    expect(formatMarkdown("Thanks @Nova.")).toContain('<span class="md-mention">@Nova</span>.');
    expect(formatMarkdown("@Nova,@Bob")).toContain('<span class="md-mention">@Nova</span>');
    expect(formatMarkdown("@Nova,@Bob")).toContain('<span class="md-mention">@Bob</span>');
    expect(formatMarkdown("Ask @The-Builder and @Head-of-staff")).toContain(
      '<span class="md-mention">@The-Builder</span>',
    );
    expect(formatMarkdown("Ask @The-Builder and @Head-of-staff")).toContain(
      '<span class="md-mention">@Head-of-staff</span>',
    );
  });

  it("escapes HTML", () => {
    expect(formatMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
    expect(formatMarkdown('<details onclick="alert(1)">x</details>')).not.toMatch(/<details\b/i);
    expect(formatMarkdown("[x](javascript:alert(1))")).not.toContain('href="javascript:');
    expect(formatMarkdown('<img src="x" onerror="alert(1)">')).not.toMatch(/<img\b/i);
    const img = formatMarkdown('![x" onerror="alert(1)](https://example.com/a.png)');
    expect(img).toContain('alt="x&quot; onerror=&quot;alert(1)"');
    expect(img).not.toContain('onerror="alert');
  });

  it("renders GitHub conversation markdown used by review bots", () => {
    const html = formatMarkdown(
      [
        "> ## Review skipped",
        "> Draft detected.",
        ">",
        "> <details>",
        "> <summary>⚙️ Run configuration</summary>",
        ">",
        "> **Configuration used**: defaults",
        "> **Plan**: Free",
        ">",
        "> </details>",
        ">",
        "> You can disable this status using the `reviews.review_status` in your `.coderabbit.yaml`.",
        ">",
        '> - [ ] <!-- {"checkboxId":"abc"} --> 🔍 Trigger review',
        ">",
        "> ---",
        "> [!NOTE]",
        "> <details>",
        "> <summary>🎁 Summarized by CodeRabbit Free</summary>",
        ">",
        "> Line-by-line reviews need Pro.",
        "> </details>",
      ].join("\n"),
    );
    expect(html).toContain("<h2>Review skipped</h2>");
    expect(html).toContain('class="md-quote"');
    expect(html).not.toContain("&gt; ## Review");
    expect(html).toContain('<details class="md-details">');
    expect(html).toContain("<summary>⚙️ Run configuration</summary>");
    expect(html).toContain("<strong>Configuration used</strong>");
    expect(html).toContain('class="md-task-list"');
    expect(html).toContain("Trigger review");
    expect(html).toContain('<input type="checkbox" disabled>');
    expect(html).not.toContain("checkboxId");
    expect(html).toContain("<hr>");
    expect(html).toMatch(/data-alert="note"[\s\S]*Summarized by CodeRabbit Free/);
    expect(html).toContain("Line-by-line reviews need Pro.");
  });

  it("renders Bitbucket quotes, links, images, and strikethrough", () => {
    const html = formatMarkdown(
      [
        "> On 2026-01-02, **alice** wrote:",
        "> Please ~~drop~~ this hunk.",
        "",
        "Shipped in [PR 4](https://bitbucket.org/acme/app/pull-requests/4).",
        "![diff](https://bitbucket.org/repo/img.png)",
      ].join("\n"),
    );
    expect(html).toContain('class="md-quote"');
    expect(html).toContain("<strong>alice</strong>");
    expect(html).toContain("<del>drop</del>");
    expect(html).toContain('href="https://bitbucket.org/acme/app/pull-requests/4"');
    expect(html).toContain('src="https://bitbucket.org/repo/img.png"');
    expect(html).toContain('alt="diff"');
  });

  it("keeps nested quotes after stripping one level at a time", () => {
    const html = formatMarkdown("> outer\n> > inner");
    expect(html).toMatch(/<blockquote class="md-quote">[\s\S]*<blockquote class="md-quote">/);
    expect(html).toContain("outer");
    expect(html).toContain("inner");
  });

  it("renders a one-line details summary used by GitHub bots", () => {
    const html = formatMarkdown("<details open><summary>Commands</summary>\n`/rebase`\n</details>");
    expect(html).toContain('<details class="md-details" open>');
    expect(html).toContain("<summary>Commands</summary>");
    expect(html).toContain("<code>/rebase</code>");
  });

  it("keeps blank-line-separated numbered items in one list so they count 1–n", () => {
    const html = formatMarkdown(
      [
        "**The five things that actually make people switch**",
        "",
        "1. **It finishes long tasks without you.** Everyone demos well on 10-minute tasks.",
        "",
        "2. **Trust you can scale up gradually.** The killer move is one config.",
        "",
        "3. **Self-correction depth.** When something breaks, does the agent diagnose-and-retry?",
        "",
        "4. **Speed as a feature.** Fast streaming, parallel calls, instant startup.",
        "",
        "5. **Replayability.** Every run reproducible from its trace.",
      ].join("\n"),
    );
    expect(html.match(/<ol>/g)).toEqual(["<ol>"]);
    expect(html.match(/<li>/g)).toHaveLength(5);
    expect(html).toContain("<li><strong>It finishes long tasks without you.</strong>");
    expect(html).toContain("<li><strong>Replayability.</strong>");
    expect(html).not.toContain("</ol>\n<ol>");
  });

  it("still splits numbered lists when a paragraph sits between them", () => {
    const html = formatMarkdown("1. first\n\n2. second\n\nA paragraph.\n\n1. later");
    expect(html.match(/<ol>/g)).toHaveLength(2);
    expect(html).toContain("<li>first</li><li>second</li>");
    expect(html).toContain("<li>later</li>");
    expect(html).toContain("A paragraph.");
  });

  it("renumbers source items that all start at 1 when they belong to one list", () => {
    const html = formatMarkdown("1. alpha\n\n1. beta\n\n1. gamma");
    expect(html).toBe("<ol><li>alpha</li><li>beta</li><li>gamma</li></ol>");
  });

  it("keeps blank-line-separated bullets in one list", () => {
    const html = formatMarkdown("- one\n\n- two\n\n- three");
    expect(html).toBe("<ul><li>one</li><li>two</li><li>three</li></ul>");
  });

  it("renders a badge image inside a link instead of a raw placeholder", () => {
    const html = formatMarkdown("[![CI](https://img.shields.io/ci.svg)](https://x.dev)");
    expect(html).toContain(
      '<a href="https://x.dev" target="_blank" rel="noreferrer"><img class="md-img" src="https://img.shields.io/ci.svg" alt="CI"></a>',
    );
    expect(html).not.toContain("\u0000");
  });
});

describe("prUrlFromToolOutput", () => {
  it("reads GitHub and Bitbucket payloads", () => {
    expect(prUrlFromToolOutput(JSON.stringify({ html_url: "https://github.com/a/b/pull/3" }))).toBe(
      "https://github.com/a/b/pull/3",
    );
    expect(
      prUrlFromToolOutput(
        JSON.stringify({ links: { html: { href: "https://bitbucket.org/a/b/pull-requests/4" } } }),
      ),
    ).toBe("https://bitbucket.org/a/b/pull-requests/4");
    expect(
      prUrlFromToolOutput(JSON.stringify({ web_url: "https://gitlab.com/a/b/-/merge_requests/8" })),
    ).toBe("https://gitlab.com/a/b/-/merge_requests/8");
    expect(
      prUrlFromToolOutput(
        "Opened #12 Fix login (open)\nhttps://gitlab.com/a/b/-/merge_requests/12",
      ),
    ).toBe("https://gitlab.com/a/b/-/merge_requests/12");
  });
});
