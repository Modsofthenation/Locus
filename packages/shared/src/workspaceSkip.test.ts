import { describe, expect, it } from "vitest";
import {
  isRepoMapExtraSkipDir,
  isWorkspaceSkipDir,
  repoMapPathSkipped,
  workspaceListingPathDropped,
  workspacePathSkipped,
  WORKSPACE_SKIP_DIR_SET,
} from "./workspaceSkip.js";

describe("workspaceSkip", () => {
  it("skips listing dirs including the Chromium profile", () => {
    expect(isWorkspaceSkipDir("node_modules")).toBe(true);
    expect(isWorkspaceSkipDir(".locus-chrome")).toBe(true);
    expect(isWorkspaceSkipDir("src")).toBe(false);
    expect(workspacePathSkipped("apps/foo/node_modules/pkg")).toBe(true);
    expect(WORKSPACE_SKIP_DIR_SET.has("dist")).toBe(true);
    expect(isWorkspaceSkipDir("vendor")).toBe(true);
    expect(isWorkspaceSkipDir(".venv")).toBe(true);
  });

  it("skips extra generated trees on the repo map without hiding them from Files", () => {
    expect(isWorkspaceSkipDir(".cache")).toBe(false);
    expect(isRepoMapExtraSkipDir(".cache")).toBe(true);
    expect(isRepoMapExtraSkipDir(".agents")).toBe(true);
    expect(isRepoMapExtraSkipDir(".mypy_cache")).toBe(true);
    expect(isRepoMapExtraSkipDir(".tmp")).toBe(true);
    expect(isRepoMapExtraSkipDir(".pre-commit-cache-agent")).toBe(true);
    expect(isRepoMapExtraSkipDir(".cursor")).toBe(true);
    expect(isRepoMapExtraSkipDir(".github")).toBe(false);
    expect(isRepoMapExtraSkipDir(".vscode")).toBe(false);
    expect(isRepoMapExtraSkipDir("src")).toBe(false);
    expect(repoMapPathSkipped(".cache/tmp.py")).toBe(true);
    expect(repoMapPathSkipped(".tmp/blob.py")).toBe(true);
    expect(repoMapPathSkipped(".gitignore")).toBe(false);
    expect(repoMapPathSkipped(".github/workflows/ci.yml")).toBe(false);
    expect(repoMapPathSkipped("vendor/lib.rs")).toBe(true);
    expect(repoMapPathSkipped("src/main.ts")).toBe(false);
    expect(workspaceListingPathDropped(".cache", "dir")).toBe(false);
    expect(workspaceListingPathDropped(".tmp", "dir")).toBe(false);
    expect(workspaceListingPathDropped(".cache/tmp.py", "file")).toBe(true);
    expect(workspaceListingPathDropped("src/app.ts", "file")).toBe(false);
    expect(workspaceListingPathDropped(".gitignore", "file")).toBe(false);
    expect(workspaceListingPathDropped(".cache/tmp.py", "file", ".cache")).toBe(false);
    expect(workspaceListingPathDropped(".cache/tmp", "dir", ".cache")).toBe(false);
    expect(workspaceListingPathDropped(".cache/.env", "file", ".cache")).toBe(false);
    expect(workspaceListingPathDropped(".cursor/rules/locus.mdc", "file", ".cursor")).toBe(false);
    expect(workspaceListingPathDropped(".tmp/noise.ts", "file", ".cache")).toBe(true);
    expect(workspaceListingPathDropped(".cache/node_modules/pkg", "file", ".cache")).toBe(true);
    expect(workspaceListingPathDropped(".cache/.git/config", "file", ".cache")).toBe(true);
    expect(workspaceListingPathDropped(".git/config", "file", ".git")).toBe(true);
  });
});
