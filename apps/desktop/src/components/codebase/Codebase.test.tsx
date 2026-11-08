import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, LinkedRepo, PullRequestDetail } from "@locus/shared";
import { CodebasePane, formatAgo } from "./Codebase";
import { formatPrCreated, formatUpdatedPhrase } from "./PullTable";
import { api } from "@/lib/api";
import { clearIssueCaches, rememberIssueList } from "@/lib/issueCache";
import { clearPullCaches, rememberPullList } from "@/lib/pullCache";
import { Store, initialState, type Action } from "@/state/store";
import { selectOptionValues, setSelectValue } from "@/lib/selectControl";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.css"), "utf8");

vi.mock("@/lib/api", () => ({
  api: {
    repoPulls: vi.fn(async () => [
      {
        repoId: "r1",
        forge: "github",
        number: 12,
        title: "Fix the diff viewer",
        state: "open",
        headRef: "feature/diff",
        baseRef: "main",
        headSha: "abcdef123456",
        url: "https://github.com/acme/app/pull/12",
        author: "damon",
        updatedAt: "2020-01-02T00:00:00.000Z",
      },
    ]),
    repoPull: vi.fn(async () => pull),
    commentPull: vi.fn(),
    repoIssues: vi.fn(async () => [
      {
        repoId: "r1",
        forge: "github",
        number: 7,
        title: "Login 500",
        state: "open",
        url: "https://github.com/acme/app/issues/7",
        author: "ada",
        labels: ["bug"],
        updatedAt: "2020-01-02T00:00:00.000Z",
      },
    ]),
    repoIssue: vi.fn(async () => ({
      repoId: "r1",
      forge: "github",
      number: 7,
      title: "Login 500",
      state: "open",
      url: "https://github.com/acme/app/issues/7",
      author: "ada",
      labels: ["bug"],
      updatedAt: "2020-01-02T00:00:00.000Z",
      body: "stack overflow",
      comments: [
        {
          id: "c1",
          body: "repro on main",
          author: "sam",
          createdAt: "2020-01-02T00:00:00.000Z",
        },
      ],
    })),
    commentIssue: vi.fn(async (_id: string, _number: number, input: { body: string }) => ({
      repoId: "r1",
      forge: "github",
      number: 7,
      title: "Login 500",
      state: "open",
      url: "https://github.com/acme/app/issues/7",
      author: "ada",
      labels: ["bug"],
      updatedAt: "2020-01-02T00:00:00.000Z",
      body: "stack overflow",
      comments: [
        {
          id: "c1",
          body: "repro on main",
          author: "sam",
          createdAt: "2020-01-02T00:00:00.000Z",
        },
        {
          id: "c2",
          body: input.body,
          author: "me",
          createdAt: "2020-01-03T00:00:00.000Z",
        },
      ],
    })),
    startReviewSession: vi.fn(),
    saveConfig: vi.fn(async () => ({})),
    setPullFileViewed: vi.fn(async () => ({})),
    repoPullLoadPath: vi.fn(async () => ({
      risk: "medium",
      reasons: ["tests cover 0/0 sinks", "impact radius is small", "1 file on the load path"],
      headline: "internal service · 1 file · review the traces before merge",
      changeKinds: ["internal_service"],
      layers: ["code"],
      nodes: [
        {
          path: "src/app.ts",
          layer: "code",
          kind: "module",
          symbols: [],
          seed: true,
          sink: false,
          tested: false,
        },
      ],
      traces: [],
      hops: [],
      untestedSinks: [],
      readOrder: [{ path: "src/app.ts", why: "code module" }],
      markdown: "## Load path: MEDIUM\n",
    })),
    patchPullLoadPath: vi.fn(async (_id: string, _number: number, input: { notes: string }) => ({
      risk: "medium",
      reasons: ["1 file on the load path"],
      headline: "internal service · 1 file",
      changeKinds: ["internal_service"],
      layers: ["code"],
      nodes: [],
      traces: [],
      hops: [],
      untestedSinks: [],
      readOrder: [],
      notes: input.notes,
      markdown: `## Load path: MEDIUM\n\n### Operator notes\n${input.notes}`,
    })),
    repoPullChangeStack: vi.fn(async () => ({
      repoId: "r1",
      number: 12,
      headSha: "abcdef123456",
      generatedAt: "2020-01-02T00:00:00.000Z",
      source: "heuristic",
      cohorts: [
        {
          id: "c1",
          title: "Code (1 file)",
          summary: "internal service · 1 file",
          layers: [
            {
              id: "c1-l1",
              title: "Code",
              intent: "consumer",
              fileCount: 1,
              commentCount: 0,
              ranges: [
                {
                  path: "src/app.ts",
                  startLine: 1,
                  endLine: 2,
                  side: "RIGHT",
                  header: "@@ -1,2 +1,2 @@",
                  summary: "Update app.ts",
                },
              ],
            },
          ],
        },
      ],
      files: [{ path: "src/app.ts", cohortId: "c1", layerId: "c1-l1" }],
      markdown: "## Change stack\n",
    })),
    listPullChangeStackRevisions: vi.fn(async () => ({
      revisions: [
        {
          headSha: "abcdef123456",
          generatedAt: "2020-01-02T00:00:00.000Z",
          source: "heuristic",
          current: true,
        },
      ],
    })),
    refreshPullChangeStack: vi.fn(async () => ({
      repoId: "r1",
      number: 12,
      headSha: "abcdef123456",
      generatedAt: "2020-01-02T00:00:00.000Z",
      source: "heuristic",
      cohorts: [
        {
          id: "c1",
          title: "Code (1 file)",
          summary: "internal service · 1 file",
          layers: [
            {
              id: "c1-l1",
              title: "Code",
              intent: "consumer",
              fileCount: 1,
              commentCount: 0,
              ranges: [
                {
                  path: "src/app.ts",
                  startLine: 1,
                  endLine: 2,
                  side: "RIGHT",
                  header: "@@ -1,2 +1,2 @@",
                  summary: "Update app.ts",
                },
              ],
            },
          ],
        },
      ],
      files: [{ path: "src/app.ts", cohortId: "c1", layerId: "c1-l1" }],
      markdown: "## Change stack\n",
    })),
    summarizePullChangeStack: vi.fn(async () => ({
      repoId: "r1",
      number: 12,
      headSha: "abcdef123456",
      generatedAt: "2020-01-02T00:00:00.000Z",
      source: "heuristic+model",
      cohorts: [
        {
          id: "c1",
          title: "Code (1 file)",
          summary: "internal service · 1 file",
          layers: [
            {
              id: "c1-l1",
              title: "Code",
              intent: "consumer",
              fileCount: 1,
              commentCount: 0,
              ranges: [
                {
                  path: "src/app.ts",
                  startLine: 1,
                  endLine: 2,
                  side: "RIGHT",
                  header: "@@ -1,2 +1,2 @@",
                  summary: "Update app.ts",
                },
              ],
            },
          ],
        },
      ],
      files: [{ path: "src/app.ts", cohortId: "c1", layerId: "c1-l1" }],
      markdown: "## Change stack\n",
    })),
    deleteRepo: vi.fn(async () => ({ ok: true })),
    createSession: vi.fn(),
    startRepoAgent: vi.fn(),
    startSetupSession: vi.fn(),
    startFixSession: vi.fn(),
    importRepos: vi.fn(),
    linkRepo: vi.fn(),
    patchRepo: vi.fn(async (_id: string, input: Record<string, unknown>) => ({
      ...repo,
      ...input,
      dockerImage: typeof input.dockerImage === "string" ? input.dockerImage : repo.dockerImage,
      reviewPrompt: typeof input.reviewPrompt === "string" ? input.reviewPrompt : repo.reviewPrompt,
      autoReview: typeof input.autoReview === "boolean" ? input.autoReview : repo.autoReview,
    })),
    workspaceGitFetch: vi.fn(async () => ({ branch: "main", ahead: 0, behind: 0, files: [] })),
    workspaceGitCheckout: vi.fn(async () => ({
      branch: "feature/diff",
      ahead: 0,
      behind: 0,
      files: [],
    })),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.PointerEvent !== "function") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

const repo: LinkedRepo = {
  id: "r1",
  name: "acme/app",
  checkout: { forge: "github", url: "https://github.com/acme/app.git", ref: "main" },
  openPullCount: 2,
  lastFetchAt: "2020-01-01T00:00:00.000Z",
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

const pull: PullRequestDetail = {
  repoId: "r1",
  forge: "github",
  number: 12,
  title: "Fix the diff viewer",
  state: "open",
  headRef: "feature/diff",
  baseRef: "main",
  headSha: "abcdef123456",
  url: "https://github.com/acme/app/pull/12",
  author: "damon",
  updatedAt: "2020-01-02T00:00:00.000Z",
  body: "Please **review** the hunk.",
  files: [
    {
      path: "src/app.ts",
      status: "modified",
      patch: "@@ -1,2 +1,2 @@\n keep\n-old\n+new",
    },
  ],
  comments: [
    {
      id: "c1",
      body: "nit: rename",
      author: "sam",
      createdAt: "2020-01-02T00:00:00.000Z",
    },
    {
      id: "c2",
      body: "this delete looks wrong",
      author: "sam",
      path: "src/app.ts",
      line: 2,
      side: "LEFT",
      createdAt: "2020-01-02T00:00:00.000Z",
    },
  ],
  commits: [{ sha: "abcdef12deadbeef", message: "Fix viewer\n\nbody", author: "damon" }],
  checks: [{ name: "ci", status: "success" }],
};

describe("formatAgo", () => {
  it("returns never for missing dates", () => {
    expect(formatAgo()).toBe("never");
    expect(formatAgo("nope")).toBe("never");
    expect(formatAgo(undefined, true)).toBe("—");
  });
});

describe("PR table dates", () => {
  const now = Date.parse("2026-09-10T12:00:00.000Z");

  it("uses relative phrases for recent created dates and ISO for older ones", () => {
    expect(formatPrCreated("2026-09-10T11:00:00.000Z", now)).toBe("1 hour ago");
    expect(formatPrCreated("2026-09-07T12:00:00.000Z", now)).toBe("3 days ago");
    expect(formatPrCreated("2026-08-24T00:00:00.000Z", now)).toBe("2026-08-24");
    expect(formatPrCreated(undefined, now)).toBe("—");
  });

  it("prefixes updated phrases", () => {
    expect(formatUpdatedPhrase("2026-09-10T11:38:00.000Z", now)).toBe("updated 22 minutes ago");
    expect(formatUpdatedPhrase("bad", now)).toBeUndefined();
  });
});

describe("CodebasePane", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.removeItem("locus.prInboxListWidth");
    localStorage.removeItem("locus.issueInboxListWidth");
    clearPullCaches();
    clearIssueCaches();
    vi.mocked(api.createSession).mockReset();
    vi.restoreAllMocks();
  });

  function render(
    state = { ...initialState, section: "codebase" as const },
    dispatch: (action: Action) => void = () => undefined,
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const node: ReactNode = (
      <Store.Provider value={{ state, dispatch }}>
        <CodebasePane />
      </Store.Provider>
    );
    act(() => {
      root.render(node);
    });
  }

  it("shows link and import when no repo is selected", () => {
    render();
    expect(host.textContent).toContain("Link a repository");
    expect(host.textContent).toContain("Import from Git");
    expect(host.textContent).toContain(
      "Catalog a GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps repo",
    );
    expect(host.textContent).not.toContain("no repository linked");
    expect(host.querySelector(".codebase-pane > .codebase-head")).toBeNull();
    expect(host.querySelector(".codebase-empty")).toBeTruthy();
    expect(
      host.querySelector(".codebase-empty [data-testid='locus-mascot']")?.getAttribute("data-pose"),
    ).toBe("rest");
  });

  it("imports GitHub repos into a searchable picker and links the selection", async () => {
    const created: LinkedRepo = {
      ...repo,
      id: "r-new",
      name: "Modsofthenation/Locus",
      checkout: {
        forge: "github",
        url: "https://github.com/Modsofthenation/Locus.git",
      },
    };
    vi.mocked(api.importRepos).mockResolvedValueOnce({
      accounts: [
        {
          accountId: "gh1",
          accountName: "Ada (Locus)",
          kind: "github",
          repos: [
            {
              forge: "github",
              accountId: "gh1",
              accountName: "Ada (Locus)",
              owner: "Modsofthenation",
              name: "Locus",
              url: "https://github.com/Modsofthenation/Locus.git",
              private: true,
            },
            {
              forge: "github",
              accountId: "gh1",
              accountName: "Ada (Locus)",
              owner: "Modsofthenation",
              name: "docs-site",
              url: "https://github.com/Modsofthenation/docs-site.git",
            },
          ],
        },
      ],
    });
    vi.mocked(api.linkRepo).mockResolvedValue(created);
    const actions: Action[] = [];
    render({ ...initialState, section: "codebase" }, (action) => {
      actions.push(action);
    });
    const importBtn = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Import from Git",
    );
    await act(async () => {
      importBtn!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='import-accounts']")).toBeTruthy();
    expect(host.querySelector(".codebase-empty.has-import")).toBeTruthy();
    expect(host.querySelector("[aria-label='Search repositories']")).toBeTruthy();
    expect(host.querySelector(".import-owner-name")?.textContent).toBe("Modsofthenation");
    expect(host.querySelector(".import-private")?.textContent).toMatch(/private/);
    const search = host.querySelector("[aria-label='Search repositories']") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "local");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("[aria-label='Modsofthenation/Locus']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Modsofthenation/docs-site']")).toBeNull();
    act(() => {
      (
        host.querySelector("[aria-label='Modsofthenation/Locus']") as HTMLInputElement
      ).click();
    });
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Link selected (1)")!
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.linkRepo).toHaveBeenCalledWith({
      url: "https://github.com/Modsofthenation/Locus.git",
      name: "Modsofthenation/Locus",
      accountId: "gh1",
    });
    expect(actions).toEqual(
      expect.arrayContaining([
        { type: "repo", repo: created },
        { type: "selectRepo", id: "r-new" },
      ]),
    );
    expect(host.querySelector("[data-testid='import-accounts']")).toBeNull();
  });

  it("shows an import skeleton while Git remotes load", async () => {
    vi.mocked(api.importRepos).mockImplementationOnce(
      () => new Promise(() => undefined) as Promise<never>,
    );
    render();
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Import from Git")!
        .click();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='import-skeleton']")).toBeTruthy();
    expect(host.querySelector(".codebase-empty.has-import")).toBeTruthy();
  });

  it("deep-links Add a GitHub token to Settings → Git when no forge is connected", () => {
    const actions: Action[] = [];
    render({ ...initialState, section: "codebase" }, (action) => {
      actions.push(action);
    });
    const add = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Add a GitHub token",
    );
    expect(add).toBeTruthy();
    act(() => {
      add!.click();
    });
    expect(actions).toContainEqual({ type: "settings", open: true });
    expect(actions).toContainEqual({ type: "settingsTab", tab: "git" });
  });

  it("hides Add a GitHub token on the empty codebase once a forge token is present", () => {
    render({
      ...initialState,
      section: "codebase",
      config: {
        theme: "ember",
        providers: [],
        templates: [],
        hardwareProfiles: [],
        forges: [
          {
            id: "gh1",
            kind: "github",
            name: "GitHub",
            apiBaseUrl: "https://api.github.com",
            token: "ghp_test",
          },
        ],
        advanced: {
          dataDir: "/tmp",
          qemuBinary: "qemu-system-x86_64",
          swtpmBinary: "swtpm",
          ovmfCodePath: "",
          ovmfVarsPath: "",
          maxConcurrentVms: 4,
          defaultAcceleratorAuto: true,
          logLevel: "info",
          bindHost: "127.0.0.1",
          bindPort: 7420,
          openBrowserOnStart: true,
          hostSharePath: "",
        },
      },
    });
    expect(host.textContent).toContain("Link a repository");
    expect(host.textContent).not.toContain("Add a GitHub token");
  });

  it("opens Settings → Git from the pull-request token notice", () => {
    const actions: Action[] = [];
    render(
      {
        ...initialState,
        section: "codebase",
        repos: [repo],
        selectedRepoId: "r1",
      },
      (action) => {
        actions.push(action);
      },
    );
    expect(host.textContent).toContain("add a GitHub token in Settings → Git");
    const open = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Open Git settings",
    );
    expect(open).toBeTruthy();
    act(() => {
      open!.click();
    });
    expect(actions).toContainEqual({ type: "settings", open: true });
    expect(actions).toContainEqual({ type: "settingsTab", tab: "git" });
  });

  it("shows a forge JSON dump as an error banner with Git settings", async () => {
    vi.mocked(api.repoPulls).mockRejectedValueOnce(
      new Error(
        '{"type": "error", "error": {"message": "Token is invalid, expired, or not supported for this endpoint."}}',
      ),
    );
    const actions: Action[] = [];
    render(
      {
        ...initialState,
        section: "codebase",
        repos: [{ ...repo, checkout: { ...repo.checkout, forge: "bitbucket" } }],
        selectedRepoId: "r1",
        config: {
          theme: "ember",
          providers: [],
          templates: [],
          hardwareProfiles: [],
          forges: [
            {
              id: "bb1",
              kind: "bitbucket",
              name: "Bitbucket",
              apiBaseUrl: "https://api.bitbucket.org/2.0",
              token: "dead",
            },
          ],
          advanced: {
            dataDir: "/tmp",
            qemuBinary: "qemu-system-x86_64",
            swtpmBinary: "swtpm",
            ovmfCodePath: "",
            ovmfVarsPath: "",
            maxConcurrentVms: 4,
            defaultAcceleratorAuto: true,
            logLevel: "info",
            bindHost: "127.0.0.1",
            bindPort: 7420,
            openBrowserOnStart: true,
            hostSharePath: "",
          },
        },
      },
      (action) => {
        actions.push(action);
      },
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const banner = host.querySelector(".error-row");
    expect(banner?.getAttribute("role")).toBe("alert");
    expect(banner?.textContent).toContain(
      "Token is invalid, expired, or not supported for this endpoint.",
    );
    expect(banner?.textContent).not.toContain('"type": "error"');
    const git = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Open Git settings" && btn.closest(".error-row"),
    );
    expect(git).toBeTruthy();
    act(() => {
      git!.click();
    });
    expect(actions).toContainEqual({ type: "settings", open: true });
    expect(actions).toContainEqual({ type: "settingsTab", tab: "git" });
  });

  it("does not offer Git settings on a non-auth codebase error", async () => {
    vi.mocked(api.repoPulls).mockRejectedValueOnce(new Error("inbox down"));
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      config: {
        theme: "ember",
        providers: [],
        templates: [],
        hardwareProfiles: [],
        forges: [
          {
            id: "gh1",
            kind: "github",
            name: "GitHub",
            apiBaseUrl: "https://api.github.com",
            token: "ghp_test",
          },
        ],
        advanced: {
          dataDir: "/tmp",
          qemuBinary: "qemu-system-x86_64",
          swtpmBinary: "swtpm",
          ovmfCodePath: "",
          ovmfVarsPath: "",
          maxConcurrentVms: 4,
          defaultAcceleratorAuto: true,
          logLevel: "info",
          bindHost: "127.0.0.1",
          bindPort: 7420,
          openBrowserOnStart: true,
          hostSharePath: "",
        },
      },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".error-row")?.textContent).toContain("inbox down");
    expect(host.querySelector(".error-row")?.textContent).not.toContain("Open Git settings");
  });

  it("shows repo overview stats", () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
    });
    expect(host.textContent).toContain("acme/app");
    expect(host.querySelector(".repo-stats")?.textContent).toContain("Open PRs");
    expect(host.textContent).toContain("https://github.com/acme/app.git");
    expect(host.querySelector('[aria-label="Repo actions"]')).toBeTruthy();
    const badge = host.querySelector(".codebase-head .forge-badge");
    expect(badge?.textContent).toBe("GitHub");
    expect(badge?.classList.contains("github")).toBe(true);
    expect(host.querySelector(".codebase-title")).toBeNull();
    expect(host.querySelector(".codebase-head h2")).toBeNull();
  });

  it("renders the review inbox as a summary table", async () => {
    vi.mocked(api.repoPulls).mockResolvedValueOnce([
      {
        repoId: "r1",
        forge: "github",
        number: 12,
        title: "Fix the diff viewer",
        state: "open",
        headRef: "feature/diff",
        baseRef: "main",
        headSha: "abcdef123456",
        url: "https://github.com/acme/app/pull/12",
        author: "damon",
        draft: true,
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2020-01-02T00:00:00.000Z",
        commentCount: 5,
        reviewCount: 4,
        checkState: "success",
      },
      {
        repoId: "r1",
        forge: "github",
        number: 11,
        title: "Second open PR",
        state: "open",
        headRef: "feature/two",
        baseRef: "main",
        headSha: "fedcba654321",
        url: "https://github.com/acme/app/pull/11",
        author: "damon",
        updatedAt: "2020-01-01T00:00:00.000Z",
        checkState: "failure",
      },
    ]);
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelectorAll(".pr-table-row")).toHaveLength(2);
    expect(host.querySelector(".pr-table-head")?.textContent).toContain("Summary");
    expect(host.querySelector(".pr-table-head")?.textContent).toContain("Created");
    expect(host.querySelector(".pr-table-head")?.textContent).toContain("Activity");
    expect(host.querySelector(".pr-table-head")?.textContent).toContain("Reviewers");
    expect(host.querySelector(".pr-table-head")?.textContent).toContain("Builds");
    expect(host.querySelector(".pr-draft-badge")?.textContent).toBe("Draft");
    expect(host.querySelector(".pr-summary-branches")?.textContent).toMatch(/feature\/diff/);
    expect(host.querySelector(".pr-summary-branches")?.textContent).toMatch(/main/);
    expect(host.textContent).toContain("No reviewers");
    expect(host.querySelector(".pr-table-builds.ok")).toBeTruthy();
    expect(host.querySelector(".pr-table-builds.bad")).toBeTruthy();
    expect(css).toMatch(/\.pr-table-head/);
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\) 118px/);
  });

  it("puts Bitbucket in a badge beside the repo name", () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [
        {
          ...repo,
          checkout: { forge: "bitbucket", url: "https://bitbucket.org/acme/app.git", ref: "main" },
        },
      ],
      selectedRepoId: "r1",
    });
    const badge = host.querySelector(".codebase-head .forge-badge");
    expect(badge?.textContent).toBe("Bitbucket");
    expect(badge?.classList.contains("bitbucket")).toBe(true);
  });

  it("saves a per-repo review prompt from Settings", async () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
    });
    act(() => {
      const settings = [...host.querySelectorAll(".codebase-tabs button")].find(
        (btn) => btn.textContent === "Settings",
      );
      (settings as HTMLButtonElement).click();
    });
    expect(host.textContent).toContain("Review prompt");
    const autoReview = [...host.querySelectorAll("label")].find((el) =>
      el.textContent?.includes("Auto-review new pull requests"),
    );
    expect(autoReview?.classList.contains("check")).toBe(true);
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "No new public APIs.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const save = [...host.querySelectorAll("button")].find((b) => b.textContent === "Save");
      save!.click();
      await Promise.resolve();
    });
    expect(api.patchRepo).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ reviewPrompt: "No new public APIs." }),
    );
  });

  it("unlinks the selected repo from the header after confirm", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const dispatch = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: { ...initialState, section: "codebase", repos: [repo], selectedRepoId: "r1" },
            dispatch,
          }}
        >
          <CodebasePane />
        </Store.Provider>,
      );
    });
    await act(async () => {
      (host.querySelector('[aria-label="Repo actions"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    const unlink = [...host.querySelectorAll(".menu-item")].find((el) =>
      el.textContent?.includes("Unlink"),
    ) as HTMLButtonElement;
    await act(async () => {
      unlink.click();
      await Promise.resolve();
    });
    expect(api.deleteRepo).toHaveBeenCalledWith("r1");
    expect(dispatch).toHaveBeenCalledWith({ type: "repoDeleted", id: "r1" });
  });

  it("renders a pull request with a structured diff", () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    expect(host.textContent).toContain("Fix the diff viewer");
    expect(host.querySelector(".pr-state-chip")?.textContent).toBe("open");
    expect(host.textContent).toContain("feature/diff");
    expect(host.querySelector(".pr-inline-meta")?.textContent).toMatch(/FILES/);
    act(() => {
      const files = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Files"),
      );
      (files as HTMLButtonElement).click();
    });
    expect(host.querySelector("[data-testid='patch-card']")).toBeTruthy();
    expect(host.querySelector(".patch-line.add")?.textContent).toContain("new");
    expect(host.textContent).toContain("Click a diff line to comment");
    act(() => {
      (host.querySelector(".patch-line.add") as HTMLButtonElement).click();
    });
    expect(host.querySelector(".pr-inline-comment")?.textContent).toContain("src/app.ts:2");
  });

  it("does not nest Review with agent inside the PR open button", async () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector(".pr-inbox-split")).toBeTruthy();
    expect(host.querySelector("button.pr-row")).toBeNull();
    expect(host.querySelector(".pr-inbox-item.active")?.textContent).toContain(
      "Fix the diff viewer",
    );
    expect(host.querySelector(".pr-inbox-item .btn")).toBeNull();
    expect(host.querySelector(".pr-detail .btn.primary")?.textContent).toContain(
      "Review with agent",
    );
    expect(host.querySelector(".pr-summary-text")).toBeNull();
    expect(host.textContent).toContain("No agent summary yet");
    expect(host.textContent).toContain("Fix with agent");
  });

  it("continues the bound agent and starts a fix session from a PR", async () => {
    const bound: AgentSession = {
      id: "a1",
      title: "acme/app",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "p",
      model: "grok-4",
      status: "idle",
      runtime: "docker",
      repoId: "r1",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    vi.mocked(api.startRepoAgent).mockResolvedValue(bound);
    vi.mocked(api.startFixSession).mockResolvedValue({
      ...bound,
      id: "a-fix",
      title: "Fix #12 · acme/app",
      pull: {
        number: 12,
        url: pull.url,
        title: pull.title,
        headRef: pull.headRef,
        baseRef: pull.baseRef,
      },
    });
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
      sessions: [bound],
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector(".codebase-head .btn.primary")?.textContent).toBe("Continue");
    expect(
      [...host.querySelectorAll(".codebase-head .btn")].some(
        (el) => el.textContent === "Open in IDE",
      ),
    ).toBe(true);
    await act(async () => {
      (host.querySelector('.codebase-head [aria-label="Repo actions"]') as HTMLElement).click();
    });
    expect([...host.querySelectorAll(".menu-item")].map((el) => el.textContent)).toEqual(
      expect.arrayContaining(["New agent", "Open product", "Setup environment"]),
    );
    const continueBtn = [...host.querySelectorAll(".codebase-head .btn")].find(
      (btn) => btn.textContent === "Continue",
    );
    await act(async () => {
      (continueBtn as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(api.startRepoAgent).toHaveBeenCalledWith("r1", { startVm: true, reuse: true });
    vi.mocked(api.startRepoAgent).mockClear();
    const openProduct = [...host.querySelectorAll(".menu-item")].find(
      (btn) => btn.textContent === "Open product",
    );
    await act(async () => {
      (openProduct as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(api.startRepoAgent).toHaveBeenCalledWith("r1", { startVm: true, reuse: true });

    const fixBtn = [...host.querySelectorAll(".pr-detail .btn")].find(
      (btn) => btn.textContent === "Fix with agent",
    );
    await act(async () => {
      (fixBtn as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(api.startFixSession).toHaveBeenCalledWith("r1", 12);
  });

  it("opens an existing IDE workspace for the repo", async () => {
    const ide: AgentSession = {
      id: "ide1",
      title: "app",
      os: "ubuntu",
      templateId: "host",
      providerId: "p",
      model: "grok-4",
      status: "idle",
      kind: "ide",
      runtime: "host",
      repoId: "r1",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const actions: Action[] = [];
    render(
      {
        ...initialState,
        section: "codebase",
        repos: [repo],
        selectedRepoId: "r1",
        sessions: [ide],
      },
      (action) => actions.push(action),
    );
    await act(async () => {
      await Promise.resolve();
    });
    const openIde = [...host.querySelectorAll(".codebase-head .btn")].find(
      (btn) => btn.textContent === "Open in IDE",
    );
    expect(openIde).toBeTruthy();
    await act(async () => {
      (openIde as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(api.createSession).not.toHaveBeenCalled();
    expect(actions).toEqual(expect.arrayContaining([{ type: "select", id: "ide1" }]));
  });

  it("opens a pull request in the existing IDE workspace", async () => {
    const ide: AgentSession = {
      id: "ide1",
      title: "app",
      os: "ubuntu",
      templateId: "host",
      providerId: "p",
      model: "grok-4",
      status: "idle",
      kind: "ide",
      runtime: "host",
      repoId: "r1",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const actions: Action[] = [];
    const opened: unknown[] = [];
    const onOpen = (event: Event) => {
      opened.push((event as CustomEvent).detail);
    };
    window.addEventListener("locus:workspace-open-pr", onOpen);
    render(
      {
        ...initialState,
        section: "codebase",
        repos: [repo],
        selectedRepoId: "r1",
        selectedPullNumber: 12,
        activePull: pull,
        sessions: [ide],
      },
      (action) => actions.push(action),
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      (host.querySelector('.pr-detail [aria-label="Pull request actions"]') as HTMLElement).click();
    });
    const openPr = [...host.querySelectorAll(".menu-item")].find(
      (btn) => btn.textContent === "Open PR in IDE",
    );
    expect(openPr).toBeTruthy();
    await act(async () => {
      (openPr as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.workspaceGitFetch).toHaveBeenCalledWith("ide1");
    expect(api.workspaceGitCheckout).toHaveBeenCalledWith("ide1", "feature/diff");
    expect(actions).toEqual(expect.arrayContaining([{ type: "select", id: "ide1" }]));
    expect(opened).toEqual([
      expect.objectContaining({
        sessionId: "ide1",
        files: ["src/app.ts"],
        focus: { path: "src/app.ts", line: 1 },
        comments: [],
      }),
    ]);
    window.removeEventListener("locus:workspace-open-pr", onOpen);
  });

  it("shows clone progress on the pull request while Open PR in IDE clones a large repo", async () => {
    const created: AgentSession = {
      id: "ide-new",
      title: "app",
      os: "ubuntu",
      templateId: "host",
      providerId: "p",
      model: "grok-4",
      status: "idle",
      kind: "ide",
      runtime: "host",
      repoId: "r1",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    let releaseCreate: (session: AgentSession) => void = () => undefined;
    vi.mocked(api.createSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCreate = resolve;
        }),
    );
    let state = {
      ...initialState,
      section: "codebase" as const,
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
      config: {
        theme: "ember" as const,
        providers: [],
        templates: [],
        hardwareProfiles: [],
        forges: [],
        advanced: {
          dataDir: "/tmp",
          qemuBinary: "qemu-system-x86_64",
          swtpmBinary: "swtpm",
          ovmfCodePath: "",
          ovmfVarsPath: "",
          maxConcurrentVms: 4,
          defaultAcceleratorAuto: true,
          logLevel: "info" as const,
          bindHost: "127.0.0.1",
          bindPort: 7420,
          openBrowserOnStart: true,
          hostSharePath: "",
        },
      },
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const paint = () => {
      act(() => {
        root.render(
          <Store.Provider value={{ state, dispatch: () => undefined }}>
            <CodebasePane />
          </Store.Provider>,
        );
      });
    };
    paint();
    await act(async () => {
      await Promise.resolve();
    });
    const openFile = [...host.querySelectorAll(".pr-open-ide")].find(
      (btn) => btn.textContent === "Open in IDE",
    );
    expect(openFile).toBeTruthy();
    await act(async () => {
      (openFile as HTMLButtonElement).click();
    });
    const banner = host.querySelector("[data-testid=pr-ide-opening]");
    expect(banner?.getAttribute("data-cloning")).toBe("true");
    expect(banner?.textContent).toContain("Cloning acme/app");
    expect(host.querySelector("[data-testid=clone-progress]")?.textContent).toContain("Starting");
    expect(host.querySelector("[data-testid=clone-progress]")?.textContent).toMatch(
      /pull request opens in the IDE when the clone finishes/i,
    );
    expect(host.querySelector(".clone-card-bar")?.className).toContain("is-wait");
    expect((openFile as HTMLButtonElement).disabled).toBe(true);
    expect(openFile?.textContent).toBe("Cloning…");
    expect(
      [...host.querySelectorAll(".codebase-head .btn")].some(
        (btn) => btn.textContent === "Cloning…",
      ),
    ).toBe(true);

    state = {
      ...state,
      sessions: [created],
      cloneProgress: {
        "ide-new": {
          percent: 36,
          phase: "Receiving objects",
          phasePercent: 45,
          received: 90,
          total: 200,
          rate: "800.00 KiB/s",
        },
      },
    };
    paint();
    const card = host.querySelector("[data-testid=clone-progress]");
    expect(card?.textContent).toContain("36%");
    expect(card?.textContent).toContain("Receiving objects 45%");
    expect(card?.textContent).toContain("90/200");
    expect(host.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("36");
    expect(host.querySelector(".pr-detail")?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      releaseCreate(created);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid=pr-ide-opening]")).toBeNull();
    expect(api.workspaceGitCheckout).toHaveBeenCalledWith("ide-new", "feature/diff");
    expect(
      [...host.querySelectorAll(".pr-open-ide")].some((btn) => btn.textContent === "Open in IDE"),
    ).toBe(true);
    vi.mocked(api.createSession).mockReset();
  });

  it("shows checkout progress on the pull request while Open PR in IDE waits on a large repo", async () => {
    const ide: AgentSession = {
      id: "ide1",
      title: "app",
      os: "ubuntu",
      templateId: "host",
      providerId: "p",
      model: "grok-4",
      status: "idle",
      kind: "ide",
      runtime: "host",
      repoId: "r1",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    let releaseCheckout: (status: {
      branch: string;
      ahead: number;
      behind: number;
      files: [];
    }) => void = () => undefined;
    vi.mocked(api.workspaceGitCheckout).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseCheckout = resolve;
        }),
    );
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
      sessions: [ide],
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      (host.querySelector('.pr-detail [aria-label="Pull request actions"]') as HTMLElement).click();
    });
    const openPr = [...host.querySelectorAll(".menu-item")].find(
      (btn) => btn.textContent === "Open PR in IDE",
    );
    await act(async () => {
      (openPr as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const banner = host.querySelector("[data-testid=pr-ide-opening]");
    expect(banner?.textContent).toContain("Checking out feature/diff");
    expect(banner?.getAttribute("data-cloning")).toBeNull();
    expect(host.querySelector("[data-testid=clone-progress]")).toBeNull();
    expect(host.querySelector(".pr-detail")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      (host.querySelector('.pr-detail [aria-label="Pull request actions"]') as HTMLElement).click();
    });
    const pending = [...host.querySelectorAll(".menu-item")].find(
      (btn) => btn.textContent === "Opening…",
    );
    expect((pending as HTMLButtonElement | undefined)?.disabled).toBe(true);
    expect(
      [...host.querySelectorAll(".pr-open-ide")].every((btn) => btn.textContent === "Opening…"),
    ).toBe(true);
    await act(async () => {
      releaseCheckout({ branch: "feature/diff", ahead: 0, behind: 0, files: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid=pr-ide-opening]")).toBeNull();
  });

  it("opens a review comment in the IDE from the conversation thread", async () => {
    const ide: AgentSession = {
      id: "ide1",
      title: "app",
      os: "ubuntu",
      templateId: "host",
      providerId: "p",
      model: "grok-4",
      status: "idle",
      kind: "ide",
      runtime: "host",
      repoId: "r1",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const opened: unknown[] = [];
    const onOpen = (event: Event) => {
      opened.push((event as CustomEvent).detail);
    };
    window.addEventListener("locus:workspace-open-pr", onOpen);
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
      sessions: [ide],
    });
    act(() => {
      const conversation = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Conversation"),
      );
      (conversation as HTMLButtonElement).click();
    });
    const openComment = [...host.querySelectorAll(".pr-comments .pr-open-ide")].find(
      (btn) => btn.textContent === "Open in IDE",
    );
    expect(openComment).toBeTruthy();
    await act(async () => {
      (openComment as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(opened).toEqual([
      expect.objectContaining({
        sessionId: "ide1",
        focus: { path: "src/app.ts", line: 1 },
      }),
    ]);
    window.removeEventListener("locus:workspace-open-pr", onOpen);
  });

  it("starts a setup-environment agent from the repo header", async () => {
    const setup: AgentSession = {
      id: "a-setup",
      title: "Setup environment · acme/app",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "p",
      model: "grok-4",
      status: "idle",
      runtime: "docker",
      kind: "setup",
      repoId: "r1",
      messages: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    vi.mocked(api.startSetupSession).mockResolvedValue(setup);
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
    });
    await act(async () => {
      (host.querySelector('.codebase-head [aria-label="Repo actions"]') as HTMLElement).click();
    });
    const setupBtn = [...host.querySelectorAll(".menu-item")].find(
      (btn) => btn.textContent === "Setup environment",
    );
    await act(async () => {
      (setupBtn as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(api.startSetupSession).toHaveBeenCalledWith("r1");
  });

  it("filters the PR inbox by open, draft, and all including Bitbucket drafts", async () => {
    const openRow = {
      repoId: "r1",
      forge: "bitbucket" as const,
      number: 9,
      title: "Ready PR",
      state: "open" as const,
      headRef: "feat",
      baseRef: "main",
      headSha: "abc",
      url: "https://bitbucket.org/acme/app/pull-requests/9",
      updatedAt: "2020-01-02T00:00:00.000Z",
    };
    const draftRow = {
      ...openRow,
      number: 8,
      title: "WIP PR",
      state: "draft" as const,
      draft: true,
      url: "https://bitbucket.org/acme/app/pull-requests/8",
    };
    vi.mocked(api.repoPulls).mockImplementation(async (_id, state = "open") => {
      if (state === "draft") return [draftRow];
      return [openRow, draftRow];
    });
    render({
      ...initialState,
      section: "codebase",
      repos: [
        {
          ...repo,
          checkout: { forge: "bitbucket", url: "https://bitbucket.org/acme/app.git", ref: "main" },
        },
      ],
      selectedRepoId: "r1",
    });
    await act(async () => {
      const tab = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Pull requests"),
      );
      (tab as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(selectOptionValues(host, "Pull request filter")).toEqual(["open", "draft", "all"]);
    expect(host.querySelectorAll(".pr-inbox-item")).toHaveLength(2);
    expect(host.textContent).toContain("1 draft");
    expect(
      [...host.querySelectorAll(".pr-draft-badge")].some((el) => el.textContent === "Draft"),
    ).toBe(true);

    await act(async () => {
      setSelectValue(host, "Pull request filter", "draft");
      await Promise.resolve();
    });
    expect(api.repoPulls).toHaveBeenCalledWith("r1", "draft");
    expect(host.querySelectorAll(".pr-inbox-item")).toHaveLength(1);
    expect(host.querySelector(".pr-inbox-item")?.textContent).toContain("WIP PR");
  });

  it("opens the Files tab from the overview changed-file list", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    expect(host.querySelector("[data-testid='patch-card']")).toBeNull();
    await act(async () => {
      const row = [...host.querySelectorAll(".pr-changed-files button")].find((btn) =>
        btn.textContent?.includes("src/app.ts"),
      );
      (row as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='patch-card']")).toBeTruthy();
    expect(host.querySelector(".patch-line.add")?.textContent).toContain("new");
    expect(host.querySelector('.pr-file-nav [data-path="src/app.ts"]')?.className).toContain("on");
  });

  it("nests changed files in a filterable explorer tree", async () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: {
        ...pull,
        files: [
          {
            path: "src/app.ts",
            status: "modified",
            patch: "@@ -1,2 +1,2 @@\n keep\n-old\n+new",
          },
          {
            path: "src/lib/util.ts",
            status: "added",
            patch: "@@ -0,0 +1,1 @@\n+export const n = 1;\n",
          },
          {
            path: "README.md",
            status: "modified",
            patch: "@@ -1,1 +1,1 @@\n-old\n+new",
          },
        ],
      },
    });
    await act(async () => {
      const files = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Files"),
      );
      (files as HTMLButtonElement).click();
    });
    expect(host.querySelector(".pr-file-nav .workspace-tree-head")?.textContent).toMatch(
      /EXPLORER/,
    );
    expect(host.querySelector(".pr-file-nav .workspace-filter")?.getAttribute("placeholder")).toBe(
      "Filter files...",
    );
    expect(host.querySelector(".pr-file-nav .search-icon svg")).toBeTruthy();
    expect(host.querySelector('[data-path="src/app.ts"]')?.textContent).toContain("app.ts");
    expect(host.querySelector('[data-path="src/lib/util.ts"]')?.textContent).toContain("util.ts");
    expect(host.querySelector('[data-path="README.md"]')?.textContent).toContain("README.md");
    expect(
      [...host.querySelectorAll(".pr-file-nav .workspace-tree-row.dir")].map((el) =>
        el.textContent?.trim(),
      ),
    ).toEqual(["src/", "lib/"]);
    expect(host.querySelector(".pr-file-nav .workspace-tree-foot")?.textContent).toMatch(/3 files/);
    expect(host.querySelector(".pr-file-nav .workspace-tree-foot")?.textContent).toMatch(/\+3/);

    const filter = host.querySelector(".pr-file-nav .workspace-filter") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(filter, "readme");
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector('[data-path="README.md"]')).toBeTruthy();
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeNull();
    expect(host.querySelector(".pr-file-nav .hint")?.textContent).toBeUndefined();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(filter, "missing");
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector(".pr-file-nav .hint")?.textContent).toMatch(/No matching files/);

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(filter, "");
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const src = [...host.querySelectorAll(".pr-file-nav .workspace-tree-row.dir")].find((btn) =>
      btn.textContent?.includes("src"),
    ) as HTMLButtonElement;
    act(() => {
      src.click();
    });
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeNull();
    expect(host.querySelector('[data-path="README.md"]')).toBeTruthy();

    act(() => {
      const line = host.querySelector("[data-patch-path='src/app.ts'] .patch-line.clickable");
      (line as HTMLElement).click();
    });
    expect(host.querySelector('[data-path="src/app.ts"]')).toBeTruthy();
    expect(host.querySelector('[data-path="src/app.ts"]')?.className).toContain("on");
  });

  it("expands only the explorer-selected file in the diff pane", () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: {
        ...pull,
        files: [
          {
            path: "src/app.ts",
            status: "modified",
            patch: "@@ -1,2 +1,2 @@\n keep\n-old\n+new",
          },
          {
            path: "README.md",
            status: "modified",
            patch: "@@ -1,1 +1,1 @@\n-old readme\n+new readme",
          },
        ],
      },
    });
    act(() => {
      const files = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Files"),
      );
      (files as HTMLButtonElement).click();
    });
    expect(host.querySelector("[data-patch-path='src/app.ts'] .patch-hunk")).toBeTruthy();
    expect(host.querySelector("[data-patch-path='README.md'] .patch-hunk")).toBeNull();
    act(() => {
      (host.querySelector('[data-path="README.md"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector("[data-patch-path='README.md'] .patch-hunk")?.textContent).toContain(
      "new readme",
    );
    expect(host.querySelector("[data-patch-path='src/app.ts'] .patch-hunk")).toBeNull();
    expect(host.querySelector('[data-path="README.md"]')?.className).toContain("on");
  });

  it("jumps the diff from a nested explorer file", () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    act(() => {
      const files = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Files"),
      );
      (files as HTMLButtonElement).click();
    });
    const patch = host.querySelector("[data-patch-path='src/app.ts']") as HTMLElement;
    const scroll = vi.fn();
    patch.scrollIntoView = scroll;
    act(() => {
      (host.querySelector('[data-path="src/app.ts"]') as HTMLButtonElement).click();
    });
    expect(scroll).toHaveBeenCalled();
    expect(host.querySelector('[data-path="src/app.ts"]')?.className).toContain("on");
  });

  it("opens a LEFT comment on the old side of the hunk", () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    act(() => {
      const conversation = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Conversation"),
      );
      (conversation as HTMLButtonElement).click();
    });
    act(() => {
      const loc = [...host.querySelectorAll(".pr-loc")].find((btn) =>
        btn.textContent?.includes("src/app.ts:2"),
      );
      (loc as HTMLButtonElement).click();
    });
    expect(host.querySelector(".pr-inline-comment")?.textContent).toContain("(old)");
  });

  it("renders GitHub and Bitbucket conversation markdown", () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: {
        ...pull,
        body: "> ## Review skipped\n> Draft detected.\n>\n> <details>\n> <summary>Run configuration</summary>\n>\n> **Plan**: Free\n> </details>\n>\n> [!NOTE]\n> Pro needed for line reviews.",
        comments: [
          {
            id: "bb1",
            body: "> On 2026-01-02, **alice** wrote:\n> Please ~~drop~~ this hunk.\n\nShipped.",
            author: "bob",
            createdAt: "2020-01-02T00:00:00.000Z",
          },
        ],
      },
    });
    act(() => {
      const conversation = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Conversation"),
      );
      (conversation as HTMLButtonElement).click();
    });
    const thread = host.querySelector(".pr-thread");
    expect(thread?.querySelector("h2")?.textContent).toBe("Review skipped");
    expect(thread?.querySelector("blockquote.md-quote")).toBeTruthy();
    expect(thread?.querySelector("details.md-details summary")?.textContent).toBe(
      "Run configuration",
    );
    expect(thread?.querySelector(".md-alert-note")?.textContent).toContain(
      "Pro needed for line reviews.",
    );
    expect(thread?.textContent).not.toContain("> ## Review");
    expect(thread?.querySelector(".pr-comments .pr-md del")?.textContent).toBe("drop");
    expect(thread?.querySelector(".pr-comments .pr-md strong")?.textContent).toBe("alice");
  });

  it("resets the review event when switching pull requests", () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    act(() => {
      const conversation = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Conversation"),
      );
      (conversation as HTMLButtonElement).click();
    });
    act(() => {
      const request = [...host.querySelectorAll(".review-events button")].find((btn) =>
        btn.textContent?.includes("Request changes"),
      );
      (request as HTMLButtonElement).click();
    });
    expect(host.querySelector(".review-events button.active")?.textContent).toBe("Request changes");
    act(() => {
      root.render(
        <Store.Provider
          value={{
            state: {
              ...initialState,
              section: "codebase",
              repos: [repo],
              selectedRepoId: "r1",
              selectedPullNumber: 13,
              activePull: { ...pull, number: 13, title: "Another PR" },
            },
            dispatch: () => undefined,
          }}
        >
          <CodebasePane />
        </Store.Provider>,
      );
    });
    act(() => {
      const conversation = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Conversation"),
      );
      (conversation as HTMLButtonElement).click();
    });
    expect(host.textContent).toContain("Another PR");
    expect(host.querySelector(".review-events button.active")?.textContent).toBe("Comment");
  });

  it("shows a list skeleton while pull requests load", () => {
    vi.mocked(api.repoPulls).mockImplementationOnce(
      () => new Promise(() => undefined) as Promise<never>,
    );
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
    });
    act(() => {
      const tab = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Pull requests"),
      );
      (tab as HTMLButtonElement).click();
    });
    expect(host.querySelector("[data-testid='pr-list-skeleton']")).toBeTruthy();
    expect(host.textContent).not.toContain("No pull requests.");
  });

  it("shows a cached pull list without refetching", async () => {
    vi.mocked(api.repoPulls).mockClear();
    rememberPullList("r1", "open", [
      {
        repoId: "r1",
        forge: "github",
        number: 12,
        title: "Fix the diff viewer",
        state: "open",
        headRef: "feature/diff",
        baseRef: "main",
        headSha: "abcdef123456",
        url: "https://github.com/acme/app/pull/12",
        author: "damon",
        updatedAt: "2020-01-02T00:00:00.000Z",
      },
    ]);
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
    });
    await act(async () => {
      const tab = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Pull requests"),
      );
      (tab as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(api.repoPulls).not.toHaveBeenCalled();
    expect(host.querySelector("[data-testid='pr-list-skeleton']")).toBeNull();
    expect(host.querySelector(".pr-inbox-item")?.textContent).toContain("Fix the diff viewer");
  });

  it("shows a detail skeleton while the selected pull request loads", async () => {
    vi.mocked(api.repoPull).mockImplementationOnce(
      () => new Promise(() => undefined) as Promise<never>,
    );
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='pr-detail-skeleton']")).toBeTruthy();
    expect(host.querySelector(".pr-detail")).toBeNull();
  });

  it("keeps the PR skeleton when an unrelated pane error is set", async () => {
    vi.mocked(api.repoPulls).mockRejectedValueOnce(new Error("inbox down"));
    vi.mocked(api.repoPull).mockImplementationOnce(
      () => new Promise(() => undefined) as Promise<never>,
    );
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toMatch(/inbox down|Could not load pull requests/);
    expect(host.querySelector("[data-testid='pr-detail-skeleton']")).toBeTruthy();
    expect(host.textContent).not.toContain("Could not load this pull request.");
  });

  it("resizes the inbox split from the gutter", async () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    await act(async () => {
      await Promise.resolve();
    });
    const gutter = host.querySelector(".pr-inbox-gutter") as HTMLDivElement;
    expect(gutter).toBeTruthy();
    expect(
      (host.querySelector(".pr-inbox-split") as HTMLElement).style.gridTemplateColumns,
    ).toMatch(/^340px/);
    act(() => {
      gutter.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 340, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 420, pointerId: 1 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 420, pointerId: 1 }),
      );
    });
    expect(
      (host.querySelector(".pr-inbox-split") as HTMLElement).style.gridTemplateColumns,
    ).toMatch(/^420px/);
    expect(localStorage.getItem("locus.prInboxListWidth")).toBe("420");
  });

  it("pins the pane layout in CSS so leaving the pull requests tab cannot reflow chrome", () => {
    expect(css).toMatch(/\.codebase-pane \{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/\.codebase-pane \{[\s\S]*?overflow:\s*hidden/);
    expect(css).toMatch(/\.codebase-pane \{[\s\S]*?padding:\s*0/);
    expect(css).not.toMatch(/\.codebase-pane\.pr-inbox-pane/);
    expect(css).toMatch(/\.codebase-head \{[\s\S]*?flex-shrink:\s*0/);
    expect(css).toMatch(/\.codebase-head \{[\s\S]*?align-items:\s*center/);
    expect(css).toMatch(/\.codebase-title \{[\s\S]*?align-items:\s*center/);
    expect(css).toMatch(/\.codebase-tabs \{[\s\S]*?flex-shrink:\s*0/);
    expect(css).toMatch(/\.pr-detail > \.codebase-tabs \{[\s\S]*?margin:[^}]*18px/);
    expect(css).toMatch(/\.surface-pane-body \{[\s\S]*?gap:\s*var\(--space-2-5\)/);
    expect(css).toMatch(/\.codebase-body \{[\s\S]*?overflow:\s*auto/);
  });

  it("keeps the Stack tab as a three-column grid with the diagram in the diff column", () => {
    expect(css).toMatch(
      /\.pr-stack \{[\s\S]*?grid-template-areas:\s*"toolbar toolbar toolbar"\s*"nav diff rail"/,
    );
    expect(css).not.toMatch(/\.pr-stack\.has-diagram/);
    expect(css).not.toMatch(/\.pr-stack-diagram-band/);
    expect(css).toMatch(/\.pr-stack-diagram svg \{[\s\S]*?width:\s*auto/);
    expect(css).toMatch(/\.pr-stack-diagram svg \{[\s\S]*?max-width:\s*100%/);
    expect(css).toMatch(/\.pr-stack-diagram \{[\s\S]*?max-height:\s*min\(42%, 20rem\)/);
    expect(css).toMatch(/\.pr-stack-diagram \{[\s\S]*?overflow:\s*auto/);
    expect(css).toMatch(/\.pr-stack-diff \{[\s\S]*?overflow:\s*hidden/);
    expect(css).toMatch(/\.pr-stack-diff-files,\s*\.pr-stack-empty \{[\s\S]*?overflow:\s*auto/);
    expect(css).toMatch(/\.pr-stack-diff-files,\s*\.pr-stack-empty \{[\s\S]*?min-height:\s*0/);
    expect(css).toMatch(
      /\.pr-stack-diff-files,\s*\.pr-stack-empty \{[\s\S]*?scrollbar-gutter:\s*stable/,
    );
    expect(css).toMatch(/\.pr-stack-diff-files \.patch-hunk \{[\s\S]*?max-height:\s*none/);
    expect(css).toMatch(/\.patch-file \{[\s\S]*?flex-shrink:\s*0/);
    expect(css).toMatch(/\.patch-file \{[\s\S]*?min-height:\s*32px/);
    expect(css).toMatch(/\.patch-file-head \{[\s\S]*?min-height:\s*32px/);
    expect(css).toMatch(
      /\.pr-stack-nav\[hidden\],\s*\.pr-stack-rail\[hidden\] \{[\s\S]*?display:\s*none/,
    );
  });

  it("keeps the same pane chrome class when leaving the pull requests tab", async () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    await act(async () => {
      await Promise.resolve();
    });
    const pane = host.querySelector(".codebase-pane") as HTMLElement;
    expect(pane.classList.contains("pr-inbox-pane")).toBe(false);
    expect(host.querySelector(".pr-inbox-split")).toBeTruthy();
    const before = pane.className;
    act(() => {
      const overview = [...host.querySelectorAll(".codebase-tabs button")].find(
        (btn) => btn.textContent === "Overview",
      );
      (overview as HTMLButtonElement).click();
    });
    expect(pane.className).toBe(before);
    expect(host.querySelector(".pr-inbox-split")).toBeNull();
    expect(host.querySelector(".repo-stats")).toBeTruthy();
    act(() => {
      const agents = [...host.querySelectorAll(".codebase-tabs button")].find(
        (btn) => btn.textContent === "Agents",
      );
      (agents as HTMLButtonElement).click();
    });
    expect(pane.className).toBe(before);
    act(() => {
      const settings = [...host.querySelectorAll(".codebase-tabs button")].find(
        (btn) => btn.textContent === "Settings",
      );
      (settings as HTMLButtonElement).click();
    });
    expect(pane.className).toBe(before);
  });

  it("opens the PR diff in focus mode and leaves on Escape", async () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector(".pr-inbox-item")).toBeTruthy();
    const expand = host.querySelector(
      '.pr-detail-head button[aria-label="Open diff full screen"]',
    ) as HTMLButtonElement;
    expect(expand).toBeTruthy();
    act(() => {
      expand.click();
    });
    expect(host.querySelector(".codebase-pane.pr-focus")).toBeTruthy();
    expect(host.querySelector(".pr-inbox-split.focused")).toBeTruthy();
    expect(host.querySelector("[data-testid='patch-card']")).toBeTruthy();
    expect((host.querySelector(".pr-inbox-list") as HTMLElement).hidden).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector(".pr-inbox-split.focused")).toBeNull();
    expect((host.querySelector(".pr-inbox-list") as HTMLElement).hidden).toBe(false);
    expect(host.querySelector(".pr-inbox-item")).toBeTruthy();
  });

  it("shows the load path on the PR overview and saves notes for the AI review", async () => {
    vi.mocked(api.repoPullLoadPath).mockResolvedValueOnce({
      risk: "high",
      reasons: [
        "permissions or auth code is on the path",
        "1 untested sink",
        "1 file on the load path",
      ],
      headline: "auth · 1 file · 1 untested sink",
      changeKinds: ["auth"],
      layers: ["permissions"],
      nodes: [
        {
          path: "accounts/permissions.py",
          layer: "permissions",
          kind: "auth",
          symbols: [],
          seed: true,
          sink: true,
          tested: false,
        },
      ],
      traces: [
        {
          seed: "accounts/permissions.py",
          hops: [],
          sinks: [{ path: "accounts/permissions.py", layer: "permissions" }],
        },
      ],
      hops: [],
      untestedSinks: [{ path: "accounts/permissions.py", layer: "permissions", kind: "auth" }],
      readOrder: [{ path: "accounts/permissions.py", why: "permissions auth" }],
      markdown: "## Load path: HIGH\n",
    });
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".pr-loadpath")).toBeTruthy();
    expect(host.querySelector(".loadpath-risk")?.textContent).toMatch(/high/);
    expect(host.textContent).toContain("auth · 1 file · 1 untested sink");
    expect(host.textContent).toContain("Untested sinks");
    expect(host.textContent).toContain("permissions.py");
    expect(host.querySelector('.pr-loadpath [title="accounts/permissions.py"]')).toBeTruthy();
    expect(host.textContent).toContain("Notes for the AI review");
    expect(host.querySelector(".pr-loadpath textarea")).toBeTruthy();
    const save = [...host.querySelectorAll(".pr-loadpath button")].find(
      (btn) => btn.textContent === "Save notes",
    );
    expect(save).toBeTruthy();
    await act(async () => {
      (save as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(api.patchPullLoadPath).toHaveBeenCalledWith("r1", 12, { notes: "" });
  });

  it("renders load path hops as short files and filters traces by layer", async () => {
    vi.mocked(api.repoPullLoadPath).mockResolvedValueOnce({
      risk: "high",
      reasons: [
        "API/schema sinks are mostly untested in this diff",
        "1 test file in the diff",
        "4 files on the load path",
      ],
      headline: "public contract, ui · 4 files · 1 untested sink",
      changeKinds: ["public_contract", "ui"],
      layers: ["api", "ui", "tests"],
      nodes: [
        {
          path: "billing/serializers.py",
          layer: "api",
          kind: "serializer",
          symbols: [],
          seed: true,
          sink: true,
          tested: true,
        },
        {
          path: "frontend/src/InvoicePage.tsx",
          layer: "ui",
          kind: "page",
          symbols: [],
          seed: true,
          sink: true,
          tested: false,
        },
        {
          path: "frontend/src/Badge.tsx",
          layer: "ui",
          kind: "component",
          symbols: [],
          seed: true,
          sink: true,
          tested: true,
        },
        {
          path: "billing/tests.py",
          layer: "tests",
          kind: "unit",
          symbols: [],
          seed: false,
          sink: true,
          tested: false,
        },
      ],
      traces: [
        {
          seed: "billing/serializers.py",
          hops: [
            { path: "frontend/src/InvoicePage.tsx", layer: "ui", via: "imported_by" },
            { path: "billing/tests.py", layer: "tests", via: "tested_by" },
          ],
          sinks: [
            { path: "frontend/src/InvoicePage.tsx", layer: "ui" },
            { path: "billing/tests.py", layer: "tests" },
          ],
        },
        {
          seed: "frontend/src/Badge.tsx",
          hops: [{ path: "frontend/src/Badge.test.tsx", layer: "tests", via: "tested_by" }],
          sinks: [{ path: "frontend/src/Badge.test.tsx", layer: "tests" }],
        },
      ],
      hops: [],
      untestedSinks: [{ path: "frontend/src/InvoicePage.tsx", layer: "ui", kind: "page" }],
      readOrder: [],
      markdown: "## Load path: HIGH\n",
    });
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".loadpath-hops")).toBeTruthy();
    expect(host.textContent).toContain("serializers.py");
    expect(host.textContent).toContain("InvoicePage.tsx");
    expect(host.textContent).toContain("imported by");
    expect(host.textContent).not.toContain("billing/serializers.py");
    expect(host.querySelectorAll(".loadpath-trace").length).toBe(2);
    const apiFilter = [...host.querySelectorAll(".pr-loadpath-layers button")].find(
      (btn) => btn.textContent === "api",
    );
    expect(apiFilter).toBeTruthy();
    act(() => {
      (apiFilter as HTMLButtonElement).click();
    });
    expect(host.querySelectorAll(".loadpath-trace").length).toBe(1);
    expect(host.textContent).toContain("serializers.py");
    expect(host.textContent).not.toContain("Badge.tsx");
  });

  it("opens the Stack tab from the overview change-stack list", async () => {
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".pr-stack-overview")?.textContent).toMatch(/Code \(1 file\)/);
    await act(async () => {
      const row = [...host.querySelectorAll(".pr-stack-overview button")].find((btn) =>
        btn.textContent?.includes("Code"),
      );
      (row as HTMLButtonElement).click();
    });
    expect(host.querySelector("[data-testid='pr-stack']")).toBeTruthy();
    expect(host.querySelector(".pr-stack-nav")?.textContent).toMatch(/Layer 1/);
    expect(host.querySelector("[data-testid='patch-card']")).toBeTruthy();
    expect(host.querySelector(".pr-stack-range-summary")?.textContent).toMatch(/Update app.ts/);
    await act(async () => {
      const comment = [...host.querySelectorAll(".pr-stack-ranges .row-actions button")].find(
        (btn) => btn.textContent === "Comment",
      );
      (comment as HTMLButtonElement).click();
    });
    expect(host.querySelector("[aria-label='Range comment']")).toBeTruthy();
  });

  it("opens the pre-merge board before layer 1 and jumps into the conflict", async () => {
    vi.mocked(api.repoPullLoadPath).mockResolvedValue({
      risk: "high",
      reasons: ["1 untested sink"],
      headline: "auth",
      changeKinds: ["auth"],
      layers: ["permissions"],
      nodes: [
        {
          path: "src/app.ts",
          layer: "permissions",
          kind: "auth",
          symbols: [],
          seed: true,
          sink: true,
          tested: false,
        },
      ],
      traces: [],
      hops: [],
      untestedSinks: [{ path: "src/app.ts", layer: "permissions", kind: "auth" }],
      readOrder: [],
      markdown: "",
    });
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: {
        ...pull,
        checks: [{ name: "ci", status: "failure" }],
        files: [
          {
            path: "src/app.ts",
            status: "modified",
            patch: "@@ -1 +1 @@\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n",
          },
        ],
      },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      const stackTab = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Stack"),
      );
      (stackTab as HTMLButtonElement).click();
    });
    const board = host.querySelector("[data-testid='pr-premerge']");
    expect(board?.textContent).toMatch(/ci/);
    expect(board?.textContent).toMatch(/Conflict markers/);
    expect(board?.textContent).toMatch(/Untested permissions sink/);
    await act(async () => {
      const row = [...host.querySelectorAll("[data-testid='pr-premerge'] li button")].find((btn) =>
        btn.textContent?.includes("Conflict markers"),
      );
      (row as HTMLButtonElement).click();
    });
    expect(host.querySelector(".pr-stack-diff-head")?.textContent).toMatch(/Code/);
    expect(host.querySelector("[data-testid='patch-card']")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    });
    expect(host.querySelector("[data-testid='pr-premerge']")).toBeTruthy();
  });

  it("steps to the next layer with J from the Stack tab", async () => {
    const twoLayer = {
      repoId: "r1",
      number: 12,
      headSha: "abcdef123456",
      generatedAt: "2020-01-02T00:00:00.000Z",
      source: "heuristic" as const,
      cohorts: [
        {
          id: "c1",
          title: "API + Tests (2 files)",
          summary: "public contract",
          layers: [
            {
              id: "c1-l1",
              title: "API",
              intent: "contract",
              fileCount: 1,
              commentCount: 0,
              ranges: [
                {
                  path: "src/app.ts",
                  startLine: 1,
                  endLine: 2,
                  side: "RIGHT" as const,
                  header: "@@ -1,2 +1,2 @@",
                  summary: "Update serializer",
                },
              ],
            },
            {
              id: "c1-l2",
              title: "Tests",
              intent: "tests",
              fileCount: 1,
              commentCount: 0,
              ranges: [
                {
                  path: "src/app.ts",
                  startLine: 1,
                  endLine: 2,
                  side: "RIGHT" as const,
                  header: "@@ -1,2 +1,2 @@",
                  summary: "Cover currency",
                },
              ],
            },
          ],
        },
      ],
      files: [
        { path: "src/app.ts", cohortId: "c1", layerId: "c1-l1" },
        { path: "src/app.ts", cohortId: "c1", layerId: "c1-l2" },
      ],
      markdown: "## Change stack\n",
    };
    vi.mocked(api.repoPullChangeStack).mockResolvedValue(twoLayer);
    vi.mocked(api.summarizePullChangeStack).mockResolvedValue(twoLayer);
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      const stackTab = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Stack"),
      );
      (stackTab as HTMLButtonElement).click();
    });
    expect(host.querySelector("[data-testid='pr-premerge']")?.textContent).toMatch(/Pre-merge/);
    expect(host.querySelector("[data-testid='pr-premerge']")?.textContent).toMatch(/nit: rename/);
    expect(host.querySelector(".pr-stack-diff-head")?.textContent).not.toMatch(/API \+ Tests/);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    });
    expect(host.querySelector(".pr-stack-diff-head")?.textContent).toMatch(/API/);
    expect(host.querySelector("[data-testid='pr-stack-next']")?.textContent).toMatch(/Tests/);
    expect(host.querySelector("[data-testid='pr-stack-progress']")?.textContent).toMatch(/1 \/ 2/);
    expect(host.querySelector(".pr-stack-nav")?.textContent).toMatch(/Contract/);
    expect(host.querySelector(".pr-stack-nav")?.textContent).toMatch(/Layer 1/);
    await act(async () => {
      const comment = [...host.querySelectorAll(".pr-stack-ranges .row-actions button")].find(
        (btn) => btn.textContent === "Comment",
      );
      (comment as HTMLButtonElement).click();
    });
    expect(host.querySelector("[aria-label='Range comment']")).toBeTruthy();
    await act(async () => {
      (host.querySelector("[data-testid='pr-stack-next']") as HTMLButtonElement).click();
    });
    expect(host.querySelector("[aria-label='Range comment']")).toBeFalsy();
    expect(host.querySelector(".pr-stack-diff-head")?.textContent).toMatch(/Tests/);
    expect(host.querySelector("[data-testid='pr-stack-progress']")?.textContent).toMatch(/2 \/ 2/);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    });
    expect(host.querySelector(".pr-stack-diff-head")?.textContent).toMatch(/API/);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    });
    expect(host.querySelector(".pr-stack-diff-head")?.textContent).toMatch(/Tests/);
  });

  it("renders a mermaid diagram and loads a historical snapshot from the dropdown", async () => {
    vi.mocked(api.repoPullChangeStack).mockImplementation(async (_id, _n, opts) => {
      if (opts?.sha === "deadbeefdead") {
        return {
          repoId: "r1",
          number: 12,
          headSha: "deadbeefdead",
          generatedAt: "2020-01-01T00:00:00.000Z",
          source: "heuristic",
          cohorts: [
            {
              id: "c1",
              title: "Old snapshot",
              summary: "previous head",
              layers: [
                {
                  id: "c1-l1",
                  title: "Code",
                  intent: "consumer",
                  fileCount: 1,
                  commentCount: 0,
                  ranges: [
                    {
                      path: "src/app.ts",
                      startLine: 1,
                      endLine: 2,
                      side: "RIGHT",
                      header: "@@ -1,2 +1,2 @@",
                      summary: "Old hunk",
                    },
                  ],
                },
              ],
            },
          ],
          files: [{ path: "src/app.ts", cohortId: "c1", layerId: "c1-l1" }],
          markdown: "## Change stack\n",
        };
      }
      return {
        repoId: "r1",
        number: 12,
        headSha: "abcdef123456",
        generatedAt: "2020-01-02T00:00:00.000Z",
        source: "heuristic+model",
        cohorts: [
          {
            id: "c1",
            title: "Invoice currency",
            summary: "Serializer now exposes currency.",
            layers: [
              {
                id: "c1-l1",
                title: "API",
                intent: "contract",
                fileCount: 1,
                commentCount: 0,
                diagram: {
                  kind: "sequence",
                  mermaid: "sequenceDiagram\n  Client->>API: GET invoice",
                },
                ranges: [
                  {
                    path: "src/app.ts",
                    startLine: 1,
                    endLine: 2,
                    side: "RIGHT",
                    header: "@@ -1,2 +1,2 @@",
                    summary: "Add currency to the serializer.",
                  },
                ],
              },
            ],
          },
        ],
        files: [{ path: "src/app.ts", cohortId: "c1", layerId: "c1-l1" }],
        markdown: "## Change stack\n",
      };
    });
    vi.mocked(api.summarizePullChangeStack).mockImplementation(async () =>
      api.repoPullChangeStack("r1", 12),
    );
    vi.mocked(api.listPullChangeStackRevisions).mockResolvedValue({
      revisions: [
        {
          headSha: "abcdef123456",
          generatedAt: "2020-01-02T00:00:00.000Z",
          source: "heuristic+model",
          current: true,
        },
        {
          headSha: "deadbeefdead",
          generatedAt: "2020-01-01T00:00:00.000Z",
          source: "heuristic",
        },
      ],
    });
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
      selectedPullNumber: 12,
      activePull: pull,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      const stackTab = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Stack"),
      );
      (stackTab as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='pr-premerge']")).toBeTruthy();
    await act(async () => {
      const layer = [...host.querySelectorAll(".pr-stack-cohort button")].find((btn) =>
        btn.textContent?.includes("Layer 1"),
      );
      (layer as HTMLButtonElement).click();
    });
    const diagram = host.querySelector("[data-testid='pr-stack-diagram']");
    expect(diagram?.innerHTML).toMatch(/Client/);
    expect(host.querySelector(".pr-stack-diff [data-testid='pr-stack-diagram']")).toBe(diagram);
    expect(
      host.querySelector("[data-testid='pr-stack-diff-files'] [data-testid='patch-card']"),
    ).toBeTruthy();
    expect(host.querySelector(".pr-stack-diagram-band")).toBeNull();
    expect(host.querySelector(".pr-stack")?.classList.contains("has-diagram")).toBe(false);
    expect(host.querySelector(".pr-stack-diagram-caption")?.textContent).toMatch(/Call flow/);
    expect(host.querySelector(".pr-stack-range-summary")?.textContent).toMatch(/Add currency/);
    expect(host.querySelector("[data-testid='pr-stack-revision']")).toBeTruthy();
    await act(async () => {
      setSelectValue(host, "Change stack snapshot", "deadbeefdead");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".pr-stack-diff-head")?.textContent).toMatch(/Old snapshot/);
    expect(host.querySelector(".pr-stack-stale")).toBeTruthy();
  });

  it("opens the Issues inbox, filters, and posts a comment", async () => {
    const dispatch = vi.fn();
    render(
      {
        ...initialState,
        section: "codebase",
        repos: [{ ...repo, openIssueCount: 1 }],
        selectedRepoId: "r1",
        selectedIssueNumber: 7,
        activeIssue: {
          repoId: "r1",
          forge: "github",
          number: 7,
          title: "Login 500",
          state: "open",
          url: "https://github.com/acme/app/issues/7",
          author: "ada",
          labels: ["bug"],
          updatedAt: "2020-01-02T00:00:00.000Z",
          body: "stack overflow",
          comments: [
            {
              id: "c1",
              body: "repro on main",
              author: "sam",
              createdAt: "2020-01-02T00:00:00.000Z",
            },
          ],
        },
      },
      dispatch,
    );
    await act(async () => {
      const tab = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Issues"),
      );
      (tab as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".issue-inbox-split")).toBeTruthy();
    expect(host.querySelector(".pr-inbox-item.active")?.textContent).toContain("Login 500");
    expect(host.textContent).toContain("stack overflow");
    expect(host.textContent).toContain("repro on main");
    expect(selectOptionValues(host, "Issue filter")).toEqual(["open", "closed", "all"]);
    await act(async () => {
      setSelectValue(host, "Issue filter", "closed");
      await Promise.resolve();
    });
    expect(api.repoIssues).toHaveBeenCalledWith("r1", "closed");
    const textarea = host.querySelector(".pr-composer textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "ship it");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      (host.querySelector(".pr-composer .btn") as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.commentIssue).toHaveBeenCalledWith("r1", 7, { body: "ship it" });
  });

  it("reuses a cached issue list when opening the Issues tab", async () => {
    rememberIssueList("r1", "open", [
      {
        repoId: "r1",
        forge: "github",
        number: 7,
        title: "Cached issue",
        state: "open",
        url: "https://github.com/acme/app/issues/7",
        updatedAt: "2020-01-02T00:00:00.000Z",
      },
    ]);
    render({
      ...initialState,
      section: "codebase",
      repos: [repo],
      selectedRepoId: "r1",
    });
    vi.mocked(api.repoIssues).mockClear();
    await act(async () => {
      const tab = [...host.querySelectorAll(".codebase-tabs button")].find((btn) =>
        btn.textContent?.includes("Issues"),
      );
      (tab as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(host.querySelector(".pr-inbox-item")?.textContent).toContain("Cached issue");
    expect(api.repoIssues).not.toHaveBeenCalled();
  });
});
