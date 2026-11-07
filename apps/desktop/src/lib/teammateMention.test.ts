import { describe, expect, it } from "vitest";
import type { AgentSession } from "@locus/shared";
import {
  filterTeammateMentions,
  insertTeammateMention,
  teammateMentionItems,
} from "./teammateMention";

function session(partial: Partial<AgentSession> & { id: string; title: string }): AgentSession {
  return {
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    providerId: "p",
    model: "m",
    status: "idle",
    messages: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    surface: "swarm",
    ...partial,
  };
}

describe("teammateMention", () => {
  it("lists @everyone and group peers for a group chat", () => {
    const coordinator = session({ id: "c1", title: "Locus", projectId: "p1" });
    const nova = session({
      id: "s1",
      title: "Agent",
      persona: { displayName: "Nova", hubRole: "Builder" },
    });
    const project = {
      id: "p1",
      groupChat: true,
      coordinatorSessionId: "c1",
      memberIds: ["s1"],
    };
    const items = teammateMentionItems({
      session: coordinator,
      sessions: [coordinator, nova],
      project,
    });
    expect(items.map((row) => row.token)).toEqual(["everyone", "Nova"]);
    expect(filterTeammateMentions(items, "no").map((row) => row.token)).toEqual(["Nova"]);
  });

  it("ranks closer @mention matches first", () => {
    const coordinator = session({ id: "c1", title: "Locus", projectId: "p1" });
    const nova = session({
      id: "s1",
      title: "Agent",
      persona: { displayName: "Nova", hubRole: "Builder" },
    });
    const nora = session({
      id: "s2",
      title: "Agent",
      persona: { displayName: "Nora", hubRole: "Researcher" },
    });
    const riv = session({
      id: "s3",
      title: "Agent",
      persona: { displayName: "River", hubRole: "Reviewer" },
    });
    const items = teammateMentionItems({
      session: coordinator,
      sessions: [coordinator, nora, riv, nova],
      project: {
        id: "p1",
        groupChat: true,
        coordinatorSessionId: "c1",
        memberIds: ["s1", "s2", "s3"],
      },
    });
    expect(items.map((row) => row.token)).toEqual(["everyone", "Nora", "Nova", "River"]);
    expect(filterTeammateMentions(items, "").map((row) => row.token)).toEqual([
      "everyone",
      "Nora",
      "Nova",
      "River",
    ]);
    expect(filterTeammateMentions(items, "no").map((row) => row.token)).toEqual(["Nora", "Nova"]);
    expect(filterTeammateMentions(items, "nova").map((row) => row.token)).toEqual(["Nova"]);
    expect(filterTeammateMentions(items, "eve").map((row) => row.token)).toEqual(["everyone"]);
    expect(filterTeammateMentions(items, "all").map((row) => row.token)).toEqual(["everyone"]);
    expect(filterTeammateMentions(items, "iver").map((row) => row.token)).toEqual(["River"]);
  });

  it("inserts a teammate mention at the caret", () => {
    const next = insertTeammateMention("Hey @No", 7, "Nova");
    expect(next.text).toBe("Hey @Nova ");
    expect(next.cursor).toBe(10);
    expect(insertTeammateMention("@No", 0, "Nova")).toEqual({
      text: "@Nova ",
      cursor: 6,
    });
  });

  it("lists Swarm teammates outside group chat", () => {
    const nova = session({
      id: "s1",
      title: "Nova",
      persona: { displayName: "Nova", hubRole: "Builder" },
    });
    const nora = session({
      id: "s2",
      title: "Nora",
      persona: { displayName: "Nora", hubRole: "Researcher" },
    });
    const items = teammateMentionItems({
      session: nova,
      sessions: [nova, nora],
    });
    expect(items.map((row) => row.token)).toEqual(["everyone", "Nora"]);
  });

  it("lists Swarm team members when the team is not a group chat", () => {
    const nova = session({
      id: "s1",
      title: "Nova",
      projectId: "team-1",
      persona: { displayName: "Nova", hubRole: "Builder" },
    });
    const nora = session({
      id: "s2",
      title: "Nora",
      projectId: "team-1",
      persona: { displayName: "Nora", hubRole: "Researcher" },
    });
    const items = teammateMentionItems({
      session: nova,
      sessions: [nova, nora],
      project: { id: "team-1", memberIds: ["s1", "s2"] },
    });
    expect(items.map((row) => row.token)).toEqual(["everyone", "Nora"]);
  });

  it("slugs spaced display names into unique @handles", () => {
    const coord = session({ id: "c1", title: "Team chat" });
    const head = session({
      id: "s1",
      title: "Agent",
      persona: { displayName: "Head of staff", hubRole: "Coordinator" },
    });
    const builder = session({
      id: "s2",
      title: "Agent",
      persona: { displayName: "The Builder", hubRole: "Builder" },
    });
    const knowledge = session({
      id: "s3",
      title: "Agent",
      persona: { displayName: "The Knowledge base", hubRole: "Researcher" },
    });
    const items = teammateMentionItems({
      session: coord,
      sessions: [coord, head, builder, knowledge],
    });
    expect(items.map((row) => row.token)).toEqual([
      "everyone",
      "Head-of-staff",
      "The-Builder",
      "The-Knowledge-base",
    ]);
    expect(filterTeammateMentions(items, "the").map((row) => row.token)).toEqual([
      "The-Builder",
      "The-Knowledge-base",
    ]);
    expect(filterTeammateMentions(items, "head").map((row) => row.token)).toEqual([
      "Head-of-staff",
    ]);
    expect(filterTeammateMentions(items, "knowledge").map((row) => row.token)).toEqual([
      "The-Knowledge-base",
    ]);
  });
});
