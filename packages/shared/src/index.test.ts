import { describe, expect, it } from "vitest";
import {
  BUILTIN_PROVIDERS,
  COMPUTER_USE_TOOLS,
  mergeBuiltinProviders,
  isOpenRouterProvider,
  isOllamaProvider,
  isCursorCliProvider,
  isClaudeCodeProvider,
  isCodexCliProvider,
  isKiroCliProvider,
  CURSOR_CLI_BASE_URL,
  CLAUDE_CODE_BASE_URL,
  CODEX_CLI_BASE_URL,
  KIRO_CLI_BASE_URL,
  CODEX_CLI_MODELS,
  normalizeCodexCliModel,
  defaultNetworking,
  defaultNetworkJail,
  forgeProviderAllowlist,
  hostAllowed,
  formatHardware,
  formatUsageHint,
  openaiToolDefs,
  invalidHttpUrl,
  isLoopbackHost,
  isLoopbackOrigin,
  isLanPeerHost,
  isLanOrigin,
  isPhonePairingHost,
  isTailscaleMagicDns,
  phoneListenHost,
  pairingHttpUrl,
  pairingHttpsUrl,
  pairingAppUrl,
  preferredPairingLink,
  formatPhoneToken,
  qemuPathUnsafe,
  parseRepoUrl,
  parseOwnerRepo,
  shortRepoName,
  cursorGithubRepoUrl,
  parseGithubPullUrl,
  forgeShort,
  parseLinkedRepos,
  matchLinkedRepo,
  attachLinkedCheckout,
  mergeRepoBranches,
  mergeDefaultForges,
  resolveForgeAccount,
  forgeSupportsSso,
  forgeWebOrigin,
  forgeOauthCallbackUrl,
  forgeOauthScopes,
  forgeHostLabel,
  forgeAccountInitials,
  forgeAccountHandle,
  forgeAccountSubtitle,
  forgeAccountStatus,
  formatForgeUsedAt,
  latestForgeRepoActivity,
  githubDeviceCodeUrl,
  bitbucketAuthorizeUrl,
  formatPrCard,
  parsePrCard,
  parsePullListState,
  isDraftPull,
  isOpenInboxPull,
  isPullCacheFresh,
  PULL_CACHE_TTL_MS,
  parsePullListCache,
  parsePullDetailCache,
  parsePullRequestDetail,
  parsePullRequestRef,
  parsePullCheckRollup,
  formatPullFiles,
  isOwnPullReviewRejected,
  ownPullReviewFallbackNote,
  PULL_PATCH_INCLUDED_NOTE,
  parseGitPrGetInclude,
  selectPullFiles,
  wantsFreshPulls,
  redactText,
  resolveVmHardware,
  THEME_OPTIONS,
  filterThemeOptions,
  resolveTheme,
  themeFamily,
  themeFamilyLabel,
  themeOption,
  TOOL_SCHEMAS,
  toolsForOs,
  toolsForRuntime,
  configuredToolsForRuntime,
  integrationMcpTools,
  forgeMcpTools,
  canvasMcpTools,
  formatPullComments,
  parseToolAllowlist,
  canRewind,
  lastUserMessage,
  overlayFromTool,
  overlayPosition,
  GUEST_SCREEN,
  CHROMIUM_VIEWPORT,
  CHROMIUM_DEVICE_SCALE,
  isDockerBrowserActivity,
  isMutatingBrowserTool,
  isOperatorDrivingBrowser,
  mapCanvasToDevice,
  parseBrowserClientMessage,
  parseBrowserServerMessage,
  browserDeniedHost,
  LOCUS_CHROME_PROFILE_DIR,
  LOCUS_CHROME_PROFILE_GUEST,
  UBUNTU_DEFAULT_HARDWARE,
  sanitizeRecordingName,
  sanitizeArtifactStem,
  RECORD_SCREEN_MODES,
  assessSetup,
  setupTodos,
  setupHasRemainingTodos,
  hasUsableKey,
  guestSharePath,
  guestShareRoot,
  guestLabel,
  isLinux,
  needsUefi,
  latestGoldenImage,
  parseOsRelease,
  packageManagerForDistro,
  qemuInstallRecipe,
  configuredGuestOsOptions,
  pickConfiguredOs,
  isGuestReady,
  isGuestStarting,
  toolNeedsGuest,
  isForgeToolName,
  isControlPlaneToolName,
  parseDockerImage,
  parseDockerContainerRef,
  parseDockerLogTail,
  parseDockerBulkIds,
  MAX_DOCKER_BULK_IDS,
  parseDockerStatsJson,
  mockDockerContainerStats,
  dockerIdMatch,
  matchDockerContainer,
  dockerStateFromVm,
  dockerStateFromHost,
  mergeDockerInventory,
  sessionRuntime,
  compactMessages,
  foldOldTurns,
  sessionKind,
  isCanvasSession,
  isCodingLoopSession,
  isDesignSession,
  isGameSession,
  isAssetSession,
  isIdeSession,
  isSetupSession,
  sessionVision,
  sessionWebSearch,
  sessionLiveChrome,
  formatWebSearch,
  formatLiveChrome,
  MAX_AGENT_ROUNDS,
  estimateTokens,
  agentRoundLimit,
  generateGuestPassword,
  isDefaultGuestPassword,
  LEGACY_LINUX_GUEST_PASSWORD,
  LEGACY_WINDOWS_GUEST_PASSWORD,
  mcpFunctionName,
  isMcpToolName,
  parseMcpToolNames,
  automationAllowsIntegration,
  automationAllowsMcpTool,
  integrationReady,
  integrationKindForTool,
  isWebSearchToolName,
  toolNeedsApproval,
  toolsRunInParallel,
  toolCallsRunInParallel,
  execArgCommands,
  fileReadPaths,
} from "./index.js";

describe("parseRepoUrl", () => {
  it("parses GitHub https and ssh", () => {
    expect(parseRepoUrl("https://github.com/acme/app")).toEqual({
      forge: "github",
      url: "https://github.com/acme/app.git",
    });
    expect(parseRepoUrl("git@github.com:acme/app.git")).toEqual({
      forge: "github",
      url: "https://github.com/acme/app.git",
    });
  });

  it("parses GitLab urls", () => {
    expect(parseRepoUrl("https://gitlab.com/acme/app")).toEqual({
      forge: "gitlab",
      url: "https://gitlab.com/acme/app.git",
    });
    expect(parseRepoUrl("https://git.example.com/acme/app.git")).toEqual({
      forge: "github",
      url: "https://git.example.com/acme/app.git",
    });
    expect(parseRepoUrl("https://gitlab.example.com/acme/app.git")).toEqual({
      forge: "gitlab",
      url: "https://gitlab.example.com/acme/app.git",
    });
  });

  it("parses Bitbucket urls", () => {
    expect(parseRepoUrl("https://bitbucket.org/acme/app")).toEqual({
      forge: "bitbucket",
      url: "https://bitbucket.org/acme/app.git",
    });
  });

  it("parses Gitea, Forgejo, and Azure DevOps urls", () => {
    expect(parseRepoUrl("https://gitea.example.com/acme/app.git")).toEqual({
      forge: "gitea",
      url: "https://gitea.example.com/acme/app.git",
    });
    expect(parseRepoUrl("https://codeberg.org/acme/app.git")).toEqual({
      forge: "forgejo",
      url: "https://codeberg.org/acme/app.git",
    });
    expect(parseRepoUrl("https://dev.azure.com/org/proj/_git/app")).toEqual({
      forge: "azuredevops",
      url: "https://dev.azure.com/org/proj/_git/app",
    });
  });

  it("returns null for empty input", () => {
    expect(parseRepoUrl("")).toBeNull();
    expect(parseRepoUrl("   ")).toBeNull();
    expect(cursorGithubRepoUrl("https://github.com/acme/app.git")).toBe(
      "https://github.com/acme/app",
    );
    expect(cursorGithubRepoUrl("https://gitlab.com/acme/app.git")).toBeUndefined();
    expect(parseGithubPullUrl("https://github.com/acme/app/pull/12")).toEqual({
      number: 12,
      url: "https://github.com/acme/app/pull/12",
      title: "acme/app#12",
    });
  });

  it("shortens forge names for compact badges", () => {
    expect(forgeShort("github")).toBe("GH");
    expect(forgeShort("gitlab")).toBe("GL");
    expect(forgeShort("bitbucket")).toBe("BB");
  });

  it("parses owner and repo from clone URLs", () => {
    expect(parseOwnerRepo("https://github.com/acme/app.git")).toEqual({
      owner: "acme",
      repo: "app",
    });
    expect(parseOwnerRepo("git@bitbucket.org:acme/app.git")).toEqual({
      owner: "acme",
      repo: "app",
    });
  });

  it("shortens repo display names to the repo segment", () => {
    expect(shortRepoName("https://github.com/acme/app.git")).toBe("app");
    expect(shortRepoName("git@bitbucket.org:acme/app.git")).toBe("app");
    expect(shortRepoName("https://github.com/Modsofthenation/Locus")).toBe("local-agents");
    // No owner segment to strip: fall back to the trailing path segment.
    expect(shortRepoName("local-agents")).toBe("local-agents");
    expect(shortRepoName("", "fallback")).toBe("fallback");
  });
});

