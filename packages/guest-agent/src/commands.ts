import type { ComputerUseToolName, GuestOs } from "@locus/shared";
import {
  execArgCommands,
  fileReadPaths,
  isRecordScreenMode,
  isWindows,
  LOCUS_CHROME_PROFILE_DIR,
  normalizePatchCwd,
  sanitizeRecordingName,
} from "@locus/shared";
import { gitCloneCommand, gitFetchCommand, gitPushCommand, argPull, argForge } from "./git.js";
import type { ToolRequest, ToolResult } from "./types.js";
import { num, optNum, str, truthy, grepContextLines } from "./types.js";

export const RECORDING_MARKER = "LOCUS_RECORDING:";

export function linuxCommand(req: ToolRequest, _os: GuestOs = "ubuntu"): string {
  switch (req.name) {
    case "exec":
      return wrapLinuxExec(
        execArgCommands(req.args),
        str(req.args, "cwd") || undefined,
        optNum(req.args, "timeout_ms"),
      );
    case "screenshot":
      return withDisplay(
        "(command -v grim >/dev/null && grim -t png /tmp/locus-screen.png) || scrot -o /tmp/locus-screen.png; base64 -w0 /tmp/locus-screen.png",
      );
    case "record_screen":
      return withDisplay(linuxRecordScreen(req));
    case "mouse_move":
      return withDisplay(`xdotool mousemove ${num(req.args, "x")} ${num(req.args, "y")}`);
    case "mouse_click":
      return withDisplay(linuxClick(req));
    case "mouse_drag":
      return withDisplay(linuxDrag(req));
    case "mouse_scroll":
      return withDisplay(linuxScroll(req));
    case "key":
      return withDisplay(`xdotool key ${shell(str(req.args, "key"))}`);
    case "type_text":
      return withDisplay(`xdotool type --delay 12 -- ${shell(str(req.args, "text"))}`);
    case "clipboard_get":
      return withDisplay("xclip -selection clipboard -o");
    case "clipboard_set":
      return withDisplay(`printf %s ${shell(str(req.args, "text"))} | xclip -selection clipboard`);
    case "window_list":
      return withDisplay("wmctrl -lG");
    case "window_focus":
      return withDisplay(`wmctrl -a ${shell(str(req.args, "title"))}`);
    case "a11y_tree":
      return withDisplay(linuxA11yTree(str(req.args, "title") || undefined));
    case "file_read":
      return linuxFileRead(req);
    case "file_write":
      return `mkdir -p "$(dirname ${shell(str(req.args, "path"))})" && printf %s ${shell(str(req.args, "content"))} > ${shell(str(req.args, "path"))}`;
    case "file_list":
      return `ls -la -- ${shell(str(req.args, "path", "."))}`;
    case "grep":
      return linuxGrep(req);
    case "glob":
      return linuxGlob(req);
    case "apply_patch":
      return linuxApplyPatch(req);
    case "git_clone":
      return gitCloneCommand({
        url: str(req.args, "url"),
        dest: str(req.args, "dest", "/home/locus/workspace"),
        ref: str(req.args, "ref") || undefined,
        pull: argPull(req.args),
        token: str(req.args, "token") || undefined,
        forge: argForge(req.args, str(req.args, "url")),
        windows: false,
      });
    case "git_fetch":
      return gitFetchCommand({
        path: str(req.args, "path", "/home/locus/workspace"),
        url: str(req.args, "url") || undefined,
        ref: str(req.args, "ref") || undefined,
        pull: argPull(req.args),
        token: str(req.args, "token") || undefined,
        forge: argForge(req.args, str(req.args, "url")),
        windows: false,
      });
    case "git_status":
      return linuxGitStatus(req, "/home/locus/workspace");
    case "git_diff":
      return linuxGitDiff(req, "/home/locus/workspace");
    case "git_log":
      return linuxGitLog(req, "/home/locus/workspace");
    case "git_commit":
      return gitCommitCommand(
        str(req.args, "path", "/home/locus/workspace"),
        str(req.args, "message"),
        false,
      );
    case "git_branch":
      return `git -C ${shell(str(req.args, "path", "/home/locus/workspace"))} checkout -B ${shell(str(req.args, "name"))}`;
    case "git_push":
      return gitPushCommand({
        path: str(req.args, "path", "/home/locus/workspace"),
        token: str(req.args, "token") || undefined,
        windows: false,
        url: str(req.args, "url") || undefined,
      });
    case "git_stash":
      return linuxGitStash(req, "/home/locus/workspace");
    case "git_revert":
      return `git -C ${shell(str(req.args, "path", "/home/locus/workspace"))} revert --no-edit ${shell(str(req.args, "commit", "HEAD"))}`;
    case "start_process":
      return withDisplay(wrapNohupCommand(str(req.args, "command")));
    default:
      return `echo 'unsupported:${req.name} — this tool runs on the Locus control plane, not inside the guest'`;
  }
}

