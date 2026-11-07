import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Automation } from "@locus/shared";
import {
  decideWebhook,
  hmacValid,
  locusWebhookAuthorized,
  parseWebhookPayload,
} from "./automationWebhook.js";

function item(partial: Partial<Automation> = {}): Automation {
  return {
    id: "a1",
    name: "Hook",
    enabled: true,
    prompt: "review",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    schedule: { kind: "webhook" },
    ...partial,
  } as Automation;
}

describe("decideWebhook", () => {
  it("queues a generic webhook and skips Slack retries via last event id", () => {
    const raw = JSON.stringify({
      event_id: "ev1",
      type: "event_callback",
      event: { type: "message" },
    });
    const first = decideWebhook({ item: item(), raw });
    expect(first.kind).toBe("queue");
    if (first.kind !== "queue") return;
    expect(first.trigger).toBe("webhook");
    const skip = decideWebhook({
      item: item({ lastWebhookEventId: first.eventId }),
      raw,
    });
    expect(skip.kind).toBe("skip");
  });

  it("queues forge push and skips deleted refs", () => {
    const queued = decideWebhook({
      item: item({
        schedule: { kind: "forge" },
        repo: { forge: "github", url: "https://github.com/acme/app" },
      }),
      raw: JSON.stringify({
        ref: "refs/heads/main",
        after: "abc123",
        repository: { html_url: "https://github.com/acme/app" },
      }),
      headerEvent: "push",
    });
    expect(queued).toMatchObject({ kind: "queue", trigger: "forge", sha: "abc123" });
    if (queued.kind === "queue") {
      expect(queued.event?.text).toMatch(/push abc123/);
    }
    expect(
      decideWebhook({
        item: item({ schedule: { kind: "forge" } }),
        raw: JSON.stringify({ deleted: true, after: "0000000000000000000000000000000000000000" }),
        headerEvent: "push",
      }).kind,
    ).toBe("skip");
  });

  it("rejects a repo mismatch", () => {
    const decision = decideWebhook({
      item: item({
        schedule: { kind: "forge" },
        repo: { forge: "github", url: "https://github.com/acme/app" },
      }),
      raw: JSON.stringify({
        repository: { html_url: "https://github.com/other/app" },
        after: "abc",
      }),
      headerEvent: "push",
    });
    expect(decision).toEqual({
      kind: "reject",
      message: "Webhook repository does not match this automation",
    });
  });
});

describe("locusWebhookAuthorized", () => {
  it("accepts matching hmac", () => {
    const secret = "s3cret";
    const raw = "{}";
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(hmacValid(secret, raw, signature)).toBe(true);
    expect(locusWebhookAuthorized(secret, { raw, signature }, true)).toBe(true);
    expect(locusWebhookAuthorized(secret, { raw, signature: "sha256=nope" }, true)).toBe(false);
  });
});

describe("parseWebhookPayload", () => {
  it("reads Bitbucket push changes", () => {
    expect(
      parseWebhookPayload(
        JSON.stringify({
          push: { changes: [{ new: { name: "main", target: { hash: "def" } } }] },
          repository: { links: { html: { href: "https://bitbucket.org/acme/app" } } },
        }),
      ),
    ).toEqual({
      repoUrl: "https://bitbucket.org/acme/app",
      ref: "main",
      sha: "def",
      deleted: false,
    });
  });
});