describe("forge accounts", () => {
  const github = {
    id: "gh1",
    kind: "github" as const,
    name: "Work GitHub",
    apiBaseUrl: "https://api.github.com",
    token: "tok-work",
  };
  const github2 = {
    id: "gh2",
    kind: "github" as const,
    name: "Home GitHub",
    apiBaseUrl: "https://api.github.com",
    token: "tok-home",
  };
  const gitlab = {
    id: "gl1",
    kind: "gitlab" as const,
    name: "GitLab",
    apiBaseUrl: "https://gitlab.com/api/v4",
    token: "tok-gl",
  };
  const bitbucket = {
    id: "bb1",
    kind: "bitbucket" as const,
    name: "Bitbucket",
    apiBaseUrl: "https://api.bitbucket.org/2.0",
    token: "tok-bb",
  };

  it("resolves by account id even when two GitHub tokens are active", () => {
    const forges = [github, github2, gitlab, bitbucket];
    expect(resolveForgeAccount(forges, { accountId: "gh2" })?.id).toBe("gh2");
    expect(resolveForgeAccount(forges, { accountId: "gh1" })?.token).toBe("tok-work");
    expect(resolveForgeAccount(forges, { kind: "gitlab" })?.id).toBe("gl1");
    expect(resolveForgeAccount(forges, { url: "https://bitbucket.org/acme/app.git" })?.id).toBe(
      "bb1",
    );
  });

  it("falls back to a tokened GitHub account when the linked id is signed out", () => {
    const empty = { ...github, id: "gh-empty", token: "" };
    expect(
      resolveForgeAccount([empty, github2], {
        accountId: "gh-empty",
        kind: "github",
        url: "https://github.com/acme/app.git",
      })?.id,
    ).toBe("gh2");
  });

  it("merges a missing GitLab default without dropping extra GitHub accounts", () => {
    const merged = mergeDefaultForges([github, github2, bitbucket], () => "new-id");
    expect(merged.filter((row) => row.kind === "github")).toHaveLength(2);
    expect(merged.some((row) => row.kind === "gitlab")).toBe(true);
    expect(merged.some((row) => row.kind === "bitbucket")).toBe(true);
  });

  it("exposes SSO helpers for GitHub, GitLab, and Bitbucket", () => {
    expect(forgeSupportsSso("github")).toBe(true);
    expect(forgeSupportsSso("bitbucket")).toBe(true);
    expect(forgeSupportsSso("gitlab")).toBe(true);
    expect(forgeWebOrigin("github", "https://api.github.com")).toBe("https://github.com");
    expect(forgeWebOrigin("bitbucket", "https://api.bitbucket.org/2.0")).toBe(
      "https://bitbucket.org",
    );
    expect(forgeWebOrigin("gitlab", "https://gitlab.com/api/v4")).toBe("https://gitlab.com");
    expect(forgeWebOrigin("github", "https://ghe.example.com/api/v3")).toBe(
      "https://ghe.example.com",
    );
    expect(forgeOauthCallbackUrl(7420)).toBe("http://127.0.0.1:7420/api/oauth/callback");
    expect(githubDeviceCodeUrl("https://github.com")).toBe("https://github.com/login/device/code");
    expect(bitbucketAuthorizeUrl("https://bitbucket.org")).toBe(
      "https://bitbucket.org/site/oauth2/authorize",
    );
    expect(forgeOauthScopes("github")).toBe("repo read:user read:org workflow");
    expect(forgeHostLabel("github", "https://api.github.com")).toBe("github.com");
    expect(forgeHostLabel("gitlab", "https://gitlab.example/api/v4")).toBe("gitlab.example");
    expect(forgeAccountInitials({ kind: "github", name: "GitHub", username: "rmatthews" })).toBe(
      "RM",
    );
    expect(forgeAccountInitials({ kind: "github", name: "GitHub", username: "rosa-dev" })).toBe(
      "RD",
    );
    expect(forgeAccountInitials({ kind: "bitbucket", name: "Bitbucket" })).toBe("BB");
    expect(forgeAccountHandle({ name: "GitHub — work", username: "rmatthews" })).toBe("@rmatthews");
    expect(forgeAccountSubtitle({ kind: "github", name: "GitHub — work" })).toBe("GitHub — work");
    expect(forgeAccountSubtitle({ kind: "github", name: "work" })).toBe("GitHub — work");
    expect(forgeAccountStatus({ token: "ghs_x" }).kind).toBe("signed-in");
    expect(
      forgeAccountStatus(
        { token: "ghs_x", tokenExpiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString() },
        Date.now(),
      ).label,
    ).toBe("Token expires in 6 days");
    expect(formatForgeUsedAt(new Date(Date.now() - 12 * 60_000).toISOString())).toBe(
      "Used 12 minutes ago",
    );
    expect(
      latestForgeRepoActivity([
        { updatedAt: "2020-01-01T00:00:00.000Z", lastFetchAt: "2020-01-03T00:00:00.000Z" },
        { updatedAt: "2020-01-02T00:00:00.000Z" },
      ]),
    ).toBe("2020-01-03T00:00:00.000Z");
  });

  it("keeps the same URL as two catalog rows when account ids differ", () => {
    const repos = parseLinkedRepos([
      {
        id: "r1",
        name: "app-work",
        checkout: { forge: "github", url: "https://github.com/acme/app.git", accountId: "gh1" },
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "r2",
        name: "app-home",
        checkout: { forge: "github", url: "https://github.com/acme/app.git", accountId: "gh2" },
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-02T00:00:00.000Z",
      },
    ]);
    expect(repos).toHaveLength(2);
    expect(matchLinkedRepo(repos, "https://github.com/acme/app.git", "gh2")?.id).toBe("r2");
    expect(matchLinkedRepo(repos, "https://github.com/acme/app.git", "gh1")?.id).toBe("r1");
  });

  it("attaches a linked checkout by id, url, or overlay", () => {
    const repos = parseLinkedRepos([
      {
        id: "r1",
        name: "app",
        checkout: {
          forge: "github",
          url: "https://github.com/acme/app.git",
          ref: "main",
          accountId: "gh1",
        },
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    ]);
    expect(
      attachLinkedCheckout(repos, {
        repoId: "r1",
        repo: { forge: "github", url: "https://github.com/acme/app.git", ref: "feat" },
      }),
    ).toEqual({
      repoId: "r1",
      repo: {
        forge: "github",
        url: "https://github.com/acme/app.git",
        ref: "feat",
        accountId: "gh1",
      },
    });
    expect(
      attachLinkedCheckout(repos, {
        repo: { forge: "github", url: "https://github.com/acme/app.git" },
      }),
    ).toEqual({
      repoId: "r1",
      repo: { forge: "github", url: "https://github.com/acme/app.git" },
    });
    expect(attachLinkedCheckout(repos, { repo: { forge: "github", url: "" } })).toEqual({});
    expect(
      attachLinkedCheckout(repos, {
        repo: { forge: "github", url: "https://github.com/acme/other.git" },
      }),
    ).toEqual({
      repo: { forge: "github", url: "https://github.com/acme/other.git" },
    });
    expect(() => attachLinkedCheckout(repos, { repoId: "missing" })).toThrow(/Unknown linked repo/);
  });

  it("puts the default branch first and drops duplicates", () => {
    expect(mergeRepoBranches(["feat", "main", "feat"], "main")).toEqual({
      branches: ["main", "feat"],
      defaultBranch: "main",
    });
    expect(mergeRepoBranches(["feat"], undefined)).toEqual({
      branches: ["feat"],
      defaultBranch: undefined,
    });
  });

  it("round-trips a per-repo review prompt on linked repos", () => {
    const repos = parseLinkedRepos([
      {
        id: "r1",
        name: "app",
        checkout: { forge: "github", url: "https://github.com/acme/app.git" },
        reviewPrompt: "  No new public endpoints without OpenAPI.  ",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    ]);
    expect(repos[0]?.reviewPrompt).toBe("No new public endpoints without OpenAPI.");
  });

  it("round-trips a named environment id on linked repos", () => {
    const repos = parseLinkedRepos([
      {
        id: "r1",
        name: "app",
        checkout: { forge: "github", url: "https://github.com/acme/app.git" },
        namedEnvironmentId: " env-1 ",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    ]);
    expect(repos[0]?.namedEnvironmentId).toBe("env-1");
  });

  it("formats and parses PR cards including GitLab merge request URLs", () => {
    const card = formatPrCard({
      number: 12,
      title: "Fix login",
      url: "https://gitlab.com/acme/app/-/merge_requests/12",
      state: "open",
    });
    expect(card).toContain("Opened #12 Fix login");
    expect(parsePrCard(card)?.url).toBe("https://gitlab.com/acme/app/-/merge_requests/12");
  });

  it("treats draft PRs as open inbox rows across forge list filters", () => {
    expect(parsePullListState("draft")).toBe("draft");
    expect(parsePullListState("closed")).toBe("open");
    expect(isDraftPull({ state: "open", draft: true })).toBe(true);
    expect(isDraftPull({ state: "draft" })).toBe(true);
    expect(isOpenInboxPull({ state: "draft" })).toBe(true);
    expect(isOpenInboxPull({ state: "open" })).toBe(true);
    expect(isOpenInboxPull({ state: "merged" })).toBe(false);
  });

  it("treats a PR list/detail cache as fresh only within the TTL", () => {
    const now = Date.parse("2026-08-22T12:00:00.000Z");
    expect(isPullCacheFresh("2026-08-22T11:59:00.000Z", now)).toBe(true);
    expect(isPullCacheFresh(now - PULL_CACHE_TTL_MS + 1, now)).toBe(true);
    expect(isPullCacheFresh(now - PULL_CACHE_TTL_MS, now)).toBe(false);
    expect(isPullCacheFresh("nope", now)).toBe(false);
    expect(wantsFreshPulls("1")).toBe(true);
    expect(wantsFreshPulls("true")).toBe(true);
    expect(wantsFreshPulls("0")).toBe(false);
    const listed = parsePullListCache(
      {
        fetchedAt: "2026-08-22T11:59:00.000Z",
        state: "open",
        pulls: [
          {
            repoId: "r1",
            forge: "github",
            number: 1,
            title: "Fix",
            url: "https://github.com/acme/app/pull/1",
            state: "open",
            headRef: "f",
            baseRef: "main",
            headSha: "abc",
            updatedAt: "2026-08-22T11:59:00.000Z",
          },
        ],
      },
      "r1",
    );
    expect(listed?.pulls).toHaveLength(1);
    expect(listed?.pulls[0]?.title).toBe("Fix");
    const detail = parsePullRequestDetail({
      repoId: "r1",
      forge: "github",
      number: 1,
      title: "Fix",
      url: "https://github.com/acme/app/pull/1",
      state: "open",
      headRef: "f",
      baseRef: "main",
      headSha: "abc",
      updatedAt: "2026-08-22T11:59:00.000Z",
      body: "please review",
      files: [{ path: "src/a.ts", status: "modified", patch: "+a" }],
      comments: [{ id: "c1", body: "nit", createdAt: "2026-08-22T11:59:00.000Z" }],
      commits: [{ sha: "abc", message: "fix" }],
      checks: [{ name: "ci", status: "success" }],
    });
    expect(detail?.files).toEqual([{ path: "src/a.ts", status: "modified", patch: "+a" }]);
    expect(
      parsePullDetailCache({ fetchedAt: "2026-08-22T11:59:00.000Z", pull: detail })?.pull.body,
    ).toBe("please review");
    expect(parsePullListCache({ pulls: [] })).toBeUndefined();
  });

  it("parses list-row PR metadata and check rollups", () => {
    expect(parsePullCheckRollup("FAILURE")).toBe("failure");
    expect(parsePullCheckRollup("running")).toBe("pending");
    expect(parsePullCheckRollup("skipped")).toBe("neutral");
    const row = parsePullRequestRef({
      repoId: "r1",
      forge: "github",
      number: 12,
      title: "Fix",
      url: "https://github.com/acme/app/pull/12",
      state: "draft",
      headRef: "feat",
      baseRef: "develop",
      headSha: "abc",
      author: "jack",
      authorAvatarUrl: "https://avatars.example/jack.png",
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
      commentCount: 5,
      reviewCount: 4,
      reviewers: ["ada"],
      checkState: "success",
    });
    expect(row).toMatchObject({
      authorAvatarUrl: "https://avatars.example/jack.png",
      createdAt: "2026-08-24T00:00:00.000Z",
      commentCount: 5,
      reviewCount: 4,
      reviewers: ["ada"],
      checkState: "success",
    });
    expect(
      parsePullRequestRef({
        repoId: "r1",
        number: 1,
        url: "https://github.com/acme/app/pull/1",
        authorAvatarUrl: "javascript:alert(1)",
      })?.authorAvatarUrl,
    ).toBeUndefined();
  });

  it("inlines clipped untrusted patches for git_pr_get", () => {
    const listed = formatPullFiles([
      { path: "src/a.ts", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new\n" },
      { path: "logo.png", status: "added" },
    ]);
    expect(listed).toContain("modified src/a.ts");
    expect(listed).toContain("+new");
    expect(listed).toContain('kind="pr-text"');
    expect(listed).toContain('source="patch_src_a.ts"');
    expect(listed).toMatch(/added logo\.png(?!\n<)/);
    expect(listed).toContain(PULL_PATCH_INCLUDED_NOTE);
    const huge = formatPullFiles([
      { path: "big.ts", status: "modified", patch: "x".repeat(30_000) },
    ]);
    expect(huge).toContain("modified big.ts");
    expect(huge).toContain("…");
    expect(huge.match(/x+/)?.[0].length).toBeLessThanOrEqual(4_096);
    const overflow = formatPullFiles(
      Array.from({ length: 8 }, (_, i) => ({
        path: `f${i}.ts`,
        status: "modified" as const,
        patch: `unique-${i}-` + "z".repeat(4_000),
      })),
    );
    expect(overflow).toContain("unique-0-");
    expect(overflow).toContain("modified f7.ts");
    expect(overflow).not.toContain("unique-7-");
    expect(overflow).toMatch(/Patch budget skipped/);
    const prioritized = formatPullFiles(
      Array.from({ length: 8 }, (_, i) => ({
        path: `f${i}.ts`,
        status: "modified" as const,
        patch: `unique-${i}-` + "z".repeat(4_000),
      })),
      undefined,
      { priority: ["f7.ts"] },
    );
    expect(prioritized).toContain("unique-7-");
    expect(prioritized.indexOf("unique-7-")).toBeLessThan(prioritized.indexOf("unique-0-"));
    const filtered = formatPullFiles(
      [
        { path: "src/a.ts", status: "modified", patch: "+a" },
        { path: "src/b.ts", status: "modified", patch: "+b" },
      ],
      ["src/a.ts"],
    );
    expect(filtered).toContain("src/a.ts");
    expect(filtered).not.toContain("src/b.ts");
    expect(isOwnPullReviewRejected("Can not request changes on your own pull request")).toBe(true);
    expect(isOwnPullReviewRejected("Unprocessable Entity")).toBe(false);
    expect(ownPullReviewFallbackNote("REQUEST_CHANGES")).toMatch(/COMMENT/);
    expect(formatPullComments([{ id: "c1", body: "already noted", createdAt: "t" }])).toContain(
      "already noted",
    );
    const threaded = formatPullComments([
      {
        id: "1",
        author: "Ada",
        path: "dialog.tsx",
        line: 594,
        body: "### [Severity: Medium] UI/UX - Copies focus\nIssue: validateRow stores one translated string per row and then focuses the first input which is the template field not Copies.",
        createdAt: "t1",
      },
      {
        id: "2",
        author: "Riley",
        path: "dialog.tsx",
        line: 594,
        body: "Fixed on the latest tip. Row errors now store a field key.",
        createdAt: "t2",
      },
      {
        id: "3",
        author: "Ada",
        body: "### Review PR (full)\n**Verdict:** Request Changes\nPosted 0 High, 2 Medium.",
        createdAt: "t3",
      },
    ]);
    expect(threaded).toContain("Ada dialog.tsx:594: [Severity: Medium] UI/UX - Copies focus");
    expect(threaded).toContain(
      "  Riley: Fixed on the latest tip. Row errors now store a field key.",
    );
    expect(threaded).not.toContain("validateRow stores one translated string");
    expect(threaded).not.toContain("Verdict");
    expect(parseGitPrGetInclude(["FILES", "comments", "nope"])).toEqual(["files", "comments"]);
    expect(parseGitPrGetInclude("summary")).toEqual(["summary"]);
    expect(parseGitPrGetInclude([])).toBeUndefined();
    expect(
      selectPullFiles(
        [
          { path: "src/a.ts", status: "modified" },
          { path: "src/b.ts", status: "modified" },
        ],
        ["b.ts"],
      ).map((file) => file.path),
    ).toEqual(["src/b.ts"]);
  });
});

describe("network jail", () => {
  it("defaults to restricted (default-deny) for every guest", () => {
    expect(defaultNetworkJail()).toBe("restricted");
    expect(defaultNetworkJail("img-1")).toBe("restricted");
  });

  it("allows forge and provider hosts, including subdomains", () => {
    const allow = forgeProviderAllowlist({
      providers: [{ baseUrl: "https://opencode.ai/zen/v1" }],
      forges: [{ apiBaseUrl: "https://api.github.com" }],
    });
    expect(hostAllowed("api.incident.io", allow)).toBe(true);
    expect(hostAllowed("app.incident.io", allow)).toBe(true);
    expect(hostAllowed("github.com", allow)).toBe(true);
    expect(hostAllowed("api.github.com", allow)).toBe(true);
    expect(hostAllowed("objects.githubusercontent.com", allow)).toBe(true);
    expect(hostAllowed("opencode.ai", allow)).toBe(true);
    expect(hostAllowed("evil.example", allow)).toBe(false);
    expect(hostAllowed("notgithub.com", allow)).toBe(false);
    const extra = forgeProviderAllowlist({
      extraHosts: ["your-domain.atlassian.net"],
      advanced: { extraAllowHosts: ["grafana.example.com"] },
    });
    expect(hostAllowed("your-domain.atlassian.net", extra)).toBe(true);
    expect(hostAllowed("grafana.example.com", extra)).toBe(true);
  });
});

describe("local security helpers", () => {
  it("accepts loopback hosts and http(s) origins only", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("locus-canvas.localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.2")).toBe(false);
    expect(isLoopbackOrigin(undefined)).toBe(true);
    expect(isLoopbackOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isLoopbackOrigin("https://evil.example")).toBe(false);
  });

  it("treats RFC1918 and Tailscale peers as LAN, not the public internet", () => {
    expect(isLanPeerHost("192.168.1.20")).toBe(true);
    expect(isLanPeerHost("10.0.0.8")).toBe(true);
    expect(isLanPeerHost("172.16.4.1")).toBe(true);
    expect(isLanPeerHost("100.64.1.2")).toBe(true);
    expect(isLanPeerHost("::ffff:192.168.1.20")).toBe(true);
    expect(isLanPeerHost("fd7a:115c:a1e0::1")).toBe(true);
    expect(isLanPeerHost("8.8.8.8")).toBe(false);
    expect(isLanPeerHost("127.0.0.1")).toBe(false);
    expect(isLanPeerHost("0.0.0.0")).toBe(false);
    expect(isLanOrigin("http://192.168.1.20:7420")).toBe(true);
    expect(isLanOrigin("http://desk.tail123.ts.net:7420")).toBe(true);
    expect(isLanOrigin("https://evil.example")).toBe(false);
    expect(isTailscaleMagicDns("desk.tail123.ts.net")).toBe(true);
    expect(isTailscaleMagicDns("evil.ts.net.example")).toBe(false);
    expect(isPhonePairingHost("192.168.1.20")).toBe(true);
    expect(isPhonePairingHost("machine.ts.net")).toBe(true);
    expect(isPhonePairingHost("127.0.0.1")).toBe(false);
    expect(isPhonePairingHost("8.8.8.8")).toBe(false);
    expect(isPhonePairingHost("evil.example")).toBe(false);
    expect(phoneListenHost(true, "127.0.0.1")).toBe("0.0.0.0");
    expect(phoneListenHost(false, "127.0.0.1")).toBe("127.0.0.1");
    expect(pairingHttpUrl("192.168.1.20", 7420, "ph_abc")).toBe(
      "http://192.168.1.20:7420/?token=ph_abc",
    );
    expect(pairingHttpsUrl("192.168.1.20", 7420, "ph_abc", `sha256:${"ab".repeat(32)}`)).toBe(
      `https://192.168.1.20:7420/?token=ph_abc&fp=${"ab".repeat(32)}`,
    );
    expect(pairingAppUrl("192.168.1.20", 7420, "ph_abc")).toBe(
      "locus://pair?host=192.168.1.20&port=7420&token=ph_abc",
    );
    expect(pairingAppUrl("192.168.1.20", 7420, "ph_abc", "ab".repeat(32))).toContain("fp=");
    expect(
      preferredPairingLink([
        { address: "172.17.0.1", http: "docker" },
        { address: "192.168.1.20", http: "lan" },
        { address: "100.64.1.2", http: "tailscale" },
      ])?.http,
    ).toBe("lan");
    expect(formatPhoneToken("ph_abcd1234ef")).toBe("ABCD-1234-EF");
  });

  it("rejects credentialed or non-http provider URLs and QEMU option separators in paths", () => {
    expect(invalidHttpUrl("https://api.openai.com/v1")).toBeUndefined();
    expect(invalidHttpUrl("http://127.0.0.1:4096/v1")).toBeUndefined();
    expect(invalidHttpUrl("file:///etc/passwd")).toMatch(/http or https/);
    expect(invalidHttpUrl("https://user:pass@evil.test")).toMatch(/credentials/);
    expect(qemuPathUnsafe("/isos/ubuntu.iso")).toBe(false);
    expect(qemuPathUnsafe("/isos/ubuntu.iso,format=raw")).toBe(true);
  });

  it("redacts URLs with embedded credentials and Basic auth headers", () => {
    expect(
      redactText("cloned https://x-access-token:ghs_x@github.com/a/b.git", ["ghs_x"]),
    ).not.toContain("ghs_x");
    expect(redactText("AUTHORIZATION: Basic abcdef== extra", [])).toBe(
      "AUTHORIZATION: Basic •••• extra",
    );
  });

  it("redacts known secret formats and refuses credential paths", async () => {
    const { isSensitivePath, redactKnownSecrets, stripSensitiveListing } =
      await import("./index.js");
    expect(redactKnownSecrets("key AKIAIOSFODNN7EXAMPLE extra")).toContain("••••");
    expect(redactKnownSecrets("key AKIAIOSFODNN7EXAMPLE extra")).not.toContain(
      "AKIAIOSFODNN7EXAMPLE",
    );
    expect(redactKnownSecrets("gitlab glpat-abcdefghijklmnopqrstuv")).not.toContain("glpat-");
    expect(redactKnownSecrets("phone ph_" + "ab".repeat(16))).not.toContain("ph_");
    expect(redactKnownSecrets("chrome cx_" + "ab".repeat(16))).not.toContain("cx_");
    expect(redactKnownSecrets("atlassian ATATT" + "a".repeat(24))).not.toContain("ATATT");
    expect(redactKnownSecrets("linear lin_api_" + "a".repeat(24))).not.toContain("lin_api_");
    expect(isSensitivePath("/workspace/.env")).toBe(true);
    expect(isSensitivePath("/workspace/.env.local")).toBe(true);
    expect(isSensitivePath("/workspace/.env.example")).toBe(false);
    expect(isSensitivePath("/home/locus/.aws/credentials")).toBe(true);
    expect(isSensitivePath(".ssh/id_custom")).toBe(true);
    expect(isSensitivePath(".ssh/config")).toBe(false);
    expect(isSensitivePath("/workspace/src/app.ts")).toBe(false);
    expect(
      stripSensitiveListing("grep", "/workspace/.env:1:SECRET=1\n/workspace/src/app.ts:2:ok"),
    ).toBe("/workspace/src/app.ts:2:ok");
    expect(stripSensitiveListing("glob", "/workspace/.env\n/workspace/src/app.ts")).toBe(
      "/workspace/src/app.ts",
    );
    expect(
      stripSensitiveListing("file_list", "-rw-r--r-- 1 locus .env\n-rw-r--r-- 1 locus app.ts"),
    ).toBe("-rw-r--r-- 1 locus app.ts");
  });
});

describe("toolsForOs", () => {
  it("includes powershell only on Windows", () => {
    const linux = toolsForOs("ubuntu").map((t) => t.name);
    const win = toolsForOs("windows-11").map((t) => t.name);
    expect(linux).not.toContain("powershell");
    expect(linux).not.toContain("uia_tree");
    expect(linux).toContain("a11y_tree");
    expect(linux).toContain("mouse_scroll");
    expect(toolsForOs("debian").map((t) => t.name)).not.toContain("powershell");
    expect(toolsForOs("windows-10")).toContainEqual(
      expect.objectContaining({ name: "powershell" }),
    );
    expect(win).toContain("powershell");
    expect(win).toContain("uia_tree");
    expect(win).not.toContain("a11y_tree");
    expect(win).toContain("mouse_scroll");
    expect(win).toContain("exec");
    expect(linux).toContain("record_screen");
    expect(win).toContain("record_screen");
    expect(toolsForOs("debian").map((t) => t.name)).toContain("record_screen");
    expect(toolsForOs("windows-10").map((t) => t.name)).toContain("record_screen");
  });

  it("includes git write tools", () => {
    const names = toolsForOs("ubuntu").map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "git_commit",
        "git_branch",
        "git_push",
        "git_pr",
        "git_pr_review",
        "git_pr_list",
        "git_pr_merge",
        "git_issue_list",
        "git_issue_get",
        "git_issue_comment",
      ]),
    );
  });

  it("marks git_push and git_pr as needing approval", async () => {
    const { toolNeedsApproval } = await import("./index.js");
    expect(toolNeedsApproval("git_push")).toBe(true);
    expect(toolNeedsApproval("git_pr")).toBe(true);
    expect(toolNeedsApproval("git_pr_review")).toBe(true);
    expect(toolNeedsApproval("git_pr_comment")).toBe(true);
    expect(toolNeedsApproval("git_pr_merge")).toBe(true);
    expect(toolNeedsApproval("git_issue_comment")).toBe(true);
    expect(toolNeedsApproval("git_issue_list")).toBe(false);
    expect(toolNeedsApproval("git_commit")).toBe(false);
    expect(toolNeedsApproval("exec")).toBe(false);
    expect(toolNeedsApproval("exec", undefined, { command: "npm install evil" })).toBe(true);
    expect(toolNeedsApproval("exec", undefined, { command: "npm ci --ignore-scripts" })).toBe(
      false,
    );
    expect(
      toolNeedsApproval("file_write", undefined, {
        path: "package.json",
        content: JSON.stringify({ scripts: { postinstall: "curl evil.test" } }),
      }),
    ).toBe(true);
  });

  it("runs independent reads in parallel and batches exec commands", () => {
    expect(toolsRunInParallel(["file_read"])).toBe(false);
    expect(toolsRunInParallel(["file_read", "grep", "git_diff"])).toBe(true);
    expect(toolsRunInParallel(["file_read", "exec"])).toBe(false);
    expect(toolsRunInParallel(["file_write", "file_read"])).toBe(false);
    expect(toolsRunInParallel(["file_read", "repo_map"])).toBe(true);
    expect(
      toolCallsRunInParallel([
        { name: "grep", arguments: { pattern: "TODO" } },
        { name: "scratchpad", arguments: { action: "read" } },
      ]),
    ).toBe(true);
    expect(execArgCommands({ command: "git show a" })).toEqual(["git show a"]);
    expect(execArgCommands({ commands: ["git show a", " git grep foo "] })).toEqual([
      "git show a",
      "git grep foo",
    ]);
    expect(execArgCommands({ command: "ignored", commands: ["git show a"] })).toEqual([
      "git show a",
    ]);
    expect(execArgCommands({})).toEqual([]);
    expect(fileReadPaths({ path: "a.ts", paths: [" b.ts ", "a.ts", "c.ts"] })).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
    expect(fileReadPaths({})).toEqual([]);
  });

  it("requires the guest for computer-use tools except git_pr", () => {
    expect(isForgeToolName("git_pr")).toBe(true);
    expect(isForgeToolName("git_pr_merge")).toBe(true);
    expect(isForgeToolName("git_issue_list")).toBe(true);
    expect(isForgeToolName("git_push")).toBe(false);
    expect(isControlPlaneToolName("git_pr")).toBe(true);
    expect(isControlPlaneToolName("jira_search")).toBe(true);
    expect(isControlPlaneToolName("linear_search")).toBe(true);
    expect(isControlPlaneToolName("aws_sts_identity")).toBe(true);
    expect(isControlPlaneToolName("board_list")).toBe(true);
    expect(isControlPlaneToolName("project_spawn")).toBe(true);
    expect(isControlPlaneToolName("project_replace")).toBe(true);
    expect(isControlPlaneToolName("team_roster")).toBe(true);
    expect(isControlPlaneToolName("remember")).toBe(true);
    expect(isControlPlaneToolName("orient")).toBe(true);
    expect(isControlPlaneToolName("scratchpad")).toBe(true);
    expect(isControlPlaneToolName("host_sessions")).toBe(true);
    expect(isControlPlaneToolName("exec")).toBe(false);
    expect(isControlPlaneToolName("team_directory")).toBe(false);
    expect(isControlPlaneToolName("team_handoff")).toBe(false);
    expect(toolNeedsGuest("exec")).toBe(true);
    expect(toolNeedsGuest("screenshot")).toBe(true);
    expect(toolNeedsGuest("git_push")).toBe(true);
    expect(toolNeedsGuest("team_directory")).toBe(true);
    expect(toolNeedsGuest("team_handoff")).toBe(true);
    expect(toolNeedsGuest("git_pr")).toBe(false);
    expect(toolNeedsGuest("git_pr_review")).toBe(false);
    expect(toolNeedsGuest("git_pr_list")).toBe(false);
    expect(toolNeedsGuest("git_pr_get")).toBe(false);
    expect(toolNeedsGuest("git_pr_loadpath")).toBe(false);
    expect(toolNeedsGuest("git_pr_comment")).toBe(false);
    expect(toolNeedsGuest("git_pr_checks")).toBe(false);
    expect(toolNeedsGuest("git_pr_merge")).toBe(false);
    expect(toolNeedsGuest("git_issue_list")).toBe(false);
    expect(toolNeedsGuest("git_issue_get")).toBe(false);
    expect(toolNeedsGuest("git_issue_comment")).toBe(false);
    expect(toolNeedsGuest("jira_search")).toBe(false);
    expect(toolNeedsGuest("jira_comment")).toBe(false);
    expect(toolNeedsGuest("jira_create")).toBe(false);
    expect(toolNeedsGuest("jira_update")).toBe(false);
    expect(toolNeedsGuest("jira_transition")).toBe(false);
    expect(toolNeedsGuest("confluence_search")).toBe(false);
    expect(toolNeedsGuest("confluence_get")).toBe(false);
    expect(toolNeedsGuest("confluence_create")).toBe(false);
    expect(toolNeedsGuest("confluence_update")).toBe(false);
    expect(toolNeedsGuest("confluence_comment")).toBe(false);
    expect(toolNeedsGuest("linear_search")).toBe(false);
    expect(toolNeedsGuest("linear_comment")).toBe(false);
    expect(toolNeedsGuest("linear_create")).toBe(false);
    expect(toolNeedsGuest("linear_update")).toBe(false);
    expect(toolNeedsGuest("slack_post")).toBe(false);
    expect(toolNeedsGuest("slack_upload")).toBe(false);
    expect(toolNeedsGuest("grafana_search")).toBe(false);
    expect(toolNeedsGuest("grafana_query")).toBe(false);
    expect(toolNeedsGuest("sentry_search")).toBe(false);
    expect(toolNeedsGuest("sentry_get")).toBe(false);
    expect(toolNeedsGuest("sentry_update")).toBe(false);
    expect(toolNeedsGuest("miro_list")).toBe(false);
    expect(toolNeedsGuest("miro_export")).toBe(false);
    expect(toolNeedsGuest("figma_list")).toBe(false);
    expect(toolNeedsGuest("figma_get")).toBe(false);
    expect(toolNeedsGuest("figma_images")).toBe(false);
    expect(toolNeedsGuest("figma_comment")).toBe(false);
    expect(toolNeedsGuest("incidentio_search")).toBe(false);
    expect(toolNeedsGuest("incidentio_comment")).toBe(false);
    expect(toolNeedsGuest("incidentio_create")).toBe(false);
    expect(toolNeedsGuest("incidentio_update")).toBe(false);
    expect(toolNeedsGuest("aws_sts_identity")).toBe(false);
    expect(toolNeedsGuest("aws_iam_simulate")).toBe(false);
    expect(toolNeedsApproval("aws_iam_simulate")).toBe(false);
    expect(toolNeedsGuest("portainer_endpoints")).toBe(false);
    expect(toolNeedsGuest("portainer_container_action")).toBe(false);
    expect(isControlPlaneToolName("k8s_list")).toBe(true);
    expect(toolNeedsGuest("k8s_list")).toBe(false);
    expect(toolNeedsGuest("k8s_logs")).toBe(false);
    expect(toolNeedsGuest("k8s_apply")).toBe(false);
    expect(toolNeedsApproval("k8s_list")).toBe(false);
    expect(toolNeedsApproval("k8s_apply")).toBe(true);
    expect(toolNeedsApproval("k8s_delete")).toBe(true);
    expect(toolNeedsApproval("k8s_scale")).toBe(true);
    expect(toolNeedsGuest("docker_swarm")).toBe(false);
    expect(toolNeedsGuest("board_list")).toBe(false);
    expect(toolNeedsGuest("board_upsert")).toBe(false);
    expect(toolNeedsGuest("project_get")).toBe(false);
    expect(toolNeedsGuest("project_spawn")).toBe(false);
    expect(toolNeedsGuest("project_replace")).toBe(false);
    expect(toolNeedsGuest("remember")).toBe(false);
    expect(toolNeedsGuest("orient")).toBe(false);
    expect(toolNeedsApproval("board_upsert")).toBe(true);
    expect(toolNeedsApproval("board_delete")).toBe(true);
    expect(toolNeedsApproval("board_cluster")).toBe(true);
    expect(toolNeedsApproval("brain_brief")).toBe(true);
    expect(toolNeedsApproval("board_list")).toBe(false);
    expect(toolNeedsApproval("jira_comment")).toBe(true);
    expect(toolNeedsApproval("jira_create")).toBe(true);
    expect(toolNeedsApproval("jira_update")).toBe(true);
    expect(toolNeedsApproval("jira_transition")).toBe(true);
    expect(toolNeedsApproval("confluence_create")).toBe(true);
    expect(toolNeedsApproval("confluence_update")).toBe(true);
    expect(toolNeedsApproval("confluence_comment")).toBe(true);
    expect(toolNeedsApproval("confluence_search")).toBe(false);
    expect(toolNeedsApproval("linear_comment")).toBe(true);
    expect(toolNeedsApproval("linear_create")).toBe(true);
    expect(toolNeedsApproval("linear_update")).toBe(true);
    expect(toolNeedsApproval("slack_post")).toBe(true);
    expect(toolNeedsApproval("slack_upload")).toBe(true);
    expect(toolNeedsApproval("miro_export")).toBe(true);
    expect(toolNeedsApproval("figma_comment")).toBe(true);
    expect(toolNeedsApproval("figma_get")).toBe(false);
    expect(toolNeedsApproval("incidentio_comment")).toBe(true);
    expect(toolNeedsApproval("incidentio_create")).toBe(true);
    expect(toolNeedsApproval("incidentio_update")).toBe(true);
    expect(toolNeedsApproval("incidentio_search")).toBe(false);
    expect(toolNeedsApproval("portainer_container_action")).toBe(true);
    expect(toolNeedsApproval("portainer_stack_action")).toBe(true);
    expect(toolNeedsApproval("portainer_containers")).toBe(false);
    expect(toolNeedsApproval("docker_swarm", undefined, { action: "status" })).toBe(false);
    expect(toolNeedsApproval("docker_swarm", undefined, { action: "scale", replicas: 3 })).toBe(
      true,
    );
    expect(toolNeedsApproval("gmail_send")).toBe(true);
    expect(toolNeedsApproval("calendar_create")).toBe(true);
    expect(toolNeedsApproval("drive_upload")).toBe(true);
    expect(toolNeedsApproval("gmail_search")).toBe(false);
    expect(toolNeedsApproval("sentry_update")).toBe(true);
    expect(toolNeedsApproval("sentry_search")).toBe(false);
    expect(toolNeedsApproval("jira_search")).toBe(false);
    expect(toolNeedsApproval("linear_search")).toBe(false);
  });

  it("lists the same tools for Debian as Ubuntu and Windows 10 as Windows 11", () => {
    expect(toolsForOs("debian").map((t) => t.name)).toEqual(
      toolsForOs("ubuntu").map((t) => t.name),
    );
    expect(toolsForOs("omarchy").map((t) => t.name)).toEqual(
      toolsForOs("ubuntu").map((t) => t.name),
    );
    expect(toolsForOs("windows-10").map((t) => t.name)).toEqual(
      toolsForOs("windows-11").map((t) => t.name),
    );
    for (const tool of COMPUTER_USE_TOOLS) {
      if (tool.name === "powershell" || tool.name === "uia_tree") {
        expect(tool.os).toEqual(["windows-11", "windows-10"]);
      } else if (
        tool.name === "a11y_tree" ||
        tool.name === "preview" ||
        tool.name === "browser_tabs" ||
        tool.name === "browser_navigate" ||
        tool.name === "browser_snapshot" ||
        tool.name === "browser_click" ||
        tool.name === "browser_type" ||
        tool.name === "browser_console" ||
        tool.name === "browser_network" ||
        tool.name === "browser_pdf" ||
        tool.name === "browser_trace" ||
        tool.name === "browser_download"
      ) {
        expect(tool.os).toEqual(["ubuntu", "debian", "omarchy"]);
      } else {
        expect(tool.os).toEqual(["ubuntu", "debian", "omarchy", "windows-11", "windows-10"]);
      }
    }
  });

  it("covers every catalog entry", () => {
    const names = new Set(COMPUTER_USE_TOOLS.map((t) => t.name));
    expect(names.size).toBe(COMPUTER_USE_TOOLS.length);
  });

  it("has a JSON schema for every tool", () => {
    for (const t of COMPUTER_USE_TOOLS) {
      expect(TOOL_SCHEMAS[t.name]).toBeDefined();
    }
    expect(TOOL_SCHEMAS.record_screen.required).toEqual(["mode"]);
    expect(TOOL_SCHEMAS.record_screen.properties.mode?.enum).toEqual([...RECORD_SCREEN_MODES]);
    expect(TOOL_SCHEMAS.mouse_scroll.required).toEqual(["delta"]);
    expect(TOOL_SCHEMAS.exec.properties.cwd).toBeDefined();
    expect(TOOL_SCHEMAS.exec.properties.commands?.type).toBe("array");
    expect(TOOL_SCHEMAS.exec.properties.commands?.description).toMatch(/heredoc/);
    expect(TOOL_SCHEMAS.exec.required).toBeUndefined();
    expect(TOOL_SCHEMAS.mouse_click.properties.count).toBeDefined();
    expect(openaiToolDefs("ubuntu", ["exec"]).map((d) => d.function.name)).toEqual(["exec"]);
    expect(openaiToolDefs("ubuntu", []).map((d) => d.function.name)).toEqual([]);
    expect(TOOL_SCHEMAS.grep.required).toEqual(["pattern"]);
    expect(TOOL_SCHEMAS.apply_patch.required).toEqual(["patch"]);
    expect(TOOL_SCHEMAS.file_read.properties.offset).toBeDefined();
    expect(TOOL_SCHEMAS.file_read.properties.paths?.type).toBe("array");
    expect(TOOL_SCHEMAS.file_read.required).toBeUndefined();
    expect(TOOL_SCHEMAS.grep.properties.context).toBeDefined();
  });

  it("parses a guest tool allowlist", () => {
    expect(parseToolAllowlist("ubuntu", [" exec ", "git_commit", "exec"])).toEqual([
      "exec",
      "git_commit",
    ]);
    expect(parseToolAllowlist("ubuntu", ["", "  "])).toEqual([]);
    expect(() => parseToolAllowlist("ubuntu", ["powershell"])).toThrow(/Unknown tool/);
    expect(parseToolAllowlist("windows-10", ["powershell"])).toEqual(["powershell"]);
    expect(parseToolAllowlist("ubuntu", ["record_screen"])).toEqual(["record_screen"]);
    expect(parseToolAllowlist("ubuntu", ["a11y_tree", "mouse_scroll"])).toEqual([
      "a11y_tree",
      "mouse_scroll",
    ]);
    expect(() => parseToolAllowlist("ubuntu", ["uia_tree"])).toThrow(/Unknown tool/);
    expect(parseToolAllowlist("windows-11", ["uia_tree"])).toEqual(["uia_tree"]);
    expect(parseToolAllowlist("ubuntu", ["exec", "git_commit"], "docker")).toEqual([
      "exec",
      "git_commit",
    ]);
    expect(parseToolAllowlist("ubuntu", ["preview"], "docker")).toEqual(["preview"]);
    expect(parseToolAllowlist("ubuntu", ["screenshot"], "docker")).toEqual(["screenshot"]);
    expect(parseToolAllowlist("ubuntu", ["record_screen"], "docker")).toEqual(["record_screen"]);
    expect(parseToolAllowlist("ubuntu", ["preview"])).toEqual(["preview"]);
  });

  it("limits docker agents to shell, files, git, preview, and Chromium tools", () => {
    const names = toolsForRuntime("ubuntu", "docker").map((t) => t.name);
    expect(names).toEqual([
      "exec",
      "screenshot",
      "record_screen",
      "mouse_move",
      "mouse_click",
      "mouse_drag",
      "mouse_scroll",
      "key",
      "type_text",
      "file_read",
      "file_write",
      "canvas_write",
      "canvas_read",
      "file_list",
      "grep",
      "glob",
      "apply_patch",
      "git_clone",
      "git_fetch",
      "git_status",
      "git_diff",
      "git_log",
      "git_commit",
      "git_branch",
      "git_push",
      "git_pr",
      "git_pr_review",
      "git_pr_list",
      "git_pr_get",
      "git_pr_loadpath",
      "git_pr_comment",
      "git_pr_checks",
      "git_pr_merge",
      "git_issue_list",
      "git_issue_get",
      "git_issue_comment",
      "jira_search",
      "jira_get",
      "jira_comment",
      "jira_create",
      "jira_update",
      "jira_transition",
      "confluence_search",
      "confluence_get",
      "confluence_create",
      "confluence_update",
      "confluence_comment",
      "linear_search",
      "linear_get",
      "linear_comment",
      "linear_create",
      "linear_update",
      "slack_post",
      "slack_upload",
      "slack_channels",
      "slack_history",
      "slack_replies",
      "grafana_search",
      "grafana_get",
      "grafana_query",
      "sentry_projects",
      "sentry_search",
      "sentry_get",
      "sentry_events",
      "sentry_update",
      "miro_list",
      "miro_get",
      "miro_import",
      "miro_export",
      "figma_list",
      "figma_get",
      "figma_images",
      "figma_comment",
      "incidentio_search",
      "incidentio_get",
      "incidentio_comment",
      "incidentio_create",
      "incidentio_update",
      "aws_sts_identity",
      "aws_iam_list",
      "aws_iam_get",
      "aws_iam_simulate",
      "portainer_endpoints",
      "portainer_containers",
      "portainer_inspect",
      "portainer_logs",
      "portainer_stacks",
      "portainer_container_action",
      "portainer_stack_action",
      "gmail_search",
      "gmail_get",
      "gmail_send",
      "calendar_list",
      "calendar_get",
      "calendar_create",
      "drive_list",
      "drive_get",
      "drive_upload",
      "k8s_list",
      "k8s_get",
      "k8s_logs",
      "k8s_events",
      "k8s_apply",
      "k8s_delete",
      "k8s_scale",
      "git_stash",
      "git_revert",
      "start_process",
      "preview",
      "playwright",
      "browser_tabs",
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_console",
      "browser_network",
      "browser_pdf",
      "browser_trace",
      "browser_download",
      "project_context_list",
      "project_context_read",
      "project_context_write",
      "project_context_delete",
    ]);
    expect(toolsForRuntime("ubuntu", "vm").map((t) => t.name)).toEqual(
      toolsForOs("ubuntu")
        .map((t) => t.name)
        .filter(
          (name) =>
            name !== "browser_tabs" &&
            name !== "browser_navigate" &&
            name !== "browser_snapshot" &&
            name !== "browser_click" &&
            name !== "browser_type" &&
            name !== "browser_console" &&
            name !== "browser_network" &&
            name !== "browser_pdf" &&
            name !== "browser_trace" &&
            name !== "browser_download",
        ),
    );
    expect(openaiToolDefs("ubuntu", undefined, "docker").map((d) => d.function.name)).toEqual(
      names,
    );
    const hostNames = toolsForRuntime("ubuntu", "host").map((t) => t.name);
    expect(hostNames).toEqual(
      expect.arrayContaining(["exec", "file_write", "git_clone", "git_pr", "screenshot"]),
    );
    expect(hostNames).toContain("browser_snapshot");
    expect(hostNames).toContain("preview");
    expect(hostNames).toContain("playwright");
    expect(hostNames).toContain("canvas_write");
    expect(hostNames).toContain("canvas_read");
    expect(hostNames).toContain("project_propose_merge");
    expect(hostNames).toContain("project_propose_rule");
    expect(parseToolAllowlist("ubuntu", ["preview"], "host")).toEqual(["preview"]);
    expect(parseToolAllowlist("ubuntu", ["playwright"], "host")).toEqual(["playwright"]);
    expect(parseToolAllowlist("ubuntu", ["playwright"], "docker")).toEqual(["playwright"]);
    expect(parseToolAllowlist("ubuntu", ["browser_snapshot"], "docker")).toEqual([
      "browser_snapshot",
    ]);
    expect(parseToolAllowlist("ubuntu", ["browser_snapshot"], "host")).toEqual([
      "browser_snapshot",
    ]);
    expect(parseToolAllowlist("ubuntu", ["exec"], "host")).toEqual(["exec"]);
    expect(parseToolAllowlist("ubuntu", ["git_pr"], "host")).toEqual(["git_pr"]);
  });

  it("hides Jira, Linear, Slack, Grafana, Miro, and incident.io tools until that integration has a token", () => {
    const none = configuredToolsForRuntime("ubuntu", "docker").map((t) => t.name);
    expect(none).not.toContain("jira_search");
    expect(none).not.toContain("confluence_search");
    expect(none).not.toContain("linear_search");
    expect(none).not.toContain("linear_create");
    expect(none).not.toContain("slack_post");
    expect(none).not.toContain("slack_upload");
    expect(none).not.toContain("grafana_get");
    expect(none).not.toContain("grafana_query");
    expect(none).not.toContain("sentry_search");
    expect(none).not.toContain("sentry_update");
    expect(none).not.toContain("miro_list");
    expect(none).not.toContain("miro_export");
    expect(none).not.toContain("figma_list");
    expect(none).not.toContain("figma_comment");
    expect(none).not.toContain("incidentio_search");
    expect(none).not.toContain("incidentio_create");
    expect(none).not.toContain("aws_sts_identity");
    expect(none).not.toContain("aws_iam_simulate");
    expect(none).not.toContain("portainer_endpoints");
    expect(none).not.toContain("portainer_container_action");
    expect(none).not.toContain("gmail_search");
    expect(none).not.toContain("calendar_list");
    expect(none).not.toContain("drive_list");
    expect(none).not.toContain("k8s_list");
    expect(none).not.toContain("k8s_apply");
    expect(none).toContain("exec");
    expect(none).toContain("git_pr");
    expect(none).not.toContain("board_list");
    expect(none).not.toContain("board_upsert");
    const hostNone = configuredToolsForRuntime("ubuntu", "host").map((t) => t.name);
    expect(hostNone).toContain("board_list");
    expect(hostNone).toContain("board_upsert");
    expect(hostNone).toContain("project_get");
    expect(hostNone).toContain("project_spawn");
    const jira = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "j1",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://acme.atlassian.net",
        token: "mail:tok",
      },
    ]).map((t) => t.name);
    expect(jira).toEqual(
      expect.arrayContaining([
        "jira_search",
        "jira_get",
        "jira_comment",
        "jira_create",
        "jira_update",
        "jira_transition",
      ]),
    );
    expect(jira).not.toContain("confluence_search");
    expect(jira).not.toContain("linear_search");
    expect(jira).not.toContain("slack_post");
    expect(jira).not.toContain("grafana_search");
    expect(jira).not.toContain("grafana_query");
    const confluence = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "c1",
        kind: "confluence",
        name: "Confluence",
        enabled: true,
        baseUrl: "https://acme.atlassian.net",
        token: "mail:tok",
      },
    ]).map((t) => t.name);
    expect(confluence).toEqual(
      expect.arrayContaining([
        "confluence_search",
        "confluence_get",
        "confluence_create",
        "confluence_update",
        "confluence_comment",
      ]),
    );
    expect(confluence).not.toContain("jira_search");
    const grafana = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "g1",
        kind: "grafana",
        name: "Grafana",
        enabled: true,
        baseUrl: "https://grafana.example.com",
        token: "glsa_test",
      },
    ]).map((t) => t.name);
    expect(grafana).toEqual(
      expect.arrayContaining(["grafana_search", "grafana_get", "grafana_query"]),
    );
    expect(grafana).not.toContain("jira_search");
    const sentry = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "s1",
        kind: "sentry",
        name: "Sentry",
        enabled: true,
        baseUrl: "https://sentry.io",
        token: "sntryu_test",
      },
    ]).map((t) => t.name);
    expect(sentry).toEqual(
      expect.arrayContaining([
        "sentry_projects",
        "sentry_search",
        "sentry_get",
        "sentry_events",
        "sentry_update",
      ]),
    );
    expect(sentry).not.toContain("jira_search");
    const miro = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "m1",
        kind: "miro",
        name: "Miro",
        enabled: true,
        baseUrl: "https://api.miro.com",
        token: "miro-token",
      },
    ]).map((t) => t.name);
    expect(miro).toEqual(
      expect.arrayContaining(["miro_list", "miro_get", "miro_import", "miro_export"]),
    );
    expect(miro).not.toContain("jira_search");
    const figma = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "f1",
        kind: "figma",
        name: "Figma",
        enabled: true,
        baseUrl: "https://api.figma.com",
        token: "figd-test",
      },
    ]).map((t) => t.name);
    expect(figma).toEqual(
      expect.arrayContaining(["figma_list", "figma_get", "figma_images", "figma_comment"]),
    );
    expect(figma).not.toContain("jira_search");
    const linear = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "l1",
        kind: "linear",
        name: "Linear",
        enabled: true,
        baseUrl: "https://api.linear.app",
        token: "lin_api_test",
      },
    ]).map((t) => t.name);
    expect(linear).toEqual(
      expect.arrayContaining([
        "linear_search",
        "linear_get",
        "linear_comment",
        "linear_create",
        "linear_update",
      ]),
    );
    expect(linear).not.toContain("jira_search");
    const incidentio = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "i1",
        kind: "incidentio",
        name: "incident.io",
        enabled: true,
        baseUrl: "https://api.incident.io",
        token: "inc_test",
      },
    ]).map((t) => t.name);
    expect(incidentio).toEqual(
      expect.arrayContaining([
        "incidentio_search",
        "incidentio_get",
        "incidentio_comment",
        "incidentio_create",
        "incidentio_update",
      ]),
    );
    expect(incidentio).not.toContain("jira_search");
    const aws = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "a1",
        kind: "aws",
        name: "AWS IAM",
        enabled: true,
        baseUrl: "https://iam.amazonaws.com",
        accessKeyId: "AKIATEST",
        token: "secret",
      },
    ]).map((t) => t.name);
    expect(aws).toEqual(
      expect.arrayContaining([
        "aws_sts_identity",
        "aws_iam_list",
        "aws_iam_get",
        "aws_iam_simulate",
      ]),
    );
    expect(aws).not.toContain("jira_search");
    const awsImds = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "a2",
        kind: "aws",
        name: "AWS IAM",
        enabled: true,
        baseUrl: "https://iam.amazonaws.com",
        useInstanceMetadata: true,
      },
    ]).map((t) => t.name);
    expect(awsImds).toContain("aws_sts_identity");
    const portainer = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "p1",
        kind: "portainer",
        name: "Portainer",
        enabled: true,
        baseUrl: "http://127.0.0.1:9000",
        token: "ptr_test",
      },
    ]).map((t) => t.name);
    expect(portainer).toEqual(
      expect.arrayContaining([
        "portainer_endpoints",
        "portainer_containers",
        "portainer_inspect",
        "portainer_logs",
        "portainer_stacks",
        "portainer_container_action",
        "portainer_stack_action",
      ]),
    );
    expect(portainer).not.toContain("jira_search");
    const gmail = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "gm1",
        kind: "gmail",
        name: "Gmail",
        enabled: true,
        baseUrl: "https://gmail.googleapis.com",
        token: "ya29.test",
      },
    ]).map((t) => t.name);
    expect(gmail).toEqual(expect.arrayContaining(["gmail_search", "gmail_get", "gmail_send"]));
    expect(gmail).not.toContain("calendar_list");
    const gcal = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "cal1",
        kind: "gcal",
        name: "Google Calendar",
        enabled: true,
        baseUrl: "https://www.googleapis.com",
        token: "ya29.test",
      },
    ]).map((t) => t.name);
    expect(gcal).toEqual(
      expect.arrayContaining(["calendar_list", "calendar_get", "calendar_create"]),
    );
    const gdrive = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "dr1",
        kind: "gdrive",
        name: "Google Drive",
        enabled: true,
        baseUrl: "https://www.googleapis.com",
        token: "ya29.test",
      },
    ]).map((t) => t.name);
    expect(gdrive).toEqual(expect.arrayContaining(["drive_list", "drive_get", "drive_upload"]));
    const kubernetes = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "k1",
        kind: "kubernetes",
        name: "Kubernetes",
        enabled: true,
        baseUrl: "https://k8s.example.com",
        token: "s.token",
      },
    ]).map((t) => t.name);
    expect(kubernetes).toEqual(
      expect.arrayContaining([
        "k8s_list",
        "k8s_get",
        "k8s_logs",
        "k8s_events",
        "k8s_apply",
        "k8s_delete",
        "k8s_scale",
      ]),
    );
    expect(kubernetes).not.toContain("jira_search");
    const k8sProxy = configuredToolsForRuntime("ubuntu", "docker", [
      {
        id: "k2",
        kind: "kubernetes",
        name: "Kubernetes",
        enabled: true,
        baseUrl: "http://127.0.0.1:8001",
      },
    ]).map((t) => t.name);
    expect(k8sProxy).toContain("k8s_list");
    const mcpTools = integrationMcpTools([
      {
        id: "g1",
        kind: "grafana",
        name: "Grafana",
        enabled: true,
        baseUrl: "https://grafana.example.com",
        token: "glsa_test",
      },
    ]);
    expect(mcpTools.map((t) => t.name)).toEqual(["grafana_search", "grafana_get", "grafana_query"]);
    expect(
      integrationMcpTools([
        {
          id: "s1",
          kind: "sentry",
          name: "Sentry",
          enabled: true,
          baseUrl: "https://sentry.io",
          token: "sntryu_test",
        },
      ]).map((t) => t.name),
    ).toEqual(["sentry_projects", "sentry_search", "sentry_get", "sentry_events", "sentry_update"]);
    expect(mcpTools[2]?.inputSchema.required).toEqual(["query"]);
    expect(integrationMcpTools([]).map((t) => t.name)).toEqual([]);
    expect(forgeMcpTools().map((t) => t.name)).toEqual(
      expect.arrayContaining(["git_pr_get", "git_pr_loadpath", "git_pr_comment", "git_pr_review"]),
    );
    expect(forgeMcpTools().map((t) => t.name)).toEqual(
      expect.arrayContaining(["git_issue_list", "git_issue_get", "git_issue_comment"]),
    );
    expect(canvasMcpTools().map((t) => t.name)).toEqual(["playwright"]);
    expect(canvasMcpTools("assets")[0]?.description).toMatch(/tainted canvas/);
    expect(canvasMcpTools("assets")[0]?.description).toMatch(/#btnWire/);
    expect(canvasMcpTools("game")[0]?.description).toMatch(/Restart/);
    expect(canvasMcpTools("game")[0]?.description).toMatch(/stats\.time/);
    expect(canvasMcpTools("design")[0]?.description).toMatch(/design canvas/);
    expect(canvasMcpTools("design")[0]?.description).toMatch(/first paint/);
    expect(TOOL_SCHEMAS.git_pr_get.properties).toEqual(
      expect.objectContaining({ include: expect.anything(), paths: expect.anything() }),
    );
    expect(integrationKindForTool("grafana_query")).toBe("grafana");
    expect(integrationKindForTool("sentry_search")).toBe("sentry");
    expect(integrationKindForTool("slack_channels")).toBe("slack");
    expect(integrationKindForTool("miro_list")).toBe("miro");
    expect(integrationKindForTool("confluence_search")).toBe("confluence");
    expect(integrationKindForTool("figma_get")).toBe("figma");
    expect(integrationKindForTool("linear_search")).toBe("linear");
    expect(integrationKindForTool("incidentio_search")).toBe("incidentio");
    expect(integrationKindForTool("aws_iam_simulate")).toBe("aws");
    expect(integrationKindForTool("portainer_containers")).toBe("portainer");
    expect(integrationKindForTool("gmail_search")).toBe("gmail");
    expect(integrationKindForTool("calendar_create")).toBe("gcal");
    expect(integrationKindForTool("drive_upload")).toBe("gdrive");
    expect(integrationKindForTool("k8s_list")).toBe("kubernetes");
    expect(integrationReady("jira_search", [])).toBe(false);
    expect(integrationReady("aws_sts_identity", [])).toBe(false);
    expect(integrationReady("k8s_list", [])).toBe(false);
    expect(
      integrationReady("jira_search", [
        {
          id: "j1",
          kind: "jira",
          name: "Jira",
          enabled: false,
          baseUrl: "https://acme.atlassian.net",
          token: "mail:tok",
        },
      ]),
    ).toBe(false);
    expect(integrationReady("exec", [])).toBe(true);
  });
});