export function windowsCommand(req: ToolRequest): string {
  switch (req.name) {
    case "exec":
    case "powershell":
      return wrapWinExec(
        req.name === "exec" ? execArgCommands(req.args) : [str(req.args, "command")],
        str(req.args, "cwd") || undefined,
        optNum(req.args, "timeout_ms"),
      );
    case "screenshot":
      return "Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object Drawing.Bitmap $b.Width,$b.Height; [Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size); $ms=New-Object IO.MemoryStream; $bmp.Save($ms,[Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray())";
    case "record_screen":
      return windowsRecordScreen(req);
    case "mouse_move":
      return windowsMove(num(req.args, "x"), num(req.args, "y"));
    case "mouse_click":
      return windowsClick(req);
    case "mouse_drag":
      return windowsDrag(req);
    case "mouse_scroll":
      return windowsScroll(req);
    case "key":
      return `Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.SendKeys]::SendWait('${str(req.args, "key").replace(/'/g, "''")}')`;
    case "type_text":
      return `Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.SendKeys]::SendWait('${str(req.args, "text").replace(/'/g, "''")}')`;
    case "clipboard_get":
      return "Get-Clipboard";
    case "clipboard_set":
      return `Set-Clipboard -Value (${windowsUtf8Literal(str(req.args, "text"))})`;
    case "file_read":
      return windowsFileRead(req);
    case "file_write":
      return `[IO.File]::WriteAllText('${str(req.args, "path").replace(/'/g, "''")}', (${windowsUtf8Literal(str(req.args, "content"))}))`;
    case "file_list":
      return `Get-ChildItem -Force '${str(req.args, "path", "C:\\Users\\locus\\workspace").replace(/'/g, "''")}' | Format-Table -AutoSize | Out-String`;
    case "grep":
      return windowsGrep(req);
    case "glob":
      return windowsGlob(req);
    case "apply_patch":
      return windowsApplyPatch(req);
    case "git_clone":
      return gitCloneCommand({
        url: str(req.args, "url"),
        dest: str(req.args, "dest", "C:\\Users\\locus\\workspace"),
        ref: str(req.args, "ref") || undefined,
        pull: argPull(req.args),
        token: str(req.args, "token") || undefined,
        forge: argForge(req.args, str(req.args, "url")),
        windows: true,
      });
    case "git_fetch":
      return gitFetchCommand({
        path: str(req.args, "path", "C:\\Users\\locus\\workspace"),
        url: str(req.args, "url") || undefined,
        ref: str(req.args, "ref") || undefined,
        pull: argPull(req.args),
        token: str(req.args, "token") || undefined,
        forge: argForge(req.args, str(req.args, "url")),
        windows: true,
      });
    case "git_status":
      return `git -C '${str(req.args, "path", "C:\\Users\\locus\\workspace").replace(/'/g, "''")}' status`;
    case "git_diff":
      return windowsGitDiff(req);
    case "git_log":
      return windowsGitLog(req);
    case "git_commit":
      return gitCommitCommand(
        str(req.args, "path", "C:\\Users\\locus\\workspace"),
        str(req.args, "message"),
        true,
      );
    case "git_branch":
      return `git -C '${str(req.args, "path", "C:\\Users\\locus\\workspace").replace(/'/g, "''")}' checkout -B '${str(req.args, "name").replace(/'/g, "''")}'`;
    case "git_push":
      return gitPushCommand({
        path: str(req.args, "path", "C:\\Users\\locus\\workspace"),
        token: str(req.args, "token") || undefined,
        windows: true,
        url: str(req.args, "url") || undefined,
      });
    case "git_stash":
      return windowsGitStash(req);
    case "git_revert":
      return `git -C '${str(req.args, "path", "C:\\Users\\locus\\workspace").replace(/'/g, "''")}' revert --no-edit '${str(req.args, "commit", "HEAD").replace(/'/g, "''")}'`;
    case "uia_tree":
      return windowsUiaTree(str(req.args, "title") || undefined);
    case "start_process":
      return `$cmd = ${windowsUtf8Literal(str(req.args, "command"))}; Start-Process -FilePath cmd.exe -ArgumentList @('/c', $cmd)`;
    case "window_list":
      return "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id,MainWindowTitle | Format-Table | Out-String";
    case "window_focus":
      return `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate('${str(req.args, "title").replace(/'/g, "''")}')`;
    default:
      return `Write-Output 'unsupported:${req.name} — this tool runs on the Locus control plane, not inside the guest'`;
  }
}

export function commandFor(os: GuestOs, req: ToolRequest): string {
  return isWindows(os) ? windowsCommand(req) : linuxCommand(req, os);
}

function withDisplay(command: string): string {
  return `export DISPLAY="\${DISPLAY:-:0}"; export WAYLAND_DISPLAY="\${WAYLAND_DISPLAY:-wayland-1}"; export XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"; if [ -z "$XAUTHORITY" ] || [ ! -r "$XAUTHORITY" ]; then for _xa in "$HOME/.Xauthority" "/run/user/$(id -u)/gdm/Xauthority" "/run/user/$(id -u)/.Xauthority"; do [ -r "$_xa" ] && export XAUTHORITY="$_xa" && break; done; fi; ${command}`;
}

