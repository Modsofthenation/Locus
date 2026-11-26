import { describe, expect, it, vi } from "vitest";
import type { ChatEvent, CompleteRequest } from "@locus/providers";
import { customThemeContrastIssues } from "@locus/shared";
import { defaultConfig } from "../defaults.js";
import { generateCustomTheme } from "./themeGenerate.js";

function configWithKey() {
  const config = defaultConfig("/data");
  const provider = config.providers.find((p) => p.kind === "openai") ?? config.providers[0]!;
  return {
    ...config,
    providers: [
      {
        ...provider,
        id: "p1",
        kind: "openai" as const,
        enabled: true,
        apiKey: "sk-test",
        baseUrl: "https://api.openai.com/v1",
        models: ["gpt-test"],
        defaultModel: "gpt-test",
      },
    ],
  };
}

function reply(text: string) {
  return vi.fn(async function* (_req: CompleteRequest): AsyncGenerator<ChatEvent> {
    yield { type: "text", text };
  });
}

describe("generateCustomTheme", () => {
  it("turns model JSON into a normalized, readable theme", async () => {
    const complete = reply(
      '```json\n{"name":"Neon Rain","scheme":"dark","colors":{"bg":"#05060a","text":"#2a2a2a","accent":"#ff2a6d"},"layout":{"background":"grid","radius":99}}\n```',
    );
    const result = await generateCustomTheme({
      config: configWithKey(),
      prompt: "rainy cyberpunk night",
      complete,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.id).toBe("custom-neon-rain");
    expect(result.theme.origin).toBe("ai");
    expect(result.theme.layout).toEqual({ background: "grid", radius: 32 });
    expect(customThemeContrastIssues(result.theme.colors)).toEqual([]);
    const req = complete.mock.calls[0]![0];
    expect(req.allowedTools).toEqual([]);
    expect(req.messages[0]!.content).toContain("rainy cyberpunk night");
  });

  it("sends the current theme without its local image when refining", async () => {
    const complete = reply('{"name":"Warmer","colors":{"bg":"#201010"}}');
    await generateCustomTheme({
      config: configWithKey(),
      prompt: "warmer",
      current: { name: "Cold", colors: { bg: "#001020" }, backdrop: "data:image/png;base64,local" },
      complete,
    });
    const request = complete.mock.calls[0]![0].messages[0]!.content;
    expect(request).toContain('"Cold"');
    expect(request).not.toContain("data:image/png");
  });

  it("explains missing providers, empty prompts and junk replies", async () => {
    const noKey = { ...defaultConfig("/data"), providers: [] };
    expect(await generateCustomTheme({ config: noKey, prompt: "x" })).toMatchObject({
      ok: false,
      status: 503,
    });
    expect(await generateCustomTheme({ config: configWithKey(), prompt: "  " })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      await generateCustomTheme({
        config: configWithKey(),
        prompt: "x",
        complete: reply("I cannot do that."),
      }),
    ).toMatchObject({ ok: false, status: 422 });
  });

  it("uses the provider and model picked in the composer", async () => {
    const base = configWithKey();
    const second = {
      ...base.providers[0]!,
      id: "p2",
      name: "Second",
      models: ["m-a", "m-b"],
      defaultModel: "m-a",
    };
    const config = { ...base, providers: [...base.providers, second] };
    const complete = reply('{"name":"Picked","colors":{"bg":"#101010"}}');
    const result = await generateCustomTheme({
      config,
      prompt: "x",
      providerId: "p2",
      model: "m-b",
      complete,
    });
    expect(result.ok).toBe(true);
    const req = complete.mock.calls[0]![0];
    expect(req.provider.id).toBe("p2");
    expect(req.model).toBe("m-b");
  });

  it("explains why a picked provider can't generate", async () => {
    const base = configWithKey();
    const off = { ...base.providers[0]!, id: "off", name: "Off", enabled: false };
    const cloud = {
      ...base.providers[0]!,
      id: "cloud",
      name: "Cursor Cloud",
      kind: "cursor" as const,
      baseUrl: "https://api.cursor.com",
    };
    const config = { ...base, providers: [...base.providers, off, cloud] };
    const complete = reply("{}");
    for (const [providerId, pattern] of [
      ["missing", /no longer/],
      ["off", /turned off/],
      ["cloud", /needs a repository/],
    ] as const) {
      const result = await generateCustomTheme({ config, prompt: "x", providerId, complete });
      expect(result).toMatchObject({ ok: false, status: 400 });
      if (!result.ok) expect(result.error).toMatch(pattern);
    }
    expect(complete).not.toHaveBeenCalled();
  });

  it("sends a picked CLI agent through the one-shot path", async () => {
    const base = configWithKey();
    const cli = {
      ...base.providers[0]!,
      id: "codex",
      name: "Codex CLI",
      kind: "codex-cli" as const,
      apiKey: "",
      baseUrl: "codex-cli://local",
      models: ["gpt-5.6-sol"],
      defaultModel: "gpt-5.6-sol",
    };
    const complete = reply('{"name":"Vista","colors":{"bg":"#0b1a2a"}}');
    const result = await generateCustomTheme({
      config: { ...base, providers: [cli] },
      prompt: "windows vista",
      providerId: "codex",
      complete,
    });
    expect(result.ok).toBe(true);
    expect(complete.mock.calls[0]![0].provider.id).toBe("codex");
  });
});