describe("docker image", () => {
  it("accepts registry tags and rejects shell metacharacters", () => {
    expect(parseDockerImage(" ubuntu:24.04 ")).toBe("ubuntu:24.04");
    expect(parseDockerImage("locus/node")).toBe("locus/agent:0.1");
    expect(parseDockerImage("locus/web-qa")).toBe("locus/agent:0.1");
    expect(parseDockerImage("locus/design")).toBe("locus/agent:0.1");
    expect(parseDockerImage("locus/agent")).toBe("locus/agent:0.1");
    expect(parseDockerImage("ghcr.io/acme/app:1.2")).toBe("ghcr.io/acme/app:1.2");
    expect(parseDockerImage("node:22-bookworm")).toBe("node:22-bookworm");
    expect(parseDockerImage("ubuntu:24.04; rm -rf /")).toBeUndefined();
    expect(parseDockerImage("ubuntu 24.04")).toBeUndefined();
    expect(parseDockerImage("img`id`")).toBeUndefined();
    expect(parseDockerImage("")).toBeUndefined();
    expect(parseDockerImage("x".repeat(257))).toBeUndefined();
    expect(sessionRuntime({})).toBe("vm");
    expect(sessionRuntime({ runtime: "docker" })).toBe("docker");
    expect(sessionRuntime({ runtime: "host" })).toBe("host");
    expect(sessionKind({})).toBe("agent");
    expect(sessionKind({ kind: "design" })).toBe("design");
    expect(sessionKind({ kind: "game" })).toBe("game");
    expect(sessionKind({ kind: "assets" })).toBe("assets");
    expect(sessionKind({ kind: "setup" })).toBe("setup");
    expect(sessionKind({ kind: "ide" })).toBe("ide");
    expect(isDesignSession({ kind: "design" })).toBe(true);
    expect(isDesignSession({})).toBe(false);
    expect(isGameSession({ kind: "game" })).toBe(true);
    expect(isAssetSession({ kind: "assets" })).toBe(true);
    expect(isCanvasSession({ kind: "game" })).toBe(true);
    expect(isCanvasSession({ kind: "design" })).toBe(true);
    expect(isCanvasSession({ kind: "assets" })).toBe(true);
    expect(isCanvasSession({})).toBe(false);
    expect(isCodingLoopSession({})).toBe(true);
    expect(isCodingLoopSession({ kind: "ide" })).toBe(true);
    expect(isCodingLoopSession({ kind: "design" })).toBe(false);
    expect(isCodingLoopSession({ kind: "review" })).toBe(false);
    expect(isCodingLoopSession({ kind: "board" })).toBe(false);
    expect(isCodingLoopSession({ kind: "project" })).toBe(false);
    expect(isSetupSession({ kind: "setup" })).toBe(true);
    expect(isSetupSession({})).toBe(false);
    expect(isIdeSession({ kind: "ide" })).toBe(true);
    expect(isIdeSession({})).toBe(false);
    expect(sessionKind({ kind: "board" })).toBe("board");
    expect(sessionKind({ kind: "project" })).toBe("project");
  });
});

