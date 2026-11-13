import { useState } from "react";
import { Modal } from "@/components/layout/Modal";
import type { AiProvider, LocusConfig } from "@locus/shared";
import { DEFAULT_DOCKER_IMAGE, hasUsableKey, isLocalOpenAiBase, t } from "@locus/shared";
import { api } from "@/lib/api";
import { loadLastAgent, pickProvider, saveLastAgent } from "@/lib/lastAgent";
import { useStore } from "@/state/store";
import { Mascot } from "@/components/layout/Mascot";
import { PRODUCT_MODE_LABELS } from "@/lib/productMode";
import { Select } from "@/components/layout/Select";
import { QemuInstallStatus } from "./SettingsCards";

export function SetupWizard() {
  const { state, dispatch } = useStore();
  const setup = state.setup;
  const config = state.config;
  const [providerId, setProviderId] = useState(pickProvider(config?.providers ?? [])?.id ?? "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"image" | "save" | "qemu" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restartNote, setRestartNote] = useState<string | null>(null);
  const [productMode, setProductMode] = useState<"developer" | "swarm">("developer");
  /** Result of the test call after saving: what answered, or why it didn't. */
  const [verified, setVerified] = useState<{ ok: boolean; text: string } | null>(null);

  if (!state.setupOpen || !setup || !config) return null;
  const current = config;
  const dockerFound = setup.dockerFound;
  const provider =
    current.providers.find((p) => p.id === providerId) ??
    pickProvider(current.providers) ??
    current.providers[0];

  async function refresh() {
    const next = await api.setup();
    dispatch({ type: "setup", setup: next });
    return next;
  }

  async function persist(next: LocusConfig) {
    const saved = await api.saveConfig(next);
    dispatch({ type: "config", config: saved });
    return refresh();
  }

  async function fetchUbuntu() {
    setBusy("image");
    setError(null);
    try {
      const downloaded = await api.fetchCloudImage("ubuntu");
      const templates = current.templates.map((t) =>
        t.os === "ubuntu" ? { ...t, isoPath: downloaded.path } : t,
      );
      await persist({ ...current, templates });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(null);
    }
  }

  async function installQemu() {
    setBusy("qemu");
    setError(null);
    setRestartNote(null);
    try {
      const result = await api.installHypervisor();
      dispatch({ type: "setup", setup: result.setup });
      if (result.restartRequired && result.qemuFound) {
        setRestartNote("QEMU is installed. Restart Locus to switch off the mock hypervisor.");
      } else if (result.qemuFound) {
        setRestartNote(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not install QEMU");
    } finally {
      setBusy(null);
    }
  }

  async function saveProvider() {
    if (!provider) return;
    setBusy("save");
    setError(null);
    setVerified(null);
    try {
      const key = apiKey.trim();
      const local = isLocalOpenAiBase(provider.baseUrl);
      // A local server (Ollama, LM Studio) only has the models someone pulled.
      // Ask it, so the default isn't a model that isn't there.
      let models: string[] | null = null;
      if (local) {
        models = await api
          .providerModels(provider.id, key ? { apiKey: key } : {})
          .then((res) => res.models)
          .catch(() => null);
      }
      const defaultModel =
        models?.length && !models.includes(provider.defaultModel)
          ? models[0]!
          : provider.defaultModel;
      const providers = current.providers.map((p) =>
        p.id === provider.id
          ? {
              ...p,
              apiKey: key || p.apiKey,
              enabled: true,
              defaultModel,
              ...(models?.length ? { models } : {}),
            }
          : p,
      );
      await persist({ ...current, providers });
      setApiKey("");
      if (local && models && models.length === 0) {
        setVerified({
          ok: false,
          text: `${provider.name} is running but has no models yet. Pull one (for example \`ollama pull llama3.2\`), then pick it in the composer.`,
        });
        return;
      }
      const started = performance.now();
      try {
        const result = await api.testProvider(provider.id);
        const ms = Math.round(performance.now() - started);
        setVerified(
          result.ok
            ? { ok: true, text: `${provider.name} · ${defaultModel} · responded in ${ms} ms` }
            : { ok: false, text: `${provider.name} saved, but the test call failed.` },
        );
      } catch (err) {
        setVerified({
          ok: false,
          text: `${provider.name} saved, but the test call failed: ${
            err instanceof Error ? err.message : "no response"
          }`,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save provider");
    } finally {
      setBusy(null);
    }
  }

  async function checkAgain() {
    setBusy("check");
    setError(null);
    try {
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh setup");
    } finally {
      setBusy(null);
    }
  }

  async function finish(complete: boolean, runtime?: "docker" | "host") {
    const chosen = runtime ?? (dockerFound ? "docker" : "host");
    setBusy("save");
    setError(null);
    try {
      await persist({
        ...current,
        setupCompleted: true,
        productMode,
        setupFirstTask: current.setupFirstTask ?? "pending",
      });
      dispatch({ type: "setupOpen", open: false });
      if (complete) {
        const last = loadLastAgent();
        saveLastAgent({
          ...last,
          runtime: chosen,
          ...(chosen === "docker" ? { dockerImage: DEFAULT_DOCKER_IMAGE } : {}),
        });
        dispatch({ type: "section", section: "agents" });
        dispatch({ type: "select", id: null });
        // Messenger shell wants the computer column open after setup.
        if (productMode === "swarm" && state.vmCollapsed) {
          dispatch({ type: "toggleVmPane" });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      if (!complete) dispatch({ type: "setupOpen", open: false });
    } finally {
      setBusy(null);
    }
  }

  const hostLabel = setup.hostOs?.label ?? "this computer";
  const keyOptional = hasUsableKey("", provider?.baseUrl, provider?.kind);
  const enabledProvider = current.providers.find((p) => p.enabled);
  // Order: free tier, then no-key local servers and CLIs, then cloud keys; the
  // hint says what each needs instead of one flat list of 18 names.
  const providerOptions = [...current.providers]
    .map((p, index) => ({ p, index, group: providerGroup(p) }))
    .sort((a, b) => a.group.rank - b.group.rank || a.index - b.index)
    .map(({ p, group }) => ({ value: p.id, label: p.name, hint: group.hint }));

  return (
    <Modal
      titleId="setup-wizard-title"
      className="setup-wizard-modal"
      closeOnBackdrop={false}
      onClose={() => dispatch({ type: "setupOpen", open: false })}
    >
      <div className="setup-hero">
        <Mascot pose="idle" size={48} />
        <div>
          <h2 id="setup-wizard-title">Set up Locus</h2>
          <p className="scrim-note setup-hero-lead">
            Detected {hostLabel}.{" "}
            {setup.hasProvider
              ? "A provider is ready, so you can start chatting on this machine."
              : "Pick a model provider, then start chatting on this machine."}{" "}
            Docker and QEMU are optional if you want a container or a full guest desktop later.
          </p>
          <p className="hint">{t("setup.firstTask.hint")}</p>
        </div>
      </div>
      <ol className="setup-list">
        <li className={setup.hasProvider ? "ok" : "todo"}>
          <strong>Provider</strong>
          <span className={verified && !verified.ok ? "hint warn-text" : undefined}>
            {setup.hasProvider
              ? (verified?.text ??
                (enabledProvider
                  ? `${enabledProvider.name} · ${enabledProvider.defaultModel} is enabled.`
                  : "An enabled provider can answer chat."))
              : "Paste an OpenCode Zen key for the free tier, or another provider key. Local servers such as Ollama, and CLI providers (Cursor CLI, Claude Code, Codex CLI, Kiro CLI), do not need a key."}
          </span>
          {!setup.hasProvider && (
            <div className="setup-provider">
              <Select
                ariaLabel="Provider"
                value={provider?.id ?? ""}
                options={providerOptions}
                onChange={(id) => {
                  setProviderId(id);
                  setApiKey("");
                }}
              />
              <input
                type="password"
                placeholder={
                  provider?.kind === "cursor-cli"
                    ? "optional — uses agent login"
                    : provider?.kind === "claude-code"
                      ? "optional — uses claude login"
                      : provider?.kind === "codex-cli"
                        ? "optional — uses codex login"
                        : provider?.kind === "kiro-cli"
                          ? "optional — uses kiro-cli login"
                          : isLocalOpenAiBase(provider?.baseUrl)
                            ? "Optional for localhost"
                            : "API key"
                }
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                className="btn small primary"
                disabled={busy !== null || (!apiKey.trim() && !keyOptional)}
                onClick={() => void saveProvider()}
              >
                {busy === "save"
                  ? "Checking…"
                  : keyOptional
                    ? `Use ${provider?.name ?? "provider"}`
                    : "Save key"}
              </button>
            </div>
          )}
        </li>
      </ol>
      <details className="setup-later">
        <summary>Set up Docker or a VM later</summary>
        <ol className="setup-list">
          <li className={setup.dockerFound ? "ok" : "todo"}>
            <strong>Docker (recommended)</strong>
            <span>
              {setup.dockerFound
                ? "Docker CLI found. New agents start in a container. Host remains available on the composer for trusted local folders."
                : "Docker CLI is not on PATH. Install Docker Desktop or the Docker CLI, then check again. Host agents still work without Docker."}
            </span>
            {!setup.dockerFound && (
              <button
                className="btn small"
                disabled={busy !== null}
                onClick={() => void checkAgain()}
              >
                {busy === "check" ? "Checking…" : "Check again"}
              </button>
            )}
          </li>
          <li className={setup.qemuFound && setup.linuxImageReady ? "ok" : "todo"}>
            <strong>VM desktop (optional)</strong>
            <span>
              {setup.qemuFound
                ? `QEMU found on ${hostLabel} · ${setup.kvmLabel}`
                : `QEMU missing on ${hostLabel}. VM agents need QEMU — install it or use Docker / Host.`}
            </span>
            {!setup.qemuFound && setup.qemuHint ? (
              <code className="setup-cmd">{setup.qemuHint}</code>
            ) : null}
            <span>
              {setup.linuxImageReady
                ? "Ubuntu or Debian image is ready. After the first VM boots, save a golden image so the next agent skips install."
                : "Fetch the Ubuntu 24.04 cloud image (recommended — much faster than an ISO install), then save a golden image after first boot."}
            </span>
            <QemuInstallStatus progress={state.qemuInstall} />
            {!setup.qemuFound &&
              !setup.qemuInstall?.canInstall &&
              setup.qemuInstall?.manualHint && <span>{setup.qemuInstall.manualHint}</span>}
            {(!setup.qemuFound && setup.qemuInstall?.canInstall) || !setup.linuxImageReady ? (
              <div className="setup-step-actions">
                {!setup.qemuFound && setup.qemuInstall?.canInstall && (
                  <button
                    className="btn small"
                    disabled={busy !== null}
                    onClick={() => void installQemu()}
                  >
                    {busy === "qemu" ||
                    (state.qemuInstall && !state.qemuInstall.done && !state.qemuInstall.error)
                      ? "Installing QEMU…"
                      : "Install QEMU"}
                  </button>
                )}
                {!setup.linuxImageReady && (
                  <button
                    className="btn small"
                    disabled={busy !== null}
                    onClick={() => void fetchUbuntu()}
                  >
                    {busy === "image" ? "Downloading…" : "Fetch Ubuntu 24.04"}
                  </button>
                )}
              </div>
            ) : null}
          </li>
        </ol>
      </details>
      <ol className="setup-list">
        <li className="ok">
          <strong>How do you want to start?</strong>
          <span>
            {PRODUCT_MODE_LABELS.swarm} is teammate-first (avatars, Teams, Routines).{" "}
            {PRODUCT_MODE_LABELS.developer} is the full control plane. You can switch anytime.
          </span>
          <div
            className="runtime-toggle setup-mode-toggle"
            role="radiogroup"
            aria-label="Product mode"
          >
            <button
              type="button"
              className={productMode === "swarm" ? "active" : ""}
              role="radio"
              aria-checked={productMode === "swarm"}
              data-testid="setup-mode-swarm"
              onClick={() => setProductMode("swarm")}
            >
              {PRODUCT_MODE_LABELS.swarm}
            </button>
            <button
              type="button"
              className={productMode === "developer" ? "active" : ""}
              role="radio"
              aria-checked={productMode === "developer"}
              data-testid="setup-mode-developer"
              onClick={() => setProductMode("developer")}
            >
              {PRODUCT_MODE_LABELS.developer}
            </button>
          </div>
        </li>
      </ol>
      {restartNote && <p className="scrim-note">{restartNote}</p>}
      {error && (
        <p className="scrim-note" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="btn ghost" disabled={busy !== null} onClick={() => void finish(false)}>
          Skip for now
        </button>
        {setup.dockerFound ? (
          <button
            className="btn primary"
            disabled={busy !== null || !setup.ready}
            onClick={() => void finish(true)}
          >
            Continue
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={busy !== null || !setup.ready}
            onClick={() => void finish(true, "host")}
          >
            Use Host instead
          </button>
        )}
      </div>
    </Modal>
  );
}

function providerGroup(p: AiProvider): { rank: number; hint: string } {
  if (p.kind === "opencode") return { rank: 0, hint: "Free tier · key" };
  if (p.kind.endsWith("-cli")) return { rank: 2, hint: "CLI login · no key" };
  if (p.kind === "claude-code") return { rank: 2, hint: "CLI login · no key" };
  if (isLocalOpenAiBase(p.baseUrl)) return { rank: 1, hint: "Local · no key" };
  return { rank: 3, hint: "API key" };
}
