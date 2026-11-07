import { describe, expect, it } from "vitest";
import type { AgentSkill, LocusConfig } from "@locus/shared";
import { blankSkill, configForSave, configIsDirty } from "./configPersist";

const skill = (patch: Partial<AgentSkill>): AgentSkill =>
  ({
    id: "s",
    name: "",
    title: "",
    hint: "",
    body: "",
    ...patch,
  }) as AgentSkill;

describe("configForSave", () => {
  it("drops blank skills and reports dirty when the payload changes", () => {
    expect(blankSkill(skill({}))).toBe(true);
    expect(blankSkill(skill({ name: "x" }))).toBe(false);
    const config = { skills: [skill({}), skill({ name: "ok" })] } as LocusConfig;
    expect(configForSave(config).skills).toEqual([skill({ name: "ok" })]);
    expect(configIsDirty(config, configForSave(config))).toBe(false);
    expect(configIsDirty(config, { ...config, skills: [] } as LocusConfig)).toBe(true);
  });
});
