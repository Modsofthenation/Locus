import { describe, expect, it } from "vitest";
import {
  applyPromptTitle,
  generatedSessionTitle,
  isGeneratedSessionTitle,
  titleFromCreateInput,
  titleFromPrompt,
} from "./sessionTitle.js";

describe("titleFromPrompt", () => {
  it("uses the first non-empty line and collapses whitespace", () => {
    expect(titleFromPrompt("\n  Fix the login form  \nthen tests\n")).toBe("Fix the login form");
  });

  it("strips a leading slash command so the title is the task", () => {
    expect(titleFromPrompt("/plan fix the login form")).toBe("fix the login form");
    expect(titleFromPrompt("/plan")).toBe("/plan");
  });

  it("clips long prompts at a word boundary", () => {
    const title = titleFromPrompt(
      "Please update the authentication middleware so expired tokens redirect to the sign-in page with a banner",
    );
    expect(title).toBe("Please update the authentication middleware so expired…");
    expect(title!.endsWith("…")).toBe(true);
    expect(title!.length).toBeLessThanOrEqual(57);
  });

  it("returns undefined for blank input", () => {
    expect(titleFromPrompt("  \n\t")).toBeUndefined();
  });
});

describe("generatedSessionTitle", () => {
  it("names a host agent, docker image, and design canvas", () => {
    expect(generatedSessionTitle({ os: "ubuntu", runtime: "host" })).toBe("Host agent");
    expect(generatedSessionTitle({ os: "ubuntu", runtime: "host", kind: "ide" })).toBe("Workspace");
    expect(
      generatedSessionTitle({ os: "ubuntu", runtime: "docker", dockerImage: "locus/agent" }),
    ).toBe("locus/agent:0.1 agent");
    expect(generatedSessionTitle({ os: "ubuntu", kind: "design" })).toBe("Untitled design");
    expect(generatedSessionTitle({ os: "ubuntu", kind: "game" })).toBe("Untitled game");
    expect(generatedSessionTitle({ os: "ubuntu", kind: "assets" })).toBe("Untitled asset");
    expect(generatedSessionTitle({ os: "ubuntu", kind: "board" })).toBe("Board chat");
    expect(generatedSessionTitle({ os: "ubuntu", kind: "project" })).toBe("Project coordinator");
    expect(generatedSessionTitle({ os: "ubuntu" })).toBe("Ubuntu 24.04 agent");
  });

  it("prefixes a linked repo name", () => {
    expect(
      generatedSessionTitle({
        os: "ubuntu",
        runtime: "docker",
        dockerImage: "nginx:alpine",
        repo: { url: "https://github.com/acme/shop.git" },
      }),
    ).toBe("shop · nginx:alpine");
  });
});

describe("titleFromCreateInput", () => {
  it("prefers an explicit title, then the prompt, then the generated label", () => {
    expect(
      titleFromCreateInput({
        os: "ubuntu",
        runtime: "host",
        title: "  My box  ",
        prompt: "ignored",
      }),
    ).toBe("My box");
    expect(
      titleFromCreateInput({ os: "ubuntu", runtime: "host", prompt: "Ship the landing page" }),
    ).toBe("Ship the landing page");
    expect(titleFromCreateInput({ os: "ubuntu", runtime: "host" })).toBe("Host agent");
  });
});

describe("applyPromptTitle", () => {
  it("retitles a generated placeholder and leaves a renamed session alone", () => {
    const generated = {
      title: "Host agent",
      os: "ubuntu" as const,
      runtime: "host" as const,
    };
    expect(isGeneratedSessionTitle(generated)).toBe(true);
    expect(applyPromptTitle(generated, "Fix the login form")).toBe(true);
    expect(generated.title).toBe("Fix the login form");

    const renamed = { ...generated, title: "Auth work" };
    expect(applyPromptTitle(renamed, "Something else")).toBe(false);
    expect(renamed.title).toBe("Auth work");
  });
});
