import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_CHARS,
  MAX_CHAT_ATTACHMENTS,
  chatAttachmentByteCap,
  chatInputError,
  firstOversizeAttachment,
} from "./chatLimits.js";

describe("chat input limits", () => {
  it("flags long text and too many attachments", () => {
    expect(chatInputError("x")).toBeUndefined();
    expect(chatInputError("x".repeat(MAX_CHAT_CHARS + 1))).toMatch(/too long/);
    expect(chatInputError("x", MAX_CHAT_ATTACHMENTS)).toBeUndefined();
    expect(chatInputError("x", MAX_CHAT_ATTACHMENTS + 1)).toMatch(/At most/);
  });

  it("caps images higher than other files", () => {
    expect(chatAttachmentByteCap("image/png")).toBe(10 * 1024 * 1024);
    expect(chatAttachmentByteCap("application/pdf")).toBe(1_500_000);
    expect(chatAttachmentByteCap(undefined)).toBe(1_500_000);
  });

  it("names the first oversize attachment", () => {
    const big = { name: "shot.png", size: 10 * 1024 * 1024 + 1, type: "image/png" };
    const doc = { name: "notes.pdf", size: 1_500_001, type: "application/pdf" };
    const ok = { name: "a.txt", size: 12, type: "text/plain" };
    expect(firstOversizeAttachment([ok, doc])).toMatch(/notes\.pdf/);
    expect(firstOversizeAttachment([ok, big])).toMatch(/shot\.png/);
    expect(firstOversizeAttachment([ok])).toBeUndefined();
    // Missing size (older File shims) must not false-positive.
    expect(firstOversizeAttachment([{ name: "mystery.bin" }])).toBeUndefined();
  });
});
