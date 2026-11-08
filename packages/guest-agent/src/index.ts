export { applyGuestPatch } from "./applyPatch.js";
export type { GuestRuntime, ToolRequest, ToolResult } from "./types.js";
export { MockGuestRuntime } from "./mock.js";
export {
  DockerGuestRuntime,
  dockerCommand,
  dockerExecNeedsRoot,
  DOCKER_AGENT_HOME,
} from "./docker.js";
export { HostGuestRuntime, hostCommand } from "./host.js";
export { launchHostChrome } from "./hostChrome.js";
export type { HostChromeHandle } from "./hostChrome.js";
export { LiveCdp } from "./cdpSession.js";
export type { WsCtor } from "./cdpSession.js";
export {
  hostExecEnv,
  hostGitAuthEnv,
  hostSpawnErrorOutput,
  posixShellCandidates,
  posixShellPath,
} from "./posixShell.js";
export {
  CdpChromiumDriver,
  CHROMIUM_REMOTE_ADDRESS,
  DOCKER_BROWSER_TOOLS,
  boxCenter,
  formatAccessibilitySnapshot,
  isBrowserUrl,
  normalizeSnapshotRef,
  parseBrowserPages,
  parseMappedPort,
  rewriteCdpWs,
} from "./chromium.js";
export type { ChromiumDriver, ScreencastFrame } from "./chromium.js";
export { ExtensionChromiumDriver, extensionFrameFromMessage } from "./extensionDriver.js";
export { guestLoopbackRelayScript, listenGuestLoopbackTunnel } from "./tunnel.js";
export type { GuestLoopbackTunnel } from "./tunnel.js";
export {
  commandFor,
  isSupported,
  linuxCommand,
  parseRecordScreenResult,
  RECORDING_MARKER,
  windowsCommand,
} from "./commands.js";
export {
  SshGuestRuntime,
  waitForSsh,
  sshArgv,
  scpPutArgv,
  scpGetArgv,
  runSsh,
  isSshTransportError,
} from "./ssh.js";
export type { SshTarget, SshExec } from "./ssh.js";
export {
  spawnCliOverSsh,
  sshRemoteCommand,
  sshCliEnv,
  sshTargetFromInstance,
  posixShellQuote,
} from "./sshCli.js";
export type { SshCliForward, SshCliHandle } from "./sshCli.js";
export { authenticatedCloneUrl, gitAuthHeader } from "./git.js";
export { ensureHostKey } from "./keys.js";
export type { HostSshKey } from "./keys.js";
export { waitForGuest, guestReadyTimeoutMs } from "./ready.js";
export type { GuestWaitTarget } from "./ready.js";
export { WinRmGuestRuntime, probeWinRm, powershellEncodedCommand } from "./winrm.js";
export type { WinRmTarget, WinRmPost } from "./winrm.js";
export { WindowsGuestRuntime } from "./windows.js";
export { containedPath, ensureParentInside } from "./containedPath.js";
