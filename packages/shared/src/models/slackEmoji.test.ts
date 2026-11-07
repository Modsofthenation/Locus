import { describe, expect, it } from "vitest";
import {
  applySlackEmoji,
  listSlackReactionNames,
  resolveSlackEmojiMap,
  standardSlackEmoji,
} from "./slackEmoji.js";

describe("slack emoji", () => {
  it("maps common Slack shortcodes to unicode", () => {
    expect(standardSlackEmoji("smile")).toBe("😄");
    expect(standardSlackEmoji("+1")).toBe("👍");
    expect(standardSlackEmoji("thumbsup")).toBe("👍");
    expect(standardSlackEmoji("wave")).toBe("👋");
    expect(listSlackReactionNames({}, "")).toContain("+1");
    expect(
      listSlackReactionNames({ shipit: "https://emoji.slack-edge.com/shipit.png" }, ""),
    ).toContain("shipit");
    expect(listSlackReactionNames({}, "tada")).toContain("tada");
  });

  it("renders unicode, custom images, and leaves unknown names", () => {
    const html = applySlackEmoji("hi :wave: :shipit: :not_a_real_emoji:", {
      shipit: "https://emoji.slack-edge.com/shipit.png",
    });
    expect(html).toContain('title=":wave:"');
    expect(html).toContain("👋");
    expect(html).toContain('src="https://emoji.slack-edge.com/shipit.png"');
    expect(html).toContain(":not_a_real_emoji:");
  });

  it("does not rewrite shortcodes inside code", () => {
    const html = applySlackEmoji("<code>:smile:</code> :smile:");
    expect(html).toContain("<code>:smile:</code>");
    expect(html).toContain('title=":smile:"');
  });

  it("drops javascript emoji urls and resolves aliases", () => {
    const resolved = resolveSlackEmojiMap({
      ok: "alias:thumbsup",
      thumbsup: "https://emoji.slack-edge.com/ok.png",
      bad: "javascript:alert(1)",
    });
    expect(resolved.ok).toBe("https://emoji.slack-edge.com/ok.png");
    expect(resolved.bad).toBeUndefined();
  });
});