export function parseRecordScreenResult(output: string): {
  recordingGuestPath?: string;
  recordingName?: string;
} {
  const match = output.match(new RegExp(`${RECORDING_MARKER}(\\S+)`));
  if (!match?.[1]) return {};
  const recordingGuestPath = match[1].replace(/\\/g, "/");
  const recordingName = recordingGuestPath.split("/").pop();
  return recordingName ? { recordingGuestPath, recordingName } : { recordingGuestPath };
}

/** Shape SSH / WinRM exec output into a ToolResult (screenshot base64, record_screen marker). */
export function decorateRemoteToolResult(
  name: string,
  result: { code: number; stdout?: string; stderr?: string },
): ToolResult {
  const output = (result.stdout || result.stderr || "").trim();
  if (name === "screenshot" && result.code === 0 && output.length > 80) {
    return {
      ok: true,
      output: "screenshot captured",
      screenshotBase64: output.replace(/\s/g, ""),
    };
  }
  if (name === "record_screen") {
    const parsed = parseRecordScreenResult(output);
    const cleaned = output.replace(/LOCUS_RECORDING:\S+\s*/g, "").trim();
    return { ok: result.code === 0, output: cleaned || `(exit ${result.code})`, ...parsed };
  }
  return { ok: result.code === 0, output: output || `(exit ${result.code})` };
}

function linuxRecordScreen(req: ToolRequest): string {
  const mode = str(req.args, "mode");
  if (!isRecordScreenMode(mode)) {
    return `echo ${shell(`unsupported record_screen mode: ${mode || "(missing)"}`)}; exit 1`;
  }
  if (mode === "START_RECORDING") {
    return [
      'if [ -f /tmp/locus-record.pid ] && kill -0 "$(cat /tmp/locus-record.pid)" 2>/dev/null; then echo already recording; exit 1; fi',
      "command -v ffmpeg >/dev/null || { echo 'ffmpeg is not installed'; exit 1; }",
      "rm -f /tmp/locus-record.mp4 /tmp/locus-record.log",
      'nohup ffmpeg -nostdin -y -f x11grab -framerate 15 -i "${DISPLAY:-:0}" -an -c:v libx264 -preset ultrafast -pix_fmt yuv420p -movflags +frag_keyframe+empty_moov /tmp/locus-record.mp4 >/tmp/locus-record.log 2>&1 &',
      "echo $! > /tmp/locus-record.pid",
      "sleep 0.4",
      'if ! kill -0 "$(cat /tmp/locus-record.pid)" 2>/dev/null; then cat /tmp/locus-record.log; exit 1; fi',
      "echo recording started",
    ].join("; ");
  }
  if (mode === "DISCARD_RECORDING") {
    return [
      "pid=$(cat /tmp/locus-record.pid 2>/dev/null || true)",
      'if [ -n "$pid" ]; then kill -INT "$pid" 2>/dev/null || true; kill -KILL "$pid" 2>/dev/null || true; fi',
      "rm -f /tmp/locus-record.pid /tmp/locus-record.mp4 /tmp/locus-record.log",
      "echo recording discarded",
    ].join("; ");
  }
  const name = sanitizeRecordingName(str(req.args, "save_as_filename"));
  const dest = `/tmp/locus-recordings/${name}.mp4`;
  return [
    "pid=$(cat /tmp/locus-record.pid 2>/dev/null || true)",
    'if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then echo not recording; exit 1; fi',
    'kill -INT "$pid" 2>/dev/null || true',
    'n=0; while kill -0 "$pid" 2>/dev/null; do n=$((n+1)); [ "$n" -gt 20 ] && break; sleep 0.3; done',
    'kill -KILL "$pid" 2>/dev/null || true',
    "rm -f /tmp/locus-record.pid",
    "if [ ! -s /tmp/locus-record.mp4 ]; then echo 'recording file missing'; cat /tmp/locus-record.log 2>/dev/null; exit 1; fi",
    "mkdir -p /tmp/locus-recordings",
    `mv /tmp/locus-record.mp4 ${shell(dest)}`,
    `echo ${shell(`${RECORDING_MARKER}${dest}`)}`,
    `echo ${shell(`recording saved: ${name}.mp4`)}`,
  ].join("; ");
}

