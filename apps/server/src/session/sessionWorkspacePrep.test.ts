import { describe, expect, it } from "vitest";
import type { AgentSession } from "@locus/shared";
import { dockerWorkspaceDir } from "@locus/hypervisor";
import { attachmentWorkspaceRoot, repoWorkspaceClonePending } from "./sessionWorkspacePrep.js";

function session(patch: Partial<AgentSession>): AgentSession {
  return {
    id: "s1",
    title: "One",
    os: "ubuntu",
    templateId: "t",
    providerId: "p",
    model: "m",
    status: "idle",
    messages: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("repoWorkspaceClonePending", () => {
  it("is false without a repo or for design sessions", () => {
    const cloned = new Set<string>();
    const inflight = new Map<string, Promise<void>>();
    expect(repoWorkspaceClonePending(session({}), cloned, inflight)).toBe(false);
    expect(
      repoWorkspaceClonePending(
        session({
          kind: "design",
          repo: { forge: "github", url: "https://github.com/acme/demo.git" },
        }),
        cloned,
        inflight,
      ),
    ).toBe(false);
    expect(
      repoWorkspaceClonePending(
        session({
          kind: "game",
          repo: { forge: "github", url: "https://github.com/acme/demo.git" },
        }),
        cloned,
        inflight,
      ),
    ).toBe(false);
  });

  it("is true until clone finishes, including while inflight after cloned is set", () => {
    const cloned = new Set<string>();
    const inflight = new Map<string, Promise<void>>();
    const coding = session({
      repo: { forge: "github", url: "https://github.com/acme/demo.git" },
    });
    expect(repoWorkspaceClonePending(coding, cloned, inflight)).toBe(true);
    cloned.add("s1");
    inflight.set("s1", Promise.resolve());
    expect(repoWorkspaceClonePending(coding, cloned, inflight)).toBe(true);
    inflight.delete("s1");
    expect(repoWorkspaceClonePending(coding, cloned, inflight)).toBe(false);
  });
});

describe("attachmentWorkspaceRoot", () => {
  it("stays undefined while a coding clone is pending", () => {
    const coding = session({
      runtime: "docker",
      repo: { forge: "github", url: "https://github.com/acme/demo.git" },
    });
    expect(attachmentWorkspaceRoot(coding, new Set(), new Map(), "/data", "/host")).toBeUndefined();
  });

  it("returns the docker or host tree once clone is done", () => {
    const cloned = new Set(["s1"]);
    const inflight = new Map<string, Promise<void>>();
    expect(
      attachmentWorkspaceRoot(
        session({
          runtime: "docker",
          repo: { forge: "github", url: "https://github.com/acme/demo.git" },
        }),
        cloned,
        inflight,
        "/data",
        "/host",
      ),
    ).toBe(dockerWorkspaceDir("/data", "s1"));
    expect(
      attachmentWorkspaceRoot(session({ runtime: "host" }), cloned, inflight, "/data", "/host"),
    ).toBe("/host");
  });

  it("does not write onto the laptop docker tree for worker sessions", () => {
    const cloned = new Set(["s1"]);
    const inflight = new Map<string, Promise<void>>();
    expect(
      attachmentWorkspaceRoot(
        session({ runtime: "docker", placement: "worker" }),
        cloned,
        inflight,
        "/data",
        "/host",
      ),
    ).toBeUndefined();
  });
});
