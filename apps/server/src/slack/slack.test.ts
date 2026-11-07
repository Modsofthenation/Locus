import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { slackSignatureValid } from "./slack.js";

describe("slackSignatureValid", () => {
  it("accepts a fresh Slack signature and rejects a bad one", () => {
    const secret = "signing-secret";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const raw = '{"type":"event_callback"}';
    const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
    expect(slackSignatureValid(secret, timestamp, raw, signature)).toBe(true);
    expect(slackSignatureValid(secret, timestamp, raw, "v0=deadbeef")).toBe(false);
    expect(slackSignatureValid(secret, "1", raw, signature)).toBe(false);
  });
});