function windowsRecordScreen(req: ToolRequest): string {
  const mode = str(req.args, "mode");
  if (!isRecordScreenMode(mode)) {
    return `Write-Output 'unsupported record_screen mode: ${mode.replace(/'/g, "''") || "(missing)"}'; exit 1`;
  }
  const findFfmpeg =
    "$cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue; $candidates = @(); if ($cmd) { $candidates += $cmd.Source }; $candidates += (Join-Path $env:LOCALAPPDATA 'Microsoft\\WinGet\\Links\\ffmpeg.exe'); $candidates += 'C:\\ffmpeg\\bin\\ffmpeg.exe'; $ffmpeg = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1";
  if (mode === "START_RECORDING") {
    return [
      "$pidFile = Join-Path $env:TEMP 'locus-record.pid'",
      "$outFile = Join-Path $env:TEMP 'locus-record.mp4'",
      "$logFile = Join-Path $env:TEMP 'locus-record.log'",
      "if (Test-Path $pidFile) { $old = Get-Content $pidFile | Select-Object -First 1; if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) { Write-Output 'already recording'; exit 1 } }",
      findFfmpeg,
      "if (-not $ffmpeg) { Write-Output 'ffmpeg is not installed'; exit 1 }",
      "Remove-Item $outFile,$logFile -ErrorAction SilentlyContinue",
      "$p = Start-Process -FilePath $ffmpeg -ArgumentList @('-nostdin','-y','-f','gdigrab','-framerate','15','-i','desktop','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+frag_keyframe+empty_moov',$outFile) -WindowStyle Hidden -PassThru -RedirectStandardError $logFile",
      "Set-Content -Path $pidFile -Value $p.Id",
      "Start-Sleep -Milliseconds 400",
      "if (-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)) { Get-Content $logFile -ErrorAction SilentlyContinue; exit 1 }",
      "Write-Output 'recording started'",
    ].join("; ");
  }
  if (mode === "DISCARD_RECORDING") {
    return [
      "$pidFile = Join-Path $env:TEMP 'locus-record.pid'",
      "if (Test-Path $pidFile) { $id = Get-Content $pidFile | Select-Object -First 1; if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } }",
      "Remove-Item (Join-Path $env:TEMP 'locus-record.pid'),(Join-Path $env:TEMP 'locus-record.mp4'),(Join-Path $env:TEMP 'locus-record.log') -ErrorAction SilentlyContinue",
      "Write-Output 'recording discarded'",
    ].join("; ");
  }
  const name = sanitizeRecordingName(str(req.args, "save_as_filename"));
  const destName = `${name}.mp4`.replace(/'/g, "''");
  return [
    "$pidFile = Join-Path $env:TEMP 'locus-record.pid'",
    "$outFile = Join-Path $env:TEMP 'locus-record.mp4'",
    "if (-not (Test-Path $pidFile)) { Write-Output 'not recording'; exit 1 }",
    "$id = Get-Content $pidFile | Select-Object -First 1",
    "if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }",
    "$n = 0; while ($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue) -and $n -lt 20) { Start-Sleep -Milliseconds 300; $n++ }",
    "Remove-Item $pidFile -ErrorAction SilentlyContinue",
    "if (-not (Test-Path $outFile) -or (Get-Item $outFile).Length -lt 64) { Write-Output 'recording file missing'; Get-Content (Join-Path $env:TEMP 'locus-record.log') -ErrorAction SilentlyContinue; exit 1 }",
    "$dir = Join-Path $env:TEMP 'locus-recordings'; New-Item -ItemType Directory -Force -Path $dir | Out-Null",
    `$dest = Join-Path $dir '${destName}'`,
    "Move-Item -Force $outFile $dest",
    `Write-Output ('${RECORDING_MARKER}' + $dest)`,
    `Write-Output 'recording saved: ${destName}'`,
  ].join("; ");
}

export function isSupported(os: GuestOs, name: ComputerUseToolName): boolean {
  if (name === "powershell" || name === "uia_tree") return isWindows(os);
  if (name === "a11y_tree" || name === "preview" || name.startsWith("browser_"))
    return !isWindows(os);
  return true;
}

function wrapLinuxExec(commands: string[], cwd?: string, timeoutMs?: number): string {
  if (!commands.length) return "echo 'exec needs command or commands' >&2; exit 2";
  const command = withGitCommitIdentity(
    commands.length === 1 ? commands[0]! : linuxExecBatch(commands),
  );
  let inner = command;
  if (cwd) inner = `cd -- ${shell(cwd)} && { ${command}; }`;
  if (timeoutMs != null && timeoutMs > 0) {
    const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
    return `timeout --kill-after=2s ${secs}s bash -lc ${shell(inner)}`;
  }
  return inner;
}

function withGitCommitIdentity(command: string): string {
  if (!/\bgit\b/.test(command) || !/\bcommit\b/.test(command)) return command;
  return `GIT_AUTHOR_NAME=Locus GIT_AUTHOR_EMAIL=locus@local GIT_COMMITTER_NAME=Locus GIT_COMMITTER_EMAIL=locus@local ${command}`;
}

export function wrapNohupCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "echo 'start_process needs command' >&2; exit 2";
  return `log=$(mktemp /tmp/locus-proc.XXXXXX); nohup sh -c ${shell(trimmed)} >"$log" 2>&1 & pid=$!; mv "$log" /tmp/locus-proc.$pid.log; echo $pid`;
}

