import { describe, expect, it } from "vitest";
import type { AiProvider, LocusConfig } from "@locus/shared";
import {
  loadLastAgent,
  modelsForProvider,
  pickProvider,
  preferredRuntime,
  rememberedRuntime,
  rememberedWorkerId,
  resolveAgentDefaults,
  saveLastAgent,
} from "./lastAgent";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const openai: AiProvider = {
  id: "openai",
  name: "OpenAI",
  kind: "openai",
  baseUrl: "https://api.openai.com/v1",
  models: ["gpt-4.1", "gpt-4.1-mini"],
  defaultModel: "gpt-4.1",
  enabled: false,
  extraHeaders: {},
};

const grok: AiProvider = {
  ...openai,
  id: "grok",
  name: "Grok",
  kind: "xai",
  enabled: true,
  models: ["grok-4"],
  defaultModel: "grok-4",
};

describe("lastAgent", () => {
  it("round-trips prefs and falls back to ubuntu", () => {
    const storage = memory();
    expect(loadLastAgent(storage)).toEqual({
      os: "ubuntu",
      dockerImage: "locus/agent",
    });
    expect(preferredRuntime(loadLastAgent(storage), true)).toBe("docker");
    expect(preferredRuntime(loadLastAgent(storage), false)).toBe("host");
    saveLastAgent(
      {
        os: "debian",
        providerId: "grok",
        model: "grok-4",
        runtime: "docker",
        dockerImage: "node:22-bookworm",
        hostDir: "/tmp/project",
      },
      storage,
    );
    expect(loadLastAgent(storage)).toEqual({
      os: "debian",
      runtime: "docker",
      dockerImage: "node:22-bookworm",
      hostDir: "/tmp/project",
      providerId: "grok",
      model: "grok-4",
    });
    storage.setItem("locus.lastAgent", "{not json");
    expect(loadLastAgent(storage).os).toBe("ubuntu");
    expect(rememberedRuntime({ os: "ubuntu", runtime: "host" })).toBe("host");
    expect(rememberedRuntime({ os: "ubuntu", runtime: "vm" })).toBe("vm");
    expect(rememberedRuntime({ os: "ubuntu" })).toBe("host");
    expect(rememberedRuntime({ os: "ubuntu", runtime: "docker" })).toBe("docker");
    saveLastAgent({ os: "ubuntu", runtime: "host" }, storage);
    expect(loadLastAgent(storage).runtime).toBe("host");
    saveLastAgent(
      { os: "ubuntu", runtime: "docker", placement: "worker", backendId: "w1" },
      storage,
    );
    expect(loadLastAgent(storage)).toMatchObject({ placement: "worker", backendId: "w1" });
    expect(
      rememberedWorkerId(loadLastAgent(storage), [
        { id: "w1", name: "Studio", url: "http://192.168.1.8:7421" },
      ]),
    ).toBe("w1");
    expect(rememberedWorkerId(loadLastAgent(storage), [])).toBe("");
  });

  it("prefers an enabled provider and remembered model", () => {
    expect(pickProvider([openai, grok])?.id).toBe("grok");
    expect(pickProvider([openai, grok], { os: "ubuntu", providerId: "openai" })?.id).toBe("openai");
    const opencode = { ...openai, id: "opencode", name: "OpenCode", kind: "opencode" as const };
    expect(pickProvider([openai, opencode])?.id).toBe("opencode");
    const config = {
      templates: [
        { id: "ubuntu-24.04", os: "ubuntu" },
        { id: "debian-12", os: "debian" },
      ],
      providers: [openai, grok],
    } as LocusConfig;
    expect(
      resolveAgentDefaults(config, "debian", { os: "debian", providerId: "grok", model: "grok-4" }),
    ).toEqual({
      templateId: "debian-12",
      providerId: "grok",
      model: "grok-4",
    });
  });

  it("keeps the current model in the picker list", () => {
    expect(modelsForProvider(grok, "custom-grok")).toEqual(["custom-grok", "grok-4"]);
    expect(modelsForProvider(undefined, "kept")).toEqual(["kept"]);
  });

  it("keeps a Cursor Fast or thinking variant as the remembered model", () => {
    const cursor: AiProvider = {
      id: "cursor-cli",
      name: "Cursor CLI",
      kind: "cursor-cli",
      baseUrl: "cursor-cli://local",
      models: ["composer-2", "auto", "gpt-5"],
      defaultModel: "composer-2",
      enabled: true,
      extraHeaders: {},
    };
    const config = {
      templates: [{ id: "ubuntu-24.04", os: "ubuntu" }],
      providers: [cursor],
    } as LocusConfig;
    expect(
      resolveAgentDefaults(config, "ubuntu", {
        os: "ubuntu",
        providerId: "cursor-cli",
        model: "composer-2-fast",
      }),
    ).toEqual({
      templateId: "ubuntu-24.04",
      providerId: "cursor-cli",
      model: "composer-2-fast",
    });
    expect(
      resolveAgentDefaults(config, "ubuntu", {
        os: "ubuntu",
        providerId: "cursor-cli",
        model: "gpt-5-high",
      }).model,
    ).toBe("gpt-5-high");
  });
});