describe("docker inventory", () => {
  it("rejects unsafe container refs and clamps log tails", () => {
    expect(parseDockerContainerRef("abc123def456")).toBe("abc123def456");
    expect(parseDockerContainerRef("locus-a1b2c3d4-e5f6-7890")).toBe("locus-a1b2c3d4-e5f6-7890");
    expect(parseDockerContainerRef(" ubuntu ")).toBe("ubuntu");
    expect(parseDockerContainerRef("web_1")).toBe("web_1");
    expect(parseDockerContainerRef("id;rm")).toBeUndefined();
    expect(parseDockerContainerRef("id$(id)")).toBeUndefined();
    expect(parseDockerContainerRef("../etc")).toBeUndefined();
    expect(parseDockerContainerRef("a b")).toBeUndefined();
    expect(parseDockerContainerRef("")).toBeUndefined();
    expect(parseDockerContainerRef("x".repeat(129))).toBeUndefined();
    expect(parseDockerLogTail("80")).toBe(80);
    expect(parseDockerLogTail(0)).toBe(1);
    expect(parseDockerLogTail(9_999)).toBe(2000);
    expect(parseDockerLogTail("nope")).toBe(400);
    expect(parseDockerBulkIds({ ids: ["web", " api ", "web"] })).toEqual(["web", "api"]);
    expect(parseDockerBulkIds({ ids: ["id;rm"] })).toBeUndefined();
    expect(parseDockerBulkIds({ ids: [] })).toBeUndefined();
    expect(parseDockerBulkIds({ ids: [1] })).toBeUndefined();
    expect(
      parseDockerBulkIds({ ids: Array.from({ length: MAX_DOCKER_BULK_IDS + 1 }, () => "web") }),
    ).toBeUndefined();
    expect(dockerIdMatch("abcdef1234567890", "abcdef123456")).toBe(true);
    expect(dockerIdMatch("short", "other")).toBe(false);
    expect(dockerStateFromVm("running")).toBe("running");
    expect(dockerStateFromVm("paused")).toBe("paused");
    expect(dockerStateFromVm("stopped")).toBe("stopped");
    expect(dockerStateFromHost("running")).toBe("running");
    expect(dockerStateFromHost("", "Up 2 hours")).toBe("running");
    expect(dockerStateFromHost("", "Exited (0) 3 minutes ago")).toBe("exited");
  });

  it("parses docker stats json and builds mock samples", () => {
    const sampledAt = "2020-01-01T00:00:00.000Z";
    expect(
      parseDockerStatsJson(
        `${JSON.stringify({
          BlockIO: "0B / 8B",
          CPUPerc: "2.15%",
          Container: "abc123def456",
          ID: "abc123def456",
          MemPerc: "1.5%",
          MemUsage: "12.0MiB / 8GiB",
          Name: "web",
          NetIO: "1.2kB / 0B",
          PIDs: "4",
        })}\n`,
        sampledAt,
      ),
    ).toEqual({
      id: "abc123def456",
      name: "web",
      cpuPercent: 2.15,
      memoryPercent: 1.5,
      memoryUsage: "12.0MiB",
      memoryLimit: "8GiB",
      networkRx: "1.2kB",
      networkTx: "0B",
      blockRead: "0B",
      blockWrite: "8B",
      pids: 4,
      running: true,
      sampledAt,
    });
    expect(parseDockerStatsJson("not json\n")).toBeUndefined();
    expect(
      parseDockerStatsJson(
        JSON.stringify({
          BlockIO: "-- / --",
          CPUPerc: "--",
          ID: "deadbeef1234",
          MemPerc: "--",
          MemUsage: "-- / --",
          Name: "idle",
          NetIO: "-- / --",
          PIDs: 0,
        }),
        sampledAt,
      ),
    ).toMatchObject({
      id: "deadbeef1234",
      name: "idle",
      cpuPercent: 0,
      memoryPercent: 0,
      memoryUsage: "0B",
      memoryLimit: "0B",
      networkRx: "0B",
      networkTx: "0B",
      blockRead: "0B",
      blockWrite: "0B",
      pids: 0,
      running: false,
      sampledAt,
    });
    expect(
      mockDockerContainerStats({
        id: "x",
        name: "node",
        running: true,
        sampledAt,
      }).cpuPercent,
    ).toBe(1.2);
    expect(
      mockDockerContainerStats({
        id: "x",
        name: "node",
        running: false,
        sampledAt,
      }).running,
    ).toBe(false);
  });

  it("merges Locus VMs with host docker ps rows", () => {
    const vm = {
      id: "vm-1",
      sessionId: "sess-1",
      templateId: "docker",
      os: "ubuntu" as const,
      name: "node agent",
      status: "running" as const,
      diskPath: "/tmp/ws",
      runtime: "docker" as const,
      dockerImage: "node:22-bookworm",
      containerId: "abc123def4567890",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const rows = mergeDockerInventory({
      vms: [vm],
      host: [
        {
          id: "abc123def4567890ffff",
          name: "locus-vm-1",
          image: "node:22-bookworm",
          state: "running",
          status: "Up 2 hours",
          createdAt: "2020-01-01 00:00:00 +0000 UTC",
        },
        {
          id: "nginx1234567890ab",
          name: "web",
          image: "nginx:alpine",
          state: "exited",
          status: "Exited (0) 1 hour ago",
          createdAt: "2020-01-01 00:00:00 +0000 UTC",
        },
      ],
      sessions: [{ id: "sess-1", title: "Fix login", vmId: "vm-1" }],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "vm-1",
      name: "locus-vm-1",
      locus: true,
      sessionTitle: "Fix login",
      state: "running",
    });
    expect(rows[1]).toMatchObject({
      id: "nginx1234567890ab",
      name: "web",
      locus: false,
      state: "exited",
    });
    expect(matchDockerContainer(rows[0]!, "abc123def456")).toBe(true);
    expect(matchDockerContainer(rows[0]!, "sess-1")).toBe(true);
    expect(matchDockerContainer(rows[1]!, "web")).toBe(true);
    expect(matchDockerContainer(rows[1]!, "vm-1")).toBe(false);
  });
});

describe("sanitizeRecordingName", () => {
  it("strips paths, extensions, and unsafe characters", () => {
    expect(sanitizeRecordingName("walkthrough")).toBe("walkthrough");
    expect(sanitizeRecordingName("demo.mp4")).toBe("demo");
    expect(sanitizeRecordingName("../etc/passwd")).toBe("passwd");
    expect(sanitizeRecordingName("C:\\\\host\\\\bad name!")).toBe("bad_name");
    expect(sanitizeRecordingName("")).toBe("recording");
    expect(sanitizeRecordingName("   ")).toBe("recording");
  });

  it("stems artifact filenames the same way", () => {
    expect(sanitizeArtifactStem("walk.json", "trace")).toBe("walk");
    expect(sanitizeArtifactStem("../x", "page")).toBe("x");
    expect(sanitizeArtifactStem("", "page")).toBe("page");
  });
});

describe("defaults", () => {
  it("assigns isolated host ports per slot", () => {
    const a = defaultNetworking("ubuntu", 0);
    const b = defaultNetworking("ubuntu", 1);
    expect(a.sshHostPort).not.toBe(b.sshHostPort);
    expect(a.vncDisplay).toBe(10);
    expect(b.vncDisplay).toBe(11);
    expect(a.winrmHostPort).toBe(0);
    const omarchy = defaultNetworking("omarchy", 0);
    expect(omarchy.sshHostPort).toBe(2200);
    expect(omarchy.rdpHostPort).toBe(0);
    expect(isLinux("omarchy")).toBe(true);
    expect(isLinux("windows-11")).toBe(false);
    expect(needsUefi("omarchy")).toBe(true);
    expect(needsUefi("ubuntu")).toBe(false);
    expect(needsUefi("ubuntu", { enableSecureBoot: true })).toBe(true);
    expect(guestLabel("omarchy")).toBe("Omarchy 4");
    const win = defaultNetworking("windows-11", 0);
    expect(win.sshHostPort).toBe(2201);
    expect(win.rdpHostPort).toBe(2202);
    expect(win.winrmHostPort).toBe(2203);
    const deb = defaultNetworking("debian", 0);
    expect(deb.sshHostPort).toBe(2200);
    expect(deb.rdpHostPort).toBe(0);
    const win10 = defaultNetworking("windows-10", 0);
    expect(win10.rdpHostPort).toBe(2202);
    expect(win10.winrmHostPort).toBe(2203);
  });

  it("ships built-in providers", () => {
    const kinds = BUILTIN_PROVIDERS.map((p) => p.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "openai",
        "anthropic",
        "xai",
        "deepseek",
        "cursor",
        "cursor-cli",
        "claude-code",
        "codex-cli",
        "kiro-cli",
        "opencode",
        "openrouter",
        "openai-compatible",
      ]),
    );
    expect(BUILTIN_PROVIDERS.some((p) => p.name === "Ollama")).toBe(true);
    expect(isOllamaProvider({ name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" })).toBe(true);
    expect(isOllamaProvider({ name: "Ollama", baseUrl: "http://127.0.0.1:1234/v1" })).toBe(true);
    expect(isOllamaProvider({ name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" })).toBe(
      false,
    );
    expect(isOllamaProvider({ name: "local", baseUrl: "http://127.0.0.1:11434/v1" })).toBe(true);
    expect(BUILTIN_PROVIDERS.some((p) => p.name === "Gemini")).toBe(true);
    expect(BUILTIN_PROVIDERS.some((p) => p.name === "Amazon Bedrock")).toBe(true);
    const openrouter = BUILTIN_PROVIDERS.find((p) => p.name === "OpenRouter");
    expect(openrouter).toMatchObject({
      kind: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "anthropic/claude-sonnet-4.5",
    });
    expect(openrouter?.models).toEqual(
      expect.arrayContaining(["anthropic/claude-sonnet-4.5", "openai/gpt-4.1"]),
    );
    expect(
      isOpenRouterProvider({ kind: "openrouter", baseUrl: "https://openrouter.ai/api/v1" }),
    ).toBe(true);
    expect(
      isOpenRouterProvider({
        kind: "openai-compatible",
        baseUrl: "https://openrouter.ai/api/v1",
      }),
    ).toBe(true);
    expect(isOpenRouterProvider({ kind: "openai", baseUrl: "https://api.openai.com/v1" })).toBe(
      false,
    );
    const cursor = BUILTIN_PROVIDERS.find((p) => p.name === "Cursor Cloud");
    expect(cursor).toMatchObject({
      kind: "cursor",
      baseUrl: "https://api.cursor.com/v1",
      defaultModel: "composer-2",
    });
    const cursorCli = BUILTIN_PROVIDERS.find((p) => p.name === "Cursor CLI");
    expect(cursorCli).toMatchObject({
      kind: "cursor-cli",
      baseUrl: CURSOR_CLI_BASE_URL,
      defaultModel: "composer-2",
    });
    expect(isCursorCliProvider({ kind: "cursor-cli", baseUrl: CURSOR_CLI_BASE_URL })).toBe(true);
    expect(isCursorCliProvider({ kind: "cursor", baseUrl: "https://api.cursor.com/v1" })).toBe(
      false,
    );
    const claudeCode = BUILTIN_PROVIDERS.find((p) => p.name === "Claude Code");
    expect(claudeCode).toMatchObject({
      kind: "claude-code",
      baseUrl: CLAUDE_CODE_BASE_URL,
      defaultModel: "claude-sonnet-4-5",
    });
    expect(isClaudeCodeProvider({ kind: "claude-code", baseUrl: CLAUDE_CODE_BASE_URL })).toBe(true);
    const codexCli = BUILTIN_PROVIDERS.find((p) => p.name === "Codex CLI");
    expect(codexCli).toMatchObject({
      kind: "codex-cli",
      baseUrl: CODEX_CLI_BASE_URL,
      defaultModel: "gpt-6-astra",
      models: CODEX_CLI_MODELS,
    });
    expect(isCodexCliProvider({ kind: "codex-cli", baseUrl: CODEX_CLI_BASE_URL })).toBe(true);
    const kiroCli = BUILTIN_PROVIDERS.find((p) => p.name === "Kiro CLI");
    expect(kiroCli).toMatchObject({
      kind: "kiro-cli",
      baseUrl: KIRO_CLI_BASE_URL,
      defaultModel: "auto",
    });
    expect(isKiroCliProvider({ kind: "kiro-cli", baseUrl: KIRO_CLI_BASE_URL })).toBe(true);
  });

  it("defaults OpenCode to the Zen free tier", () => {
    const opencode = BUILTIN_PROVIDERS.find((p) => p.kind === "opencode");
    expect(opencode).toMatchObject({
      name: "OpenCode",
      baseUrl: "https://opencode.ai/zen/v1",
      defaultModel: "big-pickle",
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
    });
    expect(BUILTIN_PROVIDERS[0]?.kind).toBe("opencode");
    expect(opencode?.models[0]).toBe("big-pickle");
    expect(opencode?.models).toEqual(
      expect.arrayContaining([
        "big-pickle",
        "x-preview-f-free",
        "deepseek-v4-flash-free",
        "mimo-v2.5-free",
      ]),
    );
  });

  it("migrates legacy Codex CLI models to the ChatGPT-account catalog", () => {
    expect(normalizeCodexCliModel("gpt-5.3-codex")).toBe("gpt-6-astra");
    const migrated = mergeBuiltinProviders([
      {
        id: "codex-cli",
        name: "Codex CLI",
        kind: "codex-cli",
        baseUrl: CODEX_CLI_BASE_URL,
        models: ["gpt-5.3-codex", "gpt-5.2-codex"],
        defaultModel: "gpt-5.3-codex",
        enabled: true,
        extraHeaders: {},
      },
    ]).find((provider) => provider.kind === "codex-cli");
    expect(migrated).toMatchObject({
      defaultModel: "gpt-6-astra",
      models: CODEX_CLI_MODELS,
      enabled: true,
    });
  });

  it("migrates unused local OpenCode stubs and fills missing builtins", () => {
    const stub = {
      id: "old-opencode",
      name: "OpenCode",
      kind: "opencode" as const,
      baseUrl: "http://127.0.0.1:4096/v1",
      models: ["opencode"],
      defaultModel: "opencode",
      enabled: false,
      extraHeaders: {},
    };
    const local = {
      ...stub,
      id: "local-opencode",
      enabled: true,
    };
    const openai = {
      id: "openai",
      name: "OpenAI",
      kind: "openai" as const,
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-4.1"],
      defaultModel: "gpt-4.1",
      enabled: false,
      extraHeaders: {},
    };
    expect(mergeBuiltinProviders([stub, openai]).find((p) => p.kind === "opencode")).toMatchObject({
      id: "old-opencode",
      baseUrl: "https://opencode.ai/zen/v1",
      defaultModel: "big-pickle",
    });
    expect(mergeBuiltinProviders([local]).find((p) => p.kind === "opencode")?.baseUrl).toBe(
      "http://127.0.0.1:4096/v1",
    );
    const filled = mergeBuiltinProviders([openai]);
    expect(filled.find((p) => p.kind === "opencode")).toMatchObject({
      id: "opencode",
      defaultModel: "big-pickle",
    });
    expect(filled.some((p) => p.name === "Ollama")).toBe(true);
    const staleZen = mergeBuiltinProviders([
      {
        ...stub,
        id: "opencode",
        baseUrl: "https://opencode.ai/zen/v1",
        models: ["big-pickle"],
        defaultModel: "big-pickle",
      },
    ]).find((p) => p.kind === "opencode");
    expect(staleZen?.models).toEqual(expect.arrayContaining(["big-pickle", "x-preview-f-free"]));
  });

  it("promotes stock OpenRouter from openai-compatible without duplicating it", () => {
    const stock = {
      id: "openai-compatible:OpenRouter",
      name: "OpenRouter",
      kind: "openai-compatible" as const,
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-or-test",
      models: ["anthropic/claude-sonnet-4.5"],
      defaultModel: "anthropic/claude-sonnet-4.5",
      enabled: true,
      extraHeaders: {},
    };
    const byHost = {
      ...stock,
      id: "custom-or",
      name: "My router",
    };
    const other = {
      ...stock,
      id: "compat",
      name: "Custom",
      baseUrl: "https://example.com/v1",
    };
    const migrated = mergeBuiltinProviders([stock]);
    expect(migrated.filter((p) => p.kind === "openrouter")).toHaveLength(1);
    expect(migrated.find((p) => p.kind === "openrouter")).toMatchObject({
      id: "openai-compatible:OpenRouter",
      name: "OpenRouter",
      apiKey: "sk-or-test",
      enabled: true,
    });
    expect(mergeBuiltinProviders([byHost]).find((p) => p.kind === "openrouter")).toMatchObject({
      id: "custom-or",
      name: "My router",
    });
    expect(mergeBuiltinProviders([other]).find((p) => p.id === "compat")?.kind).toBe(
      "openai-compatible",
    );
    expect(mergeBuiltinProviders([other]).some((p) => p.kind === "openrouter")).toBe(true);
    expect(
      mergeBuiltinProviders([stock, byHost]).filter((p) => p.kind === "openrouter"),
    ).toHaveLength(1);
    const named = {
      ...stock,
      id: "named-or",
      baseUrl: "https://example.com/v1",
    };
    expect(mergeBuiltinProviders([named]).find((p) => p.id === "named-or")?.kind).toBe(
      "openai-compatible",
    );
  });

  it("migrates stock Cursor Cloud off api2.cursor.sh onto api.cursor.com/v1", () => {
    const stock = {
      id: "cursor",
      name: "Cursor Cloud",
      kind: "cursor" as const,
      baseUrl: "https://api2.cursor.sh",
      apiKey: "crsr_test",
      models: ["cursor-composer"],
      defaultModel: "cursor-composer",
      enabled: true,
      extraHeaders: {},
    };
    const migrated = mergeBuiltinProviders([stock]);
    expect(migrated.find((p) => p.kind === "cursor")).toMatchObject({
      id: "cursor",
      apiKey: "crsr_test",
      enabled: true,
      baseUrl: "https://api.cursor.com/v1",
    });
    expect(
      mergeBuiltinProviders([
        {
          ...stock,
          kind: "openai-compatible",
          id: "compat-cursor",
          baseUrl: "https://api.cursor.com",
        },
      ]).find((p) => p.id === "compat-cursor"),
    ).toMatchObject({ kind: "cursor", baseUrl: "https://api.cursor.com/v1" });
    expect(
      mergeBuiltinProviders([
        { ...stock, id: "legacy-v1", baseUrl: "https://api2.cursor.sh/v1" },
      ]).find((p) => p.id === "legacy-v1")?.baseUrl,
    ).toBe("https://api.cursor.com/v1");
    expect(mergeBuiltinProviders([stock]).find((p) => p.kind === "cursor-cli")).toMatchObject({
      id: "cursor-cli",
      name: "Cursor CLI",
      baseUrl: CURSOR_CLI_BASE_URL,
    });
    expect(mergeBuiltinProviders([stock]).find((p) => p.kind === "claude-code")).toMatchObject({
      id: "claude-code",
      name: "Claude Code",
      baseUrl: CLAUDE_CODE_BASE_URL,
    });
    expect(mergeBuiltinProviders([stock]).find((p) => p.kind === "kiro-cli")).toMatchObject({
      id: "kiro-cli",
      name: "Kiro CLI",
      baseUrl: KIRO_CLI_BASE_URL,
    });
    const legacyCodex = {
      ...stock,
      id: "codex-cli",
      name: "Codex CLI",
      kind: "codex-cli" as const,
      baseUrl: CODEX_CLI_BASE_URL,
      models: ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex"],
      defaultModel: "gpt-5.3-codex",
    };
    expect(mergeBuiltinProviders([legacyCodex]).find((p) => p.kind === "codex-cli")).toMatchObject({
      id: "codex-cli",
      models: ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"],
      defaultModel: "gpt-6-astra",
    });
  });
});

describe("resolveVmHardware", () => {
  it("uses template defaults, then repo profile, then explicit override", () => {
    const base = { ...UBUNTU_DEFAULT_HARDWARE };
    const profiles = [
      {
        id: "p1",
        name: "Heavy",
        repoPattern: "acme/app",
        hardware: { cpuCores: 8, memoryMb: 16384 },
      },
    ];
    expect(resolveVmHardware(base, { os: "ubuntu" }).cpuCores).toBe(4);
    expect(
      resolveVmHardware(base, {
        os: "ubuntu",
        profiles,
        repoUrl: "https://github.com/acme/app.git",
      }).cpuCores,
    ).toBe(8);
    expect(
      resolveVmHardware(base, {
        os: "ubuntu",
        profiles,
        repoUrl: "https://github.com/acme/app.git",
        override: { cpuCores: 2 },
      }).cpuCores,
    ).toBe(2);
    expect(
      resolveVmHardware(base, {
        os: "windows-11",
        profiles,
        repoUrl: "https://github.com/acme/app.git",
      }).cpuCores,
    ).toBe(8);
    expect(
      resolveVmHardware(base, {
        os: "ubuntu",
        profiles: [{ ...profiles[0]!, os: "windows-11" }],
        repoUrl: "https://github.com/acme/app.git",
      }).cpuCores,
    ).toBe(4);
    expect(formatHardware({ cpuCores: 4, memoryMb: 4096, diskSizeGb: 40 })).toBe(
      "4 CPU · 4 GB · 40 GB disk",
    );
  });
});

describe("themes", () => {
  it("resolves known palettes and falls back to ember", () => {
    expect(resolveTheme("nord")).toBe("nord");
    expect(resolveTheme()).toBe("ember");
    expect(resolveTheme("not-a-theme")).toBe("ember");
    expect(THEME_OPTIONS).toHaveLength(97);
    expect(THEME_OPTIONS.map((t) => t.id)).toEqual([
      "ember",
      "midnight",
      "nord",
      "forest",
      "violet",
      "rose",
      "ocean",
      "matrix",
      "tokyo",
      "syntax",
      "paper",
      "linen",
      "cafe",
      "contrast",
      "beacon",
      "ion",
      "siren",
      "keel",
      "glacier",
      "sepia",
      "matcha",
      "canyon",
      "crypt",
      "harvest",
      "mono",
      "dusk",
      "aurora",
      "copper",
      "ink",
      "blossom",
      "slate",
      "neon",
      "brief",
      "folio",
      "ledger",
      "boardroom",
      "solstice",
      "reactor",
      "mocha",
      "primer",
      "vapor",
      "bubblegum",
      "toxic",
      "hotdog",
      "orbit",
      "lunar",
      "cosmos",
      "mars",
      "station",
      "void",
      "hubble",
      "andromeda",
      "cel",
      "toon",
      "lagoon",
      "iris",
      "parchment",
      "harbor",
      "zinc",
      "noir",
      "snow",
      "citrus",
      "clay",
      "pearl",
      "sky",
      "honey",
      "mist",
      "coral",
      "flare",
      "volt",
      "gale",
      "tide",
      "pulse",
      "halo",
      "horizon",
      "prism",
      "daybreak",
      "reef",
      "cinder",
      "nocturne",
      "orchid",
      "wildfire",
      "lilac",
      "marina",
      "saffron",
      "ruby",
      "jade",
      "plasma",
      "banner",
      "brass",
      "frost",
      "canopy",
      "trench",
      "comet",
      "grove",
      "peony",
      "glaze",
    ]);
    expect(THEME_OPTIONS.filter((t) => t.chatScene).map((t) => t.id)).toEqual([
      "cosmos",
      "mars",
      "hubble",
      "andromeda",
    ]);
    expect(THEME_OPTIONS.filter((t) => t.scheme === "light").map((t) => t.id)).toEqual([
      "paper",
      "linen",
      "beacon",
      "glacier",
      "sepia",
      "matcha",
      "ink",
      "blossom",
      "brief",
      "folio",
      "ledger",
      "bubblegum",
      "cel",
      "parchment",
      "zinc",
      "snow",
      "citrus",
      "clay",
      "pearl",
      "sky",
      "honey",
      "mist",
      "coral",
      "gale",
      "tide",
      "halo",
      "daybreak",
      "lilac",
      "marina",
      "saffron",
      "banner",
      "brass",
      "frost",
      "grove",
      "peony",
      "glaze",
    ]);
    expect(THEME_OPTIONS.filter((t) => t.contrast).map((t) => t.id)).toEqual([
      "contrast",
      "beacon",
      "ion",
      "siren",
      "keel",
      "flare",
      "volt",
      "gale",
      "tide",
      "pulse",
      "halo",
      "ruby",
      "jade",
      "plasma",
      "banner",
      "brass",
      "frost",
    ]);
    expect(filterThemeOptions("contrast").map((t) => t.id)).toEqual([
      "contrast",
      "beacon",
      "ion",
      "siren",
      "keel",
      "flare",
      "volt",
      "gale",
      "tide",
      "pulse",
      "halo",
      "ruby",
      "jade",
      "plasma",
      "banner",
      "brass",
      "frost",
    ]);
    expect(THEME_OPTIONS.filter((t) => t.gradient).map((t) => t.id)).toEqual([
      "horizon",
      "prism",
      "daybreak",
      "reef",
      "cinder",
      "nocturne",
      "orchid",
      "wildfire",
      "lilac",
      "marina",
      "saffron",
      "canopy",
      "trench",
      "comet",
      "grove",
      "peony",
      "glaze",
    ]);
    expect(filterThemeOptions("gradient").map((t) => t.id)).toEqual([
      "horizon",
      "prism",
      "daybreak",
      "reef",
      "cinder",
      "nocturne",
      "orchid",
      "wildfire",
      "lilac",
      "marina",
      "saffron",
      "canopy",
      "trench",
      "comet",
      "grove",
      "peony",
      "glaze",
    ]);
    expect(filterThemeOptions("light").some((t) => t.contrast)).toBe(false);
    expect(filterThemeOptions("dark").some((t) => t.contrast)).toBe(false);
    expect(filterThemeOptions("light").some((t) => t.gradient)).toBe(false);
    expect(filterThemeOptions("dark").some((t) => t.gradient)).toBe(false);
    expect(filterThemeOptions("all")).toHaveLength(THEME_OPTIONS.length);
    expect(themeFamily(themeOption("nord"))).toBe("dark");
    expect(themeFamily(themeOption("paper"))).toBe("light");
    expect(themeFamily(themeOption("beacon"))).toBe("contrast");
    expect(themeFamily(themeOption("horizon"))).toBe("gradient");
    expect(themeFamily(themeOption("daybreak"))).toBe("gradient");
    expect(themeFamilyLabel("contrast")).toBe("Contrast");
    expect(themeFamilyLabel("gradient")).toBe("Gradient");
  });
});

describe("assessSetup", () => {
  it("asks for the wizard until a provider exists", () => {
    expect(
      assessSetup({
        hypervisorKind: "mock",
        qemuFound: false,
        linuxImageReady: false,
        hasProvider: false,
        hasGoldenImage: false,
        platform: "linux",
      }),
    ).toMatchObject({
      needsWizard: true,
      ready: false,
      dockerFound: false,
      qemuHint:
        "sudo apt install qemu-system-x86 qemu-system-arm qemu-utils ovmf qemu-efi-aarch64 swtpm",
      hostOs: { platform: "linux", label: "Linux" },
      qemuInstall: { method: "apt", canInstall: false },
    });
    expect(
      assessSetup({
        hypervisorKind: "mock",
        qemuFound: false,
        linuxImageReady: false,
        dockerFound: true,
        hasProvider: true,
        hasGoldenImage: false,
        platform: "linux",
      }),
    ).toMatchObject({
      needsWizard: false,
      ready: true,
      dockerFound: true,
    });
    expect(
      assessSetup({
        hypervisorKind: "qemu",
        qemuFound: true,
        linuxImageReady: true,
        hasProvider: true,
        hasGoldenImage: false,
        setupCompleted: false,
        platform: "darwin",
        packageManager: "brew",
      }),
    ).toMatchObject({
      needsWizard: false,
      ready: true,
      qemuHint: "brew install qemu",
      hostOs: { platform: "darwin", label: "macOS" },
      qemuInstall: { method: "brew", canInstall: true },
    });
    const skipped = assessSetup({
      hypervisorKind: "mock",
      qemuFound: false,
      linuxImageReady: false,
      hasProvider: false,
      hasGoldenImage: false,
      setupCompleted: true,
      platform: "win32",
      packageManager: "winget",
    });
    expect(skipped).toMatchObject({
      needsWizard: false,
      hostOs: { platform: "win32", label: "Windows" },
      qemuHint: expect.stringContaining("winget install"),
      qemuInstall: { method: "winget", canInstall: true },
    });
    expect(setupHasRemainingTodos(skipped)).toBe(true);
    expect(setupTodos(skipped)).toEqual([
      { id: "provider", label: "Provider", done: false },
      { id: "docker", label: "Docker", done: false, optional: true },
      { id: "vm", label: "VM desktop", done: false, optional: true },
    ]);
    expect(hasUsableKey("sk-real")).toBe(true);
    expect(hasUsableKey("", "http://127.0.0.1:11434/v1")).toBe(true);
    expect(hasUsableKey("", "https://opencode.ai/zen/v1")).toBe(false);
    expect(hasUsableKey("", CURSOR_CLI_BASE_URL)).toBe(true);
    expect(hasUsableKey("", "", "cursor-cli")).toBe(true);
    expect(hasUsableKey("", CLAUDE_CODE_BASE_URL)).toBe(true);
    expect(hasUsableKey("", "", "claude-code")).toBe(true);
    expect(hasUsableKey("", CODEX_CLI_BASE_URL)).toBe(true);
    expect(hasUsableKey("", "", "codex-cli")).toBe(true);
    expect(hasUsableKey("", KIRO_CLI_BASE_URL)).toBe(true);
    expect(hasUsableKey("", "", "kiro-cli")).toBe(true);
  });

  it("parses os-release and picks a package manager", () => {
    expect(
      parseOsRelease('NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04 LTS"\n'),
    ).toEqual({ id: "ubuntu", idLike: "debian", prettyName: "Ubuntu 24.04 LTS" });
    expect(packageManagerForDistro("ubuntu", "debian")).toBe("apt");
    expect(packageManagerForDistro("fedora")).toBe("dnf");
    expect(packageManagerForDistro("arch")).toBe("pacman");
    expect(packageManagerForDistro("omarchy")).toBe("pacman");
    expect(packageManagerForDistro("opensuse-tumbleweed", "suse")).toBe("zypper");
    expect(qemuInstallRecipe("linux", "dnf").displayCommand).toContain("dnf install");
    expect(qemuInstallRecipe("win32", "winget").canInstall).toBe(true);
    expect(qemuInstallRecipe("win32").canInstall).toBe(false);
    expect(qemuInstallRecipe("win32").manualHint).toContain("qemu.org/download/#windows");
  });
});

describe("latestGoldenImage", () => {
  it("returns the newest image for that OS", () => {
    expect(
      latestGoldenImage(
        [
          { id: "old", name: "a", os: "ubuntu", path: "/a", createdAt: "2026-01-01T00:00:00.000Z" },
          {
            id: "win",
            name: "w",
            os: "windows-11",
            path: "/w",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
          { id: "new", name: "b", os: "ubuntu", path: "/b", createdAt: "2026-08-01T00:00:00.000Z" },
        ],
        "ubuntu",
      )?.id,
    ).toBe("new");
    expect(latestGoldenImage([], "ubuntu")).toBeUndefined();
  });
});

describe("formatUsageHint", () => {
  it("formats tokens and an optional dollar estimate", () => {
    expect(formatUsageHint()).toBeUndefined();
    expect(formatUsageHint({ inputTokens: 0, outputTokens: 0 })).toBeUndefined();
    expect(formatUsageHint({ inputTokens: 1234, outputTokens: 56 })).toBe("1,234 in · 56 out");
    expect(
      formatUsageHint(
        { inputTokens: 1_000_000, outputTokens: 500_000 },
        { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
      ),
    ).toBe("1,000,000 in · 500,000 out · $10.50");
    expect(
      formatUsageHint(
        { inputTokens: 100, outputTokens: 200 },
        { inputUsdPerMillion: 5, outputUsdPerMillion: 15 },
      ),
    ).toBe("100 in · 200 out · $0.0035");
    expect(formatUsageHint(undefined, undefined, 0.12)).toBe("$0.12 VM");
    expect(
      formatUsageHint(
        { inputTokens: 1_000_000, outputTokens: 500_000 },
        { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
        0.12,
      ),
    ).toBe("1,000,000 in · 500,000 out · $10.50 · $0.12 VM");
  });
});

describe("guestSharePath", () => {
  it("uses /mnt/host on Linux and C:\\host on Windows", () => {
    expect(guestShareRoot("ubuntu")).toBe("/mnt/host");
    expect(guestSharePath("debian", "notes.txt")).toBe("/mnt/host/notes.txt");
    expect(guestShareRoot("windows-11")).toBe("C:\\host");
    expect(guestSharePath("windows-10", "a/b.txt")).toBe("C:\\host\\b.txt");
  });
});

describe("VIRTIO_ISO", () => {
  it("points at the stable Fedora VirtIO ISO", async () => {
    const { VIRTIO_ISO } = await import("./index.js");
    expect(VIRTIO_ISO.filename).toBe("virtio-win.iso");
    expect(VIRTIO_ISO.url).toContain("virtio-win");
  });
});

describe("canRewind", () => {
  it("is true only when a checkpoint exists", () => {
    expect(canRewind({})).toBe(false);
    expect(
      canRewind({
        checkpoint: { id: "c1", messageCount: 0, createdAt: "2020-01-01T00:00:00.000Z" },
      }),
    ).toBe(true);
    expect(
      canRewind({
        checkpoints: [{ id: "c2", messageCount: 1, createdAt: "2020-01-01T00:00:00.000Z" }],
      }),
    ).toBe(true);
  });

  it("finds the last user message", () => {
    expect(lastUserMessage([])).toBeUndefined();
    expect(
      lastUserMessage([
        { id: "u1", role: "user", content: "one", createdAt: "2020-01-01T00:00:00.000Z" },
        { id: "a1", role: "assistant", content: "ok", createdAt: "2020-01-01T00:00:01.000Z" },
        { id: "u2", role: "user", content: "two", createdAt: "2020-01-01T00:00:02.000Z" },
      ])?.content,
    ).toBe("two");
  });
});

describe("isHumanDriving", () => {
  it("is true only in human control", async () => {
    const { isHumanDriving } = await import("./index.js");
    expect(isHumanDriving({})).toBe(false);
    expect(isHumanDriving({ control: "agent" })).toBe(false);
    expect(isHumanDriving({ control: "human" })).toBe(true);
  });
});

describe("overlayFromTool", () => {
  it("maps mouse, key, type, and focus tools", () => {
    expect(overlayFromTool("s", "mouse_click", { x: 10, y: 20 })).toEqual({
      sessionId: "s",
      name: "mouse_click",
      x: 10,
      y: 20,
    });
    expect(overlayFromTool("s", "mouse_scroll", { x: 4, y: 8, delta: -3 })).toEqual({
      sessionId: "s",
      name: "mouse_scroll",
      x: 4,
      y: 8,
    });
    expect(overlayFromTool("s", "mouse_drag", { x2: 100, y2: 200 })?.x).toBe(100);
    expect(overlayFromTool("s", "key", { key: "ctrl+c" })?.key).toBe("ctrl+c");
    expect(overlayFromTool("s", "type_text", { text: "hello" })?.text).toBe("hello");
    expect(overlayFromTool("s", "window_focus", { title: "Terminal" })?.title).toBe("Terminal");
    expect(overlayFromTool("s", "exec", { command: "ls" })).toBeUndefined();
    expect(overlayFromTool("s", "browser_tabs", { action: "new", url: "https://ex.test" })).toEqual(
      {
        sessionId: "s",
        name: "browser_tabs",
        title: "https://ex.test",
      },
    );
    expect(overlayFromTool("s", "exec", { command: "https://ex.test" })?.title).toBe(
      "https://ex.test",
    );
  });
});

describe("overlayPosition", () => {
  it("scales Docker Chromium clicks against 1280x800", () => {
    expect(CHROMIUM_DEVICE_SCALE).toBe(2);
    expect(overlayPosition({ x: 640, y: 400 }, CHROMIUM_VIEWPORT)).toEqual({
      left: "50%",
      top: "50%",
    });
    expect(overlayPosition({ x: 640, y: 400 }, GUEST_SCREEN).left).not.toBe("50%");
  });
});

describe("browser messages", () => {
  it("parses a screencast frame and detects Docker browser activity", () => {
    expect(
      parseBrowserServerMessage(
        JSON.stringify({
          type: "frame",
          mime: "image/jpeg",
          data: "qq==",
          metadata: { deviceWidth: 1280, deviceHeight: 800 },
        }),
      )?.type,
    ).toBe("frame");
    expect(
      parseBrowserServerMessage(JSON.stringify({ type: "downloads", files: ["report.csv"] }))?.type,
    ).toBe("downloads");
    expect(isDockerBrowserActivity("mouse_click")).toBe(true);
    expect(isDockerBrowserActivity("exec", { command: "https://ex.test" })).toBe(true);
    expect(isDockerBrowserActivity("exec", { command: "ls" })).toBe(false);
    expect(isMutatingBrowserTool("mouse_click")).toBe(true);
    expect(isMutatingBrowserTool("browser_tabs", { action: "list" })).toBe(false);
    expect(isMutatingBrowserTool("browser_tabs", { action: "new" })).toBe(true);
    expect(isMutatingBrowserTool("browser_snapshot")).toBe(false);
    expect(isMutatingBrowserTool("browser_click")).toBe(true);
    expect(isMutatingBrowserTool("screenshot")).toBe(false);
    expect(isOperatorDrivingBrowser({ browserControl: "human" })).toBe(true);
    expect(parseBrowserClientMessage(JSON.stringify({ type: "takeover" }))?.type).toBe("takeover");
    expect(
      parseBrowserClientMessage(JSON.stringify({ type: "open-download", name: "a.csv" }))?.type,
    ).toBe("open-download");
    expect(
      mapCanvasToDevice(320, 200, { left: 0, top: 0, width: 640, height: 400 }, CHROMIUM_VIEWPORT),
    ).toEqual({ x: 640, y: 400 });
    expect(LOCUS_CHROME_PROFILE_DIR).toBe(".locus-chrome");
    expect(LOCUS_CHROME_PROFILE_GUEST).toBe("/workspace/.locus-chrome");
    expect(browserDeniedHost("https://evil.example/login", "restricted", ["github.com"])).toBe(
      "evil.example",
    );
    expect(
      browserDeniedHost("https://github.com/acme", "restricted", ["github.com"]),
    ).toBeUndefined();
    expect(browserDeniedHost("https://evil.example/", "open", ["github.com"])).toBeUndefined();
    expect(browserDeniedHost("about:blank", "restricted", [])).toBeUndefined();
  });
});

describe("replayFrames", () => {
  it("builds a timeline from chat messages", async () => {
    const { replayFrames, canReplay } = await import("./index.js");
    const messages = [
      {
        id: "1",
        role: "user" as const,
        content: "click it",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "2",
        role: "tool" as const,
        content: "ok",
        createdAt: "2020-01-01T00:00:01.000Z",
        screenshotBase64: "abc",
        toolCalls: [
          {
            id: "t1",
            name: "mouse_click",
            arguments: { x: 8, y: 9 },
            startedAt: "2020-01-01T00:00:01.000Z",
          },
        ],
      },
    ];
    expect(canReplay(messages)).toBe(true);
    expect(canReplay([])).toBe(false);
    const frames = replayFrames("s", messages);
    expect(frames).toHaveLength(2);
    expect(frames[1]?.overlay).toEqual({ sessionId: "s", name: "mouse_click", x: 8, y: 9 });
    expect(frames[1]?.screenshotBase64).toBe("abc");
    const { SELF_CORRECT_NUDGE, EMPTY_CANVAS_NUDGE } = await import("./index.js");
    expect(
      replayFrames("s", [
        ...messages,
        {
          id: "n1",
          role: "system",
          content: SELF_CORRECT_NUDGE,
          createdAt: "2020-01-01T00:00:02.000Z",
        },
        {
          id: "n2",
          role: "system",
          content: EMPTY_CANVAS_NUDGE,
          createdAt: "2020-01-01T00:00:03.000Z",
        },
      ]),
    ).toHaveLength(2);
  });
});

describe("timelineStops", () => {
  it("maps screenshot frames to the turn checkpoint and appends Now", async () => {
    const { timelineStops, canShowTimeline } = await import("./index.js");
    const session = {
      id: "s",
      messages: [
        {
          id: "u1",
          role: "user" as const,
          content: "click it",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        {
          id: "t1",
          role: "tool" as const,
          content: "clicked",
          createdAt: "2020-01-01T00:00:01.000Z",
          screenshotName: "t1.png",
          toolCalls: [
            {
              id: "c1",
              name: "mouse_click",
              arguments: { x: 8, y: 9 },
              startedAt: "2020-01-01T00:00:01.000Z",
            },
          ],
        },
      ],
      checkpoints: [{ id: "cp1", messageCount: 0, createdAt: "2020-01-01T00:00:00.000Z" }],
    };
    const stops = timelineStops(session);
    expect(canShowTimeline(session)).toBe(true);
    expect(stops.map((stop) => stop.id)).toEqual(["t1", "live"]);
    expect(stops[0]?.checkpointId).toBe("cp1");
    expect(stops[0]?.overlay).toEqual({ sessionId: "s", name: "mouse_click", x: 8, y: 9 });
    expect(stops[1]?.live).toBe(true);
  });

  it("keeps unmatched checkpoints for Docker-style sessions without screenshots", async () => {
    const { timelineStops, canShowTimeline } = await import("./index.js");
    const empty = { id: "s", messages: [] };
    expect(canShowTimeline(empty)).toBe(false);
    expect(timelineStops(empty)).toEqual([]);

    const stops = timelineStops({
      id: "s",
      messages: [
        { id: "u1", role: "user", content: "fix it", createdAt: "2020-01-01T00:00:00.000Z" },
      ],
      checkpoints: [
        { id: "cp1", messageCount: 0, createdAt: "2020-01-01T00:00:00.000Z" },
        { id: "cp2", messageCount: 1, createdAt: "2020-01-01T00:01:00.000Z" },
      ],
    });
    expect(stops.map((stop) => [stop.id, stop.checkpointId, Boolean(stop.live)])).toEqual([
      ["checkpoint:cp1", "cp1", false],
      ["checkpoint:cp2", "cp2", false],
      ["live", undefined, true],
    ]);
  });

  it("caps screenshot thumbs and keeps older turns as checkpoint markers", async () => {
    const { timelineStops, MAX_TIMELINE_SHOTS } = await import("./index.js");
    const messages = Array.from({ length: MAX_TIMELINE_SHOTS + 2 }, (_, index) => ({
      id: `t${index}`,
      role: "tool" as const,
      content: "ok",
      createdAt: `2020-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
      screenshotName: `t${index}.png`,
    }));
    const stops = timelineStops({
      id: "s",
      messages,
      checkpoints: [
        { id: "old", messageCount: 0, createdAt: "2020-01-01T00:00:00.000Z" },
        { id: "kept", messageCount: 2, createdAt: "2020-01-01T00:00:02.000Z" },
      ],
    });
    const shots = stops.filter((stop) => stop.screenshotName);
    expect(shots).toHaveLength(MAX_TIMELINE_SHOTS);
    expect(shots[0]?.id).toBe("t2");
    expect(stops[0]).toMatchObject({ id: "checkpoint:old", checkpointId: "old" });
  });
});

describe("configuredGuestOsOptions", () => {
  const templates = [
    { os: "ubuntu" as const, isoPath: "/isos/ubuntu.iso" },
    { os: "debian" as const, isoPath: "  " },
    { os: "omarchy" as const, isoPath: "/isos/omarchy.iso" },
    { os: "windows-11" as const, isoPath: "/isos/win11.iso" },
    { os: "windows-10" as const, isoPath: "" },
  ];

  it("keeps only guest OS types that have an ISO path", () => {
    expect(configuredGuestOsOptions(templates).map((opt) => opt.os)).toEqual([
      "ubuntu",
      "omarchy",
      "windows-11",
    ]);
    expect(configuredGuestOsOptions(undefined)).toEqual([]);
  });

  it("prefers a remembered OS when that ISO is configured", () => {
    expect(pickConfiguredOs(templates, "windows-11")).toBe("windows-11");
    expect(pickConfiguredOs(templates, "debian")).toBe("ubuntu");
    expect(pickConfiguredOs([], "windows-10")).toBe("windows-10");
  });
});

describe("vision and compactMessages", () => {
  it("defaults vision off for docker and latest for VMs", () => {
    expect(sessionVision({})).toBe("latest");
    expect(sessionVision({ runtime: "docker" })).toBe("off");
    expect(sessionVision({ runtime: "host" })).toBe("off");
    expect(sessionVision({ runtime: "host", vision: "latest" })).toBe("off");
    expect(sessionVision({ runtime: "docker", vision: "latest" })).toBe("latest");
    expect(sessionVision({ runtime: "vm", vision: "off" })).toBe("off");
    expect(sessionWebSearch({})).toBe(false);
    expect(sessionWebSearch({ webSearch: true })).toBe(true);
    expect(formatWebSearch(true)).toBe("On");
    expect(formatWebSearch(false)).toBe("Off");
    expect(sessionLiveChrome({})).toBe(false);
    expect(sessionLiveChrome({ liveChrome: true, runtime: "host" })).toBe(true);
    expect(sessionLiveChrome({ liveChrome: true, runtime: "docker" })).toBe(false);
    expect(formatLiveChrome(true)).toBe("On");
    expect(MAX_AGENT_ROUNDS).toBeGreaterThan(8);
  });

  it("keeps only the latest screenshot and truncates old tool output", () => {
    const messages = [
      {
        id: "t1",
        role: "tool" as const,
        content: "x".repeat(9000),
        screenshotBase64: "old",
        createdAt: "",
      },
      { id: "u", role: "user" as const, content: "ok", createdAt: "" },
      {
        id: "t2",
        role: "tool" as const,
        content: "new shot",
        screenshotBase64: "new",
        createdAt: "",
      },
    ];
    const latest = compactMessages(messages, { vision: "latest", maxToolChars: 1000 });
    expect(latest[0]?.screenshotBase64).toBeUndefined();
    expect(latest[0]?.content).toContain("truncated");
    expect(latest[2]?.screenshotBase64).toBe("new");
    const off = compactMessages(messages, { vision: "off" });
    expect(off.every((m) => !m.screenshotBase64)).toBe(true);
  });

  it("keeps user-attached screenshots even when guest vision is off", () => {
    const messages = [
      {
        id: "u",
        role: "user" as const,
        content: "see this",
        screenshotBase64: "user-shot",
        createdAt: "",
      },
      {
        id: "t1",
        role: "tool" as const,
        content: "guest shot",
        screenshotBase64: "guest",
        createdAt: "",
      },
    ];
    const off = compactMessages(messages, { vision: "off" });
    expect(off[0]?.screenshotBase64).toBe("user-shot");
    expect(off[1]?.screenshotBase64).toBeUndefined();
  });

  it("folds old turns into a system note when the transcript is over budget", () => {
    const messages = [
      { id: "u1", role: "user" as const, content: "first task ".repeat(20), createdAt: "" },
      {
        id: "a1",
        role: "assistant" as const,
        content: "working",
        createdAt: "",
        toolCalls: [{ id: "c1", name: "grep" as const, arguments: {}, startedAt: "" }],
      },
      { id: "t1", role: "tool" as const, content: "hits", createdAt: "", toolCallId: "c1" },
      { id: "u2", role: "user" as const, content: "now this", createdAt: "" },
      { id: "a2", role: "assistant" as const, content: "ok", createdAt: "" },
    ];
    const folded = foldOldTurns(messages, 20);
    expect(folded.note).toMatch(/omitted/);
    expect(folded.note).toMatch(/first task/);
    expect(folded.note).toMatch(/grep/);
    expect(folded.messages[0]?.id).toBe("u2");
    expect(foldOldTurns(messages, 50_000).note).toBeUndefined();
  });

  it("shrinks older tool results more than the newest ones", () => {
    const messages = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      role: "tool" as const,
      content: "x".repeat(3_000),
      createdAt: "",
    }));
    const compacted = compactMessages(messages, { vision: "off" });
    expect(compacted[0]?.content.length).toBeLessThan(1_400);
    expect(compacted[0]?.content).toContain("truncated");
    expect(compacted[5]?.content.length).toBe(3_000);
  });

  it("stubs completed file_write arguments so the next turn is not a huge HTML echo", () => {
    const html = "<html>" + "x".repeat(3_000) + "</html>";
    const messages = [
      {
        id: "a1",
        role: "assistant" as const,
        content: "",
        createdAt: "",
        toolCalls: [
          {
            id: "c1",
            name: "file_write" as const,
            arguments: { path: "/workspace/index.html", content: html },
            startedAt: "",
          },
        ],
      },
      {
        id: "t1",
        role: "tool" as const,
        content: "wrote /workspace/index.html",
        createdAt: "",
        toolCallId: "c1",
      },
    ];
    const compacted = compactMessages(messages, { vision: "off" });
    const content = compacted[0]?.toolCalls?.[0]?.arguments?.content;
    expect(typeof content).toBe("string");
    expect(String(content).length).toBeLessThan(html.length);
    expect(String(content)).toContain("already written");
    expect(String(content)).toContain("/workspace/index.html");
  });

  it("does not stub a failed file_write so the model can retry the contents", () => {
    const html = "<html>" + "x".repeat(3_000) + "</html>";
    const messages = [
      {
        id: "a1",
        role: "assistant" as const,
        content: "",
        createdAt: "",
        toolCalls: [
          {
            id: "c1",
            name: "file_write" as const,
            arguments: { path: "/workspace/index.html", content: html },
            startedAt: "",
            error: "refusing to write /workspace/index.html",
          },
        ],
      },
      {
        id: "t1",
        role: "tool" as const,
        content: "refusing to write /workspace/index.html",
        createdAt: "",
        toolCallId: "c1",
      },
    ];
    const compacted = compactMessages(messages, { vision: "off" });
    expect(compacted[0]?.toolCalls?.[0]?.arguments?.content).toBe(html);
  });

  it("stubs completed apply_patch streamContent so Cursor CLI writes are not a 13k HTML echo", () => {
    const html = "<!DOCTYPE html>" + "x".repeat(3_000);
    const messages = [
      {
        id: "a1",
        role: "assistant" as const,
        content: "",
        createdAt: "",
        toolCalls: [
          {
            id: "c1",
            name: "apply_patch" as const,
            arguments: {
              path: "/workspace/.locus-variants/direction-1.html",
              streamContent: html,
            },
            startedAt: "",
          },
        ],
      },
      {
        id: "t1",
        role: "tool" as const,
        content: "wrote direction-1.html",
        createdAt: "",
        toolCallId: "c1",
      },
    ];
    const compacted = compactMessages(messages, { vision: "off" });
    const body = compacted[0]?.toolCalls?.[0]?.arguments?.streamContent;
    expect(typeof body).toBe("string");
    expect(String(body).length).toBeLessThan(html.length);
    expect(String(body)).toContain("already written");
    expect(String(body)).toContain("/workspace/.locus-variants/direction-1.html");
  });

  it("stubs completed file_write fileText from Cursor CLI writeToolCall", () => {
    const html = "<!DOCTYPE html>" + "x".repeat(3_000);
    const messages = [
      {
        id: "a1",
        role: "assistant" as const,
        content: "",
        createdAt: "",
        toolCalls: [
          {
            id: "c1",
            name: "file_write" as const,
            arguments: {
              path: "/workspace/index.html",
              fileText: html,
            },
            startedAt: "",
          },
        ],
      },
      {
        id: "t1",
        role: "tool" as const,
        content: "wrote index.html",
        createdAt: "",
        toolCallId: "c1",
      },
    ];
    const compacted = compactMessages(messages, { vision: "off" });
    const body = compacted[0]?.toolCalls?.[0]?.arguments?.fileText;
    expect(typeof body).toBe("string");
    expect(String(body).length).toBeLessThan(html.length);
    expect(String(body)).toContain("already written");
    expect(String(body)).toContain("/workspace/index.html");
  });
});

describe("guest readiness", () => {
  it("treats running, ready, and paused as usable", () => {
    expect(isGuestReady("running")).toBe(true);
    expect(isGuestReady("ready")).toBe(true);
    expect(isGuestReady("paused")).toBe(true);
    expect(isGuestReady("booting")).toBe(false);
    expect(isGuestStarting("booting")).toBe(true);
    expect(isGuestStarting("running")).toBe(false);
  });
});

describe("agent rounds and tokens", () => {
  it("clamps round limits and estimates tokens from length", () => {
    expect(MAX_AGENT_ROUNDS).toBe(128);
    expect(agentRoundLimit(2)).toBe(4);
    expect(agentRoundLimit(200)).toBe(128);
    expect(agentRoundLimit(undefined)).toBeUndefined();
    expect(agentRoundLimit(0)).toBeUndefined();
    expect(agentRoundLimit(48)).toBeUndefined();
    expect(agentRoundLimit(64)).toBe(64);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(8))).toBe(2);
    expect(estimateTokens("a".repeat(16), 8)).toBe(2);
  });
});

describe("guest passwords and MCP names", () => {
  it("generates a non-default Windows-safe password", () => {
    const password = generateGuestPassword();
    expect(isDefaultGuestPassword(LEGACY_LINUX_GUEST_PASSWORD)).toBe(true);
    expect(isDefaultGuestPassword(LEGACY_WINDOWS_GUEST_PASSWORD)).toBe(true);
    expect(isDefaultGuestPassword(password)).toBe(false);
    expect(password.startsWith("Locus.")).toBe(true);
    expect(password.endsWith("!")).toBe(true);
    expect(password).not.toMatch(/[<>&"]/);
  });

  it("names MCP tools for OpenAI and gates them on approval", () => {
    expect(mcpFunctionName("github", "list_issues")).toBe("mcp_github_list_issues");
    expect(isMcpToolName("mcp_github_list_issues")).toBe(true);
    expect(isMcpToolName("exec")).toBe(false);
    expect(
      parseMcpToolNames(
        "mcp_jira_search, jira_search, slack_post, plugin_status_list, manage_integration_plugin, exec",
      ),
    ).toEqual([
      "mcp_jira_search",
      "jira_search",
      "slack_post",
      "plugin_status_list",
      "manage_integration_plugin",
    ]);
    expect(automationAllowsIntegration({ automationId: "a1" }, "jira_search")).toBe(false);
    expect(
      automationAllowsIntegration(
        { automationId: "a1", allowedMcpTools: ["jira_search"] },
        "jira_search",
      ),
    ).toBe(true);
    expect(automationAllowsIntegration({}, "jira_search")).toBe(true);
    expect(automationAllowsMcpTool({ automationId: "a1" }, "mcp_echo_echo")).toBe(false);
    expect(
      automationAllowsMcpTool(
        { automationId: "a1", allowedMcpTools: ["mcp_echo_echo"] },
        "mcp_echo_echo",
      ),
    ).toBe(true);
    expect(automationAllowsMcpTool({}, "mcp_echo_echo")).toBe(true);
    expect(automationAllowsMcpTool({ automationId: "a1" }, undefined)).toBe(true);
    expect(isWebSearchToolName("websearch")).toBe(true);
    expect(isWebSearchToolName("mcp_github_list_issues")).toBe(false);
    expect(toolNeedsApproval("websearch")).toBe(false);
    expect(toolNeedsApproval("git_push")).toBe(true);
    expect(toolNeedsApproval("mcp_github_list_issues")).toBe(true);
    expect(toolNeedsApproval("plugin_status_create")).toBe(true);
    expect(toolNeedsApproval("manage_integration_plugin")).toBe(true);
    expect(toolNeedsApproval("plugin_status_list", { autoAllow: ["plugin"] })).toBe(false);
    expect(toolNeedsApproval("mcp_list_tools")).toBe(false);
    expect(toolNeedsApproval("mcp_get_tool_info")).toBe(false);
    expect(toolNeedsApproval("read_skill")).toBe(false);
    expect(toolNeedsApproval("ask_user")).toBe(true);
    expect(
      toolNeedsApproval("mcp_github_list_issues", { autoAllow: ["mcp_github_list_issues"] }),
    ).toBe(false);
    expect(toolNeedsApproval("exec")).toBe(false);
  });
});

describe("slash commands", () => {
  it("filters composer queries and only exact tokens execute", async () => {
    const { matchSlashCommands, slashCommandFromInput } = await import("./index.js");
    expect(matchSlashCommands("", "vm")).toEqual([]);
    expect(matchSlashCommands("/un", "vm").map((cmd) => cmd.name)).toEqual(["undo"]);
    expect(matchSlashCommands("/take", "docker").map((cmd) => cmd.name)).toEqual(["takeover"]);
    expect(matchSlashCommands("/vis", "vm").map((cmd) => cmd.id)).toEqual(["vision"]);
    expect(matchSlashCommands("/vis", "docker").map((cmd) => cmd.id)).toEqual(["vision"]);
    expect(matchSlashCommands("/web", "vm").map((cmd) => cmd.id)).toEqual(["websearch"]);
    expect(slashCommandFromInput("/websearch", "docker")?.id).toBe("websearch");
    expect(slashCommandFromInput("/undo", "vm")?.id).toBe("undo");
    expect(slashCommandFromInput("/undo please", "vm")).toBeUndefined();
    expect(slashCommandFromInput("/nope", "vm")).toBeUndefined();
    expect(slashCommandFromInput("/workers", "docker")?.id).toBe("workers");
    expect(slashCommandFromInput("/workers", "vm")).toBeUndefined();
    expect(slashCommandFromInput("/record", "docker")?.id).toBe("record");
    expect(slashCommandFromInput("/roles", "docker")?.id).toBe("roles");
    expect(slashCommandFromInput("/plan", "docker")?.id).toBe("plan");
    expect(slashCommandFromInput("/undo", "host")?.id).toBe("undo");
    expect(slashCommandFromInput("/clear", "host")?.id).toBe("clear");
    expect(slashCommandFromInput("/clear", "docker")?.id).toBe("clear");
    expect(slashCommandFromInput("/websearch", "host")?.id).toBe("websearch");
    expect(slashCommandFromInput("/chrome", "host")?.id).toBe("chrome");
    expect(slashCommandFromInput("/chrome", "docker")).toBeUndefined();
    expect(slashCommandFromInput("/takeover", "host")).toBeUndefined();
    expect(slashCommandFromInput("/vision", "host")).toBeUndefined();
    expect(slashCommandFromInput("/workers", "host")).toBeUndefined();
    expect(slashCommandFromInput("/record", "host")).toBeUndefined();
    const { matchSlashMenu, composerOverflowCommands } = await import("./index.js");
    expect(composerOverflowCommands("vm").map((cmd) => cmd.id)).toEqual([
      "plan",
      "websearch",
      "vision",
      "record",
      "roles",
      "undo",
      "fork",
      "clear",
    ]);
    expect(composerOverflowCommands("host").map((cmd) => cmd.id)).toEqual([
      "plan",
      "websearch",
      "chrome",
      "roles",
      "undo",
      "fork",
      "clear",
    ]);
    const menu = matchSlashMenu("/re", "vm", [
      { id: "1", name: "review", title: "Review", hint: "hint", body: "Do it.", enabled: true },
    ]);
    expect(menu.some((item) => item.kind === "skill" && item.skill.name === "review")).toBe(true);
    expect(
      matchSlashMenu("/un", "vm", [
        { id: "1", name: "Undo", title: "Nope", hint: "hint", body: "Do it.", enabled: true },
      ]).every((item) => item.kind === "command"),
    ).toBe(true);
  });
});

describe("approvals, environment, roles, and memory", () => {
  it("applies approval policy, environment install, roles, and memory prompts", async () => {
    const {
      parseApprovalPolicy,
      toolNeedsApproval,
      parseLocusEnvironment,
      environmentInstallCommand,
      nextAgentRole,
      rolePlaybook,
      formatMemoriesPrompt,
    } = await import("./index.js");
    const policy = parseApprovalPolicy({
      alwaysAsk: ["exec"],
      deny: ["git_push"],
      protectDefaultBranch: true,
    });
    expect(toolNeedsApproval("exec", policy)).toBe(true);
    expect(toolNeedsApproval("git_push", policy, { branch: "main" })).toBe(false);
    expect(toolNeedsApproval("grep", policy)).toBe(false);
    expect(toolNeedsApproval("mcp_echo", parseApprovalPolicy({ autoAllow: ["mcp"] }))).toBe(false);
    const env = parseLocusEnvironment({
      packages: ["git", "curl"],
      ports: [5173],
      start: "npm run dev",
    });
    expect(environmentInstallCommand(env!)).toMatch(/apt-get install -y git curl/);
    expect(nextAgentRole("planner")).toBe("implementer");
    expect(rolePlaybook("reviewer")).toMatch(/reviewer/);
    expect(
      formatMemoriesPrompt([{ id: "1", text: "Uses Vite", createdAt: "2026-01-01T00:00:00.000Z" }]),
    ).toMatch(/Uses Vite/);
  });
});

describe("deferred MCP, offload, and ask_user helpers", () => {
  it("adds meta tools only when a server is deferred", async () => {
    const { selectMcpPromptTools, MCP_LIST_TOOLS_NAME, MCP_CALL_NAME } = await import("./index.js");
    const tool = {
      name: "mcp_echo_echo",
      description: "echo",
      parameters: { type: "object" as const, properties: {} },
    };
    const nativeNames = new Map([["mcp_echo_echo", "echo"]]);
    expect(
      selectMcpPromptTools([
        { id: "echo", name: "Echo", preload: true, tools: [tool], nativeNames },
      ]).map((row) => row.name),
    ).toEqual(["mcp_echo_echo"]);
    const deferred = selectMcpPromptTools([
      { id: "echo", name: "Echo", preload: false, tools: [tool], nativeNames },
    ]);
    expect(deferred.some((row) => row.name === MCP_LIST_TOOLS_NAME)).toBe(true);
    expect(deferred.some((row) => row.name === MCP_CALL_NAME)).toBe(true);
    expect(deferred.some((row) => row.name === "mcp_echo_echo")).toBe(false);
  });

  it("offloads the largest results first", async () => {
    const { pickOffloadIndexes, shouldOffloadToolResult, formatOffloadedResult } =
      await import("./index.js");
    expect(shouldOffloadToolResult("x".repeat(16_385))).toBe(true);
    expect(shouldOffloadToolResult("x".repeat(16_384))).toBe(false);
    expect(pickOffloadIndexes(["a".repeat(10), "b".repeat(50_000), "c".repeat(30_000)])).toEqual([
      1, 2,
    ]);
    expect(
      formatOffloadedResult("/workspace/.locus/tool-results/t1.txt", "hello".repeat(200)),
    ).toMatch(/tool-results\/t1\.txt/);
    expect(
      formatOffloadedResult("/workspace/.locus/tool-results/t1.txt", "hello".repeat(200)),
    ).toMatch(/do not re-fetch with exec or curl/i);
    expect(
      formatOffloadedResult("/workspace/.locus/tool-results/t1.txt", "hello".repeat(200)),
    ).toMatch(/ok: true\. spilled: true/);
    const { encodeIntegrationJson } = await import("./index.js");
    const huge = encodeIntegrationJson({ title: "x".repeat(600_000) });
    expect(huge.length).toBeGreaterThan(8_000);
    expect(huge).toMatch(/Do not re-fetch with exec or curl/);
  });
});
