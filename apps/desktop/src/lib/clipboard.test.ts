import { describe, expect, it } from "vitest";
import { pullGuestClipboard, pushGuestClipboard } from "./clipboard";

describe("guest clipboard", () => {
  it("copies guest text onto the host", async () => {
    let host = "";
    const n = await pullGuestClipboard(
      async (name) => {
        expect(name).toBe("clipboard_get");
        return { ok: true, output: "from-guest" };
      },
      async (text) => {
        host = text;
      },
    );
    expect(host).toBe("from-guest");
    expect(n).toBe("from-guest".length);
  });

  it("pastes host text into the guest", async () => {
    let guest = "";
    const n = await pushGuestClipboard(
      async () => "from-host",
      async (name, args) => {
        expect(name).toBe("clipboard_set");
        guest = String(args.text);
        return { ok: true, output: "" };
      },
    );
    expect(guest).toBe("from-host");
    expect(n).toBe("from-host".length);
  });

  it("surfaces tool failures", async () => {
    await expect(
      pullGuestClipboard(
        async () => ({ ok: false, output: "xclip missing" }),
        async () => undefined,
      ),
    ).rejects.toThrow("xclip missing");
    await expect(
      pushGuestClipboard(
        async () => "x",
        async () => ({ ok: false, output: "denied" }),
      ),
    ).rejects.toThrow("denied");
  });
});
