import { useEffect, useRef, useState } from "react";
import {
  BUILTIN_SLASH_NAMES,
  FORGE_KINDS,
  GUEST_OS_OPTIONS,
  INTEGRATION_KINDS,
  defaultForgeApiUrl,
  defaultIntegrationUrl,
  forgeLabel,
  forgeOauthCallbackUrl,
  formatForgeUsedAt,
  latestForgeRepoActivity,
  formatPhoneToken,
  formatChromeExtensionToken,
  preferredPairingLink,
  generateGuestPassword,
  integrationLabel,
  integrationBlurb,
  isCursorCliProvider,
  parseAutonomyTier,
  providerAllowedByPolicy,
  validateSkill,
  agentRoundLimit,
  approvalTimeoutMs,
  automationChatLimit,
  guestBootTimeoutMs,
  promptQueueLimit,
  UBUNTU_DEFAULT_HARDWARE,
  defaultNetworking,
  parseProductMode,
  type AgentSkill,
  type AiProvider,
  type GoldenImage,
  type GuestOs,
  type IntegrationAccount,
  type IntegrationPlugin,
  type LocusConfig,
  type McpServerConfig,
  type ThemeId,
  type VmTemplate,
  type WorkerBackend,
} from "@locus/shared";
import { api, type HypervisorStatus } from "@/lib/api";
import {
  APP_DEVELOPER,
  APP_LICENSE,
  APP_LICENSE_TEXT,
  APP_NAME,
  APP_RELEASES_URL,
  APP_VERSION,
} from "@/lib/appInfo";
import { applyChatDensity, applyTheme } from "@/lib/theme";
import {
  DEFAULT_SWARM_SETTINGS_TAB,
  isSwarmSettingsTab,
  settingsNavLabel,
  settingsSearchHits,
  type SettingsSearchHit,
} from "@/lib/settingsNav";
import { setSettingsDirty, setSettingsPersist } from "@/lib/settingsLeave";
import { applyProductModeSideEffects, beginProductModeTransition } from "@/lib/productMode";
import { Select } from "@/components/layout/Select";
import { AUTONOMY_SELECT_OPTIONS } from "@/lib/formOptions";
import { blankSkill, configForSave } from "@/lib/configPersist";
import { useStore } from "@/state/store";
import { PairingQr } from "./PairingQr";
import {
  ForgeAccountCard,
  HostStatusBar,
  MachineInventory,
  QemuInstallStatus,
  IntegrationCard,
  IntegrationPluginCard,
  MachineCard,
  McpServerCard,
  NamedEnvironmentCard,
  ProviderCard,
  SettingsEmpty,
  SkillCard,
  WorkerCard,
  isBuiltinProvider,
  isBuiltinTemplate,
} from "./SettingsCards";
import { PolicyBanner, policyControlLocked } from "./PolicyBanner";
import { AppearanceSettings } from "./AppearanceSettings";
import { NotificationSettings } from "./NotificationSettings";
import { SearchField } from "@/components/layout/SearchField";
import { BusyButton } from "@/components/layout/Skeleton";
import { EmptyHint } from "@/components/layout/EmptyHero";
import { askConfirm } from "@/lib/dialog";
import { showUndoNotice } from "@/lib/notice";
import { HighlightQuery } from "@/lib/queryMark";
import { takePendingSettingsQuery } from "@/lib/settingsQuery";
import {
  appendConfigList,
  insertConfigList,
  patchConfigList,
  removeConfigList,
  type ConfigListKey,
  type ConfigListRow,
} from "@/lib/configDraft";

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export const SETTINGS_AUTOSAVE_MS = 400;

