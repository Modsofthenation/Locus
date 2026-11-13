import {
  FIRST_TASKS,
  sessionRuntime,
  type AgentSession,
  type FirstTask,
  type LinkedRepo,
} from "@locus/shared";

/** Where a suggested first task should run. */
export type FirstTaskTarget =
  | { kind: "repo"; repoId: string; name: string }
  | { kind: "host"; path: string; name: string }
  | { kind: "private" };

export type SuggestedFirstTask = FirstTask & { target: FirstTaskTarget };

function folderName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function explainPrompt(where: string): string {
  return [
    `Explain how ${where} is put together. Read the README, the build/package files and the main entry points.`,
    "Reply with: what it does, the main modules and how they connect, how to build and test it, and three things a new contributor should know.",
    "This is read-only: do not edit, commit or push anything.",
  ].join(" ");
}

function fixTestPrompt(where: string): string {
  return [
    `In ${where}, find how the tests are run and run them.`,
    "If one fails, find the cause and make the smallest fix that makes it pass, then run the tests again.",
    "If everything passes, pick one small, clearly-scoped improvement (a missing test or an obvious bug) and do that instead.",
    "Do not commit or push. Summarise what you changed and why.",
  ].join(" ");
}

/** Most recently used Host folders, newest first, without duplicates. */
export function recentHostFolders(
  sessions: readonly Pick<AgentSession, "runtime" | "hostDir" | "updatedAt" | "archived">[],
  lastHostDir?: string,
): string[] {
  const rows = sessions
    .filter((row) => !row.archived && sessionRuntime(row) === "host" && row.hostDir?.trim())
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map((row) => row.hostDir!.trim());
  const out = lastHostDir?.trim() ? [lastHostDir.trim(), ...rows] : rows;
  return [...new Set(out)];
}

/**
 * First tasks built from what the operator already has: a linked repo, else a
 * folder they used on Host, else the generic private-folder samples.
 * Real work on real code shows what an agent can do; hello.txt does not.
 */
export function suggestFirstTasks(input: {
  repos: readonly Pick<LinkedRepo, "id" | "name" | "lastPushedAt" | "lastFetchAt">[];
  hostFolders: readonly string[];
}): SuggestedFirstTask[] {
  const repo = [...input.repos].sort((a, b) => {
    const at = a.lastPushedAt ?? a.lastFetchAt ?? "";
    const bt = b.lastPushedAt ?? b.lastFetchAt ?? "";
    return at < bt ? 1 : at > bt ? -1 : 0;
  })[0];
  if (repo) {
    const target: FirstTaskTarget = { kind: "repo", repoId: repo.id, name: repo.name };
    return [
      {
        id: `repo-explain:${repo.id}`,
        title: `Explain ${repo.name}`,
        blurb: "Read-only tour of the repo: modules, build, tests.",
        prompt: explainPrompt(`the ${repo.name} repository`),
        target,
      },
      {
        id: `repo-fix:${repo.id}`,
        title: `Fix a failing test in ${repo.name}`,
        blurb: "Runs the tests and fixes one failure. Nothing is pushed.",
        prompt: fixTestPrompt(`the ${repo.name} repository`),
        target,
      },
    ];
  }
  const folder = input.hostFolders[0];
  if (folder) {
    const name = folderName(folder);
    const target: FirstTaskTarget = { kind: "host", path: folder, name };
    return [
      {
        id: `host-explain:${folder}`,
        title: `Explain ${name}`,
        blurb: `Read-only tour of ${folder}.`,
        prompt: explainPrompt(`the project in /workspace (${name})`),
        target,
      },
      {
        id: `host-fix:${folder}`,
        title: `Fix a failing test in ${name}`,
        blurb: "Runs the tests and fixes one failure. Nothing is pushed.",
        prompt: fixTestPrompt(`the project in /workspace (${name})`),
        target,
      },
    ];
  }
  return FIRST_TASKS.map((task) => ({ ...task, target: { kind: "private" } }));
}
