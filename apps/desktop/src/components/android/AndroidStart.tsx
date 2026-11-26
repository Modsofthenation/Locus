import { useState } from "react";
import { ANDROID_PLAYBOOK, policyAllowsHostAgents, parseProductMode } from "@locus/shared";
import { useStore } from "@/state/store";
import { api } from "@/lib/api";
import { loadLastAgent, resolveAgentDefaults } from "@/lib/lastAgent";
import { HostFolderPicker } from "@/components/workspace/HostFolderField";
import { ModelPicker } from "@/components/settings/ModelPicker";

const START_PROMPTS = {
  native:
    "Create a new native Kotlin / Jetpack Compose Android app in this workspace. Inspect the folder first and never overwrite existing files.",
  "react-native":
    "Create a new React Native (TypeScript) app in this workspace with a buildable android/ Gradle project (for Expo, run prebuild for Android). Inspect the folder first and never overwrite existing files.",
  existing:
    "Open the existing Android project (native Gradle, or React Native / Expo with an android/ folder). Inspect it before editing; preserve its files and configuration.",
} as const;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function AndroidStart() {
  const { state, dispatch } = useStore();
  const defaults = resolveAgentDefaults(state.config, "ubuntu", loadLastAgent());
  const [providerId, setProviderId] = useState(defaults.providerId);
  const [model, setModel] = useState(defaults.model);
  const [folder, setFolder] = useState("");
  const [request, setRequest] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [kind, setKind] = useState<"native" | "react-native" | "existing">("native");
  const existing = kind === "existing";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const allowed = policyAllowsHostAgents(state.config?.managedPolicy);
  async function create() {
    if (!state.config || busy) return;
    setBusy(true);
    setError("");
    try {
      const session = await api.createSession({
        title: request.trim().slice(0, 60) || "Android app",
        os: "ubuntu",
        templateId: defaults.templateId || "host",
        runtime: "host",
        placement: "local",
        hostDir: folder.trim(),
        providerId,
        model,
        startVm: false,
        playbook: ANDROID_PLAYBOOK,
        surface: parseProductMode(state.config.productMode),
        prompt: `${START_PROMPTS[kind]}\n\n${request.trim() || "Inspect the app and report its build and test setup."}`,
      });
      dispatch({ type: "session", session });
      dispatch({ type: "select", id: session.id });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  const missing = !folder.trim()
    ? existing
      ? "Enter the project folder to continue."
      : "Enter a folder for the new project to continue."
    : !providerId || !model
      ? "Choose a provider and model to continue."
      : "";
  return (
    <div className="android-start">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <header className="android-start-intro">
          <h1>Set up an Android project</h1>
          <p>Create or open an app, then build and test it on an emulator with your agent.</p>
        </header>
        <fieldset className="android-segmented">
          <legend>Project type</legend>
          <div className="android-segmented-options">
            {(
              [
                ["native", "New Kotlin / Compose app"],
                ["react-native", "New React Native app"],
                ["existing", "Open existing project"],
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="android-project-type"
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="android-field">
          <label htmlFor="android-folder">
            {existing ? "Android project folder" : "Empty project folder"}
          </label>
          <div className="android-folder-row">
            <input
              id="android-folder"
              required
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              placeholder={
                existing ? "/home/you/AndroidStudioProjects/MyApp" : "/home/you/projects/my-app"
              }
              aria-describedby="android-folder-hint"
              spellCheck={false}
              autoComplete="off"
            />
            <button type="button" className="btn ghost" onClick={() => setBrowsing(true)}>
              Browse…
            </button>
          </div>
          <small id="android-folder-hint">
            {existing
              ? "Choose a project you trust. Gradle runs on this computer."
              : "Choose an empty folder on this computer."}
          </small>
          <HostFolderPicker
            open={browsing}
            initialPath={folder}
            title={existing ? "Open Android project" : "Choose project folder"}
            confirmLabel={existing ? "Open this project" : "Use this folder"}
            lead={
              existing
                ? "Choose the folder with settings.gradle(.kts), or a React Native project root with an android/ folder."
                : "Choose an empty folder for the new app. Existing files are never overwritten."
            }
            onClose={() => setBrowsing(false)}
            onPick={setFolder}
          />
        </div>
        <label>
          {existing ? "What would you like to change?" : "What would you like to build?"}
          {existing ? <small className="android-optional">Optional</small> : null}
          <textarea
            required={!existing}
            rows={4}
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder={
              existing
                ? "Leave empty to have the agent inspect the project and report its build setup."
                : "A habit tracker with a weekly overview, reminders and a calm green theme…"
            }
          />
        </label>
        <div className="android-agent-row">
          <ModelPicker
            providers={state.config?.providers ?? []}
            providerId={providerId}
            model={model}
            onChange={(next) => {
              setProviderId(next.providerId);
              setModel(next.model);
            }}
            showCosts={false}
          />
        </div>
        <details className="android-requirements">
          <summary>Android build requirements</summary>
          <ul>
            <li>Android SDK from Android Studio and a compatible JDK</li>
            {kind !== "native" ? <li>Node.js for React Native projects</li> : null}
            <li>A virtual device created in Android Studio’s Device Manager</li>
            {existing ? (
              <li>
                A project with a standard <code>app</code> module and debug APK. For React Native,
                choose the project root containing <code>android/</code>.
              </li>
            ) : null}
          </ul>
        </details>
        {!allowed ? (
          <p role="alert" className="android-form-error">
            Your organization’s policy blocks Host agents.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="android-form-error">
            {error}
          </p>
        ) : null}
        <div className="android-submit">
          <button
            className="btn primary"
            disabled={busy || !folder.trim() || !providerId || !model || !allowed}
          >
            {busy ? "Opening workspace…" : existing ? "Open Android project" : "Create Android app"}
          </button>
          {missing && allowed && !busy ? <small>{missing}</small> : null}
        </div>
      </form>
    </div>
  );
}
