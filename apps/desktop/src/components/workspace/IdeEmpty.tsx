import {
  formatRemoteError,
  forgesWithTokens,
  forgeLabel,
  forgeShort,
  isForgeAuthError,
  parseRepoUrl,
  shortRepoName,
  type ForgeImportAccount,
  type ForgeRepoHint,
  type ForgeKind,
  type LinkedRepo,
} from "@locus/shared";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { loadLastAgent, resolveAgentDefaults, saveLastAgent } from "@/lib/lastAgent";
import { loadIdeRecents, rememberIdeRecent, folderName } from "@/lib/ideRecents";
import { openSettings, useStore } from "@/state/store";
import { HostFolderPicker } from "./HostFolderField";
import { IconClone, IconFolder } from "@/components/layout/Icons";
import { ImportAccounts } from "@/components/settings/ImportAccounts";
import { EmptyHero } from "@/components/layout/EmptyHero";
import { runFeatureActionFromDispatch } from "@/components/layout/FeatureHint";
import { SECTION_FEATURE_HINTS } from "@/lib/discoverability";

const FORGE_ORDER: ForgeKind[] = [
  "github",
  "gitlab",
  "bitbucket",
  "gitea",
  "forgejo",
  "azuredevops",
];

function groupRepos(repos: LinkedRepo[]): Array<{ forge: ForgeKind; repos: LinkedRepo[] }> {
  const buckets = new Map<ForgeKind, LinkedRepo[]>();
  for (const row of repos) {
    const list = buckets.get(row.checkout.forge) ?? [];
    list.push(row);
    buckets.set(row.checkout.forge, list);
  }
  return FORGE_ORDER.filter((forge) => buckets.has(forge)).map((forge) => ({
    forge,
    repos: buckets.get(forge)!,
  }));
}

