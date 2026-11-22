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

  it("parses Agent Skills front matter with a folded description", () => {
    const parsed = parseSkillMarkdown(
      "review-pr.md",
      "---\nname: review-pr\ndescription: >\n  Adversarial review of a PR.\n  Default lean.\nallowed-tools: exec fetch\n---\n\n# Review PR\nSee [HOST.md](HOST.md).\n",
      { folder: ".agents/skills/review-pr" },
    );
    expect(parsed?.name).toBe("review-pr");
    expect(parsed?.hint).toBe("Adversarial review of a PR. Default lean.");
    expect(parsed?.allowedTools).toEqual(["exec", "fetch"]);
    expect(parsed?.body).toMatch(/^Skill folder: \.agents\/skills\/review-pr\//);
    expect(parsed?.body).toContain("# Review PR");
    const literal = parseSkillMarkdown("x.md", "---\nhint: |\n  line one\n  line two\n---\nGo.");
    expect(literal?.hint).toBe("line one\nline two");
    expect(literal?.body).toBe("Go.");
  });

  it("lets a repo skill replace a built-in but not an operator skill", () => {
    const merged = mergeSkills(
      [skill("review-pr", { id: "builtin:review-pr" }), skill("mine", { id: "custom" })],
      [skill("review-pr", { id: "file:review-pr" }), skill("mine", { id: "file:mine" })],
    );
    expect(merged.map((row) => row.id)).toEqual(["file:review-pr", "custom"]);
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
