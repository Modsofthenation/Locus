import type { ComputerUseToolName } from "@locus/shared";

const DESKTOP_TOOLS = new Set<ComputerUseToolName>([
  "screenshot",
  "mouse_move",
  "mouse_click",
  "mouse_drag",
  "mouse_scroll",
  "key",
  "type_text",
  "clipboard_get",
  "clipboard_set",
  "window_list",
  "window_focus",
  "uia_tree",
  "desktop_action",
]);

/** SSH/WinRM run in session 0. Use the same user's existing interactive token;
 * never create an elevated task, store a password, or unlock the secure desktop. */
export function windowsDesktopCommand(name: ComputerUseToolName, source: string): string {
  if (!DESKTOP_TOOLS.has(name)) return source;
  const encoded = Buffer.from(source, "utf8").toString("base64");
  return `if ([Environment]::UserInteractive -and (Get-Process -Id $PID).SessionId -gt 0) { & { ${source} }; return }
$ErrorActionPreference='Stop'
$taskName='Locus-Desktop-'+[Guid]::NewGuid().ToString('N')
$folder=Join-Path $env:TEMP $taskName
$registered=$false
try {
 New-Item -ItemType Directory -Path $folder | Out-Null
 $actionFile=Join-Path $folder 'action.ps1'; $runnerFile=Join-Path $folder 'runner.ps1'
 $resultFile=Join-Path $folder 'result.txt'; $codeFile=Join-Path $folder 'exit.txt'
 [IO.File]::WriteAllText($actionFile,[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))
 $runner='param($ActionFile,$ResultFile,$CodeFile); & (Join-Path $PSHOME powershell.exe) -NoProfile -NonInteractive -File $ActionFile 2>&1 | Out-File -Encoding utf8 -FilePath $ResultFile; [IO.File]::WriteAllText($CodeFile,[string]$LASTEXITCODE)'
 [IO.File]::WriteAllText($runnerFile,$runner)
 $user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
 $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
 $arguments='-NoProfile -NonInteractive -File "'+$runnerFile+'" "'+$actionFile+'" "'+$resultFile+'" "'+$codeFile+'"'
 $action=New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument $arguments
 Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal | Out-Null
 $registered=$true
 Start-ScheduledTask -TaskName $taskName
 $deadline=[DateTime]::UtcNow.AddSeconds(15)
 while (!(Test-Path -LiteralPath $codeFile) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
 if (!(Test-Path -LiteralPath $codeFile)) { throw 'No interactive desktop response. Log in to the guest as the SSH/WinRM user, then retry or take over the VM.' }
 $code=[int][IO.File]::ReadAllText($codeFile)
 [IO.File]::ReadAllText($resultFile)
 if($code -ne 0) { throw 'Interactive desktop action failed; refresh the accessibility tree before retrying.' }
} finally {
 if($registered) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue }
 Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction SilentlyContinue
}`;
}
