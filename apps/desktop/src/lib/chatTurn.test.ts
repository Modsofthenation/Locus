import { describe, expect, it } from "vitest";
import {
  chatPostBody,
  chatPromptLanded,
  echoUserMessage,
  outboundPromptLanded,
  recoverDroppedChat,
  resolveComposerIntent,
} from "./chatTurn";

const skill = {
  id: "review",
  name: "review",
  title: "Review",
  hint: "Review the diff",
  body: "Read the diff and comment.",
};

describe("resolveComposerIntent", () => {
  const base = {
    fileCount: 0,
    turning: false,
    planning: false,
    runtime: "docker" as const,
    skills: [skill],
  };

  it("is noop when both the box and files are empty", () => {
    expect(resolveComposerIntent({ ...base, text: "   " })).toEqual({ kind: "noop" });
  });

  it("sends files-only as a chat Turn", () => {
    expect(resolveComposerIntent({ ...base, text: "", fileCount: 1 })).toEqual({
      kind: "chat",
      content: "",
      plan: false,
      steer: false,
    });
  });

  it("arms plan mode for bare /plan and sends a plan task", () => {
    expect(resolveComposerIntent({ ...base, text: "/plan" })).toEqual({ kind: "plan-mode" });
    expect(resolveComposerIntent({ ...base, text: "/plan ship the form" })).toEqual({
      kind: "plan-task",
      task: "ship the form",
    });
  });

  it("routes a builtin slash command before skills", () => {
    const intent = resolveComposerIntent({ ...base, text: "/undo" });
    expect(intent.kind).toBe("slash");
    if (intent.kind === "slash") expect(intent.command.id).toBe("undo");
  });

  it("expands a skill slash into the skill prompt", () => {
    const intent = resolveComposerIntent({ ...base, text: "/review the login" });
    expect(intent.kind).toBe("skill");
    if (intent.kind !== "skill") return;
    expect(intent.skillName).toBe("review");
    expect(intent.prompt).toContain('Use the "Review" skill.');
    expect(intent.prompt).toContain("Task:\nthe login");
  });

  it("steers when a Turn is already running", () => {
    expect(resolveComposerIntent({ ...base, text: "keep going", turning: true })).toEqual({
      kind: "chat",
      content: "keep going",
      plan: false,
      steer: true,
    });
  });

  it("keeps armed plan mode on a normal send", () => {
    expect(resolveComposerIntent({ ...base, text: "do the thing", planning: true })).toEqual({
      kind: "chat",
      content: "do the thing",
      plan: true,
      steer: false,
    });
  });
});

describe("chatPromptLanded", () => {
  it("treats a matching in-flight user turn as landed", () => {
    expect(
      chatPromptLanded(
        {
          status: "running",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
          ],
        },
        "hello",
      ),
    ).toBe(true);
  });

  it("does not treat an older completed prompt as this send", () => {
    expect(
      chatPromptLanded(
        {
          status: "idle",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
            { id: "a1", role: "assistant", content: "done", createdAt: "2020-01-01T00:00:01.000Z" },
          ],
        },
        "hello",
      ),
    ).toBe(false);
  });

  it("does not treat a shorter prompt as a prefix of an older user turn", () => {
    expect(
      chatPromptLanded(
        {
          status: "running",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "history of the world",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
        "hi",
      ),
    ).toBe(false);
  });

  it("treats an attachment note appended to the prompt as the same send", () => {
    expect(
      chatPromptLanded(
        {
          status: "running",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "look at this\n\nAttached files:\n- shot.png",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
        "look at this",
      ),
    ).toBe(true);
  });

  it("treats an interpolated clipboard chip as the same send", () => {
    expect(
      chatPromptLanded(
        {
          status: "running",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "Look at clip.png at /workspace/.locus-attachments/clip.png please",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
        },
        "Look at [[paste:clip.png]] please",
      ),
    ).toBe(true);
  });
});

describe("outboundPromptLanded", () => {
  it("treats an empty outbound as landed once any later user message exists", () => {
    expect(
      outboundPromptLanded(
        {
          status: "running",
          messages: [
            { id: "u1", role: "user", content: "", createdAt: "2020-01-01T00:00:05.000Z" },
          ],
        },
        {
          id: "pending",
          role: "user",
          content: "",
          createdAt: "2020-01-01T00:00:01.000Z",
        },
      ),
    ).toBe(true);
  });

  it("treats a queued follow-up as landed so the thread does not echo it", () => {
    expect(
      outboundPromptLanded(
        {
          status: "running",
          messages: [
            {
              id: "u1",
              role: "user",
              content: "redesign the logs page",
              createdAt: "2020-01-01T00:00:00.000Z",
            },
          ],
          queue: [{ id: "q1", text: "Can we make sure the colour scheme matches" }],
        },
        {
          id: "pending",
          role: "user",
          content: "Can we make sure the colour scheme matches",
          createdAt: "2020-01-01T00:00:02.000Z",
        },
      ),
    ).toBe(true);
  });
});

describe("echoUserMessage", () => {
  it("echoes steer and file chips for the optimistic bubble", () => {
    const echo = echoUserMessage("hi", {
      steer: true,
      files: [{ name: "shot.png", type: "image/png", size: 12 }],
    });
    expect(echo.role).toBe("user");
    expect(echo.content).toBe("hi");
    expect(echo.steer).toBe(true);
    expect(echo.attachments).toEqual([
      {
        name: "shot.png",
        mime: "image/png",
        bytes: 12,
        storedName: "shot.png",
      },
    ]);
  });
});

describe("chatPostBody", () => {
  it("omits an empty body so POST /chat stays a bare prompt", () => {
    expect(chatPostBody({})).toBeUndefined();
  });

  it("includes only the Turn flags that are set", () => {
    expect(chatPostBody({ plan: true, steer: false })).toEqual({ plan: true });
    expect(
      chatPostBody({
        skill: "review",
        attachments: [{ name: "a.txt", contentBase64: "YQ==" }],
      }),
    ).toEqual({
      skill: "review",
      attachments: [{ name: "a.txt", contentBase64: "YQ==" }],
    });
    expect(chatPostBody({ focusPath: "src/app.ts" })).toEqual({ focusPath: "src/app.ts" });
    expect(chatPostBody({ assetRefs: ["a1"] })).toEqual({ assetRefs: ["a1"] });
  });
});

describe("recoverDroppedChat", () => {
  it("keeps the optimistic bubble when the Turn already landed", () => {
    expect(
      recoverDroppedChat(
        {
          status: "running",
          messages: [
            { id: "u1", role: "user", content: "hello", createdAt: "2020-01-01T00:00:00.000Z" },
          ],
        },
        "hello",
      ),
    ).toBe("landed");
  });

  it("restores the composer when the control plane never saw the prompt", () => {
    expect(recoverDroppedChat(null, "hello")).toBe("restore");
    expect(recoverDroppedChat({ status: "idle", messages: [] }, "hello")).toBe("restore");
  });
});
