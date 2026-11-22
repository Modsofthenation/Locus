import { useEffect, useRef, useState } from "react";
import type {
  AndroidAction,
  AndroidEnvironment,
  AndroidJob,
  AndroidProjectInfo,
} from "@locus/shared";
import { androidApi, androidBase } from "./androidApi";
import { AndroidCanvas } from "./AndroidCanvas";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function AndroidWorkbench({ sessionId }: { sessionId: string }) {
  const [environment, setEnvironment] = useState<AndroidEnvironment | null>(null);
  const [avd, setAvd] = useState("");
  const [serial, setSerial] = useState("");
  const [packageName, setPackageName] = useState("");
  const [project, setProject] = useState<AndroidProjectInfo | null>(null);
  const packageTouched = useRef(false);
  const [job, setJob] = useState<AndroidJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"canvas" | "output">("canvas");
  // The canvas portals its Rotate / Pause / Zoom / Fullscreen tools into the tab row.
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const mounted = useRef(true);
  const log = useRef<HTMLPreElement>(null);
  const logText = job?.log ?? "";
  useEffect(() => {
    // Follow the tail of the build log unless the reader has scrolled up.
    const element = log.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (nearBottom || job?.status === "running") element.scrollTop = element.scrollHeight;
  }, [logText, tab, job?.status]);
  async function refresh() {
    const next = await androidApi.environment(sessionId);
    if (!mounted.current) return;
    setEnvironment(next);
    setAvd((current) => (next.avds.includes(current) ? current : (next.avds[0] ?? "")));
    setSerial((current) =>
      next.devices.some((d) => d.serial === current && d.state === "device")
        ? current
        : (next.devices.find((d) => d.state === "device")?.serial ?? ""),
    );
  }
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        await refresh();
        const [result, info] = await Promise.all([
          androidApi.job(sessionId),
          androidApi.project(sessionId).catch(() => null),
        ]);
        if (!mounted.current) return;
        setJob(result.job);
        if (info) {
          setProject(info);
          // Prefill the detected applicationId until the operator edits the field.
          if (info.applicationId && !packageTouched.current) setPackageName(info.applicationId);
        }
      } catch (cause) {
        if (mounted.current) setError(message(cause));
      } finally {
        if (mounted.current) timer = setTimeout(() => void poll(), 3000);
      }
    }
    void poll();
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
    // This workbench is keyed by sessionId; polling belongs to that session only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const running = busy || job?.status === "running";
  const ready = environment?.devices.filter((device) => device.state === "device") ?? [];
  const booting = environment?.devices.some((device) => device.state !== "device") ?? false;
  async function run(action: AndroidAction) {
    await perform(async () => {
      const result = await androidApi.run(sessionId, action, serial, packageName);
      if (mounted.current) {
        setJob(result);
        setTab("output");
      }
    });
  }
  const runBlocker = !serial
    ? "Start or select a running device to build & run."
    : !packageName.trim()
      ? "Enter the application ID (for example com.example.myapp) to build & run."
      : "";
  const deviceState = serial ? "online" : booting ? "booting" : "offline";
  // Installed AVDs are known and there are none: the canvas explains how to create one.
  const noAvds = Boolean(environment) && !environment?.avds.length && !serial && !booting;
  const refreshAll = () => void perform(refresh);
  return (
    <div className="android-workbench">
      <div className="android-toolbar" role="group" aria-label="Device">
        <span className={`android-status ${deviceState}`}>
          {serial ? "Device online" : booting ? "Device booting…" : "No device"}
        </span>
        {noAvds ? null : (
          <>
            <label>
              <span className="android-sr">Virtual device</span>
              <select
                aria-label="Virtual device profile"
                value={avd}
                onChange={(event) => setAvd(event.target.value)}
              >
                <option value="" disabled>
                  Virtual device
                </option>
                {environment?.avds.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <button
              className="btn small"
              disabled={!avd || busy}
              onClick={() =>
                void perform(async () => {
                  await androidApi.boot(sessionId, avd);
                  if (mounted.current)
                    setNotice("Emulator starting. It is selected automatically when it is ready.");
                })
              }
            >
              Start device
            </button>
          </>
        )}
        {ready.length > 1 || (serial && !ready.some((device) => device.serial === serial)) ? (
          <label>
            <span className="android-sr">Connected device</span>
            <select
              aria-label="Connected Android device"
              value={serial}
              onChange={(event) => setSerial(event.target.value)}
            >
              <option value="">Select running emulator</option>
              {environment?.devices.map((device) => (
                <option
                  key={device.serial}
                  value={device.serial}
                  disabled={device.state !== "device"}
                >
                  {device.serial} · {device.state}
                </option>
              ))}
            </select>
          </label>
        ) : serial ? (
          <span className="android-serial" title="Connected device">
            {serial}
          </span>
        ) : null}
        <span className="android-toolbar-spacer" />
        {serial ? (
          <button
            className="btn small ghost"
            disabled={running}
            onClick={() =>
              void perform(async () => {
                await androidApi.stop(sessionId, serial);
                await refresh();
              })
            }
          >
            Stop device
          </button>
        ) : null}
        <button
          className="btn small ghost"
          disabled={busy}
          onClick={refreshAll}
          title="Re-check the SDK, virtual devices and running emulators"
        >
          Refresh
        </button>
      </div>
      <div className="android-toolbar" role="group" aria-label="Build">
        <label className="android-app-id">
          Application ID
          <input
            value={packageName}
            onChange={(event) => {
              packageTouched.current = true;
              setPackageName(event.target.value);
            }}
            placeholder="com.example.myapp"
            spellCheck={false}
            autoComplete="off"
            aria-describedby={runBlocker ? "android-run-hint" : undefined}
          />
        </label>
        <button
          className="btn primary small"
          disabled={running || !serial || !packageName.trim()}
          onClick={() => void run("run")}
          title={
            runBlocker ||
            (project?.kind === "react-native"
              ? "Build the debug APK, install it, start Metro and launch it on the device"
              : "Build the debug APK, install it and launch it on the device")
          }
        >
          ▶ Build & run
        </button>
        <span className="android-toolbar-divider" aria-hidden="true" />
        <button className="btn small ghost" disabled={running} onClick={() => void run("build")}>
          Build APK
        </button>
        <button className="btn small ghost" disabled={running} onClick={() => void run("test")}>
          Unit tests
        </button>
        <button
          className="btn small ghost"
          disabled={running || !serial}
          onClick={() => void run("instrument")}
          title={serial ? "Run instrumented tests on the device" : "Requires a running emulator"}
        >
          Device tests
        </button>
        <button className="btn small ghost" disabled={running} onClick={() => void run("lint")}>
          Lint
        </button>
        {job?.status === "succeeded" && (job.action === "build" || job.action === "run") ? (
          <a className="btn small" href={`${androidBase(sessionId)}/apk`} download>
            Download debug APK
          </a>
        ) : null}
        {project?.kind ? (
          <span className="android-project-kind" title="Detected project type">
            {project.kind === "react-native"
              ? project.expo
                ? "React Native · Expo"
                : "React Native"
              : "Native"}
          </span>
        ) : null}
        {project?.metro?.managed ? (
          <button
            className="btn small ghost"
            disabled={busy}
            title="Stop the Metro bundler Locus started for this project"
            onClick={() => void perform(() => androidApi.stopMetro(sessionId))}
          >
            Stop Metro
          </button>
        ) : null}
        {runBlocker && !running ? (
          <small id="android-run-hint" className="android-hint">
            {runBlocker}
          </small>
        ) : null}
      </div>
      {error ? (
        <p className="android-notice error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="android-notice" role="status">
          {notice}
        </p>
      ) : null}
      {project?.issue ? (
        <p className="android-notice" role="status">
          {project.issue}
        </p>
      ) : null}
      {environment?.issues.length ? (
        <details className="android-setup" open={!environment.sdk}>
          <summary>
            Android setup needs attention · {environment.issues.length}{" "}
            {environment.issues.length === 1 ? "item" : "items"}
          </summary>
          <ul>
            {environment.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="android-tabs">
        <div className="android-tablist" role="tablist" aria-label="Android workspace view">
          <button
            role="tab"
            id="android-canvas-tab"
            aria-selected={tab === "canvas"}
            aria-controls="android-canvas-panel"
            onClick={() => setTab("canvas")}
          >
            Device canvas
          </button>
          <button
            role="tab"
            id="android-output-tab"
            aria-selected={tab === "output"}
            aria-controls="android-output-panel"
            onClick={() => setTab("output")}
          >
            Build & test output
            {job ? <span className={`android-job-chip ${job.status}`}>{job.status}</span> : null}
          </button>
        </div>
        {tab === "canvas" ? (
          <div
            ref={setToolsSlot}
            className="android-tabs-tools"
            role="group"
            aria-label="Device canvas view"
          />
        ) : null}
      </div>
      {tab === "canvas" ? (
        <div
          className="android-canvas-panel"
          id="android-canvas-panel"
          role="tabpanel"
          aria-labelledby="android-canvas-tab"
        >
          <AndroidCanvas
            key={serial}
            sessionId={sessionId}
            serial={serial}
            noAvds={noAvds}
            refreshing={busy}
            onRefresh={refreshAll}
            toolsSlot={toolsSlot}
          />
        </div>
      ) : (
        <div
          className="android-output"
          id="android-output-panel"
          role="tabpanel"
          aria-labelledby="android-output-tab"
        >
          <p role="status" className={`android-output-status ${job?.status ?? ""}`}>
            {job
              ? `${actionLabel[job.action] ?? job.action} · ${job.status}`
              : "Run a build or test to see its output here."}
          </p>
          <pre ref={log} aria-label="Android build log" tabIndex={0}>
            {job?.log || (job ? "Waiting for output…" : "No output yet.")}
          </pre>
        </div>
      )}
    </div>
  );
}

const actionLabel: Record<string, string> = {
  run: "Build & run",
  build: "Build APK",
  test: "Unit tests",
  instrument: "Device tests",
  lint: "Lint",
};
