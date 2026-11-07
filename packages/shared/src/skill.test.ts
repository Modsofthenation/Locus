import { describe, expect, it } from "vitest";
import {
  enabledSkills,
  formatSkillPrompt,
  formatSkillCatalog,
  normalizeSkills,
  mergeSkills,
  parseSkillCommand,
  parseSkillMarkdown,
  mergeBuiltinSkills,
  skillSlashName,
  validateSkill,
  type AgentSkill,
} from "./models/skill.js";

const skill = (name: string, extra: Partial<AgentSkill> = {}): AgentSkill => ({
  id: name,
  name,
  title: name,
  hint: "hint",
  body: "Do the work.",
  enabled: true,
  ...extra,
});

describe("skills", () => {
  it("parses /name and optional task text", () => {
    const skills = [skill("review")];
    expect(parseSkillCommand("/review", skills)?.skill.name).toBe("review");
    expect(parseSkillCommand("/review staging", skills)?.rest).toBe("staging");
    expect(parseSkillCommand("/undo", skills, ["undo"])).toBeUndefined();
    expect(parseSkillCommand("/review please", [])).toBeUndefined();
    expect(formatSkillPrompt(skills[0]!, "staging")).toMatch(/Task:\nstaging/);
    expect(formatSkillPrompt(skill("review", { title: "  " }))).toContain(
      'Use the "review" skill.',
    );
    expect(normalizeSkills([{ id: "x", name: "Review", body: "go" }])[0]?.name).toBe("review");
    const parsed = parseSkillMarkdown(
      "web-qa.md",
      "---\ntitle: Web QA\nimage: mcr.microsoft.com/playwright\ntools: screenshot,exec\n---\nClick through the site.\n",
    );
    expect(parsed?.name).toBe("web-qa");
    expect(parsed?.dockerImage).toContain("playwright");
    expect(parsed?.allowedTools).toEqual(["screenshot", "exec"]);
  });

  it("rejects reserved, duplicate, and empty skills", () => {
    expect(skillSlashName("/Review")).toBe("review");
    expect(skillSlashName("1bad")).toBeUndefined();
    expect(validateSkill(skill("undo"), [], ["undo"])).toMatch(/built-in/);
    expect(validateSkill(skill("review", { body: "  " }), [], [])).toMatch(/body/);
    expect(validateSkill(skill("review"), [skill("review", { id: "other" })], [])).toMatch(
      /already used/,
    );
    expect(validateSkill(skill("review", { id: "" }), [], [])).toMatch(/id/);
    expect(enabledSkills([skill("off", { enabled: false })])).toEqual([]);
    expect(mergeSkills([skill("review")], [skill("web-qa")]).map((row) => row.name)).toEqual([
      "review",
      "web-qa",
    ]);
    expect(
      mergeSkills([skill("review")], [skill("review", { id: "file:review" })]).map(
        (row) => row.name,
      ),
    ).toEqual(["review"]);
  });

  it("lists name and hint only until read_skill", () => {
    const catalog = formatSkillCatalog([
      skill("review", { title: "Review", hint: "PR checklist" }),
    ]);
    expect(catalog).toMatch(/read_skill/);
    expect(catalog).toMatch(/\/review/);
    expect(catalog).toMatch(/PR checklist/);
    expect(catalog).not.toContain("Do the work.");
  });

  it("always includes ops-research and review-pr builtins", () => {
    const names = mergeBuiltinSkills([]).map((row) => row.name);
    expect(names).toContain("ops-research");
    expect(names).toContain("review-pr");
  });
});