export function Settings() {
  const { state, dispatch } = useStore();
  const productMode = parseProductMode(state.config?.productMode);
  const tab =
    productMode === "swarm" && !isSwarmSettingsTab(state.settingsTab)
      ? DEFAULT_SWARM_SETTINGS_TAB
      : state.settingsTab;
  const [draft, setDraft] = useState<LocusConfig | null>(state.config);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const [hypervisor, setHypervisor] = useState<HypervisorStatus | null>(null);
  const [images, setImages] = useState<GoldenImage[]>([]);
  const [fetchingOs, setFetchingOs] = useState<GuestOs | null>(null);
  const [fetchingVirtio, setFetchingVirtio] = useState(false);
  const [probe, setProbe] = useState<Record<string, string>>({});
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [installingQemu, setInstallingQemu] = useState(false);
  const [machineBusy, setMachineBusy] = useState<string | null>(null);
  const [tailscale, setTailscale] = useState<{
    installed: boolean;
    running: boolean;
    loggedIn: boolean;
    funnelEnabled: boolean;
    funnelUrl?: string;
    error?: string;
  } | null>(null);
  const [funnelBusy, setFunnelBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [expandedForge, setExpandedForge] = useState<string | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [expandedMachine, setExpandedMachine] = useState<string | null>(null);
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null);
  const [expandedMcp, setExpandedMcp] = useState<string | null>(null);
  const [expandedEnv, setExpandedEnv] = useState<string | null>(null);
  const [expandedIntegration, setExpandedIntegration] = useState<string | null>(null);
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [hostPathsOpen, setHostPathsOpen] = useState(false);
  const [oauth, setOauth] = useState<{
    accountId: string;
    kind?: "forge" | "slack" | "google";
    method: "device" | "redirect";
    userCode?: string;
    verificationUri?: string;
    verificationUriComplete?: string;
    authorizeUrl?: string;
    error?: string;
  } | null>(null);
  const [oauthBusy, setOauthBusy] = useState<string | null>(null);
  const [workerProbe, setWorkerProbe] = useState<Record<string, string>>({});
  const [busyWorker, setBusyWorker] = useState<string | null>(null);
  const [workerBlob, setWorkerBlob] = useState("");
  const [workerAddBusy, setWorkerAddBusy] = useState(false);
  const [workerAddHint, setWorkerAddHint] = useState<string | null>(null);
  const [phone, setPhone] = useState<{
    enabled: boolean;
    token?: string;
    listenHost: string;
    port: number;
    urls: Array<{ address: string; http: string; app: string }>;
    fingerprint?: string;
    restartHint?: string;
  } | null>(null);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [chromeExt, setChromeExt] = useState<{
    enabled: boolean;
    token?: string;
    formattedToken?: string;
    installDir: string;
    connected: boolean;
    tabs: Array<{ targetId: string; url: string; title?: string; active?: boolean }>;
  } | null>(null);
  const [chromeBusy, setChromeBusy] = useState(false);
  const [update, setUpdate] = useState<{
    status: "available" | "up-to-date" | "unavailable";
    current: string;
    latest?: string;
    name?: string;
    notes?: string;
    htmlUrl?: string;
    asset?: { name: string; url: string };
    message?: string;
  } | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [find, setFind] = useState("");
  useEffect(() => {
    const pending = takePendingSettingsQuery();
    if (pending) setFind(pending);
  }, []);
  const pairingLink =
    phone?.enabled && phone.urls.length ? preferredPairingLink(phone.urls) : undefined;
  const draftRef = useRef(draft);
  const phoneRef = useRef(phone);
  const chromeExtRef = useRef(chromeExt);
  const configRef = useRef(state.config);
  const persistInFlight = useRef<Promise<boolean> | null>(null);
  const persistRef = useRef<() => Promise<boolean>>(async () => true);
  const autosaveTimerRef = useRef(0);
  draftRef.current = draft;
  phoneRef.current = phone;
  chromeExtRef.current = chromeExt;
  configRef.current = state.config;

  useEffect(() => {
    if (productMode !== "swarm") return;
    if (isSwarmSettingsTab(state.settingsTab)) return;
    dispatch({ type: "settingsTab", tab: DEFAULT_SWARM_SETTINGS_TAB });
  }, [productMode, state.settingsTab, dispatch]);

  useEffect(() => {
    if (state.section === "settings" && state.config) {
      setDraft((current) => current ?? state.config);
      setExpandedProvider((current) => current ?? state.config?.providers[0]?.id ?? null);
      setExpandedForge((current) => current ?? state.config?.forges[0]?.id ?? null);
      setExpandedSkill((current) => current ?? state.config?.skills?.[0]?.id ?? null);
      setExpandedMachine((current) => current ?? state.config?.templates[0]?.id ?? null);
      setExpandedWorker((current) => current ?? state.config?.workers?.[0]?.id ?? null);
      setExpandedMcp((current) => current ?? state.config?.mcpServers?.[0]?.id ?? null);
      setExpandedEnv((current) => current ?? state.config?.namedEnvironments?.[0]?.id ?? null);
      setExpandedIntegration((current) => current ?? state.config?.integrations?.[0]?.id ?? null);
      setExpandedPlugin((current) => current ?? state.config?.integrationPlugins?.[0]?.id ?? null);
    }
  }, [state.section, state.config]);

  useEffect(() => {
    if (state.section !== "settings") return;
    applyTheme(draft?.theme);
    applyChatDensity(draft?.chatDensity);
  }, [state.section, draft?.theme, draft?.chatDensity]);

  useEffect(() => {
    if (state.section !== "settings") return;
    void api
      .hypervisor()
      .then(setHypervisor)
      .catch(() => setHypervisor(null));
    void api
      .images()
      .then(setImages)
      .catch(() => setImages([]));
    void api
      .tailscale()
      .then(setTailscale)
      .catch(() => setTailscale(null));
    void api
      .phone()
      .then(setPhone)
      .catch(() => setPhone(null));
    void api
      .chromeExtension()
      .then(setChromeExt)
      .catch(() => setChromeExt(null));
  }, [state.section]);

  useEffect(() => {
    if (state.section !== "settings" || tab !== "about") return;
    let cancelled = false;
    setUpdateBusy(true);
    void api
      .checkUpdates(APP_VERSION)
      .then((result) => {
        if (!cancelled) setUpdate(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setUpdate({
            status: "unavailable",
            current: APP_VERSION,
            message: err instanceof Error ? err.message : "Could not check for updates",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setUpdateBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state.section, tab]);

  useEffect(() => {
    if (!oauth || oauth.error) return;
    let cancelled = false;
    const accountId = oauth.accountId;
    const kind = oauth.kind;
    async function tick() {
      try {
        const status =
          kind === "slack"
            ? await api.slackOauthStatus(accountId)
            : kind === "google"
              ? await api.googleOauthStatus(accountId)
              : await api.forgeOauthStatus(accountId);
        if (cancelled) return;
        if (status.status === "complete") {
          const saved = await api.config();
          setDraft((current) => {
            if (!current) return current;
            if (kind === "slack" || kind === "google") {
              return {
                ...current,
                integrations: (current.integrations ?? []).map((row) =>
                  row.id === accountId
                    ? (saved.integrations?.find((item) => item.id === row.id) ?? row)
                    : row,
                ),
              };
            }
            return {
              ...current,
              forges: current.forges.map((row) =>
                row.id === accountId
                  ? (saved.forges.find((item) => item.id === row.id) ?? row)
                  : row,
              ),
            };
          });
          setOauth(null);
          return;
        }
        if (status.status === "error" || status.status === "expired") {
          setOauth((current) =>
            current && current.accountId === accountId
              ? { ...current, error: status.error || status.status }
              : current,
          );
        }
      } catch (err) {
        if (!cancelled) {
          setOauth((current) =>
            current && current.accountId === accountId
              ? { ...current, error: err instanceof Error ? err.message : "SSO failed" }
              : current,
          );
        }
      }
    }
    const timer = window.setInterval(() => void tick(), 2000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [oauth?.accountId, oauth?.error, oauth?.kind]);

  const payload = draft ? configForSave(draft) : null;
  const dirty =
    Boolean(payload && state.config) && JSON.stringify(payload) !== JSON.stringify(state.config);
  const draftDirty =
    Boolean(draft && state.config) && JSON.stringify(draft) !== JSON.stringify(state.config);

  async function persistOnce(): Promise<boolean> {
    const current = draftRef.current;
    if (!current) return true;
    const next = configForSave(current);
    const savedConfig = configRef.current;
    if (savedConfig && JSON.stringify(next) === JSON.stringify(savedConfig)) {
      setSaveStatus("saved");
      return true;
    }
    const skills = next.skills ?? [];
    for (const skill of skills) {
      const skillError = validateSkill(skill, skills, BUILTIN_SLASH_NAMES);
      if (skillError) {
        setError(skillError);
        setSaveStatus("error");
        return false;
      }
    }
    setSaving(true);
    setSaveStatus("saving");
    setError(null);
    const prevMode = parseProductMode(savedConfig?.productMode);
    const nextMode = parseProductMode(next.productMode);
    const finishModeTransition = beginProductModeTransition(nextMode, prevMode, dispatch);
    try {
      const livePhone = phoneRef.current;
      const savedEnabled = Boolean(savedConfig?.phoneRemote?.enabled);
      const nextEnabled = Boolean(next.phoneRemote?.enabled);
      if (livePhone && nextEnabled !== savedEnabled) {
        await api.setPhone(livePhone.enabled);
      }
      const liveChromeExt = chromeExtRef.current;
      const savedChrome = Boolean(savedConfig?.chromeExtension?.enabled);
      const nextChrome = Boolean(next.chromeExtension?.enabled);
      if (liveChromeExt && nextChrome !== savedChrome) {
        await api.setChromeExtension(liveChromeExt.enabled);
      }
      const snapshot = current;
      const saved = await api.saveConfig(next);
      dispatch({ type: "config", config: saved });
      applyProductModeSideEffects(nextMode, prevMode, dispatch, {
        vmCollapsed: state.vmCollapsed,
        sidebarCollapsed: state.collapsed,
      });
      if (JSON.stringify(draftRef.current) === JSON.stringify(snapshot)) {
        const blanks = (snapshot.skills ?? []).filter(blankSkill);
        setDraft(
          blanks.length ? { ...saved, skills: [...(saved.skills ?? []), ...blanks] } : saved,
        );
      }
      const setup = await Promise.resolve(api.setup()).catch(() => null);
      if (setup) dispatch({ type: "setup", setup });
      setSaveStatus("saved");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaveStatus("error");
      return false;
    } finally {
      await finishModeTransition?.();
      setSaving(false);
    }
  }

  async function persistDraft(): Promise<boolean> {
    while (persistInFlight.current) await persistInFlight.current;
    const run = persistOnce();
    persistInFlight.current = run;
    try {
      return await run;
    } finally {
      if (persistInFlight.current === run) persistInFlight.current = null;
    }
  }
  persistRef.current = persistDraft;

  useEffect(() => {
    setSettingsPersist(() => persistRef.current());
    return () => setSettingsPersist(null);
  }, []);

  useEffect(() => {
    setSettingsDirty(draftDirty);
    return () => setSettingsDirty(false);
  }, [draftDirty]);

  useEffect(() => {
    if (!dirty) return;
    setSaveStatus("saving");
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      void persistRef.current();
    }, SETTINGS_AUTOSAVE_MS);
    return () => window.clearTimeout(autosaveTimerRef.current);
  }, [dirty, draft]);

  async function closeSettings() {
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = 0;
    const ok = await persistRef.current();
    if (!ok) {
      const current = draftRef.current;
      const skills = current ? (configForSave(current).skills ?? []) : [];
      if (skills.some((skill) => validateSkill(skill, skills, BUILTIN_SLASH_NAMES))) {
        dispatch({ type: "settingsTab", tab: "skills" });
      }
      return;
    }
    dispatch({ type: "settings", open: false });
  }

  if (state.section !== "settings" || !draft) return null;
  const current = draft;
  const oauthCallback = forgeOauthCallbackUrl(current.advanced.bindPort);

  async function startOauth(account: (typeof current.forges)[number]) {
    setError(null);
    setOauthBusy(account.id);
    try {
      const started = await api.startForgeOauth(account.id, {
        kind: account.kind,
        name: account.name,
        apiBaseUrl: account.apiBaseUrl,
        oauthClientId: account.oauthClientId,
        oauthClientSecret: account.oauthClientSecret,
      });
      const url =
        started.verificationUriComplete || started.verificationUri || started.authorizeUrl;
      if (url) openExternal(url);
      setOauth({
        accountId: account.id,
        method: started.method,
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        verificationUriComplete: started.verificationUriComplete,
        authorizeUrl: started.authorizeUrl,
      });
    } catch (err) {
      setOauth({
        accountId: account.id,
        method: account.kind === "github" ? "device" : "redirect",
        error: err instanceof Error ? err.message : "SSO start failed",
      });
    } finally {
      setOauthBusy(null);
    }
  }

  async function cancelOauth(accountId: string) {
    await api.cancelForgeOauth(accountId).catch(() => undefined);
    setOauth(null);
  }

  async function startSlackOauth(account: IntegrationAccount) {
    setError(null);
    setOauthBusy(account.id);
    try {
      const started = await api.startSlackOauth({
        accountId: account.id,
        oauthClientId: account.oauthClientId,
        oauthClientSecret: account.oauthClientSecret,
      });
      if (started.authorizeUrl) openExternal(started.authorizeUrl);
      setOauth({
        accountId: account.id,
        kind: "slack",
        method: "redirect",
        authorizeUrl: started.authorizeUrl,
      });
    } catch (err) {
      setOauth({
        accountId: account.id,
        kind: "slack",
        method: "redirect",
        error: err instanceof Error ? err.message : "Slack sign-in failed",
      });
    } finally {
      setOauthBusy(null);
    }
  }

  async function setPhoneEnabled(enabled: boolean) {
    setPhoneBusy(true);
    setError(null);
    try {
      const next = await api.setPhone(enabled);
      setPhone(next);
      setDraft((currentDraft) =>
        currentDraft
          ? {
              ...currentDraft,
              phoneRemote: {
                enabled: next.enabled,
                token: currentDraft.phoneRemote?.token,
              },
            }
          : currentDraft,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update phone remote");
    } finally {
      setPhoneBusy(false);
    }
  }

  async function setChromeEnabled(enabled: boolean) {
    setChromeBusy(true);
    setError(null);
    try {
      const next = await api.setChromeExtension(enabled);
      setChromeExt(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update Chrome extension");
    } finally {
      setChromeBusy(false);
    }
  }

  async function rotateChromeToken() {
    setChromeBusy(true);
    setError(null);
    try {
      setChromeExt(await api.rotateChromeExtension());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rotate Chrome pairing token");
    } finally {
      setChromeBusy(false);
    }
  }

  async function rotatePhoneToken() {
    setPhoneBusy(true);
    setError(null);
    try {
      setPhone(await api.rotatePhone());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rotate pairing token");
    } finally {
      setPhoneBusy(false);
    }
  }

  async function startGoogleOauth(account: IntegrationAccount) {
    setError(null);
    setOauthBusy(account.id);
    try {
      const started = await api.startGoogleOauth({
        accountId: account.id,
        oauthClientId: account.oauthClientId,
        oauthClientSecret: account.oauthClientSecret,
      });
      if (started.authorizeUrl) openExternal(started.authorizeUrl);
      setOauth({
        accountId: account.id,
        kind: "google",
        method: "redirect",
        authorizeUrl: started.authorizeUrl,
      });
    } catch (err) {
      setOauth({
        accountId: account.id,
        kind: "google",
        method: "redirect",
        error: err instanceof Error ? err.message : "Google sign-in failed",
      });
    } finally {
      setOauthBusy(null);
    }
  }

  async function disconnectGoogle(accountId: string) {
    setOauthBusy(accountId);
    try {
      const result = await api.disconnectGoogleOauth(accountId);
      setDraft((currentDraft) => {
        if (!currentDraft) return currentDraft;
        return {
          ...currentDraft,
          integrations: (currentDraft.integrations ?? []).map((row) =>
            row.id === accountId
              ? (result.config.integrations?.find((item) => item.id === row.id) ?? {
                  ...row,
                  token: undefined,
                  refreshToken: undefined,
                  tokenExpiresAt: undefined,
                  userId: undefined,
                  userName: undefined,
                  authMethod: undefined,
                })
              : row,
          ),
        };
      });
      setOauth(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setOauthBusy(null);
    }
  }

  async function disconnectSlack(accountId: string) {
    setOauthBusy(accountId);
    try {
      const result = await api.disconnectSlackOauth(accountId);
      setDraft((currentDraft) => {
        if (!currentDraft) return currentDraft;
        return {
          ...currentDraft,
          integrations: (currentDraft.integrations ?? []).map((row) =>
            row.id === accountId
              ? (result.config.integrations?.find((item) => item.id === row.id) ?? {
                  ...row,
                  userToken: undefined,
                  userId: undefined,
                  userName: undefined,
                  teamId: undefined,
                  teamName: undefined,
                  authMethod: undefined,
                })
              : row,
          ),
        };
      });
      setOauth(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setOauthBusy(null);
    }
  }

  async function disconnectOauth(accountId: string) {
    setOauthBusy(accountId);
    try {
      const result = await api.disconnectForgeOauth(accountId);
      setDraft((currentDraft) => {
        if (!currentDraft) return currentDraft;
        return {
          ...currentDraft,
          forges: currentDraft.forges.map((row) =>
            row.id === accountId
              ? (result.config.forges.find((item) => item.id === row.id) ?? row)
              : row,
          ),
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setOauthBusy(null);
    }
  }

  function patchList<K extends ConfigListKey>(
    key: K,
    index: number,
    patch: Partial<ConfigListRow<K>> | ((row: ConfigListRow<K>) => ConfigListRow<K>),
  ) {
    setDraft((current) => (current ? patchConfigList(current, key, index, patch) : current));
  }

  function removeListUndoable<K extends ConfigListKey>(key: K, index: number, label: string) {
    setDraft((current) => {
      if (!current) return current;
      const rows = [...((current[key] as ConfigListRow<K>[] | undefined) ?? [])];
      const removed = rows[index];
      if (!removed) return current;
      showUndoNotice(`Removed ${label}`, () => {
        setDraft((draft) => (draft ? insertConfigList(draft, key, index, removed) : draft));
      });
      return removeConfigList(current, key, index);
    });
  }

  function appendList<K extends ConfigListKey>(key: K, row: ConfigListRow<K>) {
    setDraft((current) => (current ? appendConfigList(current, key, row) : current));
  }

  async function resetAll() {
    const dir = state.config?.advanced.dataDir ?? current.advanced.dataDir;
    if (
      !(await askConfirm({
        title: "Delete all Locus data?",
        body: `Delete all Locus data in ${dir}? Sessions, secrets, disks, golden images, media, and automations will be gone. QEMU and Docker on this host stay.`,
        confirmLabel: "Continue",
        danger: true,
      }))
    ) {
      return;
    }
    if (
      !(await askConfirm({
        title: "Reset all data?",
        body: "This cannot be undone.",
        confirmLabel: "Reset",
        danger: true,
      }))
    )
      return;
    setError(null);
    setResetting(true);
    try {
      const snapshot = await api.resetAll();
      dispatch({
        type: "reset",
        config: snapshot.config,
        vms: snapshot.vms,
        hypervisorKind: snapshot.hypervisor,
        dockerKind: snapshot.docker,
        setup: snapshot.setup,
      });
      applyTheme(snapshot.config.theme);
      applyChatDensity(snapshot.config.chatDensity);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }

  async function fetchImage(os: GuestOs, index: number) {
    setFetchingOs(os);
    setError(null);
    try {
      const downloaded = await api.fetchCloudImage(os);
      const templates = [...current.templates];
      const template = templates[index];
      if (template) templates[index] = { ...template, isoPath: downloaded.path };
      setDraft({ ...current, templates });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setFetchingOs(null);
    }
  }

  async function fetchVirtio(index: number) {
    setFetchingVirtio(true);
    setError(null);
    try {
      const downloaded = await api.fetchVirtioIso();
      const templates = [...current.templates];
      const template = templates[index];
      if (template) templates[index] = { ...template, virtioIsoPath: downloaded.path };
      setDraft({ ...current, templates });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setFetchingVirtio(false);
    }
  }

  async function removeImage(id: string) {
    try {
      await api.deleteImage(id);
      setImages((rows) => rows.filter((img) => img.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete image");
    }
  }

  function patchProvider(index: number, patch: Partial<AiProvider>) {
    const providers = [...current.providers];
    const row = providers[index];
    if (!row) return;
    providers[index] = { ...row, ...patch };
    setDraft({ ...current, providers });
  }

  function addProvider() {
    const next: AiProvider = {
      id: crypto.randomUUID(),
      name: "Custom",
      kind: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      models: [],
      defaultModel: "",
      enabled: false,
      extraHeaders: {},
    };
    setDraft({ ...current, providers: [...current.providers, next] });
    setExpandedProvider(next.id);
  }

  function addSkill() {
    const next: AgentSkill = {
      id: crypto.randomUUID(),
      name: "",
      title: "",
      hint: "",
      body: "",
      enabled: true,
    };
    appendList("skills", next);
    setExpandedSkill(next.id);
  }

  function addMachine() {
    const now = new Date().toISOString();
    const source = current.templates.find((row) => row.os === "ubuntu") ?? current.templates[0];
    const next: VmTemplate = source
      ? {
          ...structuredClone(source),
          id: crypto.randomUUID(),
          name: "Custom machine",
          isoPath: "",
          virtioIsoPath: undefined,
          createdAt: now,
          updatedAt: now,
        }
      : {
          id: crypto.randomUUID(),
          name: "Custom machine",
          os: "ubuntu",
          description: "Custom guest",
          isoPath: "",
          hardware: { ...UBUNTU_DEFAULT_HARDWARE },
          networking: defaultNetworking("ubuntu", current.templates.length),
          createdAt: now,
          updatedAt: now,
        };
    if (next.cloudInit) {
      next.cloudInit = { ...next.cloudInit, password: generateGuestPassword() };
    }
    if (next.unattend) {
      next.unattend = { ...next.unattend, password: generateGuestPassword() };
    }
    setDraft({ ...current, templates: [...current.templates, next] });
    setExpandedMachine(next.id);
  }

  function addMcpServer() {
    const next: McpServerConfig = {
      id: crypto.randomUUID(),
      name: "MCP server",
      enabled: false,
      command: "",
      args: [],
      env: {},
      runtime: policyControlLocked(draft, "hostMcp") ? "guest" : "host",
    };
    appendList("mcpServers", next);
    setExpandedMcp(next.id);
  }

  function addWorker() {
    const next: WorkerBackend = {
      id: crypto.randomUUID(),
      name: `Worker ${(draft?.workers ?? []).length + 1}`,
      url: "https://192.168.1.10:7421",
      token: "",
    };
    setDraft((current) =>
      current ? { ...current, workers: [...(current.workers ?? []), next] } : current,
    );
    setExpandedWorker(next.id);
  }

  async function refreshModels(index: number) {
    const p = current.providers[index];
    if (!p) return;
    setBusyProvider(p.id);
    setProbe((m) => ({ ...m, [p.id]: "Fetching models…" }));
    try {
      let models: string[];
      if (isCursorCliProvider(p)) {
        const result = await api.refreshCursorCli();
        models = result.models;
        if (result.config) dispatch({ type: "config", config: result.config });
      } else {
        ({ models } = await api.providerModels(p.id, { apiKey: p.apiKey, baseUrl: p.baseUrl }));
      }
      const providers = [...current.providers];
      const next = providers[index];
      if (next) {
        providers[index] = {
          ...next,
          models: models.length ? models : next.models,
          defaultModel: models.includes(next.defaultModel)
            ? next.defaultModel
            : (models[0] ?? next.defaultModel),
        };
        setDraft({ ...current, providers });
      }
      setProbe((m) => ({
        ...m,
        [p.id]: models.length ? `${models.length} models` : "No models returned",
      }));
    } catch (err) {
      setProbe((m) => ({ ...m, [p.id]: err instanceof Error ? err.message : "Fetch failed" }));
    } finally {
      setBusyProvider(null);
    }
  }

  async function checkForUpdates() {
    setUpdateBusy(true);
    try {
      const result = await api.checkUpdates(APP_VERSION);
      setUpdate(result);
    } catch (err) {
      setUpdate({
        status: "unavailable",
        current: APP_VERSION,
        message: err instanceof Error ? err.message : "Could not check for updates",
      });
    } finally {
      setUpdateBusy(false);
    }
  }

  async function testConn(index: number) {
    const p = current.providers[index];
    if (!p) return;
    setBusyProvider(p.id);
    setProbe((m) => ({ ...m, [p.id]: "Testing…" }));
    try {
      const result = await api.testProvider(p.id, { apiKey: p.apiKey, baseUrl: p.baseUrl });
      setProbe((m) => ({ ...m, [p.id]: `Connected · ${result.models} models` }));
    } catch (err) {
      setProbe((m) => ({ ...m, [p.id]: err instanceof Error ? err.message : "Test failed" }));
    } finally {
      setBusyProvider(null);
    }
  }

  async function testWorker(row: WorkerBackend) {
    setBusyWorker(row.id);
    setWorkerProbe((current) => ({ ...current, [row.id]: "Testing…" }));
    try {
      const result = await api.testWorker({
        url: row.url,
        token: row.token,
        fingerprint: row.fingerprint,
      });
      setWorkerProbe((current) => ({
        ...current,
        [row.id]: result.fingerprint
          ? row.fingerprint
            ? `Connected · TLS pin matches · ${result.hostname ?? result.docker ?? "ok"}`
            : `Connected · observed TLS ${result.fingerprint}. Paste that into TLS fingerprint after matching the worker printout.`
          : `Connected · ${result.hostname ?? result.docker ?? "ok"}`,
      }));
    } catch (err) {
      setWorkerProbe((current) => ({
        ...current,
        [row.id]: err instanceof Error ? err.message : "Unreachable",
      }));
    } finally {
      setBusyWorker(null);
    }
  }

  async function addWorkerFromBlob() {
    const blob = workerBlob.trim();
    if (!blob || workerAddBusy) return;
    setWorkerAddBusy(true);
    setWorkerAddHint("Testing…");
    setError(null);
    try {
      const result = await api.addWorker({ blob });
      setDraft((current) =>
        current ? { ...current, workers: result.config.workers ?? [] } : current,
      );
      if (state.config) {
        dispatch({ type: "config", config: { ...state.config, workers: result.config.workers } });
      }
      setWorkerBlob("");
      setWorkerAddHint(
        result.worker
          ? `Added ${result.worker.name} · TLS pinned · ${result.worker.url}`
          : "Added worker",
      );
      if (result.worker) setExpandedWorker(result.worker.id);
    } catch (err) {
      setWorkerAddHint(err instanceof Error ? err.message : "Add failed");
    } finally {
      setWorkerAddBusy(false);
    }
  }

  async function machineAction(id: string, action: "start" | "stop") {
    setMachineBusy(id);
    setError(null);
    try {
      if (action === "start") {
        const vm = await api.startVm(id);
        dispatch({ type: "vm", vm });
      } else {
        await api.stopVm(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the machine");
    } finally {
      setMachineBusy(null);
    }
  }

  async function installQemu() {
    setInstallingQemu(true);
    setError(null);
    try {
      const result = await api.installHypervisor();
      dispatch({ type: "setup", setup: result.setup });
      const next = await api.hypervisor().catch(() => null);
      if (next) setHypervisor(next);
      if (result.restartRequired && result.qemuFound) {
        setError("QEMU is installed. Restart Locus to switch off the mock hypervisor.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not install QEMU");
    } finally {
      setInstallingQemu(false);
    }
  }

  function focusSettingsHit(hit: SettingsSearchHit) {
    dispatch({ type: "settingsTab", tab: hit.tab });
    setFind("");
    if (hit.tab === "providers" && hit.id) setExpandedProvider(hit.id);
    if (hit.tab === "mcp" && hit.id) setExpandedMcp(hit.id);
    if (hit.tab === "skills" && hit.id) setExpandedSkill(hit.id);
    if (hit.tab === "machines" && hit.id) setExpandedMachine(hit.id);
    if (hit.tab === "workers" && hit.id) setExpandedWorker(hit.id);
    if (hit.tab === "environments" && hit.id) setExpandedEnv(hit.id);
    if (hit.tab === "git" && hit.id) setExpandedForge(hit.id);
    if (hit.tab === "integrations" && hit.id) setExpandedIntegration(hit.id);
  }

  const findHits = settingsSearchHits(current, find, productMode);

  return (
    <div className="settings-page app-settings">
      <header className="settings-head">
        <h2>{settingsNavLabel(tab)}</h2>
        <div className="settings-find">
          <SearchField
            className="search"
            wrapClassName="settings-find-wrap"
            value={find}
            placeholder="Find a setting…"
            aria-label="Find a setting"
            onChange={(event) => setFind(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && findHits[0]) {
                event.preventDefault();
                focusSettingsHit(findHits[0]);
              }
              if (event.key === "Escape" && find) {
                event.preventDefault();
                setFind("");
              }
            }}
          />
          {find.trim() && findHits.length ? (
            <ul className="settings-find-hits" role="listbox" aria-label="Setting matches">
              {findHits.slice(0, 8).map((hit) => (
                <li key={`${hit.tab}:${hit.id ?? ""}`}>
                  <button type="button" onClick={() => focusSettingsHit(hit)}>
                    <HighlightQuery
                      text={`${settingsNavLabel(hit.tab)}${hit.id ? ` · ${hit.label}` : ""}`}
                      query={find}
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {tab === "skills" && (
          <button type="button" className="btn small add-skill" onClick={addSkill}>
            + New skill
          </button>
        )}
        {tab === "mcp" ? (
          <button type="button" className="btn small add-skill" onClick={addMcpServer}>
            + New MCP server
          </button>
        ) : null}
        {tab === "workers" ? (
          <button type="button" className="btn small add-provider" onClick={addWorker}>
            Add worker
          </button>
        ) : null}
        {tab === "machines" ? (
          <p className="settings-head-meta">
            {current.templates.filter((row) => row.isoPath.trim()).length} of{" "}
            {current.templates.length} ready
          </p>
        ) : null}
      </header>
      <PolicyBanner config={draft} />
      <section className={`settings-body${tab === "appearance" ? " appearance-body" : ""}`}>
        {tab === "providers" && (
          <>
            <div className="settings-pane-head">
              <p className="hint">
                {current.providers.filter((row) => row.enabled).length} of{" "}
                {current.providers.length} providers enabled
              </p>
              <button
                type="button"
                className="btn small add-provider"
                onClick={addProvider}
                disabled={policyControlLocked(draft, "providers")}
              >
                Add provider
              </button>
            </div>
            {draft.providers
              .map((p, i) => ({ p, i }))
              .sort((a, b) => Number(b.p.enabled) - Number(a.p.enabled))
              .map(({ p, i }) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  expanded={expandedProvider === p.id}
                  busy={busyProvider === p.id}
                  probe={probe[p.id]}
                  locked={
                    Boolean(draft.managedPolicy?.active) &&
                    !providerAllowedByPolicy(p, draft.managedPolicy?.policy)
                  }
                  onToggleExpand={() => setExpandedProvider((id) => (id === p.id ? null : p.id))}
                  onPatch={(patch) => patchProvider(i, patch)}
                  onRefresh={() => void refreshModels(i)}
                  onTest={() => void testConn(i)}
                  onRemove={
                    isBuiltinProvider(p)
                      ? undefined
                      : () => {
                          removeListUndoable("providers", i, p.name);
                          setExpandedProvider((id) => (id === p.id ? null : id));
                        }
                  }
                />
              ))}
          </>
        )}

        {tab === "appearance" && (
          <AppearanceSettings
            theme={draft.theme}
            savedTheme={state.config?.theme ?? draft.theme}
            productMode={draft.productMode}
            chatDensity={draft.chatDensity}
            editorFontSize={draft.editorFontSize ?? 12}
            formatOnSave={draft.formatOnSave !== false}
            showMinimap={draft.showMinimap !== false}
            onSelect={(id: ThemeId) => setDraft({ ...draft, theme: id })}
            onEditor={(patch) => setDraft({ ...draft, ...patch })}
          />
        )}

        {tab === "notifications" && (
          <NotificationSettings
            prefs={draft}
            onChange={(patch) => setDraft({ ...draft, ...patch })}
          />
        )}

        {tab === "machines" && (
          <MachineInventory
            vms={state.vms}
            sessions={state.sessions}
            busyId={machineBusy}
            onOpen={(id) => dispatch({ type: "select", id })}
            onStart={(id) => void machineAction(id, "start")}
            onStop={(id) => void machineAction(id, "stop")}
          />
        )}
        {tab === "machines" && (
          <div className="machine-board">
            {draft.templates.map((t, i) => (
              <MachineCard
                key={t.id}
                template={t}
                expanded={expandedMachine === t.id}
                fetchingOs={fetchingOs === t.os}
                fetchingVirtio={fetchingVirtio}
                onToggleExpand={() => setExpandedMachine((id) => (id === t.id ? null : t.id))}
                onPatch={(patch) => patchList("templates", i, patch)}
                onFetch={() => void fetchImage(t.os, i)}
                onFetchVirtio={() => void fetchVirtio(i)}
                onRemove={
                  isBuiltinTemplate(t.id)
                    ? undefined
                    : () => {
                        removeListUndoable("templates", i, t.name);
                        setExpandedMachine((id) => (id === t.id ? null : id));
                      }
                }
              />
            ))}
            <HostStatusBar
              hypervisor={hypervisor}
              pathsOpen={hostPathsOpen}
              onTogglePaths={() => setHostPathsOpen((open) => !open)}
              onAddMachine={addMachine}
            />
          </div>
        )}

        {tab === "machines" && (
          <>
            <h3 className="auto-runs-title" style={{ marginTop: 18 }}>
              Golden images
            </h3>
            <p className="scrim-note" style={{ marginTop: 0, marginBottom: 12 }}>
              Capture a running guest from the VM toolbar, or save a Docker workspace from the
              container pane. New agents default to the latest matching image.
            </p>
            {images.length === 0 ? (
              <EmptyHint title="No golden images yet." />
            ) : (
              images.map((img) => (
                <div
                  className="template-row"
                  key={img.id}
                  style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                >
                  <div>
                    <strong>{img.name}</strong>
                    <p className="hint" style={{ margin: "4px 0 0" }}>
                      {img.os} · {img.path}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => void removeImage(img.id)}
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
            <h3 className="auto-runs-title" style={{ marginTop: 18 }}>
              Repo hardware
            </h3>
            <p className="scrim-note" style={{ marginTop: 0, marginBottom: 12 }}>
              Match a GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps URL (or a substring
              like org/repo) to give that project a different CPU, RAM, or disk than the guest
              default. Agent and automation forms still let you override per run.
            </p>
            {(draft.hardwareProfiles ?? []).map((profile, i) => (
              <div className="template-row" key={profile.id}>
                <div className="grid-2">
                  <div className="field">
                    <label>Name</label>
                    <input
                      value={profile.name}
                      onChange={(e) => {
                        patchList("hardwareProfiles", i, { name: e.target.value });
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Repo pattern</label>
                    <input
                      value={profile.repoPattern}
                      placeholder="acme/app or github.com/acme/app"
                      onChange={(e) => {
                        patchList("hardwareProfiles", i, { repoPattern: e.target.value });
                      }}
                    />
                  </div>
                </div>
                <div className="grid-3">
                  <div className="field">
                    <label>CPU cores</label>
                    <input
                      type="number"
                      min={1}
                      value={profile.hardware.cpuCores ?? ""}
                      placeholder="default"
                      onChange={(e) => {
                        const cpuCores = e.target.value === "" ? undefined : Number(e.target.value);
                        patchList("hardwareProfiles", i, (profile) => ({
                          ...profile,
                          hardware: { ...profile.hardware, cpuCores },
                        }));
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Memory (MB)</label>
                    <input
                      type="number"
                      min={512}
                      value={profile.hardware.memoryMb ?? ""}
                      placeholder="default"
                      onChange={(e) => {
                        const memoryMb = e.target.value === "" ? undefined : Number(e.target.value);
                        patchList("hardwareProfiles", i, (profile) => ({
                          ...profile,
                          hardware: { ...profile.hardware, memoryMb },
                        }));
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Disk (GB)</label>
                    <input
                      type="number"
                      min={8}
                      value={profile.hardware.diskSizeGb ?? ""}
                      placeholder="default"
                      onChange={(e) => {
                        const diskSizeGb =
                          e.target.value === "" ? undefined : Number(e.target.value);
                        patchList("hardwareProfiles", i, (profile) => ({
                          ...profile,
                          hardware: { ...profile.hardware, diskSizeGb },
                        }));
                      }}
                    />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label>Guest OS (optional)</label>
                    <Select
                      ariaLabel="Guest OS (optional)"
                      value={profile.os ?? ""}
                      options={[
                        { value: "", label: "Any" },
                        ...GUEST_OS_OPTIONS.map((opt) => ({ value: opt.os, label: opt.name })),
                      ]}
                      onChange={(value) => {
                        patchList("hardwareProfiles", i, (profile) => ({
                          ...profile,
                          os: value === "" ? undefined : (value as typeof profile.os),
                        }));
                      }}
                    />
                  </div>
                  <div className="field" style={{ justifyContent: "flex-end" }}>
                    <label>&nbsp;</label>
                    <button
                      className="btn small danger ghost"
                      onClick={() => removeListUndoable("hardwareProfiles", i, profile.name)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button
              className="btn small"
              onClick={() =>
                setDraft({
                  ...draft,
                  hardwareProfiles: [
                    ...(draft.hardwareProfiles ?? []),
                    {
                      id: crypto.randomUUID(),
                      name: "Project",
                      repoPattern: "",
                      hardware: { cpuCores: 8, memoryMb: 8192 },
                    },
                  ],
                })
              }
            >
              Add repo profile
            </button>
          </>
        )}

        {tab === "workers" && (
          <>
            <div className="settings-pane-head">
              <p className="hint">
                Paste the add line from <code>npm run dev:worker</code> (or{" "}
                <code>locus config workers add</code>). Locus does not scan the LAN. Chat, keys, and
                approvals stay on this computer. Docker, Host, or QEMU VM. Cloud VMs destroy guests
                on stop and after idle TTL. Set hourly USD so the spend cap meters VM time. Cloud
                VMs need an image allowlist. Fargate needs a size allowlist and a task definition
                that already runs locus-worker.
              </p>
            </div>
            <div className="worker-add-paste">
              <input
                value={workerBlob}
                spellCheck={false}
                placeholder="Paste locus-worker:add?url=…"
                aria-label="Worker add line"
                onChange={(e) => setWorkerBlob(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addWorkerFromBlob();
                  }
                }}
              />
              <button
                type="button"
                className="btn small primary"
                disabled={workerAddBusy || !workerBlob.trim()}
                onClick={() => void addWorkerFromBlob()}
              >
                Add
              </button>
            </div>
            {workerAddHint ? <p className="hint">{workerAddHint}</p> : null}
            {(draft.workers ?? []).length === 0 ? (
              <SettingsEmpty
                title="No workers yet"
                hint="Paste a locus-worker:add line, or add a worker card."
              >
                <button type="button" className="btn small" onClick={addWorker}>
                  Add worker
                </button>
              </SettingsEmpty>
            ) : (
              (draft.workers ?? []).map((row, i) => (
                <WorkerCard
                  key={row.id}
                  worker={row}
                  expanded={expandedWorker === row.id}
                  busy={busyWorker === row.id}
                  probe={workerProbe[row.id]}
                  onToggleExpand={() => setExpandedWorker((id) => (id === row.id ? null : row.id))}
                  onPatch={(patch) => patchList("workers", i, patch)}
                  onTest={() => void testWorker(row)}
                  onRemove={() => {
                    removeListUndoable("workers", i, row.name);
                    setExpandedWorker((id) => (id === row.id ? null : id));
                  }}
                />
              ))
            )}
            <p className="hint">
              Create a VM (or use a LAN box), install Docker, run <code>npm run dev:worker</code>,
              then paste the printed <code>locus-worker:add</code> line above. Add tests the host,
              pins TLS, and lists it. Locus does not scan the LAN. Mark <strong>Cloud VM</strong> so
              idle TTL, the concurrent cap, hourly USD, and the image allowlist apply. Mark{" "}
              <strong>Fargate</strong> to RunTask an allowed size (recorded HTTP, no AWS SDK) using
              a task definition you already registered — Locus does not create VPCs. Optional ECS
              endpoint sends RunTask through a VPC endpoint or API Gateway.
            </p>
          </>
        )}
        {tab === "environments" && (
          <>
            <p className="scrim-note">
              A named environment is golden image + jail + recipe + spend cap + Where. Save one from
              New agent or Automations. Adaptive and webhook jobs reuse that machine overnight. This
              is not a seventh rail.
            </p>
            {(draft.namedEnvironments ?? []).length === 0 ? (
              <SettingsEmpty
                title="No named environments yet"
                hint="Save one from New agent or Automations. This page does not add another form."
              >
                <button
                  type="button"
                  className="btn small primary"
                  onClick={() => {
                    dispatch({ type: "settings", open: false });
                    dispatch({ type: "section", section: "agents" });
                    dispatch({ type: "select", id: null });
                    dispatch({ type: "new", open: true });
                  }}
                >
                  Save from New agent
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    dispatch({ type: "settings", open: false });
                    dispatch({ type: "section", section: "automations" });
                  }}
                >
                  Open Automations
                </button>
              </SettingsEmpty>
            ) : (
              (draft.namedEnvironments ?? []).map((env, i) => (
                <NamedEnvironmentCard
                  key={env.id}
                  env={env}
                  expanded={expandedEnv === env.id}
                  onToggleExpand={() => setExpandedEnv((id) => (id === env.id ? null : env.id))}
                  onRename={(name) => patchList("namedEnvironments", i, { name })}
                  onRemove={() => {
                    removeListUndoable("namedEnvironments", i, env.name);
                    setExpandedEnv((id) => (id === env.id ? null : id));
                  }}
                />
              ))
            )}
          </>
        )}
        {tab === "git" && (
          <>
            <p className="scrim-note">
              Add one or more GitHub, GitLab, Bitbucket, Gitea, Forgejo, and Azure DevOps accounts.
              Sign in with GitHub, GitLab, or Bitbucket so SSO-protected orgs work, or paste a token
              (Gitea, Forgejo, and Azure DevOps are PAT-only). Either is enough to clone, fetch a
              branch or pull request, and push over HTTPS — no SSH key required. Multiple accounts
              of the same forge can be active at once; each linked repo remembers which account to
              use.
            </p>
            <div className="git-accounts">
              {draft.forges.map((f, i) => {
                const linked = state.repos.filter((row) => row.checkout.accountId === f.id);
                return (
                  <ForgeAccountCard
                    key={f.id}
                    account={f}
                    expanded={expandedForge === f.id}
                    oauthBusy={oauthBusy === f.id}
                    oauthPending={oauth?.accountId === f.id}
                    oauthError={oauth?.accountId === f.id ? oauth.error : undefined}
                    oauthUserCode={oauth?.accountId === f.id ? oauth.userCode : undefined}
                    oauthVerificationUri={
                      oauth?.accountId === f.id ? oauth.verificationUri : undefined
                    }
                    oauthCallback={oauthCallback}
                    linkedCount={linked.length}
                    lastUsed={formatForgeUsedAt(latestForgeRepoActivity(linked))}
                    onToggleExpand={() => setExpandedForge((id) => (id === f.id ? null : f.id))}
                    onPatch={(patch) => patchList("forges", i, patch)}
                    onSignIn={() => void startOauth(f)}
                    onCancelOauth={() => void cancelOauth(f.id)}
                    onDisconnect={() => void disconnectOauth(f.id)}
                    onRemove={() => {
                      const next = draft.forges[i - 1]?.id ?? draft.forges[i + 1]?.id ?? null;
                      removeListUndoable("forges", i, f.name);
                      setExpandedForge((id) => (id === f.id ? next : id));
                    }}
                  />
                );
              })}
            </div>
            <div className="row-actions">
              {FORGE_KINDS.map((kind) => (
                <button
                  key={kind}
                  className="btn small"
                  onClick={() => {
                    const id = crypto.randomUUID();
                    appendList("forges", {
                      id,
                      kind,
                      name: `${forgeLabel(kind)} ${draft.forges.filter((row) => row.kind === kind).length + 1}`,
                      apiBaseUrl: defaultForgeApiUrl(kind),
                    });
                    setExpandedForge(id);
                  }}
                >
                  Add {forgeLabel(kind)}
                </button>
              ))}
            </div>
          </>
        )}

        {tab === "integrations" && (
          <>
            <p className="scrim-note">
              First-party GitHub, GitLab, Bitbucket, Gitea, Forgejo, Azure DevOps, Jira, Confluence,
              Linear, Slack, Grafana, Sentry, Miro, Figma, incident.io, AWS IAM, Portainer, Gmail,
              Google Calendar, Google Drive, and Kubernetes, plus plugins the Locus agent can
              author. Tokens stay in the vault, never in the guest or the prompt. Sign in with Slack
              so Locus can act as you by default. Sign in with Google for Gmail, Calendar, and
              Drive. Composer and slack_post can also send as the Locus bot when a bot token is
              present. Agents only get those tools after that account has the required values.
              Mutating Jira comments, creates, transitions, Confluence pages, Linear
              comments/creates/updates, Slack posts, Sentry updates, Miro exports, Figma comments,
              incident.io creates/updates, Portainer start/stop, Gmail sends, Calendar creates,
              Drive uploads, Kubernetes apply/delete/scale, and plugin writes wait for Approve /
              Deny. Ask an agent to add a plugin for a bespoke HTTP API.
            </p>
            <h3>Git forges</h3>
            <p className="hint">
              Same accounts as Settings → Git. Restricted jail allowlists those hosts.
            </p>
            <button
              type="button"
              className="btn small"
              onClick={() => dispatch({ type: "settingsTab", tab: "git" })}
            >
              Open Git
            </button>
            {draft.forges.length ? (
              <p className="hint">
                {draft.forges
                  .map(
                    (f) =>
                      `${forgeLabel(f.kind)} · ${f.name}${
                        f.token
                          ? f.authMethod === "oauth" && f.username
                            ? ` · signed in as ${f.username}`
                            : " · connected"
                          : ""
                      }`,
                  )
                  .join(" · ")}
              </p>
            ) : (
              <p className="hint">
                No Git accounts yet. Add GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps
                in Git.
              </p>
            )}
            <h3>
              Jira, Confluence, Linear, Slack, Grafana, Sentry, Miro, Figma, incident.io, AWS IAM,
              Portainer, Google, Kubernetes
            </h3>
            {draft.managedPolicy?.policy.tokenFreeMode ? (
              <p className="hint">
                Token-free mode: integrations go through a managed MCP proxy. Personal tokens are
                not stored in the vault.
              </p>
            ) : null}
            <button
              type="button"
              className="btn small"
              data-testid="revoke-all-tokens"
              onClick={() => {
                void (async () => {
                  if (
                    !(await askConfirm({
                      title: "Revoke all tokens?",
                      body: "Revoke every integration token stored in the vault?",
                      confirmLabel: "Revoke",
                      danger: true,
                    }))
                  )
                    return;
                  const result = await api.revokeAllIntegrations();
                  setDraft(result.config);
                  dispatch({ type: "config", config: result.config });
                })();
              }}
            >
              Revoke all tokens
            </button>
            {(draft.integrations ?? []).map((row, i) => (
              <IntegrationCard
                key={row.id}
                account={row}
                expanded={expandedIntegration === row.id}
                oauthBusy={oauthBusy === row.id}
                oauthPending={
                  (oauth?.kind === "slack" || oauth?.kind === "google") &&
                  oauth.accountId === row.id
                }
                oauthError={
                  (oauth?.kind === "slack" || oauth?.kind === "google") &&
                  oauth.accountId === row.id
                    ? oauth.error
                    : undefined
                }
                oauthCallback={oauthCallback}
                onToggleExpand={() =>
                  setExpandedIntegration((id) => (id === row.id ? null : row.id))
                }
                onPatch={(patch) => patchList("integrations", i, patch)}
                onSignInSlack={() => void startSlackOauth(row)}
                onDisconnectSlack={() => void disconnectSlack(row.id)}
                onSignInGoogle={() => void startGoogleOauth(row)}
                onDisconnectGoogle={() => void disconnectGoogle(row.id)}
                onRemove={() => {
                  removeListUndoable("integrations", i, row.name);
                  setExpandedIntegration((id) => (id === row.id ? null : id));
                }}
              />
            ))}
            <div className="integration-catalog">
              {INTEGRATION_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="integration-catalog-card"
                  onClick={() => {
                    const next: IntegrationAccount = {
                      id: crypto.randomUUID(),
                      kind,
                      name: integrationLabel(kind),
                      enabled: true,
                      baseUrl: defaultIntegrationUrl(kind),
                    };
                    appendList("integrations", next);
                    setExpandedIntegration(next.id);
                  }}
                >
                  <strong>Add {integrationLabel(kind)}</strong>
                  <span>{integrationBlurb(kind)}</span>
                </button>
              ))}
            </div>
            <h3>Plugins</h3>
            <p className="hint">
              Ask an agent to add a plugin for an internal API. Fields below come from that plugin.
              Secrets stay in the vault.
            </p>
            {(draft.integrationPlugins ?? []).length === 0 ? (
              <EmptyHint title="No plugins yet." />
            ) : (
              (draft.integrationPlugins ?? []).map((plugin, i) => (
                <IntegrationPluginCard
                  key={plugin.id}
                  plugin={plugin}
                  expanded={expandedPlugin === plugin.id}
                  onToggleExpand={() =>
                    setExpandedPlugin((id) => (id === plugin.id ? null : plugin.id))
                  }
                  onPatch={(patch) => patchPlugin(draft, setDraft, i, patch)}
                  onPatchConfig={(key, value) => patchPluginConfig(draft, setDraft, i, key, value)}
                  onRemove={() => {
                    removeListUndoable("integrationPlugins", i, plugin.name || plugin.id);
                    setExpandedPlugin((id) => (id === plugin.id ? null : id));
                  }}
                />
              ))
            )}
          </>
        )}
        {tab === "mcp" && (
          <>
            <p className="scrim-note">
              MCP stdio can run on this host (security exception) or inside the Docker guest.
              HTTP/SSE stays on the host. For an AWS MCP / API Gateway URL, set AWS_ACCESS_KEY_ID
              and AWS_SECRET_ACCESS_KEY in env (optional AWS_SIGV4 service, default execute-api).
              Tool calls wait for Approve / Deny in chat. Command must be a single executable (no
              shell).
            </p>
            {(draft.mcpServers ?? []).length === 0 ? (
              <SettingsEmpty
                title="No MCP servers yet"
                hint="Add a stdio command or an HTTP/SSE URL. Tool calls wait for Approve / Deny."
              >
                <button type="button" className="btn small primary" onClick={addMcpServer}>
                  Add MCP server
                </button>
              </SettingsEmpty>
            ) : (
              (draft.mcpServers ?? []).map((server, i) => (
                <McpServerCard
                  key={server.id}
                  server={server}
                  expanded={expandedMcp === server.id}
                  hostLocked={policyControlLocked(draft, "hostMcp")}
                  onToggleExpand={() =>
                    setExpandedMcp((id) => (id === server.id ? null : server.id))
                  }
                  onPatch={(patch) => patchList("mcpServers", i, patch)}
                  onRemove={() => {
                    removeListUndoable("mcpServers", i, server.name);
                    setExpandedMcp((id) => (id === server.id ? null : id));
                  }}
                />
              ))
            )}
          </>
        )}
        {tab === "skills" && (
          <>
            <p className="scrim-note" style={{ marginTop: 0, marginBottom: 14 }}>
              On-demand prompts. Type <code>/name</code> in the composer, with an optional extra
              task after it.
            </p>
            {(draft.skills ?? []).map((skill, i) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                expanded={expandedSkill === skill.id}
                onToggleExpand={() => setExpandedSkill((id) => (id === skill.id ? null : skill.id))}
                onPatch={(patch) => patchList("skills", i, patch)}
                onRemove={() => {
                  removeListUndoable("skills", i, skill.title || skill.name);
                  setExpandedSkill((id) => (id === skill.id ? null : id));
                }}
              />
            ))}
            <p className="hint">
              Built-in commands like <code>/undo</code> stay reserved.
            </p>
          </>
        )}

        {tab === "phone" && (
          <>
            <p className="hint">
              Control this Locus from an Android phone on the same LAN or Tailscale network. The
              control plane stays off the public internet. Pairing uses HTTPS with a self-signed
              cert and a token; LAN clients without the token are rejected. The phone loads chats,
              Slack, approvals, Design comments and promote, Codebase PR review and merge, workspace
              files, and Docker Browser takeover. VNC stays on the desktop. Do not Funnel port 7420.
            </p>
            <div className="provider-card open phone-card">
              <div className="provider-card-head">
                <span className="provider-card-copy">
                  <strong>Phone pairing</strong>
                  <span className="meta">{phone?.enabled ? "Enabled" : "Off"}</span>
                </span>
              </div>
              <div className="provider-card-body">
                <p className="hint">Pairing applies immediately. Other settings auto-save.</p>
                <div className="field">
                  <label className="check">
                    <input
                      type="checkbox"
                      data-testid="phone-enabled"
                      checked={Boolean(phone?.enabled)}
                      disabled={phoneBusy || policyControlLocked(draft, "phoneRemote")}
                      onChange={(e) => void setPhoneEnabled(e.target.checked)}
                    />
                    Enable phone remote
                  </label>
                </div>
                {phone?.enabled && phone.token ? (
                  <>
                    <div className="field">
                      <label>Pairing token</label>
                      <p className="phone-token" data-testid="phone-token">
                        {formatPhoneToken(phone.token)}
                      </p>
                      <p className="hint">
                        Scan the QR code, enter this in the Locus Android app, or open a pairing URL
                        on the phone. Restart Locus after enabling so it listens on the LAN (
                        {phone.listenHost}:{phone.port}) with HTTPS. Restart again after disabling
                        to return to loopback.
                      </p>
                      {phone.fingerprint ? (
                        <p className="hint">
                          TLS fingerprint <code>{phone.fingerprint}</code>
                        </p>
                      ) : null}
                    </div>
                    {phone.urls.length ? (
                      <>
                        {pairingLink && (
                          <div className="field">
                            <label>Scan to pair</label>
                            <PairingQr url={pairingLink.http} />
                            <p className="hint">
                              Point your phone camera at the code to open the pairing URL.
                            </p>
                          </div>
                        )}
                        <div className="field">
                          <label>Pairing URLs</label>
                          <ul className="phone-urls">
                            {phone.urls.map((row) => (
                              <li key={row.address}>
                                <code>{row.http}</code>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </>
                    ) : (
                      <p className="hint">
                        No LAN address detected yet. Join Wi-Fi or Tailscale, then reopen Settings.
                      </p>
                    )}
                    <button
                      type="button"
                      className="btn"
                      disabled={phoneBusy}
                      onClick={() => void rotatePhoneToken()}
                    >
                      Rotate token
                    </button>
                  </>
                ) : (
                  <p className="hint">Turn it on to mint a pairing token for this machine.</p>
                )}
              </div>
            </div>
          </>
        )}

        {tab === "chrome" && (
          <>
            <p className="hint">
              Pair a Chrome (or Edge) extension so Host agents can drive the tabs you already have
              open — logins, cookies, and all. Isolated host-chrome stays the default until you turn
              on Use my Chrome for that agent. The extension talks only to this machine on loopback.
            </p>
            <div className="provider-card open phone-card">
              <div className="provider-card-head">
                <span className="provider-card-copy">
                  <strong>Chrome extension</strong>
                  <span className="meta">
                    {chromeExt?.enabled ? (chromeExt.connected ? "Connected" : "Waiting") : "Off"}
                  </span>
                </span>
              </div>
              <div className="provider-card-body">
                <div className="field">
                  <label className="check">
                    <input
                      type="checkbox"
                      data-testid="chrome-enabled"
                      checked={Boolean(chromeExt?.enabled)}
                      disabled={chromeBusy || policyControlLocked(draft, "liveChrome")}
                      onChange={(e) => void setChromeEnabled(e.target.checked)}
                    />
                    Enable Chrome extension
                  </label>
                </div>
                {chromeExt?.enabled && chromeExt.token ? (
                  <>
                    <div className="field">
                      <label>Pairing token</label>
                      <p className="phone-token" data-testid="chrome-token">
                        {chromeExt.formattedToken || formatChromeExtensionToken(chromeExt.token)}
                      </p>
                      <p className="hint">
                        Chrome → chrome://extensions → Developer mode → Load unpacked. Pick this
                        folder, then paste the token in the extension popup.
                      </p>
                      <p className="hint">
                        Extension folder{" "}
                        <code data-testid="chrome-install-dir">{chromeExt.installDir}</code>
                      </p>
                    </div>
                    <p className="hint">
                      {chromeExt.connected
                        ? `${chromeExt.tabs.length} tab${chromeExt.tabs.length === 1 ? "" : "s"} from your browser.`
                        : "Extension not connected yet. Keep Locus running, load the unpacked folder, and Connect."}
                    </p>
                    <button
                      type="button"
                      className="btn"
                      disabled={chromeBusy}
                      onClick={() => void rotateChromeToken()}
                    >
                      Rotate token
                    </button>
                  </>
                ) : (
                  <p className="hint">Turn it on to mint a pairing token and copy the extension.</p>
                )}
              </div>
            </div>
          </>
        )}

        {tab === "advanced" && (
          <>
            <details className="advanced" open>
              <summary>Brain</summary>
              <p className="scrim-note">
                Shared knowledge graph + distilled memory. Coding agents orient on this
                automatically. Workspace <code>.locus/memories.json</code> stays a manual override
                via CLI.
              </p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.brain?.autoIndex !== false}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      brain: { ...draft.brain, autoIndex: e.target.checked },
                    })
                  }
                />
                Auto-index after git clone
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.brain?.ingestPaused === true}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      brain: { ...draft.brain, ingestPaused: e.target.checked },
                    })
                  }
                />
                Pause remember + session distill ingest
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.brain?.slackCorpus === true}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      brain: { ...draft.brain, slackCorpus: e.target.checked },
                    })
                  }
                />
                Ingest Slack cache into Brain corpus (off by default)
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.brain?.jiraCorpus === true}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      brain: { ...draft.brain, jiraCorpus: e.target.checked },
                    })
                  }
                />
                Ingest recent Jira issues into Brain corpus (off by default)
              </label>
              <div className="grid-2">
                <div className="field">
                  <label>Distiller provider id</label>
                  <input
                    value={draft.brain?.distillerProviderId ?? ""}
                    placeholder="openai / anthropic / … (empty = first usable)"
                    disabled={policyControlLocked(draft, "brainDistiller")}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        brain: {
                          ...draft.brain,
                          distillerProviderId: e.target.value.trim() || undefined,
                        },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>Distiller model</label>
                  <input
                    value={draft.brain?.distillerModel ?? ""}
                    placeholder="Optional model override"
                    disabled={policyControlLocked(draft, "brainDistiller")}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        brain: {
                          ...draft.brain,
                          distillerModel: e.target.value.trim() || undefined,
                        },
                      })
                    }
                  />
                </div>
              </div>
            </details>
            <details className="advanced" open>
              <summary>Host / QEMU paths</summary>
              {hypervisor && (
                <p className="scrim-note">
                  Host: {state.setup?.hostOs?.label ?? "unknown"}
                  {" · "}Detected: {hypervisor.kind}
                  {hypervisor.capabilities && (
                    <>
                      {" · "}QEMU {hypervisor.capabilities.qemuBinary ? "found" : "missing"}
                      {" · "}qemu-img {hypervisor.capabilities.qemuImgBinary ? "found" : "missing"}
                      {" · "}KVM{" "}
                      {hypervisor.capabilities.hasKvm
                        ? hypervisor.capabilities.kvmUsable === false
                          ? "present, unusable — using TCG"
                          : "yes"
                        : "no"}
                      {" · "}OVMF {hypervisor.capabilities.ovmfCodePath ? "found" : "missing"}
                      {" · "}swtpm {hypervisor.capabilities.swtpmBinary ? "found" : "missing"}
                    </>
                  )}
                </p>
              )}
              {!hypervisor?.capabilities?.qemuBinary && (
                <div className="qemu-install">
                  {state.setup?.qemuHint ? (
                    <code className="setup-cmd">{state.setup.qemuHint}</code>
                  ) : (
                    <p className="scrim-note">Install QEMU on this host.</p>
                  )}
                  {state.setup?.qemuInstall?.canInstall && (
                    <button
                      className="btn small"
                      disabled={installingQemu || saving}
                      onClick={() => void installQemu()}
                    >
                      {installingQemu ||
                      (state.qemuInstall && !state.qemuInstall.done && !state.qemuInstall.error)
                        ? "Installing QEMU…"
                        : "Install QEMU"}
                    </button>
                  )}
                </div>
              )}
              <QemuInstallStatus progress={state.qemuInstall} />
              <div className="grid-2">
                <div className="field">
                  <label>QEMU binary</label>
                  <input
                    value={draft.advanced.qemuBinary}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: { ...draft.advanced, qemuBinary: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>swtpm binary</label>
                  <input
                    value={draft.advanced.swtpmBinary}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: { ...draft.advanced, swtpmBinary: e.target.value },
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>OVMF code (Windows 11)</label>
                  <input
                    value={draft.advanced.ovmfCodePath}
                    placeholder="/usr/share/OVMF/OVMF_CODE.fd"
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: { ...draft.advanced, ovmfCodePath: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>OVMF vars</label>
                  <input
                    value={draft.advanced.ovmfVarsPath}
                    placeholder="/usr/share/OVMF/OVMF_VARS.fd"
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: { ...draft.advanced, ovmfVarsPath: e.target.value },
                      })
                    }
                  />
                </div>
              </div>
            </details>
            <details className="advanced" open>
              <summary>Limits</summary>
              <div className="grid-2">
                <div className="field">
                  <label>Max concurrent VMs</label>
                  <input
                    type="number"
                    value={draft.advanced.maxConcurrentVms}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: { ...draft.advanced, maxConcurrentVms: Number(e.target.value) },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>Max agent tool rounds</label>
                  <input
                    type="number"
                    min={0}
                    value={agentRoundLimit(draft.advanced.maxAgentRounds) ?? ""}
                    placeholder="unlimited"
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: {
                          ...draft.advanced,
                          maxAgentRounds: e.target.value.trim()
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                  <p className="hint">
                    Optional cap (4–128). Empty or 0 keeps the agent running until it finishes, you
                    abort, or a spend/time cap hits. The old default of 48 no longer stops a turn.
                  </p>
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Spend cap per turn (USD)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.advanced.maxUsdPerTurn ?? ""}
                    placeholder="unlimited"
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: {
                          ...draft.advanced,
                          maxUsdPerTurn: e.target.value.trim() ? Number(e.target.value) : undefined,
                        },
                      })
                    }
                  />
                  <p className="hint">Stop the model when estimated spend reaches this amount.</p>
                </div>
                <div className="field">
                  <label>Time budget per turn (ms)</label>
                  <input
                    type="number"
                    min={0}
                    step="1000"
                    value={draft.advanced.maxMsPerTurn ?? ""}
                    placeholder="unlimited"
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: {
                          ...draft.advanced,
                          maxMsPerTurn: e.target.value.trim() ? Number(e.target.value) : undefined,
                        },
                      })
                    }
                  />
                  <p className="hint">
                    Stop and report progress when a turn exceeds this many milliseconds.
                  </p>
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Guest boot timeout (ms)</label>
                  <input
                    type="number"
                    min={30000}
                    step="1000"
                    value={guestBootTimeoutMs(draft.advanced.guestBootTimeoutMs)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: {
                          ...draft.advanced,
                          guestBootTimeoutMs: e.target.value.trim()
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                  <p className="hint">
                    How long a turn waits for Docker or QEMU to become ready (30s–1h). Default 15
                    minutes.
                  </p>
                </div>
                <div className="field">
                  <label>Approval timeout (ms)</label>
                  <input
                    type="number"
                    min={60000}
                    step="1000"
                    value={approvalTimeoutMs(draft.advanced.approvalTimeoutMs)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: {
                          ...draft.advanced,
                          approvalTimeoutMs: e.target.value.trim()
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                  <p className="hint">
                    Needs-you prompts auto-deny after this wait (1m–24h). Default 30 minutes.
                  </p>
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Prompt queue depth</label>
                  <input
                    type="number"
                    min={1}
                    max={256}
                    value={promptQueueLimit(draft.advanced.maxPromptQueue)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: {
                          ...draft.advanced,
                          maxPromptQueue: e.target.value.trim()
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                  <p className="hint">
                    Composer follow-ups waiting behind the current turn (1–256).
                  </p>
                </div>
                <div className="field">
                  <label>Automation chats to keep</label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={automationChatLimit(draft.advanced.maxAutomationChats)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: {
                          ...draft.advanced,
                          maxAutomationChats: e.target.value.trim()
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                  <p className="hint">
                    Newest chats kept per job when Reuse last chat is off (1–500). Default 60.
                  </p>
                </div>
              </div>
              <div className="field">
                <label>Notify webhook</label>
                <input
                  value={draft.advanced.notifyWebhook ?? ""}
                  placeholder="https://example.com/hooks/locus"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      advanced: {
                        ...draft.advanced,
                        notifyWebhook: e.target.value.trim() || undefined,
                      },
                    })
                  }
                />
                <p className="hint">
                  POST JSON when an automation finishes. Desktop notify already fires in-app. Slack
                  incoming webhook URLs get a text summary.
                </p>
              </div>
              <div className="field">
                <label>Webhook base URL</label>
                <input
                  value={draft.advanced.webhookBaseUrl ?? ""}
                  placeholder="https://your-machine.ts.net"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      advanced: {
                        ...draft.advanced,
                        webhookBaseUrl: e.target.value.trim() || undefined,
                      },
                    })
                  }
                />
                <p className="hint">
                  Public origin for forge webhooks. Tailscale Funnel fills this when you expose
                  /api/hooks only. An API Gateway execute-api origin works the same way if it
                  proxies only /api/hooks (HTTP integration or a Lambda that forwards the inner
                  body). Keep the bind host on loopback.
                </p>
              </div>
              <div className="field">
                <label>Tailscale Funnel</label>
                <div className="field-inline">
                  <BusyButton
                    type="button"
                    className={`btn small ${tailscale?.funnelEnabled ? "primary" : ""}`}
                    busy={funnelBusy}
                    busyLabel="Working…"
                    disabled={!tailscale?.installed}
                    disabledReason="Install Tailscale first"
                    onClick={() => {
                      setFunnelBusy(true);
                      void api
                        .setTailscaleFunnel(!tailscale?.funnelEnabled)
                        .then((next) => {
                          setTailscale(next);
                          if (next.webhookBaseUrl) {
                            setDraft({
                              ...draft,
                              advanced: {
                                ...draft.advanced,
                                webhookBaseUrl: next.webhookBaseUrl,
                              },
                            });
                          }
                        })
                        .catch((err) =>
                          setError(err instanceof Error ? err.message : "Tailscale failed"),
                        )
                        .finally(() => setFunnelBusy(false));
                    }}
                  >
                    {tailscale?.funnelEnabled ? "Disable Funnel" : "Expose /api/hooks"}
                  </BusyButton>
                  <span className="hint">
                    {tailscale?.funnelUrl ??
                      tailscale?.error ??
                      (tailscale?.installed
                        ? "Funnel off — GitHub cannot reach loopback"
                        : "Install Tailscale to expose forge webhooks")}
                  </span>
                </div>
                <p className="hint">
                  Never Funnel the whole control plane. This only proxies /api/hooks to 127.0.0.1.
                  The webhook secret is still required.
                </p>
              </div>
              <div className="field">
                <label>Slack signing secret</label>
                <input
                  type="password"
                  value={draft.advanced.slackSigningSecret ?? ""}
                  placeholder="from the Slack app Basic Information page"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      advanced: {
                        ...draft.advanced,
                        slackSigningSecret: e.target.value.trim() || undefined,
                      },
                    })
                  }
                />
                <p className="hint">
                  Optional. Lets Slack Events / slash commands authenticate without X-Locus-Secret.
                </p>
              </div>
              <div className="field">
                <label>Extra allow hosts</label>
                <input
                  value={(draft.advanced.extraAllowHosts ?? []).join(", ")}
                  placeholder="your-domain.atlassian.net, grafana.example.com, slack.com, api.incident.io, portainer.example.com, gmail.googleapis.com"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      advanced: {
                        ...draft.advanced,
                        extraAllowHosts: e.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
                <p className="hint">
                  Added to every restricted jail allowlist (Jira, Confluence, Grafana, Sentry,
                  Slack, incident.io, Portainer, …).
                </p>
              </div>
              <div className="field">
                <label>Autonomy</label>
                <Select
                  ariaLabel="Autonomy"
                  value={parseAutonomyTier(draft.advanced.autonomy)}
                  disabled={policyControlLocked(draft, "autonomous")}
                  options={AUTONOMY_SELECT_OPTIONS}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      advanced: {
                        ...draft.advanced,
                        autonomy: parseAutonomyTier(value),
                      },
                    })
                  }
                />
                <p className="hint">
                  One ladder from showing every mutating command to overnight CI. Autonomous
                  auto-allows push, PR, MCP, plugins, and package installs (protected default
                  branches still wait) and defaults to a $20 spend cap. Guided and Supervised have
                  no default USD cap unless you set one. Always ask / Never allow below overlay the
                  tier.
                </p>
              </div>
              <div className="field">
                <label>Always ask (comma-separated tools)</label>
                <input
                  value={(draft.advanced.approvalPolicy?.alwaysAsk ?? []).join(", ")}
                  placeholder="exec"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      advanced: {
                        ...draft.advanced,
                        approvalPolicy: {
                          ...(draft.advanced.approvalPolicy ?? {}),
                          alwaysAsk: e.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        },
                      },
                    })
                  }
                />
              </div>
              <div className="field">
                <label>Never allow (comma-separated tools)</label>
                <input
                  value={(draft.advanced.approvalPolicy?.deny ?? []).join(", ")}
                  placeholder="git_push"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      advanced: {
                        ...draft.advanced,
                        approvalPolicy: {
                          ...(draft.advanced.approvalPolicy ?? {}),
                          deny: e.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        },
                      },
                    })
                  }
                />
                <p className="hint">
                  Protects main/master/trunk on git_push and git_pr unless you turn that off in
                  config.
                </p>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Bind host</label>
                  <input
                    value={draft.advanced.bindHost}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: { ...draft.advanced, bindHost: e.target.value },
                      })
                    }
                  />
                  <p className="hint">Loopback only (127.0.0.1, ::1, or localhost).</p>
                </div>
                <div className="field">
                  <label>Port</label>
                  <input
                    type="number"
                    value={draft.advanced.bindPort}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        advanced: { ...draft.advanced, bindPort: Number(e.target.value) },
                      })
                    }
                  />
                </div>
              </div>
              <div className="field">
                <label>Data directory</label>
                <input
                  value={draft.advanced.dataDir}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      advanced: { ...draft.advanced, dataDir: e.target.value },
                    })
                  }
                />
              </div>
              <div className="field">
                <label>Host folder shared with guests</label>
                <input
                  value={draft.advanced.hostSharePath}
                  placeholder={`${draft.advanced.dataDir}/share`}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      advanced: { ...draft.advanced, hostSharePath: e.target.value },
                    })
                  }
                />
                <p className="hint">
                  Linux guests mount this at /mnt/host over 9p. Windows guests copy the same files
                  to C:\host over SSH once they are ready. Defaults to the data directory share
                  folder.
                </p>
              </div>
              <div className="field">
                <label>Python interpreter</label>
                <input
                  value={draft.advanced.pythonInterpreter ?? ""}
                  placeholder=".venv/bin/python"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      advanced: { ...draft.advanced, pythonInterpreter: e.target.value },
                    })
                  }
                />
                <p className="hint">
                  Used for IDE Go to Definition in Django and other Python projects. Leave empty to
                  use <code>.venv</code> / <code>venv</code> in the folder, or{" "}
                  <code>python.defaultInterpreterPath</code> in <code>.vscode/settings.json</code>.
                  Also <code>LOCUS_PYTHON</code>. Completions and Go to Definition also need{" "}
                  <code>python-lsp-server</code> on PATH (<code>pip install python-lsp-server</code>
                  , or <code>python3 -m pylsp</code> / <code>LOCUS_PYLSP</code>).
                </p>
              </div>
            </details>
            <details className="advanced" open>
              <summary>Danger zone</summary>
              <div className="field">
                <label>Reset all data</label>
                <p className="hint">
                  Wipes {state.config?.advanced.dataDir ?? draft.advanced.dataDir}: config,
                  encrypted secrets, sessions, VM disks, Docker workspaces, golden images, media,
                  and automations. Host QEMU/Docker installs are not touched. First-run setup runs
                  again.
                </p>
                <BusyButton
                  type="button"
                  className="btn danger"
                  busy={resetting}
                  busyLabel="Resetting…"
                  disabled={saving}
                  onClick={() => void resetAll()}
                >
                  Reset all data
                </BusyButton>
              </div>
            </details>
          </>
        )}

        {tab === "about" && (
          <div className="about">
            <div className="about-hero">
              <div className="brand-mark" aria-hidden="true" />
              <div>
                <h3>{APP_NAME}</h3>
                <p>Local agent machines</p>
              </div>
            </div>
            <dl className="about-meta">
              <div>
                <dt>Version</dt>
                <dd>{APP_VERSION}</dd>
              </div>
              <div>
                <dt>Developer</dt>
                <dd>{APP_DEVELOPER}</dd>
              </div>
              <div>
                <dt>License</dt>
                <dd>{APP_LICENSE}</dd>
              </div>
            </dl>
            <div className="about-updates">
              <div className="about-updates-actions">
                <BusyButton
                  type="button"
                  className="btn small"
                  busy={updateBusy}
                  busyLabel="Checking…"
                  onClick={() => void checkForUpdates()}
                >
                  Check for updates
                </BusyButton>
                <a href={APP_RELEASES_URL} target="_blank" rel="noreferrer">
                  GitHub releases
                </a>
              </div>
              {update ? (
                <p className="hint">
                  {update.status === "available"
                    ? `Version ${update.latest?.replace(/^v/i, "")} is available.`
                    : update.status === "up-to-date"
                      ? "You are on the latest release."
                      : (update.message ?? "Updates are not available yet.")}
                </p>
              ) : null}
              {update?.status === "available" ? (
                <div className="about-updates-actions">
                  {update.asset ? (
                    <a
                      className="btn small primary"
                      href={update.asset.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download {update.asset.name}
                    </a>
                  ) : null}
                  {update.htmlUrl ? (
                    <a href={update.htmlUrl} target="_blank" rel="noreferrer">
                      Open release notes
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
            <p className="hint">
              Privacy: provider keys and forge tokens stay in the encrypted vault and are injected
              as environment variables at guest runtime — never into the model prompt. Chat and tool
              results go only to the provider you enabled. JSONL traces stay on this machine under
              ~/.locus/traces. Locus does not train models. Retention is this data directory until
              you delete a session or Reset all data. This is a single-operator local app; guests
              isolate workspaces, not tenants.
            </p>
            <pre className="about-license">{APP_LICENSE_TEXT}</pre>
          </div>
        )}
      </section>
      {error && (
        <p className="scrim-note" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      <div className="modal-actions settings-foot">
        <p
          className="settings-save-hint"
          data-testid="settings-save-status"
          data-status={
            saveStatus === "error" ? "error" : saveStatus === "saving" || dirty ? "saving" : "saved"
          }
          aria-live="polite"
        >
          {saveStatus === "error"
            ? "Save failed"
            : saveStatus === "saving" || dirty
              ? "Saving…"
              : "Saved"}
        </p>
        <div className="settings-actions">
          <button className="btn ghost" onClick={() => void closeSettings()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function patchPlugin(
  draft: LocusConfig,
  setDraft: (next: LocusConfig) => void,
  index: number,
  patch: Partial<IntegrationPlugin>,
): void {
  setDraft(patchConfigList(draft, "integrationPlugins", index, patch));
}

function patchPluginConfig(
  draft: LocusConfig,
  setDraft: (next: LocusConfig) => void,
  index: number,
  key: string,
  value: string,
): void {
  setDraft(
    patchConfigList(draft, "integrationPlugins", index, (current) => {
      const config = { ...(current.config ?? {}) };
      if (value) config[key] = value;
      else delete config[key];
      return {
        ...current,
        config: Object.keys(config).length ? config : undefined,
      };
    }),
  );
}
