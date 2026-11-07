import { describe, expect, it } from "vitest";
import {
  clusterSessionsByRepo,
  groupSessionsByDay,
  HIDE_AUTOMATION_CHATS_KEY,
  IDLE_ARCHIVE_AFTER_MS,
  isEmptyDraftSession,
  isIdleArchiveCandidate,
  loadHideAutomationChats,
  saveHideAutomationChats,
  sessionDayGroup,
  sessionRepoKey,
  sessionRepoLabel,
} from "./sessionGroups";

const now = new Date(2026, 7, 23, 15, 0, 0);

function iso(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month, day, hour, 0, 0).toISOString();
}

describe("sessionDayGroup", () => {
  it("buckets local calendar days", () => {
    expect(sessionDayGroup(iso(2026, 7, 23, 9), now)).toBe("today");
    expect(sessionDayGroup(iso(2026, 7, 22, 23), now)).toBe("yesterday");
    expect(sessionDayGroup(iso(2026, 7, 20, 8), now)).toBe("week");
    expect(sessionDayGroup(iso(2026, 6, 1, 8), now)).toBe("earlier");
    expect(sessionDayGroup("not-a-date", now)).toBe("earlier");
  });
});

describe("groupSessionsByDay", () => {
  it("keeps pinned chats first, then Today / Yesterday / This week / Earlier", () => {
    const groups = groupSessionsByDay(
      [
        { id: "old", updatedAt: iso(2026, 5, 1) },
        { id: "today", updatedAt: iso(2026, 7, 23, 10) },
        { id: "pin", pinned: true, updatedAt: iso(2026, 5, 2) },
        { id: "yday", updatedAt: iso(2026, 7, 22, 18) },
        { id: "week", updatedAt: iso(2026, 7, 19, 12) },
      ],
      now,
    );
    expect(groups.map((g) => [g.id, g.label, g.items.map((s) => s.id)])).toEqual([
      ["pinned", "Pinned", ["pin"]],
      ["today", "Today", ["today"]],
      ["yesterday", "Yesterday", ["yday"]],
      ["week", "This week", ["week"]],
      ["earlier", "Earlier", ["old"]],
    ]);
  });

  it("omits empty buckets", () => {
    const groups = groupSessionsByDay([{ id: "a", updatedAt: iso(2026, 7, 23) }], now);
    expect(groups).toEqual([
      { id: "today", label: "Today", items: [{ id: "a", updatedAt: iso(2026, 7, 23) }] },
    ]);
  });
});

describe("clusterSessionsByRepo", () => {
  it("nests a repo heading only when two or more chats share a repo", () => {
    const items = [
      { id: "a", repoId: "r1", repo: { url: "https://github.com/acme/app.git" } },
      { id: "lone", repoId: "r2" },
      { id: "b", repoId: "r1", repo: { url: "https://github.com/acme/app.git" } },
      { id: "none" },
    ];
    const clusters = clusterSessionsByRepo(items, sessionRepoKey, (row) => sessionRepoLabel(row));
    expect(clusters.map((c) => [c.key, c.label, c.items.map((s) => s.id)])).toEqual([
      ["id:r1", "app", ["a", "b"]],
      ["lone", null, ["lone", "none"]],
    ]);
  });

  it("keys by url when repoId is missing", () => {
    expect(sessionRepoKey({ repo: { url: "https://github.com/acme/app.git" } })).toBe(
      "url:https://github.com/acme/app.git",
    );
    expect(
      sessionRepoLabel({ repoId: "r1" }, [
        { id: "r1", name: "acme/web", checkout: { url: "https://github.com/acme/web.git" } },
      ]),
    ).toBe("web");
  });
});

describe("session list archive targets", () => {
  it("archives unpinned idle/draft chats older than the cutoff", () => {
    const now = new Date(2026, 7, 23, 15, 0, 0);
    const old = new Date(now.getTime() - IDLE_ARCHIVE_AFTER_MS).toISOString();
    const fresh = now.toISOString();
    expect(isIdleArchiveCandidate({ status: "idle", updatedAt: old }, now)).toBe(true);
    expect(isIdleArchiveCandidate({ status: "draft", updatedAt: old }, now)).toBe(true);
    expect(isIdleArchiveCandidate({ status: "idle", pinned: true, updatedAt: old }, now)).toBe(
      false,
    );
    expect(isIdleArchiveCandidate({ status: "idle", archived: true, updatedAt: old }, now)).toBe(
      false,
    );
    expect(isIdleArchiveCandidate({ status: "running", updatedAt: old }, now)).toBe(false);
    expect(isIdleArchiveCandidate({ status: "idle", updatedAt: fresh }, now)).toBe(false);
  });

  it("treats drafts with no user messages as empty", () => {
    expect(isEmptyDraftSession({ status: "draft", messages: [] })).toBe(true);
    expect(
      isEmptyDraftSession({
        status: "draft",
        messages: [{ role: "assistant" }],
      }),
    ).toBe(true);
    expect(
      isEmptyDraftSession({
        status: "draft",
        messages: [{ role: "user" }],
      }),
    ).toBe(false);
    expect(isEmptyDraftSession({ status: "idle", messages: [] })).toBe(false);
    expect(isEmptyDraftSession({ status: "draft", pinned: true, messages: [] })).toBe(false);
    expect(isEmptyDraftSession({ status: "draft", archived: true, messages: [] })).toBe(false);
  });
});

describe("hide automation chats", () => {
  it("defaults to hiding automation-spawned chats", () => {
    localStorage.removeItem(HIDE_AUTOMATION_CHATS_KEY);
    expect(loadHideAutomationChats()).toBe(true);
    saveHideAutomationChats(false);
    expect(loadHideAutomationChats()).toBe(false);
    saveHideAutomationChats(true);
    expect(loadHideAutomationChats()).toBe(true);
  });
});
