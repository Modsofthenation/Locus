import { describe, expect, it } from "vitest";
import {
  ASK_USER_MAX_QUESTIONS,
  askUserAllowsFreeText,
  askUserChoices,
  askUserIntro,
  askUserItems,
  askUserQuestion,
  formatAskUserReply,
} from "./askUser.js";

describe("ask_user", () => {
  it("reads a single question with choices", () => {
    const args = { question: "Ship it?", choices: ["Yes", "No", "Yes"] };
    expect(askUserQuestion(args)).toBe("Ship it?");
    expect(askUserChoices(args)).toEqual(["Yes", "No"]);
    expect(askUserAllowsFreeText(args)).toBe(false);
    expect(askUserIntro(args)).toBe("");
    expect(askUserItems(args)).toEqual([
      { id: "q1", question: "Ship it?", choices: ["Yes", "No"], allowFreeText: false },
    ]);
  });

  it("parses a series of questions and formats the reply", () => {
    const args = {
      question: "A few details before the first draft",
      questions: [
        { question: "Who is this for?", choices: ["Founders", "Consumers"] },
        {
          question: "Primary goal?",
          choices: ["Signups", "Explain the product"],
          allowFreeText: true,
        },
        "Any must-have copy?",
      ],
    };
    expect(askUserIntro(args)).toBe("A few details before the first draft");
    const items = askUserItems(args);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      id: "q1",
      question: "Who is this for?",
      choices: ["Founders", "Consumers"],
      allowFreeText: false,
    });
    expect(items[1]?.allowFreeText).toBe(true);
    expect(items[2]).toMatchObject({ question: "Any must-have copy?", allowFreeText: true });
    expect(formatAskUserReply(items, { q1: "Founders", q2: "Book a demo", q3: "" })).toBe(
      "1. Who is this for?\nFounders\n\n2. Primary goal?\nBook a demo\n\n3. Any must-have copy?\n(no answer)",
    );
  });

  it("caps a series at six questions", () => {
    const questions = Array.from({ length: 10 }, (_, i) => `Question ${i + 1}?`);
    expect(askUserItems({ question: "Details", questions })).toHaveLength(ASK_USER_MAX_QUESTIONS);
  });

  it("unwraps a nested stringified ask_user payload", () => {
    const inner = {
      question: "Before I design the page, a few details.",
      questions: [
        {
          question: "What is Harbor?",
          choices: ["A product I'm building", "A brand/company I run"],
          allowFreeText: true,
        },
        {
          question: "Tone?",
          choices: ["Bold and minimal", "Warm and human"],
          allowFreeText: true,
        },
      ],
    };
    const items = askUserItems({ ask_user: JSON.stringify(inner) });
    expect(askUserIntro({ ask_user: JSON.stringify(inner) })).toBe(
      "Before I design the page, a few details.",
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      question: "What is Harbor?",
      choices: ["A product I'm building", "A brand/company I run"],
      allowFreeText: true,
    });
    expect(items[1]?.question).toBe("Tone?");
  });

  it("parses questions when they arrive as a JSON string", () => {
    const items = askUserItems({
      question: "A few details",
      questions: JSON.stringify([{ question: "Who?", choices: ["Founders"] }]),
    });
    expect(items).toEqual([
      { id: "q1", question: "Who?", choices: ["Founders"], allowFreeText: false },
    ]);
  });
});