function linuxExecBatch(commands: string[]): string {
  const body = commands
    .map((cmd, i) => {
      const header = `=== ${i + 1}: ${cmd} ===`;
      // Isolate each item in `sh -c` so a trailing `; printf` cannot glue onto a
      // heredoc delimiter (`python3 - <<'EOF' ... EOF; printf ...` used to SyntaxError).
      return `printf '%s\\n' ${shell(header)}; sh -c ${shell(cmd)}; printf '\\n(exit %s)\\n' "$?";`;
    })
    .join(" ");
  return `set +e; ${body} true`;
}

function wrapWinExec(commands: string[], cwd?: string, timeoutMs?: number): string {
  const command =
    commands.length <= 1
      ? commands[0] || "Write-Error 'exec needs command or commands'; exit 2"
      : windowsExecBatch(commands);
  const dir = cwd ? cwd.replace(/'/g, "''") : "";
  if (timeoutMs != null && timeoutMs > 0) {
    const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
    const body = command.replace(/'/g, "''");
    return [
      `$job = Start-Job -ScriptBlock { param($dir,$c) if ($dir) { Set-Location -LiteralPath $dir }; Invoke-Expression $c } -ArgumentList '${dir}','${body}'`,
      `if (-not (Wait-Job $job -Timeout ${secs})) { Stop-Job $job; Remove-Job $job -Force; Write-Output 'timed out'; exit 124 }`,
      "Receive-Job $job",
      "Remove-Job $job",
    ].join("; ");
  }
  if (cwd) return `Set-Location -LiteralPath '${dir}'; ${command}`;
  return command;
}

function windowsExecBatch(commands: string[]): string {
  return commands
    .map((cmd, i) => {
      const header = `=== ${i + 1}: ${cmd} ===`.replace(/'/g, "''");
      // Newline before the footer so a here-string closer (`'@`) stays on its own line.
      return `Write-Output '${header}'; ${cmd}\nWrite-Output ('(exit ' + $LASTEXITCODE + ')');`;
    })
    .join("; ");
}

function clickCount(args: Record<string, unknown>): number {
  const raw = optNum(args, "count");
  if (raw == null) return 1;
  return Math.max(1, Math.min(10, Math.round(raw)));
}

function linuxMovePrefix(args: Record<string, unknown>): string {
  const x = optNum(args, "x");
  const y = optNum(args, "y");
  if (x == null || y == null) return "";
  return `mousemove ${x} ${y} `;
}

function linuxClick(req: ToolRequest): string {
  const button = num(req.args, "button", 1);
  const count = clickCount(req.args);
  return `xdotool ${linuxMovePrefix(req.args)}click --repeat ${count} ${button}`;
}

function linuxDrag(req: ToolRequest): string {
  const x1 = optNum(req.args, "x1");
  const y1 = optNum(req.args, "y1");
  const start = x1 != null && y1 != null ? `mousemove ${x1} ${y1} ` : "";
  return `xdotool ${start}mousedown 1 mousemove ${num(req.args, "x2")} ${num(req.args, "y2")} mouseup 1`;
}

function linuxScroll(req: ToolRequest): string {
  const delta = Math.round(optNum(req.args, "delta") ?? 0);
  if (delta === 0) return "echo no scroll";
  const notches = Math.min(20, Math.abs(delta));
  const horizontal = str(req.args, "axis") === "horizontal";
  const button = horizontal ? (delta > 0 ? 6 : 7) : delta > 0 ? 4 : 5;
  return `xdotool ${linuxMovePrefix(req.args)}click --repeat ${notches} ${button}`;
}

function linuxFileRead(req: ToolRequest): string {
  const paths = fileReadPaths(req.args);
  if (!paths.length) return "echo 'file_read needs path or paths' >&2; exit 2";
  const cap = paths.length > 1 ? 40_000 : 100_000;
  if (paths.length === 1) return linuxFileReadOne(paths[0]!, req.args, cap);
  return paths
    .map(
      (path, index) =>
        `echo ${shell(`=== ${index + 1}: ${path} ===`)}; ${linuxFileReadOne(path, req.args, cap)}`,
    )
    .join("; ");
}

function linuxFileReadOne(path: string, args: Record<string, unknown>, cap: number): string {
  const quoted = shell(path);
  const offset = optNum(args, "offset");
  const limit = optNum(args, "limit");
  if (offset != null || limit != null) {
    const start = Math.max(1, Math.round(offset ?? 1));
    const count = Math.max(1, Math.round(limit ?? 200));
    const end = start + count - 1;
    return `sed -n '${start},${end}p' -- ${quoted} | head -c ${cap}`;
  }
  return `head -c ${cap} -- ${quoted}`;
}

function rgSkipGlobs(): string {
  const hidden = `--glob ${shell("!.*/**")}`;
  const chrome = `--glob ${shell(`!${LOCUS_CHROME_PROFILE_DIR}/**`)}`;
  return `${hidden} ${chrome}`;
}

function windowsRgSkipGlobs(): string {
  const hidden = `--glob '!.*/**'`;
  const chrome = `--glob '!${LOCUS_CHROME_PROFILE_DIR}/**'`;
  return `${hidden} ${chrome}`;
}

function linuxGrep(req: ToolRequest): string {
  const pattern = str(req.args, "pattern");
  const path = str(req.args, "path", ".");
  const glob = str(req.args, "glob");
  const include = glob ? `--include=${shell(glob)} ` : "";
  const globFlag = glob ? `--glob ${shell(glob)} ` : "";
  const context = grepContextLines(req.args);
  const ctx = context > 0 ? `-C ${context} ` : "";
  const quotedPath = shell(path);
  const skip = rgSkipGlobs();
  const rg =
    `extra=""; if [ -f ${quotedPath}/.locusignore ]; then extra=--ignore-file=${quotedPath}/.locusignore; ` +
    `elif [ -f .locusignore ]; then extra=--ignore-file=.locusignore; fi; ` +
    `rg -n --hidden ${skip} ${globFlag}${ctx}$extra -e ${shell(pattern)} -- ${quotedPath}`;
  const grep = `grep -R -n -E ${ctx}${include}-- ${shell(pattern)} ${quotedPath} 2>/dev/null`;
  return `if command -v rg >/dev/null 2>&1; then ${rg}; else ${grep}; fi | head -c 48000`;
}

function linuxGlob(req: ToolRequest): string {
  const pattern = str(req.args, "pattern");
  const path = str(req.args, "path", ".");
  const quotedPath = shell(path);
  const quotedPat = shell(pattern);
  const findName = shell(pattern.replace(/^(?:\*\*\/)+/, ""));
  const rg = `rg --files --hidden ${rgSkipGlobs()} -g ${quotedPat} -- ${quotedPath}`;
  const find = `find ${quotedPath} -name ${findName} 2>/dev/null`;
  return `if command -v rg >/dev/null 2>&1; then ${rg}; else ${find}; fi | head -n 200`;
}

function linuxApplyPatch(req: ToolRequest): string {
  const cwd = shell(
    normalizePatchCwd(str(req.args, "path", "/home/locus/workspace"), "/home/locus/workspace"),
  );
  return [
    `p=$(mktemp /tmp/locus-patch.XXXXXX)`,
    `printf %s ${shell(str(req.args, "patch"))} > "$p"`,
    `d=${cwd}`,
    `if [ -f "$d" ]; then d=$(dirname "$d"); fi`,
    `set +e`,
    `git -C "$d" apply --whitespace=nowarn "$p" || git -C "$d" apply --whitespace=nowarn -p0 "$p" || patch -d "$d" -p1 --forward --batch < "$p" || patch -d "$d" -p0 --forward --batch < "$p"`,
    `s=$?`,
    `rm -f "$p"`,
    `exit $s`,
  ].join("; ");
}

function linuxGitStatus(req: ToolRequest, fallback: string): string {
  const path = shell(str(req.args, "path", fallback));
  const skip = LOCUS_CHROME_PROFILE_DIR;
  return `git -C ${path} status -- . ':(exclude,top)${skip}' ':(exclude,top)${skip}/**'`;
}

function linuxGitDiff(req: ToolRequest, fallback: string): string {
  const path = str(req.args, "path", fallback);
  const staged = truthy(req.args, "staged") ? "--cached " : "";
  const quoted = shell(path);
  const root = shell(fallback);
  return [
    `p=${quoted}`,
    `if [ -d "$p" ]; then git -C "$p" diff ${staged}`,
    `elif [ -f "$p" ]; then git -C "$(dirname -- "$p")" diff ${staged}-- "$(basename -- "$p")"`,
    `else git -C ${root} diff ${staged}`,
    `fi | head -c 80000`,
  ].join("; ");
}

function linuxGitLog(req: ToolRequest, fallback: string): string {
  const path = str(req.args, "path", fallback);
  const max = Math.max(1, Math.min(100, Math.round(optNum(req.args, "max") ?? 20)));
  return `git -C ${shell(path)} log -n ${max} --oneline --decorate`;
}

function linuxGitStash(req: ToolRequest, fallback: string): string {
  const path = str(req.args, "path", fallback);
  const action = str(req.args, "action") === "pop" ? "pop" : "push";
  return action === "pop"
    ? `git -C ${shell(path)} stash pop`
    : `git -C ${shell(path)} stash push -u -m locus`;
}

function windowsFileRead(req: ToolRequest): string {
  const paths = fileReadPaths(req.args);
  if (!paths.length) return "Write-Error 'file_read needs path or paths'; exit 2";
  if (paths.length === 1) return windowsFileReadOne(paths[0]!, req.args);
  return paths
    .map((path) => {
      const safe = path.replace(/'/g, "''");
      return `Write-Output '=== ${safe} ==='; ${windowsFileReadOne(path, req.args)}`;
    })
    .join("; ");
}

function windowsFileReadOne(path: string, args: Record<string, unknown>): string {
  const safe = path.replace(/'/g, "''");
  const offset = optNum(args, "offset");
  const limit = optNum(args, "limit");
  if (offset != null || limit != null) {
    const skip = Math.max(0, Math.round(offset ?? 1) - 1);
    const take = Math.max(1, Math.round(limit ?? 200));
    return `Get-Content -Path '${safe}' | Select-Object -Skip ${skip} -First ${take} | Out-String`;
  }
  return `Get-Content -Raw -Path '${safe}' | ForEach-Object { if ($_.Length -gt 100000) { $_.Substring(0,100000) } else { $_ } }`;
}

function windowsGrep(req: ToolRequest): string {
  const pattern = str(req.args, "pattern").replace(/'/g, "''");
  const path = str(req.args, "path", "C:\\Users\\locus\\workspace").replace(/'/g, "''");
  const glob = str(req.args, "glob").replace(/'/g, "''");
  const filter = glob ? `-Filter '${glob}' ` : "";
  const globFlag = glob ? `--glob '${glob}' ` : "";
  const context = grepContextLines(req.args);
  const ctx = context > 0 ? `-Context ${context},${context} ` : "";
  const rgCtx = context > 0 ? `-C ${context} ` : "";
  const rg = `rg -n --hidden ${windowsRgSkipGlobs()} ${globFlag}${rgCtx}-e '${pattern}' -- '${path}' | Select-Object -First 400 | Out-String`;
  const fallback = `Get-ChildItem -Recurse -File ${filter}-Path '${path}' -ErrorAction SilentlyContinue | Select-String -Pattern '${pattern}' ${ctx}| Select-Object -First 40 | Out-String`;
  return `if (Get-Command rg -ErrorAction SilentlyContinue) { ${rg} } else { ${fallback} }`;
}

function windowsGlob(req: ToolRequest): string {
  const pattern = str(req.args, "pattern").replace(/'/g, "''");
  const path = str(req.args, "path", "C:\\Users\\locus\\workspace").replace(/'/g, "''");
  const rg = `rg --files --hidden ${windowsRgSkipGlobs()} -g '${pattern}' -- '${path}' | Select-Object -First 200 | Out-String`;
  const fallback = `Get-ChildItem -Recurse -File -Filter '${pattern}' -Path '${path}' -ErrorAction SilentlyContinue | Select-Object -First 200 -ExpandProperty FullName`;
  return `if (Get-Command rg -ErrorAction SilentlyContinue) { ${rg} } else { ${fallback} }`;
}

function windowsUtf8Literal(value: string): string {
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))`;
}

function windowsApplyPatch(req: ToolRequest): string {
  const cwd = normalizePatchCwd(
    str(req.args, "path", "C:\\Users\\locus\\workspace"),
    "C:\\Users\\locus\\workspace",
  ).replace(/'/g, "''");
  const patch = windowsUtf8Literal(str(req.args, "patch"));
  return [
    `$p = Join-Path $env:TEMP ('locus-' + [guid]::NewGuid().ToString() + '.patch')`,
    `[IO.File]::WriteAllText($p, (${patch}))`,
    `$d = '${cwd}'`,
    `if (Test-Path -LiteralPath $d -PathType Leaf) { $d = Split-Path -Parent $d }`,
    `git -C $d apply --whitespace=nowarn $p`,
    `$code = $LASTEXITCODE`,
    `if ($code -ne 0) { git -C $d apply --whitespace=nowarn -p0 $p; $code = $LASTEXITCODE }`,
    `Remove-Item $p -ErrorAction SilentlyContinue`,
    `if ($code -ne 0) { throw 'git apply failed' }`,
  ].join("; ");
}

function windowsGitDiff(req: ToolRequest): string {
  const path = str(req.args, "path", "C:\\Users\\locus\\workspace").replace(/'/g, "''");
  const staged = truthy(req.args, "staged") ? "--cached " : "";
  return [
    `$p = '${path}'`,
    `if (Test-Path -LiteralPath $p -PathType Container) { git -C $p diff ${staged} }`,
    `elseif (Test-Path -LiteralPath $p -PathType Leaf) { git -C (Split-Path -Parent $p) diff ${staged}-- (Split-Path -Leaf $p) }`,
    `else { git -C 'C:\\Users\\locus\\workspace' diff ${staged} }`,
    `| Select-Object -First 400 | Out-String`,
  ].join("; ");
}

function windowsGitLog(req: ToolRequest): string {
  const path = str(req.args, "path", "C:\\Users\\locus\\workspace").replace(/'/g, "''");
  const max = Math.max(1, Math.min(100, Math.round(optNum(req.args, "max") ?? 20)));
  return `git -C '${path}' log -n ${max} --oneline --decorate`;
}

function windowsGitStash(req: ToolRequest): string {
  const path = str(req.args, "path", "C:\\Users\\locus\\workspace").replace(/'/g, "''");
  return str(req.args, "action") === "pop"
    ? `git -C '${path}' stash pop`
    : `git -C '${path}' stash push -u -m locus`;
}

function linuxA11yTree(title?: string): string {
  const match = title
    ? `echo '=== match ==='; wmctrl -lx | grep -i -F -- ${shell(title)} || true; `
    : "";
  return [
    "echo '=== windows ==='",
    "wmctrl -lG",
    "echo '=== classes ==='",
    "wmctrl -lx",
    "echo '=== focused ==='",
    "xdotool getwindowfocus getwindowname getwindowgeometry getwindowpid 2>/dev/null || true",
    match ? match.trim() : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function windowsMove(x: number, y: number): string {
  return `Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Cursor]::Position = New-Object Drawing.Point ${x},${y}`;
}

function windowsClick(req: ToolRequest): string {
  const x = optNum(req.args, "x");
  const y = optNum(req.args, "y");
  const move = x != null && y != null ? `${windowsMove(x, y)}; ` : "";
  const count = clickCount(req.args);
  const one = windowsMouseClick(num(req.args, "button", 1));
  if (count === 1) return `${move}${one}`;
  return `${move}1..${count} | ForEach-Object { ${one} }`;
}

function windowsDrag(req: ToolRequest): string {
  const x1 = optNum(req.args, "x1");
  const y1 = optNum(req.args, "y1");
  const start = x1 != null && y1 != null ? `${windowsMove(x1, y1)}; ` : "";
  return `${start}${windowsMouseClick(1, "down")}; ${windowsMove(num(req.args, "x2"), num(req.args, "y2"))}; ${windowsMouseClick(1, "up")}`;
}

function windowsScroll(req: ToolRequest): string {
  const delta = Math.round(optNum(req.args, "delta") ?? 0);
  const x = optNum(req.args, "x");
  const y = optNum(req.args, "y");
  const move = x != null && y != null ? `${windowsMove(x, y)}; ` : "";
  const horizontal = str(req.args, "axis") === "horizontal";
  const flag = horizontal ? 0x01000 : 0x0800;
  const wheel = 120 * delta;
  const ensure =
    "if (-not ('LocusMouse' -as [type])) { Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class LocusMouse { [DllImport(\"user32.dll\")] public static extern void mouse_event(int f, int dx, int dy, int c, int extra); }' }";
  return `${move}${ensure}; [LocusMouse]::mouse_event(${flag},0,0,${wheel},0)`;
}

function windowsUiaTree(title?: string): string {
  const filter = title
    ? [
        `$title = '${title.replace(/'/g, "''")}'`,
        "$cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, $title)",
        "$hit = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $cond)",
        "if ($hit) { $root = $hit } else { Write-Output \"No window matching '$title'\"; return }",
      ].join("\n")
    : "";
  return [
    "Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes",
    "$root = [Windows.Automation.AutomationElement]::RootElement",
    filter,
    "$script:n = 0",
    "function Dump([Windows.Automation.AutomationElement]$el, [int]$depth) {",
    "  if ($null -eq $el -or $script:n -ge 80 -or $depth -gt 6) { return }",
    "  try {",
    "    $script:n++",
    "    $c = $el.Current",
    "    $r = $c.BoundingRectangle",
    "    $pad = ' ' * ($depth * 2)",
    "    Write-Output ('{0}{1} name={2} id={3} ({4},{5} {6}x{7})' -f $pad, $c.ControlType.ProgrammaticName, $c.Name, $c.AutomationId, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)",
    "    $w = [Windows.Automation.TreeWalker]::ControlViewWalker",
    "    for ($ch = $w.GetFirstChild($el); $null -ne $ch; $ch = $w.GetNextSibling($ch)) { Dump $ch ($depth + 1) }",
    "  } catch {}",
    "}",
    "Dump $root 0",
    "Write-Output ('nodes=' + $script:n)",
  ]
    .filter(Boolean)
    .join("\n");
}

function gitCommitCommand(path: string, message: string, windows: boolean): string {
  if (windows) {
    const p = path.replace(/'/g, "''");
    const m = message.replace(/'/g, "''");
    return `git -C '${p}' add -A; git -C '${p}' -c user.email=locus@local -c user.name=Locus commit -m '${m}'`;
  }
  return `git -C ${shell(path)} add -A && git -C ${shell(path)} -c user.email=locus@local -c user.name=Locus commit -m ${shell(message)}`;
}

function shell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function windowsMouseClick(button: number, phase: "click" | "down" | "up" = "click"): string {
  const down = button === 3 ? 0x0008 : button === 2 ? 0x0020 : 0x0002;
  const up = button === 3 ? 0x0010 : button === 2 ? 0x0040 : 0x0004;
  const ensure =
    "if (-not ('LocusMouse' -as [type])) { Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class LocusMouse { [DllImport(\"user32.dll\")] public static extern void mouse_event(int f, int dx, int dy, int c, int extra); }' }";
  if (phase === "down") return `${ensure}; [LocusMouse]::mouse_event(${down},0,0,0,0)`;
  if (phase === "up") return `${ensure}; [LocusMouse]::mouse_event(${up},0,0,0,0)`;
  return `${ensure}; [LocusMouse]::mouse_event(${down},0,0,0,0); [LocusMouse]::mouse_event(${up},0,0,0,0)`;
}
