import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  expandAffectedWorkspaceRoots,
  runWorkspaceNpmScript,
  testWorkspacesFromChangedFiles,
} from "./hooks.js";

it("plans affected workspace tests without treating docs as repository-wide changes", () => {
  expect(
    testWorkspacesFromChangedFiles("/repo", [
      "docs/harness.md",
      ".locus-attachments/turns.txt",
      "README.md",
    ]),
  ).toEqual([]);
  expect(
    testWorkspacesFromChangedFiles("/repo", [
      "docs/harness.md",
      "apps/server/src/session/sessions.ts",
      "packages/shared/src/models/sessionTitle.ts",
    ]),
  ).toEqual([join("/repo", "apps/server"), join("/repo", "packages/shared")]);
  expect(testWorkspacesFromChangedFiles("/repo", ["package-lock.json"])).toBeUndefined();
  expect(testWorkspacesFromChangedFiles("/repo", ["apps/server/package.json"])).toBeUndefined();
  expect(testWorkspacesFromChangedFiles("/repo", ["apps/server/fixtures/example.md"])).toEqual([
    join("/repo", "apps/server"),
  ]);
});

it("includes transitive workspace dependents in a scoped test plan", () => {
  const shared = "/repo/packages/shared";
  const server = "/repo/apps/server";
  const worker = "/repo/packages/worker";
  const desktop = "/repo/apps/desktop";
  expect(
    expandAffectedWorkspaceRoots(
      [
        { root: shared, name: "@locus/shared", dependencies: [] },
        { root: server, name: "@locus/server", dependencies: ["@locus/shared"] },
        { root: worker, name: "@locus/worker", dependencies: ["@locus/server"] },
        { root: desktop, name: "@locus/desktop", dependencies: ["@locus/shared"] },
      ],
      [shared],
    ),
  ).toEqual([shared, server, worker, desktop]);
  expect(
    expandAffectedWorkspaceRoots(
      [{ root: shared, name: "@locus/shared", dependencies: [] }],
      ["/repo/packages/missing"],
    ),
  ).toBeUndefined();
});

it("runs Windows npm wrappers and preserves script failure output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "locus npm hook "));
  try {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          test: 'node -e "console.log(12345)"',
          lint: 'node -e "console.log(54321); process.exit(1)"',
        },
      }),
    );
    expect(await runWorkspaceNpmScript(dir, "test", 10000)).toMatchObject({
      ran: true,
      ok: true,
      output: expect.stringContaining("12345"),
    });
    expect(await runWorkspaceNpmScript(dir, "lint", 10000)).toMatchObject({
      ran: true,
      ok: false,
      output: expect.stringContaining("54321"),
      command: "npm run lint",
      cwd: dir,
      failureKind: "script-failure",
      durationMs: expect.any(Number),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("classifies missing dependency failures separately from test failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "locus npm missing deps "));
  try {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          test: "node -e \"console.error('Cannot find package vite'); process.exit(1)\"",
        },
      }),
    );
    await expect(runWorkspaceNpmScript(dir, "test", 10000)).resolves.toMatchObject({
      ran: true,
      ok: false,
      failureKind: "missing-dependencies",
      output: expect.stringContaining("Cannot find package vite"),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("blocks when a workspace package manifest is malformed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "locus npm malformed manifest "));
  try {
    await writeFile(join(dir, "package.json"), "{\n", "utf8");
    await expect(runWorkspaceNpmScript(dir, "test", 10000)).resolves.toMatchObject({
      ran: true,
      ok: false,
      failureKind: "runner",
      retryable: true,
      output: expect.stringContaining("package.json"),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