export function IdeEmpty() {
  const { state, dispatch } = useStore();
  const prefs = loadLastAgent();
  const [mode, setMode] = useState<"home" | "clone">("home");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cloneDest, setCloneDest] = useState("");
  const [destPickerOpen, setDestPickerOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [accounts, setAccounts] = useState<ForgeImportAccount[] | null>(null);
  const tokened = forgesWithTokens(state.config?.forges ?? []);
  const grouped = groupRepos(state.repos);
  const recents = loadIdeRecents();

  // The sidebar "New workspace" menu asks for one of these two choices.
  useEffect(() => {
    if (!state.ideStart) return;
    if (state.ideStart === "open") {
      setMode("home");
      setPickerOpen(true);
    } else {
      setMode("clone");
    }
    dispatch({ type: "ideStart", intent: null });
  }, [state.ideStart, dispatch]);

  useEffect(() => {
    if (mode !== "clone") {
      setAccounts(null);
    }
  }, [mode]);

  async function createWorkspace(input: {
    title: string;
    hostDir?: string;
    repoId?: string;
    repoUrl?: string;
    repoForge?: LinkedRepo["checkout"]["forge"];
    repoRef?: string;
  }) {
    if (!state.config) {
      setError("Control plane is still loading");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const defaults = resolveAgentDefaults(state.config, "ubuntu", loadLastAgent());
      const session = await api.createSession({
        title: input.title,
        os: "ubuntu",
        templateId:
          defaults.templateId ||
          state.config.templates.find((row) => row.os === "ubuntu")?.id ||
          "host",
        kind: "ide",
        runtime: "host",
        providerId: defaults.providerId,
        model: defaults.model,
        startVm: false,
        vision: "off",
        hostDir: input.hostDir,
        ...(input.repoId ? { repoId: input.repoId } : {}),
        ...(input.repoUrl && input.repoForge
          ? { repo: { forge: input.repoForge, url: input.repoUrl, ref: input.repoRef } }
          : {}),
      });
      saveLastAgent({
        os: "ubuntu",
        runtime: "host",
        hostDir: input.hostDir || prefs.hostDir,
        providerId: defaults.providerId,
        model: defaults.model,
      });
      dispatch({ type: "session", session });
      dispatch({ type: "select", id: session.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open workspace");
    } finally {
      setBusy(false);
    }
  }

  async function openFolder(dir: string) {
    setPickerOpen(false);
    rememberIdeRecent(dir);
    await createWorkspace({ title: folderName(dir), hostDir: dir });
  }

  async function cloneLinked(repo: LinkedRepo) {
    await createWorkspace({
      title: shortRepoName(repo.checkout.url, repo.name),
      hostDir: cloneDest.trim() || undefined,
      repoId: repo.id,
    });
  }

  async function cloneUrlSubmit() {
    const parsed = parseRepoUrl(cloneUrl);
    if (!parsed) {
      setError("Enter a GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps URL");
      return;
    }
    await createWorkspace({
      title: shortRepoName(parsed.url),
      hostDir: cloneDest.trim() || undefined,
      repoUrl: parsed.url,
      repoForge: parsed.forge,
    });
  }

  async function importFromGit() {
    setError(null);
    setImporting(true);
    try {
      const next = await api.importRepos();
      setAccounts(next.accounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function linkPicked(hints: ForgeRepoHint[]) {
    if (!hints.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const hint of hints) {
        const created = await api.linkRepo({ url: hint.url, accountId: hint.accountId });
        dispatch({ type: "repo", repo: created });
      }
      setAccounts(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link repos");
    } finally {
      setBusy(false);
    }
  }

  const message = error ? formatRemoteError(error) : null;
  const codebaseHint = SECTION_FEATURE_HINTS.ide;
  const auth = message ? isForgeAuthError(message) : false;

  return (
    <div className="empty ide-start" data-testid="ide-start">
      <div className="empty-card">
        <EmptyHero
          followCursor
          title="Open a project to edit"
          lead="Edit files, run a terminal and commit, with an agent beside you."
        />
        <div className="ide-start-tiles" role="group" aria-label="Start a workspace">
          <button
            type="button"
            className="ide-start-tile"
            disabled={busy}
            onClick={() => {
              setMode("home");
              setPickerOpen(true);
            }}
          >
            <span className="ide-start-tile-icon" aria-hidden>
              <IconFolder />
            </span>
            <span className="ide-start-tile-label">Open folder</span>
            <span className="ide-start-tile-desc">A folder on this machine</span>
          </button>
          <button
            type="button"
            className="ide-start-tile"
            disabled={busy}
            aria-pressed={mode === "clone"}
            onClick={() => setMode((current) => (current === "clone" ? "home" : "clone"))}
          >
            <span className="ide-start-tile-icon" aria-hidden>
              <IconClone />
            </span>
            <span className="ide-start-tile-label">Clone repo</span>
            <span className="ide-start-tile-desc">From GitHub, GitLab or a URL</span>
          </button>
        </div>
        {recents.length ? (
          <div className="ide-recents" data-testid="ide-recents">
            <p className="ide-clone-label">Recent folders</p>
            <div className="ide-recents-list">
              {recents.map((row) => (
                <button
                  key={row.path}
                  type="button"
                  className="ide-clone-repo"
                  disabled={busy}
                  onClick={() => void openFolder(row.path)}
                >
                  <span>
                    <span className="title-text">{row.title}</span>
                    <span className="meta">{row.path}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {mode === "clone" ? (
          <div className="ide-clone-panel" data-testid="ide-clone-panel">
            <p className="ide-clone-label">From your integrations</p>
            {grouped.length ? (
              grouped.map((group) => (
                <div key={group.forge} className="ide-clone-group">
                  <p className="repo-group-label">{forgeLabel(group.forge)}</p>
                  {group.repos.map((repo) => (
                    <button
                      key={repo.id}
                      type="button"
                      className="ide-clone-repo"
                      disabled={busy}
                      onClick={() => void cloneLinked(repo)}
                    >
                      <span className={`forge-glyph ${repo.checkout.forge}`} aria-hidden>
                        {forgeShort(repo.checkout.forge)}
                      </span>
                      <span>
                        <span className="title-text">
                          {shortRepoName(repo.checkout.url, repo.name)}
                        </span>
                        <span className="meta">
                          {repo.name}
                          {repo.checkout.ref ? ` · ${repo.checkout.ref}` : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <p className="hint">No linked repositories yet. Import from Git or paste a URL.</p>
            )}
            <div className="field">
              <label>Repository URL</label>
              <input
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                placeholder="https://github.com/acme/app"
                aria-label="Repository URL"
              />
            </div>
            <div className="field">
              <label>Clone into</label>
              <div className="host-folder-row">
                <input
                  value={cloneDest}
                  onChange={(e) => setCloneDest(e.target.value)}
                  placeholder="Private folder for this workspace"
                  spellCheck={false}
                  aria-label="Clone destination"
                />
                <button type="button" className="btn ghost" onClick={() => setDestPickerOpen(true)}>
                  Browse
                </button>
              </div>
            </div>
            <div className="row-actions">
              <button
                type="button"
                className="btn primary"
                disabled={busy || !cloneUrl.trim()}
                onClick={() => void cloneUrlSubmit()}
              >
                {busy ? "Opening…" : "Clone"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={importing}
                onClick={() => void importFromGit()}
              >
                {importing ? "Importing…" : "Import from Git"}
              </button>
              {!tokened.length ? (
                <button type="button" className="btn" onClick={() => openSettings(dispatch, "git")}>
                  Add a GitHub token
                </button>
              ) : null}
            </div>
            {importing || accounts ? (
              <ImportAccounts
                accounts={accounts ?? []}
                loading={importing && !accounts}
                busy={busy}
                linkedUrls={state.repos.map((row) => row.checkout.url)}
                onLink={(hints) => void linkPicked(hints)}
                onDismiss={() => setAccounts(null)}
                onOpenGitSettings={() => openSettings(dispatch, "git")}
              />
            ) : null}
          </div>
        ) : null}
        {codebaseHint ? (
          <p className="ide-start-crosslink" data-testid={`feature-hint-${codebaseHint.id}`}>
            Reviewing pull requests?{" "}
            <button
              type="button"
              className="linkish"
              onClick={() => runFeatureActionFromDispatch(dispatch, codebaseHint.action)}
            >
              {codebaseHint.actionLabel}
            </button>
          </p>
        ) : null}
        {message ? (
          <div className="error-row" role="alert">
            <span className="error-dot" aria-hidden="true" />
            <p>{message}</p>
            {auth ? (
              <button
                type="button"
                className="btn small"
                onClick={() => openSettings(dispatch, "git")}
              >
                Open Git settings
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <HostFolderPicker
        open={pickerOpen}
        title="Open folder"
        confirmLabel="Open folder"
        lead="Open a folder on this machine as an IDE workspace."
        onClose={() => setPickerOpen(false)}
        onPick={(dir) => void openFolder(dir)}
      />
      <HostFolderPicker
        open={destPickerOpen}
        initialPath={cloneDest}
        title="Clone into"
        confirmLabel="Select folder"
        lead="Choose the parent folder for this clone."
        onClose={() => setDestPickerOpen(false)}
        onPick={setCloneDest}
      />
    </div>
  );
}
