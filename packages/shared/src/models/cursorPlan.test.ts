import { describe, expect, it } from "vitest";
import { askUserItems } from "./askUser.js";
import {
  askUserArgsFromCursorAskQuestion,
  cursorSwitchedToPlan,
  isCursorAskQuestionTool,
  isCursorCreatePlanTool,
  isHiddenCursorPlanTool,
  messageProposesCursorPlan,
  planFromCursorCreatePlan,
  planFromCursorToolCalls,
  shouldFinishCursorPlanTurn,
} from "./cursorPlan.js";

const ubuntuTodos = [
  {
    id: "iso-builder",
    content:
      "Rewrite scripts/build-iso.sh: debootstrap resolute + casper + xorriso in ubuntu:26.04 Docker",
    status: "TODO_STATUS_PENDING",
  },
  {
    id: "apt-packages",
    content:
      "Convert packages.add, locusos-desktop.packages, and reign.default.json to Ubuntu 26.04 names",
    status: "TODO_STATUS_PENDING",
  },
  {
    id: "identity-overlay",
    content: "os-release ID_LIKE=ubuntu, sudo group, host-family detect, identity/README docs",
    status: "TODO_STATUS_PENDING",
  },
  {
    id: "installer-host",
    content: "locus-install debootstrap+grub; install.sh/install-desktop.sh/locus-os apt",
    status: "TODO_STATUS_PENDING",
  },
  {
    id: "verify-rebuild",
    content: "Update verify-install fixtures and rebuild/boot the Ubuntu live ISO",
    status: "TODO_STATUS_PENDING",
  },
];

describe("Cursor plan protocol", () => {
  it("folds createPlan todos into a proposed plan card", () => {
    const plan = planFromCursorCreatePlan(
      {
        name: "Ubuntu 26.04 ISO",
        overview: "Retarget the live ISO from Arch to Ubuntu 26.04.1",
        plan: "# Ubuntu 26.04.1 live ISO\n\nFiles:\n- scripts/build-iso.sh\nRisks:\n- Docker guests stay Arch",
        todos: ubuntuTodos,
      },
      "msg-1",
    );
    expect(plan?.phase).toBe("proposed");
    expect(plan?.messageId).toBe("msg-1");
    expect(plan?.items.map((item) => item.text)).toEqual(ubuntuTodos.map((row) => row.content));
    expect(plan?.items.every((item) => item.status === "pending")).toBe(true);
    expect(plan?.files).toEqual(["scripts/build-iso.sh"]);
    expect(plan?.risks).toEqual(["Docker guests stay Arch"]);
  });

  it("falls back to numbered plan markdown when todos are missing", () => {
    const plan = planFromCursorCreatePlan({
      plan: "1. Rewrite the ISO builder\n2. Convert package lists\n3. Rebuild and boot",
    });
    expect(plan?.items.map((item) => item.text)).toEqual([
      "Rewrite the ISO builder",
      "Convert package lists",
      "Rebuild and boot",
    ]);
  });

  it("maps askQuestion options onto ask_user items", () => {
    const args = askUserArgsFromCursorAskQuestion({
      title: "Ubuntu 26.04.1 base — scope",
      questions: [
        {
          id: "ubuntu_scope",
          prompt: "What should become Ubuntu in this change?",
          options: [
            { id: "iso_host", label: "ISO + host installer/desktop only (recommended)." },
            { id: "everything", label: "Everything, including Docker guests." },
          ],
          allowMultiple: false,
        },
      ],
    });
    expect(args.question).toBe("Ubuntu 26.04.1 base — scope");
    expect(askUserItems(args)).toEqual([
      {
        id: "ubuntu_scope",
        question: "What should become Ubuntu in this change?",
        choices: [
          "ISO + host installer/desktop only (recommended).",
          "Everything, including Docker guests.",
        ],
        allowFreeText: false,
      },
    ]);
  });

  it("recognizes protocol names and when a turn proposed a plan", () => {
    expect(isCursorCreatePlanTool("CreatePlan")).toBe(true);
    expect(isCursorAskQuestionTool("ask_question")).toBe(true);
    expect(isHiddenCursorPlanTool("switchMode")).toBe(true);
    expect(isHiddenCursorPlanTool("ask_user")).toBe(false);
    expect(cursorSwitchedToPlan({ targetModeId: "plan" })).toBe(true);
    expect(
      messageProposesCursorPlan({
        toolCalls: [{ name: "switchMode", arguments: { targetModeId: "plan" } }],
      }),
    ).toBe(true);
    expect(shouldFinishCursorPlanTurn(false, { toolCalls: [{ name: "createPlan" }] })).toBe(true);
    expect(shouldFinishCursorPlanTurn(false, { toolCalls: [{ name: "file_read" }] })).toBe(false);
    expect(shouldFinishCursorPlanTurn(true, undefined)).toBe(true);
    expect(
      planFromCursorToolCalls([
        { name: "createPlan", arguments: { todos: ["Clone the repo", "Open a PR"] } },
      ])?.items.map((item) => item.text),
    ).toEqual(["Clone the repo", "Open a PR"]);
  });
});
